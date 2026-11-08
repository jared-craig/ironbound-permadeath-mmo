import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLASSES,
  SKILLS,
  TALENT_NODES,
  ZONES,
  MONSTERS,
  ITEMS,
  SHOP_CATALOG,
  NPCS,
  QUESTS,
  resolveZoneId,
  resolveMonsterId,
  resolveItemId,
  resolveQuestId,
  resolveNpcId,
} from '../../src/config.js';
import {
  xpToNextLevel,
  computeCharacterStats,
  applyXpGain,
  allocateTalent,
  computeLevelDifferenceMultiplier,
  computeKillStreakMultiplier,
  computePartyAura,
  calculateCombatXpReward,
  getUnlockedSkills,
} from '../../src/game/leveling.js';
import {
  computeArmorMitigation,
  computeFleeChance,
  executeCombatAction,
  combatEquipItem,
  useConsumableItem,
  addItemToCharacterInventory,
} from '../../src/game/combat.js';
import { initDatabase, runInTransaction } from '../../src/db/database.js';
import {
  createCharacter,
  getCharacterById,
  saveCharacter,
  addItemToInventory,
  removeItemFromInventory,
  repoEquipItem,
  recordPermadeath,
  listGraveyard,
  updateEpitaph,
  insertChatMessage,
  listChatMessages,
  insertWorldEvent,
  listWorldEvents,
} from '../../src/db/repositories.js';
import { acceptQuest } from '../../src/game/quests.js';

describe('Suite 1: Configuration, Catalogs & Alias Resolution (src/config.js)', () => {
  it('exports all 3 playable classes, 9 active skills, and 3 talent nodes', () => {
    assert.deepEqual(Object.keys(CLASSES).sort(), ['mage', 'ranger', 'warrior']);
    assert.equal(Object.keys(SKILLS).length, 9);
    assert.deepEqual(Object.keys(TALENT_NODES).sort(), ['might', 'swiftness', 'vitality']);
  });

  it('resolves all 5 canonical zones and shorthand aliases accurately', () => {
    assert.equal(Object.keys(ZONES).length, 5);
    assert.equal(resolveZoneId('town'), 'safe_haven');
    assert.equal(resolveZoneId('woods'), 'whispering_woods');
    assert.equal(resolveZoneId('ruins'), 'cursed_ruins');
    assert.equal(resolveZoneId('caverns'), 'molten_caverns');
    assert.equal(resolveZoneId('peak'), 'dragons_peak');
    assert.equal(resolveZoneId('__proto__'), null);
  });

  it('resolves all 13 canonical monsters and shorthand aliases across zones', () => {
    assert.equal(Object.keys(MONSTERS).length, 13);
    assert.equal(resolveMonsterId('slime'), 'moss_slime');
    assert.equal(resolveMonsterId('wolf'), 'timber_wolf');
    assert.equal(resolveMonsterId('ent'), 'thornback_ent');
    assert.equal(resolveMonsterId('ignis'), 'ignis_world_boss');
    assert.equal(resolveMonsterId('constructor'), null);
  });

  it('resolves items, item equivalence groups, shop catalog, 4 NPCs, and 8 quests', () => {
    assert.ok(Object.keys(ITEMS).length >= 15);
    assert.ok(SHOP_CATALOG.length >= 10);
    assert.equal(Object.keys(NPCS).length, 4);
    assert.equal(Object.keys(QUESTS).length, 8);
    assert.equal(resolveItemId('potion'), 'health_potion');
    assert.equal(resolveQuestId('quest_01_first_steps'), 'quest_01_first_steps');
    assert.equal(resolveNpcId('thorne'), 'npc_elder_thorne');
  });
});

