export const MAX_LEVEL = 20;
export const TALENT_POINTS_PER_LEVEL = 3;
export const MAX_KILL_STREAK_STACKS = 5;
export const KILL_STREAK_BONUS_PER_STACK = 0.05;
export const MAX_PARTY_AURA_BONUS = 0.25;
export const PARTY_BONUS_PER_ALLY = 0.10;
export const POTION_COOLDOWN_ROUNDS = 3;

export const CLASSES = {
  warrior: {
    id: 'warrior',
    name: 'Warrior',
    title: 'Iron Vanguard',
    description: 'Armored frontline juggernaut with heavy mitigation and stun control.',
    passiveName: 'Unyielding Armor',
    passiveDescription: 'Reduces all incoming monster damage by 10%.',
    damageTakenMultiplier: 0.9,
    baseStats: {
      maxHp: 150,
      hp: 150,
      maxMp: 40,
      mp: 40,
      attack: 16,
      defense: 12,
      speed: 9,
      critChance: 0.08,
    },
    growthPerLevel: {
      maxHp: 24,
      maxMp: 6,
      attack: 3,
      defense: 3,
      speed: 1,
    },
    starterWeaponId: 'iron_vanguard_blade',
    skills: ['shield_bash', 'iron_bulwark', 'earthshatter'],
  },
  ranger: {
    id: 'ranger',
    name: 'Ranger',
    title: 'Shadow Pathfinder',
    description: 'High-speed marksman with guaranteed Round 1 initiative and evasive mobility.',
    passiveName: "Pathfinder's Instinct",
    passiveDescription: 'Always strikes first in Round 1 and gains +10% base flee chance.',
    firstStrikeRound1: true,
    fleeBonus: 0.10,
    baseStats: {
      maxHp: 115,
      hp: 115,
      maxMp: 55,
      mp: 55,
      attack: 18,
      defense: 7,
      speed: 16,
      critChance: 0.18,
    },
    growthPerLevel: {
      maxHp: 18,
      maxMp: 8,
      attack: 4,
      defense: 2,
      speed: 2,
    },
    starterWeaponId: 'hunters_longbow',
    skills: ['piercing_shot', 'evasive_roll', 'rain_of_arrows'],
  },
  mage: {
    id: 'mage',
    name: 'Mage',
    title: 'Arcane Weaver',
    description: 'High-burst spellcaster with arcane barriers, armor-piercing meteors, and mana siphon.',
    passiveName: 'Arcane Surge',
    passiveDescription: 'Restores 8% MaxMP upon slaying any monster.',
    killMpRestoreRatio: 0.08,
    baseStats: {
      maxHp: 100,
      hp: 100,
      maxMp: 90,
      mp: 90,
      attack: 21,
      defense: 5,
      speed: 12,
      critChance: 0.12,
    },
    growthPerLevel: {
      maxHp: 15,
      maxMp: 14,
      attack: 5,
      defense: 1,
      speed: 1,
    },
    starterWeaponId: 'apprentice_staff',
    skills: ['fireball', 'arcane_barrier', 'meteor_nova'],
  },
};

export const CLASS_ALIASES = {
  warrior: 'warrior',
  vanguard: 'warrior',
  fighter: 'warrior',
  ranger: 'ranger',
  archer: 'ranger',
  hunter: 'ranger',
  mage: 'mage',
  wizard: 'mage',
  sorcerer: 'mage',
};

export const SKILLS = {
  // Warrior Skills (Levels 1, 3, 6)
  shield_bash: {
    id: 'shield_bash',
    classId: 'warrior',
    name: 'Shield Bash',
    unlockLevel: 1,
    mpCost: 10,
    cooldownRounds: 2,
    damageMultiplier: 1.35,
    description: 'Slams the target with a reinforced shield for 135% ATK damage.',
  },
  iron_bulwark: {
    id: 'iron_bulwark',
    classId: 'warrior',
    name: 'Iron Bulwark',
    unlockLevel: 3,
    mpCost: 14,
    cooldownRounds: 3,
    damageMultiplier: 1.0,
    shieldRatio: 0.25,
    defenseBuffRatio: 0.35,
    isDefensiveOrControl: true,
    description: 'Fortifies armor, granting a 25% MaxHP barrier and striking for 100% ATK.',
  },
  earthshatter: {
    id: 'earthshatter',
    classId: 'warrior',
    name: 'Earthshatter',
    unlockLevel: 6,
    mpCost: 20,
    cooldownRounds: 4,
    damageMultiplier: 1.75,
    stunsTarget: true,
    cancelsTelegraph: true,
    isDefensiveOrControl: true,
    description: 'Shatters the ground for 175% ATK damage, stunning the monster and canceling heavy telegraphs.',
  },

  // Ranger Skills (Levels 1, 3, 6)
  piercing_shot: {
    id: 'piercing_shot',
    classId: 'ranger',
    name: 'Piercing Shot',
    unlockLevel: 1,
    mpCost: 12,
    cooldownRounds: 2,
    damageMultiplier: 1.45,
    armorPenetration: 0.30,
    description: 'Fires a high-velocity arrow for 145% ATK that ignores 30% of monster armor.',
  },
  evasive_roll: {
    id: 'evasive_roll',
    classId: 'ranger',
    name: 'Evasive Roll',
    unlockLevel: 3,
    mpCost: 15,
    cooldownRounds: 3,
    damageMultiplier: 1.10,
    guaranteedDodge: true,
    guaranteedFleeNextRound: true,
    isDefensiveOrControl: true,
    description: 'Dodges 100% of incoming monster damage this round, counters for 110% ATK, and guarantees 100% flee next round.',
  },
  rain_of_arrows: {
    id: 'rain_of_arrows',
    classId: 'ranger',
    name: 'Rain of Arrows',
    unlockLevel: 6,
    mpCost: 22,
    cooldownRounds: 4,
    damageMultiplier: 1.90,
    guaranteedCrit: true,
    description: 'Unleashes a lethal volley for 190% ATK with guaranteed critical precision.',
  },

  // Mage Skills (Levels 1, 3, 6)
  fireball: {
    id: 'fireball',
    classId: 'mage',
    name: 'Fireball',
    unlockLevel: 1,
    mpCost: 15,
    cooldownRounds: 2,
    damageMultiplier: 1.55,
    burnDamageRatio: 0.15,
    burnRounds: 2,
    description: 'Hurls condensed flame for 155% ATK and scorches the enemy over 2 rounds.',
  },
  arcane_barrier: {
    id: 'arcane_barrier',
    classId: 'mage',
    name: 'Arcane Barrier',
    unlockLevel: 3,
    mpCost: 18,
    cooldownRounds: 3,
    damageMultiplier: 0.90,
    shieldRatio: 0.30,
    healRatio: 0.12,
    isDefensiveOrControl: true,
    description: 'Consecrates an arcane ward absorbing 30% MaxHP, restoring 12% MaxHP, and pulsing for 90% ATK.',
  },
  meteor_nova: {
    id: 'meteor_nova',
    classId: 'mage',
    name: 'Meteor Nova',
    unlockLevel: 6,
    mpCost: 28,
    cooldownRounds: 4,
    damageMultiplier: 2.10,
    armorPenetration: 0.25,
    burnDamageRatio: 0.25,
    burnRounds: 2,
    description: 'Calls down an astral meteor for 210% ATK, ignoring 25% DEF and inflicting heavy burn.',
  },
};

