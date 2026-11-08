import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createServer } from '../../src/server/app.js';

async function withServer(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ironbound-t2-'));
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

test('Tier 2 — Input Boundaries, Level 20 Cap, Tile Clamping, and Safe Zone Protections', async (t) => {
  await t.test('1. Character name length boundaries and invalid class rejection', async () => {
    await withServer(async ({ baseUrl }) => {
      const tooShort = await req(baseUrl, 'POST', '/api/characters', { name: 'X', classId: 'warrior' });
      assert.equal(tooShort.status, 400);

      const minOk = await req(baseUrl, 'POST', '/api/characters', { name: 'XY', classId: 'warrior' });
      assert.equal(minOk.status, 201);

      const maxOk = await req(baseUrl, 'POST', '/api/characters', { name: 'Abcdefghijklmnop', classId: 'ranger' });
      assert.equal(maxOk.status, 201);

      const tooLong = await req(baseUrl, 'POST', '/api/characters', { name: 'A'.repeat(25), classId: 'ranger' });
      assert.equal(tooLong.status, 400);

      const badClass = await req(baseUrl, 'POST', '/api/characters', { name: 'Hero', classId: 'necromancer' });
      assert.equal(badClass.status, 400);
    });
  });

  await t.test('2. Tile movement clamps strictly within grid bounds and Safe Haven blocks combat', async () => {
    await withServer(async ({ baseUrl }) => {
      const { data: created } = await req(baseUrl, 'POST', '/api/characters', { name: 'GridRunner', classId: 'ranger' });
      const cid = created.character.id;

      for (let i = 0; i < 15; i++) {
        await req(baseUrl, 'POST', '/api/world/move', { characterId: cid, direction: 'left' });
        await req(baseUrl, 'POST', '/api/world/move', { characterId: cid, direction: 'up' });
      }
      let check = await req(baseUrl, 'GET', `/api/characters/${cid}`);
      assert.equal(check.data.character.x, 0);
      assert.equal(check.data.character.y, 0);

      for (let i = 0; i < 15; i++) {
        await req(baseUrl, 'POST', '/api/world/move', { characterId: cid, direction: 'right' });
        await req(baseUrl, 'POST', '/api/world/move', { characterId: cid, direction: 'down' });
      }
      check = await req(baseUrl, 'GET', `/api/characters/${cid}`);
      assert.ok(check.data.character.x >= 9);
      assert.ok(check.data.character.y >= 7);

      const safeCombat = await req(baseUrl, 'POST', '/api/combat/action', { characterId: cid, actionType: 'attack', targetMonsterId: 'timber_wolf' });
      assert.equal(safeCombat.status, 400);
      assert.equal(safeCombat.data.error, 'SAFE_ZONE_NO_COMBAT');
    });
  });

  await t.test('3. Level 20 cap prevents overflow and Epitaph truncates cleanly at 80 characters', async () => {
    await withServer(async ({ baseUrl }) => {
      const { data: created } = await req(baseUrl, 'POST', '/api/characters', { name: 'CapTester', classId: 'mage' });
      const cid = created.character.id;

      await req(baseUrl, 'POST', '/api/debug/state', {
        characterId: cid,
        level: 20,
        xp: 0,
      });
      await req(baseUrl, 'POST', '/api/world/zone', { characterId: cid, zoneId: 'dragons_peak' });
      const sheet = await req(baseUrl, 'GET', `/api/characters/${cid}`);
      assert.equal(sheet.data.character.level, 20);
      assert.equal(sheet.data.character.xp, 0);

      // Trigger permadeath
      await req(baseUrl, 'POST', '/api/debug/state', { characterId: cid, hp: 1, defense: 0 });
      await req(baseUrl, 'POST', '/api/combat/action', { characterId: cid, actionType: 'attack', targetMonsterId: 'ignis_world_boss' });

      const longEpitaph = 'A'.repeat(120);
      const epRes = await req(baseUrl, 'POST', `/api/graveyard/${cid}/epitaph`, { epitaph: longEpitaph });
      assert.equal(epRes.status, 200);
      assert.equal(epRes.data.entry.epitaph.length, 80);
    });
  });
});
