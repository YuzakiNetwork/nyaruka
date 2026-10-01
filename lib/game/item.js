/**
 * lib/game/item.js
 * Item schema, registry, and loot generation.
 *
 * Item schema:
 * {
 *   id        : string        — unique key
 *   name      : string
 *   type      : weapon|armor|helmet|accessory|consumable|material
 *   rarity    : Common|Rare|Epic|Legendary|Mythic
 *   baseValue : number        — gold base price
 *   stats     : {}            — stat bonuses when equipped
 *   durability: number        — 0–100 (100 = new)
 *   modifiers : []            — passive effects
 *   element   : string        — fire|water|earth|wind|neutral
 *   description: string
 * }
 */

import { weightedPick, pick, randInt } from '../utils/random.js';

// ── Rarity weights for loot drops ────────────────────────────────────────────
export const RARITY_WEIGHTS = [
  { value: 'Common',    weight: 55 },
  { value: 'Rare',      weight: 25 },
  { value: 'Epic',      weight: 12 },
  { value: 'Legendary', weight: 6  },
  { value: 'Mythic',    weight: 2  },
];

// Rarity emojis
export const RARITY_EMOJI = {
  Common:    '⬜',
  Rare:      '🟦',
  Epic:      '🟪',
  Legendary: '🟨',
  Mythic:    '🔴',
};

// Rarity multipliers on base price
export const RARITY_PRICE_MULT = {
  Common:    1.0,
  Rare:      3.0,
  Epic:      8.0,
  Legendary: 25.0,
  Mythic:    100.0,
};

// ── Master Item Registry ──────────────────────────────────────────────────────