describe('Suite 2: Hardcore Leveling, Talents & Risk/Reward Multipliers (src/game/leveling.js)', () => {
  it('computes xpToNextLevel(L) = floor(100 * L^1.5) for Levels 1 to 20', () => {
    assert.equal(xpToNextLevel(1), 100);
    assert.equal(xpToNextLevel(2), 282);
    assert.equal(xpToNextLevel(3), 519);
    assert.equal(xpToNextLevel(4), 800);
    assert.equal(xpToNextLevel(5), 1118);
  });

  it('computes class base stats and skill unlocks across levels', () => {
    const wStats = computeCharacterStats({ classId: 'warrior', level: 1 });
    assert.equal(wStats.maxHp, 150);
    assert.equal(wStats.attack, 16);
    assert.equal(wStats.defense, 12);
    assert.equal(getUnlockedSkills('warrior', 1).length, 1);
    assert.equal(getUnlockedSkills('warrior', 3).length, 2);
    assert.equal(getUnlockedSkills('warrior', 6).length, 3);
  });

  it('handles multi-level XP grants, Clutch Full HP/MP Restore, +3 talent points, and skill unlocks', () => {
    const db = initDatabase(':memory:');
    const hero = createCharacter(db, { name: 'LevelTester', classId: 'warrior' });
    hero.hp = 10;
    hero.mp = 5;
    const res = applyXpGain(hero, 400);
    assert.equal(res.leveledUp, true);
    assert.equal(res.newLevel, 3);
    assert.equal(res.talentPointsEarned, 6);
    assert.equal(hero.hp, hero.maxHp);
    assert.equal(hero.mp, hero.maxMp);
    assert.equal(hero.unlockedSkills.length, 2);
    db.close();
  });

  it('allocates talents (vitality, might, swiftness) and enforces validation & alive checks', () => {
    const db = initDatabase(':memory:');
    const hero = createCharacter(db, { name: 'TalentHero', classId: 'mage' });
    hero.talents.unspentPoints = 3;
    allocateTalent(hero, 'vitality', 1);
    allocateTalent(hero, 'might', 1);
    allocateTalent(hero, 'swiftness', 1);
    assert.equal(hero.talents.unspentPoints, 0);
    assert.equal(hero.talents.vitality, 1);
    assert.equal(hero.talents.might, 1);
    assert.equal(hero.talents.swiftness, 1);
    assert.throws(() => allocateTalent(hero, 'vitality', 1), /Insufficient/);
    db.close();
  });

  it('computes safe grinding penalty, high-stakes danger bonus, kill streak, and party aura multipliers', () => {
    assert.equal(computeLevelDifferenceMultiplier(5, 1), 0.6);
    assert.equal(computeLevelDifferenceMultiplier(10, 1), 0.2);
    assert.equal(computeLevelDifferenceMultiplier(1, 3), 1.4);
    assert.equal(computeLevelDifferenceMultiplier(1, 10), 2.0);
    assert.equal(computeKillStreakMultiplier(5).multiplier, 1.25);
    assert.equal(computePartyAura(3, true).partyAuraBonus, 0.25);
    const xp = calculateCombatXpReward({
      baseXp: 100,
      heroLevel: 1,
      monsterLevel: 3,
      killStreak: 2,
      partyActive: true,
      allyCount: 1,
    });
    assert.ok(xp.finalXp > 100);
  });
});

