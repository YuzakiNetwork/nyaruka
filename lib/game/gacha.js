/**
 * lib/game/gacha.js
 * Gacha System — Random summon dengan rarity berbeda
 *
 * Perubahan utama:
 * - Definisi item (stat, tipe, efek) ada di lib/game/item.js (ITEMS).
 *   File ini hanya menyimpan daftar drop: [id, tier, bobot].
 *   Dengan begitu getItem() di inventory/heal/craft mengenali semua item gacha.
 * - Rate per tier PERSIS sesuai RARITY_INFO.totalRate (sebelumnya terdistorsi
 *   karena total dropRate > 1). Peluang item = rate tier × bobot / total bobot tier.
 * - Pity dihitung PER PULL (single maupun 10×).
 *
 * GACHA_POOL tetap diekspor dengan bentuk lama (dipakai summon.js):
 *   { ...dataItem, rarity: 'SSR'|'SR'|'R'|'N', dropRate (pecahan), weight }
 *
 * ✅ FIX: formatGachaResult sekarang tampilkan emoji item, bukan kotak rarity
 */

import { ITEMS } from './item.js';

// ── Konfigurasi ───────────────────────────────────────────────────────────[...]
export const PITY_LIMIT = 100;   // pull ke-100 tanpa SSR dijamin SSR

// ── Rarity info ───────────────────────────────────────────────────────────[...]
// totalRate dalam persen; total harus 100.
export const RARITY_INFO = {
  SSR: { color: '🟨', name: 'Ultra Rare', totalRate: 0.5  },
  SR:  { color: '🟦', name: 'Super Rare', totalRate: 5    },
  R:   { color: '🟩', name: 'Rare',       totalRate: 30   },
  N:   { color: '⬜', name: 'Normal',     totalRate: 64.5 },
};

// ── Gacha cost ───────────────────────────────────────────────────────────[...]
export const GACHA_COST = {
  single: 100,     // 100 gold per pull
  multi:  900,     // 10x pull = 900 gold (diskon 10%)
};

// ── Daftar drop: [itemId, tier, bobot dalam tier] ─────────────────────────────
// ID harus ada di ITEMS (lib/game/item.js).
const POOL_DEF = [
  // SSR
  ['excalibur',       'SSR', 10],
  ['dragon_slayer',   'SSR', 15],
  ['dragon_armor',    'SSR', 10],
  ['ring_of_gods',    'SSR', 5 ],
  ['phoenix_feather', 'SSR', 8 ],
  ['elixir',          'SSR', 20],
  ['bahamut',         'SSR', 3 ],
  ['ifrit',           'SSR', 5 ],
  ['shiva',           'SSR', 5 ],

  // SR
  ['heavenly_sword',      'SR', 200],
  ['inferno_blade',       'SR', 250],
  ['mythril_armor',       'SR', 200],
  ['demon_ring',          'SR', 250],
  ['elf_boots',           'SR', 300],
  ['hyper_potion',        'SR', 400],
  ['greater_mana_elixir', 'SR', 300],
  ['exp_booster',         'SR', 250],
  ['fenrir',              'SR', 150],
  ['carbuncle',           'SR', 200],

  // R
  ['knight_sword', 'R', 1500],
  ['steel_sword',  'R', 1200],
  ['plate_armor',  'R', 1500],
  ['silver_ring',  'R', 1200],
  ['super_potion', 'R', 1500],
  ['goblin',       'R', 1500],

  // N
  ['rusty_sword',   'N', 3500],
  ['leather_armor', 'N', 4000],
  ['iron_boots',    'N', 3000],
  ['potion',        'N', 4000],
  ['slime',         'N', 5000],
];

// ── Bangun GACHA_POOL dari ITEMS ──────────────────────────────────────────────
const tierWeight = {};
for (const [, tier, w] of POOL_DEF) tierWeight[tier] = (tierWeight[tier] || 0) + w;

export const GACHA_POOL = {};
const POOL_BY_TIER = { SSR: [], SR: [], R: [], N: [] };

