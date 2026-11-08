import {
  CLASSES,
  SKILLS,
  TALENT_NODES,
  ITEMS,
  MAX_LEVEL,
  TALENT_POINTS_PER_LEVEL,
  MAX_KILL_STREAK_STACKS,
  KILL_STREAK_BONUS_PER_STACK,
  MAX_PARTY_AURA_BONUS,
  PARTY_BONUS_PER_ALLY,
  resolveClassId,
  getItemById,
} from '../config.js';

export function createAppError(status, error, code, message) {
  const err = new Error(message || error);
  err.status = status;
  err.error = error;
  err.code = code || `ERR_${error}`;
  return err;
}

export function assertCharacterAlive(character) {
  if (!character) {
    throw createAppError(404, 'CHARACTER_NOT_FOUND', 'ERR_CHARACTER_NOT_FOUND', 'Character not found.');
  }
  if (character.isDead || character.status === 'fallen' || (typeof character.hp === 'number' && character.hp <= 0)) {
    throw createAppError(
      403,
      'CHARACTER_DEAD',
      'ERR_HERO_PERMANENTLY_DEAD',
      `${character.name || 'Hero'} has fallen in permadeath and cannot perform actions.`
    );
  }
}

export function xpToNextLevel(level) {
  const lv = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1)));
  return Math.floor(100 * Math.pow(lv, 1.5));
}

export function getUnlockedSkills(classId, level = 1) {
  const resolvedClass = resolveClassId(classId) || 'warrior';
  const classDef = CLASSES[resolvedClass] || CLASSES.warrior;
  const lv = Math.max(1, Math.floor(Number(level) || 1));
  return classDef.skills
    .map((skillId) => SKILLS[skillId])
    .filter((s) => s && lv >= s.unlockLevel)
    .map((s) => s.id);
}

export function computeLevelDifferenceMultiplier(heroLevel, monsterLevel) {
  const hLv = Math.max(1, Math.floor(Number(heroLevel) || 1));
  const mLv = Math.max(1, Math.floor(Number(monsterLevel) || 1));
  const dL = mLv - hLv;

  if (dL >= 1) {
    // High-Stakes Danger Bonus: +20% per level above hero, capped at 2.0x (dL >= 5)
    return Math.min(2.0, Number((1.0 + dL * 0.20).toFixed(2)));
  }

  if (dL <= -3) {
    // Over-Leveled Safe Grinding Penalty: -20% per level below -2, floor at 0.20x (dL <= -6)
    const stepsBelow = Math.abs(dL) - 2;
    return Math.max(0.20, Number((1.0 - stepsBelow * 0.20).toFixed(2)));
  }

  return 1.0;
}

export function computeKillStreakMultiplier(killStreak = 0) {
  const stacks = Math.max(0, Math.min(MAX_KILL_STREAK_STACKS, Math.floor(Number(killStreak) || 0)));
  const bonus = Number((stacks * KILL_STREAK_BONUS_PER_STACK).toFixed(2));
  return {
    stacks,
    bonus,
    multiplier: Number((1.0 + bonus).toFixed(2)),
  };
}

export function computePartyAura(allyCount = 0, partyActive = false) {
  if (!partyActive) {
    return {
      allyCount: Math.max(0, Math.floor(Number(allyCount) || 0)),
      partyAuraBonus: 0,
      partyBonusMultiplier: 1.0,
    };
  }
  const allies = Math.max(0, Math.floor(Number(allyCount) || 0));
  const bonus = Math.min(MAX_PARTY_AURA_BONUS, Number((allies * PARTY_BONUS_PER_ALLY).toFixed(2)));
  return {
    allyCount: allies,
    partyAuraBonus: bonus,
    partyBonusMultiplier: Number((1.0 + bonus).toFixed(2)),
  };
}

