/**
 * commands/rpg/duel.js
 * PvP Duel antar player.
 * Usage: !duel @target | !duel accept | !duel decline
 */

import { getPlayer, savePlayer }                    from '../../lib/game/player.js';
import { awardExp }                                  from '../../lib/game/player.js';
import { randInt, chance, applyVariance, clamp, pick } from '../../lib/utils/random.js';
import { normalizeJid }                             from '../../handler/index.js';

const pendingDuels = new Map();
const DUEL_EXPIRE  = 60_000;

function simulateDuel(p1, p2) {
  const log = [];
  let hp1   = p1.maxHp;
  let hp2   = p2.maxHp;
  const order = p1.speed >= p2.speed ? [p1, p2] : [p2, p1];

  for (let turn = 1; turn <= 15; turn++) {
    for (const attacker of order) {
      const isP1 = attacker === p1;
      if (chance(0.08)) { log.push(`💨 *${attacker.name}* meleset!`); continue; }
      const crit = chance(attacker.class === 'Assassin' ? 0.20 : 0.10);
      const dmg  = Math.max(1, Math.floor(applyVariance(attacker.attack, 0.15) - (isP1 ? p2 : p1).defense * 0.5));
      const final = crit ? Math.floor(dmg * 1.8) : dmg;
      if (isP1) hp2 = Math.max(0, hp2 - final);
      else      hp1 = Math.max(0, hp1 - final);
      log.push(crit
        ? `💥 *${attacker.name}* CRITICAL *${final}* → ${isP1 ? p2.name : p1.name} HP: ${isP1 ? hp2 : hp1}`
        : `⚔️ *${attacker.name}* serang *${final}* → ${isP1 ? p2.name : p1.name} HP: ${isP1 ? hp2 : hp1}`
      );
      if (hp1 <= 0 || hp2 <= 0) break;
    }
    if (hp1 <= 0 || hp2 <= 0) break;
  }
  return { log, winner: hp1 > hp2 ? p1 : hp2 > hp1 ? p2 : null };
}

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  const sub = args[0]?.toLowerCase();

  // ── accept ────────────────────────────────────────────────────────────────
  if (sub === 'accept' || sub === 'terima') {
    const entry = [...pendingDuels.entries()].find(([, d]) => d.targetId === m.sender);
    if (!entry) return m.reply(`❌ Tidak ada tantangan duel untukmu.`);
    const [challengerId, duel] = entry;
    if (Date.now() > duel.expiresAt) {
      pendingDuels.delete(challengerId);
      return m.reply(`⏰ Tantangan sudah kedaluwarsa.`);
    }
    const challenger = getPlayer(challengerId);
    if (!challenger) return m.reply(`❌ Penantang tidak ditemukan.`);
    pendingDuels.delete(challengerId);

    const result  = simulateDuel(challenger, player);
    const logText = result.log.slice(-10).join('\n');
    const goldBet = Math.min(50 + challenger.level * 10, 500);

    if (!result.winner) {
      return m.reply(`⚔️ *DUEL: ${challenger.name} vs ${player.name}*\n\n${logText}\n\n🤝 *SERI!*`);
    }

    const win = result.winner;
    const lose = win === challenger ? player : challenger;
    win.gold  = (win.gold  || 0) + goldBet;
    lose.gold = Math.max(0, (lose.gold || 0) - goldBet);
    await awardExp(win, 30 + win.level * 2);
    await savePlayer(challenger);
    await savePlayer(player);

    return m.reply(
      `⚔️ *DUEL: ${challenger.name} vs ${player.name}*\n` +
      `━━━━━━━━━━━━━━━\n${logText}\n━━━━━━━━━━━━━━━\n\n` +
      `🏆 *${win.name}* MENANG!\n` +
      `💰 +${goldBet}g → ${win.name}\n` +
      `💸 -${goldBet}g → ${lose.name}`
    );
  }

  // ── decline ───────────────────────────────────────────────────────────────
  if (sub === 'decline' || sub === 'tolak') {
    const entry = [...pendingDuels.entries()].find(([, d]) => d.targetId === m.sender);
    if (!entry) return m.reply(`❌ Tidak ada tantangan duel untukmu.`);
    pendingDuels.delete(entry[0]);
    return m.reply(`✋ Kamu menolak tantangan duel.`);
  }

  // ── challenge @target ─────────────────────────────────────────────────────
  // Ambil mention dari contextInfo (lebih reliable dari parse teks)
  const mentionedJids = m.raw?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  const rawTarget     = mentionedJids[0]
    ? normalizeJid(mentionedJids[0])
    : null;

  if (!rawTarget) {
    return m.reply(
      `⚔️ *Duel System*\n\n` +
      `*!duel @player* — tantang player\n` +
      `*!duel accept* — terima tantangan\n` +
      `*!duel decline* — tolak tantangan\n\n` +
      `Taruhan: *${Math.min(50 + player.level * 10, 500)}g*`
    );
  }

  if (rawTarget === m.sender) return m.reply(`❌ Tidak bisa duel dengan diri sendiri.`);
  const target = getPlayer(rawTarget);
  if (!target) return m.reply(`❌ Player target belum terdaftar di RPG.`);

  pendingDuels.delete(m.sender);
  pendingDuels.set(m.sender, { targetId: rawTarget, expiresAt: Date.now() + DUEL_EXPIRE });
  setTimeout(() => pendingDuels.delete(m.sender), DUEL_EXPIRE);

  const goldBet = Math.min(50 + player.level * 10, 500);
  return m.reply(
    `⚔️ *${player.name}* menantang *${target.name}* untuk DUEL!\n\n` +
    `💰 Taruhan: *${goldBet}g*\n` +
    `⏰ Berlaku *60 detik*\n\n` +
    `Ketik *!duel accept* untuk menerima atau *!duel decline* untuk menolak.`
  );
};

handler.help    = ['duel @player', 'duel accept', 'duel decline'];
handler.tags    = ['rpg'];
handler.command = /^duel$/i;
handler.cooldown = 60;

export default handler;
