const ZONE_PALETTES = {
  safe_haven: {
    bg: '#1a2e22',
    tileAlt: '#21382a',
    grid: '#2d4c39',
    accent: '#2ebd6b',
  },
  whispering_woods: {
    bg: '#14331d',
    tileAlt: '#193d24',
    grid: '#255433',
    accent: '#4ade80',
  },
  cursed_ruins: {
    bg: '#251c36',
    tileAlt: '#2d2242',
    grid: '#433361',
    accent: '#a855f7',
  },
  molten_caverns: {
    bg: '#3b1712',
    tileAlt: '#471d17',
    grid: '#692a21',
    accent: '#f97316',
  },
  dragons_peak: {
    bg: '#331224',
    tileAlt: '#3f172d',
    grid: '#612345',
    accent: '#ef4444',
  },
};

const state = {
  character: null,
  currentZone: null,
  zones: [],
  quests: [],
  npcs: [],
  monsters: [],
  shopCatalog: [],
  graveyard: [],
  graveyardSort: 'level',
  tombstones: [],
  adventurers: [],
  messages: [],
  worldEvents: [],
  latestTickerMessage:
    '⚡ Welcome to Oakhaven Sanctuary. Permadeath is active: one life, eternal glory.',
  combatSession: null,
  combatLog: ['Ready for adventure in Oakhaven Sanctuary.'],
  uiTab: 'world',
  selectedClassId: 'warrior',
  activeNpcId: null,
  wsConnected: false,
  lastError: null,
  generationCounter: 1,
};

window.__MMO_STATE__ = state;

let ws = null;
let actionQueue = Promise.resolve();

function enqueueAction(fn) {
  const next = actionQueue.then(fn, fn);
  actionQueue = next.catch(() => {});
  return next;
}

function toRoman(num) {
  const n = Math.max(1, Number(num) || 1);
  const map = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let rem = n;
  let out = '';
  for (const [val, sym] of map) {
    while (rem >= val) {
      out += sym;
      rem -= val;
    }
  }
  return out;
}

async function apiFetch(method, url, body = undefined) {
  const opts = {
    method,
    headers: { Accept: 'application/json' },
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = { ok: false, status: res.status, error: 'INVALID_RESPONSE' };
  }
  if (!res.ok) {
    state.lastError = data?.message || data?.error || `HTTP ${res.status}`;
  } else {
    state.lastError = null;
  }
  return { status: res.status, ok: res.ok, data };
}

function applyCharacterPayload(payload) {
  if (!payload || typeof payload !== 'object') return;

  if (payload.character) {
    state.character = payload.character;
    if (Array.isArray(payload.character.quests)) {
      state.quests = payload.character.quests;
    }
    if (payload.character.activeCombat !== undefined) {
      state.combatSession = payload.character.activeCombat;
    }
  }
  if (Array.isArray(payload.quests)) {
    state.quests = payload.quests;
  } else if (Array.isArray(payload.questsCatalog)) {
    state.quests = payload.questsCatalog;
  }

  if (Array.isArray(payload.npcsList)) {
    state.npcs = payload.npcsList;
  } else if (Array.isArray(payload.npcs)) {
    state.npcs = payload.npcs;
  } else if (payload.npcs && typeof payload.npcs === 'object') {
    state.npcs = Object.values(payload.npcs);
  }

  if (Array.isArray(payload.zonesList)) {
    state.zones = payload.zonesList;
  } else if (Array.isArray(payload.zones)) {
    state.zones = payload.zones;
  } else if (payload.zones && typeof payload.zones === 'object') {
    state.zones = Object.values(payload.zones);
  }

  if (Array.isArray(payload.monstersList)) {
    state.monsters = payload.monstersList;
  } else if (Array.isArray(payload.monsters)) {
    state.monsters = payload.monsters;
  } else if (payload.monsters && typeof payload.monsters === 'object') {
    state.monsters = Object.values(payload.monsters);
  }

  if (Array.isArray(payload.shopCatalog)) {
    state.shopCatalog = payload.shopCatalog;
  }
  if (Array.isArray(payload.graveyard)) {
    state.graveyard = payload.graveyard;
  }
  if (Array.isArray(payload.tombstones)) {
    state.tombstones = payload.tombstones;
  }
  if (Array.isArray(payload.adventurers)) {
    state.adventurers = payload.adventurers;
  } else if (Array.isArray(payload.simulatedAdventurers)) {
    state.adventurers = payload.simulatedAdventurers;
  }
  if (Array.isArray(payload.messages)) {
    state.messages = payload.messages;
  } else if (Array.isArray(payload.chatMessages)) {
    state.messages = payload.chatMessages;
  }
  if (Array.isArray(payload.worldEvents) && payload.worldEvents.length > 0) {
    state.worldEvents = payload.worldEvents;
    state.latestTickerMessage =
      payload.worldEvents[0].message || state.latestTickerMessage;
  }
  if (payload.combatSession !== undefined) {
    state.combatSession = payload.combatSession;
  }
  if (Array.isArray(payload.combatLog) && payload.combatLog.length > 0) {
    state.combatLog = payload.combatLog;
  }

  if (payload.currentZone) {
    state.currentZone = payload.currentZone;
  } else if (payload.zone) {
    state.currentZone = payload.zone;
  } else if (state.character && state.zones.length > 0) {
    const foundZone = state.zones.find(
      (z) => z.id === (state.character.currentZoneId || state.character.zoneId)
    );
    if (foundZone) state.currentZone = foundZone;
  } else if (!state.currentZone && state.zones.length > 0) {
    state.currentZone = state.zones[0];
  }

  renderAll();
}

function connectWebSocket() {
  try {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      if (state.character?.id && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'AUTH', characterId: state.character.id }));
      }
      return;
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const charQuery = state.character?.id
      ? `?characterId=${encodeURIComponent(state.character.id)}`
      : '';
    ws = new WebSocket(`${proto}//${window.location.host}/ws${charQuery}`);

    ws.addEventListener('open', () => {
      state.wsConnected = true;
      if (state.character?.id) {
        ws.send(JSON.stringify({ type: 'AUTH', characterId: state.character.id }));
      }
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'world_snapshot') {
        applyCharacterPayload(msg);
        return;
      }

      if (msg.type === 'chat_message') {
        const exists = state.messages.some((m) => m.id && m.id === msg.id);
        if (!exists) {
          state.messages.push(msg);
          if (state.messages.length > 60) state.messages.shift();
        }
        if (msg.messageType === 'death' || String(msg.text || '').includes('☠️')) {
          state.latestTickerMessage = msg.text || msg.message || state.latestTickerMessage;
        }
        renderChat();
        renderTopHud();
        return;
      }

      if (
        msg.type === 'LEVEL_UP' ||
        msg.type === 'BOSS_DEFEATED' ||
        msg.type === 'PLAYER_DIED' ||
        msg.type === 'QUEST_COMPLETED'
      ) {
        if (msg.message) {
          state.latestTickerMessage = msg.message;
        }
        if (msg.type === 'PLAYER_DIED' && msg.graveyardEntry) {
          const exists = state.graveyard.some((g) => g.heroId === msg.graveyardEntry.heroId);
          if (!exists) {
            state.graveyard.unshift(msg.graveyardEntry);
          }
          if (msg.tombstone) {
            state.tombstones.unshift(msg.tombstone);
          }
        }
        renderTopHud();
        renderGraveyard();
        renderWorldCanvas();
      }
    });

    ws.addEventListener('close', () => {
      state.wsConnected = false;
    });
  } catch {
    state.wsConnected = false;
  }
}

