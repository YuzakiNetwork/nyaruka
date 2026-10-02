/**
 * commands/info/help.js
 * Auto-detect semua commands dari registry handler.
 * Tidak perlu edit manual saat tambah command baru.
 *
 * Usage: !help | !help <category> | !help <command>
 */

import { getCommands } from '../../handler/index.js';
import { config }      from '../../config.js';

// Emoji per tag
const TAG_EMOJI = {
  rpg:     '⚔️',
  economy: '💰',
  info:    'ℹ️',
  owner:   '👑',
  social:  '👥',
  misc:    '🎲',
};

const TAG_LABEL = {
  rpg: 'Game',
  economy: 'Ekonomi',
  social: 'Sosial',
  info: 'Info',
};
const displayTag = tag => TAG_LABEL[tag] || tag.toUpperCase();

// Urutan tampil tag dan alias kategori yang ramah pemain
const TAG_ORDER = ['rpg', 'economy', 'social', 'misc', 'info', 'owner'];
const CATEGORY_ALIASES = { game: 'rpg' };

let handler = async (m, { args, isOwner }) => {
  const p   = config.bot.prefix;
  const arg = args[0]?.toLowerCase();
  const filterTag = CATEGORY_ALIASES[arg] || (TAG_ORDER.includes(arg) ? arg : null);

  // ── !help — panduan singkat ────────────────────────────────────────────────
  if (!arg) {
    return m.reply(
      `✨ *Nyaruka • Mulai dari sini* ✨\n` +
      `Baru bergabung? Ikuti langkah ini:\n\n` +
      `1. Buat karakter: *${p}register <name> <class>*\n` +
      `2. Ambil hadiah harian: *${p}daily*\n` +
      `3. Mulai menjelajah: *${p}adventure* atau *${p}battle*\n\n` +
      `Cari perintah lain?\n` +
      `Game: *${p}help game* • Ekonomi: *${p}help economy* • Sosial: *${p}help social* • Info: *${p}help info*\n` +
      `Detail command: *${p}help <command>*`
    );
  }

  const cmds = getCommands();

  // ── !help <command> — cari command spesifik ───────────────────────────────
  if (!filterTag) {
    const found = cmds.find(c =>
      c.handler.command.test(arg) ||
      c.handler.help?.some(h => h.toLowerCase().startsWith(arg))
    );

    if (found) {
      const h = found.handler;
      const tag = h.tags?.[0] || 'misc';
      const helpLines = (h.help || [arg]).map(u => `  ${p}${u}`).join('\n');
      return m.reply(
        `${TAG_EMOJI[tag] || '🔹'} *Command: ${p}${h.help?.[0]?.split(' ')[0] || arg}*\n` +
        `Tag:      ${displayTag(tag)}\n` +
        `Cooldown: ${h.cooldown ?? 3}s\n\n` +
        `📖 Usage:\n${helpLines}` +
        (h.ownerOnly ? '\n\n👑 Owner only' : '')
      );
    }
    return m.reply(`❌ Command *${arg}* tidak ditemukan.\nKetik *${p}help* untuk panduan singkat atau pilih kategori perintah.`);
  }

  // ── !help <category> — filter dinamis per kategori ─────────────────────────
  const grouped = {};
  for (const { handler: h } of cmds) {
    // Sembunyikan owner command dari non-owner
    if (h.ownerOnly && !isOwner) continue;
    const tag = h.tags?.[0] || 'misc';
    if (tag !== filterTag) continue;
    if (!grouped[tag]) grouped[tag] = [];
    grouped[tag].push(h);
  }

  let text = `${TAG_EMOJI[filterTag] || '🔹'} *${displayTag(filterTag)} Commands*\n\n`;

  for (const tag of TAG_ORDER.filter(t => t === filterTag && grouped[t])) {
    if (!grouped[tag]?.length) continue;
    const emoji = TAG_EMOJI[tag] || '🔹';
    text += `━━━ ${emoji} *${displayTag(tag)}* ━━━\n`;

    for (const h of grouped[tag]) {
      const usages = h.help || [];
      if (!usages.length) continue;
      // Baris pertama = usage utama, sisanya sub-usage
      text += `${p}${usages[0]}\n`;
      for (let i = 1; i < usages.length; i++) {
        text += `  ↳ ${p}${usages[i]}\n`;
      }
    }
    text += '\n';
  }

  return m.reply(text.trim());
};

handler.help     = ['help', 'help <tag>', 'help <command>'];
handler.tags     = ['info'];
handler.command  = /^(help|menu|command|cmd)$/i;
handler.cooldown = 5;

export default handler;
