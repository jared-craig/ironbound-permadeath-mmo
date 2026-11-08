import {
  CLASSES,
  SKILLS,
  ZONES,
  MONSTERS,
  ITEMS,
  QUESTS,
  ITEM_EQUIVALENCE_GROUPS,
  POTION_COOLDOWN_ROUNDS,
  MAX_KILL_STREAK_STACKS,
  resolveClassId,
  resolveZoneId,
  resolveMonsterId,
  getMonsterById,
  resolveItemId,
  getItemById,
  resolveSkillId,
} from '../config.js';
import {
  createAppError,
  assertCharacterAlive,
  calculateCombatXpReward,
  applyXpGain,
  recalculateCharacterStats,
} from './leveling.js';

export function computeArmorMitigation(defense) {
  const def = Math.max(0, Number(defense) || 0);
  return 100 / (100 + def * 3);
}

export function isDefensiveOrControlSkill(skillOrId) {
  const skill =
    typeof skillOrId === 'string'
      ? Object.hasOwn(SKILLS, skillOrId)
        ? SKILLS[skillOrId]
        : null
      : skillOrId;
  if (!skill) return false;
  return Boolean(
    skill.isDefensiveOrControl ||
      skill.stunsTarget ||
      skill.cancelsTelegraph ||
      skill.guaranteedDodge ||
      skill.shieldRatio
  );
}

export function computeFleeChance(character, monster, combatSession = null) {
  if (combatSession?.guaranteedFleeNextRound) {
    return 1.0;
  }
  const heroSpeed = Number(character?.speed) || 10;
  const monsterSpeed = Number(monster?.speed) || 10;
  const fleeBonus = Number(character?.fleeBonus) || 0;
  const raw = 0.60 + (heroSpeed - monsterSpeed) * 0.02 + fleeBonus;
  return Number(Math.min(1.0, Math.max(0.25, raw)).toFixed(4));
}

function findInventoryEntry(inventory, requestedId) {
  if (!Array.isArray(inventory) || typeof requestedId !== 'string') return null;
  const rawKey = requestedId.trim().toLowerCase();
  if (!rawKey) return null;
  const canonicalId = resolveItemId(rawKey) || rawKey;

  // 1. Exact raw match first
  let idx = inventory.findIndex(
    (entry) =>
      entry &&
      entry.quantity > 0 &&
      String(entry.itemId || entry.id).toLowerCase() === rawKey
  );
  if (idx !== -1) return { index: idx, entry: inventory[idx], resolvedId: inventory[idx].itemId || inventory[idx].id };

  // 2. Canonical alias match
  idx = inventory.findIndex(
    (entry) =>
      entry &&
      entry.quantity > 0 &&
      (resolveItemId(entry.itemId || entry.id) || String(entry.itemId || entry.id).toLowerCase()) === canonicalId
  );
  if (idx !== -1) return { index: idx, entry: inventory[idx], resolvedId: canonicalId };

  // 3. Equivalence group fallback if requestedId is a group or belongs to a group
  for (const [, groupIds] of Object.entries(ITEM_EQUIVALENCE_GROUPS)) {
    if (groupIds.includes(canonicalId)) {
      idx = inventory.findIndex(
        (entry) =>
          entry &&
          entry.quantity > 0 &&
          groupIds.includes(resolveItemId(entry.itemId || entry.id) || entry.itemId || entry.id)
      );
      if (idx !== -1) {
        const matchedId = resolveItemId(inventory[idx].itemId || inventory[idx].id) || inventory[idx].itemId;
        return { index: idx, entry: inventory[idx], resolvedId: matchedId };
      }
    }
  }

  return null;
}

export function addItemToCharacterInventory(character, itemIdInput, quantity = 1) {
  const canonicalId = resolveItemId(itemIdInput) || String(itemIdInput || '').trim();
  const itemDef = getItemById(canonicalId) || (Object.hasOwn(ITEMS, canonicalId) ? ITEMS[canonicalId] : null);
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));

  if (!Array.isArray(character.inventory)) {
    character.inventory = [];
  }

  const existing = character.inventory.find(
    (e) => (e.itemId || e.id) === canonicalId
  );
  if (existing) {
    existing.quantity = Math.max(0, Number(existing.quantity) || 0) + qty;
  } else {
    character.inventory.push({
      itemId: canonicalId,
      name: itemDef?.name || canonicalId,
      type: itemDef?.type || 'misc',
      slot: itemDef?.slot || null,
      quantity: qty,
      stats: itemDef?.stats ? { ...itemDef.stats } : undefined,
    });
  }
  return character.inventory;
}

