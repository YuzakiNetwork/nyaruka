/**
 * lib/game/gacha.js
 * Gacha System — Random summon dengan rarity berbeda
 */

import { randInt, chance, weightedPick } from '../utils/random.js';

// ── Gacha Pool ────────────────────────────────────────────────────────────────
export const GACHA_POOL = {
  // ═══════════════════════════════════════════════════════════════════════════
  //  WEAPONS — SSR/SR/R/N
  // ═══════════════════════════════════════════════════════════════════════════
  excalibur: {
    id: 'excalibur', name: '⚔️ Excalibur', type: 'weapon', rarity: 'SSR',
    desc: 'Pedang legendaris Raja Arthur. ATK +150, sinar cahaya suci.',
    stats: { attack: 150, hp: 100 },
    dropRate: 0.001,  // 0.1%
    emoji: '⚔️✨',
  },
  dragon_slayer: {
    id: 'dragon_slayer', name: '🐉 Dragon Slayer', type: 'weapon', rarity: 'SSR',
    desc: 'Pedang raksasa pembunuh naga.',
    stats: { attack: 140, defense: 30 },
    dropRate: 0.0015,
    emoji: '⚔️🐉',
  },
  heavenly_sword: {
    id: 'heavenly_sword', name: '✨ Heavenly Sword', type: 'weapon', rarity: 'SR',
    desc: 'Pedang dari langit. ATK +80.',
    stats: { attack: 80, speed: 10 },
    dropRate: 0.02,   // 2%
    emoji: '⚔️',
  },
  flame_blade: {
    id: 'flame_blade', name: '🔥 Flame Blade', type: 'weapon', rarity: 'SR',
    desc: 'Pedang api. ATK +70.',
    stats: { attack: 70, hp: 50 },
    dropRate: 0.025,
    emoji: '🔥⚔️',
  },
  iron_sword: {
    id: 'iron_sword', name: 'Iron Sword', type: 'weapon', rarity: 'R',
    desc: 'Pedang besi biasa.',
    stats: { attack: 35 },
    dropRate: 0.15,   // 15%
    emoji: '⚔️',
  },
  steel_sword: {
    id: 'steel_sword', name: 'Steel Sword', type: 'weapon', rarity: 'R',
    desc: 'Pedang baja berkualitas.',
    stats: { attack: 45, defense: 5 },
    dropRate: 0.12,
    emoji: '⚔️',
  },
  rusty_sword: {
    id: 'rusty_sword', name: 'Rusty Sword', type: 'weapon', rarity: 'N',
    desc: 'Pedang berkarat.',
    stats: { attack: 15 },
    dropRate: 0.35,   // 35%
    emoji: '⚔️',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  ARMORS
  // ═══════════════════════════════════════════════════════════════════════════
  dragon_armor: {
    id: 'dragon_armor', name: '🐲 Dragon Armor', type: 'armor', rarity: 'SSR',
    desc: 'Armor dari sisik naga kuno.',
    stats: { defense: 120, hp: 300 },
    dropRate: 0.001,
    emoji: '🛡️🐉',
  },
  mythril_armor: {
    id: 'mythril_armor', name: '✨ Mythril Armor', type: 'armor', rarity: 'SR',
    desc: 'Armor mythril ringan tapi kuat.',
    stats: { defense: 60, speed: 15 },
    dropRate: 0.02,
    emoji: '🛡️',
  },
  plate_armor: {
    id: 'plate_armor', name: 'Plate Armor', type: 'armor', rarity: 'R',
    desc: 'Armor pelat baja.',
    stats: { defense: 30, hp: 50 },
    dropRate: 0.15,
    emoji: '🛡️',
  },
  leather_armor: {
    id: 'leather_armor', name: 'Leather Armor', type: 'armor', rarity: 'N',
    desc: 'Armor kulit sederhana.',
    stats: { defense: 12 },
    dropRate: 0.40,
    emoji: '🛡️',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  ACCESSORIES
  // ═══════════════════════════════════════════════════════════════════════════
  ring_of_gods: {
    id: 'ring_of_gods', name: '💍 Ring of Gods', type: 'ring', rarity: 'SSR',
    desc: 'Cincin para dewa. All stats +50.',
    stats: { attack: 50, defense: 50, hp: 150, mana: 150, speed: 20 },
    dropRate: 0.0005,
    emoji: '💍✨',
  },
  phoenix_feather: {
    id: 'phoenix_feather', name: '🪶 Phoenix Feather', type: 'offhand', rarity: 'SSR',
    desc: 'Bulu phoenix. Revive 1x saat mati.',
    stats: { hp: 200, mana: 100 },
    dropRate: 0.0008,
    emoji: '🪶🔥',
  },
  demon_ring: {
    id: 'demon_ring', name: '💀 Demon Ring', type: 'ring', rarity: 'SR',
    desc: 'Cincin iblis. ATK +40, HP -20.',
    stats: { attack: 40, hp: -20 },
    dropRate: 0.025,
    emoji: '💍💀',
  },
  elf_boots: {
    id: 'elf_boots', name: '👢 Elf Boots', type: 'boots', rarity: 'SR',
    desc: 'Sepatu elf. Speed +30.',
    stats: { speed: 30 },
    dropRate: 0.03,
    emoji: '👢✨',
  },
  silver_ring: {
    id: 'silver_ring', name: 'Silver Ring', type: 'ring', rarity: 'R',
    desc: 'Cincin perak.',
    stats: { mana: 30 },
    dropRate: 0.12,
    emoji: '💍',
  },
  iron_boots: {
    id: 'iron_boots', name: 'Iron Boots', type: 'boots', rarity: 'N',
    desc: 'Sepatu besi berat.',
    stats: { defense: 8, speed: -2 },
    dropRate: 0.30,
    emoji: '👢',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  POTIONS & CONSUMABLES
  // ═══════════════════════════════════════════════════════════════════════════
  elixir: {
    id: 'elixir', name: '⚗️ Elixir', type: 'potion', rarity: 'SSR',
    desc: 'Restore full HP & MP. Bisa disimpan.',
    effect: { hp: 9999, mana: 9999 },
    dropRate: 0.002,
    emoji: '⚗️✨',
    consumable: true,
  },
  mega_potion: {
    id: 'mega_potion', name: '🧪 Mega Potion', type: 'potion', rarity: 'SR',
    desc: 'Restore 500 HP.',
    effect: { hp: 500 },
    dropRate: 0.04,
    emoji: '🧪',
    consumable: true,
  },
  super_potion: {
    id: 'super_potion', name: '🧪 Super Potion', type: 'potion', rarity: 'R',
    desc: 'Restore 200 HP.',
    effect: { hp: 200 },
    dropRate: 0.15,
    emoji: '🧪',
    consumable: true,
  },
  potion: {
    id: 'potion', name: '🧪 Potion', type: 'potion', rarity: 'N',
    desc: 'Restore 50 HP.',
    effect: { hp: 50 },
    dropRate: 0.40,
    emoji: '🧪',
    consumable: true,
  },
  mana_elixir: {
    id: 'mana_elixir', name: '💧 Mana Elixir', type: 'potion', rarity: 'SR',
    desc: 'Restore 300 Mana.',
    effect: { mana: 300 },
    dropRate: 0.03,
    emoji: '💧',
    consumable: true,
  },
  exp_booster: {
    id: 'exp_booster', name: '⭐ EXP Booster', type: 'consumable', rarity: 'SR',
    desc: 'Double EXP selama 1 jam.',
    effect: { expBoost: 2.0, duration: 3600 },
    dropRate: 0.025,
    emoji: '⭐',
    consumable: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  SUMMONS (khusus Summoner)
  // ═══════════════════════════════════════════════════════════════════════════
  bahamut: {
    id: 'bahamut', name: '🐉 Bahamut', type: 'summon', rarity: 'SSR',
    desc: 'Raja Naga. Summon terkuat.',
    stats: { attack: 200, hp: 500, defense: 100 },
    dropRate: 0.0003,   // 0.03% — ultra rare
    emoji: '🐉✨',
    summonPower: 1000,
  },
  ifrit: {
    id: 'ifrit', name: '🔥 Ifrit', type: 'summon', rarity: 'SSR',
    desc: 'Raja Api.',
    stats: { attack: 180, hp: 400, defense: 80 },
    dropRate: 0.0005,
    emoji: '🔥👹',
    summonPower: 900,
  },
  shiva: {
    id: 'shiva', name: '❄️ Shiva', type: 'summon', rarity: 'SSR',
    desc: 'Ratu Es.',
    stats: { attack: 170, hp: 450, defense: 90 },
    dropRate: 0.0005,
    emoji: '❄️👸',
    summonPower: 850,
  },
  fenrir: {
    id: 'fenrir', name: '🐺 Fenrir', type: 'summon', rarity: 'SR',
    desc: 'Serigala dewa.',
    stats: { attack: 100, hp: 250, speed: 50 },
    dropRate: 0.015,
    emoji: '🐺',
    summonPower: 500,
  },
  carbuncle: {
    id: 'carbuncle', name: '💎 Carbuncle', type: 'summon', rarity: 'SR',
    desc: 'Makhluk kristal lucu.',
    stats: { defense: 80, hp: 200, mana: 100 },
    dropRate: 0.02,
    emoji: '💎',
    summonPower: 400,
  },
  goblin: {
    id: 'goblin', name: '👺 Goblin', type: 'summon', rarity: 'R',
    desc: 'Goblin kecil.',
    stats: { attack: 40, hp: 80 },
    dropRate: 0.15,
    emoji: '👺',
    summonPower: 150,
  },
  slime: {
    id: 'slime', name: '🟢 Slime', type: 'summon', rarity: 'N',
    desc: 'Slime lemah.',
    stats: { hp: 50, defense: 20 },
    dropRate: 0.50,
    emoji: '🟢',
    summonPower: 50,
  },
};

// ── Rarity info ───────────────────────────────────────────────────────────────
export const RARITY_INFO = {
  SSR: { color: '🟨', name: 'Ultra Rare',   totalRate: 0.5  },  // 0.5%
  SR:  { color: '🟦', name: 'Super Rare',   totalRate: 5    },  // 5%
  R:   { color: '🟩', name: 'Rare',         totalRate: 30   },  // 30%
  N:   { color: '⬜', name: 'Normal',       totalRate: 64.5 },  // 64.5%
};

// ── Gacha cost ────────────────────────────────────────────────────────────────
export const GACHA_COST = {
  single: 100,     // 100 gold per pull
  multi:  900,     // 10x pull = 900 gold (diskon 10%)
};

// ── Roll gacha ────────────────────────────────────────────────────────────────
export function rollGacha(count = 1) {
  const results = [];
  const pool    = Object.values(GACHA_POOL);

  // Normalize drop rates (jika total > 1, scale down)
  const totalRate = pool.reduce((sum, item) => sum + item.dropRate, 0);
  const scaleFactor = totalRate > 1 ? 1 / totalRate : 1;

  for (let i = 0; i < count; i++) {
    // Weighted random
    const rand = Math.random();
    let cumulative = 0;

    for (const item of pool) {
      cumulative += item.dropRate * scaleFactor;
      if (rand <= cumulative) {
        results.push({ ...item });
        break;
      }
    }

    // Fallback jika somehow tidak dapat apapun (shouldn't happen)
    if (results.length === i) {
      results.push({ ...GACHA_POOL.potion });
    }
  }

  return results;
}

// ── Pity system (opsional) ────────────────────────────────────────────────────
// Setelah N pull tanpa SSR, dijamin SSR
export function checkPity(player) {
  if (!player.gachaPity) player.gachaPity = 0;

  // Setiap 100 pull tanpa SSR, force SSR
  if (player.gachaPity >= 100) {
    const ssrPool = Object.values(GACHA_POOL).filter(item => item.rarity === 'SSR');
    const forced  = ssrPool[randInt(0, ssrPool.length - 1)];
    player.gachaPity = 0;
    return forced;
  }

  return null;
}

export function incrementPity(player, gotSSR) {
  if (!player.gachaPity) player.gachaPity = 0;
  if (gotSSR) {
    player.gachaPity = 0;
  } else {
    player.gachaPity += 1;
  }
}

// ── Format hasil gacha ────────────────────────────────────────────────────────
export function formatGachaResult(results) {
  const lines = ['🎰 *GACHA RESULT* 🎰', '━━━━━━━━━━━━━━━━━━━'];

  // Group by rarity
  const byRarity = { SSR: [], SR: [], R: [], N: [] };
  for (const item of results) {
    byRarity[item.rarity]?.push(item);
  }

  for (const [rarity, items] of Object.entries(byRarity)) {
    if (!items.length) continue;
    const info = RARITY_INFO[rarity];
    lines.push(`\n${info.color} *${rarity}* (${info.name})`);
    for (const item of items) {
      lines.push(`  ${item.emoji} ${item.name}`);
    }
  }

  lines.push('\n━━━━━━━━━━━━━━━━━━━');
  return lines.join('\n');
}

// ── Get item dari gacha pool ──────────────────────────────────────────────────
export function getGachaItem(id) {
  return GACHA_POOL[id];
}

export default {
  GACHA_POOL, RARITY_INFO, GACHA_COST,
  rollGacha, checkPity, incrementPity,
  formatGachaResult, getGachaItem,
};
