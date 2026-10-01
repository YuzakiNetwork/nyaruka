/**
 * lib/game/title.js
 * Title/Achievement System — Raih gelar dari pencapaian
 */

import { randInt } from '../utils/random.js';

export const TITLES = {
  // ── Pemula ─────────────────────────────────────────────────────────────────
  newcomer: {
    id: 'newcomer', name: '👶 Pendatang Baru', rarity: 'common',
    desc: 'Memulai petualangan.',
    condition: p => p.level >= 1,
    bonus: {},
  },
  first_blood: {
    id: 'first_blood', name: '🩸 First Blood', rarity: 'common',
    desc: 'Menang battle pertama.',
    condition: p => (p.stats?.wins || 0) >= 1,
    bonus: { attack: 2 },
  },
  // ── Battle ─────────────────────────────────────────────────────────────────
  slayer: {
    id: 'slayer', name: '⚔️ Slayer', rarity: 'uncommon',
    desc: 'Membunuh 50 monster.',
    condition: p => (p.stats?.monstersKilled || 0) >= 50,
    bonus: { attack: 5 },
  },
  monster_hunter: {
    id: 'monster_hunter', name: '🏹 Monster Hunter', rarity: 'rare',
    desc: 'Membunuh 300 monster.',
    condition: p => (p.stats?.monstersKilled || 0) >= 300,
    bonus: { attack: 15, speed: 5 },
  },
  genocide: {
    id: 'genocide', name: '💀 Genocider', rarity: 'epic',
    desc: 'Membunuh 1000 monster.',
    condition: p => (p.stats?.monstersKilled || 0) >= 1000,
    bonus: { attack: 30, critBonus: 0.05 },
  },
  dragon_slayer: {
    id: 'dragon_slayer', name: '🐉 Dragon Slayer', rarity: 'legendary',
    desc: 'Mengalahkan Ancient Dragon.',
    condition: p => (p.stats?.bossesKilled?.includes('ancient_dragon')),
    bonus: { attack: 50, defense: 20, hp: 100 },
  },
  lich_bane: {
    id: 'lich_bane', name: '☠️ Lich Bane', rarity: 'legendary',
    desc: 'Mengalahkan Void Lich.',
    condition: p => (p.stats?.bossesKilled?.includes('void_lich')),
    bonus: { mana: 200, attack: 40 },
  },
  // ── Dungeon ────────────────────────────────────────────────────────────────
  dungeon_crawler: {
    id: 'dungeon_crawler', name: '🏰 Dungeon Crawler', rarity: 'uncommon',
    desc: 'Menyelesaikan 10 dungeon.',
    condition: p => (p.stats?.dungeonsCleared || 0) >= 10,
    bonus: { defense: 8 },
  },
  dungeon_lord: {
    id: 'dungeon_lord', name: '👑 Dungeon Lord', rarity: 'epic',
    desc: 'Menyelesaikan 100 dungeon.',
    condition: p => (p.stats?.dungeonsCleared || 0) >= 100,
    bonus: { defense: 25, hp: 150 },
  },
  // ── Ekonomi ────────────────────────────────────────────────────────────────
  merchant: {
    id: 'merchant', name: '💰 Pedagang', rarity: 'common',
    desc: 'Mengumpulkan 5.000 gold.',
    condition: p => (p.gold || 0) >= 5000,
    bonus: {},
  },
  millionaire: {
    id: 'millionaire', name: '💎 Jutawan', rarity: 'rare',
    desc: 'Mengumpulkan 100.000 gold.',
    condition: p => (p.gold || 0) >= 100000,
    bonus: { luck: 5 },
  },
  // ── Level & Job ────────────────────────────────────────────────────────────
  half_century: {
    id: 'half_century', name: '⭐ Petarung Veteran', rarity: 'rare',
    desc: 'Mencapai level 50.',
    condition: p => (p.level || 0) >= 50,
    bonus: { hp: 80, attack: 10, defense: 10 },
  },
  max_level: {
    id: 'max_level', name: '🌟 Puncak Kekuatan', rarity: 'legendary',
    desc: 'Mencapai level 100.',
    condition: p => (p.level || 0) >= 100,
    bonus: { hp: 200, attack: 30, defense: 30, mana: 100, speed: 20 },
  },
  pinnacle_class: {
    id: 'pinnacle_class', name: '🏆 Kelas Tertinggi', rarity: 'legendary',
    desc: 'Mencapai Tier 4 Job Advancement.',
    condition: p => (JOB_TREE_TIERS[p.job] || 0) >= 4,
    bonus: { attack: 40, defense: 20, speed: 20, hp: 150 },
  },
  // ── PvP ────────────────────────────────────────────────────────────────────
  duelist: {
    id: 'duelist', name: '⚔️ Duelist', rarity: 'uncommon',
    desc: 'Menang 10 duel.',
    condition: p => (p.stats?.pvpWins || 0) >= 10,
    bonus: { attack: 5, speed: 5 },
  },
  pvp_king: {
    id: 'pvp_king', name: '👑 PvP King', rarity: 'epic',
    desc: 'Menang 100 duel.',
    condition: p => (p.stats?.pvpWins || 0) >= 100,
    bonus: { attack: 20, speed: 15, critBonus: 0.03 },
  },
  // ── Spesial ────────────────────────────────────────────────────────────────
  streaker: {
    id: 'streaker', name: '🔥 Streak Master', rarity: 'rare',
    desc: 'Daily streak 30 hari berturut-turut.',
    condition: p => (p.dailyStreak || 0) >= 30,
    bonus: { luck: 10 },
  },
  world_savior: {
    id: 'world_savior', name: '🌍 World Savior', rarity: 'legendary',
    desc: 'Berpartisipasi mengalahkan World Boss.',
    condition: p => (p.stats?.worldBossKills || 0) >= 1,
    bonus: { hp: 300, attack: 50, defense: 30, mana: 150 },
  },
  guild_master: {
    id: 'guild_master', name: '🏛️ Pemimpin Guild', rarity: 'epic',
    desc: 'Mendirikan dan memimpin guild.',
    condition: p => !!p.guildId && p.guildRole === 'master',
    bonus: { hp: 100, attack: 15, defense: 15 },
  },
};

