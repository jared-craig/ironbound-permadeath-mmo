import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createServer } from '../../src/server/app.js';

async function withServer(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ironbound-t5-'));
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

test('Tier 5 — White-Box Adversarial & Security Verification (Prototype Pollution, Path Traversal, Payload Limits, Dead Lockout)', async (t) => {
  await t.test('1. Prototype-chain properties (__proto__, constructor, toString) do not bypass input validation', async () => {
    await withServer(async ({ baseUrl }) => {
      const badClass = await req(baseUrl, 'POST', '/api/characters', { name: 'ProtoHero', classId: 'toString' });
      assert.equal(badClass.status, 400);

      const { data: created } = await req(baseUrl, 'POST', '/api/characters', { name: 'ValidHero', classId: 'warrior' });
      const cid = created.character.id;

      const badZone = await req(baseUrl, 'POST', '/api/world/zone', { characterId: cid, zoneId: '__proto__' });
      assert.equal(badZone.status, 400);

      const badTalent = await req(baseUrl, 'POST', '/api/talents/allocate', { characterId: cid, node: 'constructor', points: 1 });
      assert.equal(badTalent.status, 400);

      const badShop = await req(baseUrl, 'POST', '/api/shop/buy', { characterId: cid, itemId: 'valueOf', quantity: 1 });
      assert.ok([400, 404].includes(badShop.status));
    });
  });

  await t.test('2. Static file server blocks URL-encoded path traversal and non-GET/HEAD methods', async () => {
    await withServer(async ({ baseUrl }) => {
      const trav = await fetch(`${baseUrl}/..%2fpackage.json`);
      assert.equal(trav.status, 403);

      const badHex = await fetch(`${baseUrl}/%E0%A4%A`);
      assert.equal(badHex.status, 400);

      const delStatic = await fetch(`${baseUrl}/styles.css`, { method: 'DELETE' });
      assert.equal(delStatic.status, 405);
    });
  });

  await t.test('3. Request payload > 1MB returns 413 PAYLOAD_TOO_LARGE without crashing server', async () => {
    await withServer(async ({ baseUrl }) => {
      const huge = JSON.stringify({ senderName: 'Hero', text: 'X'.repeat(1024 * 1024 + 512) });
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: huge,
      });
      assert.equal(res.status, 413);
      const body = await res.json();
      assert.ok(['PAYLOAD_TOO_LARGE', 'ERR_PAYLOAD_TOO_LARGE'].includes(body.code || body.error));

      // Server remains healthy afterwards
      const health = await req(baseUrl, 'GET', '/api/health');
      assert.equal(health.status, 200);
    });
  });
});
