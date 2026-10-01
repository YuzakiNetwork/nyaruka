/**
 * commands/info/help.js
 * Auto-detect semua commands dari registry handler.
 * Tidak perlu edit manual saat tambah command baru.
 *
 * Usage: !help | !help <tag> | !help <command>
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

// Urutan tampil tag
const TAG_ORDER = ['rpg', 'economy', 'social', 'misc', 'info', 'owner'];

let handler = async (m, { args, isOwner }) => {
  const p    = config.bot.prefix;
  const cmds = getCommands();
  const arg  = args[0]?.toLowerCase();

  // ── !help <command> — cari command spesifik ───────────────────────────────
  if (arg && !TAG_ORDER.includes(arg)) {
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
        `Tag:      ${tag}\n` +
        `Cooldown: ${h.cooldown ?? 3}s\n\n` +
        `📖 Usage:\n${helpLines}` +
        (h.ownerOnly ? '\n\n👑 Owner only' : '')
      );
    }
    return m.reply(`❌ Command *${arg}* tidak ditemukan.\nKetik *${p}help* untuk daftar lengkap.`);
  }

  // ── !help <tag> — filter per kategori ────────────────────────────────────
  const filterTag = TAG_ORDER.includes(arg) ? arg : null;

  // Kelompokkan commands per tag
  const grouped = {};
  for (const { handler: h } of cmds) {
    // Sembunyikan owner command dari non-owner
    if (h.ownerOnly && !isOwner) continue;
    const tag = h.tags?.[0] || 'misc';
    if (filterTag && tag !== filterTag) continue;
    if (!grouped[tag]) grouped[tag] = [];
    grouped[tag].push(h);
  }

  // Hitung total commands
  const total = Object.values(grouped).reduce((s, arr) => s + arr.length, 0);

  // Header
  let text = filterTag
    ? `${TAG_EMOJI[filterTag] || '🔹'} *${filterTag.toUpperCase()} Commands*\n\n`
    : `🏰 *${config.bot.name} — Help Menu*\n` +
      `Total: *${total} commands*\n\n`;

  // Render tiap tag
  const orderedTags = filterTag
    ? [filterTag]
    : TAG_ORDER.filter(t => grouped[t]);

  for (const tag of orderedTags) {
    if (!grouped[tag]?.length) continue;
    const emoji = TAG_EMOJI[tag] || '🔹';
    text += `━━━ ${emoji} *${tag.toUpperCase()}* ━━━\n`;

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

  // Footer
  if (!filterTag) {
    text += `💡 *${p}help <tag>* — filter kategori\n`;
    text += `💡 *${p}help <command>* — detail command\n`;
    text += `\nTag: ${TAG_ORDER.filter(t => grouped[t]).map(t => `*${t}*`).join(' | ')}`;
  }

  return m.reply(text.trim());
};

handler.help     = ['help', 'help <tag>', 'help <command>'];
handler.tags     = ['info'];
handler.command  = /^(help|menu|command|cmd)$/i;
handler.cooldown = 5;

export default handler;
