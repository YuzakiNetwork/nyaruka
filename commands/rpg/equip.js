/**
 * commands/rpg/equip.js
 * Equip or unequip items.
 * Usage: !equip <item_id>
 */

import { getPlayer, savePlayer, hasItem } from '../../lib/game/player.js';
import { getItem }                         from '../../lib/game/item.js';

const SLOT_MAP = {
  weapon:    'weapon',
  armor:     'armor',
  helmet:    'helmet',
  accessory: 'accessory',
};

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Register first: *!register <n> <class>*`);

  const itemId = args[0];
  if (!itemId) {
    const slots = Object.entries(player.equipment)
      .map(([slot, id]) => `  ${slot}: ${id ? `*${id}*` : 'empty'}`)
      .join('\n');
    return m.reply(`🔧 *Equipment Slots:*\n${slots}\n\nUsage: *!equip <item_id>*`);
  }

  const item = getItem(itemId);
  if (!item) return m.reply(`❌ Unknown item: *${itemId}*`);

  if (!SLOT_MAP[item.type]) {
    return m.reply(`❌ *${item.name}* cannot be equipped (type: ${item.type}).`);
  }

  if (!hasItem(player, itemId)) {
    return m.reply(`❌ You don't own *${item.name}*.`);
  }

  const slot = SLOT_MAP[item.type];

  // Unequip current item in same slot
  const current = player.equipment[slot];
  if (current === itemId) {
    player.equipment[slot] = null;
    await savePlayer(player);
    return m.reply(`✅ Unequipped *${item.name}*.`);
  }

  player.equipment[slot] = itemId;
  await savePlayer(player);

  const statsText = Object.entries(item.stats || {})
    .map(([s, v]) => `+${v} ${s}`)
    .join(' | ') || 'No stats';

  return m.reply(
    `✅ Equipped *${item.name}*!\n` +
    `Slot: *${slot}*\n` +
    `Stats: ${statsText}` +
    (current ? `\n(Replaced: ${current})` : '')
  );
};

handler.help    = ['equip <item_id>'];
handler.tags    = ['rpg'];
handler.command = /^equip$/i;
handler.cooldown = 3;

export default handler;