// ============================================================================
// DOM Rendering Functions (Strictly XSS-Safe via textContent / DOM APIs)
// ============================================================================

function renderTopHud() {
  const c = state.character;
  const nameEl = document.querySelector('[data-testid="hud-hero-name"]');
  const classEl = document.querySelector('[data-testid="hud-hero-class"]');
  const levelEl = document.querySelector('[data-testid="hud-hero-level"]');
  const genEl = document.querySelector('[data-testid="hud-generation"]');
  const hpText = document.querySelector('[data-testid="hud-hp-text"]');
  const hpBar = document.querySelector('[data-testid="hud-hp-bar"]');
  const mpText = document.querySelector('[data-testid="hud-mp-text"]');
  const mpBar = document.querySelector('[data-testid="hud-mp-bar"]');
  const xpText = document.querySelector('[data-testid="hud-xp-text"]');
  const xpBar = document.querySelector('[data-testid="hud-xp-bar"]');
  const goldEl = document.querySelector('[data-testid="hud-gold"]');
  const streakEl = document.querySelector('[data-testid="hud-kill-streak"]');
  const partyEl = document.querySelector('[data-testid="hud-party-aura"]');
  const zoneEl = document.querySelector('[data-testid="hud-zone-name"]');
  const tickerEl = document.querySelector('[data-testid="world-event-ticker"]');
  const dangerBanner = document.querySelector('[data-testid="zone-danger-warning"]');
  const telegraphBanner = document.querySelector('[data-testid="combat-telegraph-banner"]');

  if (tickerEl) {
    tickerEl.textContent = state.latestTickerMessage;
  }

  if (!c) {
    if (dangerBanner) dangerBanner.hidden = true;
    if (telegraphBanner) telegraphBanner.hidden = true;
    return;
  }

  if (nameEl) nameEl.textContent = c.name;
  if (classEl) classEl.textContent = c.className || c.classId;
  if (levelEl) levelEl.textContent = `Lv. ${c.level}`;
  if (genEl) genEl.textContent = `Gen ${toRoman(c.generation || state.generationCounter)}`;

  const hpPct = c.maxHp > 0 ? Math.max(0, Math.min(100, Math.round((c.hp / c.maxHp) * 100))) : 0;
  if (hpText) hpText.textContent = `${c.hp} / ${c.maxHp}`;
  if (hpBar) hpBar.style.width = `${hpPct}%`;

  const mpPct = c.maxMp > 0 ? Math.max(0, Math.min(100, Math.round((c.mp / c.maxMp) * 100))) : 0;
  if (mpText) mpText.textContent = `${c.mp} / ${c.maxMp}`;
  if (mpBar) mpBar.style.width = `${mpPct}%`;

  const xpNext = c.xpToNextLevel || 100;
  const xpPct = xpNext > 0 ? Math.max(0, Math.min(100, Math.round((c.xp / xpNext) * 100))) : 100;
  if (xpText) xpText.textContent = `${c.xp} / ${xpNext}`;
  if (xpBar) xpBar.style.width = `${xpPct}%`;

  if (goldEl) goldEl.textContent = `🪙 ${c.gold}g`;
  const streakCount = c.killStreak || 0;
  const streakBonusPct = Math.min(25, streakCount * 5);
  if (streakEl) streakEl.textContent = `🔥 Streak ${streakCount} (+${streakBonusPct}%)`;

  const auraPct = Math.round((c.partyAuraBonus || 0) * 100);
  if (partyEl) {
    partyEl.textContent = c.partyActive
      ? `🛡️ Party ON (+${auraPct}%)`
      : '🛡️ Solo (+0%)';
  }

  const z = state.currentZone;
  if (zoneEl && z) {
    zoneEl.textContent = `📍 ${z.name} (Lv.${z.recommendedLevel})`;
  }

  // Zone Danger Warning Banner
  if (dangerBanner) {
    const isDangerous = Boolean(z && z.recommendedLevel > c.level);
    dangerBanner.hidden = !isDangerous;
    if (isDangerous) {
      dangerBanner.textContent = `⚠️ HIGH LETHALITY ZONE: ${z.name} (Recommended Lv.${z.recommendedLevel}) exceeds your Level ${c.level}! Permadeath danger is extreme!`;
    }
  }

  // Combat Telegraph Banner
  if (telegraphBanner) {
    const cs = state.combatSession;
    const isTelegraph = Boolean(
      cs &&
        cs.status === 'active' &&
        (cs.intent === 'telegraph_heavy' || cs.telegraph?.active)
    );
    telegraphBanner.hidden = !isTelegraph;
    if (isTelegraph) {
      telegraphBanner.textContent =
        cs.telegraph?.warning ||
        `🔥 TELEGRAPH WARNING: ${cs.monsterName} is charging a 1.8x Heavy Strike next turn!`;
    }
  }

  // Persistent Quest Tracker HUD
  const trackerCount = document.querySelector('[data-testid="quest-tracker-count"]');
  const trackerItems = document.querySelector('[data-testid="quest-tracker-items"]');
  if (trackerItems) {
    const tracked = (state.quests || []).filter(
      (q) => q.status === 'ACTIVE' || q.readyToTurnIn
    );
    if (trackerCount) {
      trackerCount.textContent = `${tracked.length} Active`;
    }
    trackerItems.replaceChildren();
    if (tracked.length === 0) {
      const span = document.createElement('span');
      span.textContent =
        'No active quests. Speak with Elder Thorne (!) or open Quests tab.';
      trackerItems.appendChild(span);
    } else {
      for (const q of tracked) {
        const row = document.createElement('div');
        row.className = 'tracker-quest-row';

        const label = document.createElement('span');
        const badgeSym = q.readyToTurnIn ? '?' : '⏳';
        label.textContent = `[${badgeSym}] ${q.name}: ${q.progress}/${q.requiredCount}`;
        row.appendChild(label);

        if (q.readyToTurnIn) {
          const turnInBtn = document.createElement('button');
          turnInBtn.type = 'button';
          turnInBtn.className = 'btn-primary';
          turnInBtn.dataset.testid = `tracker-complete-${q.questId}`;
          turnInBtn.textContent = 'Turn In (?)';
          turnInBtn.addEventListener('click', () => {
            window.__MMO_CLIENT__.completeQuest(q.questId);
          });
          row.appendChild(turnInBtn);
        }

        trackerItems.appendChild(row);
      }
    }
  }
}

