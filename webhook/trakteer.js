/**
 * webhook/trakteer.js
 * Trakteer Public API - Support History Polling
 *
 * CARA DAPAT API KEY:
 *   1. Login ke dashboard.trakteer.id
 *   2. Menu Integrations → Public API
 *   3. Copy "My API Key" (format: trapi-xxxxxxxxx)
 *   4. Paste ke TRAKTEER_API_KEY di .env
 *
 * FLOW:
 *   Bot → polling GET /api/v1/support-history setiap 30s
 *   → cek ada transaksi baru (bandingkan last seen ID)
 *   → kirim notif ke WA grup/channel
 *
 * ✅ Tanpa ngrok/server publik
 * ✅ Tanpa WebSocket
 * ✅ Simple polling
 */

import { config } from '../config.js';
import { logger } from '../lib/utils/logger.js';

// ── State ─────────────────────────────────────────────────────────────────────
let _sock          = null;
let _pollTimer     = null;
let _lastSeenTxId  = null;  // ID transaksi terakhir yang sudah diproses
let _isPolling     = false;
let _runtimeTargets = new Set(config.donate?.notifyTargets || []);

export function setWASock(sock) { _sock = sock; }
export function addTarget(jid) { _runtimeTargets.add(jid); }
export function removeTarget(jid) { _runtimeTargets.delete(jid); }
export function getTargetList() { return [..._runtimeTargets]; }

// ── Format pesan ──────────────────────────────────────────────────────────────
function formatRupiah(amount) {
  if (!amount && amount !== 0) return '?';
  return 'Rp ' + Number(amount).toLocaleString('id-ID');
}

function buildThankYouMessage(donation) {
  const name = donation.is_anonymous
    ? '🎭 Anonim'
    : (donation.supporter_name || donation.name || 'Seseorang');

  const qty    = donation.quantity  || 1;
  const unit   = donation.unit_name || donation.unit || 'Kopi';
  const amount = donation.total_amount || donation.amount || 0;

  const msg  = donation.supporter_message || donation.message || '';
  const txId = donation.transaction_id    || donation.order_id || donation.id || '';

  const lines = [
    `🎉🎊 *DONATE MASUK!* 🎊🎉`,
    `─────────────────────────`,
    `💝 *${name}*`,
    `   baru saja mentrakteer *${qty} ${unit}*!`,
    ``,
    `💰 Total: *${formatRupiah(amount)}*`,
  ];

  if (msg) lines.push(``, `💬 "_${msg}_"`);

  lines.push(
    ``,
    `─────────────────────────`,
    `🙏 *Terima kasih banyak!*`,
    `Dukungan kamu sangat berarti! ❤️`,
  );

  if (txId && !txId.startsWith('test-')) {
    lines.push(``, `🧾 \`${txId}\``);
  }

  return lines.join('\n');
}

// ── Kirim ke WA ──────────────────────────────────────────────────────────────
async function sendToWA(donation) {
  if (!_sock) {
    logger.warn('Trakteer: WA sock belum siap');
    return;
  }

  const targets = [..._runtimeTargets];
  if (!targets.length) {
    logger.debug('Trakteer: Belum ada target notifikasi');
    return;
  }

  const text = buildThankYouMessage(donation);

  for (const target of targets) {
    try {
      await _sock.sendMessage(target, { text });
      logger.info(
        { target, name: donation.supporter_name || donation.name, amount: donation.total_amount || donation.amount },
        '💝 Donate notification sent'
      );
    } catch (err) {
      logger.error({ target, err: err.message }, 'Failed send donate notification');
    }
  }
}

// ── Fetch Support History dari Trakteer API ───────────────────────────────────
async function fetchSupportHistory() {
  const apiKey = config.donate?.apiKey;
  if (!apiKey) {
    logger.warn('Trakteer: TRAKTEER_API_KEY belum diisi di .env');
    return [];
  }

  const url = 'https://api.trakteer.id/v1/support-history';

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'key':               apiKey,
        'Accept':            'application/json',
        'X-Requested-With':  'XMLHttpRequest',
        'User-Agent':        'RPG-Bot/1.0',
      },
    });

    if (!res.ok) {
      const err = await res.text().catch(() => 'Unknown error');
      logger.error({ status: res.status, err }, 'Trakteer API error');
      return [];
    }

    const data = await res.json();

    // Response format bisa berbeda, cek beberapa kemungkinan
    // { data: [...] } atau { supports: [...] } atau langsung array
    const supports = data.data || data.supports || data.history || (Array.isArray(data) ? data : []);

    return supports;

  } catch (err) {
    logger.error({ err: err.message }, 'Fetch support history error');
    return [];
  }
}

