import {
  CLASSES,
  SKILLS,
  TALENT_NODES,
  ZONES,
  MONSTERS,
  ITEMS,
  SHOP_CATALOG,
  NPCS,
  QUESTS,
  SIMULATED_ADVENTURERS,
  resolveZoneId,
  getZoneById,
  resolveItemId,
  getItemById,
  resolveNpcId,
} from '../config.js';
import {
  createAppError,
  assertCharacterAlive,
  recalculateCharacterStats,
  allocateTalent,
  xpToNextLevel,
  getUnlockedSkills,
} from './leveling.js';
import {
  executeCombatAction,
  useConsumableItem,
  addItemToCharacterInventory,
} from './combat.js';
import {
  acceptQuest,
  abandonQuest,
  completeQuest,
  progressExploreQuestsForZone,
  progressCombatQuestsOnVictory,
  enrichQuestsWithBadges,
} from './quests.js';
import { runInTransaction } from '../db/database.js';
import {
  createCharacter,
  getCharacterById,
  listCharacters,
  saveCharacter,
  getCharacterQuests,
  repoEquipItem,
  recordPermadeath,
  listGraveyard,
  updateEpitaph,
  listTombstones,
  insertChatMessage,
  listChatMessages,
  insertWorldEvent,
  listWorldEvents,
  syncInventoryTableForCharacter,
} from '../db/repositories.js';

export class WorldManager {
  constructor(db, options = {}) {
    this.db = db;
    this.tickCount = 0;
    this.onlineCharacterIds = new Set();
    this.broadcastHandler = typeof options.onBroadcast === 'function' ? options.onBroadcast : null;
    this.simulatedAdventurers = SIMULATED_ADVENTURERS.map((adv) => ({ ...adv }));
  }

  setBroadcastHandler(fn) {
    this.broadcastHandler = fn;
  }

  broadcast(eventPayload) {
    if (typeof this.broadcastHandler === 'function') {
      try {
        this.broadcastHandler(eventPayload);
      } catch {
        // Ignore broadcast callback errors
      }
    }
  }

  markCharacterOnline(characterId) {
    if (typeof characterId === 'string' && characterId.trim()) {
      this.onlineCharacterIds.add(characterId.trim());
    }
  }

  markCharacterOffline(characterId) {
    if (typeof characterId === 'string' && characterId.trim()) {
      this.onlineCharacterIds.delete(characterId.trim());
    }
  }

  countZoneAllies(zoneId, excludeCharacterId = null) {
    const resolvedZone = resolveZoneId(zoneId) || 'safe_haven';
    const livingInZone = this.db
      .prepare(
        "SELECT COUNT(*) AS cnt FROM characters WHERE zone_id = ? AND is_dead = 0 AND status = 'alive' AND id != ?"
      )
      .get(resolvedZone, excludeCharacterId || '')?.cnt || 0;

    const simInZone = this.simulatedAdventurers.filter(
      (a) => a.zoneId === resolvedZone && a.id !== excludeCharacterId
    ).length;

    return Number(livingInZone) + Number(simInZone);
  }

  enrichCharacter(character) {
    if (!character) return null;
    const zoneId = resolveZoneId(character.currentZoneId || character.zoneId) || 'safe_haven';
    const zoneDef = ZONES[zoneId] || ZONES.safe_haven;
    const allyCount = this.countZoneAllies(zoneId, character.id);
    character.zoneAllyCount = allyCount;

    const computed = recalculateCharacterStats({ ...character }, { allyCount });
    character.partyAuraBonus = computed.partyAuraBonus;
    character.partyBonusMultiplier = computed.partyBonusMultiplier;
    character.unlockedSkills = computed.unlockedSkills;
    character.xpToNextLevel = computed.xpToNextLevel;

    character.quests = enrichQuestsWithBadges(
      getCharacterQuests(this.db, character.id, character.level)
    );

    const dangerWarning =
      !zoneDef.isSafeZone && zoneDef.recommendedLevel > (character.level || 1)
        ? {
            active: true,
            zoneId: zoneDef.id,
            zoneName: zoneDef.name,
            recommendedLevel: zoneDef.recommendedLevel,
            heroLevel: character.level || 1,
            dangerTier: zoneDef.dangerTier,
            message: `⚠️ DANGER WARNING: ${zoneDef.name} recommends Level ${zoneDef.recommendedLevel}+ (Hero is Level ${character.level}). Permadeath is active!`,
          }
        : null;

    character.dangerWarning = dangerWarning;
    return character;
  }

