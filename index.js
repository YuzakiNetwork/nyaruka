/**
 * index.js — Pairing Code Auth
 * Fix: corrupt session auto-clear on restart
 */

import 'dotenv/config';
import {
  makeWASocket,
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
import {
  createCredentialPersister,
  createQueuedKeyStore,
  createReconnectController,
  quarantineSession,
  retryFailedCredentialSave,
  sanitizeDiagnostic,
} from './lib/whatsapp/reliability.js';
import { writePairingCodeToTerminal } from './lib/whatsapp/pairing-output.js';
import { logReconnectDiagnostic } from './lib/whatsapp/reconnect-logging.js';
import { loadCommands, watchCommands, routeMessage, normalizeMessage, setContactStore, getCommandStats } from './handler/index.js';
import { loadEconomy, economyTick, checkAndRotateWorldEvent } from './lib/game/economy.js';
import { startPolling, stopPolling, setWASock as setDonateWASock } from './webhook/trakteer.js';

const SESSION_DIR = path.resolve(`./${config.bot.sessionName}`);
const LOGS_DIR    = path.resolve('./logs');
const credentialWriteQueue = { current: Promise.resolve() };
const keyWriteQueue = { current: Promise.resolve() };

let _cronsStarted = false;
let _pairingDone  = false;
let _pairingTimer = null;

for (const dir of [SESSION_DIR, LOGS_DIR, config.db.path]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Session helpers ───────────────────────────────────────────────────────────

function hasSession() {
  return fs.existsSync(path.join(SESSION_DIR, 'creds.json'));
}

function clearPairingTimer() {
  if (_pairingTimer) {
    clearTimeout(_pairingTimer);
    _pairingTimer = null;
  }
}

async function closeWhatsAppSocket(sock) {
  if (!sock) return;
  const ws = sock.ws;
  if (!ws || ws.readyState === 3 || typeof ws.once !== 'function') {
    try { sock.end(); } catch {}
    return;
  }

  await new Promise((resolve) => {
    let timer;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.off?.('close', finish);
      resolve();
    };
    ws.once('close', finish);
    timer = setTimeout(finish, 2_000);
    try { sock.end(); } catch { finish(); }
  });
}

const reconnect = createReconnectController({
  connect: connectWhatsApp,
  closeSocket: closeWhatsAppSocket,
  quarantine: async () => {
    // Baileys writes creds and Signal keys to the configured path; drain both
    // queues before moving that path so no old write can repopulate a new session.
    await Promise.all([credentialWriteQueue.current, keyWriteQueue.current]);
    return quarantineSession(SESSION_DIR);
  },
  onPairingRequired: () => {
    clearPairingTimer();
    _pairingDone = false;
  },
  onDiagnostic: (event, details) => logReconnectDiagnostic(logger, event, details),
});

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
    version:       process.env.npm_package_version || '3.1.2',
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

  const economy = await loadEconomy();
  logger.info({ items: Object.keys(economy).length }, '📊 Economy initialized');

  await loadCommands();
  const stats = getCommandStats();
  logger.info({ total: stats.total, ...stats.byTag }, '📦 Commands loaded');

  watchCommands();   // hot-reload aktif
  await reconnect.connect();
}

// ── Request Pairing Code ──────────────────────────────────────────────────────

async function requestPairingCode(sock) {
  if (_pairingDone || reconnect.getSocket() !== sock) return;
  _pairingDone = true;

  const phone = config.bot.number.replace(/[^0-9]/g, '');

  try {
    logger.info('🔑 Requesting pairing code...');
    const code      = await sock.requestPairingCode(phone);
    const displayed = writePairingCodeToTerminal(code);
    logger.info(
      { event: displayed ? 'pairing_code_displayed' : 'pairing_code_withheld' },
      displayed
        ? 'Pairing code displayed on attached terminal'
        : 'Pairing code withheld because no interactive terminal is attached',
    );
  } catch (err) {
    _pairingDone = false;
    logger.error(sanitizeDiagnostic(err), 'Pairing code request failed');
    console.error('\n\x1b[31m❌ Gagal mendapatkan pairing code; akan mencoba lagi.\x1b[0m\n');
    _pairingTimer = setTimeout(() => {
      _pairingTimer = null;
      if (reconnect.getSocket() === sock) void requestPairingCode(sock);
    }, 10_000);
  }
}

// ── WhatsApp Connection ───────────────────────────────────────────────────────

async function connectWhatsApp(registerSocket) {
  if (!(await retryFailedCredentialSave(credentialWriteQueue))) {
    throw Object.assign(new Error('Credential save remains pending'), { code: 'EAGAIN' });
  }

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  const { version, isLatest } = await fetchLatestBaileysVersion();
  logger.info({ version: version.join('.'), isLatest }, '📡 WA version');

  const baileyLogger = pino({ level: 'silent' });

  let sock;
  let socketRegistered = false;
  const trackedKeys = createQueuedKeyStore(state.keys, {
    queue: keyWriteQueue,
    isActive: () => !socketRegistered || reconnect.getSocket() === sock,
    report: (details) => logger.error(
      { event: 'signal-key.update', ...details },
      'WhatsApp Signal-key persistence failed; auth state preserved',
    ),
  });
  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys:  makeCacheableSignalKeyStore(trackedKeys, baileyLogger),
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

  if (!registerSocket(sock)) throw new Error('WhatsApp socket registration rejected');
  socketRegistered = true;

  sock.ws.on('error', (err) => {
    logger.error(sanitizeDiagnostic(err), 'WebSocket error; authentication state preserved');
    void reconnect.handleSocketError(sock, err);
  });

  const persistCredentials = createCredentialPersister(saveCreds, (result, details) => {
    if (result === 'saved') {
      logger.info({ event: 'creds.update', result }, 'WhatsApp session credentials saved');
    } else {
      logger.error(
        { event: 'creds.update', result, ...details },
        'WhatsApp session credentials save failed; existing auth state preserved',
      );
    }
  }, credentialWriteQueue);
  sock.ev.on('creds.update', async () => {
    if (reconnect.getSocket() !== sock) return;
    await persistCredentials();
  });

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
      if (!hasSession() && !_pairingDone && !_pairingTimer) {
        _pairingTimer = setTimeout(() => {
          _pairingTimer = null;
          if (reconnect.getSocket() === sock) void requestPairingCode(sock);
        }, 5000);
      }
    }

    if (connection === 'open') {
      if (!reconnect.markOpen(sock)) return;
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
      clearPairingTimer();
      _pairingDone = false;
      if (reconnect.getSocket() === sock) setDonateWASock(null);
      logger.warn(
        sanitizeDiagnostic(lastDisconnect?.error),
        'WhatsApp disconnected; auth state preserved unless logout is confirmed',
      );
      void reconnect.handleDisconnect(sock, lastDisconnect?.error);
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

process.on('unhandledRejection', (reason) => {
  logger.error(sanitizeDiagnostic(reason), 'Unhandled promise rejection; WhatsApp auth state preserved');
});

process.on('uncaughtException', (err) => {
  logger.error(sanitizeDiagnostic(err), 'Uncaught exception; WhatsApp auth state preserved');
});

start().catch(err => {
  logger.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
