import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SEEDED_FALLEN_LEGENDS } from '../config.js';

export function initDatabase(dbPath = ':memory:') {
  if (dbPath && dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      class_id TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      hp INTEGER NOT NULL,
      max_hp INTEGER NOT NULL,
      mp INTEGER NOT NULL,
      max_mp INTEGER NOT NULL,
      attack INTEGER NOT NULL,
      defense INTEGER NOT NULL,
      speed INTEGER NOT NULL,
      crit_chance REAL NOT NULL DEFAULT 0.08,
      flee_bonus REAL NOT NULL DEFAULT 0,
      gold INTEGER NOT NULL DEFAULT 50,
      zone_id TEXT NOT NULL DEFAULT 'safe_haven',
      x INTEGER NOT NULL DEFAULT 5,
      y INTEGER NOT NULL DEFAULT 5,
      generation INTEGER NOT NULL DEFAULT 1,
      kill_streak INTEGER NOT NULL DEFAULT 0,
      party_active INTEGER NOT NULL DEFAULT 0,
      is_dead INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'alive',
      equipment_json TEXT NOT NULL DEFAULT '{}',
      talents_json TEXT NOT NULL DEFAULT '{}',
      stats_record_json TEXT NOT NULL DEFAULT '{}',
      active_combat_json TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      died_at TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      slot TEXT DEFAULT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      stats_json TEXT DEFAULT NULL,
      UNIQUE(character_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id TEXT NOT NULL,
      quest_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'LOCKED',
      current_count INTEGER NOT NULL DEFAULT 0,
      required_count INTEGER NOT NULL DEFAULT 1,
      accepted_at TEXT DEFAULT NULL,
      completed_at TEXT DEFAULT NULL,
      UNIQUE(character_id, quest_id)
    );

    CREATE TABLE IF NOT EXISTS graveyard (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      class_id TEXT NOT NULL,
      level INTEGER NOT NULL,
      generation INTEGER NOT NULL DEFAULT 1,
      zone_id TEXT NOT NULL,
      x INTEGER NOT NULL DEFAULT 5,
      y INTEGER NOT NULL DEFAULT 5,
      slain_by TEXT NOT NULL,
      cause_of_death TEXT NOT NULL,
      epitaph TEXT NOT NULL,
      quests_completed INTEGER NOT NULL DEFAULT 0,
      completed_quest_ids_json TEXT NOT NULL DEFAULT '[]',
      active_quest_at_death TEXT DEFAULT NULL,
      monsters_slain INTEGER NOT NULL DEFAULT 0,
      gold_earned INTEGER NOT NULL DEFAULT 0,
      died_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tombstones (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      hero_name TEXT NOT NULL,
      class_id TEXT NOT NULL,
      level INTEGER NOT NULL,
      generation INTEGER NOT NULL DEFAULT 1,
      zone_id TEXT NOT NULL,
      x INTEGER NOT NULL DEFAULT 5,
      y INTEGER NOT NULL DEFAULT 5,
      slain_by TEXT NOT NULL,
      epitaph TEXT NOT NULL,
      died_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      character_id TEXT DEFAULT NULL,
      sender TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'global',
      zone_id TEXT DEFAULT NULL,
      message_type TEXT NOT NULL DEFAULT 'chat',
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      character_id TEXT DEFAULT NULL,
      hero_name TEXT DEFAULT NULL,
      zone_id TEXT DEFAULT NULL,
      message TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);

  seedFallenLegends(db);
  return db;
}

export function runInTransaction(db, fn) {
  const depth = db.__txDepth || 0;
  const savepointName = `sp_${depth}`;
  db.__txDepth = depth + 1;

  if (depth === 0) {
    db.exec('BEGIN IMMEDIATE;');
  } else {
    db.exec(`SAVEPOINT ${savepointName};`);
  }

  try {
    const result = fn();
    if (depth === 0) {
      db.exec('COMMIT;');
    } else {
      db.exec(`RELEASE SAVEPOINT ${savepointName};`);
    }
    return result;
  } catch (err) {
    try {
      if (depth === 0) {
        db.exec('ROLLBACK;');
      } else {
        db.exec(`ROLLBACK TO SAVEPOINT ${savepointName};`);
        db.exec(`RELEASE SAVEPOINT ${savepointName};`);
      }
    } catch {
      // Ignore rollback errors if already rolled back
    }
    throw err;
  } finally {
    db.__txDepth = depth;
  }
}

function seedFallenLegends(db) {
  const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM graveyard').get();
  if (countRow && Number(countRow.cnt) > 0) {
    return;
  }

  const insertGraveyard = db.prepare(`
    INSERT OR IGNORE INTO graveyard (
      id, character_id, name, class_id, level, generation, zone_id, x, y,
      slain_by, cause_of_death, epitaph, quests_completed,
      completed_quest_ids_json, active_quest_at_death,
      monsters_slain, gold_earned, died_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTombstone = db.prepare(`
    INSERT OR IGNORE INTO tombstones (
      id, character_id, hero_name, class_id, level, generation,
      zone_id, x, y, slain_by, epitaph, died_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  runInTransaction(db, () => {
    for (const legend of SEEDED_FALLEN_LEGENDS) {
      insertGraveyard.run(
        `gy_${legend.id}`,
        legend.id,
        legend.name,
        legend.classId,
        legend.level,
        legend.generation,
        legend.zoneId,
        legend.x,
        legend.y,
        legend.slainBy,
        legend.causeOfDeath,
        legend.epitaph,
        legend.questsCompleted,
        JSON.stringify(legend.completedQuestIds || []),
        legend.activeQuestAtDeath || null,
        legend.monstersSlain || 0,
        legend.goldEarned || 0,
        legend.diedAt
      );

      insertTombstone.run(
        `tomb_${legend.id}`,
        legend.id,
        legend.name,
        legend.classId,
        legend.level,
        legend.generation,
        legend.zoneId,
        legend.x,
        legend.y,
        legend.slainBy,
        legend.epitaph,
        legend.diedAt
      );
    }
  });
}
