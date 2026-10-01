/**
 * commands/owner/donate.js
 * Manage sistem notifikasi donate Trakteer (Public API Polling).
 *
 * Usage:
 *   !donate status          → status polling + API
 *   !donate test [nama]     → kirim notif test
 *   !donate settarget       → set chat ini sebagai target
 *   !donate removetarget    → hapus target
 *   !donate targets         → lihat semua target
 *   !donate restart         → restart polling
 *   !donate howto           → panduan setup
 */

import { config }              from '../../config.js';
import { logger }              from '../../lib/utils/logger.js';
import {
  getTrakteerStatus,
  simulateDonation,
  startPolling,
  stopPolling,
  addTarget,
  removeTarget,
  getTargetList,
}                              from '../../webhook/trakteer.js';

let handler = async (m, { args, command, sock }) => {
  const sub = args[0]?.toLowerCase() || 'status';

  // ── !donate status ────────────────────────────────────────────────────────
  if (sub === 'status' || sub === 'info') {
    const status  = getTrakteerStatus();
    const targets = getTargetList();

    const pollEmoji = status.polling ? '🟢 Aktif' : '🔴 Mati';

    return m.reply(
      `💝 *Donate Trakteer Status*\n\n` +
      `🔄 Polling:   ${pollEmoji}\n` +
      `🔑 API Key:   ${status.apiKey}\n` +
      `⏱️  Interval:  ${status.interval}\n` +
      `🧾 Last Tx:   \`${status.lastSeenTx}\`\n\n` +
      `📢 *Notify Targets (${targets.length}):*\n` +
      (targets.length
        ? targets.map(t => `  • \`${t}\``).join('\n')
        : '  _belum ada_\n  Gunakan *!donate settarget*') +
      (!status.polling && status.apiKey === '(belum diset)' ?
        `\n\n⚠️ *Setup belum lengkap*\n` +
        `Ketik *!donate howto* untuk panduan.` : '')
    );
  }

  // ── !donate howto ─────────────────────────────────────────────────────────
  if (sub === 'howto' || sub === 'help' || sub === 'cara' || sub === 'setup') {
    return m.reply(
      `📖 *Cara Setup Donate Notification*\n\n` +
      `*Langkah 1 — Dapat API Key:*\n` +
      `1. Login ke dashboard.trakteer.id\n` +
      `2. Menu *"Integrations"* → *"Public API"*\n` +
      `3. Copy *"My API Key"*\n` +
      `   Format: \`trapi-xxxxxxxxxx\`\n\n` +
      `*Langkah 2 — Edit .env:*\n` +
      `\`\`\`\n` +
      `TRAKTEER_API_KEY=trapi-xxxxxxxxxx\n` +
      `TRAKTEER_POLL_INTERVAL=30000\n` +
      `\`\`\`\n\n` +
      `*Langkah 3 — Set target:*\n` +
      `Kirim *!donate settarget* di grup bot\n\n` +
      `*Langkah 4 — Restart:*\n` +
      `*!donate restart* atau restart bot\n\n` +
      `*Langkah 5 — Test:*\n` +
      `*!donate test* → simulasi notif\n\n` +
      `✅ *Tanpa ngrok/server publik!*\n` +
      `Bot polling API Trakteer setiap 30 detik.`
    );
  }

  // ── !donate test ──────────────────────────────────────────────────────────
  if (sub === 'test' || sub === 'simulate' || sub === 'coba') {
    const targets = getTargetList();
    if (!targets.length) {
      return m.reply(
        `⚠️ Belum ada target!\n` +
        `Gunakan *!donate settarget* di grup tujuan dulu.`
      );
    }

    const name    = args[1] || 'Donatur Test';
    const message = args.slice(2).join(' ') || 'Semangat terus botnya! 🎉';

    await simulateDonation({ name, message, qty: 2, amount: 20000 });

    return m.reply(
      `✅ *Test terkirim ke ${targets.length} target!*\n` +
      targets.map((t, i) => `${i+1}. \`${t}\``).join('\n')
    );
  }

  // ── !donate settarget ─────────────────────────────────────────────────────
  if (sub === 'settarget' || sub === 'addtarget' || sub === 'set') {
    addTarget(m.chat);
    return m.reply(
      `✅ *Target ditambahkan!*\n\n` +
      `\`${m.chat}\`\n\n` +
      `Notifikasi donate akan muncul di sini.\n` +
      `Test: *!donate test*\n\n` +
      `⚠️ Untuk permanen (tidak hilang saat restart):\n` +
      `Edit *.env*:\n` +
      `\`DONATE_NOTIFY_TARGETS=${m.chat}\``
    );
  }

  // ── !donate removetarget ──────────────────────────────────────────────────
  if (sub === 'removetarget' || sub === 'deltarget' || sub === 'remove') {
    const target = args[1] || m.chat;
    const all    = getTargetList();
    const had    = all.includes(target);
    removeTarget(target);
    return m.reply(had ? `✅ Target \`${target}\` dihapus.` : `❌ Target tidak ditemukan.`);
  }

  // ── !donate targets ───────────────────────────────────────────────────────
  if (sub === 'targets' || sub === 'list') {
    const targets = getTargetList();
    return m.reply(
      `📢 *Donate Notify Targets (${targets.length}):*\n\n` +
      (targets.length
        ? targets.map((t, i) => `${i+1}. \`${t}\``).join('\n')
        : '_Kosong. Gunakan !donate settarget_')
    );
  }

  // ── !donate restart ───────────────────────────────────────────────────────
  if (sub === 'restart' || sub === 'reconnect' || sub === 'reload') {
    stopPolling();
    await new Promise(r => setTimeout(r, 1000));
    startPolling();
    return m.reply(
      `🔄 *Polling restarted!*\n\n` +
      `Cek status: *!donate status*`
    );
  }

  return m.reply(
    `💝 *!donate commands*\n\n` +
    `!donate status        — status polling\n` +
    `!donate howto         — panduan setup\n` +
    `!donate test          — kirim notif test\n` +
    `!donate settarget     — set chat ini\n` +
    `!donate removetarget  — hapus target\n` +
    `!donate targets       — lihat semua target\n` +
    `!donate restart       — restart polling`
  );
};

handler.help      = ['donate status', 'donate test', 'donate howto', 'donate settarget'];
handler.tags      = ['owner'];
handler.command   = /^donate$/i;
handler.ownerOnly = true;
handler.cooldown  = 3;

export default handler;