export function consumeItemFromCharacterInventory(character, requestedId, quantity = 1) {
  const match = findInventoryEntry(character.inventory, requestedId);
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  if (!match || match.entry.quantity < qty) {
    return null;
  }
  match.entry.quantity -= qty;
  const removedItemId = match.entry.itemId || match.entry.id;
  if (match.entry.quantity <= 0) {
    character.inventory.splice(match.index, 1);
  }
  return removedItemId;
}

export function combatEquipItem(character, itemIdInput, options = {}) {
  assertCharacterAlive(character);

  if (typeof itemIdInput !== 'string' || !itemIdInput.trim()) {
    throw createAppError(400, 'INVALID_ITEM_ID', 'ERR_INVALID_ITEM_ID', 'Item ID must be a non-empty string.');
  }

  const rawTrimmed = itemIdInput.trim().toLowerCase();
  const canonicalRequested = resolveItemId(rawTrimmed);

  // Check if item exists in catalog or inventory
  const invMatch = findInventoryEntry(character.inventory, rawTrimmed);
  if (!invMatch) {
    if (!canonicalRequested && !Object.hasOwn(ITEMS, rawTrimmed)) {
      throw createAppError(404, 'ITEM_NOT_IN_INVENTORY', 'ERR_ITEM_NOT_IN_INVENTORY', `Item "${itemIdInput}" is not in inventory.`);
    }
    throw createAppError(404, 'ITEM_NOT_IN_INVENTORY', 'ERR_ITEM_NOT_IN_INVENTORY', `Item "${itemIdInput}" is not in inventory.`);
  }

  const actualItemId = resolveItemId(invMatch.entry.itemId || invMatch.entry.id) || invMatch.resolvedId;
  const itemDef = getItemById(actualItemId);
  if (!itemDef || itemDef.type !== 'equipment' || !itemDef.slot) {
    throw createAppError(400, 'ITEM_NOT_EQUIPPABLE', 'ERR_ITEM_NOT_EQUIPPABLE', 'Selected item cannot be equipped.');
  }

  if ((character.level || 1) < (itemDef.minLevel || 1)) {
    throw createAppError(
      400,
      'LEVEL_TOO_LOW',
      'ERR_LEVEL_TOO_LOW',
      `Requires Level ${itemDef.minLevel} to equip ${itemDef.name}.`
    );
  }

  // Remove 1 of the exact matched item from inventory
  invMatch.entry.quantity -= 1;
  if (invMatch.entry.quantity <= 0) {
    character.inventory.splice(invMatch.index, 1);
  }

  if (!character.equipment || typeof character.equipment !== 'object') {
    character.equipment = { weapon: null, armor: null, accessory: null };
  }

  const slot = itemDef.slot;
  const previousEquipped = character.equipment[slot];
  const previousItemId =
    typeof previousEquipped === 'string'
      ? previousEquipped
      : previousEquipped?.itemId || previousEquipped?.id || null;

  if (previousItemId) {
    addItemToCharacterInventory(character, previousItemId, 1);
  }

  character.equipment[slot] = {
    itemId: itemDef.id,
    name: itemDef.name,
    slot: itemDef.slot,
    minLevel: itemDef.minLevel || 1,
    stats: { ...(itemDef.stats || {}) },
  };

  recalculateCharacterStats(character, options);

  // Update active combat session fleeChance if in combat
  if (character.activeCombat && character.activeCombat.status === 'active') {
    const monster = getMonsterById(character.activeCombat.monsterId);
    character.activeCombat.fleeChance = computeFleeChance(
      character,
      monster,
      character.activeCombat
    );
  }

  return {
    equippedSlot: slot,
    equippedItem: character.equipment[slot],
    previousItemId,
    character,
  };
}

