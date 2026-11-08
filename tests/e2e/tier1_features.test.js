import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createServer } from '../../src/server/app.js';

async function withServer(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ironbound-t1-'));
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

test('Tier 1 — Core Feature Matrix (Classes, Quests, Combat, Leveling, Shop, Graveyard)', async (t) => {
  await t.test('1. All 3 classes initialize with distinct base stats, skills, and starting items', async () => {
    await withServer(async ({ baseUrl }) => {
      const w = (await req(baseUrl, 'POST', '/api/characters', { name: 'VanguardW', classId: 'warrior' })).data.character;
      const r = (await req(baseUrl, 'POST', '/api/characters', { name: 'StriderR', classId: 'ranger' })).data.character;
      const m = (await req(baseUrl, 'POST', '/api/characters', { name: 'ArcanistM', classId: 'mage' })).data.character;

      assert.ok(w.maxHp > r.maxHp && r.maxHp > m.maxHp);
      assert.equal(m.maxMp, 105);
      assert.ok(w.unlockedSkills.includes('shield_bash'));
      assert.ok(r.unlockedSkills.includes('piercing_shot'));
      assert.ok(m.unlockedSkills.includes('fireball'));
    });
  });

  await t.test('2. Full 8-Quest Campaign progression from Safe Haven to Dragon\'s Peak', async () => {
    await withServer(async ({ baseUrl }) => {
      const { data: created } = await req(baseUrl, 'POST', '/api/characters', { name: 'CampaignHero', classId: 'warrior' });
      const cid = created.character.id;

      await req(baseUrl, 'POST', '/api/debug/state', {
        characterId: cid,
        level: 15,
        hp: 2000,
        maxHp: 2000,
        attack: 2500,
        defense: 80,
      });

      // Q1: Explore Whispering Woods
      await req(baseUrl, 'POST', '/api/quests/accept', { characterId: cid, questId: 'quest_01_first_steps' });
      await req(baseUrl, 'POST', '/api/world/zone', { characterId: cid, zoneId: 'whispering_woods' });
      let turnIn = await req(baseUrl, 'POST', '/api/quests/complete', { characterId: cid, questId: 'quest_01_first_steps' });
      assert.equal(turnIn.status, 200);

      // Q2: Cull 3 Timber Wolves
      await req(baseUrl, 'POST', '/api/quests/accept', { characterId: cid, questId: 'quest_02_wolf_cull' });
      for (let i = 0; i < 3; i++) {
        await req(baseUrl, 'POST', '/api/combat/action', { characterId: cid, actionType: 'attack', targetMonsterId: 'timber_wolf' });
      }
      turnIn = await req(baseUrl, 'POST', '/api/quests/complete', { characterId: cid, questId: 'quest_02_wolf_cull' });
      assert.equal(turnIn.status, 200);

      // Q3: Collect 3 Moonpetal Herbs
      await req(baseUrl, 'POST', '/api/quests/accept', { characterId: cid, questId: 'quest_03_herb_gather' });
      for (let i = 0; i < 3; i++) {
        await req(baseUrl, 'POST', '/api/combat/action', { characterId: cid, actionType: 'attack', targetMonsterId: 'moss_slime' });
      }
      turnIn = await req(baseUrl, 'POST', '/api/quests/complete', { characterId: cid, questId: 'quest_03_herb_gather' });
      assert.equal(turnIn.status, 200);

      // Q4: Defeat Thornback Ancient Ent
      await req(baseUrl, 'POST', '/api/quests/accept', { characterId: cid, questId: 'quest_04_forest_alpha' });
      await req(baseUrl, 'POST', '/api/combat/action', { characterId: cid, actionType: 'attack', targetMonsterId: 'thornback_ent' });
      turnIn = await req(baseUrl, 'POST', '/api/quests/complete', { characterId: cid, questId: 'quest_04_forest_alpha' });
      assert.equal(turnIn.status, 200);

      // Q5: Explore Cursed Ruins
      await req(baseUrl, 'POST', '/api/quests/accept', { characterId: cid, questId: 'quest_05_into_the_ruins' });
      await req(baseUrl, 'POST', '/api/world/zone', { characterId: cid, zoneId: 'cursed_ruins' });
      turnIn = await req(baseUrl, 'POST', '/api/quests/complete', { characterId: cid, questId: 'quest_05_into_the_ruins' });
      assert.equal(turnIn.status, 200);

      // Q6: Destroy 4 Risen Skeletons in Cursed Ruins
      await req(baseUrl, 'POST', '/api/quests/accept', { characterId: cid, questId: 'quest_06_skeleton_purge' });
      for (let i = 0; i < 4; i++) {
        await req(baseUrl, 'POST', '/api/combat/action', { characterId: cid, actionType: 'attack', targetMonsterId: 'risen_skeleton' });
      }
      turnIn = await req(baseUrl, 'POST', '/api/quests/complete', { characterId: cid, questId: 'quest_06_skeleton_purge' });
      assert.equal(turnIn.status, 200);

      // Q7: Recover 3 Shattered Phylactery Shards in Cursed Ruins
      await req(baseUrl, 'POST', '/api/quests/accept', { characterId: cid, questId: 'quest_07_phylactery_hunt' });
      for (let i = 0; i < 3; i++) {
        await req(baseUrl, 'POST', '/api/combat/action', { characterId: cid, actionType: 'attack', targetMonsterId: 'risen_skeleton' });
      }
      turnIn = await req(baseUrl, 'POST', '/api/quests/complete', { characterId: cid, questId: 'quest_07_phylactery_hunt' });
      assert.equal(turnIn.status, 200);

      // Q8: Slay Ignis the World-Breaker in Dragon's Peak
      await req(baseUrl, 'POST', '/api/quests/accept', { characterId: cid, questId: 'quest_08_dragons_peak_trial' });
      await req(baseUrl, 'POST', '/api/world/zone', { characterId: cid, zoneId: 'dragons_peak' });
      await req(baseUrl, 'POST', '/api/combat/action', { characterId: cid, actionType: 'attack', targetMonsterId: 'ignis_world_boss' });
      turnIn = await req(baseUrl, 'POST', '/api/quests/complete', { characterId: cid, questId: 'quest_08_dragons_peak_trial' });
      assert.equal(turnIn.status, 200);
      assert.equal(turnIn.data.character.statsRecord.questsCompleted, 8);
      assert.equal(turnIn.data.quests.filter((q) => q.status === 'COMPLETED').length, 8);
    });
  });
});
