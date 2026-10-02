/**
 * commands/social/transfer.js
 * Transfer gold ke player lain.
 * Usage: !transfer @player <jumlah>
 */

import { getPlayer, savePlayer } from '../../lib/game/player.js';
import { normalizeJid }          from '../../handler/index.js';

const TAX_RATE = 0.05;

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  const mentionedJids = m.raw?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  const targetJid     = mentionedJids[0] ? normalizeJid(mentionedJids[0]) : null;
  const amount        = parseInt(args.find(a => !isNaN(a) && a > 0));

  if (!targetJid || !amount || amount < 1) {
    return m.reply(
      `💸 *Transfer Gold*\n\n` +
      `Usage: *!transfer @player <jumlah>*\n` +
      `Biaya: *5% pajak*\n` +
      `💰 Goldmu: *${player.gold}g*`
    );
  }

  if (targetJid === m.sender) return m.reply(`❌ Tidak bisa transfer ke diri sendiri.`);

  const target = getPlayer(targetJid);
  if (!target) return m.reply(
    `❌ Pemain itu belum bergabung di Nyaruka.\n` +
    `Ajak dia membuat karakter dengan *!register <name> <class>*, lalu coba lagi.`
  );

  const tax   = Math.floor(amount * TAX_RATE);
  const total = amount + tax;

  if (player.gold < total) {
    return m.reply(
      `❌ Gold tidak cukup!\n` +
      `Butuh: *${total}g* (termasuk pajak ${tax}g)\n` +
      `Punya: *${player.gold}g*`
    );
  }

  player.gold -= total;
  target.gold += amount;
  await savePlayer(player);
  await savePlayer(target);

  return m.reply(
    `✅ *Transfer Berhasil!*\n\n` +
    `📤 Kamu: -*${total}g* (pajak ${tax}g)\n` +
    `📥 ${target.name}: +*${amount}g*\n\n` +
    `💰 Sisa goldmu: *${player.gold}g*`
  );
};

handler.help    = ['transfer @player <jumlah>'];
handler.tags    = ['social'];
handler.command = /^(transfer|kirim|send)$/i;
handler.cooldown = 10;

export default handler;