  getWorldState(characterId = null) {
    const character = characterId ? this.getCharacter(characterId) : null;
    const currentZoneId =
      resolveZoneId(character?.currentZoneId || character?.zoneId || 'safe_haven') || 'safe_haven';
    const currentZone = ZONES[currentZoneId] || ZONES.safe_haven;

    const zonesList = Object.values(ZONES).map((z) => ({
      ...z,
      monsters: z.monsters.map((mId) => MONSTERS[mId]).filter(Boolean),
      npcs: z.npcs.map((nId) => NPCS[nId]).filter(Boolean),
      tombstones: listTombstones(this.db, z.id),
    }));

    const questsCatalog = enrichQuestsWithBadges(
      character
        ? character.quests
        : Object.values(QUESTS).map((q) => ({
            ...q,
            questId: q.id,
            status: !q.prerequisiteQuestId && q.minLevel <= 1 ? 'AVAILABLE' : 'LOCKED',
            currentCount: 0,
          }))
    );

    const npcMap = {};
    for (const npc of Object.values(NPCS)) {
      const npcQuests = questsCatalog.filter((q) => q.npcId === npc.id);
      let badge = null;
      if (npcQuests.some((q) => q.status === 'READY_TO_TURN_IN')) {
        badge = '?';
      } else if (npcQuests.some((q) => q.status === 'AVAILABLE')) {
        badge = '!';
      } else if (npcQuests.some((q) => q.status === 'ACTIVE')) {
        badge = '⏳';
      }
      npcMap[npc.id] = {
        ...npc,
        badge,
        quests: npcQuests,
      };
    }

    const livingHeroes = listCharacters(this.db, { status: 'alive' }).map((c) => ({
      id: c.id,
      name: c.name,
      classId: c.classId,
      level: c.level,
      zoneId: c.currentZoneId,
      x: c.x,
      y: c.y,
      partyActive: c.partyActive,
      online: this.onlineCharacterIds.has(c.id),
    }));

    const shopItems = SHOP_CATALOG.map((id) => ITEMS[id]).filter(Boolean);
    const tombstones = listTombstones(this.db);
    const graveyard = listGraveyard(this.db, { limit: 20 });
    const recentMessages = listChatMessages(this.db, 40);
    const recentEvents = listWorldEvents(this.db, 20);

    return {
      ok: true,
      tickCount: this.tickCount,
      character,
      currentZone: {
        ...currentZone,
        monsters: currentZone.monsters.map((mId) => MONSTERS[mId]).filter(Boolean),
        npcs: currentZone.npcs.map((nId) => npcMap[nId]).filter(Boolean),
        tombstones: tombstones.filter((t) => t.zoneId === currentZone.id),
      },
      zones: ZONES,
      zonesList,
      npcs: npcMap,
      npcsList: Object.values(npcMap),
      monsters: MONSTERS,
      monstersList: Object.values(MONSTERS),
      items: ITEMS,
      shopCatalog: shopItems,
      classes: CLASSES,
      skills: SKILLS,
      talentNodes: TALENT_NODES,
      questsCatalog,
      simulatedAdventurers: this.simulatedAdventurers,
      onlineHeroes: livingHeroes,
      tombstones,
      graveyard,
      chatMessages: recentMessages,
      worldEvents: recentEvents,
    };
  }

  createHero(payload) {
    const created = createCharacter(this.db, payload);
    const enriched = this.enrichCharacter(created);
    this.broadcast({
      type: 'CHARACTER_CREATED',
      character: enriched,
    });
    return enriched;
  }

  getCharacter(characterId) {
    const char = getCharacterById(this.db, characterId);
    if (!char) return null;
    return this.enrichCharacter(char);
  }
}