export const SKILL_ALIASES = {
  shield_bash: 'shield_bash',
  cleave: 'shield_bash',
  heroic_strike: 'shield_bash',
  iron_bulwark: 'iron_bulwark',
  bulwark: 'iron_bulwark',
  earthshatter: 'earthshatter',
  piercing_shot: 'piercing_shot',
  evasive_roll: 'evasive_roll',
  rain_of_arrows: 'rain_of_arrows',
  viper_volley: 'rain_of_arrows',
  fireball: 'fireball',
  arcane_barrier: 'arcane_barrier',
  meteor_nova: 'meteor_nova',
};

export const TALENT_NODES = {
  vitality: {
    id: 'vitality',
    name: 'Vitality',
    description: '+15 MaxHP and +1 DEF per point.',
    maxHpPerPoint: 15,
    defensePerPoint: 1,
  },
  might: {
    id: 'might',
    name: 'Might',
    description: '+3 ATK and +5 MaxMP per point.',
    attackPerPoint: 3,
    maxMpPerPoint: 5,
  },
  swiftness: {
    id: 'swiftness',
    name: 'Swiftness',
    description: '+2 SPD, +1.5% Crit Chance, and +2% Flee Chance per point.',
    speedPerPoint: 2,
    critChancePerPoint: 0.015,
    fleeBonusPerPoint: 0.02,
  },
};

export const ZONES = {
  safe_haven: {
    id: 'safe_haven',
    name: 'Sunhaven Sanctuary',
    recommendedLevel: 1,
    maxRecommendedLevel: 20,
    dangerTier: 'SANCTUARY',
    isSafeZone: true,
    description: 'Walled bastion of the Ironbound Order. Combat is forbidden; the Sanctuary Fountain restores weary heroes.',
    palette: {
      bgPrimary: '#1f261e',
      bgSecondary: '#2c3529',
      gridColor: '#3a4636',
      accentColor: '#d49b38',
    },
    spawnPoint: { x: 5, y: 5 },
    monsters: [],
    npcs: ['npc_elder_thorne', 'npc_warden_lyra', 'npc_archmage_seraphina', 'npc_blacksmith_torin'],
  },
  whispering_woods: {
    id: 'whispering_woods',
    name: 'Whispering Woods',
    recommendedLevel: 1,
    maxRecommendedLevel: 3,
    dangerTier: 'MODERATE',
    isSafeZone: false,
    description: 'Mist-shrouded timberlands prowled by feral packs and ancient briar horrors.',
    palette: {
      bgPrimary: '#16291d',
      bgSecondary: '#1e3727',
      gridColor: '#294a35',
      accentColor: '#56a869',
    },
    spawnPoint: { x: 2, y: 5 },
    monsters: ['moss_slime', 'timber_wolf', 'thornback_ent'],
    npcs: ['npc_warden_lyra'],
  },
  cursed_ruins: {
    id: 'cursed_ruins',
    name: 'Cursed Ruins of Morhollow',
    recommendedLevel: 3,
    maxRecommendedLevel: 6,
    dangerTier: 'HIGH',
    isSafeZone: false,
    description: 'Sunken catacombs where restless legions guard shattered phylacteries.',
    palette: {
      bgPrimary: '#1e192b',
      bgSecondary: '#29223b',
      gridColor: '#3a3052',
      accentColor: '#9b6be6',
    },
    spawnPoint: { x: 3, y: 4 },
    monsters: ['risen_skeleton', 'crypt_wraith', 'malakor_lich_lord'],
    npcs: ['npc_archmage_seraphina'],
  },
  molten_caverns: {
    id: 'molten_caverns',
    name: 'Molten Caverns',
    recommendedLevel: 6,
    maxRecommendedLevel: 9,
    dangerTier: 'EXTREME',
    isSafeZone: false,
    description: 'Subterranean magma conduits seething with sulfur elementals and cinder drakes.',
    palette: {
      bgPrimary: '#2e1612',
      bgSecondary: '#3d1e18',
      gridColor: '#572a22',
      accentColor: '#e85d33',
    },
    spawnPoint: { x: 4, y: 6 },
    monsters: ['magma_golem', 'cinder_drake', 'pyroclast_behemoth'],
    npcs: [],
  },
  dragons_peak: {
    id: 'dragons_peak',
    name: "Dragon's Peak Summit",
    recommendedLevel: 10,
    maxRecommendedLevel: 20,
    dangerTier: 'LETHAL',
    isSafeZone: false,
    description: 'Scorched obsidian caldera where Ignis the World-Breaker claims the bones of legends.',
    palette: {
      bgPrimary: '#2b0d14',
      bgSecondary: '#3b121b',
      gridColor: '#591b29',
      accentColor: '#ff384c',
    },
    spawnPoint: { x: 6, y: 3 },
    monsters: ['wyvern_stalker', 'obsidian_knight', 'void_harbinger', 'ignis_world_boss'],
    npcs: [],
  },
};

