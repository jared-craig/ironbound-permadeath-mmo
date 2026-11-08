import crypto from 'node:crypto';
import {
  CLASSES,
  ZONES,
  ITEMS,
  QUESTS,
  resolveClassId,
  resolveZoneId,
  resolveItemId,
  getItemById,
} from '../config.js';
import {
  createAppError,
  assertCharacterAlive,
  recalculateCharacterStats,
  getUnlockedSkills,
  xpToNextLevel,
} from '../game/leveling.js';
import {
  combatEquipItem,
  addItemToCharacterInventory,
} from '../game/combat.js';
import { runInTransaction } from './database.js';

function finiteOr(val, fallback = 0) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

export function validateCharacterInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createAppError(400, 'INVALID_INPUT', 'ERR_INVALID_INPUT', 'Character payload must be a JSON object.');
  }

  if (typeof input.name !== 'string') {
    throw createAppError(400, 'INVALID_NAME', 'ERR_INVALID_NAME', 'Hero name must be a string.');
  }

  const trimmedName = input.name.trim();
  if (trimmedName.length < 2 || trimmedName.length > 20) {
    throw createAppError(
      400,
      'INVALID_NAME',
      'ERR_INVALID_NAME',
      'Hero name must be between 2 and 20 characters after trimming.'
    );
  }

  // Reject HTML tags / XSS characters in hero name
  if (/[<>]/.test(trimmedName) || /[\u0000-\u001F\u007F]/.test(trimmedName)) {
    throw createAppError(
      400,
      'INVALID_NAME',
      'ERR_INVALID_NAME',
      'Hero name contains disallowed HTML or control characters.'
    );
  }

  if (typeof input.classId !== 'string') {
    throw createAppError(400, 'INVALID_CLASS', 'ERR_INVALID_CLASS', 'Character classId must be a string.');
  }

  const resolvedClass = resolveClassId(input.classId);
  if (!resolvedClass) {
    throw createAppError(
      400,
      'INVALID_CLASS',
      'ERR_INVALID_CLASS',
      `Invalid classId "${input.classId}". Must be warrior, ranger, or mage.`
    );
  }

  let generation = 1;
  if (input.generation !== undefined && input.generation !== null) {
    if (
      typeof input.generation !== 'number' ||
      !Number.isInteger(input.generation) ||
      input.generation < 1 ||
      input.generation > 10000
    ) {
      throw createAppError(
        400,
        'INVALID_GENERATION',
        'ERR_INVALID_GENERATION',
        'Generation must be an integer between 1 and 10000.'
      );
    }
    generation = input.generation;
  }

  return {
    name: trimmedName,
    classId: resolvedClass,
    generation,
    ancestorId:
      typeof input.ancestorId === 'string'
        ? input.ancestorId
        : typeof input.previousHeroId === 'string'
        ? input.previousHeroId
        : typeof input.reincarnateFromId === 'string'
        ? input.reincarnateFromId
        : null,
  };
}

