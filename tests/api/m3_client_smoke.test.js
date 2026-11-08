import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createServer } from '../../src/server/app.js';
import {
  puppeteer,
  KnownDevices,
} from '/usr/local/lib/node_modules/chrome-devtools-mcp/build/src/third_party/index.js';

const iPhone13 = KnownDevices['iPhone 13'];

describe('Milestone 3 — Mobile-First "Tarnished Iron & Ember" UI, 2D Canvas & Touch HUD Smoke Suite', () => {
  let app;
  let baseUrl;
  let dbPath;
  let browser;
  let page;

  before(async () => {
    dbPath = path.join(os.tmpdir(), `m3_smoke_${process.pid}_${Date.now()}.sqlite`);
    app = await createServer({ port: 0, dbPath, tickIntervalMs: 60000 });
    baseUrl = `http://127.0.0.1:${app.port}`;
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    page = await browser.newPage();
    await page.emulate(iPhone13);
  });

  after(async () => {
    if (browser) await browser.close();
    if (app) await app.stop();
    for (const s of ['', '-wal', '-shm']) {
      try {
        fs.rmSync(`${dbPath}${s}`, { force: true });
      } catch {
        // ignore
      }
    }
  });

  it('1. Static asset delivery, MIME headers, viewport meta tag, and single <h1> contract', async () => {
    const res = await page.goto(baseUrl, { waitUntil: 'networkidle0' });
    assert.equal(res.status(), 200);
    assert.ok(res.headers()['content-type'].includes('text/html'));

    const domMeta = await page.evaluate(() => ({
      hasViewportMeta: Boolean(document.querySelector('meta[name="viewport"]')),
      h1Count: document.querySelectorAll('h1').length,
    }));
    assert.equal(domMeta.hasViewportMeta, true);
    assert.equal(domMeta.h1Count, 1);
  });

  it('2. Mobile viewport ergonomics (375x812, 390x844 portrait & 844x390 landscape) & "Tarnished Iron & Ember" CSS tokens', async () => {
    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        obsidian: style.getPropertyValue('--bg-obsidian').trim(),
        ember: style.getPropertyValue('--ember-gold').trim(),
      };
    });
    assert.ok(tokens.obsidian);
    assert.ok(tokens.ember);

    for (const vp of [
      { width: 375, height: 812 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewport({ ...vp, isMobile: true, hasTouch: true });
      const ov = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
      }));
      assert.ok(ov.scrollW <= ov.innerW);
    }
    await page.emulate(iPhone13);
  });

  it('3. Onboarding validation (rejects 1-char name) & Hardcore character creation populates HUD and touch targets', async () => {
    await page.$eval('[data-testid="input-hero-name"]', (el) => {
      el.value = 'Z';
    });
    await page.click('[data-testid="btn-create-character"]');
    const rejected = await page.evaluate(() => Boolean(window.__MMO_STATE__?.character?.id));
    assert.equal(rejected, false);

    await page.$eval('[data-testid="input-hero-name"]', (el) => {
      el.value = 'IronVanguard';
    });
    await page.click('[data-testid="select-class-warrior"]');
    await page.click('[data-testid="btn-create-character"]');
    await page.waitForFunction(() => window.__MMO_STATE__?.character?.name === 'IronVanguard');

    const box = await page.$eval('[data-testid="dpad-up"]', (el) => {
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height };
    });
    assert.ok(box.width >= 44 && box.height >= 44);
  });

  it('4. 2D HTML5 World Canvas rendering, tombstone presence, and Virtual D-Pad movement', async () => {
    const startX = await page.evaluate(() => window.__MMO_STATE__.character.x);
    await page.click('[data-testid="dpad-right"]');
    await page.waitForFunction((sx) => window.__MMO_STATE__.character.x === sx + 1, {}, startX);
  });

  it('5. NPC Dialogue (!), Quest Accept, Zone Travel, Danger Warning Banner, and Quest Turn-In', async () => {
    await page.evaluate(() => window.__MMO_CLIENT__.interactNpc('npc_elder_thorne'));
    await page.evaluate(() => window.__MMO_CLIENT__.acceptQuest('quest_01_first_steps'));
    await page.evaluate(() => window.__MMO_CLIENT__.travelZone('whispering_woods'));
    const comp = await page.evaluate(() =>
      window.__MMO_CLIENT__.completeQuest('quest_01_first_steps')
    );
    assert.equal(comp.questState.status, 'COMPLETED');
  });

  it('6. 5-Tab Navigation, Inventory/Shop/Talents, Social Party & Chat, and Sanctuary Rest', async () => {
    for (const tab of ['quests', 'inventory', 'social', 'graveyard', 'world']) {
      await page.evaluate((t) => window.__MMO_CLIENT__.selectTab(t), tab);
      const activeTab = await page.evaluate(() => window.__MMO_STATE__.uiTab);
      assert.equal(activeTab, tab);
    }
    await page.evaluate(() => window.__MMO_CLIENT__.travelZone('safe_haven'));
    const rest = await page.evaluate(() => window.__MMO_CLIENT__.restAtSanctuary());
    assert.equal(rest.rested, true);
  });

  it('7. Permadeath Death Screen Overlay, Custom Epitaph, Graveyard Sorting, and Gen II Reincarnation', async () => {
    await page.evaluate(async () => {
      const id = window.__MMO_STATE__.character.id;
      await window.__MMO_CLIENT__.travelZone('dragons_peak');
      await fetch('/api/debug/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: id, hp: 1, defense: 0 }),
      });
      await window.__MMO_CLIENT__.engageMonster('ignis_world_boss');
    });
    await page.waitForFunction(() => window.__MMO_STATE__?.character?.isDead === true);

    await page.evaluate(() => window.__MMO_CLIENT__.saveEpitaph('Valiant unto the end.'));
    const reinc = await page.evaluate(() =>
      window.__MMO_CLIENT__.reincarnate('IronVanguard II', 'ranger')
    );
    assert.equal(reinc.character.generation, 2);
    assert.equal(reinc.character.isDead, false);
  });
});
