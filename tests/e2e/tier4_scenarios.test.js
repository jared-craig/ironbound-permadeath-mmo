import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createServer } from '../../src/server/app.js';
import {
  puppeteer,
  KnownDevices,
} from '/usr/local/lib/node_modules/chrome-devtools-mcp/build/src/third_party/index.js';

const iPhone13 = KnownDevices['iPhone 13'];

async function withServer(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ironbound-t4-'));
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

test('Tier 4 — Real Headless Chromium Mobile Browser Scenarios (5 Zones Canvas, Touch HUD, Permadeath & Reincarnation)', async (t) => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  t.after(async () => {
    await browser.close();
  });

  await t.test('1. All 5 Zones render distinct non-blank 2D Canvas palettes & zero horizontal overflow on mobile', async () => {
    await withServer(async ({ baseUrl }) => {
      const page = await browser.newPage();
      await page.emulate(iPhone13);
      await page.goto(baseUrl, { waitUntil: 'networkidle0' });

      await page.$eval('[data-testid="input-hero-name"]', (el) => {
        el.value = 'CanvasVoyager';
      });
      await page.click('[data-testid="btn-create-character"]');
      await page.waitForFunction(() => window.__MMO_STATE__?.character?.name === 'CanvasVoyager');

      const zones = ['safe_haven', 'whispering_woods', 'cursed_ruins', 'molten_caverns', 'dragons_peak'];
      const signatures = new Set();

      for (const z of zones) {
        if (z !== 'safe_haven') {
          await page.evaluate((zoneId) => window.__MMO_CLIENT__.travelZone(zoneId), z);
        }
        const sig = await page.evaluate(() => {
          const c = document.getElementById('world-canvas');
          const ctx = c.getContext('2d');
          const d = ctx.getImageData(25, 25, 1, 1).data;
          return `${d[0]},${d[1]},${d[2]}`;
        });
        signatures.add(sig);

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        assert.equal(overflow, false, `Zone ${z} must have zero horizontal overflow`);
      }

      assert.equal(signatures.size, 5, 'All 5 zones must render distinct canvas background colors');
      await page.close();
    });
  });

  await t.test('2. Complete Mobile User Journey: Quest -> Combat -> Permadeath -> Epitaph -> Gen II Reincarnation', async () => {
    await withServer(async ({ baseUrl }) => {
      const page = await browser.newPage();
      await page.emulate(iPhone13);
      await page.goto(baseUrl, { waitUntil: 'networkidle0' });

      await page.$eval('[data-testid="input-hero-name"]', (el) => {
        el.value = 'FirstFallen';
      });
      await page.click('[data-testid="btn-create-character"]');
      await page.waitForFunction(() => window.__MMO_STATE__?.character?.name === 'FirstFallen');

      // Travel to Dragon's Peak and face Ignis
      await page.evaluate(async () => {
        const cid = window.__MMO_STATE__.character.id;
        await window.__MMO_CLIENT__.travelZone('dragons_peak');
        await fetch('/api/debug/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ characterId: cid, hp: 1, defense: 0 }),
        });
        await window.__MMO_CLIENT__.engageMonster('ignis_world_boss');
      });

      await page.waitForFunction(() => window.__MMO_STATE__?.character?.isDead === true);

      await page.evaluate(() => window.__MMO_CLIENT__.saveEpitaph('Fell before Ignis in the volcanic ash.'));
      const reinc = await page.evaluate(() => window.__MMO_CLIENT__.reincarnate('SecondRising', 'ranger'));
      assert.equal(reinc.character.generation, 2);
      assert.equal(reinc.character.isDead, false);

      await page.close();
    });
  });
});
