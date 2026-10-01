/**
 * commands/rpg/rest.js
 * Rest to recover HP and mana.
 * Usage: !rest
 */

import { getPlayer, savePlayer } from '../../lib/game/player.js';

const REST_HP_PERCENT   = 0.40;  // restore 40% max HP
const REST_MANA_PERCENT = 0.50;  // restore 50% max mana
const REST_COST_GOLD    = 20;    // costs 20 gold at an inn

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Register first: *!register <n> <class>*`);

  if (player.hp >= player.maxHp && player.mana >= player.maxMana) {
    return m.reply(`✅ You are already at full HP and Mana!`);
  }

  const free = args[0] === 'free';

  if (!free) {
    if (player.gold < REST_COST_GOLD) {
      return m.reply(
        `💰 Resting at an inn costs *${REST_COST_GOLD}g*.\n` +
        `You have *${player.gold}g*.\n\n` +
        `Use *!rest free* to rest for free (restores less HP).`
      );
    }
    player.gold -= REST_COST_GOLD;
    player.hp   = player.maxHp;
    player.mana = player.maxMana;
    await savePlayer(player);

    return m.reply(
      `🛏️ *Full Rest at the Inn!* (-${REST_COST_GOLD}g)\n\n` +
      `❤️ HP fully restored: *${player.hp}/${player.maxHp}*\n` +
      `💙 Mana fully restored: *${player.mana}/${player.maxMana}*\n` +
      `💰 Remaining gold: *${player.gold}g*`
    );
  }

  // Free rest (partial recovery)
  const healHp   = Math.floor(player.maxHp   * REST_HP_PERCENT);
  const healMana = Math.floor(player.maxMana * REST_MANA_PERCENT);
  player.hp   = Math.min(player.maxHp,   player.hp   + healHp);
  player.mana = Math.min(player.maxMana, player.mana + healMana);
  await savePlayer(player);

  return m.reply(
    `😴 *Free Rest* (partial recovery)\n\n` +
    `❤️ HP: *${player.hp}/${player.maxHp}* (+${healHp})\n` +
    `💙 Mana: *${player.mana}/${player.maxMana}* (+${healMana})\n\n` +
    `💡 *!rest* (costs ${REST_COST_GOLD}g) for full recovery.`
  );
};

handler.help    = ['rest', 'rest free'];
handler.tags    = ['rpg'];
handler.command = /^rest$/i;
handler.cooldown = 30;

export default handler;