export const ZONE_ALIASES = {
  safe_haven: 'safe_haven',
  sunhaven: 'safe_haven',
  town: 'safe_haven',
  haven: 'safe_haven',
  sanctuary: 'safe_haven',
  whispering_woods: 'whispering_woods',
  woods: 'whispering_woods',
  forest: 'whispering_woods',
  whispering: 'whispering_woods',
  cursed_ruins: 'cursed_ruins',
  ruins: 'cursed_ruins',
  crypt: 'cursed_ruins',
  cursed: 'cursed_ruins',
  molten_caverns: 'molten_caverns',
  caverns: 'molten_caverns',
  molten: 'molten_caverns',
  caves: 'molten_caverns',
  dragons_peak: 'dragons_peak',
  peak: 'dragons_peak',
  dragon: 'dragons_peak',
  summit: 'dragons_peak',
};

export const MONSTERS = {
  // Whispering Woods (Lv 1-3)
  moss_slime: {
    id: 'moss_slime',
    name: 'Moss Slime',
    zoneId: 'whispering_woods',
    level: 1,
    isBoss: false,
    maxHp: 42,
    attack: 9,
    defense: 2,
    speed: 6,
    xpReward: 38,
    goldReward: 12,
    lootTable: [
      { itemId: 'health_potion', chance: 0.35 },
      { itemId: 'forest_charm', chance: 0.25 },
    ],
  },
  timber_wolf: {
    id: 'timber_wolf',
    name: 'Timber Wolf',
    zoneId: 'whispering_woods',
    level: 2,
    isBoss: false,
    maxHp: 64,
    attack: 13,
    defense: 4,
    speed: 11,
    xpReward: 55,
    goldReward: 18,
    lootTable: [
      { itemId: 'health_potion', chance: 0.40 },
      { itemId: 'item_ranger_cloak', chance: 0.30 },
    ],
  },
  thornback_ent: {
    id: 'thornback_ent',
    name: 'Thornback Ancient Ent',
    zoneId: 'whispering_woods',
    level: 3,
    isBoss: true,
    maxHp: 135,
    attack: 20,
    defense: 8,
    speed: 8,
    xpReward: 140,
    goldReward: 55,
    lootTable: [
      { itemId: 'thornwood_greatsword', chance: 1.0 },
      { itemId: 'health_potion', chance: 1.0 },
    ],
  },

  // Cursed Ruins (Lv 3-6)
  risen_skeleton: {
    id: 'risen_skeleton',
    name: 'Risen Skeleton Warrior',
    zoneId: 'cursed_ruins',
    level: 4,
    isBoss: false,
    maxHp: 110,
    attack: 22,
    defense: 9,
    speed: 10,
    xpReward: 95,
    goldReward: 30,
    lootTable: [
      { itemId: 'crypt_chainmail', chance: 0.35 },
      { itemId: 'mana_potion', chance: 0.40 },
    ],
  },
  crypt_wraith: {
    id: 'crypt_wraith',
    name: 'Crypt Wraith',
    zoneId: 'cursed_ruins',
    level: 5,
    isBoss: false,
    maxHp: 130,
    attack: 27,
    defense: 7,
    speed: 15,
    xpReward: 125,
    goldReward: 38,
    lootTable: [
      { itemId: 'soulweaver_rod', chance: 0.30 },
      { itemId: 'recall_scroll', chance: 0.35 },
    ],
  },
  malakor_lich_lord: {
    id: 'malakor_lich_lord',
    name: 'Malakor the Lich Lord',
    zoneId: 'cursed_ruins',
    level: 6,
    isBoss: true,
    maxHp: 260,
    attack: 36,
    defense: 14,
    speed: 14,
    xpReward: 280,
    goldReward: 110,
    lootTable: [
      { itemId: 'lichbane_signet', chance: 1.0 },
      { itemId: 'crypt_chainmail', chance: 0.8 },
    ],
  },

  // Molten Caverns (Lv 6-9)
  magma_golem: {
    id: 'magma_golem',
    name: 'Magma Golem',
    zoneId: 'molten_caverns',
    level: 7,
    isBoss: false,
    maxHp: 230,
    attack: 38,
    defense: 18,
    speed: 9,
    xpReward: 210,
    goldReward: 65,
    lootTable: [
      { itemId: 'emberforged_plate', chance: 0.35 },
      { itemId: 'health_potion', chance: 0.50 },
    ],
  },
  cinder_drake: {
    id: 'cinder_drake',
    name: 'Cinder Drake',
    zoneId: 'molten_caverns',
    level: 8,
    isBoss: false,
    maxHp: 270,
    attack: 44,
    defense: 15,
    speed: 17,
    xpReward: 260,
    goldReward: 80,
    lootTable: [
      { itemId: 'drakefang_longbow', chance: 0.35 },
      { itemId: 'mana_potion', chance: 0.50 },
    ],
  },
  pyroclast_behemoth: {
    id: 'pyroclast_behemoth',
    name: 'Pyroclast Behemoth',
    zoneId: 'molten_caverns',
    level: 9,
    isBoss: true,
    maxHp: 460,
    attack: 56,
    defense: 22,
    speed: 13,
    xpReward: 520,
    goldReward: 190,
    lootTable: [
      { itemId: 'emberforged_plate', chance: 1.0 },
      { itemId: 'pyroclast_core_ring', chance: 1.0 },
    ],
  },

  // Dragon's Peak (Lv 10+)
  wyvern_stalker: {
    id: 'wyvern_stalker',
    name: 'Apex Wyvern Stalker',
    zoneId: 'dragons_peak',
    level: 10,
    isBoss: false,
    maxHp: 350,
    attack: 58,
    defense: 20,
    speed: 20,
    xpReward: 420,
    goldReward: 120,
    lootTable: [
      { itemId: 'health_potion', chance: 0.60 },
      { itemId: 'recall_scroll', chance: 0.50 },
    ],
  },
  obsidian_knight: {
    id: 'obsidian_knight',
    name: 'Obsidian Dreadknight',
    zoneId: 'dragons_peak',
    level: 11,
    isBoss: false,
    maxHp: 430,
    attack: 66,
    defense: 28,
    speed: 15,
    xpReward: 510,
    goldReward: 150,
    lootTable: [
      { itemId: 'dragonscale_aegis', chance: 0.40 },
    ],
  },
  void_harbinger: {
    id: 'void_harbinger',
    name: 'Void Harbinger',
    zoneId: 'dragons_peak',
    level: 12,
    isBoss: false,
    maxHp: 490,
    attack: 74,
    defense: 24,
    speed: 19,
    xpReward: 620,
    goldReward: 185,
    lootTable: [
      { itemId: 'voidfire_blade', chance: 0.35 },
    ],
  },
  ignis_world_boss: {
    id: 'ignis_world_boss',
    name: 'Ignis the World-Breaker',
    zoneId: 'dragons_peak',
    level: 14,
    isBoss: true,
    maxHp: 950,
    attack: 98,
    defense: 34,
    speed: 22,
    xpReward: 750,
    goldReward: 500,
    lootTable: [
      { itemId: 'voidfire_blade', chance: 1.0 },
      { itemId: 'dragonscale_aegis', chance: 1.0 },
    ],
  },
};