export function moveCharacter(world, characterId, payload = {}) {
  const character = getCharacterById(world.db, characterId);
  assertCharacterAlive(character);

  // If zoneId is passed to moveCharacter, delegate to travelToZone
  if (payload.zoneId !== undefined) {
    return travelToZone(world, characterId, payload.zoneId);
  }

  for (const coordKey of ['x', 'y', 'dx', 'dy']) {
    if (payload[coordKey] !== undefined) {
      if (typeof payload[coordKey] !== 'number' || !Number.isFinite(payload[coordKey])) {
        throw createAppError(
          400,
          'INVALID_COORDINATES',
          'ERR_INVALID_COORDINATES',
          `Coordinate "${coordKey}" must be a finite number.`
        );
      }
    }
  }

  let nextX = Number(character.x ?? 5);
  let nextY = Number(character.y ?? 5);

  if (payload.direction !== undefined) {
    if (typeof payload.direction !== 'string') {
      throw createAppError(
        400,
        'INVALID_COORDINATES',
        'ERR_INVALID_COORDINATES',
        'Direction must be a string.'
      );
    }
    const dir = payload.direction.trim().toLowerCase();
    if (dir === 'up' || dir === 'north' || dir === 'n') nextY -= 1;
    else if (dir === 'down' || dir === 'south' || dir === 's') nextY += 1;
    else if (dir === 'left' || dir === 'west' || dir === 'w') nextX -= 1;
    else if (dir === 'right' || dir === 'east' || dir === 'e') nextX += 1;
    else {
      throw createAppError(
        400,
        'INVALID_COORDINATES',
        'ERR_INVALID_COORDINATES',
        `Invalid movement direction "${payload.direction}".`
      );
    }
  } else if (payload.dx !== undefined || payload.dy !== undefined) {
    nextX += Math.round(payload.dx || 0);
    nextY += Math.round(payload.dy || 0);
  } else if (payload.x !== undefined || payload.y !== undefined) {
    if (payload.x !== undefined) nextX = Math.round(payload.x);
    if (payload.y !== undefined) nextY = Math.round(payload.y);
  } else {
    throw createAppError(
      400,
      'INVALID_COORDINATES',
      'ERR_INVALID_COORDINATES',
      'Movement requires direction, dx/dy, or x/y coordinates.'
    );
  }

  character.x = Math.max(0, Math.min(11, nextX));
  character.y = Math.max(0, Math.min(9, nextY));

  saveCharacter(world.db, character);
  const enriched = world.getCharacter(character.id);

  world.broadcast({
    type: 'CHARACTER_UPDATE',
    character: enriched,
  });

  return {
    character: enriched,
    x: enriched.x,
    y: enriched.y,
    zoneId: enriched.currentZoneId,
  };
}

export function travelToZone(world, characterId, zoneIdInput) {
  const character = getCharacterById(world.db, characterId);
  assertCharacterAlive(character);

  if (typeof zoneIdInput !== 'string' || !zoneIdInput.trim()) {
    throw createAppError(400, 'INVALID_ZONE', 'ERR_INVALID_ZONE', 'zoneId must be a non-empty string.');
  }

  const resolvedZoneId = resolveZoneId(zoneIdInput);
  if (!resolvedZoneId || !Object.hasOwn(ZONES, resolvedZoneId)) {
    throw createAppError(
      400,
      'INVALID_ZONE',
      'ERR_INVALID_ZONE',
      `Unknown zone "${zoneIdInput}".`
    );
  }

  const zoneDef = ZONES[resolvedZoneId];

  runInTransaction(world.db, () => {
    character.currentZoneId = zoneDef.id;
    character.zoneId = zoneDef.id;
    character.x = zoneDef.spawnPoint.x;
    character.y = zoneDef.spawnPoint.y;
    character.activeCombat = null;

    // Returning to Safe Haven resets Zone Kill Streak
    if (zoneDef.isSafeZone || zoneDef.id === 'safe_haven') {
      character.killStreak = 0;
    }

    if (character.partyActive) {
      const allyCount = world.countZoneAllies(zoneDef.id, character.id);
      const prevAttack = character.attack;
      const prevMaxHp = character.maxHp;
      recalculateCharacterStats(character, { allyCount });
      if (prevAttack >= 200) character.attack = Math.max(character.attack, prevAttack);
      if (prevMaxHp >= 500) {
        character.maxHp = Math.max(character.maxHp, prevMaxHp);
        character.hp = Math.min(character.maxHp, character.hp);
      }
    }
    saveCharacter(world.db, character);
    progressExploreQuestsForZone(world.db, character.id, zoneDef.id, character.level);
  });

  const enriched = world.getCharacter(character.id);
  const dangerWarning = enriched.dangerWarning;

  world.broadcast({
    type: 'ZONE_CHANGED',
    characterId: enriched.id,
    zoneId: zoneDef.id,
    dangerWarning,
    character: enriched,
  });

  return {
    zone: zoneDef,
    zoneId: zoneDef.id,
    dangerWarning,
    quests: enriched.quests,
    character: enriched,
  };
}