export const ITEMS = {
  // ── WEAPONS ─────────────────────────────────────────────────────────────

  iron_sword: {
    id: 'iron_sword', name: 'Iron Sword', type: 'weapon',
    rarity: 'Common', baseValue: 120, durability: 100,
    stats: { attack: 8 }, element: 'neutral',
    modifiers: [],
    description: 'A basic but reliable iron sword.',
  },

  flame_blade: {
    id: 'flame_blade', name: 'Flame Blade', type: 'weapon',
    rarity: 'Rare', baseValue: 450, durability: 100,
    stats: { attack: 18, speed: 2 }, element: 'fire',
    modifiers: [{ id: 'burn_chance', name: 'Burn Chance 15%', chance: 0.15 }],
    description: 'A sword wreathed in eternal fire.',
  },

  shadow_fang: {
    id: 'shadow_fang', name: 'Shadow Fang', type: 'weapon',
    rarity: 'Epic', baseValue: 1200, durability: 100,
    stats: { attack: 28, speed: 8 }, element: 'neutral',
    modifiers: [{ id: 'crit_up', name: 'Crit +10%', critBonus: 0.10 }],
    description: 'Forged in shadow. Strikes before enemies react.',
  },

  storm_bow: {
    id: 'storm_bow', name: 'Storm Bow', type: 'weapon',
    rarity: 'Rare', baseValue: 400, durability: 100,
    stats: { attack: 15, speed: 5 }, element: 'wind',
    modifiers: [{ id: 'pierce', name: 'Armor Pierce 10%', armorPierce: 0.10 }],
    description: 'Arrows fly like lightning.',
  },

  arcane_staff: {
    id: 'arcane_staff', name: 'Arcane Staff', type: 'weapon',
    rarity: 'Rare', baseValue: 480, durability: 100,
    stats: { attack: 20, maxMana: 40 }, element: 'neutral',
    modifiers: [{ id: 'mana_regen', name: 'Mana +5/turn', manaRegen: 5 }],
    description: 'Channels arcane power efficiently.',
  },

  void_scythe: {
    id: 'void_scythe', name: 'Void Scythe', type: 'weapon',
    rarity: 'Legendary', baseValue: 5000, durability: 100,
    stats: { attack: 55, speed: 10 }, element: 'neutral',
    modifiers: [
      { id: 'life_steal', name: 'Lifesteal 20%', lifeSteal: 0.20 },
      { id: 'crit_up', name: 'Crit +15%', critBonus: 0.15 },
    ],
    description: 'A weapon that devours the souls of the fallen.',
  },

  gods_edge: {
    id: 'gods_edge', name: "God's Edge", type: 'weapon',
    rarity: 'Mythic', baseValue: 50000, durability: 100,
    stats: { attack: 100, speed: 20, maxHp: 50 }, element: 'neutral',
    modifiers: [
      { id: 'divine_strike', name: 'Divine Strike +25%', critBonus: 0.25 },
      { id: 'true_damage', name: 'True Damage 10%', trueDamage: 0.10 },
    ],
    description: '⚡ A blade said to have split the sky itself.',
  },

  // ── ARMOR ───────────────────────────────────────────────────────────────

  leather_vest: {
    id: 'leather_vest', name: 'Leather Vest', type: 'armor',
    rarity: 'Common', baseValue: 80, durability: 100,
    stats: { defense: 6 }, element: 'neutral',
    modifiers: [],
    description: 'Light protection from beast claws.',
  },

  iron_plate: {
    id: 'iron_plate', name: 'Iron Plate', type: 'armor',
    rarity: 'Common', baseValue: 150, durability: 100,
    stats: { defense: 14, speed: -2 }, element: 'neutral',
    modifiers: [],
    description: 'Heavy iron plating. Slows you down.',
  },

  mage_robe: {
    id: 'mage_robe', name: 'Arcane Robe', type: 'armor',
    rarity: 'Rare', baseValue: 360, durability: 100,
    stats: { defense: 5, maxMana: 60, attack: 5 }, element: 'neutral',
    modifiers: [{ id: 'spell_amp', name: 'Spell +8%', spellAmp: 0.08 }],
    description: 'Woven from concentrated mana crystals.',
  },

  dragon_scale: {
    id: 'dragon_scale', name: 'Dragon Scale Armor', type: 'armor',
    rarity: 'Epic', baseValue: 2200, durability: 100,
    stats: { defense: 35, maxHp: 80 }, element: 'fire',
    modifiers: [{ id: 'fire_resist', name: 'Fire Resist 50%', fireResist: 0.50 }],
    description: 'Scales shed by an ancient fire dragon.',
  },

  void_plate: {
    id: 'void_plate', name: 'Void Plate', type: 'armor',
    rarity: 'Legendary', baseValue: 6000, durability: 100,
    stats: { defense: 60, maxHp: 150, speed: -3 }, element: 'neutral',
    modifiers: [{ id: 'damage_reduce', name: 'Dmg -15%', damageReduce: 0.15 }],
    description: 'Armor pulled from the void between worlds.',
  },

  // ── HELMETS ──────────────────────────────────────────────────────────────

  iron_helm: {
    id: 'iron_helm', name: 'Iron Helm', type: 'helmet',
    rarity: 'Common', baseValue: 90, durability: 100,
    stats: { defense: 5, maxHp: 10 }, element: 'neutral',
    modifiers: [],
    description: 'Protects the skull, mostly.',
  },

  crown_of_wisdom: {
    id: 'crown_of_wisdom', name: 'Crown of Wisdom', type: 'helmet',
    rarity: 'Epic', baseValue: 1800, durability: 100,
    stats: { maxMana: 100, attack: 10, defense: 8 }, element: 'neutral',
    modifiers: [{ id: 'exp_boost', name: 'EXP +10%', expBoost: 0.10 }],
    description: 'Said to amplify the mind of the wearer.',
  },

  // ── ACCESSORIES ──────────────────────────────────────────────────────────

  health_ring: {
    id: 'health_ring', name: 'Ring of Vitality', type: 'accessory',
    rarity: 'Common', baseValue: 100, durability: 100,
    stats: { maxHp: 30 }, element: 'neutral',
    modifiers: [],
    description: 'A warm ring that pulses with life energy.',
  },

  swift_amulet: {
    id: 'swift_amulet', name: 'Swift Amulet', type: 'accessory',
    rarity: 'Rare', baseValue: 320, durability: 100,
    stats: { speed: 10 }, element: 'wind',
    modifiers: [{ id: 'dodge_up', name: 'Dodge +8%', dodgeBonus: 0.08 }],
    description: 'Move like the wind.',
  },

  dragon_eye: {
    id: 'dragon_eye', name: "Dragon's Eye", type: 'accessory',
    rarity: 'Legendary', baseValue: 8000, durability: 100,
    stats: { attack: 20, speed: 15, maxHp: 50 }, element: 'fire',
    modifiers: [
      { id: 'crit_up', name: 'Crit +20%', critBonus: 0.20 },
      { id: 'burn_chance', name: 'Burn 25%', chance: 0.25 },
    ],
    description: 'The crystallized eye of a slain dragon.',
  },

  // ── CONSUMABLES ──────────────────────────────────────────────────────────

  health_potion: {
    id: 'health_potion', name: 'Health Potion', type: 'consumable',
    rarity: 'Common', baseValue: 50, durability: 1,
    stats: {}, element: 'neutral',
    modifiers: [{ id: 'heal', name: 'Restore 60 HP', healAmount: 60 }],
    description: 'Restores 60 HP instantly.',
  },

  mega_potion: {
    id: 'mega_potion', name: 'Mega Potion', type: 'consumable',
    rarity: 'Rare', baseValue: 180, durability: 1,
    stats: {}, element: 'neutral',
    modifiers: [{ id: 'heal', name: 'Restore 200 HP', healAmount: 200 }],
    description: 'Fully restores HP for most adventurers.',
  },

  mana_elixir: {
    id: 'mana_elixir', name: 'Mana Elixir', type: 'consumable',
    rarity: 'Rare', baseValue: 150, durability: 1,
    stats: {}, element: 'neutral',
    modifiers: [{ id: 'mana_restore', name: 'Restore 100 Mana', manaAmount: 100 }],
    description: 'Restores 100 mana immediately.',
  },

  elixir_of_power: {
    id: 'elixir_of_power', name: 'Elixir of Power', type: 'consumable',
    rarity: 'Epic', baseValue: 600, durability: 1,
    stats: {}, element: 'neutral',
    modifiers: [
      { id: 'heal',       name: 'Restore 300 HP',   healAmount: 300 },
      { id: 'mana_restore', name: 'Restore 150 Mana', manaAmount: 150 },
      { id: 'atk_buff',  name: 'ATK +20 (3 turns)', statBuff: { stat: 'attack', val: 20, turns: 3 } },
    ],
    description: 'The alchemist\'s masterwork.',
  },

  antidote: {
    id: 'antidote', name: 'Antidote', type: 'consumable',
    rarity: 'Common', baseValue: 40, durability: 1,
    stats: {}, element: 'neutral',
    modifiers: [{ id: 'cure_poison', name: 'Cures Poison', curesPoison: true }],
    description: 'Neutralizes all poisons.',
  },

  // ── MATERIALS ────────────────────────────────────────────────────────────

  wolf_fang: {
    id: 'wolf_fang', name: 'Wolf Fang', type: 'material',
    rarity: 'Common', baseValue: 25, durability: 100,
    stats: {}, modifiers: [],
    description: 'A sharp fang. Used in weapon crafting.',
  },

  dragon_scale_mat: {
    id: 'dragon_scale_mat', name: 'Dragon Scale (Material)', type: 'material',
    rarity: 'Epic', baseValue: 800, durability: 100,
    stats: {}, modifiers: [],
    description: 'Crafting material from dragon hide.',
  },

  void_crystal: {
    id: 'void_crystal', name: 'Void Crystal', type: 'material',
    rarity: 'Legendary', baseValue: 3000, durability: 100,
    stats: {}, modifiers: [],
    description: 'A crystallized fragment of nothingness.',
  },

  ancient_rune: {
    id: 'ancient_rune', name: 'Ancient Rune', type: 'material',
    rarity: 'Rare', baseValue: 200, durability: 100,
    stats: {}, modifiers: [],
    description: 'Inscribed by a forgotten civilization.',
  },

  monster_core: {
    id: 'monster_core', name: 'Monster Core', type: 'material',
    rarity: 'Rare', baseValue: 150, durability: 100,
    stats: {}, modifiers: [],
    description: 'The crystallized essence of a slain monster.',
  },
};