export function createCharacter(db, input = {}) {
  const validated = validateCharacterInput(input);
  let generation = validated.generation;

  if (validated.ancestorId) {
    const ancestorRow = db
      .prepare('SELECT generation FROM characters WHERE id = ?')
      .get(validated.ancestorId);
    const gyRow = db
      .prepare('SELECT generation FROM graveyard WHERE character_id = ? OR id = ?')
      .get(validated.ancestorId, validated.ancestorId);
    const prevGen = ancestorRow?.generation || gyRow?.generation || 0;
    if (prevGen >= generation) {
      generation = prevGen + 1;
    }
  }

  const classDef = CLASSES[validated.classId];
  const nowIso = new Date().toISOString();
  const id = `hero_${crypto.randomUUID().slice(0, 8)}_${Date.now().toString(36)}`;

  const starterWeaponDef = getItemById(classDef.starterWeaponId);
  const equipment = {
    weapon: starterWeaponDef
      ? {
          itemId: starterWeaponDef.id,
          name: starterWeaponDef.name,
          slot: 'weapon',
          minLevel: starterWeaponDef.minLevel || 1,
          stats: { ...(starterWeaponDef.stats || {}) },
        }
      : null,
    armor: null,
    accessory: null,
  };

  const inventory = [
    {
      itemId: 'health_potion',
      name: ITEMS.health_potion.name,
      type: 'consumable',
      slot: null,
      quantity: 2,
    },
    {
      itemId: 'mana_potion',
      name: ITEMS.mana_potion.name,
      type: 'consumable',
      slot: null,
      quantity: 1,
    },
  ];

  const talents = {
    unspentPoints: 0,
    vitality: 0,
    might: 0,
    swiftness: 0,
  };

  const statsRecord = {
    monstersSlain: 0,
    bossesSlain: 0,
    questsCompleted: 0,
    goldEarned: 50,
  };

  const character = {
    id,
    name: validated.name,
    classId: validated.classId,
    className: classDef.name,
    classTitle: classDef.title,
    passiveName: classDef.passiveName,
    passiveDescription: classDef.passiveDescription,
    level: 1,
    xp: 0,
    xpToNextLevel: xpToNextLevel(1),
    hp: classDef.baseStats.maxHp,
    maxHp: classDef.baseStats.maxHp,
    mp: classDef.baseStats.maxMp,
    maxMp: classDef.baseStats.maxMp,
    attack: classDef.baseStats.attack,
    defense: classDef.baseStats.defense,
    speed: classDef.baseStats.speed,
    critChance: classDef.baseStats.critChance,
    fleeBonus: classDef.fleeBonus || 0,
    gold: 50,
    zoneId: 'safe_haven',
    currentZoneId: 'safe_haven',
    x: ZONES.safe_haven.spawnPoint.x,
    y: ZONES.safe_haven.spawnPoint.y,
    generation,
    killStreak: 0,
    partyActive: false,
    partyAuraBonus: 0,
    partyBonusMultiplier: 1.0,
    isDead: false,
    isHardcore: true,
    permadeathEnabled: true,
    status: 'alive',
    equipment,
    inventory,
    talents,
    statsRecord,
    unlockedSkills: getUnlockedSkills(validated.classId, 1),
    activeCombat: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    diedAt: null,
  };

  recalculateCharacterStats(character, { fullRestore: true });

  runInTransaction(db, () => {
    db.prepare(`
      INSERT INTO characters (
        id, name, class_id, level, xp, hp, max_hp, mp, max_mp,
        attack, defense, speed, crit_chance, flee_bonus, gold,
        zone_id, x, y, generation, kill_streak, party_active,
        is_dead, status, equipment_json, talents_json, stats_record_json,
        active_combat_json, created_at, updated_at, died_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `).run(
      character.id,
      character.name,
      character.classId,
      finiteOr(character.level, 1),
      finiteOr(character.xp, 0),
      finiteOr(character.hp, 100),
      finiteOr(character.maxHp, 100),
      finiteOr(character.mp, 40),
      finiteOr(character.maxMp, 40),
      finiteOr(character.attack, 15),
      finiteOr(character.defense, 8),
      finiteOr(character.speed, 10),
      finiteOr(character.critChance, 0.08),
      finiteOr(character.fleeBonus, 0),
      finiteOr(character.gold, 50),
      character.currentZoneId,
      finiteOr(character.x, 5),
      finiteOr(character.y, 5),
      finiteOr(character.generation, 1),
      finiteOr(character.killStreak, 0),
      character.partyActive ? 1 : 0,
      character.isDead ? 1 : 0,
      character.status,
      JSON.stringify(character.equipment),
      JSON.stringify(character.talents),
      JSON.stringify(character.statsRecord),
      null,
      character.createdAt,
      character.updatedAt,
      null
    );

    syncInventoryTableForCharacter(db, character.id, character.inventory);

    const insertQuest = db.prepare(`
      INSERT INTO quests (
        character_id, quest_id, status, current_count, required_count, accepted_at, completed_at
      ) VALUES (?, ?, ?, 0, ?, NULL, NULL)
    `);
    for (const qDef of Object.values(QUESTS)) {
      const initialStatus =
        !qDef.prerequisiteQuestId && qDef.minLevel <= 1 ? 'AVAILABLE' : 'LOCKED';
      insertQuest.run(character.id, qDef.id, initialStatus, qDef.requiredCount);
    }
  });

  return getCharacterById(db, character.id);
}

