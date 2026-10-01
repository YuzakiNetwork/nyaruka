/**
 * commands/owner/maintenance.js
 * Mode maintenance, backup DB, clear data — owner only.
 * Usage: !maintenance on|off | !backup | !clearplayer @user | !resetplayer @user
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config }        from '../../config.js';
import { getPlayer, savePlayer, createPlayerSchema } from '../../lib/game/player.js';
import { normalizeJid }  from '../../handler/index.js';
import * as db           from '../../lib/database/db.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR     = path.resolve(config.db.path);
const BACKUP_DIR = path.resolve('./backups');

let _maintenanceMode = false;
export function isMaintenanceMode() { return _maintenanceMode; }

let handler = async (m, { args, command }) => {

  // ── !maintenance on|off ───────────────────────────────────────────────────
  if (command === 'maintenance') {
    const sub = args[0]?.toLowerCase();
    if (sub === 'on' || sub === 'aktif') {
      _maintenanceMode = true;
      return m.reply(`🔧 *Maintenance mode: ON*\nSemua command RPG dinonaktifkan sementara.`);
    }
    if (sub === 'off' || sub === 'mati') {
      _maintenanceMode = false;
      return m.reply(`✅ *Maintenance mode: OFF*\nBot kembali normal.`);
    }
    return m.reply(`Status: *${_maintenanceMode ? 'ON 🔧' : 'OFF ✅'}*\nGunakan: *!maintenance on/off*`);
  }

  // ── !backup ───────────────────────────────────────────────────────────────
  if (command === 'backup') {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const ts    = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dest  = path.join(BACKUP_DIR, `backup-${ts}`);
    fs.mkdirSync(dest, { recursive: true });

    const files = fs.readdirSync(DB_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      fs.copyFileSync(path.join(DB_DIR, file), path.join(dest, file));
    }

    return m.reply(
      `✅ *Backup Selesai!*\n\n` +
      `📁 Lokasi: \`${dest}\`\n` +
      `📄 Files: ${files.join(', ')}\n` +
      `🕐 Waktu: ${new Date().toLocaleString('id-ID')}`
    );
  }

  // ── !clearplayer @user ────────────────────────────────────────────────────
  if (command === 'clearplayer' || command === 'deleteplayer') {
    const jids = m.raw?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const targetJid = jids[0] ? normalizeJid(jids[0]) : null;
    if (!targetJid) return m.reply(`Usage: *!clearplayer @player*`);

    await db.deleteRecord('players', targetJid);
    return m.reply(`✅ Data player *${targetJid}* dihapus.`);
  }

  // ── !resetplayer @user ────────────────────────────────────────────────────
  if (command === 'resetplayer') {
    const jids = m.raw?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const targetJid = jids[0] ? normalizeJid(jids[0]) : null;
    if (!targetJid) return m.reply(`Usage: *!resetplayer @player*`);

    const player = getPlayer(targetJid);
    if (!player) return m.reply(`❌ Player tidak ditemukan.`);

    const fresh = createPlayerSchema(targetJid, player.name, player.class);
    await savePlayer(fresh);
    return m.reply(`✅ Player *${player.name}* direset ke level 1.`);
  }

  // ── !dbstats ──────────────────────────────────────────────────────────────
  if (command === 'dbstats') {
    const collections = ['players', 'economy', 'world', 'dungeons', 'quests'];
    const lines = [];
    for (const col of collections) {
      const data = await db.readCollection(col);
      const keys = Object.keys(data).length;
      const fp   = path.join(DB_DIR, `${col}.json`);
      const size = fs.existsSync(fp) ? fs.statSync(fp).size : 0;
      lines.push(`  • *${col}*: ${keys} records (${(size/1024).toFixed(1)} KB)`);
    }
    return m.reply(`🗄️ *Database Stats*\n\n${lines.join('\n')}`);
  }
};

handler.help      = ['maintenance on|off', 'backup', 'clearplayer @p', 'resetplayer @p', 'dbstats'];
handler.tags      = ['owner'];
handler.command   = /^(maintenance|backup|clearplayer|deleteplayer|resetplayer|dbstats)$/i;
handler.ownerOnly = true;
handler.cooldown  = 3;

export default handler;
