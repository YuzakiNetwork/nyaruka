/**
 * commands/info/myid.js
 * Tampilkan ID/JID pengirim — berguna untuk setup owner.
 *
 * Usage: !myid   → tampilkan sender JID + format untuk .env
 *        !mylid  → alias
 */

import { config } from '../../config.js';

let handler = async (m) => {
  const raw    = m.raw?.key;
  const remote = raw?.remoteJid || '';
  const isGrp  = remote.endsWith('@g.us');

  // Raw JID sebelum normalisasi
  const rawSender = isGrp
    ? (raw?.participant || m.raw?.participant || '')
    : remote;

  // Normalized (hasil extractSender)
  const normalized = m.sender;

  // Format nomor
  const rawNum  = rawSender.split('@')[0];
  const normNum = normalized.split('@')[0];

  // Apakah ini @lid?
  const isLid = rawSender.endsWith('@lid');

  const p = config.bot.prefix;

  let text =
    `🪪 *ID Kamu*\n\n` +
    `*Raw JID:*\n\`${rawSender}\`\n\n` +
    `*Normalized:*\n\`${normalized}\`\n\n`;

  if (isLid) {
    text +=
      `*Format:* \`@lid\` (Linked Device ID)\n\n` +
      `📋 *Copy ke .env:*\n` +
      `\`\`\`\n` +
      `BOT_OWNER_LID=${rawNum}\n` +
      `\`\`\`\n\n` +
      `⚠️ Juga isi BOT_OWNER_NUMBER dengan nomor WA kamu:\n` +
      `\`\`\`\nBOT_OWNER_NUMBER=628xxxxxxxxxx\n\`\`\``;
  } else {
    text +=
      `*Format:* \`@s.whatsapp.net\` (nomor WA)\n\n` +
      `📋 *Copy ke .env:*\n` +
      `\`\`\`\nBOT_OWNER_NUMBER=${normNum}\n\`\`\``;
  }

  text += `\n\n_Ketik ${p}myid lagi setelah edit .env untuk verifikasi._`;

  return m.reply(text);
};

handler.help     = ['myid'];
handler.tags     = ['info'];
handler.command  = /^(myid|mylid|whoami|lid)$/i;
handler.cooldown = 3;

export default handler;
