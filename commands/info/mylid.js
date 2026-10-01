/**
 * commands/info/mylid.js
 * Tampilkan ID kamu (LID dan/atau nomor WA).
 * Berguna untuk isi BOT_OWNER_LID di .env
 * Usage: !mylid | !myid | !whoami
 */

let handler = async (m) => {
  const sender = m.sender;                          // sudah di-normalize
  const raw    = m.raw?.key?.participant            // sender mentah di grup
              || m.raw?.key?.remoteJid              // sender mentah di DM
              || sender;

  const isLid = raw?.endsWith('@lid');
  const isPN  = raw?.endsWith('@s.whatsapp.net');

  const num = raw?.split('@')[0] || '?';

  let idType, idDesc;
  if (isLid) {
    idType = '🆔 LID (Linked Device ID)';
    idDesc =
      `Ini format ID baru WhatsApp.\n` +
      `Untuk jadi owner, tambahkan ke *.env*:\n` +
      `\`BOT_OWNER_LID=${num}\``;
  } else if (isPN) {
    idType = '📱 Phone Number JID';
    idDesc =
      `Ini format ID lama WhatsApp.\n` +
      `Untuk jadi owner, tambahkan ke *.env*:\n` +
      `\`BOT_OWNER_NUMBER=${num}\``;
  } else {
    idType = '❓ Format tidak dikenal';
    idDesc = `Raw JID: ${raw}`;
  }

  return m.reply(
    `🔍 *ID Kamu*\n\n` +
    `*${idType}*\n` +
    `\`${raw}\`\n\n` +
    `${idDesc}\n\n` +
    `📝 Sender (normalized): \`${sender}\`\n` +
    `${m.isGroup ? `👥 Dari grup: \`${m.chat}\`` : '💬 Dari DM'}`
  );
};

handler.help     = ['mylid', 'myid', 'whoami'];
handler.tags     = ['info'];
handler.command  = /^(mylid|myid|whoami|myinfo)$/i;
handler.cooldown = 3;

export default handler;
