/**
 * lib/game/monster.js
 * Monster definitions, scaling, and loot tables.
 *
 * Monster schema:
 * {
 *   id, name, emoji, level, hp, attack, defense, speed,
 *   element, skills[], lootTable[], expReward, goldReward,
 *   elite, boss, description
 * }
 */

import { weightedPick, randInt, chance, pick } from '../utils/random.js';

// ── Base monster templates ────────────────────────────────────────────────────

export const MONSTERS = {

  // ── TIER 1 (Levels 1–10) ─────────────────────────────────────────────────

  forest_wolf: {
    id: 'forest_wolf', name: 'Forest Wolf', emoji: '🐺',
    level: 3, hp: 60, attack: 12, defense: 4, speed: 14,
    element: 'neutral',
    skills: ['bite', 'howl'],
    lootTable: [
      { itemId: 'wolf_fang',     weight: 50, qty: [1, 2] },
      { itemId: 'health_potion', weight: 30, qty: [1, 1] },
      { itemId: 'iron_sword',    weight: 5,  qty: [1, 1] },
    ],
    expReward: 25, goldReward: [8, 15],
    description: 'A hungry wolf prowling the forest edge.',
  },

  goblin_scout: {
    id: 'goblin_scout', name: 'Goblin Scout', emoji: '👺',
    level: 2, hp: 40, attack: 10, defense: 3, speed: 18,
    element: 'neutral',
    skills: ['slash', 'flee_attempt'],
    lootTable: [
      { itemId: 'health_potion', weight: 40, qty: [1, 1] },
      { itemId: 'ancient_rune',  weight: 15, qty: [1, 1] },
      { itemId: 'iron_helm',     weight: 5,  qty: [1, 1] },
    ],
    expReward: 18, goldReward: [5, 12],
    description: 'A small but cunning goblin. Watch your pockets.',
  },

  cave_bat: {
    id: 'cave_bat', name: 'Cave Bat', emoji: '🦇',
    level: 1, hp: 25, attack: 8, defense: 2, speed: 22,
    element: 'wind',
    skills: ['sonic_screech'],
    lootTable: [
      { itemId: 'health_potion', weight: 40, qty: [1, 1] },
      { itemId: 'antidote',      weight: 20, qty: [1, 1] },
    ],
    expReward: 10, goldReward: [3, 8],
    description: 'Harmless looking... until it screams.',
  },

  slime: {
    id: 'slime', name: 'Slime', emoji: '🟢',
    level: 1, hp: 35, attack: 5, defense: 8, speed: 5,
    element: 'water',
    skills: ['acid_splash'],
    lootTable: [
      { itemId: 'health_potion', weight: 60, qty: [1, 2] },
      { itemId: 'antidote',      weight: 25, qty: [1, 1] },
    ],
    expReward: 8, goldReward: [2, 6],
    description: 'Slow, harmless, easy loot.',
  },

  // ── TIER 2 (Levels 10–25) ────────────────────────────────────────────────

  dark_knight: {
    id: 'dark_knight', name: 'Dark Knight', emoji: '🧟',
    level: 15, hp: 220, attack: 32, defense: 20, speed: 10,
    element: 'neutral',
    skills: ['power_strike', 'shield_bash'],
    lootTable: [
      { itemId: 'iron_plate',  weight: 25, qty: [1, 1] },
      { itemId: 'iron_sword',  weight: 20, qty: [1, 1] },
      { itemId: 'mega_potion', weight: 30, qty: [1, 2] },
      { itemId: 'monster_core', weight: 15, qty: [1, 1] },
    ],
    expReward: 120, goldReward: [35, 60],
    description: 'A knight consumed by darkness. Fearless and relentless.',
  },

  fire_elemental: {
    id: 'fire_elemental', name: 'Fire Elemental', emoji: '🔥',
    level: 18, hp: 180, attack: 40, defense: 10, speed: 15,
    element: 'fire',
    skills: ['fireball', 'eruption'],
    lootTable: [
      { itemId: 'ancient_rune', weight: 30, qty: [1, 2] },
      { itemId: 'flame_blade',  weight: 10, qty: [1, 1] },
      { itemId: 'mana_elixir',  weight: 25, qty: [1, 1] },
    ],
    expReward: 140, goldReward: [40, 75],
    description: 'A being of pure fire. Water weapons deal 2× damage.',
  },

  ice_golem: {
    id: 'ice_golem', name: 'Ice Golem', emoji: '🧊',
    level: 20, hp: 350, attack: 28, defense: 35, speed: 5,
    element: 'water',
    skills: ['blizzard', 'ice_wall'],
    lootTable: [
      { itemId: 'mana_elixir',  weight: 30, qty: [1, 2] },
      { itemId: 'ancient_rune', weight: 20, qty: [1, 3] },
      { itemId: 'monster_core', weight: 20, qty: [1, 1] },
    ],
    expReward: 180, goldReward: [50, 90],
    description: 'Slow but nearly impenetrable. Fire melts its armor.',
  },

  shadow_assassin: {
    id: 'shadow_assassin', name: 'Shadow Assassin', emoji: '🗡️',
    level: 22, hp: 160, attack: 50, defense: 12, speed: 30,
    element: 'neutral',
    skills: ['backstab', 'shadowstep'],
    lootTable: [
      { itemId: 'shadow_fang', weight: 8,  qty: [1, 1] },
      { itemId: 'swift_amulet', weight: 12, qty: [1, 1] },
      { itemId: 'mega_potion',  weight: 30, qty: [1, 2] },
    ],
    expReward: 200, goldReward: [60, 100],
    description: 'Attacks before you can blink. High critical rate.',
  },

  // ── TIER 3 (Levels 30–60) ────────────────────────────────────────────────

  ancient_dragon: {
    id: 'ancient_dragon', name: 'Ancient Dragon', emoji: '🐉',
    level: 45, hp: 1200, attack: 95, defense: 55, speed: 20,
    element: 'fire',
    skills: ['dragon_breath', 'wing_slam', 'fireball'],
    lootTable: [
      { itemId: 'dragon_scale',     weight: 15, qty: [1, 1] },
      { itemId: 'dragon_scale_mat', weight: 25, qty: [1, 3] },
      { itemId: 'dragon_eye',       weight: 5,  qty: [1, 1] },
      { itemId: 'void_crystal',     weight: 8,  qty: [1, 1] },
      { itemId: 'elixir_of_power',  weight: 20, qty: [1, 2] },
    ],
    expReward: 1500, goldReward: [400, 800],
    description: '🔥 An apex predator. Legendary loot guaranteed.',
  },

  void_lich: {
    id: 'void_lich', name: 'Void Lich', emoji: '💀',
    level: 55, hp: 900, attack: 120, defense: 30, speed: 18,
    element: 'neutral',
    skills: ['void_bolt', 'death_mark', 'soul_drain'],
    lootTable: [
      { itemId: 'void_crystal', weight: 20, qty: [1, 2] },
      { itemId: 'void_scythe',  weight: 5,  qty: [1, 1] },
      { itemId: 'ancient_rune', weight: 30, qty: [2, 5] },
    ],
    expReward: 2000, goldReward: [600, 1200],
    description: '💀 An immortal sorcerer that commands the void.',
  },

  // ── ELITE VARIANTS ───────────────────────────────────────────────────────

  alpha_wolf: {
    id: 'alpha_wolf', name: '⭐ Alpha Wolf', emoji: '🐺',
    level: 8, hp: 150, attack: 28, defense: 12, speed: 20,
    element: 'neutral',
    skills: ['bite', 'pack_howl'],
    lootTable: [
      { itemId: 'wolf_fang',     weight: 70, qty: [2, 4] },
      { itemId: 'health_potion', weight: 30, qty: [2, 3] },
      { itemId: 'swift_amulet',  weight: 10, qty: [1, 1] },
    ],
    expReward: 80, goldReward: [20, 40],
    elite: true,
    description: '⭐ The pack leader. Stronger and faster than its kin.',
  },

  goblin_king: {
    id: 'goblin_king', name: '⭐ Goblin King', emoji: '👑',
    level: 10, hp: 180, attack: 22, defense: 15, speed: 12,
    element: 'neutral',
    skills: ['slash', 'gold_throw', 'summon_goblins'],
    lootTable: [
      { itemId: 'iron_plate',  weight: 20, qty: [1, 1] },
      { itemId: 'health_ring', weight: 25, qty: [1, 1] },
      { itemId: 'ancient_rune', weight: 20, qty: [1, 2] },
    ],
    expReward: 100, goldReward: [50, 90],
    elite: true,
    description: '⭐ Wears a crown made of bones. Commands loyalty through fear.',
  },

  // ── DUNGEON BOSS ─────────────────────────────────────────────────────────

  dungeon_overlord: {
    id: 'dungeon_overlord', name: '💢 Dungeon Overlord', emoji: '👁️',
    level: 30, hp: 600, attack: 75, defense: 40, speed: 15,
    element: 'neutral',
    skills: ['power_strike', 'berserker_rage', 'death_mark', 'earthquake'],
    lootTable: [
      { itemId: 'void_crystal',    weight: 15, qty: [1, 2] },
      { itemId: 'dragon_scale_mat', weight: 20, qty: [1, 3] },
      { itemId: 'void_scythe',     weight: 5,  qty: [1, 1] },
      { itemId: 'elixir_of_power', weight: 25, qty: [2, 4] },
      { itemId: 'ancient_rune',    weight: 20, qty: [3, 6] },
    ],
    expReward: 800, goldReward: [200, 400],
    boss: true,
    description: '💢 The master of the dungeon. Prepare everything you have.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  ELITE BOSSES (High Difficulty)
  // ══════════════════════════════════════════════════════════════════════════
  vampire_lord: {
    id: 'vampire_lord', name: '🧛 Vampire Lord', emoji: '🧛',
    level: 25, hp: 800, attack: 55, defense: 35, speed: 40,
    element: 'dark', expReward: 192, goldReward: [140, 245],
    skills: ['blood_drain', 'shadow_clone'],
    isElite: true, boss: true,
  },
  crystal_golem: {
    id: 'crystal_golem', name: '💎 Crystal Golem', emoji: '💎',
    level: 30, hp: 1200, attack: 45, defense: 80, speed: 8,
    element: 'earth', expReward: 240, goldReward: [175, 280],
    skills: ['crystal_shield'],
    isElite: true, boss: true,
  },
  hydra: {
    id: 'hydra', name: '🐍 Hydra', emoji: '🐍',
    level: 35, hp: 1500, attack: 70, defense: 40, speed: 25,
    element: 'water', expReward: 304, goldReward: [210, 350],
    skills: ['multi_head_attack'],
    isElite: true, boss: true,
  },
  demon_general: {
    id: 'demon_general', name: '👹 Demon General', emoji: '👹',
    level: 40, hp: 1800, attack: 90, defense: 55, speed: 35,
    element: 'dark', expReward: 384, goldReward: [280, 455],
    skills: ['hellfire', 'demon_roar'],
    isElite: true, boss: true,
  },
  frost_titan: {
    id: 'frost_titan', name: '❄️ Frost Titan', emoji: '❄️',
    level: 48, hp: 2500, attack: 85, defense: 70, speed: 18,
    element: 'water', expReward: 480, goldReward: [350, 560],
    skills: ['blizzard', 'ice_prison'],
    isElite: true, boss: true,
  },
  thunder_dragon: {
    id: 'thunder_dragon', name: '⚡ Thunder Dragon', emoji: '⚡',
    level: 52, hp: 2800, attack: 110, defense: 60, speed: 55,
    element: 'wind', expReward: 560, goldReward: [420, 665],
    skills: ['lightning_breath', 'wing_storm'],
    isElite: true, boss: true,
  },
  abyssal_demon: {
    id: 'abyssal_demon', name: '💀 Abyssal Demon', emoji: '💀',
    level: 58, hp: 3200, attack: 130, defense: 65, speed: 45,
    element: 'dark', expReward: 680, goldReward: [525, 840],
    skills: ['void_slash', 'curse'],
    isElite: true, boss: true,
  },
  phoenix: {
    id: 'phoenix', name: '🦅 Phoenix', emoji: '🦅',
    level: 62, hp: 2600, attack: 120, defense: 50, speed: 80,
    element: 'fire', expReward: 760, goldReward: [560, 910],
    skills: ['rebirth', 'inferno'],
    isElite: true, boss: true,
  },
  leviathan: {
    id: 'leviathan', name: '🐋 Leviathan', emoji: '🐋',
    level: 68, hp: 4500, attack: 140, defense: 90, speed: 30,
    element: 'water', expReward: 880, goldReward: [700, 1120],
    skills: ['tidal_wave', 'ocean_pressure'],
    isElite: true, boss: true,
  },
  archlich: {
    id: 'archlich', name: '☠️ Archlich', emoji: '☠️',
    level: 72, hp: 3800, attack: 160, defense: 75, speed: 40,
    element: 'dark', expReward: 1000, goldReward: [840, 1330],
    skills: ['death_coil', 'soul_harvest'],
    isElite: true, boss: true,
  },
  void_dragon: {
    id: 'void_dragon', name: '🌀 Void Dragon', emoji: '🌀',
    level: 78, hp: 5500, attack: 180, defense: 100, speed: 60,
    element: 'void', expReward: 1200, goldReward: [1050, 1610],
    skills: ['void_breath', 'dimension_shift'],
    isElite: true, boss: true,
  },
  titan_king: {
    id: 'titan_king', name: '👑 Titan King', emoji: '👑',
    level: 85, hp: 7000, attack: 200, defense: 130, speed: 25,
    element: 'earth', expReward: 1440, goldReward: [1400, 2100],
    skills: ['earth_quake', 'titan_smash'],
    isElite: true, boss: true,
  },
  celestial_guardian: {
    id: 'celestial_guardian', name: '✨ Celestial Guardian', emoji: '✨',
    level: 92, hp: 8500, attack: 220, defense: 150, speed: 70,
    element: 'light', expReward: 1760, goldReward: [1750, 2660],
    skills: ['divine_light', 'holy_judgment'],
    isElite: true, boss: true,
  },
  primordial_chaos: {
    id: 'primordial_chaos', name: '💥 Primordial Chaos', emoji: '💥',
    level: 98, hp: 10000, attack: 280, defense: 120, speed: 85,
    element: 'void', expReward: 2400, goldReward: [2450, 3500],
    skills: ['chaos_storm', 'reality_break'],
    isElite: true, boss: true,
  },
  demon_emperor: {
    id: 'demon_emperor', name: '😈 Demon Emperor', emoji: '😈',
    level: 100, hp: 15000, attack: 350, defense: 180, speed: 90,
    element: 'dark', expReward: 4000, goldReward: [3500, 5600],
    skills: ['ultima_dark', 'demon_army', 'soul_eater'],
    isElite: true, boss: true,
  },
};

// ── Scaling ───────────────────────────────────────────────────────────────────

/**
 * Scale monster stats to player level for dynamic difficulty.
 * Monsters scale UP toward player level, preventing trivial fights.
 */
export function scaleMonster(baseMonster, playerLevel) {
  const levelDiff = Math.max(0, playerLevel - baseMonster.level);
  const scaleFactor = 1 + levelDiff * 0.08;  // 8% per level above base

  return {
    ...baseMonster,
    // Deep clone so we don't mutate the registry
    hp:      Math.floor(baseMonster.hp      * scaleFactor),
    attack:  Math.floor(baseMonster.attack  * scaleFactor),
    defense: Math.floor(baseMonster.defense * scaleFactor),
    expReward: Math.floor(baseMonster.expReward * (1 + levelDiff * 0.05)),
    goldReward: [
      Math.floor(baseMonster.goldReward[0] * scaleFactor),
      Math.floor(baseMonster.goldReward[1] * scaleFactor),
    ],
    currentHp: Math.floor(baseMonster.hp * scaleFactor),
    statusEffects: [],
    skillCooldowns: new Map(),
  };
}

/**
 * Get monsters appropriate for a given player level tier.
 */
export function getMonstersForLevel(level) {
  return Object.values(MONSTERS).filter(m => {
    if (m.boss || m.elite) return false;
    return m.level <= level + 5;  // allow slightly above level
  });
}

/**
 * Pick a random monster for a player.
 */
// Zone monster pools
const ZONE_MONSTERS = {
  village:      ['slime', 'cave_bat', 'goblin_scout'],
  forest:       ['forest_wolf', 'goblin_scout', 'cave_bat', 'alpha_wolf'],
  cave:         ['dark_knight', 'ice_golem', 'cave_bat', 'goblin_king'],
  volcano:      ['fire_elemental', 'magma_golem', 'inferno_drake', 'phoenix_fledgling'],
  shadow_realm: ['shadow_assassin', 'wraith', 'demon_soldier', 'banshee'],
  sky_citadel:  ['ancient_dragon', 'storm_knight', 'sky_serpent', 'thunder_phoenix'],
  void_abyss:   ['void_lich', 'void_horror', 'abyssal_titan', 'chaos_demon_lord'],
};

export function randomMonster(playerLevel, eliteChance = 0.1, bossAllowed = false, zone = null) {
  const isElite = chance(eliteChance);

  // Zone-specific pool
  if (zone && ZONE_MONSTERS[zone]) {
    const zonePool = ZONE_MONSTERS[zone]
      .map(id => MONSTERS[id])
      .filter(m => m && (!m.isBoss || bossAllowed));

    if (zonePool.length) {
      const elite = isElite ? zonePool.find(m => m.isElite) : null;
      const chosen = elite || pick(zonePool);
      return scaleMonster(chosen, playerLevel);
    }
  }

  if (isElite) {
    const elites = Object.values(MONSTERS).filter(m => (m.isElite || m.elite) && !(m.isBoss || m.boss) && m.level <= playerLevel + 5);
    if (elites.length) return scaleMonster(pick(elites), playerLevel);
  }

  const pool = getMonstersForLevel(playerLevel);
  if (!pool.length) return scaleMonster(MONSTERS.goblin_scout, playerLevel);
  return scaleMonster(pick(pool), playerLevel);
}

/**
 * Roll loot from a monster.
 */
export function rollMonsterLoot(monster, luckBonus = 0) {
  const drops = [];
  for (const entry of monster.lootTable) {
    const adjustedWeight = entry.weight + luckBonus * 5;
    if (chance(adjustedWeight / 100)) {
      const qty = Array.isArray(entry.qty)
        ? randInt(entry.qty[0], entry.qty[1])
        : entry.qty;
      drops.push({ itemId: entry.itemId, qty });
    }
  }
  return drops;
}

/**
 * Roll gold reward from a monster.
 */
export function rollGold(monster) {
  return randInt(monster.goldReward[0], monster.goldReward[1]);
}

export function getMonster(id) {
  return MONSTERS[id] || null;
}

export default {
  MONSTERS, scaleMonster, getMonstersForLevel,
  randomMonster, rollMonsterLoot, rollGold, getMonster,
};