export const MONSTER_ALIASES = {
  moss_slime: 'moss_slime',
  slime: 'moss_slime',
  timber_wolf: 'timber_wolf',
  wolf: 'timber_wolf',
  thornback_ent: 'thornback_ent',
  ent: 'thornback_ent',
  risen_skeleton: 'risen_skeleton',
  skeleton: 'risen_skeleton',
  crypt_wraith: 'crypt_wraith',
  wraith: 'crypt_wraith',
  shadow_wraith: 'crypt_wraith',
  malakor_lich_lord: 'malakor_lich_lord',
  lich: 'malakor_lich_lord',
  lich_lord: 'malakor_lich_lord',
  magma_golem: 'magma_golem',
  golem: 'magma_golem',
  cinder_drake: 'cinder_drake',
  drake: 'cinder_drake',
  pyroclast_behemoth: 'pyroclast_behemoth',
  behemoth: 'pyroclast_behemoth',
  wyvern_stalker: 'wyvern_stalker',
  wyvern: 'wyvern_stalker',
  obsidian_knight: 'obsidian_knight',
  knight: 'obsidian_knight',
  void_harbinger: 'void_harbinger',
  harbinger: 'void_harbinger',
  ignis_world_boss: 'ignis_world_boss',
  ignis: 'ignis_world_boss',
  dragon_boss: 'ignis_world_boss',
};