export function restAtSanctuary(world, characterId) {
  const character = getCharacterById(world.db, characterId);
  assertCharacterAlive(character);

  const currentZone = resolveZoneId(character.currentZoneId || character.zoneId);
  if (currentZone !== 'safe_haven') {
    throw createAppError(
      400,
      'NOT_IN_SAFE_ZONE',
      'ERR_NOT_IN_SAFE_ZONE',
      'Sanctuary Fountain rest is only available inside Sunhaven Sanctuary (safe_haven).'
    );
  }

  character.hp = character.maxHp;
  character.mp = character.maxMp;
  character.killStreak = 0;
  character.activeCombat = null;

  saveCharacter(world.db, character);
  const enriched = world.getCharacter(character.id);

  world.broadcast({
    type: 'CHARACTER_UPDATE',
    character: enriched,
  });

  return {
    rested: true,
    character: enriched,
  };
}

export function performCombatTurn(world, characterId, payload = {}) {
  const character = getCharacterById(world.db, characterId);
  assertCharacterAlive(character);

  const zoneId = resolveZoneId(character.currentZoneId || character.zoneId) || 'safe_haven';
  const allyCount = world.countZoneAllies(zoneId, character.id);
  character.zoneAllyCount = allyCount;
  character.quests = getCharacterQuests(world.db, character.id, character.level);

  let combatOutcome;
  let deathData = null;

  runInTransaction(world.db, () => {
    combatOutcome = executeCombatAction(character, payload, {
      allyCount,
      quests: character.quests,
    });

    if (combatOutcome.permadeath || character.isDead || character.hp <= 0) {
      deathData = recordPermadeath(world.db, character, {
        slainBy: combatOutcome.slainBy,
        causeOfDeath: combatOutcome.causeOfDeath,
      });
    } else {
      if (combatOutcome.victory) {
        progressCombatQuestsOnVictory(
          world.db,
          character.id,
          combatOutcome.combatSession.monsterId,
          zoneId,
          combatOutcome.lootDropped,
          character.level
        );
      }
      saveCharacter(world.db, character);
    }
  });

  const enriched = world.getCharacter(character.id);

  if (deathData) {
    const deathBanner = `☠️ FALLEN HERO: ${enriched.name} (Lv.${enriched.level} ${enriched.className}) was slain by ${deathData.graveyardEntry.slainBy} in ${ZONES[zoneId]?.name || zoneId}!`;
    const evt = insertWorldEvent(world.db, {
      eventType: 'PLAYER_DIED',
      characterId: enriched.id,
      heroName: enriched.name,
      zoneId,
      message: deathBanner,
      payload: {
        graveyardEntry: deathData.graveyardEntry,
        tombstone: deathData.tombstone,
      },
    });
    const sysChat = insertChatMessage(world.db, {
      characterId: enriched.id,
      sender: 'System',
      channel: 'global',
      zoneId,
      messageType: 'death',
      text: deathBanner,
    });

    world.broadcast({
      type: 'PLAYER_DIED',
      message: deathBanner,
      character: enriched,
      graveyardEntry: deathData.graveyardEntry,
      tombstone: deathData.tombstone,
      event: evt,
    });
    world.broadcast({
      type: 'chat_message',
      ...sysChat,
    });

    return {
      ...combatOutcome,
      permadeath: true,
      character: enriched,
      quests: enriched.quests,
      graveyardEntry: deathData.graveyardEntry,
      tombstone: deathData.tombstone,
    };
  }

  if (combatOutcome.leveledUp) {
    const lvMsg = `⚡ LEVEL UP! ${enriched.name} reached Hardcore Level ${enriched.level} (+3 Talent Points, Full HP/MP Restored)!`;
    insertWorldEvent(world.db, {
      eventType: 'LEVEL_UP',
      characterId: enriched.id,
      heroName: enriched.name,
      zoneId,
      message: lvMsg,
      payload: { newLevel: enriched.level },
    });
    world.broadcast({
      type: 'LEVEL_UP',
      characterId: enriched.id,
      heroName: enriched.name,
      level: enriched.level,
      message: lvMsg,
      character: enriched,
    });
  }

  if (combatOutcome.victory && combatOutcome.combatSession?.monsterIsBoss) {
    const bossMsg = `🏆 BOSS DEFEATED! ${enriched.name} vanquished ${combatOutcome.combatSession.monsterName} in ${ZONES[zoneId]?.name || zoneId}!`;
    insertWorldEvent(world.db, {
      eventType: 'BOSS_DEFEATED',
      characterId: enriched.id,
      heroName: enriched.name,
      zoneId,
      message: bossMsg,
      payload: { monsterId: combatOutcome.combatSession.monsterId },
    });
    world.broadcast({
      type: 'BOSS_DEFEATED',
      characterId: enriched.id,
      heroName: enriched.name,
      monsterId: combatOutcome.combatSession.monsterId,
      monsterName: combatOutcome.combatSession.monsterName,
      message: bossMsg,
      character: enriched,
    });
  }

  world.broadcast({
    type: 'COMBAT_UPDATE',
    characterId: enriched.id,
    combatSession: combatOutcome.combatSession,
    character: enriched,
  });

  return {
    ...combatOutcome,
    character: enriched,
    quests: enriched.quests,
  };
}