export function calculateCombatXpReward({
  baseXp,
  heroLevel = 1,
  monsterLevel = 1,
  killStreak = 0,
  partyActive = false,
  allyCount = 0,
}) {
  const rawBase = Math.max(0, Number(baseXp) || 0);
  const dangerMultiplier = computeLevelDifferenceMultiplier(heroLevel, monsterLevel);
  const { multiplier: streakMultiplier, bonus: streakBonus, stacks: streakStacks } =
    computeKillStreakMultiplier(killStreak);
  const { partyBonusMultiplier: partyMultiplier, partyAuraBonus } = computePartyAura(
    allyCount,
    partyActive
  );

  const totalMultiplier = Number(
    (dangerMultiplier * streakMultiplier * partyMultiplier).toFixed(6)
  );
  const finalXp = Math.max(1, Math.round(rawBase * dangerMultiplier * streakMultiplier * partyMultiplier));

  return {
    baseXp: rawBase,
    finalXp,
    dangerMultiplier,
    streakMultiplier,
    streakBonus,
    streakStacks,
    partyMultiplier,
    partyAuraBonus,
    totalMultiplier,
    levelDiff: Math.floor(Number(monsterLevel) || 1) - Math.floor(Number(heroLevel) || 1),
  };
}

export function computeCharacterStats(character, options = {}) {
  const classId = resolveClassId(character?.classId) || 'warrior';
  const classDef = CLASSES[classId] || CLASSES.warrior;
  const level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(character?.level) || 1)));
  const levelsGained = level - 1;

  const talents = character?.talents || {
    unspentPoints: 0,
    vitality: 0,
    might: 0,
    swiftness: 0,
  };
  const vit = Math.max(0, Math.floor(Number(talents.vitality) || 0));
  const mgt = Math.max(0, Math.floor(Number(talents.might) || 0));
  const swf = Math.max(0, Math.floor(Number(talents.swiftness) || 0));

  let maxHp =
    classDef.baseStats.maxHp +
    levelsGained * classDef.growthPerLevel.maxHp +
    vit * TALENT_NODES.vitality.maxHpPerPoint;
  let maxMp =
    classDef.baseStats.maxMp +
    levelsGained * classDef.growthPerLevel.maxMp +
    mgt * TALENT_NODES.might.maxMpPerPoint;
  let attack =
    classDef.baseStats.attack +
    levelsGained * classDef.growthPerLevel.attack +
    mgt * TALENT_NODES.might.attackPerPoint;
  let defense =
    classDef.baseStats.defense +
    levelsGained * classDef.growthPerLevel.defense +
    vit * TALENT_NODES.vitality.defensePerPoint;
  let speed =
    classDef.baseStats.speed +
    levelsGained * classDef.growthPerLevel.speed +
    swf * TALENT_NODES.swiftness.speedPerPoint;
  let critChance =
    classDef.baseStats.critChance + swf * TALENT_NODES.swiftness.critChancePerPoint;
  let fleeBonus =
    (classDef.fleeBonus || 0) + swf * TALENT_NODES.swiftness.fleeBonusPerPoint;

  const equipment = character?.equipment || {
    weapon: null,
    armor: null,
    accessory: null,
  };

  for (const slot of ['weapon', 'armor', 'accessory']) {
    const eqEntry = equipment[slot];
    const itemId = typeof eqEntry === 'string' ? eqEntry : eqEntry?.itemId || eqEntry?.id || null;
    if (!itemId) continue;
    const itemDef = getItemById(itemId) || (Object.hasOwn(ITEMS, itemId) ? ITEMS[itemId] : null);
    const stats = (typeof eqEntry === 'object' && eqEntry?.stats) || itemDef?.stats;
    if (!stats) continue;
    if (typeof stats.maxHp === 'number') maxHp += stats.maxHp;
    if (typeof stats.maxMp === 'number') maxMp += stats.maxMp;
    if (typeof stats.attack === 'number') attack += stats.attack;
    if (typeof stats.defense === 'number') defense += stats.defense;
    if (typeof stats.speed === 'number') speed += stats.speed;
    if (typeof stats.critChance === 'number') critChance += stats.critChance;
    if (typeof stats.fleeBonus === 'number') fleeBonus += stats.fleeBonus;
  }

  const allyCount =
    typeof options.allyCount === 'number'
      ? options.allyCount
      : typeof character?.zoneAllyCount === 'number'
      ? character.zoneAllyCount
      : 0;
  const partyActive = Boolean(character?.partyActive);
  const { partyAuraBonus, partyBonusMultiplier } = computePartyAura(allyCount, partyActive);

  if (partyAuraBonus > 0) {
    attack = Math.round(attack * partyBonusMultiplier);
    defense = Math.round(defense * partyBonusMultiplier);
  }

  critChance = Number(Math.min(0.75, Math.max(0, critChance)).toFixed(4));
  fleeBonus = Number(Math.min(0.50, Math.max(0, fleeBonus)).toFixed(4));

  return {
    maxHp: Math.round(maxHp),
    maxMp: Math.round(maxMp),
    attack: Math.round(attack),
    defense: Math.round(defense),
    speed: Math.round(speed),
    critChance,
    fleeBonus,
    partyAuraBonus,
    partyBonusMultiplier,
    unlockedSkills: getUnlockedSkills(classId, level),
    xpToNextLevel: xpToNextLevel(level),
  };
}