export const ITEMS = {
  // Starter & Tiered Weapons
  iron_vanguard_blade: {
    id: 'iron_vanguard_blade',
    name: 'Iron Vanguard Blade',
    type: 'equipment',
    slot: 'weapon',
    minLevel: 1,
    price: 45,
    stats: { attack: 5, defense: 1, maxHp: 10 },
    description: 'Standard-issue broadsword of the Sunhaven Vanguard.',
  },
  hunters_longbow: {
    id: 'hunters_longbow',
    name: "Hunter's Ash Longbow",
    type: 'equipment',
    slot: 'weapon',
    minLevel: 1,
    price: 45,
    stats: { attack: 6, speed: 2, critChance: 0.03 },
    description: 'Recurve ash bow balanced for rapid field draw.',
  },
  apprentice_staff: {
    id: 'apprentice_staff',
    name: 'Apprentice Ember Staff',
    type: 'equipment',
    slot: 'weapon',
    minLevel: 1,
    price: 45,
    stats: { attack: 7, maxMp: 15 },
    description: 'Runed focus staff channeling concentrated ember magic.',
  },
  thornwood_greatsword: {
    id: 'thornwood_greatsword',
    name: 'Thornwood Cleaver',
    type: 'equipment',
    slot: 'weapon',
    minLevel: 2,
    price: 110,
    stats: { attack: 12, maxHp: 25, defense: 2 },
    description: 'Heavy greatsword hewn from the heartwood of the Ancient Ent.',
  },
  soulweaver_rod: {
    id: 'soulweaver_rod',
    name: 'Soulweaver Archstaff',
    type: 'equipment',
    slot: 'weapon',
    minLevel: 4,
    price: 175,
    stats: { attack: 17, maxMp: 35, speed: 2 },
    description: 'Crypt-forged scepter humming with spectral resonance.',
  },
  drakefang_longbow: {
    id: 'drakefang_longbow',
    name: 'Drakefang Recurve Bow',
    type: 'equipment',
    slot: 'weapon',
    minLevel: 6,
    price: 260,
    stats: { attack: 24, speed: 5, critChance: 0.06 },
    description: 'Bow strung with sinew of a Molten Caverns cinder drake.',
  },
  voidfire_blade: {
    id: 'voidfire_blade',
    name: 'Voidfire Greatsword',
    type: 'equipment',
    slot: 'weapon',
    minLevel: 10,
    price: 550,
    stats: { attack: 40, maxHp: 60, defense: 6, critChance: 0.08 },
    description: 'Relic blade tempered in the volcanic maw of Dragon’s Peak.',
  },

  // Armor
  item_ranger_cloak: {
    id: 'item_ranger_cloak',
    name: 'Whispering Woods Cloak',
    type: 'equipment',
    slot: 'armor',
    minLevel: 1,
    price: 60,
    stats: { defense: 4, maxHp: 20, speed: 2, fleeBonus: 0.08 },
    description: 'Camouflaged mantle that aids swift disengagement.',
  },
  crypt_chainmail: {
    id: 'crypt_chainmail',
    name: 'Sanctified Crypt Chainmail',
    type: 'equipment',
    slot: 'armor',
    minLevel: 1,
    price: 85,
    stats: { defense: 8, maxHp: 35 },
    description: 'Interlocking steel rings warded against necrotic strikes.',
  },
  emberforged_plate: {
    id: 'emberforged_plate',
    name: 'Emberforged Plate Armor',
    type: 'equipment',
    slot: 'armor',
    minLevel: 5,
    price: 240,
    stats: { defense: 16, maxHp: 80, attack: 4 },
    description: 'Volcanic half-plate impervious to searing heat.',
  },
  dragonscale_aegis: {
    id: 'dragonscale_aegis',
    name: 'Dragonscale Aegis Harness',
    type: 'equipment',
    slot: 'armor',
    minLevel: 9,
    price: 500,
    stats: { defense: 28, maxHp: 140, speed: 3 },
    description: 'Masterwork armor forged from Ignis’s shed obsidian scales.',
  },

  // Accessories
  forest_charm: {
    id: 'forest_charm',
    name: 'Elderwood Ward Charm',
    type: 'equipment',
    slot: 'accessory',
    minLevel: 1,
    price: 50,
    stats: { maxHp: 20, maxMp: 15, defense: 2, fleeBonus: 0.05 },
    description: 'Carved talisman carrying Elder Thorne’s protective blessing.',
  },
  lichbane_signet: {
    id: 'lichbane_signet',
    name: 'Lichbane Signet Ring',
    type: 'equipment',
    slot: 'accessory',
    minLevel: 3,
    price: 150,
    stats: { attack: 8, maxHp: 35, maxMp: 25, defense: 3 },
    description: 'Golden signet reclaimed from the Cursed Ruins.',
  },
  pyroclast_core_ring: {
    id: 'pyroclast_core_ring',
    name: 'Pyroclast Core Band',
    type: 'equipment',
    slot: 'accessory',
    minLevel: 6,
    price: 310,
    stats: { attack: 15, maxHp: 55, speed: 3, critChance: 0.05 },
    description: 'Molten signet pulsing with primordial heartfire.',
  },

  // Consumables
  health_potion: {
    id: 'health_potion',
    name: 'Crimson Health Vial',
    type: 'consumable',
    effect: 'heal_hp',
    minLevel: 1,
    price: 25,
    healRatio: 0.45,
    flatHeal: 25,
    description: 'Restores 45% MaxHP + 25 HP. Triggers a 3-round potion cooldown in combat.',
  },
  mana_potion: {
    id: 'mana_potion',
    name: 'Azure Mana Elixir',
    type: 'consumable',
    effect: 'restore_mp',
    minLevel: 1,
    price: 25,
    restoreRatio: 0.50,
    flatRestore: 20,
    description: 'Restores 50% MaxMP + 20 MP immediately.',
  },
  recall_scroll: {
    id: 'recall_scroll',
    name: 'Scroll of Sunhaven Recall',
    type: 'consumable',
    effect: 'recall_town',
    minLevel: 1,
    price: 40,
    description: 'Instantly teleports the hero out of danger back to Sunhaven Sanctuary.',
  },

  // Quest Collectibles
  item_moonpetal: {
    id: 'item_moonpetal',
    name: 'Luminous Moonpetal Herb',
    type: 'quest',
    minLevel: 1,
    price: 10,
    description: 'Rare silver-leafed herb native to the Whispering Woods.',
  },
  item_phylactery_shard: {
    id: 'item_phylactery_shard',
    name: 'Shattered Phylactery Shard',
    type: 'quest',
    minLevel: 3,
    price: 20,
    description: 'Necrotic crystal fragment harvested from the Cursed Ruins.',
  },
};

export const ITEM_ALIASES = {
  iron_vanguard_blade: 'iron_vanguard_blade',
  iron_sword: 'iron_vanguard_blade',
  starter_sword: 'iron_vanguard_blade',
  hunters_longbow: 'hunters_longbow',
  hunter_bow: 'hunters_longbow',
  starter_bow: 'hunters_longbow',
  apprentice_staff: 'apprentice_staff',
  starter_staff: 'apprentice_staff',
  thornwood_greatsword: 'thornwood_greatsword',
  soulweaver_rod: 'soulweaver_rod',
  drakefang_longbow: 'drakefang_longbow',
  voidfire_blade: 'voidfire_blade',
  item_ranger_cloak: 'item_ranger_cloak',
  ranger_cloak: 'item_ranger_cloak',
  leather_armor: 'item_ranger_cloak',
  crypt_chainmail: 'crypt_chainmail',
  chainmail: 'crypt_chainmail',
  iron_armor: 'crypt_chainmail',
  emberforged_plate: 'emberforged_plate',
  dragonscale_aegis: 'dragonscale_aegis',
  forest_charm: 'forest_charm',
  elderwood_charm: 'forest_charm',
  lichbane_signet: 'lichbane_signet',
  pyroclast_core_ring: 'pyroclast_core_ring',
  health_potion: 'health_potion',
  potion: 'health_potion',
  hp_potion: 'health_potion',
  mana_potion: 'mana_potion',
  mp_potion: 'mana_potion',
  recall_scroll: 'recall_scroll',
  town_scroll: 'recall_scroll',
  item_moonpetal: 'item_moonpetal',
  moonpetal: 'item_moonpetal',
  moonpetal_herb: 'item_moonpetal',
  item_phylactery_shard: 'item_phylactery_shard',
  phylactery_shard: 'item_phylactery_shard',
};

