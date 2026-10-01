/**
 * commands/info/ping.js
 * Status bot + statistik global.
 * Usage: !ping
 */

import { getWorldEvent }  from '../../lib/game/economy.js';
import { getAllPlayers }   from '../../lib/game/player.js';
import { getCommands }     from '../../handler/index.js';
import { config }          from '../../config.js';

let handler = async (m) => {
  const start   = Date.now();
  const world   = await getWorldEvent();
  const players = getAllPlayers();
  const cmds    = getCommands();
  const latency = Date.now() - start;

  const activePlayers = players.filter(p => {
    return p.lastActive && Date.now() - p.lastActive < 24 * 60 * 60 * 1000;
  }).length;

  const topPlayer = [...players]
    .sort((a, b) => b.level - a.level)[0];

  return m.reply(
    `🤖 *${config.bot.name} Status*\n\n` +
    `⚡ Latency:    *${latency}ms*\n` +
    `📜 Commands:   *${cmds.length}*\n\n` +
    `👥 Players:    *${players.length}* terdaftar\n` +
    `🟢 Aktif 24j:  *${activePlayers}*\n` +
    (topPlayer ? `🏆 Top Player: *${topPlayer.name}* Lv.${topPlayer.level}\n` : '') +
    `\n🌍 World Event: ${world.emoji} *${world.name}*\n\n` +
    `✅ Status: *Online*`
  );
};

handler.help     = ['ping'];
handler.tags     = ['info'];
handler.command  = /^(ping|status|bot)$/i;
handler.cooldown = 5;

export default handler;