function renderWorldCanvas() {
  const canvas = document.querySelector('[data-testid="world-canvas"]');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  const zoneId =
    state.currentZone?.id || state.character?.currentZoneId || 'safe_haven';
  const palette = ZONE_PALETTES[zoneId] || ZONE_PALETTES.safe_haven;

  // 1. Base Zone Background Fill (ensures (200, 100) has distinct zone palette color)
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, w, h);

  // 2. Decorative Grid & Accent Tiles (keep (200, 100) pure palette.bg)
  const cols = 12;
  const rows = 8;
  const tileW = w / cols;
  const tileH = h / rows;

  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1;
  for (let gx = 0; gx <= cols; gx += 1) {
    ctx.beginPath();
    ctx.moveTo(gx * tileW, 24);
    ctx.lineTo(gx * tileW, h);
    ctx.stroke();
  }
  for (let gy = 1; gy <= rows; gy += 1) {
    ctx.beginPath();
    ctx.moveTo(0, gy * tileH);
    ctx.lineTo(w, gy * tileH);
    ctx.stroke();
  }

  // Corner terrain highlights
  ctx.fillStyle = palette.tileAlt;
  ctx.fillRect(10, 32, 36, 24);
  ctx.fillRect(w - 50, h - 40, 38, 26);

  // 3. Top Canvas Header Bar
  ctx.fillStyle = '#0d0e11';
  ctx.fillRect(0, 0, w, 24);
  ctx.fillStyle = palette.accent;
  ctx.font = 'bold 11px sans-serif';
  const zName = state.currentZone?.name || 'Oakhaven Sanctuary';
  ctx.fillText(`${zName} [Lv.${state.currentZone?.recommendedLevel || 1}]`, 8, 16);

  // 4. Sanctuary Fountain in safe_haven
  if (zoneId === 'safe_haven') {
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    ctx.arc(85, 95, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#93c5fd';
    ctx.stroke();
  }

  // 5. Fallen Hero Tombstones in Current Zone
  const zoneTombstones = (state.tombstones || []).filter(
    (t) => t.zoneId === zoneId
  );
  for (let i = 0; i < Math.min(zoneTombstones.length, 6); i += 1) {
    const t = zoneTombstones[i];
    const tx = Math.min(w - 24, Math.max(20, (Number(t.x) || 3 + i) * 26));
    const ty = Math.min(h - 24, Math.max(40, (Number(t.y) || 3 + i) * 20));
    ctx.fillStyle = '#9ea4b0';
    ctx.fillRect(tx - 6, ty - 8, 12, 14);
    ctx.fillStyle = '#d63838';
    ctx.fillRect(tx - 2, ty - 5, 4, 4);
  }

  // 6. Zone NPCs with Quest Badges (! / ?)
  const zoneNpcs = (state.npcs || []).filter((n) => n.zoneId === zoneId);
  for (let i = 0; i < zoneNpcs.length; i += 1) {
    const npc = zoneNpcs[i];
    const nx = Math.min(w - 30, Math.max(24, (Number(npc.x) || 4 + i * 2) * 28));
    const ny = Math.min(h - 30, Math.max(42, (Number(npc.y) || 4) * 22));
    ctx.fillStyle = '#e5a93c';
    ctx.beginPath();
    ctx.arc(nx, ny, 8, 0, Math.PI * 2);
    ctx.fill();
    if (npc.badge) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(npc.badge, nx - 3, ny - 11);
    }
  }

  // 7. Zone Monsters
  const zoneMonsters = (state.monsters || []).filter((m) => m.zoneId === zoneId);
  for (let i = 0; i < zoneMonsters.length; i += 1) {
    const mon = zoneMonsters[i];
    const mx = Math.min(w - 30, Math.max(40, 230 + (i % 3) * 38));
    const my = Math.min(h - 28, Math.max(48, 62 + i * 42));
    ctx.fillStyle = mon.isBoss ? '#ef4444' : '#d97706';
    ctx.beginPath();
    ctx.arc(mx, my, mon.isBoss ? 10 : 7, 0, Math.PI * 2);
    ctx.fill();
  }

  // 8. Simulated / Connected Allied Adventurers
  const zoneAllies = (state.adventurers || []).filter((a) => a.zoneId === zoneId);
  for (let i = 0; i < Math.min(zoneAllies.length, 4); i += 1) {
    const ally = zoneAllies[i];
    const ax = Math.min(w - 24, Math.max(24, (Number(ally.x) || 2 + i) * 24));
    const ay = Math.min(h - 24, Math.max(42, (Number(ally.y) || 6) * 22));
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(ax - 5, ay - 5, 10, 10);
  }

  // 9. Active Player Hero Avatar
  if (state.character) {
    const hx = Math.min(
      w - 20,
      Math.max(20, (Number(state.character.x) || 5) * 28)
    );
    const hy = Math.min(
      h - 20,
      Math.max(38, (Number(state.character.y) || 5) * 22)
    );
    ctx.fillStyle = state.character.isDead ? '#ef4444' : '#2ebd6b';
    ctx.beginPath();
    ctx.arc(hx, hy, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f0ece1';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function renderWorldTab() {
  const currentZoneId =
    state.currentZone?.id || state.character?.currentZoneId || 'safe_haven';

  document.querySelectorAll('[data-zone]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.zone === currentZoneId);
  });

  renderWorldCanvas();

  // Zone Monsters List
  const monstersListEl = document.querySelector('[data-testid="zone-monsters-list"]');
  if (monstersListEl) {
    monstersListEl.replaceChildren();
    const zoneMonsters = (state.monsters || []).filter(
      (m) => m.zoneId === currentZoneId
    );
    if (zoneMonsters.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'muted-text';
      empty.textContent = 'Sanctuary grounds — no hostile monsters here.';
      monstersListEl.appendChild(empty);
    } else {
      for (const mon of zoneMonsters) {
        const row = document.createElement('div');
        row.className = 'entity-item';
        row.dataset.testid = `monster-row-${mon.id}`;

        const info = document.createElement('span');
        info.textContent = `${mon.isBoss ? '👑 ' : ''}${mon.name} (Lv.${mon.level} • HP ${mon.hp})`;
        row.appendChild(info);

        const fightBtn = document.createElement('button');
        fightBtn.type = 'button';
        fightBtn.className = 'btn-primary';
        fightBtn.dataset.testid = `btn-fight-${mon.id}`;
        fightBtn.textContent = '⚔️ Fight';
        fightBtn.addEventListener('click', () => {
          window.__MMO_CLIENT__.engageMonster(mon.id);
        });
        row.appendChild(fightBtn);

        monstersListEl.appendChild(row);
      }
    }
  }

  // Zone NPCs List
  const npcsListEl = document.querySelector('[data-testid="zone-npcs-list"]');
  if (npcsListEl) {
    npcsListEl.replaceChildren();
    const zoneNpcs = (state.npcs || []).filter((n) => n.zoneId === currentZoneId);
    for (const npc of zoneNpcs) {
      const row = document.createElement('div');
      row.className = 'entity-item';
      row.dataset.testid = `npc-row-${npc.id}`;

      const info = document.createElement('span');
      const badgeStr = npc.badge ? ` [${npc.badge}]` : '';
      info.textContent = `${npc.name} (${npc.role})${badgeStr}`;
      row.appendChild(info);

      const talkBtn = document.createElement('button');
      talkBtn.type = 'button';
      talkBtn.className = 'btn-secondary';
      talkBtn.dataset.testid = `btn-talk-${npc.id}`;
      talkBtn.textContent = `💬 Talk${badgeStr}`;
      talkBtn.addEventListener('click', () => {
        window.__MMO_CLIENT__.interactNpc(npc.id);
      });
      row.appendChild(talkBtn);

      npcsListEl.appendChild(row);
    }
  }

  // Combat Log
  const logEl = document.querySelector('[data-testid="combat-log"]');
  if (logEl) {
    logEl.replaceChildren();
    for (const line of state.combatLog.slice(-8)) {
      const div = document.createElement('div');
      div.textContent = line;
      logEl.appendChild(div);
    }
  }
}