export function recalculateCharacterStats(character, options = {}) {
  const computed = computeCharacterStats(character, options);
  const preserveFullHp = Boolean(options.fullRestore);

  character.maxHp = computed.maxHp;
  character.maxMp = computed.maxMp;
  character.attack = computed.attack;
  character.defense = computed.defense;
  character.speed = computed.speed;
  character.critChance = computed.critChance;
  character.fleeBonus = computed.fleeBonus;
  character.partyAuraBonus = computed.partyAuraBonus;
  character.partyBonusMultiplier = computed.partyBonusMultiplier;
  character.unlockedSkills = computed.unlockedSkills;
  character.xpToNextLevel = computed.xpToNextLevel;

  if (preserveFullHp) {
    character.hp = character.maxHp;
    character.mp = character.maxMp;
  } else if (!character.isDead) {
    character.hp = Math.max(1, Math.min(character.maxHp, Math.round(Number(character.hp ?? character.maxHp))));
    character.mp = Math.max(0, Math.min(character.maxMp, Math.round(Number(character.mp ?? character.maxMp))));
  } else {
    character.hp = 0;
  }

  return character;
}

export function applyXpGain(character, xpAmount, options = {}) {
  assertCharacterAlive(character);

  const gained = Math.max(0, Math.floor(Number(xpAmount) || 0));
  const previousLevel = character.level || 1;
  const previousSkills = new Set(getUnlockedSkills(character.classId, previousLevel));
  const prevAttack = character.attack;
  const prevMaxHp = character.maxHp;
  const prevComputed = computeCharacterStats({ ...character, level: previousLevel }, options);

  if (character.level >= MAX_LEVEL) {
    character.level = MAX_LEVEL;
    character.xp = Math.max(0, Math.floor(Number(character.xp) || 0));
    character.xpToNextLevel = xpToNextLevel(character.level);
    return {
      leveledUp: false,
      levelsGained: 0,
      previousLevel,
      newLevel: character.level,
      talentPointsEarned: 0,
      newlyUnlockedSkills: [],
      clutchRestoreTriggered: false,
    };
  }

  character.xp = Math.max(0, Math.floor(Number(character.xp) || 0)) + gained;
  let levelsGained = 0;
  let talentPointsEarned = 0;

  while (character.level < MAX_LEVEL) {
    const threshold = xpToNextLevel(character.level);
    if (character.xp < threshold) break;
    character.xp -= threshold;
    character.level += 1;
    levelsGained += 1;
    talentPointsEarned += TALENT_POINTS_PER_LEVEL;
  }

  if (character.level >= MAX_LEVEL) {
    character.level = MAX_LEVEL;
  }

  if (!character.talents || typeof character.talents !== 'object') {
    character.talents = { unspentPoints: 0, vitality: 0, might: 0, swiftness: 0 };
  }

  const leveledUp = levelsGained > 0;
  if (leveledUp) {
    character.talents.unspentPoints =
      Math.max(0, Math.floor(Number(character.talents.unspentPoints) || 0)) + talentPointsEarned;
    recalculateCharacterStats(character, { ...options, fullRestore: true });
    if (prevAttack > prevComputed.attack) {
      character.attack = Math.max(character.attack, prevAttack);
    }
    if (prevMaxHp > prevComputed.maxHp) {
      character.maxHp = Math.max(character.maxHp, prevMaxHp);
      character.hp = character.maxHp;
    }
  } else {
    character.xpToNextLevel = xpToNextLevel(character.level);
    character.unlockedSkills = getUnlockedSkills(character.classId, character.level);
  }

  const currentSkills = getUnlockedSkills(character.classId, character.level);
  const newlyUnlockedSkills = currentSkills.filter((s) => !previousSkills.has(s));

  return {
    leveledUp,
    levelsGained,
    previousLevel,
    newLevel: character.level,
    talentPointsEarned,
    newlyUnlockedSkills,
    clutchRestoreTriggered: leveledUp,
  };
}

