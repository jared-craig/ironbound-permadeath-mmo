import { QUESTS, SHOP_CATALOG, ITEMS } from '../config.js';
import {
  createAppError as createGameError,
  assertCharacterAlive,
} from '../game/leveling.js';
import {
  getCharacterById,
  listCharacters,
  listGraveyard,
  updateEpitaph,
  listChatMessages,
} from '../db/repositories.js';
import {
  moveCharacter,
  travelToZone,
  restAtSanctuary,
  performCombatTurn,
  equipCharacterItem,
  useCharacterItem,
  buyFromShop,
  allocateCharacterTalent,
  toggleCharacterParty,
  acceptCharacterQuest,
  abandonCharacterQuest,
  completeCharacterQuest,
  postChatMessage,
  tickWorld,
  debugPatchState,
} from '../game/world.js';
import { enrichQuestsWithBadges } from '../game/quests.js';

export const MAX_HTTP_BODY_BYTES = 1024 * 1024; // 1 MB

export function sendJsonResponse(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let aborted = false;

    req.on('data', (chunk) => {
      if (aborted) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_HTTP_BODY_BYTES) {
        aborted = true;
        reject(
          createGameError(
            413,
            'PAYLOAD_TOO_LARGE',
            'ERR_PAYLOAD_TOO_LARGE',
            'Request payload exceeds 1MB limit'
          )
        );
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;
      if (totalBytes === 0) {
        resolve({});
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        resolve({});
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        reject(
          createGameError(
            400,
            'INVALID_JSON',
            'ERR_INVALID_JSON',
            'Malformed JSON in request body'
          )
        );
        return;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        reject(
          createGameError(
            400,
            'INVALID_JSON',
            'ERR_INVALID_JSON',
            'JSON request body must be an object'
          )
        );
        return;
      }
      resolve(parsed);
    });

    req.on('error', (err) => {
      if (!aborted) {
        aborted = true;
        reject(err);
      }
    });
  });
}

