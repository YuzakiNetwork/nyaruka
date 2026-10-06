/**
 * commands/rpg/profile.js
 * 
 * Enhanced Player Profile & Level Command (MERGED)
 * - Menampilkan profil lengkap + statistik detail
 * - Stats dihitung dengan bonus equipment
 * - Menampilkan status user (Owner, Developer, Premium, Normal)
 * 
 * Usage:
 *   !profile / !level / !stats / !stat / !me [@user]
 *   .profile / .level / .stats (alias dengan prefix berbeda)
 */

import { getPlayer, hasItem, expRequired, calcRank, effectiveStats } from '../../lib/game/player.js';
import { ITEMS } from '../../lib/game/item.js';
import { JOB_TREE, getTierName } from '../../lib/game/job.js';
import { TITLES, RARITY_COLOR } from '../../lib/game/title.js';
import { getPet, PET_TYPES } from '../../lib/game/pet.js';
import { getGuild } from '../../lib/game/guild.js';
import { normalizeJid } from '../../handler/index.js';
import { isOwner, config } from '../../config.js';
import { RECIPES } from './craft.js';

// ── Zone info ──────────────────────────────────────────────────────────────
const ZONES = {
  village: { name: '🏘️ Desa Pemula' },
  forest: { name: '🌲 Hutan Kuno' },
  cave: { name: '🏔️ Gua Kristal' },
  volcano: { name: '🌋 Kawah Api Abadi' },
  shadow_realm: { name: '🌑 Alam Bayangan' },
  sky_citadel: { name: '☁️ Benteng Langit' },
  void_abyss: { name: '🕳️ Jurang Ketiadaan' },
};

// ── Helper functions ───────────────────────────────────────────────────────
function bar(current, max, size = 10) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, current / max)) : 0;
  const filled = Math.round(ratio * size);
  return '█'.repeat(filled) + '░'.repeat(size - filled);
}

const fmt = (n) => Number(n || 0).toLocaleString('id-ID');

const RANK_STEPS = [
  { rank: 'E', minLevel: 0 },
  { rank: 'D', minLevel: 10 },
  { rank: 'C', minLevel: 25 },
  { rank: 'B', minLevel: 50 },
  { rank: 'A', minLevel: 75 },
  { rank: 'S', minLevel: 90 },
];

const AWAKEN_LEVELS = [30, 60, 90];

// ── Get user status dengan emoji ───────────────────────────────────────────
function getUserStatus(jid) {
  // Developer list (hardcoded atau dari env)
  const developerIds = [
    // Tambahkan ID developer di sini
  ];
  
  // Owner check
  if (isOwner(jid)) {
    return { emoji: '👑', label: 'Owner', color: '🟨' };
  }
  
  // Developer check
  if (developerIds.includes(jid)) {
    return { emoji: '⚙️', label: 'Developer', color: '🟦' };
  }
  
  // Premium check (dari player data akan ditambahkan kemudian)
  // TODO: Tambahkan field premium di player schema
  
  // Normal user
  return { emoji: '👤', label: 'Rakyat', color: '⬜' };
}