export function syncInventoryTableForCharacter(db, characterId, inventoryArray = []) {
  db.prepare('DELETE FROM inventory WHERE character_id = ?').run(characterId);
  const insertInv = db.prepare(`
    INSERT INTO inventory (character_id, item_id, name, type, slot, quantity, stats_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const merged = new Map();
  for (const item of inventoryArray) {
    if (!item) continue;
    const itemId = item.itemId || item.id;
    const qty = Math.floor(finiteOr(item.quantity, 0));
    if (!itemId || qty <= 0) continue;
    if (merged.has(itemId)) {
      merged.get(itemId).quantity += qty;
    } else {
      const def = getItemById(itemId);
      merged.set(itemId, {
        itemId,
        name: item.name || def?.name || itemId,
        type: item.type || def?.type || 'misc',
        slot: item.slot || def?.slot || null,
        quantity: qty,
        stats: item.stats || def?.stats || null,
      });
    }
  }

  for (const entry of merged.values()) {
    insertInv.run(
      characterId,
      entry.itemId,
      entry.name,
      entry.type,
      entry.slot,
      finiteOr(entry.quantity, 1),
      entry.stats ? JSON.stringify(entry.stats) : null
    );
  }
}

export function saveCharacter(db, character) {
  if (!character || !character.id) return null;
  const nowIso = new Date().toISOString();
  character.updatedAt = nowIso;
  const zoneId = resolveZoneId(character.currentZoneId || character.zoneId) || 'safe_haven';
  character.currentZoneId = zoneId;
  character.zoneId = zoneId;

  runInTransaction(db, () => {
    db.prepare(`
      UPDATE characters SET
        name = ?,
        class_id = ?,
        level = ?,
        xp = ?,
        hp = ?,
        max_hp = ?,
        mp = ?,
        max_mp = ?,
        attack = ?,
        defense = ?,
        speed = ?,
        crit_chance = ?,
        flee_bonus = ?,
        gold = ?,
        zone_id = ?,
        x = ?,
        y = ?,
        generation = ?,
        kill_streak = ?,
        party_active = ?,
        is_dead = ?,
        status = ?,
        equipment_json = ?,
        talents_json = ?,
        stats_record_json = ?,
        active_combat_json = ?,
        updated_at = ?,
        died_at = ?
      WHERE id = ?
    `).run(
      String(character.name || 'Hero'),
      String(character.classId || 'warrior'),
      Math.max(1, Math.floor(finiteOr(character.level, 1))),
      Math.max(0, Math.floor(finiteOr(character.xp, 0))),
      Math.max(0, Math.floor(finiteOr(character.hp, 0))),
      Math.max(1, Math.floor(finiteOr(character.maxHp, 100))),
      Math.max(0, Math.floor(finiteOr(character.mp, 0))),
      Math.max(1, Math.floor(finiteOr(character.maxMp, 40))),
      Math.max(1, Math.floor(finiteOr(character.attack, 10))),
      Math.max(0, Math.floor(finiteOr(character.defense, 5))),
      Math.max(1, Math.floor(finiteOr(character.speed, 10))),
      finiteOr(character.critChance, 0.08),
      finiteOr(character.fleeBonus, 0),
      Math.max(0, Math.floor(finiteOr(character.gold, 0))),
      zoneId,
      Math.floor(finiteOr(character.x, 5)),
      Math.floor(finiteOr(character.y, 5)),
      Math.max(1, Math.floor(finiteOr(character.generation, 1))),
      Math.max(0, Math.floor(finiteOr(character.killStreak, 0))),
      character.partyActive ? 1 : 0,
      character.isDead ? 1 : 0,
      character.isDead ? 'fallen' : String(character.status || 'alive'),
      JSON.stringify(character.equipment || { weapon: null, armor: null, accessory: null }),
      JSON.stringify(
        character.talents || { unspentPoints: 0, vitality: 0, might: 0, swiftness: 0 }
      ),
      JSON.stringify(
        character.statsRecord || {
          monstersSlain: 0,
          bossesSlain: 0,
          questsCompleted: 0,
          goldEarned: 0,
        }
      ),
      character.activeCombat ? JSON.stringify(character.activeCombat) : null,
      nowIso,
      character.diedAt || null,
      character.id
    );

    if (Array.isArray(character.inventory)) {
      syncInventoryTableForCharacter(db, character.id, character.inventory);
    }
  });

  return getCharacterById(db, character.id);
}

export function getCharacterQuests(db, characterId, characterLevel = 1) {
  const rows = db
    .prepare('SELECT * FROM quests WHERE character_id = ? ORDER BY quest_id ASC')
    .all(characterId);

  const rowMap = new Map(rows.map((r) => [r.quest_id, r]));
  const completedSet = new Set(
    rows.filter((r) => r.status === 'COMPLETED').map((r) => r.quest_id)
  );

  const result = [];
  for (const qDef of Object.values(QUESTS)) {
    const row = rowMap.get(qDef.id);
    let status = row ? row.status : 'LOCKED';
    const currentCount = row ? Number(row.current_count) : 0;

    // Dynamically unlock LOCKED quests when prereq and minLevel are satisfied (if character is alive)
    if (status === 'LOCKED') {
      const prereqMet =
        !qDef.prerequisiteQuestId || completedSet.has(qDef.prerequisiteQuestId);
      const levelMet = characterLevel >= qDef.minLevel;
      if (prereqMet && levelMet) {
        status = 'AVAILABLE';
        if (row) {
          db.prepare('UPDATE quests SET status = ? WHERE character_id = ? AND quest_id = ?').run(
            'AVAILABLE',
            characterId,
            qDef.id
          );
        }
      }
    }

    result.push({
      questId: qDef.id,
      id: qDef.id,
      title: qDef.title,
      type: qDef.type,
      npcId: qDef.npcId,
      targetZoneId: qDef.targetZoneId,
      targetId: qDef.targetId,
      requiredCount: qDef.requiredCount,
      currentCount,
      minLevel: qDef.minLevel,
      prerequisiteQuestId: qDef.prerequisiteQuestId,
      lethalityRating: qDef.lethalityRating,
      description: qDef.description,
      rewards: qDef.rewards,
      status,
      acceptedAt: row?.accepted_at || null,
      completedAt: row?.completed_at || null,
    });
  }

  return result;
}

export function hydrateCharacterRow(db, row, options = {}) {
  if (!row) return null;
  const classId = resolveClassId(row.class_id) || 'warrior';
  const classDef = CLASSES[classId] || CLASSES.warrior;

  let equipment = { weapon: null, armor: null, accessory: null };
  try {
    equipment = JSON.parse(row.equipment_json || '{}');
  } catch {
    equipment = { weapon: null, armor: null, accessory: null };
  }

  // Ensure equipped items retain canonical stats (including fleeBonus)
  for (const slot of ['weapon', 'armor', 'accessory']) {
    const eq = equipment[slot];
    if (!eq) continue;
    const eqId = typeof eq === 'string' ? eq : eq.itemId || eq.id;
    const itemDef = getItemById(eqId);
    if (itemDef) {
      equipment[slot] = {
        itemId: itemDef.id,
        name: eq.name || itemDef.name,
        slot: itemDef.slot,
        minLevel: itemDef.minLevel || 1,
        stats: { ...(itemDef.stats || {}), ...(eq.stats || {}) },
      };
    }
  }

  let talents = { unspentPoints: 0, vitality: 0, might: 0, swiftness: 0 };
  try {
    talents = { ...talents, ...JSON.parse(row.talents_json || '{}') };
  } catch {
    // keep default
  }

  let statsRecord = {
    monstersSlain: 0,
    bossesSlain: 0,
    questsCompleted: 0,
    goldEarned: 50,
  };
  try {
    statsRecord = { ...statsRecord, ...JSON.parse(row.stats_record_json || '{}') };
  } catch {
    // keep default
  }

  let activeCombat = null;
  if (row.active_combat_json) {
    try {
      activeCombat = JSON.parse(row.active_combat_json);
    } catch {
      activeCombat = null;
    }
  }

  const invRows = db
    .prepare('SELECT * FROM inventory WHERE character_id = ? ORDER BY id ASC')
    .all(row.id);
  const inventory = invRows.map((ir) => {
    const def = getItemById(ir.item_id);
    let stats = undefined;
    if (ir.stats_json) {
      try {
        stats = JSON.parse(ir.stats_json);
      } catch {
        stats = def?.stats;
      }
    } else if (def?.stats) {
      stats = { ...def.stats };
    }
    return {
      itemId: ir.item_id,
      name: ir.name || def?.name || ir.item_id,
      type: ir.type || def?.type || 'misc',
      slot: ir.slot || def?.slot || null,
      quantity: Number(ir.quantity),
      stats,
    };
  });

  const isDead = Boolean(row.is_dead) || row.status === 'fallen' || Number(row.hp) <= 0;
  const character = {
    id: row.id,
    name: row.name,
    classId,
    className: classDef.name,
    classTitle: classDef.title,
    passiveName: classDef.passiveName,
    passiveDescription: classDef.passiveDescription,
    level: Number(row.level),
    xp: Number(row.xp),
    xpToNextLevel: xpToNextLevel(Number(row.level)),
    hp: isDead ? 0 : Number(row.hp),
    maxHp: Number(row.max_hp),
    mp: Number(row.mp),
    maxMp: Number(row.max_mp),
    attack: Number(row.attack),
    defense: Number(row.defense),
    speed: Number(row.speed),
    critChance: Number(row.crit_chance),
    fleeBonus: Number(row.flee_bonus),
    gold: Number(row.gold),
    zoneId: row.zone_id,
    currentZoneId: row.zone_id,
    x: Number(row.x),
    y: Number(row.y),
    generation: Number(row.generation || 1),
    killStreak: Number(row.kill_streak || 0),
    partyActive: Boolean(row.party_active),
    partyAuraBonus: 0,
    partyBonusMultiplier: 1.0,
    isDead,
    isHardcore: true,
    permadeathEnabled: true,
    status: isDead ? 'fallen' : 'alive',
    equipment,
    inventory,
    talents,
    statsRecord,
    unlockedSkills: getUnlockedSkills(classId, Number(row.level)),
    activeCombat: isDead ? null : activeCombat,
    quests: getCharacterQuests(db, row.id, Number(row.level)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    diedAt: row.died_at || null,
  };

  const computed = recalculateCharacterStats({ ...character }, options);
  character.partyAuraBonus = computed.partyAuraBonus;
  character.partyBonusMultiplier = computed.partyBonusMultiplier;
  character.unlockedSkills = computed.unlockedSkills;
  character.xpToNextLevel = computed.xpToNextLevel;
  character.fleeBonus = Math.max(Number(row.flee_bonus || 0), computed.fleeBonus);
  if (!isDead) {
    character.hp = Math.max(1, Math.min(character.maxHp, Number(row.hp)));
    character.mp = Math.max(0, Math.min(character.maxMp, Number(row.mp)));
  } else {
    character.hp = 0;
  }

  return character;
}

export function getCharacterById(db, characterId, options = {}) {
  if (typeof characterId !== 'string' || !characterId.trim()) return null;
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId.trim());
  return hydrateCharacterRow(db, row, options);
}

export function listCharacters(db, filter = {}) {
  let sql = 'SELECT * FROM characters';
  const params = [];
  if (filter.status === 'alive') {
    sql += ' WHERE is_dead = 0 AND status = ?';
    params.push('alive');
  } else if (filter.status === 'fallen' || filter.status === 'dead') {
    sql += ' WHERE is_dead = 1 OR status = ?';
    params.push('fallen');
  }
  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...params);
  return rows.map((r) => hydrateCharacterRow(db, r));
}

export function addItemToInventory(db, characterId, itemIdInput, quantity = 1) {
  return runInTransaction(db, () => {
    const character = getCharacterById(db, characterId);
    assertCharacterAlive(character);
    addItemToCharacterInventory(character, itemIdInput, quantity);
    return saveCharacter(db, character);
  });
}

export function removeItemFromInventory(db, characterId, requestedId, quantity = 1) {
  return runInTransaction(db, () => {
    const character = getCharacterById(db, characterId);
    if (!character) {
      throw createAppError(404, 'CHARACTER_NOT_FOUND', 'ERR_CHARACTER_NOT_FOUND', 'Character not found.');
    }
    const qty = Math.max(1, Math.floor(Number(quantity) || 1));
    const rawKey = String(requestedId || '').trim().toLowerCase();
    const canonicalId = resolveItemId(rawKey) || rawKey;

    let idx = character.inventory.findIndex(
      (e) => e.quantity > 0 && String(e.itemId || e.id).toLowerCase() === rawKey
    );
    if (idx === -1) {
      idx = character.inventory.findIndex(
        (e) =>
          e.quantity > 0 &&
          (resolveItemId(e.itemId || e.id) || String(e.itemId || e.id).toLowerCase()) === canonicalId
      );
    }
    if (idx === -1 || character.inventory[idx].quantity < qty) {
      return false;
    }

    character.inventory[idx].quantity -= qty;
    if (character.inventory[idx].quantity <= 0) {
      character.inventory.splice(idx, 1);
    }
    saveCharacter(db, character);
    return true;
  });
}

export function repoEquipItem(db, characterId, itemIdInput, options = {}) {
  return runInTransaction(db, () => {
    const character = getCharacterById(db, characterId, options);
    assertCharacterAlive(character);
    const equipRes = combatEquipItem(character, itemIdInput, options);
    const saved = saveCharacter(db, character);
    return {
      ...equipRes,
      character: saved,
    };
  });
}

export function updateQuestProgress(db, characterId, questId, currentCount, status = null) {
  if (!Object.hasOwn(QUESTS, questId)) return null;
  const qDef = QUESTS[questId];
  const clamped = Math.max(0, Math.min(qDef.requiredCount, Math.floor(finiteOr(currentCount, 0))));
  const nextStatus =
    status || (clamped >= qDef.requiredCount ? 'READY_TO_TURN_IN' : 'ACTIVE');

  db.prepare(`
    UPDATE quests
    SET current_count = ?, status = ?
    WHERE character_id = ? AND quest_id = ?
  `).run(clamped, nextStatus, characterId, questId);

  return getCharacterQuests(db, characterId);
}

export function recordPermadeath(db, character, deathInfo = {}) {
  return runInTransaction(db, () => {
    const nowIso = new Date().toISOString();
    const slainBy = String(deathInfo.slainBy || 'Unknown Hazard');
    const causeOfDeath = String(deathInfo.causeOfDeath || `Slain by ${slainBy}`);
    const zoneId = resolveZoneId(character.currentZoneId || character.zoneId) || 'whispering_woods';
    const x = Math.floor(finiteOr(character.x, 5));
    const y = Math.floor(finiteOr(character.y, 5));

    character.hp = 0;
    character.isDead = true;
    character.status = 'fallen';
    character.killStreak = 0;
    character.activeCombat = null;
    character.diedAt = nowIso;

    const questRows = db
      .prepare('SELECT * FROM quests WHERE character_id = ? ORDER BY quest_id ASC')
      .all(character.id);

    const completedQuestIds = questRows
      .filter((q) => q.status === 'COMPLETED')
      .map((q) => q.quest_id);

    const activeQuestRow = questRows.find(
      (q) => q.status === 'ACTIVE' || q.status === 'READY_TO_TURN_IN'
    );
    const activeQuestAtDeath = activeQuestRow ? activeQuestRow.quest_id : null;

    // Archive active quests on death without counting them as completed
    db.prepare(`
      UPDATE quests
      SET status = 'ARCHIVED_ON_DEATH'
      WHERE character_id = ? AND status IN ('ACTIVE', 'READY_TO_TURN_IN')
    `).run(character.id);

    const questsCompletedCount = completedQuestIds.length;
    if (!character.statsRecord) {
      character.statsRecord = { monstersSlain: 0, bossesSlain: 0, questsCompleted: 0, goldEarned: 0 };
    }
    character.statsRecord.questsCompleted = questsCompletedCount;

    saveCharacter(db, character);

    const defaultEpitaph = `Fell at Level ${character.level} in ${
      ZONES[zoneId]?.name || zoneId
    } — ${causeOfDeath}.`;

    const graveyardId = `gy_${character.id}`;
    db.prepare(`
      INSERT OR REPLACE INTO graveyard (
        id, character_id, name, class_id, level, generation, zone_id, x, y,
        slain_by, cause_of_death, epitaph, quests_completed,
        completed_quest_ids_json, active_quest_at_death,
        monsters_slain, gold_earned, died_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      graveyardId,
      character.id,
      character.name,
      character.classId,
      character.level,
      character.generation || 1,
      zoneId,
      x,
      y,
      slainBy,
      causeOfDeath,
      defaultEpitaph,
      questsCompletedCount,
      JSON.stringify(completedQuestIds),
      activeQuestAtDeath,
      character.statsRecord?.monstersSlain || 0,
      character.statsRecord?.goldEarned || character.gold || 0,
      nowIso
    );

    const tombstoneId = `tomb_${character.id}`;
    db.prepare(`
      INSERT OR REPLACE INTO tombstones (
        id, character_id, hero_name, class_id, level, generation,
        zone_id, x, y, slain_by, epitaph, died_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tombstoneId,
      character.id,
      character.name,
      character.classId,
      character.level,
      character.generation || 1,
      zoneId,
      x,
      y,
      slainBy,
      defaultEpitaph,
      nowIso
    );

    const hydrated = getCharacterById(db, character.id);
    const graveyardEntry = getGraveyardEntryByHeroId(db, character.id);
    const tombstone = db
      .prepare('SELECT * FROM tombstones WHERE character_id = ?')
      .get(character.id);

    return {
      character: hydrated,
      graveyardEntry,
      tombstone: formatTombstoneRow(tombstone),
    };
  });
}

function formatGraveyardRow(row) {
  if (!row) return null;
  let completedQuestIds = [];
  try {
    completedQuestIds = JSON.parse(row.completed_quest_ids_json || '[]');
  } catch {
    completedQuestIds = [];
  }
  return {
    id: row.id,
    characterId: row.character_id,
    heroId: row.character_id,
    name: row.name,
    classId: row.class_id,
    level: Number(row.level),
    generation: Number(row.generation || 1),
    zoneId: row.zone_id,
    zoneName: ZONES[row.zone_id]?.name || row.zone_id,
    x: Number(row.x),
    y: Number(row.y),
    slainBy: row.slain_by,
    causeOfDeath: row.cause_of_death,
    epitaph: row.epitaph,
    questsCompleted: Number(row.quests_completed || completedQuestIds.length),
    completedQuestIds,
    activeQuestAtDeath: row.active_quest_at_death || null,
    monstersSlain: Number(row.monsters_slain || 0),
    goldEarned: Number(row.gold_earned || 0),
    diedAt: row.died_at,
  };
}

function formatTombstoneRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    characterId: row.character_id,
    heroName: row.hero_name,
    name: row.hero_name,
    classId: row.class_id,
    level: Number(row.level),
    generation: Number(row.generation || 1),
    zoneId: row.zone_id,
    x: Number(row.x),
    y: Number(row.y),
    slainBy: row.slain_by,
    epitaph: row.epitaph,
    diedAt: row.died_at,
  };
}

export function getGraveyardEntryByHeroId(db, heroId) {
  if (typeof heroId !== 'string' || !heroId.trim()) return null;
  const key = heroId.trim();
  const row = db
    .prepare('SELECT * FROM graveyard WHERE character_id = ? OR id = ?')
    .get(key, key);
  return formatGraveyardRow(row);
}

export function listGraveyard(db, options = {}) {
  const sort = String(options.sort || 'level').trim().toLowerCase();
  let orderClause = 'level DESC, quests_completed DESC, died_at DESC';
  if (sort === 'quests' || sort === 'questscompleted' || sort === 'quests_completed') {
    orderClause = 'quests_completed DESC, level DESC, died_at DESC';
  } else if (sort === 'recent' || sort === 'diedat' || sort === 'died_at' || sort === 'date') {
    orderClause = 'died_at DESC, level DESC';
  }

  let limit = 50;
  if (options.limit !== undefined && options.limit !== null) {
    const parsed = Number(options.limit);
    if (Number.isFinite(parsed) && parsed >= 1) {
      limit = Math.min(200, Math.floor(parsed));
    }
  }

  const rows = db
    .prepare(`SELECT * FROM graveyard ORDER BY ${orderClause} LIMIT ?`)
    .all(limit);
  return rows.map(formatGraveyardRow);
}

export function updateEpitaph(db, heroId, epitaphInput) {
  if (typeof heroId !== 'string' || !heroId.trim()) {
    throw createAppError(404, 'NOT_FOUND', 'ERR_NOT_FOUND', 'Graveyard hero not found.');
  }
  if (typeof epitaphInput !== 'string') {
    throw createAppError(
      400,
      'INVALID_EPITAPH',
      'ERR_INVALID_EPITAPH',
      'Epitaph must be a string.'
    );
  }

  const trimmed = epitaphInput.trim().slice(0, 80);
  if (!trimmed) {
    throw createAppError(
      400,
      'INVALID_EPITAPH',
      'ERR_INVALID_EPITAPH',
      'Epitaph cannot be empty.'
    );
  }

  const existing = getGraveyardEntryByHeroId(db, heroId);
  if (!existing) {
    throw createAppError(
      404,
      'NOT_FOUND',
      'ERR_NOT_FOUND',
      `Fallen hero "${heroId}" not found in graveyard.`
    );
  }

  runInTransaction(db, () => {
    db.prepare('UPDATE graveyard SET epitaph = ? WHERE character_id = ?').run(
      trimmed,
      existing.characterId
    );
    db.prepare('UPDATE tombstones SET epitaph = ? WHERE character_id = ?').run(
      trimmed,
      existing.characterId
    );
  });

  return getGraveyardEntryByHeroId(db, existing.characterId);
}

export function listTombstones(db, zoneId = null) {
  if (zoneId) {
    const resolved = resolveZoneId(zoneId) || zoneId;
    const rows = db
      .prepare('SELECT * FROM tombstones WHERE zone_id = ? ORDER BY died_at DESC')
      .all(resolved);
    return rows.map(formatTombstoneRow);
  }
  const rows = db.prepare('SELECT * FROM tombstones ORDER BY died_at DESC').all();
  return rows.map(formatTombstoneRow);
}

export function insertChatMessage(db, msg) {
  const id = msg.id || `chat_${crypto.randomUUID().slice(0, 8)}_${Date.now()}`;
  const createdAt = msg.createdAt || new Date().toISOString();
  db.prepare(`
    INSERT INTO chat_messages (
      id, character_id, sender, channel, zone_id, message_type, text, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    msg.characterId || null,
    String(msg.sender || 'System'),
    String(msg.channel || 'global'),
    msg.zoneId || null,
    String(msg.messageType || 'chat'),
    String(msg.text || ''),
    createdAt
  );
  return {
    id,
    characterId: msg.characterId || null,
    sender: String(msg.sender || 'System'),
    channel: String(msg.channel || 'global'),
    zoneId: msg.zoneId || null,
    messageType: String(msg.messageType || 'chat'),
    text: String(msg.text || ''),
    message: String(msg.text || ''),
    createdAt,
  };
}

export function listChatMessages(db, limit = 50) {
  const lim = Math.max(1, Math.min(200, Math.floor(finiteOr(limit, 50))));
  const rows = db
    .prepare('SELECT * FROM chat_messages ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(lim)
    .reverse();
  return rows.map((r) => ({
    id: r.id,
    characterId: r.character_id,
    sender: r.sender,
    channel: r.channel,
    zoneId: r.zone_id,
    messageType: r.message_type,
    text: r.text,
    message: r.text,
    createdAt: r.created_at,
  }));
}

export function insertWorldEvent(db, evt) {
  const id = evt.id || `evt_${crypto.randomUUID().slice(0, 8)}_${Date.now()}`;
  const createdAt = evt.createdAt || new Date().toISOString();
  db.prepare(`
    INSERT INTO world_events (
      id, event_type, character_id, hero_name, zone_id, message, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    String(evt.eventType || 'INFO'),
    evt.characterId || null,
    evt.heroName || null,
    evt.zoneId || null,
    String(evt.message || ''),
    JSON.stringify(evt.payload || {}),
    createdAt
  );
  return {
    id,
    eventType: String(evt.eventType || 'INFO'),
    characterId: evt.characterId || null,
    heroName: evt.heroName || null,
    zoneId: evt.zoneId || null,
    message: String(evt.message || ''),
    payload: evt.payload || {},
    createdAt,
  };
}

export function listWorldEvents(db, limit = 30) {
  const lim = Math.max(1, Math.min(100, Math.floor(finiteOr(limit, 30))));
  const rows = db
    .prepare('SELECT * FROM world_events ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(lim);
  return rows.map((r) => {
    let payload = {};
    try {
      payload = JSON.parse(r.payload_json || '{}');
    } catch {
      payload = {};
    }
    return {
      id: r.id,
      eventType: r.event_type,
      characterId: r.character_id,
      heroName: r.hero_name,
      zoneId: r.zone_id,
      message: r.message,
      payload,
      createdAt: r.created_at,
    };
  });
}
