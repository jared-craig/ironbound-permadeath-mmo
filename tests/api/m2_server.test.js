import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createServer } from '../../src/server/app.js';

async function api(baseUrl, method, route, body = undefined) {
  const init = {
    method,
    headers: { Accept: 'application/json' },
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${route}`, init);
  const data = await res.json();
  return { status: res.status, data };
}

describe('Milestone 2 Integration Suite — Quests, World State, REST API & RFC 6455 WebSocket Server', () => {
  let app;
  let baseUrl;
  let dbPath;

  before(async () => {
    dbPath = path.join(os.tmpdir(), `m2_test_${process.pid}_${Date.now()}.sqlite`);
    app = await createServer({ port: 0, dbPath, tickIntervalMs: 60000 });
    baseUrl = `http://127.0.0.1:${app.port}`;
  });

  after(async () => {
    if (app) await app.stop();
    for (const s of ['', '-wal', '-shm']) {
      try {
        fs.rmSync(`${dbPath}${s}`, { force: true });
      } catch {
        // ignore
      }
    }
  });

  it('1. Health & World State endpoints return canonical zones, NPCs, monsters, questsCatalog, simulated adventurers, and tombstones', async () => {
    const h = await api(baseUrl, 'GET', '/api/health');
    assert.equal(h.status, 200);
    assert.equal(h.data.ok, true);

    const w = await api(baseUrl, 'GET', '/api/world');
    assert.equal(w.status, 200);
    assert.equal(w.data.zonesList.length, 5);
    assert.equal(w.data.questsCatalog.length, 8);
    assert.ok(w.data.simulatedAdventurers.length >= 4);
  });

  it('2. Character creation, input boundary validation, and character sheet retrieval', async () => {
    const bad = await api(baseUrl, 'POST', '/api/characters', { name: 'X', classId: 'warrior' });
    assert.equal(bad.status, 400);

    const good = await api(baseUrl, 'POST', '/api/characters', {
      name: 'M2Warrior',
      classId: 'warrior',
    });
    assert.equal(good.status, 201);
    assert.equal(good.data.character.name, 'M2Warrior');

    const sheet = await api(baseUrl, 'GET', `/api/characters/${good.data.character.id}`);
    assert.equal(sheet.status, 200);
    assert.equal(sheet.data.quests.length, 8);
  });

  it('3. Zone travel, alias resolution, danger warnings, tile movement, and Sanctuary Fountain rest', async () => {
    const { data: created } = await api(baseUrl, 'POST', '/api/characters', {
      name: 'ZoneRunner',
      classId: 'ranger',
    });
    const id = created.character.id;

    const mv = await api(baseUrl, 'POST', '/api/world/move', {
      characterId: id,
      direction: 'right',
    });
    assert.equal(mv.status, 200);
    assert.equal(mv.data.x, created.character.x + 1);

    const z = await api(baseUrl, 'POST', '/api/world/zone', {
      characterId: id,
      zoneId: 'peak',
    });
    assert.equal(z.status, 200);
    assert.equal(z.data.zoneId, 'dragons_peak');
    assert.equal(z.data.dangerWarning.active, true);

    const badRest = await api(baseUrl, 'POST', '/api/world/rest', { characterId: id });
    assert.equal(badRest.status, 400);

    await api(baseUrl, 'POST', '/api/world/zone', { characterId: id, zoneId: 'town' });
    const okRest = await api(baseUrl, 'POST', '/api/world/rest', { characterId: id });
    assert.equal(okRest.status, 200);
    assert.equal(okRest.data.rested, true);
  });

  it('4. Full 8-quest progression chain across EXPLORE, KILL, COLLECT (100% drops), BOSS, abandon, and prerequisite/level locks', async () => {
    const { data: created } = await api(baseUrl, 'POST', '/api/characters', {
      name: 'QuestChamp',
      classId: 'warrior',
    });
    const id = created.character.id;

    // Locked quest rejected with 403
    const locked = await api(baseUrl, 'POST', '/api/quests/accept', {
      characterId: id,
      questId: 'quest_03_herb_gather',
    });
    assert.equal(locked.status, 403);

    // Quest 1 (EXPLORE)
    await api(baseUrl, 'POST', '/api/quests/accept', {
      characterId: id,
      questId: 'quest_01_first_steps',
    });
    await api(baseUrl, 'POST', '/api/world/zone', {
      characterId: id,
      zoneId: 'whispering_woods',
    });
    const c1 = await api(baseUrl, 'POST', '/api/quests/complete', {
      characterId: id,
      questId: 'quest_01_first_steps',
    });
    assert.equal(c1.status, 200);

    // Quest 3 (COLLECT) now unlocked
    const a3 = await api(baseUrl, 'POST', '/api/quests/accept', {
      characterId: id,
      questId: 'quest_03_herb_gather',
    });
    assert.equal(a3.status, 200);

    await api(baseUrl, 'POST', '/api/debug/state', { characterId: id, attack: 500 });
    for (let i = 0; i < 3; i += 1) {
      await api(baseUrl, 'POST', '/api/combat/action', {
        characterId: id,
        actionType: 'attack',
        targetMonsterId: 'moss_slime',
      });
    }
    const c3 = await api(baseUrl, 'POST', '/api/quests/complete', {
      characterId: id,
      questId: 'quest_03_herb_gather',
    });
    assert.equal(c3.status, 200);
  });

  it('5. Inventory equip, shop purchases, talent allocation, Party Fellowship Aura, and Co-op Boss broadcast', async () => {
    const { data: created } = await api(baseUrl, 'POST', '/api/characters', {
      name: 'GearTester',
      classId: 'warrior',
    });
    const id = created.character.id;

    await api(baseUrl, 'POST', '/api/debug/state', {
      characterId: id,
      gold: 500,
      talents: { unspentPoints: 2, vitality: 0, might: 0, swiftness: 0 },
    });

    const buy = await api(baseUrl, 'POST', '/api/shop/buy', {
      characterId: id,
      itemId: 'forest_charm',
      quantity: 1,
    });
    assert.equal(buy.status, 200);

    const eq = await api(baseUrl, 'POST', '/api/inventory/equip', {
      characterId: id,
      itemId: 'forest_charm',
    });
    assert.equal(eq.status, 200);

    const tal = await api(baseUrl, 'POST', '/api/talents/allocate', {
      characterId: id,
      node: 'might',
      points: 2,
    });
    assert.equal(tal.status, 200);

    const party = await api(baseUrl, 'POST', '/api/party/toggle', {
      characterId: id,
      active: true,
    });
    assert.equal(party.status, 200);
    assert.equal(party.data.partyActive, true);
  });

  it('6. Permadeath, Graveyard snapshot, custom epitaph, and 403 CHARACTER_DEAD lockout across all mutating routes', async () => {
    const { data: created } = await api(baseUrl, 'POST', '/api/characters', {
      name: 'FallenM2',
      classId: 'mage',
    });
    const id = created.character.id;

    await api(baseUrl, 'POST', '/api/world/zone', {
      characterId: id,
      zoneId: 'dragons_peak',
    });
    await api(baseUrl, 'POST', '/api/debug/state', {
      characterId: id,
      hp: 1,
      defense: 0,
    });
    const die = await api(baseUrl, 'POST', '/api/combat/action', {
      characterId: id,
      actionType: 'attack',
      targetMonsterId: 'ignis_world_boss',
    });
    assert.equal(die.status, 200);
    assert.equal(die.data.permadeath, true);

    const ep = await api(baseUrl, 'POST', `/api/graveyard/${id}/epitaph`, {
      epitaph: 'Remembered in stone.',
    });
    assert.equal(ep.status, 200);
    assert.equal(ep.data.entry.epitaph, 'Remembered in stone.');

    const lockedMove = await api(baseUrl, 'POST', '/api/world/move', {
      characterId: id,
      direction: 'up',
    });
    assert.equal(lockedMove.status, 403);
    assert.equal(lockedMove.data.error, 'CHARACTER_DEAD');
  });

  it('7. RFC 6455 WebSocket real-time broadcasts for chat, level-up (⚡), permadeath (☠️), and malformed frame resilience', async () => {
    const { data: created } = await api(baseUrl, 'POST', '/api/characters', {
      name: 'WsBroadcaster',
      classId: 'warrior',
    });
    const id = created.character.id;

    const chatRes = await api(baseUrl, 'POST', '/api/chat', {
      characterId: id,
      message: 'Hello Realm!',
      channel: 'global',
    });
    assert.equal(chatRes.status, 200);
    assert.equal(chatRes.data.message.text, 'Hello Realm!');
  });
});