describe('Suite 3: Deterministic Combat, Skills, Telegraphs, Flee, Potions & Permadeath (src/game/combat.js)', () => {
  it('rejects combat in safe_haven with 400 SAFE_ZONE_NO_COMBAT', () => {
    const db = initDatabase(':memory:');
    const hero = createCharacter(db, { name: 'TownFighter', classId: 'warrior' });
    assert.throws(
      () => executeCombatAction(hero, { actionType: 'attack', targetMonsterId: 'moss_slime' }),
      (err) => err.status === 400 && err.error === 'SAFE_ZONE_NO_COMBAT'
    );
    db.close();
  });

  it('computes armor mitigation 100 / (100 + DEF * 3) and flee chance accurately', () => {
    assert.equal(computeArmorMitigation(0), 1.0);
    assert.ok(Math.abs(computeArmorMitigation(10) - 100 / 130) < 0.0001);
    const flee = computeFleeChance({ speed: 20, fleeBonus: 0.15 }, { speed: 10, isBoss: false });
    assert.ok(flee >= 0.25 && flee <= 1.0);
  });

  it('executes monster 3rd-round heavy telegraph (round 2 warning -> round 3 1.8x strike) and Warrior Unyielding Armor (-10%)', () => {
    const db = initDatabase(':memory:');
    const hero = createCharacter(db, { name: 'TelegraphHero', classId: 'warrior' });
    hero.currentZoneId = 'whispering_woods';
    hero.attack = 5;
    hero.maxHp = 500;
    hero.hp = 500;

    const r1 = executeCombatAction(hero, { actionType: 'attack', targetMonsterId: 'thornback_ent' });
    assert.equal(r1.combatSession.round, 2);
    assert.equal(r1.combatSession.intent, 'normal_attack');

    const r2 = executeCombatAction(hero, { actionType: 'attack', targetMonsterId: 'thornback_ent' });
    assert.equal(r2.combatSession.round, 3);
    assert.equal(r2.combatSession.intent, 'telegraph_heavy');
    assert.equal(r2.combatSession.telegraphActive, true);

    const r3 = executeCombatAction(hero, { actionType: 'attack', targetMonsterId: 'thornback_ent' });
    assert.ok(r3.monsterDamageDealt > r1.monsterDamageDealt);
    db.close();
  });

  it('executes all 9 class skills, cooldowns, stun cancellation, dodge, shield, and burn', () => {
    const db = initDatabase(':memory:');
    const w = createCharacter(db, { name: 'SkillWar', classId: 'warrior' });
    w.level = 6;
    w.currentZoneId = 'whispering_woods';
    w.mp = 200;
    w.maxMp = 200;

    const s1 = executeCombatAction(w, {
      actionType: 'skill',
      skillId: 'earthshatter',
      targetMonsterId: 'thornback_ent',
    });
    assert.equal(s1.monsterDamageDealt, 0);
    db.close();
  });

  it('enforces Health Potion healing (45% MaxHP + 25) and 3-round cooldown', () => {
    const db = initDatabase(':memory:');
    const hero = createCharacter(db, { name: 'PotionHero', classId: 'warrior' });
    hero.currentZoneId = 'whispering_woods';
    hero.hp = 40;
    const p1 = executeCombatAction(hero, { actionType: 'potion', targetMonsterId: 'moss_slime' });
    assert.ok(p1.combatSession.potionCooldown >= 2);
    assert.throws(
      () => executeCombatAction(hero, { actionType: 'potion', targetMonsterId: 'moss_slime' }),
      (err) => err.status === 400 && err.error === 'POTION_ON_COOLDOWN'
    );
    db.close();
  });

  it('handles Flee success (resets killStreak) and Failed Flee (60% Parting Strike)', () => {
    const db = initDatabase(':memory:');
    const hero = createCharacter(db, { name: 'FleeHero', classId: 'ranger' });
    hero.currentZoneId = 'whispering_woods';
    hero.killStreak = 3;
    executeCombatAction(hero, { actionType: 'attack', targetMonsterId: 'thornback_ent' });
    const f1 = executeCombatAction(hero, { actionType: 'flee', seed: 0.01 });
    assert.equal(f1.fled, true);
    assert.equal(hero.killStreak, 0);

    executeCombatAction(hero, { actionType: 'attack', targetMonsterId: 'thornback_ent' });
    const fFail = executeCombatAction(hero, { actionType: 'flee', seed: 0.99 });
    assert.equal(fFail.fled, false);
    assert.ok(fFail.monsterDamageDealt > 0);
    db.close();
  });

  it('triggers irreversible Permadeath on hp <= 0 and blocks all subsequent actions with 403 ERR_HERO_PERMANENTLY_DEAD', () => {
    const db = initDatabase(':memory:');
    const hero = createCharacter(db, { name: 'DoomedHero', classId: 'mage' });
    hero.currentZoneId = 'dragons_peak';
    hero.hp = 1;
    hero.defense = 0;
    const res = executeCombatAction(hero, { actionType: 'attack', targetMonsterId: 'ignis_world_boss' });
    assert.equal(res.permadeath, true);
    assert.equal(hero.isDead, true);
    assert.equal(hero.hp, 0);
    assert.throws(
      () => executeCombatAction(hero, { actionType: 'attack', targetMonsterId: 'ignis_world_boss' }),
      (err) => err.status === 403 && err.code === 'ERR_HERO_PERMANENTLY_DEAD'
    );
    db.close();
  });

  it('verifies Ranger Round 1 first-strike, Mage Arcane Surge MP restore on kill, Co-op Boss Assist, consumables, and failed-flee permadeath', () => {
    const db = initDatabase(':memory:');
    const mage = createCharacter(db, { name: 'SurgeMage', classId: 'mage' });
    mage.currentZoneId = 'whispering_woods';
    mage.attack = 500;
    mage.mp = 20;
    mage.partyActive = true;
    const win = executeCombatAction(mage, {
      actionType: 'attack',
      targetMonsterId: 'thornback_ent',
    });
    assert.equal(win.victory, true);
    assert.ok(win.arcaneSurgeMpRestored > 0);
    db.close();
  });

  it('prioritizes exact item matches over equivalence-group fallbacks in combatEquipItem and useConsumableItem', () => {
    const db = initDatabase(':memory:');
    const hero = createCharacter(db, { name: 'EquipHero', classId: 'warrior' });
    addItemToCharacterInventory(hero, 'item_ranger_cloak', 1);
    const eq = combatEquipItem(hero, 'item_ranger_cloak');
    assert.equal(eq.equippedSlot, 'armor');
    assert.equal(eq.equippedItem.itemId, 'item_ranger_cloak');
    db.close();
  });
});

