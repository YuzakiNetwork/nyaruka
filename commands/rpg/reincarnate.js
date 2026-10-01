/**
 * commands/rpg/reincarnate.js
 * Reincarnation System — Reset level tapi dapat bonus permanen (ala prestige)
 */

import { getPlayer, savePlayer } from '../../lib/game/player.js';
import { config }                from '../../config.js';

const REINCARNATION_BONUSES = [
  { mult: 1, label: '🔄 Reinkarnasi I',   bonus: { expMult: 1.1, goldMult: 1.1, baseStatBonus: 5 },  desc: '+10% EXP/Gold, +5 base stats' },
  { mult: 2, label: '🌟 Reinkarnasi II',  bonus: { expMult: 1.2, goldMult: 1.2, baseStatBonus: 15 }, desc: '+20% EXP/Gold, +15 base stats' },
  { mult: 3, label: '💫 Reinkarnasi III', bonus: { expMult: 1.35, goldMult: 1.35, baseStatBonus: 30 }, desc: '+35% EXP/Gold, +30 base stats' },
  { mult: 4, label: '⚡ Reinkarnasi IV',  bonus: { expMult: 1.5, goldMult: 1.5, baseStatBonus: 50 }, desc: '+50% EXP/Gold, +50 base stats' },
  { mult: 5, label: '🔱 Reinkarnasi V',   bonus: { expMult: 2.0, goldMult: 2.0, baseStatBonus: 100 }, desc: 'x2 EXP/Gold, +100 base stats' },
];

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  const sub = args[0]?.toLowerCase() || 'status';
  const currentTier = player.reincarnation || 0;
  const nextTier    = REINCARNATION_BONUSES[currentTier];

  // ── !reincarnate status ────────────────────────────────────────────────────
  if (sub === 'status' || sub === 'info') {
    const lines = [
      `♾️ *Reincarnation System*\n`,
      `Reinkarnasi saat ini: *${currentTier === 0 ? 'Belum' : REINCARNATION_BONUSES[currentTier - 1].label}*`,
      `Level saat ini: *${player.level}*`,
      `\n📋 *Tier Available:*`,
    ];

    REINCARNATION_BONUSES.forEach((r, i) => {
      const done = currentTier > i;
      const isNext = currentTier === i;
      lines.push(`${done ? '✅' : isNext ? '⏳' : '🔒'} ${r.label}\n   ${r.desc}`);
    });

    if (nextTier) {
      lines.push(`\n⚠️ *Syarat reinkarnasi:*\n• Level *100*\n• ${player.level >= 100 ? '✅' : '❌'} Level kamu: ${player.level}`);
      if (player.level >= 100) lines.push(`\n⚡ *SIAP REINKARNASI!*\n!reincarnate now\n\n_Peringatan: Level dan EXP akan di-reset ke 1!_\n_Semua item, gold, dan progression TETAP._`);
    } else {
      lines.push(`\n🏆 *Reinkarnasi maksimum tercapai!*`);
    }

    return m.reply(lines.join('\n'));
  }

  // ── !reincarnate now ───────────────────────────────────────────────────────
  if (sub === 'now' || sub === 'ya' || sub === 'confirm') {
    if (!nextTier) return m.reply(`🏆 Sudah di reinkarnasi maksimum (V)!`);
    if (player.level < 100) return m.reply(`❌ Butuh Level *100* untuk reinkarnasi!\nLevel kamu: *${player.level}*`);

    // Konfirmasi
    if (args[1]?.toLowerCase() !== 'yakin') {
      return m.reply(
        `⚠️ *KONFIRMASI REINKARNASI*\n\n` +
        `Kamu akan:\n` +
        `• 🔄 Level direset ke 1\n` +
        `• 📈 Stat dasar direset (+ bonus permanen)\n` +
        `• 💰 Gold, item, skill TETAP\n` +
        `• ✨ Dapat bonus: ${nextTier.desc}\n\n` +
        `Ketik: *!reincarnate now yakin*\nuntuk konfirmasi.`
      );
    }

    // Apply reinkarnasi
    const cls   = player.class;
    const clsStats = config.rpg.classes[cls] || config.rpg.classes.Warrior;
    const bonus = nextTier.bonus;
    const statB = bonus.baseStatBonus;

    player.reincarnation  = currentTier + 1;
    player.reincarnateLabel = nextTier.label;

    // Reset level
    player.level      = 1;
    player.exp        = 0;
    player.expToNext  = 100;

    // Base stats reset + bonus permanen
    player.maxHp    = clsStats.hp      + statB * 2;
    player.hp       = player.maxHp;
    player.maxMana  = clsStats.mana    + statB;
    player.mana     = player.maxMana;
    player.attack   = clsStats.attack  + statB;
    player.defense  = clsStats.defense + Math.floor(statB * 0.7);
    player.speed    = clsStats.speed   + Math.floor(statB * 0.5);

    // Simpan multiplier
    player.expMult  = bonus.expMult;
    player.goldMult = bonus.goldMult;

    await savePlayer(player);

    return m.reply(
      `♾️ *REINKARNASI!* ♾️\n\n` +
      `${nextTier.label}\n\n` +
      `_"Hidupku yang baru dimulai... dengan membawa semua kenangan lalu."_\n\n` +
      `📊 *Stats baru:*\n` +
      `HP: ${player.maxHp} | MP: ${player.maxMana}\n` +
      `ATK: ${player.attack} | DEF: ${player.defense} | SPD: ${player.speed}\n\n` +
      `✨ *Bonus permanen:*\n${nextTier.desc}\n\n` +
      `Level direset ke *1*. Selamat petualangan baru! 🌟`
    );
  }

  return m.reply(
    `♾️ *Reincarnation System*\n\n` +
    `!reincarnate        — lihat status\n` +
    `!reincarnate now    — mulai reinkarnasi\n\n` +
    `Syarat: Level 100\nReward: Bonus permanen EXP, Gold & Stats`
  );
};

handler.help    = ['reincarnate', 'reincarnate now'];
handler.tags    = ['rpg'];
handler.command = /^(reincarnate|reinkarnasi|rebirth|prestige)$/i;
handler.cooldown = 10;
export default handler;