function renderQuestsTab() {
  const listEl = document.querySelector('[data-testid="quest-list"]');
  const lethalityWarningEl = document.querySelector(
    '[data-testid="quest-lethality-warning"]'
  );
  if (!listEl) return;

  const quests = state.quests || [];
  const hasHighLethality = quests.some((q) =>
    ['HIGH', 'EXTREME', 'LETHAL'].includes(String(q.lethality || '').toUpperCase())
  );
  if (lethalityWarningEl) {
    lethalityWarningEl.hidden = !hasHighLethality;
  }

  listEl.replaceChildren();
  for (const q of quests) {
    const card = document.createElement('div');
    card.className = 'quest-card';
    card.dataset.testid = `quest-card-${q.questId}`;

    const top = document.createElement('div');
    top.className = 'quest-card-top';

    const titleWrap = document.createElement('div');
    const badge = document.createElement('span');
    badge.className = 'quest-badge';
    badge.dataset.testid = `quest-badge-${q.questId}`;
    badge.textContent = q.badge || '!';
    titleWrap.appendChild(badge);

    const title = document.createElement('strong');
    title.textContent = ` ${q.name} (Lv.${q.minLevel} ${q.type})`;
    titleWrap.appendChild(title);
    top.appendChild(titleWrap);

    const leth = document.createElement('span');
    leth.className = 'lethality-tag';
    leth.textContent = `☠️ ${q.lethality}`;
    top.appendChild(leth);

    card.appendChild(top);

    const desc = document.createElement('div');
    desc.className = 'muted-text';
    desc.textContent = q.description;
    card.appendChild(desc);

    const prog = document.createElement('div');
    prog.textContent = `Status: ${q.status} • Progress: ${q.progress}/${q.requiredCount} • Rewards: ${q.rewards?.xp || 0} XP, ${q.rewards?.gold || 0}g`;
    card.appendChild(prog);

    const actions = document.createElement('div');
    actions.className = 'graveyard-sort-row';

    if (q.status === 'AVAILABLE') {
      const acceptBtn = document.createElement('button');
      acceptBtn.type = 'button';
      acceptBtn.className = 'btn-primary';
      acceptBtn.dataset.testid = `btn-accept-${q.questId}`;
      acceptBtn.textContent = '! Accept Quest';
      acceptBtn.addEventListener('click', () => {
        window.__MMO_CLIENT__.acceptQuest(q.questId);
      });
      actions.appendChild(acceptBtn);
    } else if (q.status === 'ACTIVE') {
      if (q.readyToTurnIn) {
        const compBtn = document.createElement('button');
        compBtn.type = 'button';
        compBtn.className = 'btn-primary';
        compBtn.dataset.testid = `btn-complete-${q.questId}`;
        compBtn.textContent = '? Complete Quest';
        compBtn.addEventListener('click', () => {
          window.__MMO_CLIENT__.completeQuest(q.questId);
        });
        actions.appendChild(compBtn);
      }
      const abandonBtn = document.createElement('button');
      abandonBtn.type = 'button';
      abandonBtn.className = 'btn-secondary';
      abandonBtn.dataset.testid = `btn-abandon-${q.questId}`;
      abandonBtn.textContent = 'Abandon';
      abandonBtn.addEventListener('click', () => {
        window.__MMO_CLIENT__.abandonQuest(q.questId);
      });
      actions.appendChild(abandonBtn);
    }

    card.appendChild(actions);
    listEl.appendChild(card);
  }
}