// ── Helper functions ─────────────────────────────────────────────────────────

export function getItem(id) {
  return ITEMS[id] || null;
}

export function allItems() {
  return Object.values(ITEMS);
}

/**
 * Roll a random rarity based on weights.
 * `luck` bonus shifts weights toward higher rarity.
 */
export function rollRarity(luckBonus = 0) {
  const weights = RARITY_WEIGHTS.map(w => ({
    ...w,
    weight: w.value === 'Common'
      ? Math.max(5, w.weight - luckBonus * 10)
      : w.weight + luckBonus * 2,
  }));
  return weightedPick(weights);
}

/**
 * Get all items of a specific type.
 */
export function itemsByType(type) {
  return allItems().filter(i => i.type === type);
}

/**
 * Get all items of a specific rarity.
 */
export function itemsByRarity(rarity) {
  return allItems().filter(i => i.rarity === rarity);
}

/**
 * Generate a random loot drop from monster/dungeon.
 * @param {number} level     - monster/dungeon level
 * @param {number} luckBonus - 0.0 to 1.0
 */
export function generateLoot(level, luckBonus = 0) {
  const rarity = rollRarity(luckBonus);
  const pool   = itemsByRarity(rarity);
  if (!pool.length) return null;
  const item = pick(pool);
  return { itemId: item.id, qty: 1, rarity };
}

/**
 * Format item for display.
 */
export function formatItem(itemId, qty = 1) {
  const item = getItem(itemId);
  if (!item) return `❓ Unknown (${itemId}) x${qty}`;
  const emoji = RARITY_EMOJI[item.rarity] || '⬜';
  return `${emoji} *${item.name}* x${qty} [${item.rarity}]`;
}

/**
 * Calculate the display value with rarity multiplier.
 */
export function itemDisplayValue(item) {
  return Math.floor(item.baseValue * RARITY_PRICE_MULT[item.rarity]);
}

export default {
  ITEMS, RARITY_WEIGHTS, RARITY_EMOJI, RARITY_PRICE_MULT,
  getItem, allItems, rollRarity, itemsByType, itemsByRarity,
  generateLoot, formatItem, itemDisplayValue,
};
