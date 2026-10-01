/**
 * commands/rpg/leaderboard.js
 * Leaderboard global — top players berdasarkan level, gold, atau kills.
 * Usage: !leaderboard | !lb [level|gold|rep]
 */

import { getAllPlayers } from '../../lib/game/player.js';

const SORTS = {
  level: { label: '🏆 Top Level',      fn: (a, b) => b.level - a.level || b.exp - a.exp },
  gold:  { label: '💰 Top Gold',       fn: (a, b) => b.gold  - a.gold  },
  rep:   { label: '🌟 Top Reputasi',   fn: (a, b) => b.reputation - a.reputation },
};

let handler = async (m, { args }) => {
  const key    = SORTS[args[0]] ? args[0] : 'level';
  const sort   = SORTS[key];
  const players = getAllPlayers()
    .filter(p => p.name && p.level)
    .sort(sort.fn)
    .slice(0, 10);

  if (!players.length) return m.reply(`📊 Belum ada player terdaftar.`);

  const medals = ['🥇', '🥈', '🥉'];
  const me     = m.sender;

  const rows = players.map((p, i) => {
    const medal  = medals[i] || `${i + 1}.`;
    const isSelf = p.id === me ? ' ← *kamu*' : '';
    const val    = key === 'level'
      ? `Lv.${p.level} [${p.rank}]`
      : key === 'gold'
      ? `${p.gold.toLocaleString()}g`
      : `${p.reputation} rep`;
    return `${medal} *${p.name}* — ${p.class} | ${val}${isSelf}`;
  });

  // Cari posisi diri sendiri jika tidak masuk top 10
  const myRank = players.findIndex(p => p.id === me);
  let selfNote = '';
  if (myRank === -1) {
    const allSorted = getAllPlayers().filter(p => p.name).sort(sort.fn);
    const myPos     = allSorted.findIndex(p => p.id === me);
    if (myPos !== -1) selfNote = `\n...\n#${myPos + 1} *kamu*`;
  }

  return m.reply(
    `📊 *${sort.label}*\n\n` +
    rows.join('\n') +
    selfNote +
    `\n\n💡 *!lb level* | *!lb gold* | *!lb rep*`
  );
};

handler.help     = ['leaderboard', 'lb [level|gold|rep]'];
handler.tags     = ['rpg'];
handler.command  = /^(leaderboard|lb|top|rank)$/i;
handler.cooldown = 10;

export default handler;