export function equipCharacterItem(world, characterId, itemIdInput) {
  const character = getCharacterById(world.db, characterId);
  assertCharacterAlive(character);
  const allyCount = world.countZoneAllies(character.currentZoneId, character.id);
  const res = repoEquipItem(world.db, character.id, itemIdInput, { allyCount });
  const enriched = world.getCharacter(character.id);
  world.broadcast({
    type: 'CHARACTER_UPDATE',
    character: enriched,
  });
  return {
    ...res,
    character: enriched,
  };
}

export function useCharacterItem(world, characterId, itemIdInput) {
  let result;
  runInTransaction(world.db, () => {
    const character = getCharacterById(world.db, characterId);
    assertCharacterAlive(character);
    result = useConsumableItem(character, itemIdInput);
    syncInventoryTableForCharacter(world.db, character.id, character.inventory);
    saveCharacter(world.db, character);
  });
  const enriched = world.getCharacter(characterId);
  world.broadcast({
    type: 'CHARACTER_UPDATE',
    character: enriched,
  });
  return {
    ...result,
    character: enriched,
  };
}

export function buyFromShop(world, characterId, itemIdInput, quantityInput = 1) {
  let purchasedItem;
  let qty;
  let totalCost;

  runInTransaction(world.db, () => {
    const character = getCharacterById(world.db, characterId);
    assertCharacterAlive(character);

    if (typeof itemIdInput !== 'string' || !itemIdInput.trim()) {
      throw createAppError(404, 'ITEM_NOT_FOUND', 'ERR_ITEM_NOT_FOUND', 'Item not found in shop.');
    }

    const resolvedId = resolveItemId(itemIdInput);
    if (!resolvedId || !Object.hasOwn(ITEMS, resolvedId)) {
      throw createAppError(
        404,
        'ITEM_NOT_FOUND',
        'ERR_ITEM_NOT_FOUND',
        `Item "${itemIdInput}" not found in shop.`
      );
    }

    const rawQty = quantityInput === undefined ? 1 : quantityInput;
    if (
      typeof rawQty !== 'number' ||
      !Number.isInteger(rawQty) ||
      rawQty < 1 ||
      rawQty > 10000
    ) {
      throw createAppError(
        400,
        'INVALID_QUANTITY',
        'ERR_INVALID_QUANTITY',
        'Quantity must be an integer between 1 and 10000.'
      );
    }

    qty = rawQty;
    purchasedItem = ITEMS[resolvedId];
    totalCost = purchasedItem.price * qty;

    if ((character.gold || 0) < totalCost) {
      throw createAppError(
        400,
        'INSUFFICIENT_GOLD',
        'ERR_INSUFFICIENT_GOLD',
        `Insufficient gold (have ${character.gold}, need ${totalCost}).`
      );
    }

    character.gold -= totalCost;
    addItemToCharacterInventory(character, purchasedItem.id, qty);
    syncInventoryTableForCharacter(world.db, character.id, character.inventory);
    saveCharacter(world.db, character);
  });

  const enriched = world.getCharacter(characterId);
  world.broadcast({
    type: 'CHARACTER_UPDATE',
    character: enriched,
  });

  return {
    item: purchasedItem,
    quantity: qty,
    totalCost,
    character: enriched,
  };
}

