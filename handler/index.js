/**
 * handler/index.js
 * Command loader + Hot-Reload + Command Logger + @lid Fix
 *
 * Fix @lid:
 *   WhatsApp kini punya 2 format JID user:
 *   - @s.whatsapp.net  : format lama, nomor WA standar
 *   - @lid             : Linked Device ID, angkanya BUKAN nomor WA
 *
 *   Solusi: simpan mapping lid→s.whatsapp.net dari contacts.upsert event,
 *   lalu resolveJid() konversi @lid ke @s.whatsapp.net via mapping.
 *   Fallback: gunakan @lid as-is kalau tidak ketemu di map.
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { config, isOwner } from '../config.js';
import { logger } from '../lib/utils/logger.js';
import { checkCooldown, setCooldown } from '../lib/utils/cooldown.js';
import { checkRateLimit }              from '../lib/utils/ratelimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CMD_DIR   = path.resolve(__dirname, '../commands');

// ── Registry ──────────────────────────────────────────────────────────────────
const registry = new Map(); // filePath → { handler, file, loadedAt }

// ── Contact store: lid → s.whatsapp.net ───────────────────────────────────────
let _contactMap = new Map();

/** Dipanggil dari index.js setelah sock dibuat */
export function setContactStore(map) {
  _contactMap = map;
}

// ── JID Utilities ─────────────────────────────────────────────────────────────

/**
 * Resolve JID apapun ke format standar @s.whatsapp.net.
 *
 * Kasus yang ditangani:
 *   1. 628xxx@s.whatsapp.net → tetap (sudah benar)
 *   2. 2046xxx@lid           → lookup di contactMap → 628xxx@s.whatsapp.net
 *   3. 120363xxx@g.us        → tetap (grup, tidak diubah)
 *   4. @broadcast            → tetap
 */
export function normalizeJid(jid) {
  if (!jid) return '';

  // Grup dan broadcast tidak diubah
  if (jid.endsWith('@g.us'))      return jid;
  if (jid.endsWith('@broadcast')) return jid;

  // Sudah @s.whatsapp.net — bersihkan format
  if (jid.endsWith('@s.whatsapp.net')) {
    const num = jid.split('@')[0].replace(/[^0-9:]/g, '');
    return num ? `${num}@s.whatsapp.net` : jid;
  }

  // Format @lid → resolve lewat contact map
  if (jid.endsWith('@lid')) {
    // Coba lookup langsung dengan full jid
    const byFull = _contactMap.get(jid);
    if (byFull?.endsWith('@s.whatsapp.net')) return byFull;

    // Coba lookup dengan angka saja (tanpa @lid)
    const lidNum = jid.split('@')[0];
    const byNum  = _contactMap.get(lidNum);
    if (byNum?.endsWith('@s.whatsapp.net')) return byNum;

    // Contact map belum terisi (bot baru connect, belum dapat contacts.upsert)
    // Kembalikan @lid as-is — isOwner() di config.js bisa handle @lid langsung
    logger.debug({ lid: jid }, '@lid belum ter-resolve, pakai as-is');
    return jid;
  }

  // Format lain (nomor tanpa suffix) → s.whatsapp.net
  const num = jid.split('@')[0].replace(/[^0-9]/g, '');
  return num ? `${num}@s.whatsapp.net` : jid;
}

/**
 * Ekstrak sender JID yang benar dari pesan Baileys.
 *
 * - DM   → remoteJid (langsung user)
 * - Grup → key.participant atau participant field
 *
 * Keduanya di-resolve via normalizeJid.
 */
export function extractSender(msg) {
  const remote  = msg.key?.remoteJid || '';
  const isGroup = remote.endsWith('@g.us');

  // Di grup, sender bukan remoteJid (itu group ID)
  const rawSender = isGroup
    ? (msg.key?.participant || msg.participant || '')
    : remote;

  return normalizeJid(rawSender);
}

// ── ESM Cache Bust ────────────────────────────────────────────────────────────
async function importFresh(filePath) {
  const url = pathToFileURL(filePath).href + `?t=${Date.now()}`;
  return import(url);
}

// ── Load / Unload / Reload ────────────────────────────────────────────────────
async function loadFile(filePath) {
  try {
    const mod     = await importFresh(filePath);
    const handler = mod.default;

    if (!handler?.command) {
      logger.debug({ file: path.relative(CMD_DIR, filePath) }, 'Skip: no handler.command');
      return false;
    }

    const isNew = !registry.has(filePath);
    registry.set(filePath, { handler, file: filePath, loadedAt: Date.now() });

    logger.info(
      { file: path.relative(CMD_DIR, filePath) },
      isNew ? '➕ Command loaded' : '🔄 Command reloaded'
    );
    return true;
  } catch (err) {
    logger.error(
      { file: path.relative(CMD_DIR, filePath), err: err.message },
      '❌ Load failed'
    );
    return false;
  }
}

