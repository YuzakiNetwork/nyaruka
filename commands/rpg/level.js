/**
 * commands/rpg/level.js
 * Melihat level, EXP, rank, dan statistik player.
 *
 * Pemakaian:
 *   !level            — lihat profil sendiri
 *   !level @user      — lihat profil player lain
 *
 * Catatan: statistik PvP (W/L) dibaca dari player.stats yang dicatat oleh duel.js
 * (pvpWins, pvpLosses, wins, losses).
 */

import { getPlayer, expRequired, calcRank } from '../../lib/game/player.js';
import { normalizeJid }                     from '../../handler/index.js';

// ── Helper ────────────────────────────────────────────────────────────────────
function bar(current, max, size = 10) {
  const ratio  = max > 0 ? Math.min(1, Math.max(0, current / max)) : 0;
  const filled = Math.round(ratio * size);
  return '█'.repeat(filled) + '░'.repeat(size - filled);
}

const fmt = (n) => Number(n || 0).toLocaleString('id-ID');

const RANK_STEPS = [
  { rank: 'E', minLevel: 0  },
  { rank: 'D', minLevel: 10 },
  { rank: 'C', minLevel: 25 },
  { rank: 'B', minLevel: 50 },
  { rank: 'A', minLevel: 75 },
  { rank: 'S', minLevel: 90 },
];

const AWAKEN_LEVELS = [30, 60, 90];

let handler = async (m, { args }) => {
  // Target: player yang di-mention (contextInfo), atau diri sendiri
  const mentionedJids = m.raw?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  const targetId = mentionedJids[0] ? normalizeJid(mentionedJids[0]) : m.sender;
  const isSelf   = targetId === m.sender;
  const player   = getPlayer(targetId);

  if (!player) {
    return m.reply(
      isSelf
        ? `❌ Daftar dulu: *!register <nama> <class>*`
        : `❌ Player tersebut belum terdaftar.`
    );
  }

  const s = player.stats || {};
  const expNeeded = player.expToNext || expRequired(player.level);
  const expPct    = Math.min(100, Math.floor(((player.exp || 0) / expNeeded) * 100));

  // ── Rank berikutnya ─────────────────────────────────────────────────────────
  const currentRank = calcRank(player.level);
  const nextRank    = RANK_STEPS.find(r => r.minLevel > player.level);
  const rankLine = nextRank
    ? `Rank berikut: *${nextRank.rank}* (Lv.${nextRank.minLevel}, kurang ${nextRank.minLevel - player.level} level)`
    : `Rank tertinggi tercapai 🏅`;

  // ── Awakening ───────────────────────────────────────────────────────────────
  const awTier   = player.awakeningTier || 0;
  const nextAwLv = AWAKEN_LEVELS[awTier];
  let awakenLine;
  if (awTier > 0 && nextAwLv === undefined) {
    awakenLine = `🔱 Awakening: *III — ${player.awakeningName || 'Setara Dewa'}* (maks)`;
  } else {
    const current = awTier > 0 ? `*${'I'.repeat(awTier)} — ${player.awakeningName || '-'}*` : `*Belum*`;
    const ready   = player.level >= nextAwLv ? ` ⚡ _siap! gunakan !awaken now_` : ` (Lv.${nextAwLv})`;
    awakenLine = `⚡ Awakening: ${current}\n   Berikutnya: Awakening ${'I'.repeat(awTier + 1)}${ready}`;
  }

  // ── PvP (dicatat oleh duel.js) ──────────────────────────────────────────────
  const pvpWins   = s.pvpWins   || 0;
  const pvpLosses = s.pvpLosses || 0;
  const pvpTotal  = pvpWins + pvpLosses;
  const pvpRate   = pvpTotal > 0 ? Math.round((pvpWins / pvpTotal) * 100) : 0;

  const title = player.activeTitle ? `『${player.activeTitle}』 ` : '';
  const job   = player.job && player.job !== player.class
    ? `${player.class} → ${player.job}`
    : player.class;

  const lines = [
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `👤 *PROFIL PLAYER*`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `${title}*${player.name}*`,
    `🎭 Class  : *${job}*`,
    `🏅 Rank   : *${currentRank}*`,
    `⭐ Level  : *${player.level}*`,
    `📈 EXP    : ${fmt(player.exp)} / ${fmt(expNeeded)} (${expPct}%)`,
    `   [${bar(player.exp || 0, expNeeded)}]`,
    `   ${rankLine}`,
    ``,
    awakenLine,
    ``,
    `📊 *STATISTIK*`,
    `❤️ HP     : ${fmt(player.hp)} / ${fmt(player.maxHp)}`,
    `   [${bar(player.hp, player.maxHp)}]`,
    `💙 Mana   : ${fmt(player.mana)} / ${fmt(player.maxMana)}`,
    `   [${bar(player.mana, player.maxMana)}]`,
    `⚔️ ATK    : ${fmt(player.attack)}`,
    `🛡️ DEF    : ${fmt(player.defense)}`,
    `💨 SPD    : ${fmt(player.speed)}`,
    ``,
    `💰 Gold   : ${fmt(player.gold)}g`,
    `🌟 Reputasi : ${fmt(player.reputation)}`,
    `🔥 Daily streak : ${player.dailyStreak || 0} hari`,
    ``,
    `🏆 *RIWAYAT*`,
    `👹 Monster dibunuh : ${fmt(s.monstersKilled)}`,
    `🏰 Dungeon clear   : ${fmt(s.dungeonsCleared)}`,
    `💀 Boss dibunuh    : ${fmt((s.bossesKilled || []).length)}`,
    `🌍 World boss      : ${fmt(s.worldBossKills)}`,
    `💥 Total damage    : ${fmt(s.totalDmgDealt)}`,
    `🔨 Crafting        : ${fmt(s.craftCount)}`,
    `📜 Quest selesai   : ${fmt((player.completedQuests || []).length)}`,
    `🎖️ Title dimiliki  : ${fmt((player.earnedTitles || []).length)}`,
    ``,
    `⚔️ *PVP / DUEL*`,
    `🥇 Menang  : ${fmt(pvpWins)}`,
    `💔 Kalah   : ${fmt(pvpLosses)}`,
    `📊 Total   : ${fmt(pvpTotal)} duel`,
    `   Win rate: ${pvpRate}% [${bar(pvpWins, pvpTotal)}]`,
  ];

  if (player.guildId) {
    lines.push(``, `🛡️ Guild : ${player.guildId}${player.guildRole ? ` (${player.guildRole})` : ''}`);
  }

  lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━`);

  return m.reply(lines.join('\n'));
};

handler.help     = ['level', 'level @user'];
handler.tags     = ['rpg'];
handler.command  = /^(level|lvl|profile|profil|stats)$/i;
handler.cooldown = 5;
export default handler;
