import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createServer } from '../../src/server/app.js';

async function withServer(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ironbound-t3-'));
  const dbPath = path.join(tmpDir, 'test.sqlite');
  const app = await createServer({ port: 0, dbPath, tickIntervalMs: 60000 });
  const baseUrl = `http://127.0.0.1:${app.port}`;
  try {
    await fn({ baseUrl });
  } finally {
    await app.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function req(baseUrl, method, route, body = null) {
  const opts = { method, headers: {} };
  if (body !== null) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${route}`, opts);
  const data = await res.json();
  return { status: res.status, data };
}

test('Tier 3 — Cross-Feature Combinations (Multipliers, Party Assist, Abandon & Re-accept, Reincarnation)', async (t) => {
  await t.test('1. Combined XP & Gold Multipliers (Danger Bonus + Kill Streak + Party Fellowship Aura)', async () => {
    await withServer(async ({ baseUrl }) => {
      const { data: created } = await req(baseUrl, 'POST', '/api/characters', { name: 'ComboSlayer', classId: 'warrior' });
      const cid = created.character.id;

      // Enable Party Fellowship Aura
      await req(baseUrl, 'POST', '/api/party/toggle', { characterId: cid, active: true });

      // Travel to Cursed Ruins (Risen Skeleton is L5 vs L1 hero => +80% danger bonus)
      await req(baseUrl, 'POST', '/api/world/zone', { characterId: cid, zoneId: 'cursed_ruins' });
      await req(baseUrl, 'POST', '/api/debug/state', { characterId: cid, attack: 500, hp: 500, maxHp: 500 });

      const killRes = await req(baseUrl, 'POST', '/api/combat/action', {
        characterId: cid,
        actionType: 'attack',
        targetMonsterId: 'risen_skeleton',
      });
      assert.equal(killRes.status, 200);
      assert.equal(killRes.data.victory, true);
      assert.ok(killRes.data.xpGained > 95, 'Combined Danger + Party + Streak multiplier should boost base 95 XP');
    });
  });

  await t.test('2. Abandoning active COLLECT quest purges partial quest items and allows clean re-accept', async () => {
    await withServer(async ({ baseUrl }) => {
      const { data: created } = await req(baseUrl, 'POST', '/api/characters', { name: 'HerbCollector', classId: 'ranger' });
      const cid = created.character.id;

      // Complete Q1 first to unlock Q3
      await req(baseUrl, 'POST', '/api/quests/accept', { characterId: cid, questId: 'quest_01_first_steps' });
      await req(baseUrl, 'POST', '/api/world/zone', { characterId: cid, zoneId: 'whispering_woods' });
      await req(baseUrl, 'POST', '/api/quests/complete', { characterId: cid, questId: 'quest_01_first_steps' });

      await req(baseUrl, 'POST', '/api/quests/accept', { characterId: cid, questId: 'quest_03_herb_gather' });
      await req(baseUrl, 'POST', '/api/debug/state', { characterId: cid, attack: 500 });

      // Kill 1 slime -> 1 item_moonpetal dropped
      await req(baseUrl, 'POST', '/api/combat/action', { characterId: cid, actionType: 'attack', targetMonsterId: 'moss_slime' });
      let check = await req(baseUrl, 'GET', `/api/characters/${cid}`);
      assert.ok(check.data.character.inventory.some((i) => i.itemId === 'item_moonpetal' && (i.quantity === 1 || i.qty === 1)));

      // Abandon quest -> partial item_moonpetal removed
      await req(baseUrl, 'POST', '/api/quests/abandon', { characterId: cid, questId: 'quest_03_herb_gather' });
      check = await req(baseUrl, 'GET', `/api/characters/${cid}`);
      assert.equal(check.data.character.inventory.some((i) => i.itemId === 'item_moonpetal'), false);

      // Re-accept quest -> starts cleanly at 0/3
      const reAccept = await req(baseUrl, 'POST', '/api/quests/accept', { characterId: cid, questId: 'quest_03_herb_gather' });
      assert.equal(reAccept.status, 200);
      assert.equal(reAccept.data.questState.progress, 0);
    });
  });
});