function unloadFile(filePath) {
  if (!registry.has(filePath)) return false;
  registry.delete(filePath);
  logger.info({ file: path.relative(CMD_DIR, filePath) }, '🗑️  Command unloaded');
  return true;
}

export async function reloadFile(filePath) {
  unloadFile(filePath);
  return loadFile(filePath);
}

export async function loadCommands() {
  const queue = [];
  const walk  = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory())             walk(path.join(dir, entry.name));
      else if (entry.name.endsWith('.js')) queue.push(path.join(dir, entry.name));
    }
  };
  walk(CMD_DIR);

  const isReload = registry.size > 0;
  if (isReload) registry.clear();

  let ok = 0, fail = 0;
  for (const f of queue) (await loadFile(f)) ? ok++ : fail++;

  logger.info(
    { loaded: ok, failed: fail, total: queue.length },
    `📦 ${isReload ? 'Reload' : 'Startup'}: ${ok} commands ready`
  );
  return { ok, fail, total: queue.length };
}

// ── Hot-Reload Watcher ────────────────────────────────────────────────────────
let _watcher     = null;
const _debounce  = new Map();

export function watchCommands() {
  if (_watcher) return;

  _watcher = fs.watch(CMD_DIR, { recursive: true }, (eventType, filename) => {
    if (!filename?.endsWith('.js')) return;
    const fullPath = path.join(CMD_DIR, filename);

    if (_debounce.has(fullPath)) clearTimeout(_debounce.get(fullPath));
    _debounce.set(fullPath, setTimeout(async () => {
      _debounce.delete(fullPath);
      if (!fs.existsSync(fullPath)) {
        unloadFile(fullPath);
      } else {
        await reloadFile(fullPath);
      }
    }, 200));
  });

  _watcher.on('error', (err) => {
    logger.error({ err: err.message }, '⚠️  Watcher error — restart 3s');
    _watcher = null;
    setTimeout(watchCommands, 3000);
  });

  logger.info('👁️  Hot-reload watcher aktif');
}

export function stopWatcher() {
  _watcher?.close();
  _watcher = null;
}

// ── Public API ────────────────────────────────────────────────────────────────
export function getCommands() {
  return [...registry.values()].sort((a, b) => {
    const tA = a.handler.tags?.[0] || 'z';
    const tB = b.handler.tags?.[0] || 'z';
    return tA.localeCompare(tB) ||
      (a.handler.help?.[0] || '').localeCompare(b.handler.help?.[0] || '');
  });
}

export function getCommandStats() {
  const byTag = {};
  for (const { handler } of registry.values()) {
    const tag = handler.tags?.[0] || 'misc';
    byTag[tag] = (byTag[tag] || 0) + 1;
  }
  return { total: registry.size, byTag };
}

export function findCommandFile(name) {
  for (const [filePath] of registry) {
    if (path.basename(filePath, '.js').toLowerCase() === name.toLowerCase()) return filePath;
  }
  // Cari di disk juga
  const results = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (e.name.replace('.js','').toLowerCase() === name.toLowerCase())
        results.push(path.join(dir, e.name));
    }
  };
  try { walk(CMD_DIR); } catch {}
  return results[0] || null;
}

// ── Command Logger ────────────────────────────────────────────────────────────

/** Format nomor untuk display: 628xxx → 0xxx atau tetap internasional */
function displayNum(jid) {
  const num = jid?.split('@')[0] || jid || '?';
  // Konversi 628 → 08 untuk display lebih pendek
  if (num.startsWith('62')) return '0' + num.slice(2);
  return num;
}

/** Warna ANSI untuk terminal */
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  magenta:'\x1b[35m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
  gray:   '\x1b[90m',
};

/** Tag → warna */
const TAG_COLOR = {
  rpg:     C.green,
  economy: C.yellow,
  social:  C.cyan,
  info:    C.blue,
  owner:   C.red,
  misc:    C.magenta,
};

