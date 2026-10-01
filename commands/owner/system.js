/**
 * commands/owner/system.js
 * Info sistem server + bot — owner only.
 * Usage: !system | !memory | !uptime
 */

import os       from 'os';
import process  from 'process';
import fs       from 'fs';
import { getCommandStats } from '../../handler/index.js';
import { getAllPlayers }   from '../../lib/game/player.js';

function fmtBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(1)} ${units[i]}`;
}

function fmtUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
}

let handler = async (m, { command }) => {

  // ── !memory ───────────────────────────────────────────────────────────────
  if (command === 'memory' || command === 'mem') {
    const mem    = process.memoryUsage();
    const total  = os.totalmem();
    const free   = os.freemem();
    const used   = total - free;
    return m.reply(
      `💾 *Memory Usage*\n\n` +
      `Bot (RSS):    *${fmtBytes(mem.rss)}*\n` +
      `Bot (Heap):   *${fmtBytes(mem.heapUsed)}/${fmtBytes(mem.heapTotal)}*\n` +
      `Bot (Ext):    *${fmtBytes(mem.external)}*\n\n` +
      `OS Total: *${fmtBytes(total)}*\n` +
      `OS Used:  *${fmtBytes(used)}* (${Math.round(used/total*100)}%)\n` +
      `OS Free:  *${fmtBytes(free)}*`
    );
  }

  // ── !uptime ───────────────────────────────────────────────────────────────
  if (command === 'uptime') {
    return m.reply(
      `⏱️ *Uptime*\n\n` +
      `Bot:    *${fmtUptime(process.uptime())}*\n` +
      `Server: *${fmtUptime(os.uptime())}*`
    );
  }

  // ── !system ───────────────────────────────────────────────────────────────
  const mem     = process.memoryUsage();
  const cpus    = os.cpus();
  const load    = os.loadavg();
  const stats   = getCommandStats();
  const players = getAllPlayers();

  return m.reply(
    `🖥️ *System Info*\n\n` +
    `*Server*\n` +
    `OS:       ${os.type()} ${os.release()}\n` +
    `CPU:      ${cpus[0]?.model || 'Unknown'} (${cpus.length} core)\n` +
    `Load:     ${load.map(l => l.toFixed(2)).join(' / ')}\n` +
    `RAM:      ${fmtBytes(os.totalmem() - os.freemem())} / ${fmtBytes(os.totalmem())}\n` +
    `Uptime:   ${fmtUptime(os.uptime())}\n\n` +
    `*Bot*\n` +
    `Node:     ${process.version}\n` +
    `PID:      ${process.pid}\n` +
    `Uptime:   ${fmtUptime(process.uptime())}\n` +
    `Heap:     ${fmtBytes(mem.heapUsed)} / ${fmtBytes(mem.heapTotal)}\n` +
    `RSS:      ${fmtBytes(mem.rss)}\n\n` +
    `*Bot Stats*\n` +
    `Commands: ${stats.total}\n` +
    `Players:  ${players.length}`
  );
};

handler.help      = ['system', 'memory', 'uptime'];
handler.tags      = ['owner'];
handler.command   = /^(system|sysinfo|memory|mem|uptime)$/i;
handler.ownerOnly = true;
handler.cooldown  = 5;

export default handler;
