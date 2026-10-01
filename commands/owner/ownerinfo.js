/**
 * commands/owner/ownerinfo.js
 * Lihat owner list + tambah/hapus owner runtime.
 * Usage: !ownerinfo | !addowner @user | !removeowner @user
 */

import { config, isOwner }  from '../../config.js';
import { normalizeJid }     from '../../handler/index.js';

// Runtime owners (tidak persist, reset saat bot restart)
const _runtimeLids    = new Set();
const _runtimeNumbers = new Set();

/** Tambah owner runtime — dipanggil dari addowner */
export function addRuntimeOwner(jid) {
  if (jid.endsWith('@lid'))              _runtimeLids.add(jid);
  else if (jid.endsWith('@s.whatsapp.net')) _runtimeNumbers.add(jid);
}

/** Cek owner runtime */
export function isRuntimeOwner(jid) {
  if (!jid) return false;
  if (_runtimeLids.has(jid) || _runtimeNumbers.has(jid)) return true;
  const num = jid.split('@')[0];
  for (const o of [..._runtimeLids, ..._runtimeNumbers]) {
    if (o.split('@')[0] === num) return true;
  }
  return false;
}

let handler = async (m, { args, command }) => {

  // ── !ownerinfo ────────────────────────────────────────────────────────────
  if (command === 'ownerinfo' || command === 'owners') {
    const nums    = config.bot.ownerNumbers;
    const lids    = config.bot.ownerLids;
    const runtime = [..._runtimeLids, ..._runtimeNumbers];

    let text = `👑 *Owner List*\n\n`;

    if (nums.length) {
      text += `📱 *@s.whatsapp.net (dari .env):*\n`;
      text += nums.map(j => `  • ${j}`).join('\n') + '\n\n';
    }
    if (lids.length) {
      text += `🔗 *@lid (dari .env):*\n`;
      text += lids.map(j => `  • ${j}`).join('\n') + '\n\n';
    }
    if (runtime.length) {
      text += `⚡ *Runtime (sementara):*\n`;
      text += runtime.map(j => `  • ${j}`).join('\n') + '\n\n';
    }
    if (!nums.length && !lids.length && !runtime.length) {
      text += `_(tidak ada owner terdaftar)_\n\n`;
    }

    text += `*Kamu:* \`${m.sender}\`\n`;
    text += `*Owner?* ${isOwner(m.sender) || isRuntimeOwner(m.sender) ? '✅ Ya' : '❌ Tidak'}`;

    return m.reply(text);
  }

  // ── !addowner @user ───────────────────────────────────────────────────────
  if (command === 'addowner') {
    const jids = m.raw?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (!jids.length) return m.reply(`Usage: *!addowner @user*`);

    const added = [];
    for (const raw of jids) {
      // Simpan JID as-is (bisa @lid atau @s.whatsapp.net)
      addRuntimeOwner(raw);
      added.push(raw);
    }
    return m.reply(
      `✅ Ditambahkan sebagai owner runtime:\n` +
      added.map(j => `• \`${j}\``).join('\n') +
      `\n\n⚠️ Akan hilang saat bot restart.\nUntuk permanen, edit *.env*.`
    );
  }

  // ── !removeowner @user ────────────────────────────────────────────────────
  if (command === 'removeowner') {
    const jids = m.raw?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (!jids.length) return m.reply(`Usage: *!removeowner @user*`);

    for (const raw of jids) {
      _runtimeLids.delete(raw);
      _runtimeNumbers.delete(raw);
      // Cek tidak hapus yang dari .env
      if (config.bot.owner.includes(raw)) {
        return m.reply(`❌ \`${raw}\` ada di .env — hapus manual dari file .env untuk permanen.`);
      }
    }
    return m.reply(`✅ Dihapus dari owner runtime.`);
  }
};

handler.help      = ['ownerinfo', 'addowner @user', 'removeowner @user'];
handler.tags      = ['owner'];
handler.command   = /^(ownerinfo|owners|addowner|removeowner)$/i;
handler.ownerOnly = true;
handler.cooldown  = 3;

export default handler;