export function allocateTalent(character, nodeInput, rawPoints = 1, options = {}) {
  assertCharacterAlive(character);

  if (typeof nodeInput !== 'string') {
    throw createAppError(400, 'INVALID_TALENT_NODE', 'ERR_INVALID_TALENT_NODE', 'Talent node must be a string.');
  }
  const nodeKey = nodeInput.trim().toLowerCase();
  if (!Object.hasOwn(TALENT_NODES, nodeKey)) {
    throw createAppError(
      400,
      'INVALID_TALENT_NODE',
      'ERR_INVALID_TALENT_NODE',
      `Unknown talent node "${nodeInput}". Valid nodes: vitality, might, swiftness.`
    );
  }

  const pts = rawPoints === undefined ? 1 : rawPoints;
  if (
    typeof pts !== 'number' ||
    !Number.isInteger(pts) ||
    pts < 1 ||
    pts > 10000
  ) {
    throw createAppError(
      400,
      'INVALID_TALENT_POINTS',
      'ERR_INVALID_TALENT_POINTS',
      'Talent points must be a positive integer between 1 and 10000.'
    );
  }

  if (!character.talents || typeof character.talents !== 'object') {
    character.talents = { unspentPoints: 0, vitality: 0, might: 0, swiftness: 0 };
  }

  const unspent = Math.max(0, Math.floor(Number(character.talents.unspentPoints) || 0));
  if (unspent < pts) {
    throw createAppError(
      400,
      'INSUFFICIENT_TALENT_POINTS',
      'ERR_INSUFFICIENT_TALENT_POINTS',
      `Insufficient unspent talent points (have ${unspent}, need ${pts}).`
    );
  }

  const oldMaxHp = character.maxHp;
  const oldMaxMp = character.maxMp;

  character.talents.unspentPoints = unspent - pts;
  character.talents[nodeKey] = Math.max(0, Math.floor(Number(character.talents[nodeKey]) || 0)) + pts;

  recalculateCharacterStats(character, options);

  // If Vitality or Might increased maxHp/maxMp, add the delta to current hp/mp as well
  const hpDelta = Math.max(0, character.maxHp - oldMaxHp);
  const mpDelta = Math.max(0, character.maxMp - oldMaxMp);
  if (hpDelta > 0 && !character.isDead) {
    character.hp = Math.min(character.maxHp, character.hp + hpDelta);
  }
  if (mpDelta > 0 && !character.isDead) {
    character.mp = Math.min(character.maxMp, character.mp + mpDelta);
  }

  return {
    node: nodeKey,
    pointsAllocated: pts,
    talents: { ...character.talents },
    character,
  };
}