// Helper untuk pinnacle_class check
const JOB_TREE_TIERS = {
  'Dragon Knight': 4, 'Chaos Lord': 4, 'Transcendent': 4, 'Lich King': 4,
  'God Archer': 4, 'Wild Emperor': 4, 'Death God': 4, 'Sin Eater': 4,
};

export const RARITY_COLOR = {
  common: '⬜', uncommon: '🟩', rare: '🟦', epic: '🟪', legendary: '🟨',
};

// ── Cek & berikan title baru ──────────────────────────────────────────────────
export function checkTitles(player) {
  if (!player.earnedTitles) player.earnedTitles = [];

  const newTitles = [];
  for (const [id, title] of Object.entries(TITLES)) {
    if (player.earnedTitles.includes(id)) continue;
    try {
      if (title.condition(player)) {
        player.earnedTitles.push(id);
        newTitles.push(title);
      }
    } catch {}
  }
  return newTitles;
}

// ── Hitung total bonus dari equipped title ─────────────────────────────────
export function getTitleBonus(player) {
  const bonus = { hp: 0, attack: 0, defense: 0, mana: 0, speed: 0, luck: 0, critBonus: 0 };
  if (!player.activeTitle) return bonus;
  const title = TITLES[player.activeTitle];
  if (!title?.bonus) return bonus;
  for (const [k, v] of Object.entries(title.bonus)) {
    if (bonus[k] !== undefined) bonus[k] += v;
  }
  return bonus;
}

export default { TITLES, RARITY_COLOR, checkTitles, getTitleBonus };