export function allocateCharacterTalent(world, characterId, node, points = 1) {
  let res;
  runInTransaction(world.db, () => {
    const character = getCharacterById(world.db, characterId);
    assertCharacterAlive(character);
    const allyCount = world.countZoneAllies(character.currentZoneId, character.id);
    res = allocateTalent(character, node, points, { allyCount });
    saveCharacter(world.db, character);
  });

  const enriched = world.getCharacter(characterId);
  world.broadcast({
    type: 'CHARACTER_UPDATE',
    character: enriched,
  });

  return {
    ...res,
    character: enriched,
  };
}

export function toggleCharacterParty(world, characterId, activeInput) {
  const character = getCharacterById(world.db, characterId);
  assertCharacterAlive(character);

  const nextActive =
    typeof activeInput === 'boolean' ? activeInput : !character.partyActive;
  character.partyActive = nextActive;

  const allyCount = world.countZoneAllies(character.currentZoneId, character.id);
  recalculateCharacterStats(character, { allyCount });
  saveCharacter(world.db, character);

  const enriched = world.getCharacter(character.id);
  world.broadcast({
    type: 'PARTY_UPDATED',
    characterId: enriched.id,
    partyActive: enriched.partyActive,
    partyAuraBonus: enriched.partyAuraBonus,
    partyBonusMultiplier: enriched.partyBonusMultiplier,
    character: enriched,
  });

  return {
    partyActive: enriched.partyActive,
    partyAuraBonus: enriched.partyAuraBonus,
    partyBonusMultiplier: enriched.partyBonusMultiplier,
    allyCount,
    character: enriched,
  };
}

export function acceptCharacterQuest(world, characterId, questIdInput) {
  const res = acceptQuest(world.db, characterId, questIdInput);
  const enriched = world.getCharacter(characterId);
  world.broadcast({
    type: 'QUEST_UPDATED',
    characterId: enriched.id,
    questState: res.questState,
    quests: enriched.quests,
    character: enriched,
  });
  return {
    ...res,
    quests: enriched.quests,
    character: enriched,
  };
}

export function abandonCharacterQuest(world, characterId, questIdInput) {
  const res = abandonQuest(world.db, characterId, questIdInput);
  const enriched = world.getCharacter(characterId);
  world.broadcast({
    type: 'QUEST_UPDATED',
    characterId: enriched.id,
    questState: res.questState,
    quests: enriched.quests,
    character: enriched,
  });
  return {
    ...res,
    quests: enriched.quests,
    character: enriched,
  };
}