export const ITEM_EQUIVALENCE_GROUPS = {
  weapon: [
    'iron_vanguard_blade',
    'hunters_longbow',
    'apprentice_staff',
    'thornwood_greatsword',
    'soulweaver_rod',
    'drakefang_longbow',
    'voidfire_blade',
  ],
  armor: [
    'item_ranger_cloak',
    'crypt_chainmail',
    'emberforged_plate',
    'dragonscale_aegis',
  ],
  accessory: ['forest_charm', 'lichbane_signet', 'pyroclast_core_ring'],
  health_potion: ['health_potion'],
  mana_potion: ['mana_potion'],
  recall_scroll: ['recall_scroll'],
};

export const SHOP_CATALOG = [
  'health_potion',
  'mana_potion',
  'recall_scroll',
  'iron_vanguard_blade',
  'hunters_longbow',
  'apprentice_staff',
  'item_ranger_cloak',
  'crypt_chainmail',
  'forest_charm',
  'thornwood_greatsword',
  'lichbane_signet',
  'emberforged_plate',
];

export const NPCS = {
  npc_elder_thorne: {
    id: 'npc_elder_thorne',
    name: 'Elder Thorne',
    title: 'Chronicler of the Fallen',
    zoneId: 'safe_haven',
    x: 5,
    y: 4,
    greeting: 'Every scar tells a story, initiate. Tread carefully beyond Sunhaven—death in these lands is eternal.',
    questIds: ['quest_01_first_steps', 'quest_03_herb_gather', 'quest_08_dragons_peak_trial'],
  },
  npc_warden_lyra: {
    id: 'npc_warden_lyra',
    name: 'Warden Lyra',
    title: 'Scout Commander',
    zoneId: 'safe_haven',
    x: 7,
    y: 5,
    greeting: 'The timber wolves grow bolder by the hour, and the Thornback Ent blocks our supply lines.',
    questIds: ['quest_02_wolf_cull', 'quest_04_forest_alpha'],
  },
  npc_archmage_seraphina: {
    id: 'npc_archmage_seraphina',
    name: 'Archmage Seraphina',
    title: 'Keeper of the Seal',
    zoneId: 'safe_haven',
    x: 3,
    y: 6,
    greeting: 'Necrotic tremors echo from Morhollow. Only those with disciplined resolve survive the Cursed Ruins.',
    questIds: ['quest_05_into_the_ruins', 'quest_06_skeleton_purge', 'quest_07_phylactery_hunt'],
  },
  npc_blacksmith_torin: {
    id: 'npc_blacksmith_torin',
    name: 'Forgemaster Torin',
    title: 'Ironbound Armorer',
    zoneId: 'safe_haven',
    x: 6,
    y: 7,
    greeting: 'Strong steel and stocked vials are all that stand between your name on a banner or on a headstone.',
    questIds: [],
  },
};

export const NPC_ALIASES = {
  npc_elder_thorne: 'npc_elder_thorne',
  elder_thorne: 'npc_elder_thorne',
  thorne: 'npc_elder_thorne',
  npc_warden_lyra: 'npc_warden_lyra',
  warden_lyra: 'npc_warden_lyra',
  lyra: 'npc_warden_lyra',
  npc_ranger_kael: 'npc_warden_lyra',
  npc_archmage_seraphina: 'npc_archmage_seraphina',
  archmage_seraphina: 'npc_archmage_seraphina',
  seraphina: 'npc_archmage_seraphina',
  npc_blacksmith_torin: 'npc_blacksmith_torin',
  blacksmith_torin: 'npc_blacksmith_torin',
  torin: 'npc_blacksmith_torin',
};