export function useConsumableItem(character, itemIdInput, options = {}) {
  assertCharacterAlive(character);

  if (typeof itemIdInput !== 'string' || !itemIdInput.trim()) {
    throw createAppError(
      400,
      'INVALID_ITEM_ID',
      'ERR_INVALID_ITEM_ID',
      'Item ID must be a non-empty string.'
    );
  }

  const rawKey = itemIdInput.trim().toLowerCase();
  const resolvedId = resolveItemId(rawKey);
  if (!resolvedId || !Object.hasOwn(ITEMS, resolvedId)) {
    throw createAppError(404, 'ITEM_NOT_FOUND', 'ERR_ITEM_NOT_FOUND', `Unknown item "${itemIdInput}".`);
  }

  const itemDef = ITEMS[resolvedId];
  if (itemDef.type !== 'consumable') {
    throw createAppError(
      400,
      'ITEM_NOT_CONSUMABLE',
      'ERR_ITEM_NOT_CONSUMABLE',
      `Item "${itemDef.name}" is not a consumable.`
    );
  }

  const session = character.activeCombat;

  if (itemDef.effect === 'heal_hp') {
    if (session && session.status === 'active' && (session.potionCooldown || 0) > 0) {
      throw createAppError(
        400,
        'POTION_ON_COOLDOWN',
        'ERR_POTION_ON_COOLDOWN',
        `Health potion is on cooldown for ${session.potionCooldown} more round(s).`
      );
    }
    const removed = consumeItemFromCharacterInventory(character, rawKey, 1);
    if (!removed) {
      throw createAppError(
        400,
        'NO_POTIONS_LEFT',
        'ERR_NO_POTIONS_LEFT',
        'No health potions remaining in inventory.'
      );
    }
    const healAmount = Math.round(
      character.maxHp * (itemDef.healRatio || 0.45) + (itemDef.flatHeal || 25)
    );
    const beforeHp = character.hp;
    character.hp = Math.min(character.maxHp, character.hp + healAmount);
    const actualHealed = character.hp - beforeHp;
    if (session && session.status === 'active') {
      session.potionCooldown = POTION_COOLDOWN_ROUNDS;
    }
    return {
      itemUsed: itemDef.id,
      effect: 'heal_hp',
      healAmount,
      actualHealed,
      potionCooldown: session?.potionCooldown || 0,
      character,
    };
  }

  if (itemDef.effect === 'restore_mp') {
    const removed = consumeItemFromCharacterInventory(character, rawKey, 1);
    if (!removed) {
      throw createAppError(
        400,
        'NO_POTIONS_LEFT',
        'ERR_NO_POTIONS_LEFT',
        'No mana potions remaining in inventory.'
      );
    }
    const restoreAmount = Math.round(
      character.maxMp * (itemDef.restoreRatio || 0.50) + (itemDef.flatRestore || 20)
    );
    const beforeMp = character.mp;
    character.mp = Math.min(character.maxMp, character.mp + restoreAmount);
    const actualRestored = character.mp - beforeMp;
    return {
      itemUsed: itemDef.id,
      effect: 'restore_mp',
      restoreAmount,
      actualRestored,
      character,
    };
  }

  if (itemDef.effect === 'recall_town') {
    const removedInv = consumeItemFromCharacterInventory(character, rawKey, 1);
    if (!removedInv) {
      throw createAppError(
        400,
        'ITEM_NOT_IN_INVENTORY',
        'ERR_ITEM_NOT_IN_INVENTORY',
        'Scroll of Sunhaven Recall is not in inventory.'
      );
    }
    character.currentZoneId = 'safe_haven';
    character.zoneId = 'safe_haven';
    character.x = ZONES.safe_haven.spawnPoint.x;
    character.y = ZONES.safe_haven.spawnPoint.y;
    character.killStreak = 0;
    character.activeCombat = null;
    return {
      itemUsed: itemDef.id,
      effect: 'recall_town',
      recalledTo: 'safe_haven',
      character,
    };
  }

  throw createAppError(400, 'ITEM_NOT_CONSUMABLE', 'ERR_ITEM_NOT_CONSUMABLE', 'Unsupported consumable.');
}

export function createCombatSession(character, monsterDef) {
  const fleeChance = computeFleeChance(character, monsterDef, null);
  return {
    id: `combat_${character.id}_${Date.now()}`,
    characterId: character.id,
    monsterId: monsterDef.id,
    monsterName: monsterDef.name,
    monsterLevel: monsterDef.level,
    monsterIsBoss: Boolean(monsterDef.isBoss),
    monsterMaxHp: monsterDef.maxHp,
    monsterHp: monsterDef.maxHp,
    monsterAttack: monsterDef.attack,
    monsterDefense: monsterDef.defense,
    monsterSpeed: monsterDef.speed,
    zoneId: character.currentZoneId || character.zoneId,
    round: 1,
    status: 'active',
    intent: 'normal_attack',
    telegraphActive: false,
    telegraphWarning: null,
    potionCooldown: 0,
    skillCooldowns: {},
    heroShield: 0,
    monsterBurnRounds: 0,
    monsterBurnDamage: 0,
    guaranteedFleeNextRound: false,
    fleeChance,
    combatLog: [],
  };
}

