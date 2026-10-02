/**
 * commands/rpg/register.js
 * Register a new player character.
 * Usage: !register <name> <class>
 */

import { hasPlayer, createPlayer } from '../../lib/game/player.js';
import { config } from '../../config.js';

let handler = async (m, { args }) => {
  const sender = m.sender;

  if (await hasPlayer(sender)) {
    return m.reply(
      `⚔️ You already have a character!\nUse *!profile* to view it.`
    );
  }

  const name = args[0];
  const cls  = args.slice(1).join(' ');

  const validClasses = Object.keys(config.rpg.classes);

  if (!name || !cls) {
    const classInfo = validClasses.map(c => {
      const info = config.rpg.classes[c];
      return `  ${info.description}`;
    }).join('\n');

    return m.reply(
      `✨ *Selamat datang di Nyaruka!* ✨\n` +
      `Buat karaktermu untuk mulai bermain.\n` +
      `Cara pakai: *!register <name> <class>*\n` +
      `Kelas yang tersedia:\n${classInfo}\n` +
      `Contoh: *!register Kira Assassin*`
    );
  }

  const matchedClass = validClasses.find(c => c.toLowerCase() === cls.toLowerCase());
  if (!matchedClass) {
    return m.reply(
      `❌ Unknown class: *${cls}*\n` +
      `Valid classes: ${validClasses.join(', ')}`
    );
  }

  const cleanName = name.slice(0, 20).replace(/[<>]/g, '');
  const player    = await createPlayer(sender, cleanName, matchedClass);
  const info      = config.rpg.classes[matchedClass];

  return m.reply(
    `✅ *Karakter siap!*\n\n` +
    `👤 Nama:  *${player.name}*\n` +
    `⚔️ Kelas: *${player.class}* ${info.description.split(' ')[0]}\n` +
    `🎖️ Peringkat:  *${player.rank}*\n` +
    `❤️ HP:    *${player.maxHp}*\n` +
    `💙 Mana:  *${player.maxMana}*\n` +
    `⚔️ ATK:   *${player.attack}*\n` +
    `🛡️ DEF:   *${player.defense}*\n` +
    `💨 SPD:   *${player.speed}*\n\n` +
    `💰 Gold awal: *${player.gold}*\n\n` +
    `Lihat status lengkapmu lewat *!profile*.\n` +
    `Siap mulai? Coba *!adventure* atau *!battle*.`
  );
};

handler.help    = ['register <name> <class>'];
handler.tags    = ['rpg'];
handler.command = /^register$/i;
handler.cooldown = 5;

export default handler;