// ── Polling loop ──────────────────────────────────────────────────────────────
async function poll() {
  if (_isPolling) return; // prevent double polling
  _isPolling = true;

  try {
    const supports = await fetchSupportHistory();

    if (!supports.length) {
      _isPolling = false;
      return;
    }

    // Sort by created_at descending (terbaru duluan)
    const sorted = supports.sort((a, b) => {
      const timeA = new Date(a.created_at || a.date || 0).getTime();
      const timeB = new Date(b.created_at || b.date || 0).getTime();
      return timeB - timeA;
    });

    // Ambil ID transaksi terbaru
    const latestTxId = sorted[0].transaction_id || sorted[0].order_id || sorted[0].id;

    // Pertama kali polling, simpan ID terakhir tanpa kirim notif
    if (!_lastSeenTxId) {
      _lastSeenTxId = latestTxId;
      logger.info({ txId: latestTxId }, '🔍 First poll — baseline set');
      _isPolling = false;
      return;
    }

    // Cari transaksi baru (yang ID-nya belum pernah dilihat)
    const newDonations = [];
    for (const s of sorted) {
      const txId = s.transaction_id || s.order_id || s.id;
      if (txId === _lastSeenTxId) break; // sampai last seen, stop
      newDonations.push(s);
    }

    // Kirim notif untuk setiap donasi baru
    for (const donation of newDonations.reverse()) { // kirim dari yang lama ke baru
      await sendToWA(donation);
      await new Promise(r => setTimeout(r, 500)); // delay 500ms antar notif
    }

    // Update last seen
    if (newDonations.length > 0) {
      _lastSeenTxId = latestTxId;
      logger.info({ count: newDonations.length, txId: latestTxId }, '💝 New donations processed');
    }

  } catch (err) {
    logger.error({ err: err.message }, 'Polling error');
  } finally {
    _isPolling = false;
  }
}

// ── Start polling ─────────────────────────────────────────────────────────────
export function startPolling() {
  if (_pollTimer) return;

  const interval = config.donate?.pollInterval || 30_000; // default 30 detik
  const apiKey   = config.donate?.apiKey;

  if (!apiKey) {
    logger.warn('Trakteer: TRAKTEER_API_KEY belum diisi — polling disabled');
    logger.warn('→ Lihat dashboard.trakteer.id/manage/api-trakteer');
    return;
  }

  logger.info({ interval: `${interval/1000}s` }, '🔄 Trakteer polling started');

  // Polling pertama langsung
  poll().catch(err => logger.error({ err: err.message }, 'Initial poll error'));

  // Lalu schedule interval
  _pollTimer = setInterval(() => {
    poll().catch(err => logger.error({ err: err.message }, 'Poll error'));
  }, interval);
}

export function stopPolling() {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
    logger.info('🛑 Trakteer polling stopped');
  }
}

// ── Status ────────────────────────────────────────────────────────────────────
export function getTrakteerStatus() {
  return {
    polling:     !!_pollTimer,
    apiKey:      config.donate?.apiKey ? '***' + config.donate.apiKey.slice(-6) : '(belum diset)',
    interval:    `${(config.donate?.pollInterval || 30_000) / 1000}s`,
    lastSeenTx:  _lastSeenTxId || '(belum ada)',
    targets:     [..._runtimeTargets],
  };
}

// ── Simulasi donasi (untuk testing) ───────────────────────────────────────────
export async function simulateDonation(opts = {}) {
  const fake = {
    transaction_id:    'test-' + Date.now(),
    supporter_name:    opts.name    || 'Donatur Test',
    supporter_message: opts.message || 'Semangat botnya! 🎉',
    unit_name:         opts.unit    || 'Kopi',
    quantity:          opts.qty     || 2,
    total_amount:      opts.amount  || 20000,
    is_anonymous:      opts.anon    || false,
    created_at:        new Date().toISOString(),
  };
  await sendToWA(fake);
  return fake;
}

// Backward compat exports
export function connectTrakteer()    { startPolling(); }
export function disconnectTrakteer() { stopPolling(); }
export function startWebhookServer() { startPolling(); }

export default {
  setWASock, startPolling, stopPolling,
  addTarget, removeTarget, getTargetList,
  getTrakteerStatus, simulateDonation,
  connectTrakteer, disconnectTrakteer,
};