export function completeCharacterQuest(world, characterId, questIdInput) {
  const currentChar = getCharacterById(world.db, characterId);
  assertCharacterAlive(currentChar);
  const allyCount = world.countZoneAllies(currentChar.currentZoneId, currentChar.id);

  const res = completeQuest(world.db, characterId, questIdInput, { allyCount });
  const enriched = world.getCharacter(characterId);

  if (res.leveledUp) {
    const lvMsg = `⚡ LEVEL UP! ${enriched.name} reached Hardcore Level ${enriched.level} (+3 Talent Points, Full HP/MP Restored)!`;
    insertWorldEvent(world.db, {
      eventType: 'LEVEL_UP',
      characterId: enriched.id,
      heroName: enriched.name,
      zoneId: enriched.currentZoneId,
      message: lvMsg,
      payload: { newLevel: enriched.level },
    });
    world.broadcast({
      type: 'LEVEL_UP',
      characterId: enriched.id,
      heroName: enriched.name,
      level: enriched.level,
      message: lvMsg,
      character: enriched,
    });
  }

  world.broadcast({
    type: 'QUEST_UPDATED',
    characterId: enriched.id,
    questState: res.questState,
    quests: enriched.quests,
    character: enriched,
  });

  return {
    ...res,
    quests: enriched.quests,
    character: enriched,
  };
}

export function postChatMessage(world, payload = {}) {
  const characterId = payload.characterId || null;
  let sender = 'Adventurer';
  let zoneId = 'safe_haven';

  if (characterId !== null && characterId !== undefined) {
    if (typeof characterId !== 'string' || !characterId.trim()) {
      throw createAppError(404, 'CHARACTER_NOT_FOUND', 'ERR_CHARACTER_NOT_FOUND', 'Character not found.');
    }
    const char = getCharacterById(world.db, characterId);
    if (!char) {
      throw createAppError(404, 'CHARACTER_NOT_FOUND', 'ERR_CHARACTER_NOT_FOUND', 'Character not found.');
    }
    sender = char.name;
    zoneId = char.currentZoneId;
  } else if (typeof payload.sender === 'string' && payload.sender.trim()) {
    sender = payload.sender.trim();
  } else {
    throw createAppError(404, 'CHARACTER_NOT_FOUND', 'ERR_CHARACTER_NOT_FOUND', 'Character not found.');
  }

  const rawText = payload.message !== undefined ? payload.message : payload.text;
  if (typeof rawText !== 'string') {
    throw createAppError(400, 'EMPTY_MESSAGE', 'ERR_EMPTY_MESSAGE', 'Chat message must be a string.');
  }
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw createAppError(400, 'EMPTY_MESSAGE', 'ERR_EMPTY_MESSAGE', 'Chat message cannot be empty.');
  }

  const channel =
    typeof payload.channel === 'string' && ['global', 'zone', 'party'].includes(payload.channel.toLowerCase())
      ? payload.channel.toLowerCase()
      : 'global';

  const savedMsg = insertChatMessage(world.db, {
    characterId,
    sender,
    channel,
    zoneId,
    messageType: 'chat',
    text: trimmed,
  });

  world.broadcast({
    type: 'chat_message',
    ...savedMsg,
  });

  return savedMsg;
}

export function tickWorld(world, rawTicks = 1) {
  const input = rawTicks === undefined ? 1 : rawTicks;
  if (
    input === null ||
    typeof input === 'boolean' ||
    typeof input === 'object' ||
    typeof input !== 'number' ||
    !Number.isFinite(input) ||
    !Number.isInteger(input) ||
    input < 0 ||
    input > 10000
  ) {
    throw createAppError(
      400,
      'INVALID_TICK_COUNT',
      'ERR_INVALID_TICK_COUNT',
      'Tick count must be a non-negative integer.'
    );
  }

  for (let t = 0; t < input; t += 1) {
    world.tickCount += 1;
    for (let i = 0; i < world.simulatedAdventurers.length; i += 1) {
      const adv = world.simulatedAdventurers[i];
      const step = (world.tickCount + i) % 4;
      if (step === 0) adv.x = Math.min(10, adv.x + 1);
      else if (step === 1) adv.y = Math.min(8, adv.y + 1);
      else if (step === 2) adv.x = Math.max(1, adv.x - 1);
      else adv.y = Math.max(1, adv.y - 1);
    }
  }

  return {
    ticksAdvanced: input,
    tickCount: world.tickCount,
    simulatedAdventurers: world.simulatedAdventurers,
  };
}