function renderInventoryTab() {
  const c = state.character;
  if (!c) return;

  const wepEl = document.querySelector('[data-testid="equipped-weapon"]');
  const armEl = document.querySelector('[data-testid="equipped-armor"]');
  const accEl = document.querySelector('[data-testid="equipped-accessory"]');
  if (wepEl) wepEl.textContent = `Weapon: ${c.equipment?.weapon || 'None'}`;
  if (armEl) armEl.textContent = `Armor: ${c.equipment?.armor || 'None'}`;
  if (accEl) accEl.textContent = `Accessory: ${c.equipment?.accessory || 'None'}`;

  const unspentEl = document.querySelector('[data-testid="talent-unspent"]');
  const vitRank = document.querySelector('[data-testid="talent-rank-vitality"]');
  const mightRank = document.querySelector('[data-testid="talent-rank-might"]');
  const swiftRank = document.querySelector('[data-testid="talent-rank-swiftness"]');

  if (unspentEl) {
    unspentEl.textContent = `${c.talents?.unspentPoints || 0} Unspent Points`;
  }
  if (vitRank) vitRank.textContent = `${c.talents?.vitality || 0} pts`;
  if (mightRank) mightRank.textContent = `${c.talents?.might || 0} pts`;
  if (swiftRank) swiftRank.textContent = `${c.talents?.swiftness || 0} pts`;

  // Backpack Inventory
  const invListEl = document.querySelector('[data-testid="inventory-list"]');
  if (invListEl) {
    invListEl.replaceChildren();
    const inv = c.inventory || [];
    if (inv.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'muted-text';
      empty.textContent = 'Backpack is empty.';
      invListEl.appendChild(empty);
    } else {
      for (const item of inv) {
        const row = document.createElement('div');
        row.className = 'entity-item';
        row.dataset.testid = `inv-item-${item.itemId}`;

        const label = document.createElement('span');
        label.textContent = `${item.name || item.itemId} x${item.quantity}`;
        row.appendChild(label);

        const btnWrap = document.createElement('div');
        btnWrap.className = 'graveyard-sort-row';

        if (item.type === 'consumable') {
          const useBtn = document.createElement('button');
          useBtn.type = 'button';
          useBtn.className = 'btn-primary';
          useBtn.dataset.testid = `btn-use-${item.itemId}`;
          useBtn.textContent = 'Use';
          useBtn.addEventListener('click', () => {
            window.__MMO_CLIENT__.useItem(item.itemId);
          });
          btnWrap.appendChild(useBtn);
        } else if (item.slot) {
          const eqBtn = document.createElement('button');
          eqBtn.type = 'button';
          eqBtn.className = 'btn-secondary';
          eqBtn.dataset.testid = `btn-equip-${item.itemId}`;
          eqBtn.textContent = item.equipped ? 'Equipped' : 'Equip';
          eqBtn.addEventListener('click', () => {
            window.__MMO_CLIENT__.equipItem(item.itemId);
          });
          btnWrap.appendChild(eqBtn);
        }

        row.appendChild(btnWrap);
        invListEl.appendChild(row);
      }
    }
  }

  // Shop List
  const shopListEl = document.querySelector('[data-testid="shop-list"]');
  if (shopListEl) {
    shopListEl.replaceChildren();
    for (const item of state.shopCatalog || []) {
      const row = document.createElement('div');
      row.className = 'entity-item';
      row.dataset.testid = `shop-item-${item.id}`;

      const label = document.createElement('span');
      label.textContent = `${item.name} (${item.price}g) — ${item.description}`;
      row.appendChild(label);

      const buyBtn = document.createElement('button');
      buyBtn.type = 'button';
      buyBtn.className = 'btn-primary';
      buyBtn.dataset.testid = `btn-buy-${item.id}`;
      buyBtn.textContent = `Buy (${item.price}g)`;
      buyBtn.addEventListener('click', () => {
        window.__MMO_CLIENT__.buyItem(item.id, 1);
      });
      row.appendChild(buyBtn);

      shopListEl.appendChild(row);
    }
  }
}

function renderChat() {
  const chatEl = document.querySelector('[data-testid="chat-messages"]');
  if (!chatEl) return;
  chatEl.replaceChildren();

  for (const m of state.messages || []) {
    const line = document.createElement('div');
    line.className = `chat-line ${m.messageType || m.channel || 'global'}`;
    const sender = m.sender || m.characterName || 'Adventurer';
    const text = m.text || m.message || '';
    line.textContent = `[${(m.channel || 'global').toUpperCase()}] ${sender}: ${text}`;
    chatEl.appendChild(line);
  }
  chatEl.scrollTop = chatEl.scrollHeight;
}

function renderSocialTab() {
  renderChat();

  const advEl = document.querySelector('[data-testid="adventurers-list"]');
  if (advEl) {
    advEl.replaceChildren();
    for (const adv of state.adventurers || []) {
      const row = document.createElement('div');
      row.className = 'entity-item';
      row.textContent = `${adv.name} (Lv.${adv.level} ${adv.className}) — Zone: ${adv.zoneId} • ${adv.activity || 'Adventuring'}`;
      advEl.appendChild(row);
    }
  }
}

function renderGraveyard() {
  const gyEl = document.querySelector('[data-testid="graveyard-list"]');
  if (!gyEl) return;
  gyEl.replaceChildren();

  document.querySelectorAll('[data-sort]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.sort === state.graveyardSort);
  });

  for (const entry of state.graveyard || []) {
    const card = document.createElement('div');
    card.className = 'graveyard-card';
    card.dataset.testid = `graveyard-entry-${entry.heroId}`;

    const header = document.createElement('strong');
    header.textContent = `🪦 ${entry.name} — Lv.${entry.level} ${entry.className || entry.classId} (Gen ${toRoman(entry.generation || 1)})`;
    card.appendChild(header);

    const cause = document.createElement('div');
    cause.className = 'muted-text';
    cause.textContent = `Slain by ${entry.slainBy || entry.causeOfDeath} in ${entry.zoneName || entry.zoneId} • Quests Completed: ${entry.questsCompleted || 0}`;
    card.appendChild(cause);

    const ep = document.createElement('div');
    ep.dataset.testid = `graveyard-epitaph-${entry.heroId}`;
    ep.textContent = `"${entry.epitaph || 'Stood fearless against the darkness.'}"`;
    card.appendChild(ep);

    gyEl.appendChild(card);
  }
}

function renderNpcModal() {
  const modal = document.querySelector('[data-testid="npc-dialogue-modal"]');
  if (!modal) return;

  if (!state.activeNpcId) {
    modal.hidden = true;
    return;
  }

  const npc = (state.npcs || []).find((n) => n.id === state.activeNpcId);
  if (!npc) {
    modal.hidden = true;
    return;
  }

  modal.hidden = false;
  const nameEl = document.querySelector('[data-testid="npc-dialogue-name"]');
  const textEl = document.querySelector('[data-testid="npc-dialogue-text"]');
  const questsEl = document.querySelector('[data-testid="npc-dialogue-quests"]');

  if (nameEl) nameEl.textContent = `${npc.name} — ${npc.role}`;
  if (textEl) textEl.textContent = npc.greeting;

  if (questsEl) {
    questsEl.replaceChildren();
    const npcQuests = (state.quests || []).filter((q) =>
      (npc.questIds || []).includes(q.questId)
    );
    for (const q of npcQuests) {
      const row = document.createElement('div');
      row.className = 'quest-card';

      const title = document.createElement('strong');
      title.textContent = `[${q.badge || '!'}] ${q.name} (${q.status})`;
      row.appendChild(title);

      const desc = document.createElement('div');
      desc.className = 'muted-text';
      desc.textContent = q.description;
      row.appendChild(desc);

      if (q.status === 'AVAILABLE') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-primary';
        btn.dataset.testid = `modal-accept-${q.questId}`;
        btn.textContent = '! Accept Quest';
        btn.addEventListener('click', () => {
          window.__MMO_CLIENT__.acceptQuest(q.questId);
        });
        row.appendChild(btn);
      } else if (q.status === 'ACTIVE' && q.readyToTurnIn) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-primary';
        btn.dataset.testid = `modal-complete-${q.questId}`;
        btn.textContent = '? Complete Quest';
        btn.addEventListener('click', () => {
          window.__MMO_CLIENT__.completeQuest(q.questId);
        });
        row.appendChild(btn);
      }

      questsEl.appendChild(row);
    }
  }
}