export function executeCombatAction(character, payload = {}, context = {}) {
  assertCharacterAlive(character);

  const zoneId = resolveZoneId(character.currentZoneId || character.zoneId || 'safe_haven') || 'safe_haven';
  const zoneDef = ZONES[zoneId];
  if (!zoneDef || zoneDef.isSafeZone || zoneId === 'safe_haven') {
    throw createAppError(
      400,
      'SAFE_ZONE_NO_COMBAT',
      'ERR_SAFE_ZONE_NO_COMBAT',
      'Combat is forbidden inside Sunhaven Sanctuary.'
    );
  }

  const rawAction = String(payload.actionType || payload.action || 'attack')
    .trim()
    .toLowerCase();

  let session = character.activeCombat;
  const requestedMonsterId = payload.targetMonsterId || payload.monsterId || session?.monsterId || zoneDef.monsters[0];
  const resolvedMonsterId = resolveMonsterId(requestedMonsterId);
  const monsterDef = resolvedMonsterId ? MONSTERS[resolvedMonsterId] : null;

  if (!monsterDef) {
    throw createAppError(
      404,
      'MONSTER_NOT_FOUND',
      'ERR_MONSTER_NOT_FOUND',
      `Monster "${requestedMonsterId}" not found.`
    );
  }

  // Ensure session exists and matches target monster if starting fresh
  if (
    !session ||
    session.status !== 'active' ||
    (payload.targetMonsterId && resolvedMonsterId && session.monsterId !== resolvedMonsterId)
  ) {
    session = createCombatSession(character, monsterDef);
    character.activeCombat = session;
  }

  const currentRound = session.round;
  const classId = resolveClassId(character.classId) || 'warrior';
  const classDef = CLASSES[classId] || CLASSES.warrior;

  // Validate action BEFORE mutating round state or cooldowns
  let selectedSkill = null;
  if (rawAction === 'skill') {
    const rawSkillId = payload.skillId || payload.skill || classDef.skills[0];
    const resolvedSkill = resolveSkillId(rawSkillId);
    if (!resolvedSkill || !Object.hasOwn(SKILLS, resolvedSkill)) {
      throw createAppError(400, 'INVALID_SKILL', 'ERR_INVALID_SKILL', `Unknown skill "${rawSkillId}".`);
    }
    selectedSkill = SKILLS[resolvedSkill];
    if (selectedSkill.classId !== classId) {
      throw createAppError(
        400,
        'SKILL_CLASS_MISMATCH',
        'ERR_SKILL_CLASS_MISMATCH',
        `Skill ${selectedSkill.name} belongs to ${selectedSkill.classId}.`
      );
    }
    if ((character.level || 1) < selectedSkill.unlockLevel) {
      throw createAppError(
        400,
        'SKILL_LOCKED',
        'ERR_SKILL_LOCKED',
        `${selectedSkill.name} unlocks at Level ${selectedSkill.unlockLevel}.`
      );
    }
    const cdRemaining = session.skillCooldowns?.[selectedSkill.id] || 0;
    if (cdRemaining > 0) {
      throw createAppError(
        400,
        'SKILL_ON_COOLDOWN',
        'ERR_SKILL_ON_COOLDOWN',
        `${selectedSkill.name} is on cooldown for ${cdRemaining} more round(s).`
      );
    }
    if ((character.mp || 0) < selectedSkill.mpCost) {
      throw createAppError(
        400,
        'INSUFFICIENT_MP',
        'ERR_INSUFFICIENT_MP',
        `Insufficient MP for ${selectedSkill.name} (need ${selectedSkill.mpCost}, have ${character.mp}).`
      );
    }
  } else if (rawAction === 'potion') {
    if ((session.potionCooldown || 0) > 0) {
      throw createAppError(
        400,
        'POTION_ON_COOLDOWN',
        'ERR_POTION_ON_COOLDOWN',
        `Health potion is on cooldown for ${session.potionCooldown} more round(s).`
      );
    }
    const hasPotion = findInventoryEntry(character.inventory, 'health_potion');
    if (!hasPotion) {
      throw createAppError(
        400,
        'NO_POTIONS_LEFT',
        'ERR_NO_POTIONS_LEFT',
        'No health potions remaining in inventory.'
      );
    }
  } else if (rawAction !== 'attack' && rawAction !== 'flee') {
    throw createAppError(
      400,
      'INVALID_COMBAT_ACTION',
      'ERR_INVALID_COMBAT_ACTION',
      `Unsupported combat action "${rawAction}".`
    );
  }

  let heroDamageDealt = 0;
  let monsterDamageDealt = 0;
  let monsterStunnedThisRound = false;
  let heroDodgedThisRound = false;
  let defenseBuffMultiplier = 1.0;
  let potionDrunkThisRound = false;
  let skillPutOnCooldownId = null;

  // Handle FLEE action
  if (rawAction === 'flee') {
    const fleeChance = computeFleeChance(character, monsterDef, session);
    session.fleeChance = fleeChance;

    let roll;
    if (typeof payload.seed === 'number' && Number.isFinite(payload.seed)) {
      roll = Math.max(0, Math.min(0.9999, payload.seed));
    } else if (payload.forceFail === true) {
      roll = 0.9999;
    } else {
      roll = 0.20; // Deterministic default success when fleeChance >= 0.25
    }

    const fledSuccessfully = fleeChance >= 1.0 || roll < fleeChance;
    session.guaranteedFleeNextRound = false;

    if (fledSuccessfully) {
      session.status = 'fled';
      character.killStreak = 0;
      session.combatLog.push({
        round: currentRound,
        actor: 'hero',
        action: 'flee',
        damage: 0,
        message: `${character.name} retreated safely from ${monsterDef.name} (fleeChance: ${Math.round(fleeChance * 100)}%).`,
      });
      character.activeCombat = null;
      return {
        actionType: 'flee',
        fled: true,
        fleeChance,
        heroDamageDealt: 0,
        monsterDamageDealt: 0,
        leveledUp: false,
        lootDropped: [],
        xpGained: 0,
        goldGained: 0,
        combatSession: session,
        character,
      };
    }

    // Failed Flee -> Monster executes 60% Parting Strike
    const heroMit = computeArmorMitigation(character.defense);
    const classMult = classDef.damageTakenMultiplier || 1.0;
    const partingDamage = Math.max(
      1,
      Math.round(monsterDef.attack * 0.60 * heroMit * classMult)
    );
    monsterDamageDealt = partingDamage;
    character.hp = Math.max(0, character.hp - partingDamage);
    session.combatLog.push({
      round: currentRound,
      actor: 'monster',
      action: 'parting_strike',
      damage: partingDamage,
      message: `${character.name} failed to flee! ${monsterDef.name} lands a Parting Strike for ${partingDamage} damage.`,
    });

    if (character.hp <= 0) {
      character.hp = 0;
      character.isDead = true;
      character.status = 'fallen';
      character.killStreak = 0;
      session.status = 'defeat_permadeath';
      character.activeCombat = null;
      return {
        actionType: 'flee',
        fled: false,
        fleeChance,
        heroDamageDealt: 0,
        monsterDamageDealt,
        permadeath: true,
        slainBy: monsterDef.name,
        causeOfDeath: `Slain by ${monsterDef.name} (Parting Strike while fleeing)`,
        leveledUp: false,
        lootDropped: [],
        xpGained: 0,
        goldGained: 0,
        combatSession: session,
        character,
      };
    }

    // Advance round state if still alive after failed flee
    advanceRoundCounters(session, currentRound);
    session.fleeChance = computeFleeChance(character, monsterDef, session);
    return {
      actionType: 'flee',
      fled: false,
      fleeChance,
      heroDamageDealt: 0,
      monsterDamageDealt,
      permadeath: false,
      leveledUp: false,
      lootDropped: [],
      xpGained: 0,
      goldGained: 0,
      combatSession: session,
      character,
    };
  }

  // Determine turn order between Hero and Monster
  const heroGoesFirst =
    rawAction === 'potion' ||
    (selectedSkill && isDefensiveOrControlSkill(selectedSkill)) ||
    (currentRound === 1 && Boolean(classDef.firstStrikeRound1)) ||
    (character.speed || 10) >= (monsterDef.speed || 10);

  const performHeroTurn = () => {
    if (character.hp <= 0 || character.isDead) return;

    // Clear previous round's guaranteed flee if not used to flee
    session.guaranteedFleeNextRound = false;

    if (rawAction === 'potion') {
      const potRes = useConsumableItem(character, 'health_potion');
      potionDrunkThisRound = true;
      session.combatLog.push({
        round: currentRound,
        actor: 'hero',
        action: 'potion',
        damage: 0,
        heal: potRes.actualHealed,
        message: `${character.name} drinks a Crimson Health Vial (+${potRes.actualHealed} HP).`,
      });
      return;
    }

    if (rawAction === 'skill' && selectedSkill) {
      character.mp = Math.max(0, character.mp - selectedSkill.mpCost);
      session.skillCooldowns[selectedSkill.id] = selectedSkill.cooldownRounds;
      skillPutOnCooldownId = selectedSkill.id;

      if (selectedSkill.shieldRatio) {
        const shieldGain = Math.round(character.maxHp * selectedSkill.shieldRatio);
        session.heroShield = (session.heroShield || 0) + shieldGain;
      }
      if (selectedSkill.healRatio) {
        const healGain = Math.round(character.maxHp * selectedSkill.healRatio);
        character.hp = Math.min(character.maxHp, character.hp + healGain);
      }
      if (selectedSkill.defenseBuffRatio) {
        defenseBuffMultiplier = 1 + selectedSkill.defenseBuffRatio;
      }
      if (selectedSkill.guaranteedDodge) {
        heroDodgedThisRound = true;
      }
      if (selectedSkill.guaranteedFleeNextRound) {
        session.guaranteedFleeNextRound = true;
      }
      if (selectedSkill.stunsTarget) {
        monsterStunnedThisRound = true;
        if (selectedSkill.cancelsTelegraph) {
          session.intent = 'stunned';
          session.telegraphActive = false;
          session.telegraphWarning = null;
        }
      }

      const armorPen = selectedSkill.armorPenetration || 0;
      const effectiveMonsterDef = Math.max(0, monsterDef.defense * (1 - armorPen));
      const monsterMit = computeArmorMitigation(effectiveMonsterDef);
      const critMult = selectedSkill.guaranteedCrit ? 1.25 : 1.0;
      const dmg = Math.max(
        1,
        Math.round(character.attack * selectedSkill.damageMultiplier * monsterMit * critMult)
      );

      heroDamageDealt += dmg;
      session.monsterHp = Math.max(0, session.monsterHp - dmg);

      session.combatLog.push({
        round: currentRound,
        actor: 'hero',
        action: 'skill',
        skillId: selectedSkill.id,
        damage: dmg,
        stunned: monsterStunnedThisRound,
        message: `${character.name} casts ${selectedSkill.name} on ${monsterDef.name} for ${dmg} damage!${
          monsterStunnedThisRound ? ' Monster is STUNNED and heavy telegraph is canceled!' : ''
        }`,
      });

      if (selectedSkill.burnDamageRatio && selectedSkill.burnRounds) {
        session.monsterBurnRounds = selectedSkill.burnRounds;
        session.monsterBurnDamage = Math.max(
          1,
          Math.round(character.attack * selectedSkill.burnDamageRatio)
        );
      }
    } else {
      // Basic Attack
      const monsterMit = computeArmorMitigation(monsterDef.defense);
      const dmg = Math.max(1, Math.round(character.attack * monsterMit));
      heroDamageDealt += dmg;
      session.monsterHp = Math.max(0, session.monsterHp - dmg);
      session.combatLog.push({
        round: currentRound,
        actor: 'hero',
        action: 'attack',
        damage: dmg,
        message: `${character.name} strikes ${monsterDef.name} for ${dmg} damage.`,
      });
    }

    // Apply active Burn DoT on monster
    if (session.monsterHp > 0 && session.monsterBurnRounds > 0 && session.monsterBurnDamage > 0) {
      const burnDmg = session.monsterBurnDamage;
      session.monsterHp = Math.max(0, session.monsterHp - burnDmg);
      session.monsterBurnRounds -= 1;
      heroDamageDealt += burnDmg;
      session.combatLog.push({
        round: currentRound,
        actor: 'hero',
        action: 'burn_dot',
        damage: burnDmg,
        message: `${monsterDef.name} suffers ${burnDmg} Arcane Burn damage!`,
      });
    }

    // Co-op Boss Assist Strike (+25% damage when partyActive is enabled against a Boss)
    if (session.monsterHp > 0 && monsterDef.isBoss && character.partyActive) {
      const assistDmg = Math.max(1, Math.round(heroDamageDealt * 0.25));
      session.monsterHp = Math.max(0, session.monsterHp - assistDmg);
      heroDamageDealt += assistDmg;
      session.combatLog.push({
        round: currentRound,
        actor: 'party',
        action: 'coop_assist',
        damage: assistDmg,
        message: `Allied fellowship unleashes a Co-op Assist Strike on ${monsterDef.name} for ${assistDmg} bonus damage!`,
      });
    }
  };

  const performMonsterTurn = () => {
    if (session.monsterHp <= 0 || character.hp <= 0 || character.isDead) return;

    const isHeavyRound = currentRound % 3 === 0;
    if (monsterStunnedThisRound) {
      monsterDamageDealt = 0;
      session.combatLog.push({
        round: currentRound,
        actor: 'monster',
        action: 'stunned',
        damage: 0,
        message: `${monsterDef.name} is stunned and cannot attack this round!`,
      });
      return;
    }

    if (heroDodgedThisRound) {
      monsterDamageDealt = 0;
      session.combatLog.push({
        round: currentRound,
        actor: 'monster',
        action: isHeavyRound ? 'heavy_strike_dodged' : 'attack_dodged',
        damage: 0,
        message: `${character.name} dodges ${monsterDef.name}'s ${
          isHeavyRound ? '1.8x Heavy Telegraph Strike' : 'attack'
        } completely!`,
      });
      return;
    }

    const heavyMultiplier = isHeavyRound ? 1.8 : 1.0;
    const effectiveHeroDef = Math.max(0, character.defense * defenseBuffMultiplier);
    const heroMit = computeArmorMitigation(effectiveHeroDef);
    const classPassiveMult = classDef.damageTakenMultiplier || 1.0;

    let incomingDmg = Math.max(
      1,
      Math.round(monsterDef.attack * heavyMultiplier * heroMit * classPassiveMult)
    );

    let absorbedByShield = 0;
    if ((session.heroShield || 0) > 0) {
      absorbedByShield = Math.min(session.heroShield, incomingDmg);
      session.heroShield -= absorbedByShield;
      incomingDmg -= absorbedByShield;
    }

    monsterDamageDealt = incomingDmg;
    character.hp = Math.max(0, character.hp - incomingDmg);

    session.combatLog.push({
      round: currentRound,
      actor: 'monster',
      action: isHeavyRound ? 'heavy_telegraph_strike' : 'attack',
      damage: incomingDmg,
      absorbedByShield,
      isHeavyStrike: isHeavyRound,
      message: `${monsterDef.name} ${
        isHeavyRound ? 'unleashes a 1.8x Heavy Telegraph Strike' : 'attacks'
      } for ${incomingDmg} damage${
        absorbedByShield > 0 ? ` (${absorbedByShield} absorbed by barrier)` : ''
      }!`,
    });
  };

  if (heroGoesFirst) {
    performHeroTurn();
    if (session.monsterHp > 0) {
      performMonsterTurn();
    }
  } else {
    performMonsterTurn();
    if (character.hp > 0) {
      performHeroTurn();
    }
  }

  // Check Hero Permadeath
  if (character.hp <= 0) {
    character.hp = 0;
    character.isDead = true;
    character.status = 'fallen';
    character.killStreak = 0;
    session.status = 'defeat_permadeath';
    character.activeCombat = null;
    const isHeavyRound = currentRound % 3 === 0;
    return {
      actionType: rawAction,
      heroDamageDealt,
      monsterDamageDealt,
      permadeath: true,
      slainBy: monsterDef.name,
      causeOfDeath: `Slain by ${monsterDef.name}${isHeavyRound ? ' (Heavy Telegraph Strike)' : ''}`,
      leveledUp: false,
      lootDropped: [],
      xpGained: 0,
      goldGained: 0,
      combatSession: session,
      character,
    };
  }

  // Check Monster Defeat (Victory)
  if (session.monsterHp <= 0) {
    session.monsterHp = 0;
    session.status = 'victory';
    session.intent = 'defeated';
    session.telegraphActive = false;
    session.telegraphWarning = null;
    character.activeCombat = null;

    // Increment Kill Streak outside Safe Haven (up to 5 stacks)
    character.killStreak = Math.min(
      MAX_KILL_STREAK_STACKS,
      Math.max(0, Math.floor(Number(character.killStreak) || 0)) + 1
    );

    // Mage Arcane Surge passive: restore 8% MaxMP on kill
    let arcaneSurgeMpRestored = 0;
    if (classDef.killMpRestoreRatio) {
      arcaneSurgeMpRestored = Math.max(1, Math.round(character.maxMp * classDef.killMpRestoreRatio));
      character.mp = Math.min(character.maxMp, character.mp + arcaneSurgeMpRestored);
      session.combatLog.push({
        round: currentRound,
        actor: 'hero',
        action: 'passive_arcane_surge',
        mpRestored: arcaneSurgeMpRestored,
        message: `Arcane Surge restores +${arcaneSurgeMpRestored} MP upon slaying ${monsterDef.name}.`,
      });
    }

    const allyCount =
      typeof context.allyCount === 'number'
        ? context.allyCount
        : typeof character.zoneAllyCount === 'number'
        ? character.zoneAllyCount
        : character.partyActive
        ? 1
        : 0;

    const xpCalc = calculateCombatXpReward({
      baseXp: monsterDef.xpReward,
      heroLevel: character.level,
      monsterLevel: monsterDef.level,
      killStreak: character.killStreak,
      partyActive: Boolean(character.partyActive),
      allyCount,
    });

    const goldGained = Math.max(1, Math.round(monsterDef.goldReward));
    character.gold = Math.max(0, Math.floor(Number(character.gold) || 0)) + goldGained;

    if (!character.statsRecord || typeof character.statsRecord !== 'object') {
      character.statsRecord = { monstersSlain: 0, bossesSlain: 0, questsCompleted: 0, goldEarned: 0 };
    }
    character.statsRecord.monstersSlain = (character.statsRecord.monstersSlain || 0) + 1;
    if (monsterDef.isBoss) {
      character.statsRecord.bossesSlain = (character.statsRecord.bossesSlain || 0) + 1;
    }
    character.statsRecord.goldEarned = (character.statsRecord.goldEarned || 0) + goldGained;

    // Determine loot drops
    const lootDropped = [];
    if (Array.isArray(monsterDef.lootTable)) {
      for (const drop of monsterDef.lootTable) {
        const itemDef = getItemById(drop.itemId);
        if (!itemDef) continue;
        // Deterministic drop for boss loot or high chance
        if (drop.chance >= 0.35 || monsterDef.isBoss) {
          addItemToCharacterInventory(character, itemDef.id, 1);
          lootDropped.push({
            itemId: itemDef.id,
            name: itemDef.name,
            quantity: 1,
          });
        }
      }
    }

    // Check active COLLECT quests in this target zone -> 100% guaranteed quest item drop ONLY while ACTIVE in target zone
    const activeQuests = Array.isArray(context.quests)
      ? context.quests
      : Array.isArray(character.quests)
      ? character.quests
      : [];
    for (const qState of activeQuests) {
      if (qState.status !== 'ACTIVE') continue;
      const qDef = Object.hasOwn(QUESTS, qState.questId) ? QUESTS[qState.questId] : null;
      if (
        qDef &&
        qDef.type === 'COLLECT' &&
        qDef.targetZoneId === zoneId &&
        (qState.currentCount || 0) < qDef.requiredCount
      ) {
        const qItem = getItemById(qDef.targetId);
        if (qItem) {
          addItemToCharacterInventory(character, qItem.id, 1);
          lootDropped.push({
            itemId: qItem.id,
            name: qItem.name,
            quantity: 1,
            isQuestItem: true,
          });
        }
      }
    }

    const levelUpResult = applyXpGain(character, xpCalc.finalXp, { allyCount });

    return {
      actionType: rawAction,
      heroDamageDealt,
      monsterDamageDealt,
      permadeath: false,
      victory: true,
      leveledUp: levelUpResult.leveledUp,
      levelUpResult,
      xpGained: xpCalc.finalXp,
      xpBreakdown: xpCalc,
      goldGained,
      lootDropped,
      arcaneSurgeMpRestored,
      combatSession: session,
      character,
    };
  }

  // Both Hero and Monster are still alive -> advance round & update cooldowns/telegraph
  advanceRoundCounters(session, currentRound, {
    potionDrunkThisRound,
    skillPutOnCooldownId,
  });
  session.fleeChance = computeFleeChance(character, monsterDef, session);

  return {
    actionType: rawAction,
    heroDamageDealt,
    monsterDamageDealt,
    permadeath: false,
    victory: false,
    leveledUp: false,
    lootDropped: [],
    xpGained: 0,
    goldGained: 0,
    combatSession: session,
    character,
  };
}