export const QUESTS = {
  quest_01_first_steps: {
    id: 'quest_01_first_steps',
    title: 'First Steps Into the Mist',
    type: 'EXPLORE',
    npcId: 'npc_elder_thorne',
    targetZoneId: 'whispering_woods',
    targetId: 'whispering_woods',
    requiredCount: 1,
    minLevel: 1,
    prerequisiteQuestId: null,
    lethalityRating: 'LOW',
    description: 'Venture beyond Sunhaven Sanctuary and scout the perimeter of the Whispering Woods.',
    rewards: {
      xp: 60,
      gold: 25,
      items: [{ itemId: 'health_potion', quantity: 1 }],
    },
  },
  quest_02_wolf_cull: {
    id: 'quest_02_wolf_cull',
    title: 'Culling the Timber Pack',
    type: 'KILL',
    npcId: 'npc_warden_lyra',
    targetZoneId: 'whispering_woods',
    targetId: 'timber_wolf',
    requiredCount: 3,
    minLevel: 1,
    prerequisiteQuestId: null,
    lethalityRating: 'MODERATE',
    description: 'Slay 3 Timber Wolves prowling the Whispering Woods.',
    rewards: {
      xp: 90,
      gold: 40,
      items: [{ itemId: 'item_ranger_cloak', quantity: 1 }],
    },
  },
  quest_03_herb_gather: {
    id: 'quest_03_herb_gather',
    title: 'Moonpetal Harvest',
    type: 'COLLECT',
    npcId: 'npc_elder_thorne',
    targetZoneId: 'whispering_woods',
    targetId: 'item_moonpetal',
    requiredCount: 3,
    minLevel: 1,
    prerequisiteQuestId: 'quest_01_first_steps',
    lethalityRating: 'MODERATE',
    description: 'Harvest 3 Luminous Moonpetal Herbs from creatures in the Whispering Woods.',
    rewards: {
      xp: 110,
      gold: 50,
      items: [{ itemId: 'forest_charm', quantity: 1 }],
    },
  },
  quest_04_forest_alpha: {
    id: 'quest_04_forest_alpha',
    title: 'Wrath of the Ancient Ent',
    type: 'BOSS',
    npcId: 'npc_warden_lyra',
    targetZoneId: 'whispering_woods',
    targetId: 'thornback_ent',
    requiredCount: 1,
    minLevel: 2,
    prerequisiteQuestId: 'quest_02_wolf_cull',
    lethalityRating: 'HIGH',
    description: 'Defeat the Thornback Ancient Ent terrorizing the Whispering Woods.',
    rewards: {
      xp: 180,
      gold: 85,
      items: [{ itemId: 'thornwood_greatsword', quantity: 1 }],
    },
  },
  quest_05_into_the_ruins: {
    id: 'quest_05_into_the_ruins',
    title: 'Descent Into Morhollow',
    type: 'EXPLORE',
    npcId: 'npc_archmage_seraphina',
    targetZoneId: 'cursed_ruins',
    targetId: 'cursed_ruins',
    requiredCount: 1,
    minLevel: 3,
    prerequisiteQuestId: 'quest_04_forest_alpha',
    lethalityRating: 'HIGH',
    description: 'Enter the Cursed Ruins of Morhollow and survey the undead breach.',
    rewards: {
      xp: 150,
      gold: 70,
      items: [{ itemId: 'recall_scroll', quantity: 1 }],
    },
  },
  quest_06_skeleton_purge: {
    id: 'quest_06_skeleton_purge',
    title: 'Purging the Bone Legion',
    type: 'KILL',
    npcId: 'npc_archmage_seraphina',
    targetZoneId: 'cursed_ruins',
    targetId: 'risen_skeleton',
    requiredCount: 4,
    minLevel: 3,
    prerequisiteQuestId: 'quest_05_into_the_ruins',
    lethalityRating: 'HIGH',
    description: 'Destroy 4 Risen Skeleton Warriors inside the Cursed Ruins.',
    rewards: {
      xp: 220,
      gold: 100,
      items: [{ itemId: 'crypt_chainmail', quantity: 1 }],
    },
  },
  quest_07_phylactery_hunt: {
    id: 'quest_07_phylactery_hunt',
    title: 'Shards of the Phylactery',
    type: 'COLLECT',
    npcId: 'npc_archmage_seraphina',
    targetZoneId: 'cursed_ruins',
    targetId: 'item_phylactery_shard',
    requiredCount: 3,
    minLevel: 4,
    prerequisiteQuestId: 'quest_06_skeleton_purge',
    lethalityRating: 'EXTREME',
    description: 'Recover 3 Shattered Phylactery Shards from monsters in the Cursed Ruins.',
    rewards: {
      xp: 280,
      gold: 130,
      items: [{ itemId: 'lichbane_signet', quantity: 1 }],
    },
  },
  quest_08_dragons_peak_trial: {
    id: 'quest_08_dragons_peak_trial',
    title: 'Trial of the World-Breaker',
    type: 'BOSS',
    npcId: 'npc_elder_thorne',
    targetZoneId: 'dragons_peak',
    targetId: 'ignis_world_boss',
    requiredCount: 1,
    minLevel: 6,
    prerequisiteQuestId: 'quest_07_phylactery_hunt',
    lethalityRating: 'LETHAL',
    description: 'Ascend Dragon’s Peak Summit and slay Ignis the World-Breaker.',
    rewards: {
      xp: 600,
      gold: 300,
      items: [{ itemId: 'voidfire_blade', quantity: 1 }],
    },
  },
};

export const QUEST_ALIASES = {
  quest_01_first_steps: 'quest_01_first_steps',
  quest_01: 'quest_01_first_steps',
  first_steps: 'quest_01_first_steps',
  quest_02_wolf_cull: 'quest_02_wolf_cull',
  quest_02: 'quest_02_wolf_cull',
  wolf_cull: 'quest_02_wolf_cull',
  quest_03_herb_gather: 'quest_03_herb_gather',
  quest_03: 'quest_03_herb_gather',
  herb_gather: 'quest_03_herb_gather',
  quest_04_forest_alpha: 'quest_04_forest_alpha',
  quest_04: 'quest_04_forest_alpha',
  forest_alpha: 'quest_04_forest_alpha',
  quest_05_into_the_ruins: 'quest_05_into_the_ruins',
  quest_05: 'quest_05_into_the_ruins',
  into_the_ruins: 'quest_05_into_the_ruins',
  quest_06_skeleton_purge: 'quest_06_skeleton_purge',
  quest_06: 'quest_06_skeleton_purge',
  skeleton_purge: 'quest_06_skeleton_purge',
  quest_07_phylactery_hunt: 'quest_07_phylactery_hunt',
  quest_07: 'quest_07_phylactery_hunt',
  phylactery_hunt: 'quest_07_phylactery_hunt',
  quest_08_dragons_peak_trial: 'quest_08_dragons_peak_trial',
  quest_08: 'quest_08_dragons_peak_trial',
  dragons_peak_trial: 'quest_08_dragons_peak_trial',
};