let handler = async (m, { args }) => {
  // Target: player yang di-mention (contextInfo), atau diri sendiri
  const mentionedJids = m.raw?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  const targetId = mentionedJids[0] ? normalizeJid(mentionedJids[0]) : m.sender;
  const isSelf = targetId === m.sender;
  const player = getPlayer(targetId);

  if (!player) {
    return m.reply(
      isSelf
        ? `❌ Daftar dulu: *!register <nama> <class>*`
        : `❌ Player tersebut belum terdaftar.`
    );
  }

  // ── Hitung stats dengan bonus equipment ─────────────────────────────────
  const stats = effectiveStats(player, ITEMS);
  const s = player.stats || {};
  const expNeeded = player.expToNext || expRequired(player.level);
  const expPct = Math.min(100, Math.floor(((player.exp || 0) / expNeeded) * 100));

  // ── Status user (Owner/Dev/Premium/Normal) ─────────────────────────────
  const userStatus = getUserStatus(targetId);
  
  // ── Rank berikutnya ────────────────────────────────────────────────────
  const currentRank = calcRank(player.level);
  const nextRank = RANK_STEPS.find(r => r.minLevel > player.level);
  const rankLine = nextRank
    ? `Rank berikut: *${nextRank.rank}* (Lv.${nextRank.minLevel}, kurang ${nextRank.minLevel - player.level} level)`
    : `🏅 Rank tertinggi tercapai!`;

  // ── Awakening ──────────────────────────────────────────────────────────
  const awTier = player.awakeningTier || 0;
  const nextAwLv = AWAKEN_LEVELS[awTier];
  let awakenLine;
  if (awTier > 0 && nextAwLv === undefined) {
    awakenLine = `🔱 Awakening: *III — ${player.awakeningName || 'Setara Dewa'}* (maks)`;
  } else {
    const current = awTier > 0 ? `*${'I'.repeat(awTier)} — ${player.awakeningName || '-'}*` : `*Belum*`;
    const ready = player.level >= nextAwLv ? ` ⚡ _siap! gunakan !awaken now_` : ` (Lv.${nextAwLv})`;
    awakenLine = `⚡ Awakening: ${current}\n   Berikutnya: Awakening ${'I'.repeat(awTier + 1)}${ready}`;
  }

  // ── Job info ───────────────────────────────────────────────────────────
  const jobData = JOB_TREE[player.job || player.class];
  const zone = ZONES[player.currentZone || 'village'] || ZONES.village;
  const job = player.job && player.job !== player.class
    ? `${player.class} → ${player.job}`
    : player.class;

  // ── Pet & Summon ───────────────────────────────────────────────────────
  const pet = getPet(targetId);
  const petType = pet?.active ? PET_TYPES[pet.typeId] : null;
  const summon = player.activeSummon?.uses > 0 ? player.activeSummon : null;

  // ── Guild ──────────────────────────────────────────────────────────────
  const guild = player.guildId ? getGuild(player.guildId) : null;
  const title = player.activeTitle ? TITLES[player.activeTitle] : null;

  // ── PvP Stats ──────────────────────────────────────────────────────────
  const pvpWins = s.pvpWins || 0;
  const pvpLosses = s.pvpLosses || 0;
  const pvpTotal = pvpWins + pvpLosses;
  const pvpRate = pvpTotal > 0 ? Math.round((pvpWins / pvpTotal) * 100) : 0;

  // ── Crafting (data dari craft.js) ──────────────────────────────────────
  const recipes = Object.values(RECIPES);
  const readyRecipe = recipes.filter(r =>
    r.materials.every(mat => hasItem(player, mat.itemId, mat.qty))
  );

  const craftLines = [
    `🔨 *CRAFTING*`,
    `⚒️ Berhasil craft : ${fmt(s.craftCount)}`,
    `📖 Resep siap     : ${readyRecipe.length} / ${recipes.length}`,
  ];

  // Detail resep siap hanya untuk profil sendiri
  if (isSelf && readyRecipe.length) {
    const shown = readyRecipe.slice(0, 3).map(r => r.name).join(', ');
    const extra = readyRecipe.length > 3 ? ` +${readyRecipe.length - 3} lagi` : '';
    craftLines.push(`   ${shown}${extra}`, `   _ketik !craft untuk membuat_`);
  }

  // ── Build output ───────────────────────────────────────────────────────
  const titleStr = player.activeTitle ? `『${player.activeTitle}』 ` : '';
  
  const lines = [
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `${userStatus.emoji} *${userStatus.label.toUpperCase()}* | 👤 *${player.name}*`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `${titleStr ? `🏵️ ${titleStr}` : ''}🎭 Class: *${job}* ${jobData?.emoji || '⚔️'}`,
    `🏅 Rank: *${currentRank}* | ⭐ Level: *${player.level}*`,
    `📍 Zona: ${zone.name}`,
    ``,
    `📊 *EXP & PROGRESSION*`,
    `📈 EXP: ${fmt(player.exp)} / ${fmt(expNeeded)} (${expPct}%)`,
    `   [${bar(player.exp || 0, expNeeded)}]`,
    `   ${rankLine}`,
    ``,
    awakenLine,
    ``,
    `❤️ *STATS* (dengan bonus equipment)`,
    `   HP   : ${fmt(stats.maxHp)} [${bar(player.hp, player.maxHp)}] ${fmt(player.hp)}/${fmt(stats.maxHp)}`,
    `   Mana : ${fmt(stats.maxMana)} [${bar(player.mana, player.maxMana)}] ${fmt(player.mana)}/${fmt(stats.maxMana)}`,
    ``,
    `⚔️ ATK: ${fmt(stats.attack)} | 🛡️ DEF: ${fmt(stats.defense)} | 💨 SPD: ${fmt(stats.speed)}`,
    `💰 Gold: ${fmt(player.gold)}g | 🌟 Reputasi: ${fmt(player.reputation)}`,
    `🔥 Daily Streak: ${player.dailyStreak || 0} hari`,
    ``,
    `🏆 *ACHIEVEMENT & HISTORY*`,
    `👹 Monster dibunuh: ${fmt(s.monstersKilled)}`,
    `🏰 Dungeon clear: ${fmt(s.dungeonsCleared)}`,
    `💀 Boss dibunuh: ${fmt((s.bossesKilled || []).length)}`,
    `🌍 World Boss: ${fmt(s.worldBossKills)}`,
    `💥 Total DMG: ${fmt(s.totalDmgDealt)}`,
    `📜 Quest selesai: ${fmt((player.completedQuests || []).length)}`,
    `🎖️ Title dimiliki: ${fmt((player.earnedTitles || []).length)}`,
    ``,
    ...craftLines,
    ``,
    `⚔️ *PVP / DUEL*`,
    `🥇 Menang: ${fmt(pvpWins)} | 💔 Kalah: ${fmt(pvpLosses)}`,
    `📊 Total: ${fmt(pvpTotal)} duel | Win rate: ${pvpRate}%`,
    `   [${bar(pvpWins, pvpTotal)}]`,
  ];

  // Tambahkan info pet jika ada
  if (petType) {
    lines.push(``, `🐾 *PET*`, `${petType.name || pet.name} Lv.${pet.level}`);
  }

  // Tambahkan info summon jika aktif
  if (summon) {
    lines.push(``, `🎴 *SUMMON AKTIF*`, `${summon.emoji} ${summon.name} (${summon.uses}× uses)`);
  }

  // Tambahkan info guild jika ada
  if (guild) {
    lines.push(``, `🛡️ *GUILD*`, `${guild.name} [${guild.tag}]${player.guildRole ? ` — ${player.guildRole}` : ''}`);
  }

  lines.push(``, `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  return m.reply(lines.join('\n'));
};

handler.help = ['profile', 'profile @user', 'level', 'stats', 'me'];
handler.tags = ['rpg'];
handler.command = /^(profile|profil|level|lvl|stats|stat|me|status)$/i;
handler.cooldown = 5;

export default handler;