function advanceRoundCounters(session, completedRound, flags = {}) {
  // Tick down existing cooldowns (except the ones just activated this round)
  if ((session.potionCooldown || 0) > 0 && !flags.potionDrunkThisRound) {
    session.potionCooldown = Math.max(0, session.potionCooldown - 1);
  }
  if (session.skillCooldowns && typeof session.skillCooldowns === 'object') {
    for (const [sId, cd] of Object.entries(session.skillCooldowns)) {
      if (sId === flags.skillPutOnCooldownId) continue;
      if (cd > 1) {
        session.skillCooldowns[sId] = cd - 1;
      } else {
        delete session.skillCooldowns[sId];
      }
    }
  }

  const nextRound = completedRound + 1;
  session.round = nextRound;

  // Telegraph heavy strike when completedRound % 3 === 2 (i.e. nextRound % 3 === 0, or on round 2 preparing for round 3)
  if (completedRound % 3 === 2 || nextRound % 3 === 0) {
    session.intent = 'telegraph_heavy';
    session.telegraphActive = true;
    session.telegraphWarning = `⚠️ ${session.monsterName} is charging a 1.8x Heavy Strike for Round ${nextRound}!`;
  } else {
    session.intent = 'normal_attack';
    session.telegraphActive = false;
    session.telegraphWarning = null;
  }
}
