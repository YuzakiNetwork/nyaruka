/**
 * commands/social/inspect.js
 * Lihat profil player lain.
 * Usage: !inspect @player
 */

import { getPlayer }    from '../../lib/game/player.js';
import { normalizeJid } from '../../handler/index.js';

let handler = async (m, { args }) => {
  const mentionedJids = m.raw?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  const targetJid     = mentionedJids[0] ? normalizeJid(mentionedJids[0]) : null;

  if (!targetJid) return m.reply(`Usage: *!inspect @player*`);

  const target = getPlayer(targetJid);
  if (!target) return m.reply(
    `❌ Pemain tersebut belum punya karakter di Nyaruka.\n` +
    `Minta dia membuat karakter dulu dengan *!register <name> <class>*.`
  );

  const equipped = Object.entries(target.equipment || {})
    .filter(([, id]) => id)
    .map(([slot, id]) => `  • ${slot}: *${id}*`)
    .join('\n') || '  Tidak ada';

  return m.reply(
    `🔍 *Inspeksi: ${target.name}*\n\n` +
    `⚔️ Class: *${target.class}*\n` +
    `🎖️ Rank:  *${target.rank}* | Lv.*${target.level}*\n` +
    `🌟 Reputasi: *${target.reputation}*\n\n` +
    `❤️ HP:  *${target.maxHp}*\n` +
    `⚔️ ATK: *${target.attack}*\n` +
    `🛡️ DEF: *${target.defense}*\n` +
    `💨 SPD: *${target.speed}*\n\n` +
    `🔧 Equipment:\n${equipped}\n\n` +
    `📜 Quest selesai: *${target.completedQuests?.length || 0}*`
  );
};

handler.help    = ['inspect @player'];
handler.tags    = ['social'];
handler.command = /^(inspect|lihat|view)$/i;
handler.cooldown = 5;

export default handler;