function logCommand({ sender, chat, command, args, tag, isGroup, success, ms, errMsg }) {
  const time    = new Date().toTimeString().slice(0,8);
  const who     = displayNum(sender);
  const where   = isGroup ? `[G:${displayNum(chat)}]` : '[DM]';
  const tagCol  = TAG_COLOR[tag] || C.white;
  const cmdStr  = `!${command}${args?.length ? ' ' + args.join(' ') : ''}`;
  const status  = success
    ? `${C.green}✓${C.reset}`
    : `${C.red}✗ ${errMsg || 'error'}${C.reset}`;
  const timeStr = `${C.gray}${time}${C.reset}`;
  const msStr   = ms !== undefined ? ` ${C.dim}${ms}ms${C.reset}` : '';

  // Format: [12:34:56] ✓ 0812xxx [DM] [rpg] !battle
  console.log(
    `${timeStr} ${status} ` +
    `${C.cyan}${who}${C.reset} ` +
    `${C.dim}${where}${C.reset} ` +
    `${tagCol}[${tag}]${C.reset} ` +
    `${C.bold}${cmdStr}${C.reset}` +
    msStr
  );
}

// ── Router ────────────────────────────────────────────────────────────────────
export async function routeMessage(sock, m) {
  if (!m.body) return;

  // Multi-prefix support
  const prefixes = config.bot.prefixes || [config.bot.prefix];
  const usedPrefix = prefixes.find(p => m.body.startsWith(p));
  if (!usedPrefix) return;
  const prefix = usedPrefix;

  const [cmdRaw, ...argParts] = m.body.slice(prefix.length).trim().split(/\s+/);
  const command = cmdRaw.toLowerCase();
  const args    = argParts;

  const match = [...registry.values()].find(c => c.handler.command.test(command));
  if (!match) return;

  const { handler } = match;
  const tag     = handler.tags?.[0] || 'misc';
  const _isOwner = isOwner(m.sender);

  if (handler.ownerOnly && !_isOwner) {
    logCommand({ sender: m.sender, chat: m.chat, command, args, tag, isGroup: m.isGroup, success: false, errMsg: 'owner only' });
    return sock.sendMessage(m.chat, { text: '🚫 Owner only command.' });
  }

  // Global rate limit (20 cmd/menit)
  const { limited, remaining: rlRemaining, waitSeconds } = checkRateLimit(m.sender);
  if (limited) {
    // Hanya show warning pertama kali
    if (rlRemaining === 0) {
      return sock.sendMessage(m.chat, {
        text: `⛔ Rate limit! Kamu terlalu banyak menggunakan command.\nTunggu *${waitSeconds}s* sebelum bisa pakai command lagi.\n\n💡 Max: 20 command per menit.`,
      });
    }
    return; // Silent ignore untuk spam berikutnya
  }

  const { onCooldown, remaining, showMessage } = checkCooldown(m.sender, command, handler.cooldown ?? 3);
  if (onCooldown) {
    logCommand({ sender: m.sender, chat: m.chat, command, args, tag, isGroup: m.isGroup, success: false, errMsg: `cd ${remaining}s` });
    // Hanya show warning setiap 10 detik sekali untuk mencegah spam
    if (showMessage) {
      return sock.sendMessage(m.chat, {
        text: `⏳ Cooldown! Tunggu *${remaining}s* lagi untuk *${prefix}${command}*.`,
      });
    }
    return; // Silent ignore jika belum 10 detik
  }

  const start = Date.now();
  try {
    setCooldown(m.sender, command);
    await handler(m, { sock, args, command, prefix, isOwner: _isOwner });
    const ms = Date.now() - start;
    logCommand({ sender: m.sender, chat: m.chat, command, args, tag, isGroup: m.isGroup, success: true, ms });
  } catch (err) {
    const ms = Date.now() - start;
    logCommand({ sender: m.sender, chat: m.chat, command, args, tag, isGroup: m.isGroup, success: false, ms, errMsg: err.message });
    logger.error({ command, sender: m.sender, err: err.message, stack: err.stack }, 'Command error');
    await sock.sendMessage(m.chat, { text: `❌ Error: ${err.message}` });
  }
}

// ── Message Normalizer ────────────────────────────────────────────────────────
export function normalizeMessage(sock, msg) {
  const type = Object.keys(msg.message || {})[0];
  if (!type) return null;

  const content =
    msg.message?.[type]?.text              ||
    msg.message?.[type]?.caption           ||
    msg.message?.conversation              ||
    msg.message?.[type]?.hydratedContentText || '';

  const remote  = msg.key?.remoteJid || '';
  const isGroup = remote.endsWith('@g.us');
  const sender  = extractSender(msg);

  return {
    key:          msg.key,
    sender,
    chat:         remote,
    body:         content,
    isGroup,
    raw:          msg,
    reply:        (text) => sock.sendMessage(remote, { text }, { quoted: msg }),
    senderNumber: sender.split('@')[0],
    pushName:     msg.pushName || '',
  };
}

export default {
  loadCommands, watchCommands, stopWatcher,
  reloadFile, findCommandFile,
  getCommands, getCommandStats,
  setContactStore,
  routeMessage, normalizeMessage,
  normalizeJid, extractSender,
};
