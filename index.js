/**
 * index.js — Pairing Code Auth
 * Fix: corrupt session auto-clear on restart
 */

import 'dotenv/config';
import {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  getContentType,
} from '@whiskeysockets/baileys';
import cron from 'node-cron';
import path from 'path';
import fs   from 'fs';
import pino from 'pino';

import { config }    from './config.js';
import { initDatabase } from './lib/database/db.js';
import { printBanner, printConnected, printReconnecting } from './lib/utils/banner.js';
import { logger }    from './lib/utils/logger.js';
import { loadCommands, watchCommands, routeMessage, normalizeMessage, setContactStore, getCommandStats } from './handler/index.js';
import { loadEconomy, economyTick, checkAndRotateWorldEvent } from './lib/game/economy.js';
import { startPolling, stopPolling, setWASock as setDonateWASock } from './webhook/trakteer.js';

const SESSION_DIR = path.resolve(`./${config.bot.sessionName}`);
const LOGS_DIR    = path.resolve('./logs');

let _cronsStarted = false;
let _pairingDone  = false;

for (const dir of [SESSION_DIR, LOGS_DIR, config.db.path]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Session helpers ───────────────────────────────────────────────────────────

function hasSession() {
  return fs.existsSync(path.join(SESSION_DIR, 'creds.json'));
}

function clearSession() {
  try {
    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  } catch {}
  _pairingDone = false;
  console.log('🗑️  Session cleared — will re-pair on next connect');
}

/**
 * Validate session integrity before connecting.
 * Corrupt session = creds.json exists but keys files missing/broken.
 * Jika corrupt → hapus saja, lebih aman pairing ulang.
 */
function validateSession() {
  const credsPath = path.join(SESSION_DIR, 'creds.json');
  if (!fs.existsSync(credsPath)) return true; // no session = valid (will pair)

  try {
    const raw  = fs.readFileSync(credsPath, 'utf8');
    const data = JSON.parse(raw);
    // creds.json harus punya field 'me' atau 'noiseKey' minimal
    if (!data.noiseKey && !data.me) {
      console.log('⚠️  creds.json corrupt (missing keys) — clearing session...');
      clearSession();
      return false;
    }
    return true;
  } catch {
    console.log('⚠️  creds.json tidak bisa dibaca — clearing session...');
    clearSession();
    return false;
  }
}

// ── Startup ───────────────────────────────────────────────────────────────────

async function start() {
  // Initialize database (JSON file-based)
  try {
    await initDatabase();
  } catch (err) {
    console.error('\n\x1b[31m❌ Database initialization failed!\x1b[0m');
    console.error(err);
    process.exit(1);
  }

  // Tampilkan banner launching
  await printBanner({
    version:       process.env.npm_package_version || '3.0.1',
    botName:       config.bot.name    || 'Nyaruka',
    prefix:        config.bot.prefix  || '!',
    ownerNumber:   process.env.BOT_OWNER_NUMBER || process.env.BOT_OWNER_LID || 'Belum diset',
    totalCommands: 49,
    dbPath:        config.db?.path    || './data',
    logLevel:      process.env.LOG_LEVEL || 'info',
    donateEnabled: config.donate?.enabled !== false,
    apiKey:        config.donate?.apiKey  || '',
  });

  logger.info('🚀 Memulai Nyaruka...');

  if (!config.bot.number) {
    console.error('\n\x1b[31m❌ BOT_NUMBER belum diset di .env!\x1b[0m\n');
    process.exit(1);
  }

  // Validasi session sebelum connect
  validateSession();

  const economy = await loadEconomy();
  logger.info({ items: Object.keys(economy).length }, '📊 Economy initialized');

  await loadCommands();
  const stats = getCommandStats();
  logger.info({ total: stats.total, ...stats.byTag }, '📦 Commands loaded');

  watchCommands();   // hot-reload aktif
  await connectWhatsApp();
}

// ── Request Pairing Code ──────────────────────────────────────────────────────

async function requestPairingCode(sock) {
  if (_pairingDone) return;
  _pairingDone = true;

  const phone = config.bot.number.replace(/[^0-9]/g, '');

  try {
    logger.info({ phone }, '🔑 Requesting pairing code...');
    const code      = await sock.requestPairingCode(phone);
    const formatted = code?.match(/.{1,4}/g)?.join('-') ?? code;

    console.log('\n\x1b[33m╔════════════════════════════════════════╗');
    console.log('║        🔑  PAIRING CODE BOT             ║');
    console.log('╠════════════════════════════════════════╣');
    console.log(`║                                        ║`);
    console.log(`║      \x1b[1m\x1b[37m${formatted}\x1b[0m\x1b[33m                     ║`);
    console.log(`║                                        ║`);
    console.log('║  1. Buka WhatsApp di HP                ║');
    console.log('║  2. Setelan → Perangkat Tertaut        ║');
    console.log('║  3. Tautkan Perangkat                  ║');
    console.log('║  4. Tautkan dengan nomor telepon       ║');
    console.log(`║  5. Masukkan: \x1b[1m\x1b[37m${formatted}\x1b[0m\x1b[33m               ║`);
    console.log('╚════════════════════════════════════════╝\x1b[0m\n');

    logger.info({ code: formatted }, '🔑 Pairing code displayed');
  } catch (err) {
    _pairingDone = false;
    logger.error({ err: err.message }, '❌ Pairing code failed');
    console.error(`\n\x1b[31m❌ Gagal dapat pairing code: ${err.message}\x1b[0m\n`);
    setTimeout(() => requestPairingCode(sock), 10_000);
  }
}

// ── WhatsApp Connection ───────────────────────────────────────────────────────

async function connectWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  const { version, isLatest } = await fetchLatestBaileysVersion();
  logger.info({ version: version.join('.'), isLatest }, '📡 WA version');

  const baileyLogger = pino({ level: 'silent' });

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys:  makeCacheableSignalKeyStore(state.keys, baileyLogger),
    },
    logger:                         baileyLogger,
    browser:                        ['Mac OS', 'Safari', '17.4.1'],
    generateHighQualityLinkPreview: false,
    syncFullHistory:                false,
    markOnlineOnConnect:            false,
    connectTimeoutMs:               60_000,
    keepAliveIntervalMs:            10_000,
    retryRequestDelayMs:            2_000,
    mobile:                         false,
  });

  // ── Tangkap error crypto / auth sebelum jadi crash ────────────────────────
  sock.ws.on('error', (err) => {
    logger.error({ err: err.message }, '🔌 WebSocket error');
  });

  sock.ev.on('creds.update', saveCreds);

  // ── Contact store: resolve @lid → nomor WA ────────────────────────────────
  // Baileys versi baru pakai @lid sebagai JID internal.
  // contacts.upsert menyimpan mapping: lid → phoneNumber (@s.whatsapp.net)
  const contactMap = new Map(); // lid → jid s.whatsapp.net
  setContactStore(contactMap);

  /**
   * Update contact map saat Baileys kirim info kontak.
   * contact.id  = nomor WA standar (628xxx@s.whatsapp.net)
   * contact.lid = Linked Device ID  (2046xxx@lid)
   * Keduanya bisa null — selalu cek sebelum set.
   */
  function updateContactMap(contacts) {
    for (const c of (contacts || [])) {
      const id  = c?.id;   // @s.whatsapp.net atau null
      const lid = c?.lid;  // @lid atau null
      if (id && lid) {
        contactMap.set(lid, id);  // lid → s.whatsapp.net
        contactMap.set(id, id);   // identity map
      } else if (id) {
        contactMap.set(id, id);   // simpan @s.whatsapp.net saja
      }
      // Juga simpan nomor saja sebagai key alternatif
      if (id) {
        const num = id.split('@')[0];
        if (num) contactMap.set(num, id);
      }
      if (lid) {
        const num = lid.split('@')[0];
        if (num && id) contactMap.set(num, id);
      }
    }
  }

  sock.ev.on('contacts.upsert', updateContactMap);
  sock.ev.on('contacts.update', updateContactMap);

  // Saat pertama connect — minta sync contacts
  sock.ev.on('messaging-history.set', ({ contacts: histContacts }) => {
    if (histContacts?.length) updateContactMap(histContacts);
  });

  // ── Connection events ─────────────────────────────────────────────────────
  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {

    if (connection === 'connecting') {
      console.log('🔄 Connecting to WhatsApp...');
      // Minta pairing code jika belum ada session
      if (!hasSession() && !_pairingDone) {
        setTimeout(() => requestPairingCode(sock), 5000);
      }
    }

    if (connection === 'open') {
      printConnected(config.bot.name || 'Nyaruka');
      logger.info('✅ Connected!');

      // Update WA sock ke donate notifier (setiap reconnect)
      setDonateWASock(sock);

      if (!_cronsStarted) {
        startCronJobs(sock);
        _cronsStarted = true;

        // Connect ke Trakteer WebSocket (langsung, tanpa ngrok/server publik)
        if (config.donate?.enabled !== false) {
          startPolling();
        }
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const message    = lastDisconnect?.error?.message || '';

      logger.warn({ statusCode, message }, '⚠️  Disconnected');

      // ── Deteksi session corrupt dari pesan error ──────────────────────────
      const isCorrupt =
        message.includes('Unsupported state') ||
        message.includes('unable to authenticate') ||
        message.includes('Bad MAC') ||
        message.includes('decrypt') ||
        statusCode === DisconnectReason.badSession ||
        statusCode === 401;

      if (isCorrupt) {
        console.log('🗑️  Session corrupt — hapus session & pairing ulang...');
        clearSession();
        setTimeout(connectWhatsApp, 3000);
        return;
      }

      if (statusCode === DisconnectReason.loggedOut) {
        console.log('🚪 Logged out — hapus session & pairing ulang...');
        clearSession();
        setTimeout(connectWhatsApp, 3000);
        return;
      }

      if (statusCode === 405) {
        console.log('⏳ Error 405 — tunggu 15 detik...');
        setTimeout(connectWhatsApp, 15_000);
        return;
      }

      // Default: reconnect biasa
      console.log('🔄 Reconnecting in 5s...');
      setTimeout(connectWhatsApp, 5000);
    }
  });

  // ── Tangkap unhandled rejection dari Baileys (crypto error) ──────────────
  const cryptoErrorHandler = (reason) => {
    const msg = reason?.message || String(reason);
    if (
      msg.includes('Unsupported state') ||
      msg.includes('unable to authenticate') ||
      msg.includes('Bad MAC')
    ) {
      logger.error('🔐 Crypto/auth error — clearing corrupt session...');
      console.log('\n🔐 Session corrupt terdeteksi — hapus & restart...\n');
      clearSession();
      // Tutup socket lama
      try { sock.end(); } catch {}
      setTimeout(connectWhatsApp, 3000);
    }
  };

  process.on('unhandledRejection', cryptoErrorHandler);

  // Cleanup listener saat socket tutup agar tidak numpuk
  sock.ev.on('connection.update', ({ connection }) => {
    if (connection === 'close') {
      process.removeListener('unhandledRejection', cryptoErrorHandler);
    }
  });

  // ── Incoming messages ─────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      const m = normalizeMessage(sock, msg);
      if (!m || !m.body) continue;
      await routeMessage(sock, m).catch(err =>
        logger.error({ err: err.message }, 'Route error')
      );
    }
  });
}

// ── Cron Jobs ─────────────────────────────────────────────────────────────────

function startCronJobs(sock) {
  const interval = config.economy.tickInterval;

  cron.schedule(`*/${interval} * * * *`, async () => {
    try { await economyTick(); }
    catch (err) { logger.error({ err: err.message }, 'Economy tick error'); }
  });

  cron.schedule('*/5 * * * *', async () => {
    try { await checkAndRotateWorldEvent(); }
    catch (err) { logger.error({ err: err.message }, 'World event error'); }
  });

  logger.info(`⏱️  Cron jobs started (tick every ${interval}min)`);
}

// ── Guards ────────────────────────────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
});

start().catch(err => {
  logger.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