export async function handleApiRequest(req, res, url, world) {
  const method = (req.method || 'GET').toUpperCase();
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    });
    res.end();
    return;
  }

  try {
    // 1. Health Check
    if (method === 'GET' && pathname === '/api/health') {
      sendJsonResponse(res, 200, {
        ok: true,
        status: 'healthy',
        service: 'ironbound-permadeath-mmo',
        tickCount: world.tickCount,
        timestamp: Date.now(),
      });
      return;
    }

    // 2. World State
    if (method === 'GET' && (pathname === '/api/world' || pathname === '/api/world/state')) {
      const characterId = url.searchParams.get('characterId') || null;
      const state = world.getWorldState(characterId);
      sendJsonResponse(res, 200, state);
      return;
    }

    // 3. Characters
    if (method === 'POST' && pathname === '/api/characters') {
      const body = await readJsonBody(req);
      const character = world.createHero(body);
      sendJsonResponse(res, 201, {
        ok: true,
        character,
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/characters') {
      const status = url.searchParams.get('status') || undefined;
      const characters = listCharacters(world.db, { status }).map((c) =>
        world.enrichCharacter(c)
      );
      sendJsonResponse(res, 200, {
        ok: true,
        characters,
      });
      return;
    }

    const charActionMatch = pathname.match(/^\/api\/characters\/([^/]+)\/action$/);
    if (method === 'POST' && charActionMatch) {
      const characterId = decodeURIComponent(charActionMatch[1]);
      const body = await readJsonBody(req);
      // Enforce existence (404) and alive (403) before dispatching any action
      const character = world.getCharacter(characterId);
      assertCharacterAlive(character);

      const actionType = String(body.actionType || body.type || 'attack')
        .trim()
        .toLowerCase();

      if (actionType === 'move') {
        const result = moveCharacter(world, characterId, body);
        sendJsonResponse(res, 200, { ok: true, ...result });
        return;
      }
      if (actionType === 'zone' || actionType === 'zone_travel' || actionType === 'travel') {
        const result = travelToZone(world, characterId, body.zoneId || body.targetZoneId);
        sendJsonResponse(res, 200, { ok: true, ...result });
        return;
      }
      if (actionType === 'rest') {
        const result = restAtSanctuary(world, characterId);
        sendJsonResponse(res, 200, { ok: true, ...result });
        return;
      }
      if (
        actionType === 'attack' ||
        actionType === 'skill' ||
        actionType === 'potion' ||
        actionType === 'flee' ||
        actionType === 'combat'
      ) {
        const result = performCombatTurn(world, characterId, {
          ...body,
          actionType: actionType === 'combat' ? body.combatAction || 'attack' : actionType,
        });
        sendJsonResponse(res, 200, { ok: true, ...result });
        return;
      }
      if (actionType === 'use_item' || actionType === 'use') {
        const result = useCharacterItem(world, characterId, body.itemId);
        sendJsonResponse(res, 200, { ok: true, ...result });
        return;
      }
      if (actionType === 'equip') {
        const result = equipCharacterItem(world, characterId, body.itemId);
        sendJsonResponse(res, 200, { ok: true, ...result });
        return;
      }
      if (actionType === 'buy' || actionType === 'shop_buy') {
        const result = buyFromShop(world, characterId, body.itemId, body.quantity ?? 1);
        sendJsonResponse(res, 200, { ok: true, ...result });
        return;
      }
      if (actionType === 'talent' || actionType === 'allocate_talent') {
        const result = allocateCharacterTalent(
          world,
          characterId,
          body.node || body.talentId,
          body.points ?? 1
        );
        sendJsonResponse(res, 200, { ok: true, ...result });
        return;
      }
      if (actionType === 'party' || actionType === 'toggle_party') {
        const result = toggleCharacterParty(world, characterId, body.active);
        sendJsonResponse(res, 200, { ok: true, ...result });
        return;
      }
      if (actionType === 'quest_accept') {
        const result = acceptCharacterQuest(world, characterId, body.questId);
        sendJsonResponse(res, 200, { ok: true, ...result });
        return;
      }
      if (actionType === 'quest_complete') {
        const result = completeCharacterQuest(world, characterId, body.questId);
        sendJsonResponse(res, 200, { ok: true, ...result });
        return;
      }
      if (actionType === 'quest_abandon') {
        const result = abandonCharacterQuest(world, characterId, body.questId);
        sendJsonResponse(res, 200, { ok: true, ...result });
        return;
      }

      throw createGameError(
        400,
        'INVALID_ACTION',
        'ERR_INVALID_ACTION',
        `Unsupported character actionType: ${actionType}`
      );
    }

    const charIdMatch = pathname.match(/^\/api\/characters\/([^/]+)$/);
    if (method === 'GET' && charIdMatch) {
      const characterId = decodeURIComponent(charIdMatch[1]);
      const character = world.getCharacter(characterId);
      if (!character) {
        throw createGameError(
          404,
          'CHARACTER_NOT_FOUND',
          'ERR_CHARACTER_NOT_FOUND',
          `Character '${characterId}' not found`
        );
      }
      sendJsonResponse(res, 200, {
        ok: true,
        character,
        quests: character.quests,
        combatSession: character.activeCombat || null,
      });
      return;
    }

    // 4. World Movement, Zone Travel, Sanctuary Rest
    if (method === 'POST' && pathname === '/api/world/move') {
      const body = await readJsonBody(req);
      const result = moveCharacter(world, body.characterId, body);
      sendJsonResponse(res, 200, { ok: true, ...result });
      return;
    }

    if (
      method === 'POST' &&
      (pathname === '/api/world/zone' || pathname === '/api/world/travel')
    ) {
      const body = await readJsonBody(req);
      const result = travelToZone(
        world,
        body.characterId,
        body.zoneId || body.targetZoneId
      );
      sendJsonResponse(res, 200, { ok: true, ...result });
      return;
    }

    if (method === 'POST' && pathname === '/api/world/rest') {
      const body = await readJsonBody(req);
      const result = restAtSanctuary(world, body.characterId);
      sendJsonResponse(res, 200, { ok: true, ...result });
      return;
    }

    // 5. Quests
    if (method === 'GET' && pathname === '/api/quests') {
      const characterId = url.searchParams.get('characterId') || null;
      if (characterId) {
        const character = world.getCharacter(characterId);
        if (!character) {
          throw createGameError(
            404,
            'CHARACTER_NOT_FOUND',
            'ERR_CHARACTER_NOT_FOUND',
            `Character '${characterId}' not found`
          );
        }
        sendJsonResponse(res, 200, {
          ok: true,
          quests: character.quests,
          questsCatalog: character.quests,
        });
        return;
      }
      const defaultCatalog = enrichQuestsWithBadges(
        Object.values(QUESTS).map((q) => ({
          ...q,
          questId: q.id,
          status: !q.prerequisiteQuestId && q.minLevel <= 1 ? 'AVAILABLE' : 'LOCKED',
          currentCount: 0,
        }))
      );
      sendJsonResponse(res, 200, {
        ok: true,
        quests: defaultCatalog,
        questsCatalog: defaultCatalog,
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/quests/accept') {
      const body = await readJsonBody(req);
      const result = acceptCharacterQuest(world, body.characterId, body.questId);
      sendJsonResponse(res, 200, { ok: true, ...result });
      return;
    }

    if (method === 'POST' && pathname === '/api/quests/complete') {
      const body = await readJsonBody(req);
      const result = completeCharacterQuest(world, body.characterId, body.questId);
      sendJsonResponse(res, 200, { ok: true, ...result });
      return;
    }

    if (method === 'POST' && pathname === '/api/quests/abandon') {
      const body = await readJsonBody(req);
      const result = abandonCharacterQuest(world, body.characterId, body.questId);
      sendJsonResponse(res, 200, { ok: true, ...result });
      return;
    }

    // 6. Combat
    if (
      method === 'POST' &&
      (pathname === '/api/combat/action' ||
        pathname === '/api/combat/turn' ||
        pathname === '/api/combat/start')
    ) {
      const body = await readJsonBody(req);
      const result = performCombatTurn(world, body.characterId, body);
      sendJsonResponse(res, 200, { ok: true, ...result });
      return;
    }

    if (method === 'POST' && pathname === '/api/combat/flee') {
      const body = await readJsonBody(req);
      const result = performCombatTurn(world, body.characterId, {
        ...body,
        actionType: 'flee',
      });
      sendJsonResponse(res, 200, { ok: true, ...result });
      return;
    }

    // 7. Inventory & Shop & Talents & Party
    if (method === 'POST' && pathname === '/api/inventory/equip') {
      const body = await readJsonBody(req);
      const result = equipCharacterItem(world, body.characterId, body.itemId);
      sendJsonResponse(res, 200, { ok: true, ...result });
      return;
    }

    if (method === 'POST' && pathname === '/api/inventory/use') {
      const body = await readJsonBody(req);
      const result = useCharacterItem(world, body.characterId, body.itemId);
      sendJsonResponse(res, 200, { ok: true, ...result });
      return;
    }

    if (method === 'GET' && pathname === '/api/shop') {
      sendJsonResponse(res, 200, {
        ok: true,
        shopCatalog: SHOP_CATALOG.map((id) => ITEMS[id]).filter(Boolean),
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/shop/buy') {
      const body = await readJsonBody(req);
      const result = buyFromShop(
        world,
        body.characterId,
        body.itemId,
        body.quantity ?? 1
      );
      sendJsonResponse(res, 200, { ok: true, ...result });
      return;
    }

    if (method === 'POST' && pathname === '/api/talents/allocate') {
      const body = await readJsonBody(req);
      const result = allocateCharacterTalent(
        world,
        body.characterId,
        body.node || body.talentId,
        body.points ?? 1
      );
      sendJsonResponse(res, 200, { ok: true, ...result });
      return;
    }

    if (method === 'POST' && pathname === '/api/party/toggle') {
      const body = await readJsonBody(req);
      const result = toggleCharacterParty(world, body.characterId, body.active);
      sendJsonResponse(res, 200, { ok: true, ...result });
      return;
    }

    // 8. Graveyard & Epitaphs
    if (method === 'GET' && pathname === '/api/graveyard') {
      const sort = url.searchParams.get('sort') || 'level';
      const limit = url.searchParams.get('limit') || 50;
      const entries = listGraveyard(world.db, { sort, limit });
      sendJsonResponse(res, 200, {
        ok: true,
        graveyard: entries,
        entries,
        count: entries.length,
        sort,
      });
      return;
    }

    const epitaphMatch = pathname.match(/^\/api\/graveyard\/([^/]+)\/epitaph$/);
    if ((method === 'POST' || method === 'PATCH') && epitaphMatch) {
      const heroId = decodeURIComponent(epitaphMatch[1]);
      const body = await readJsonBody(req);
      const entry = updateEpitaph(world.db, heroId, body.epitaph);
      sendJsonResponse(res, 200, {
        ok: true,
        entry,
        graveyardEntry: entry,
      });
      return;
    }

    if ((method === 'POST' || method === 'PATCH') && pathname === '/api/graveyard/epitaph') {
      const body = await readJsonBody(req);
      const heroId = body.heroId || body.characterId;
      const entry = updateEpitaph(world.db, heroId, body.epitaph);
      sendJsonResponse(res, 200, {
        ok: true,
        entry,
        graveyardEntry: entry,
      });
      return;
    }

    // 9. Chat
    if (method === 'GET' && pathname === '/api/chat') {
      const limit = url.searchParams.get('limit') || 50;
      const messages = listChatMessages(world.db, limit);
      sendJsonResponse(res, 200, {
        ok: true,
        messages,
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/chat') {
      const body = await readJsonBody(req);
      const msg = postChatMessage(world, body);
      sendJsonResponse(res, 200, {
        ok: true,
        message: msg,
        chatMessage: msg,
      });
      return;
    }

    // 10. Deterministic Debug Hooks
    if (method === 'POST' && pathname === '/api/debug/tick') {
      const body = await readJsonBody(req);
      const rawTicks = body.ticks !== undefined ? body.ticks : body.count !== undefined ? body.count : 1;
      const result = tickWorld(world, rawTicks);
      sendJsonResponse(res, 200, {
        ok: true,
        ...result,
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/debug/state') {
      const body = await readJsonBody(req);
      const result = debugPatchState(world, body);
      sendJsonResponse(res, 200, {
        ok: true,
        ...result,
      });
      return;
    }

    // Unknown API Route -> 404
    sendJsonResponse(res, 404, {
      ok: false,
      status: 404,
      error: 'NOT_FOUND',
      code: 'ERR_NOT_FOUND',
      message: `API route not found: ${method} ${pathname}`,
    });
  } catch (err) {
    const status = Number.isInteger(err.status) ? err.status : 500;
    const error = err.error || (status === 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
    const code = err.code || `ERR_${error}`;
    sendJsonResponse(res, status, {
      ok: false,
      status,
      error,
      code,
      message: err.message || 'An error occurred processing the request',
    });
  }
}