for (const [id, tier, weight] of POOL_DEF) {
  const base = ITEMS[id];
  if (!base) {
    throw new Error(`[gacha] Item "${id}" belum terdaftar di ITEMS (lib/game/item.js)`);
  }
  if (!RARITY_INFO[tier]) throw new Error(`[gacha] Tier tidak dikenal: ${tier}`);

  const entry = {
    ...base,
    itemRarity: base.rarity,                     // rarity registry (Legendary, dst.)
    rarity:     tier,                            // tier gacha (SSR/SR/R/N)
    weight,
    dropRate:   (RARITY_INFO[tier].totalRate / 100) * (weight / tierWeight[tier]),
  };
  GACHA_POOL[id] = entry;
  POOL_BY_TIER[tier].push(entry);
}

// ── Roll helper ───────────────────────────────────────────────────────────[...]
function rollTier() {
  const r = Math.random() * 100;
  let cum = 0;
  for (const [tier, info] of Object.entries(RARITY_INFO)) {
    cum += info.totalRate;
    if (r < cum) return tier;
  }
  return 'N';
}

function rollFromTier(tier) {
  const items = POOL_BY_TIER[tier];
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight;
    if (r < 0) return item;
  }
  return items[items.length - 1];
}

// ── Pity ─────────────────────────────────────────────────────────────[...]
// gachaPity = jumlah pull berturut-turut TANPA SSR.
// Saat sudah PITY_LIMIT - 1, pull berikutnya (ke-100) dijamin SSR.

/** Mengembalikan item SSR jaminan jika pity penuh, selain itu null. */
export function checkPity(player) {
  if (!player.gachaPity) player.gachaPity = 0;
  return player.gachaPity >= PITY_LIMIT - 1 ? { ...rollFromTier('SSR') } : null;
}

/** Panggil SEKALI PER PULL. */
export function incrementPity(player, gotSSR) {
  if (!player.gachaPity) player.gachaPity = 0;
  if (gotSSR) player.gachaPity = 0;
  else        player.gachaPity += 1;
}

// ── Roll gacha ───────────────────────────────────────────────────────────[...]
/**
 * @param {number} count   jumlah pull
 * @param {object} [player] jika diberikan, pity dihitung & di-update per pull
 * @returns {object[]} hasil; item pity ditandai pityTriggered: true
 */
export function rollGacha(count = 1, player = null) {
  const results = [];

  for (let i = 0; i < count; i++) {
    let item;
    let pityTriggered = false;

    const forced = player ? checkPity(player) : null;
    if (forced) {
      item = forced;
      pityTriggered = true;
    } else {
      item = { ...rollFromTier(rollTier()) };
    }

    if (player) incrementPity(player, item.rarity === 'SSR');
    results.push({ ...item, pityTriggered });
  }

  return results;
}

// ── Format hasil gacha ────────────────────────────────────────────────────────
// ✅ FIXED: Sekarang prioritas emoji item, bukan rarity color box
export function formatGachaResult(results) {
  const lines = ['🎰 *GACHA RESULT* 🎰', '━━━━━━━━━━━━━━━━━━━'];

  // Kelompokkan per tier, gabungkan duplikat (×n)
  const byTier = { SSR: new Map(), SR: new Map(), R: new Map(), N: new Map() };
  for (const item of results) {
    const group = byTier[item.rarity];
    if (!group) continue;
    const entry = group.get(item.id) || { item, n: 0, pity: false };
    entry.n += 1;
    entry.pity = entry.pity || Boolean(item.pityTriggered);
    group.set(item.id, entry);
  }

  for (const [tier, group] of Object.entries(byTier)) {
    if (!group.size) continue;
    const info = RARITY_INFO[tier];
    lines.push(`\n${info.color} *${tier}* (${info.name})`);
    for (const { item, n, pity } of group.values()) {
      // ✅ PRIORITY: emoji item dahulu, fallback ke rarity color jika tidak ada
      const emoji = item.emoji || info.color;
      lines.push(`  ${emoji} *${item.name}*${n > 1 ? ` ×${n}` : ''}${pity ? ' 🎁' : ''}`);
    }
  }

  lines.push('\n━━━━━━━━━━━━━━━━━━━');
  return lines.join('\n');
}

// ── Get item dari gacha pool ──────────────────────────────────────────────────
export function getGachaItem(id) {
  return GACHA_POOL[id] || null;
}

export default {
  GACHA_POOL, RARITY_INFO, GACHA_COST, PITY_LIMIT,
  rollGacha, checkPity, incrementPity,
  formatGachaResult, getGachaItem,
};
