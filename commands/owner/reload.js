/**
 * commands/owner/reload.js
 * Manual reload command — owner only.
 *
 * Usage:
 *   !reload              → reload semua command
 *   !reload <filename>   → reload satu file (tanpa .js)
 *   !reload stats        → tampilkan registry stats
 */

import {
  loadCommands,
  reloadFile,
  findCommandFile,
  getCommandStats,
} from '../../handler/index.js';

let handler = async (m, { args }) => {
  const sub = args[0]?.toLowerCase();

  // ── !reload stats ─────────────────────────────────────────────────────────
  if (sub === 'stats' || sub === 'info') {
    const stats = getCommandStats();
    const tagLines = Object.entries(stats.byTag)
      .sort((a, b) => b[1] - a[1])
      .map(([tag, n]) => `  • *${tag}*: ${n} command`)
      .join('\n');

    return m.reply(
      `📊 *Command Registry*\n\n` +
      `Total: *${stats.total} commands*\n\n` +
      `${tagLines}\n\n` +
      `👁️  Hot-reload watcher: *AKTIF*\n` +
      `💡 Edit/tambah file di /commands → auto-detect!`
    );
  }

  // ── !reload <filename> ────────────────────────────────────────────────────
  if (sub && sub !== 'all') {
    const filePath = findCommandFile(sub);
    if (!filePath) {
      return m.reply(
        `❌ File *${sub}.js* tidak ditemukan.\n\n` +
        `Gunakan *!reload stats* untuk lihat daftar.`
      );
    }

    const start = Date.now();
    const ok    = await reloadFile(filePath);
    const ms    = Date.now() - start;

    return m.reply(
      ok
        ? `🔄 *Reload: ${sub}.js*\n✅ Berhasil! ⏱️ ${ms}ms`
        : `❌ *Reload: ${sub}.js*\nGagal — cek syntax file!`
    );
  }

  // ── !reload / !reload all ─────────────────────────────────────────────────
  const start  = Date.now();
  const result = await loadCommands();
  const ms     = Date.now() - start;
  const stats  = getCommandStats();

  const tagLines = Object.entries(stats.byTag)
    .map(([tag, n]) => `  • ${tag}: ${n}`)
    .join('\n');

  return m.reply(
    `🔄 *Reload Semua Commands*\n\n` +
    `✅ Loaded : *${result.ok}*\n` +
    `❌ Failed : *${result.fail}*\n` +
    `📦 Total  : *${result.total}*\n` +
    `⏱️  Waktu  : *${ms}ms*\n\n` +
    tagLines
  );
};

handler.help      = ['reload', 'reload <file>', 'reload stats'];
handler.tags      = ['owner'];
handler.command   = /^reload$/i;
handler.ownerOnly = true;
handler.cooldown  = 3;

export default handler;