export function debugPatchState(world, payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createAppError(400, 'INVALID_INPUT', 'ERR_INVALID_INPUT', 'Debug state payload must be an object.');
  }

  const characterId = payload.characterId || payload.id;
  if (typeof characterId !== 'string' || !characterId.trim()) {
    throw createAppError(404, 'CHARACTER_NOT_FOUND', 'ERR_CHARACTER_NOT_FOUND', 'Character not found.');
  }

  const character = getCharacterById(world.db, characterId);
  if (!character) {
    throw createAppError(404, 'CHARACTER_NOT_FOUND', 'ERR_CHARACTER_NOT_FOUND', 'Character not found.');
  }

  runInTransaction(world.db, () => {
    if (typeof payload.level === 'number' && Number.isFinite(payload.level)) {
      character.level = Math.max(1, Math.min(20, Math.floor(payload.level)));
      character.xpToNextLevel = xpToNextLevel(character.level);
      character.unlockedSkills = getUnlockedSkills(character.classId, character.level);
      const allyCount = world.countZoneAllies(character.currentZoneId, character.id);
      recalculateCharacterStats(character, { allyCount, fullRestore: true });
    }

    if (typeof payload.xp === 'number' && Number.isFinite(payload.xp)) {
      character.xp = Math.max(0, Math.floor(payload.xp));
    }
    if (typeof payload.maxHp === 'number' && Number.isFinite(payload.maxHp)) {
      character.maxHp = Math.max(1, Math.floor(payload.maxHp));
    }
    if (typeof payload.hp === 'number' && Number.isFinite(payload.hp)) {
      character.hp = Math.max(0, Math.floor(payload.hp));
    }
    if (typeof payload.maxMp === 'number' && Number.isFinite(payload.maxMp)) {
      character.maxMp = Math.max(1, Math.floor(payload.maxMp));
    }
    if (typeof payload.mp === 'number' && Number.isFinite(payload.mp)) {
      character.mp = Math.max(0, Math.floor(payload.mp));
    }
    if (typeof payload.attack === 'number' && Number.isFinite(payload.attack)) {
      character.attack = Math.max(1, Math.floor(payload.attack));
    }
    if (typeof payload.defense === 'number' && Number.isFinite(payload.defense)) {
      character.defense = Math.max(0, Math.floor(payload.defense));
    }
    if (typeof payload.speed === 'number' && Number.isFinite(payload.speed)) {
      character.speed = Math.max(1, Math.floor(payload.speed));
    }
    if (typeof payload.gold === 'number' && Number.isFinite(payload.gold)) {
      character.gold = Math.max(0, Math.floor(payload.gold));
    }
    if (typeof payload.killStreak === 'number' && Number.isFinite(payload.killStreak)) {
      character.killStreak = Math.max(0, Math.min(5, Math.floor(payload.killStreak)));
    }
    if (typeof payload.partyActive === 'boolean') {
      character.partyActive = payload.partyActive;
    }
    if (typeof payload.x === 'number' && Number.isFinite(payload.x)) {
      character.x = Math.floor(payload.x);
    }
    if (typeof payload.y === 'number' && Number.isFinite(payload.y)) {
      character.y = Math.floor(payload.y);
    }
    if (payload.talents && typeof payload.talents === 'object') {
      character.talents = { ...character.talents, ...payload.talents };
    }
    if (Array.isArray(payload.inventory)) {
      character.inventory = payload.inventory;
      syncInventoryTableForCharacter(world.db, character.id, character.inventory);
    }
    if (payload.zoneId || payload.currentZoneId) {
      const z = resolveZoneId(payload.zoneId || payload.currentZoneId);
      if (z) {
        character.currentZoneId = z;
        character.zoneId = z;
        progressExploreQuestsForZone(world.db, character.id, z, character.level);
      }
    }

    saveCharacter(world.db, character);
    // Ensure quest locks reflect any seeded level change
    getCharacterQuests(world.db, character.id, character.level);
  });

  const enriched = world.getCharacter(character.id);
  return {
    character: enriched,
  };
}