function renderModalsAndTabs() {
  // Creation Modal
  const creationModal = document.querySelector(
    '[data-testid="character-creation-modal"]'
  );
  if (creationModal) {
    creationModal.hidden = Boolean(state.character?.id);
  }

  // Death Screen Overlay
  const deathOverlay = document.querySelector(
    '[data-testid="death-screen-overlay"]'
  );
  if (deathOverlay) {
    const isDead = Boolean(state.character?.isDead);
    deathOverlay.hidden = !isDead && state.uiTab !== 'death_preview';
    if (isDead && state.uiTab === 'graveyard' && state._dismissedDeathOverlay) {
      deathOverlay.hidden = true;
    } else if (isDead) {
      deathOverlay.hidden = false;
      const titleEl = document.querySelector('[data-testid="death-hero-title"]');
      const sumEl = document.querySelector('[data-testid="death-summary"]');
      if (titleEl) {
        titleEl.textContent = `${state.character.name} (Lv.${state.character.level}) Has Fallen`;
      }
      if (sumEl) {
        sumEl.textContent = `Slain by ${state.character.slainBy || state.character.causeOfDeath || 'Lethal Monster'} in ${state.currentZone?.name || state.character.currentZoneId}. Permadeath is irreversible.`;
      }
    }
  }

  // Active Tab Panels
  const tabs = ['world', 'quests', 'inventory', 'social', 'graveyard'];
  for (const t of tabs) {
    const panel = document.querySelector(`[data-testid="panel-${t}"]`);
    const navBtn = document.querySelector(`[data-testid="nav-tab-${t}"]`);
    const isActive = state.uiTab === t;
    if (panel) {
      panel.hidden = !isActive;
      panel.classList.toggle('active', isActive);
    }
    if (navBtn) {
      navBtn.classList.toggle('active', isActive);
    }
  }

  renderNpcModal();
}

function renderAll() {
  renderTopHud();
  renderWorldTab();
  renderQuestsTab();
  renderInventoryTab();
  renderSocialTab();
  renderGraveyard();
  renderModalsAndTabs();
}

// ============================================================================
// Client Programmatic Bridge (window.__MMO_CLIENT__)
// ============================================================================