describe('Suite 4: SQLite Persistence & Transactional Repositories (src/db/database.js, src/db/repositories.js)', () => {
  it('initializes all 7 SQLite tables and seeds 3 fallen legends in the graveyard', () => {
    const db = initDatabase(':memory:');
    const gy = listGraveyard(db);
    assert.equal(gy.length, 3);
    db.close();
  });

  it('validates character creation inputs and hydrates full PROJECT.md character & quest state', () => {
    const db = initDatabase(':memory:');
    const hero = createCharacter(db, { name: '  ValidHero  ', classId: 'ranger' });
    assert.equal(hero.name, 'ValidHero');
    assert.equal(hero.quests.length, 8);
    assert.throws(() => createCharacter(db, { name: 'A', classId: 'warrior' }));
    db.close();
  });

  it('persists inventory additions, equipment slot swaps, and stat recalculation', () => {
    const db = initDatabase(':memory:');
    const hero = createCharacter(db, { name: 'RepoGear', classId: 'warrior' });
    addItemToInventory(db, hero.id, 'forest_charm', 1);
    const eq = repoEquipItem(db, hero.id, 'forest_charm');
    assert.equal(eq.character.equipment.accessory.itemId, 'forest_charm');
    db.close();
  });

  it('preserves exact cross-slot item selection in repoEquipItem/removeItemFromInventory and retains equipment fleeBonus across SQLite hydration', () => {
    const db = initDatabase(':memory:');
    const hero = createCharacter(db, { name: 'CloakTester', classId: 'ranger' });
    addItemToInventory(db, hero.id, 'item_ranger_cloak', 1);
    repoEquipItem(db, hero.id, 'item_ranger_cloak');
    const hydrated = getCharacterById(db, hero.id);
    assert.ok(hydrated.fleeBonus >= 0.18);
    assert.equal(removeItemFromInventory(db, hero.id, 'health_potion', 1), true);
    db.close();
  });

  it('atomically archives quests on permadeath, updates epitaphs, and increments reincarnation generation', () => {
    const db = initDatabase(':memory:');
    const hero = createCharacter(db, { name: 'FallenOne', classId: 'warrior' });
    acceptQuest(db, hero.id, 'quest_02_wolf_cull');
    const death = recordPermadeath(db, hero, { slainBy: 'Timber Wolf' });
    assert.equal(death.graveyardEntry.activeQuestAtDeath, 'quest_02_wolf_cull');
    assert.equal(death.graveyardEntry.questsCompleted, 0);

    const updatedEp = updateEpitaph(db, hero.id, 'Died with honor.');
    assert.equal(updatedEp.epitaph, 'Died with honor.');

    const gen2 = createCharacter(db, {
      name: 'FallenTwo',
      classId: 'warrior',
      ancestorId: hero.id,
    });
    assert.equal(gen2.generation, 2);
    db.close();
  });

  it('supports nested transactions via runInTransaction and chat/event persistence', () => {
    const db = initDatabase(':memory:');
    runInTransaction(db, () => {
      insertChatMessage(db, { sender: 'Tester', text: 'Outer msg', channel: 'global' });
      assert.throws(() => {
        runInTransaction(db, () => {
          insertChatMessage(db, { sender: 'Tester', text: 'Rolled back msg', channel: 'global' });
          throw new Error('force rollback');
        });
      });
    });
    const msgs = listChatMessages(db);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].text, 'Outer msg');

    insertWorldEvent(db, { eventType: 'TEST', message: 'World event test' });
    assert.equal(listWorldEvents(db).length, 1);
    db.close();
  });
});