export const SEEDED_FALLEN_LEGENDS = [
  {
    id: 'legend_valerius_i',
    name: 'Sir Valerius I',
    classId: 'warrior',
    level: 14,
    generation: 1,
    zoneId: 'dragons_peak',
    x: 6,
    y: 4,
    slainBy: 'Ignis the World-Breaker',
    causeOfDeath: 'Slain by Ignis the World-Breaker (Heavy Telegraph Strike)',
    epitaph: 'Held the obsidian ridge alone so the fellowship could retreat.',
    questsCompleted: 7,
    completedQuestIds: [
      'quest_01_first_steps',
      'quest_02_wolf_cull',
      'quest_03_herb_gather',
      'quest_04_forest_alpha',
      'quest_05_into_the_ruins',
      'quest_06_skeleton_purge',
      'quest_07_phylactery_hunt',
    ],
    activeQuestAtDeath: 'quest_08_dragons_peak_trial',
    monstersSlain: 84,
    goldEarned: 1420,
    diedAt: '2026-10-31T21:14:00.000Z',
  },
  {
    id: 'legend_kaelen_ii',
    name: 'Kaelen Swiftbow II',
    classId: 'ranger',
    level: 9,
    generation: 2,
    zoneId: 'molten_caverns',
    x: 5,
    y: 6,
    slainBy: 'Pyroclast Behemoth',
    causeOfDeath: 'Slain by Pyroclast Behemoth',
    epitaph: 'One arrow short in the sulfur dark.',
    questsCompleted: 6,
    completedQuestIds: [
      'quest_01_first_steps',
      'quest_02_wolf_cull',
      'quest_03_herb_gather',
      'quest_04_forest_alpha',
      'quest_05_into_the_ruins',
      'quest_06_skeleton_purge',
    ],
    activeQuestAtDeath: 'quest_07_phylactery_hunt',
    monstersSlain: 49,
    goldEarned: 780,
    diedAt: '2026-11-01T18:40:00.000Z',
  },
  {
    id: 'legend_miriel_i',
    name: 'Miriel Starweaver',
    classId: 'mage',
    level: 6,
    generation: 1,
    zoneId: 'cursed_ruins',
    x: 4,
    y: 5,
    slainBy: 'Malakor the Lich Lord',
    causeOfDeath: 'Slain by Malakor the Lich Lord',
    epitaph: 'Her barrier shattered, yet her embers still light Morhollow.',
    questsCompleted: 4,
    completedQuestIds: [
      'quest_01_first_steps',
      'quest_02_wolf_cull',
      'quest_03_herb_gather',
      'quest_04_forest_alpha',
    ],
    activeQuestAtDeath: 'quest_06_skeleton_purge',
    monstersSlain: 27,
    goldEarned: 410,
    diedAt: '2026-11-02T11:05:00.000Z',
  },
];

export const SIMULATED_ADVENTURERS = [
  {
    id: 'sim_adv_aldric',
    name: 'Vanguard Aldric',
    classId: 'warrior',
    level: 4,
    zoneId: 'whispering_woods',
    x: 4,
    y: 4,
    status: 'patrolling',
    isSimulated: true,
  },
  {
    id: 'sim_adv_sylva',
    name: 'Sylva Windrunner',
    classId: 'ranger',
    level: 5,
    zoneId: 'cursed_ruins',
    x: 5,
    y: 3,
    status: 'hunting',
    isSimulated: true,
  },
  {
    id: 'sim_adv_vaelis',
    name: 'Archon Vaelis',
    classId: 'mage',
    level: 8,
    zoneId: 'molten_caverns',
    x: 6,
    y: 5,
    status: 'delving',
    isSimulated: true,
  },
  {
    id: 'sim_adv_bryn',
    name: 'Shieldmaiden Bryn',
    classId: 'warrior',
    level: 2,
    zoneId: 'safe_haven',
    x: 4,
    y: 6,
    status: 'resting',
    isSimulated: true,
  },
];

export function resolveClassId(input) {
  if (typeof input !== 'string') return null;
  const key = input.trim().toLowerCase();
  if (!key) return null;
  if (Object.hasOwn(CLASSES, key)) return key;
  if (Object.hasOwn(CLASS_ALIASES, key)) return CLASS_ALIASES[key];
  return null;
}

export function resolveZoneId(input) {
  if (typeof input !== 'string') return null;
  const key = input.trim().toLowerCase();
  if (!key) return null;
  if (Object.hasOwn(ZONES, key)) return key;
  if (Object.hasOwn(ZONE_ALIASES, key)) return ZONE_ALIASES[key];
  return null;
}

export function getZoneById(input) {
  const id = resolveZoneId(input);
  return id && Object.hasOwn(ZONES, id) ? ZONES[id] : null;
}

export function resolveMonsterId(input) {
  if (typeof input !== 'string') return null;
  const key = input.trim().toLowerCase();
  if (!key) return null;
  if (Object.hasOwn(MONSTERS, key)) return key;
  if (Object.hasOwn(MONSTER_ALIASES, key)) return MONSTER_ALIASES[key];
  return null;
}

export function getMonsterById(input) {
  const id = resolveMonsterId(input);
  return id && Object.hasOwn(MONSTERS, id) ? MONSTERS[id] : null;
}

export function resolveItemId(input) {
  if (typeof input !== 'string') return null;
  const key = input.trim().toLowerCase();
  if (!key) return null;
  if (Object.hasOwn(ITEMS, key)) return key;
  if (Object.hasOwn(ITEM_ALIASES, key)) return ITEM_ALIASES[key];
  return null;
}

export function getItemById(input) {
  const id = resolveItemId(input);
  return id && Object.hasOwn(ITEMS, id) ? ITEMS[id] : null;
}

export function resolveNpcId(input) {
  if (typeof input !== 'string') return null;
  const key = input.trim().toLowerCase();
  if (!key) return null;
  if (Object.hasOwn(NPCS, key)) return key;
  if (Object.hasOwn(NPC_ALIASES, key)) return NPC_ALIASES[key];
  return null;
}

export function resolveQuestId(input) {
  if (typeof input !== 'string') return null;
  const key = input.trim().toLowerCase();
  if (!key) return null;
  if (Object.hasOwn(QUESTS, key)) return key;
  if (Object.hasOwn(QUEST_ALIASES, key)) return QUEST_ALIASES[key];
  return null;
}

export function resolveSkillId(input) {
  if (typeof input !== 'string') return null;
  const key = input.trim().toLowerCase();
  if (!key) return null;
  if (Object.hasOwn(SKILLS, key)) return key;
  if (Object.hasOwn(SKILL_ALIASES, key)) return SKILL_ALIASES[key];
  return null;
}