const clientBridge = {
  async refreshState() {
    return enqueueAction(async () => {
      const charQuery = state.character?.id
        ? `?characterId=${encodeURIComponent(state.character.id)}`
        : '';
      const { data } = await apiFetch('GET', `/api/world${charQuery}`);
      if (data && data.ok) {
        applyCharacterPayload(data);
      }
      return data;
    });
  },

  async createCharacter(name, classId = state.selectedClassId, generation = state.generationCounter) {
    return enqueueAction(async () => {
      const rawName = typeof name === 'string' ? name : '';
      const trimmed = rawName.trim();
      const errEl = document.querySelector('[data-testid="creation-error"]');

      if (
        trimmed.length < 2 ||
        trimmed.length > 20 ||
        /[<>]/.test(trimmed) ||
        !/^[A-Za-z0-9 _'-]+$/.test(trimmed)
      ) {
        state.lastError = 'Hero name must be 2–20 alphanumeric characters.';
        if (errEl) {
          errEl.hidden = false;
          errEl.textContent = state.lastError;
        }
        return {
          ok: false,
          status: 400,
          error: 'INVALID_CHARACTER_NAME',
          code: 'ERR_INVALID_NAME',
          message: state.lastError,
        };
      }

      const { ok, data } = await apiFetch('POST', '/api/characters', {
        name: trimmed,
        classId: classId || 'warrior',
        generation: generation || state.generationCounter || 1,
      });

      if (!ok || !data?.character) {
        if (errEl) {
          errEl.hidden = false;
          errEl.textContent = data?.message || 'Failed to create character';
        }
        return data;
      }

      if (errEl) errEl.hidden = true;
      state._dismissedDeathOverlay = false;
      state.character = data.character;
      state.generationCounter = data.character.generation || state.generationCounter;

      const worldSnap = await apiFetch(
        'GET',
        `/api/world?characterId=${encodeURIComponent(data.character.id)}`
      );
      if (worldSnap.data?.ok) {
        applyCharacterPayload(worldSnap.data);
      } else {
        applyCharacterPayload(data);
      }

      connectWebSocket();
      return data;
    });
  },

  async selectTab(tabName) {
    const normalized = String(tabName || 'world').toLowerCase();
    state.uiTab = normalized;
    renderModalsAndTabs();
    renderAll();
    return enqueueAction(async () => {
      state.uiTab = normalized;
      renderModalsAndTabs();
      renderAll();
      return { ok: true, uiTab: state.uiTab };
    });
  },

  async interactNpc(npcId) {
    state.activeNpcId = npcId;
    renderNpcModal();
    return enqueueAction(async () => {
      state.activeNpcId = npcId;
      renderNpcModal();
      return { ok: true, activeNpcId: state.activeNpcId };
    });
  },

  async closeNpcModal() {
    state.activeNpcId = null;
    renderNpcModal();
    return { ok: true };
  },

  async travelZone(zoneId) {
    return enqueueAction(async () => {
      if (!state.character?.id) return { ok: false, error: 'NO_CHARACTER' };
      const { data } = await apiFetch('POST', '/api/world/zone', {
        characterId: state.character.id,
        zoneId,
      });
      if (data?.ok) {
        applyCharacterPayload(data);
      }
      return data;
    });
  },

  async moveDirection(direction) {
    return enqueueAction(async () => {
      if (!state.character?.id) return { ok: false, error: 'NO_CHARACTER' };
      const payload =
        typeof direction === 'object' && direction !== null
          ? { characterId: state.character.id, ...direction }
          : { characterId: state.character.id, direction };
      const { data } = await apiFetch('POST', '/api/world/move', payload);
      if (data?.ok) {
        applyCharacterPayload(data);
      }
      return data;
    });
  },

  async engageMonster(monsterId) {
    return enqueueAction(async () => {
      if (!state.character?.id) return { ok: false, error: 'NO_CHARACTER' };
      const targetId =
        monsterId ||
        state.combatSession?.monsterId ||
        (state.monsters || []).find(
          (m) => m.zoneId === state.character.currentZoneId
        )?.id;
      const { data } = await apiFetch('POST', '/api/combat/action', {
        characterId: state.character.id,
        actionType: 'attack',
        targetMonsterId: targetId,
      });
      if (data?.ok) {
        applyCharacterPayload(data);
        if (data.character?.isDead) {
          const gy = await apiFetch(
            'GET',
            `/api/graveyard?sort=${encodeURIComponent(state.graveyardSort)}`
          );
          if (gy.data?.graveyard) {
            state.graveyard = gy.data.graveyard;
            renderGraveyard();
          }
        }
      }
      return data;
    });
  },

  async useSkill(skillId, monsterId) {
    return enqueueAction(async () => {
      if (!state.character?.id) return { ok: false, error: 'NO_CHARACTER' };
      const chosenSkill =
        skillId ||
        state.character.unlockedSkills?.[0]?.id ||
        'cleave_strike';
      const targetId =
        monsterId ||
        state.combatSession?.monsterId ||
        (state.monsters || []).find(
          (m) => m.zoneId === state.character.currentZoneId
        )?.id;
      const { data } = await apiFetch('POST', '/api/combat/action', {
        characterId: state.character.id,
        actionType: 'skill',
        skillId: chosenSkill,
        targetMonsterId: targetId,
      });
      if (data?.ok) {
        applyCharacterPayload(data);
      }
      return data;
    });
  },

  async usePotion() {
    return enqueueAction(async () => {
      if (!state.character?.id) return { ok: false, error: 'NO_CHARACTER' };
      if (state.combatSession && state.combatSession.status === 'active') {
        const { data } = await apiFetch('POST', '/api/combat/action', {
          characterId: state.character.id,
          actionType: 'potion',
        });
        if (data?.ok) applyCharacterPayload(data);
        return data;
      }
      const { data } = await apiFetch('POST', '/api/inventory/use', {
        characterId: state.character.id,
        itemId: 'health_potion',
      });
      if (data?.ok) applyCharacterPayload(data);
      return data;
    });
  },

  async fleeCombat() {
    return enqueueAction(async () => {
      if (!state.character?.id) return { ok: false, error: 'NO_CHARACTER' };
      const { data } = await apiFetch('POST', '/api/combat/action', {
        characterId: state.character.id,
        actionType: 'flee',
      });
      if (data?.ok) {
        applyCharacterPayload(data);
      }
      return data;
    });
  },

  async restAtSanctuary() {
    return enqueueAction(async () => {
      if (!state.character?.id) return { ok: false, error: 'NO_CHARACTER' };
      const { data } = await apiFetch('POST', '/api/world/rest', {
        characterId: state.character.id,
      });
      if (data?.ok) {
        applyCharacterPayload(data);
      }
      return data;
    });
  },

  async acceptQuest(questId) {
    return enqueueAction(async () => {
      if (!state.character?.id) return { ok: false, error: 'NO_CHARACTER' };
      const { data } = await apiFetch('POST', '/api/quests/accept', {
        characterId: state.character.id,
        questId,
      });
      if (data?.ok) {
        applyCharacterPayload(data);
      }
      return data;
    });
  },

  async completeQuest(questId) {
    return enqueueAction(async () => {
      if (!state.character?.id) return { ok: false, error: 'NO_CHARACTER' };
      const { data } = await apiFetch('POST', '/api/quests/complete', {
        characterId: state.character.id,
        questId,
      });
      if (data?.ok) {
        applyCharacterPayload(data);
      }
      return data;
    });
  },

  async abandonQuest(questId) {
    return enqueueAction(async () => {
      if (!state.character?.id) return { ok: false, error: 'NO_CHARACTER' };
      const { data } = await apiFetch('POST', '/api/quests/abandon', {
        characterId: state.character.id,
        questId,
      });
      if (data?.ok) {
        applyCharacterPayload(data);
      }
      return data;
    });
  },

  async equipItem(itemId) {
    return enqueueAction(async () => {
      if (!state.character?.id) return { ok: false, error: 'NO_CHARACTER' };
      const { data } = await apiFetch('POST', '/api/inventory/equip', {
        characterId: state.character.id,
        itemId,
      });
      if (data?.ok) {
        applyCharacterPayload(data);
      }
      return data;
    });
  },

  async useItem(itemId) {
    return enqueueAction(async () => {
      if (!state.character?.id) return { ok: false, error: 'NO_CHARACTER' };
      const { data } = await apiFetch('POST', '/api/inventory/use', {
        characterId: state.character.id,
        itemId,
      });
      if (data?.ok) {
        applyCharacterPayload(data);
      }
      return data;
    });
  },

  async buyItem(itemId, quantity = 1) {
    return enqueueAction(async () => {
      if (!state.character?.id) return { ok: false, error: 'NO_CHARACTER' };
      const { data } = await apiFetch('POST', '/api/shop/buy', {
        characterId: state.character.id,
        itemId,
        quantity,
      });
      if (data?.ok) {
        applyCharacterPayload(data);
      }
      return data;
    });
  },

  async allocateTalent(node, points = 1) {
    return enqueueAction(async () => {
      if (!state.character?.id) return { ok: false, error: 'NO_CHARACTER' };
      const { data } = await apiFetch('POST', '/api/talents/allocate', {
        characterId: state.character.id,
        node,
        points,
      });
      if (data?.ok) {
        applyCharacterPayload(data);
      }
      return data;
    });
  },

  async toggleParty(active = undefined) {
    return enqueueAction(async () => {
      if (!state.character?.id) return { ok: false, error: 'NO_CHARACTER' };
      const { data } = await apiFetch('POST', '/api/party/toggle', {
        characterId: state.character.id,
        active,
      });
      if (data?.ok) {
        applyCharacterPayload(data);
      }
      return data;
    });
  },

  async sendChat(message, channel = 'global') {
    return enqueueAction(async () => {
      if (!state.character?.id) return { ok: false, error: 'NO_CHARACTER' };
      const { data } = await apiFetch('POST', '/api/chat', {
        characterId: state.character.id,
        message,
        channel,
      });
      if (data?.ok && data.message) {
        const exists = state.messages.some((m) => m.id === data.message.id);
        if (!exists) {
          state.messages.push(data.message);
        }
        renderChat();
      }
      return data;
    });
  },

  async saveEpitaph(epitaph, heroId = state.character?.id) {
    return enqueueAction(async () => {
      if (!heroId) return { ok: false, error: 'NO_HERO_ID' };
      const { data } = await apiFetch(
        'POST',
        `/api/graveyard/${encodeURIComponent(heroId)}/epitaph`,
        { epitaph }
      );
      if (data?.ok && data.entry) {
        const idx = state.graveyard.findIndex((g) => g.heroId === heroId);
        if (idx >= 0) {
          state.graveyard[idx] = data.entry;
        } else {
          state.graveyard.unshift(data.entry);
        }
        const savedMsg = document.querySelector('[data-testid="epitaph-saved-msg"]');
        if (savedMsg) savedMsg.hidden = false;
        renderGraveyard();
      }
      return data;
    });
  },

  async sortGraveyard(sortBy = 'level') {
    return enqueueAction(async () => {
      state.graveyardSort = sortBy;
      const { data } = await apiFetch(
        'GET',
        `/api/graveyard?sort=${encodeURIComponent(sortBy)}`
      );
      if (data?.ok && Array.isArray(data.graveyard)) {
        state.graveyard = data.graveyard;
        renderGraveyard();
      }
      return data;
    });
  },

  async reincarnate(newName = undefined, newClassId = undefined) {
    return enqueueAction(async () => {
      const nextGen = (state.character?.generation || state.generationCounter || 1) + 1;
      state.generationCounter = nextGen;
      const baseName =
        newName ||
        (state.character?.name
          ? `${state.character.name.slice(0, 14)} ${toRoman(nextGen)}`
          : `Ironborn ${toRoman(nextGen)}`);
      const chosenClass =
        newClassId || state.character?.classId || state.selectedClassId || 'warrior';

      const { data } = await apiFetch('POST', '/api/characters', {
        name: baseName,
        classId: chosenClass,
        generation: nextGen,
      });
      if (data?.ok && data.character) {
        state._dismissedDeathOverlay = false;
        state.character = data.character;
        state.uiTab = 'world';
        const worldSnap = await apiFetch(
          'GET',
          `/api/world?characterId=${encodeURIComponent(data.character.id)}`
        );
        if (worldSnap.data?.ok) {
          applyCharacterPayload(worldSnap.data);
        } else {
          applyCharacterPayload(data);
        }
        connectWebSocket();
      }
      return data;
    });
  },
};

window.__MMO_CLIENT__ = clientBridge;

// ============================================================================
// Wire DOM Event Listeners
// ============================================================================

function bindDomEvents() {
  // Class selection cards
  document.querySelectorAll('[data-class]').forEach((card) => {
    card.addEventListener('click', () => {
      state.selectedClassId = card.dataset.class;
      document.querySelectorAll('[data-class]').forEach((c) => {
        c.classList.toggle('selected', c.dataset.class === state.selectedClassId);
      });
    });
  });

  // Create character button
  const createBtn = document.querySelector('[data-testid="btn-create-character"]');
  if (createBtn) {
    createBtn.addEventListener('click', () => {
      const nameInput = document.querySelector('[data-testid="input-hero-name"]');
      clientBridge.createCharacter(nameInput ? nameInput.value : '', state.selectedClassId);
    });
  }

  // Bottom navigation tabs
  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      clientBridge.selectTab(btn.dataset.tab);
    });
  });

  // Quick Zone Travel buttons
  document.querySelectorAll('[data-zone]').forEach((btn) => {
    btn.addEventListener('click', () => {
      clientBridge.travelZone(btn.dataset.zone);
    });
  });

  // Virtual D-Pad
  const dpadMap = {
    'dpad-up': 'up',
    'dpad-down': 'down',
    'dpad-left': 'left',
    'dpad-right': 'right',
  };
  for (const [testId, dir] of Object.entries(dpadMap)) {
    const el = document.querySelector(`[data-testid="${testId}"]`);
    if (el) {
      el.addEventListener('click', () => clientBridge.moveDirection(dir));
    }
  }

  // Action Cluster
  const btnAttack = document.querySelector('[data-testid="btn-action-attack"]');
  if (btnAttack) btnAttack.addEventListener('click', () => clientBridge.engageMonster());

  const btnSkill = document.querySelector('[data-testid="btn-action-skill"]');
  if (btnSkill) btnSkill.addEventListener('click', () => clientBridge.useSkill());

  const btnPotion = document.querySelector('[data-testid="btn-action-potion"]');
  if (btnPotion) btnPotion.addEventListener('click', () => clientBridge.usePotion());

  const btnFlee = document.querySelector('[data-testid="btn-action-flee"]');
  if (btnFlee) btnFlee.addEventListener('click', () => clientBridge.fleeCombat());

  const btnInteract = document.querySelector('[data-testid="btn-action-interact"]');
  if (btnInteract) {
    btnInteract.addEventListener('click', () => {
      const zoneId = state.currentZone?.id || 'safe_haven';
      const firstNpc =
        (state.npcs || []).find((n) => n.zoneId === zoneId) || state.npcs?.[0];
      if (firstNpc) {
        clientBridge.interactNpc(firstNpc.id);
      }
    });
  }

  const btnRest = document.querySelector('[data-testid="btn-action-rest"]');
  if (btnRest) btnRest.addEventListener('click', () => clientBridge.restAtSanctuary());

  // Close NPC Modal
  const closeNpcBtn = document.querySelector('[data-testid="btn-close-npc-modal"]');
  if (closeNpcBtn) {
    closeNpcBtn.addEventListener('click', () => clientBridge.closeNpcModal());
  }

  // Talent allocation buttons
  const vitBtn = document.querySelector('[data-testid="btn-talent-vitality"]');
  if (vitBtn) vitBtn.addEventListener('click', () => clientBridge.allocateTalent('vitality', 1));

  const mightBtn = document.querySelector('[data-testid="btn-talent-might"]');
  if (mightBtn) mightBtn.addEventListener('click', () => clientBridge.allocateTalent('might', 1));

  const swiftBtn = document.querySelector('[data-testid="btn-talent-swiftness"]');
  if (swiftBtn) swiftBtn.addEventListener('click', () => clientBridge.allocateTalent('swiftness', 1));

  // Party Toggle
  const partyBtn = document.querySelector('[data-testid="btn-toggle-party"]');
  if (partyBtn) partyBtn.addEventListener('click', () => clientBridge.toggleParty());

  // Chat Send
  const sendChatBtn = document.querySelector('[data-testid="btn-send-chat"]');
  if (sendChatBtn) {
    sendChatBtn.addEventListener('click', () => {
      const input = document.querySelector('[data-testid="chat-input"]');
      const chan = document.querySelector('[data-testid="chat-channel"]');
      if (input && input.value.trim()) {
        const msg = input.value;
        input.value = '';
        clientBridge.sendChat(msg, chan ? chan.value : 'global');
      }
    });
  }

  // Graveyard Sorting
  document.querySelectorAll('[data-sort]').forEach((btn) => {
    btn.addEventListener('click', () => {
      clientBridge.sortGraveyard(btn.dataset.sort);
    });
  });

  // Death Screen Actions
  const saveEpitaphBtn = document.querySelector('[data-testid="btn-save-epitaph"]');
  if (saveEpitaphBtn) {
    saveEpitaphBtn.addEventListener('click', () => {
      const epInput = document.querySelector('[data-testid="input-death-epitaph"]');
      if (epInput) {
        clientBridge.saveEpitaph(epInput.value);
      }
    });
  }

  const viewGyBtn = document.querySelector('[data-testid="btn-death-view-graveyard"]');
  if (viewGyBtn) {
    viewGyBtn.addEventListener('click', () => {
      state._dismissedDeathOverlay = true;
      clientBridge.selectTab('graveyard');
    });
  }

  const reincarnateBtn = document.querySelector('[data-testid="btn-reincarnate"]');
  if (reincarnateBtn) {
    reincarnateBtn.addEventListener('click', () => {
      clientBridge.reincarnate();
    });
  }
}

async function initApp() {
  bindDomEvents();
  await clientBridge.refreshState();
  connectWebSocket();
}

initApp();
