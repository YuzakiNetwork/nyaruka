/**
 * commands/owner/eval.js
 * Evaluate JavaScript — owner only.
 * Usage: !eval <kode js>
 *
 * Context tersedia di dalam eval:
 *   sock, m, bot, db, playerLib, economyLib, itemLib, logger, isOwner
 *   (conn = alias sock, untuk yang sudah familiar dengan nama itu)
 */

import { logger }      from '../../lib/utils/logger.js';
import { isOwner }     from '../../config.js';
import * as db         from '../../lib/database/db.js';
import * as playerLib  from '../../lib/game/player.js';
import * as economyLib from '../../lib/game/economy.js';
import * as itemLib    from '../../lib/game/item.js';

let handler = async (m, { args, sock }) => {
  const code = m.body.slice(m.body.indexOf(' ') + 1).trim();
  if (!code || code === '!eval') return m.reply(
    `*!eval <kode>*\n\n` +
    `Variabel tersedia:\n` +
    `• \`sock\` / \`conn\` — WhatsApp socket\n` +
    `• \`m\` — pesan saat ini\n` +
    `• \`db\` — database layer\n` +
    `• \`playerLib\` — player functions\n` +
    `• \`economyLib\` — economy functions\n` +
    `• \`itemLib\` — item data\n` +
    `• \`logger\` — pino logger\n\n` +
    `Contoh: \`!eval playerLib.getAllPlayers().length\``
  );

  const start = Date.now();
  try {
    const fn = new Function(
      // Parameter — sock juga di-alias sebagai conn dan bot
      'sock', 'conn', 'bot', 'm', 'db', 'playerLib', 'economyLib', 'itemLib', 'logger', 'isOwner',
      `return (async () => {\n${code}\n})()`
    );

    let result = await fn(
      sock, sock, sock,  // sock, conn, bot — semua sama
      m, db, playerLib, economyLib, itemLib, logger, isOwner
    );

    // Format output
    if (result === undefined)      result = 'undefined';
    else if (result === null)      result = 'null';
    else if (result instanceof Map || result instanceof Set)
      result = JSON.stringify([...result], null, 2);
    else if (typeof result === 'object') {
      try { result = JSON.stringify(result, null, 2); }
      catch { result = String(result); }
    } else {
      result = String(result);
    }

    const ms  = Date.now() - start;
    const out = result.length > 3000
      ? result.slice(0, 3000) + '\n...[truncated]'
      : result;

    return m.reply(`✅ *Eval* (${ms}ms)\n\`\`\`\n${out}\n\`\`\``);

  } catch (err) {
    const ms = Date.now() - start;
    logger.error({ err: err.message }, 'Eval error');
    return m.reply(`❌ *Eval Error* (${ms}ms)\n\`\`\`\n${err.name}: ${err.message}\n\`\`\``);
  }
};

handler.help      = ['eval <kode js>'];
handler.tags      = ['owner'];
handler.command   = /^(eval|=>)$/i;
handler.ownerOnly = true;
handler.cooldown  = 2;

export default handler;
