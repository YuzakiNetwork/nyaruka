/**
 * commands/owner/say.js
 * Kirim pesan sebagai bot — owner only.
 * Usage: !say <pesan>        → kirim ke chat saat ini
 *        !say @user <pesan>  → kirim DM ke user
 *        !say <groupId> <pesan>
 */

import { normalizeJid } from '../../handler/index.js';

let handler = async (m, { args, sock }) => {
  if (!args.length) return m.reply(`Usage: *!say <pesan>*`);

  const mentionedJid = m.raw?.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  let   target       = m.chat;
  let   msgArgs      = args;

  // Jika ada mention → DM ke user itu
  if (mentionedJid) {
    target  = normalizeJid(mentionedJid);
    msgArgs = args.filter(a => !a.startsWith('@'));
  }
  // Jika arg pertama adalah group ID format (misal 1234567@g.us)
  else if (args[0]?.includes('@g.us') || args[0]?.includes('@s.whatsapp.net')) {
    target  = args[0];
    msgArgs = args.slice(1);
  }

  const text = msgArgs.join(' ');
  if (!text) return m.reply(`❌ Pesan tidak boleh kosong.`);

  try {
    await sock.sendMessage(target, { text });
    if (target !== m.chat) {
      return m.reply(`✅ Pesan terkirim ke *${target}*`);
    }
  } catch (err) {
    return m.reply(`❌ Gagal kirim: ${err.message}`);
  }
};

handler.help      = ['say <pesan>', 'say @user <pesan>'];
handler.tags      = ['owner'];
handler.command   = /^(say|send)$/i;
handler.ownerOnly = true;
handler.cooldown  = 2;

export default handler;
