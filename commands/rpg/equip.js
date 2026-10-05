/**
 * commands/rpg/equip.js
 * Equip or unequip items using global serial code.
 * Usage: !equip | !equip A00
 */

import { getPlayer, savePlayer, hasItem } from '../../lib/game/player.js';
import { getItem, generateItemSerialMap, getItemBySerial, RARITY_EMOJI } from '../../lib/game/item.js';

const SLOT_MAP = {
  weapon: 'weapon',
  armor: 'armor',
  helmet: 'helmet',
  accessory: 'accessory',
};

function formatItemStats(item) {
  const entries = Object.entries(item.stats || {});
  if (!entries.length) return 'No stat';
  return entries.map(([stat, value]) => `+${value} ${stat}`).join(' | ');
}

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Register first: *!register <n> <class>*`);

  const serialMap = generateItemSerialMap();
  const equippableInInventory = (player.inventory || [])
    .filter(slot => SLOT_MAP[getItem(slot.itemId)?.type])
    .map(slot => {
      let serial = null;
      for (const [code, itemId] of Object.entries(serialMap)) {
        if (itemId === slot.itemId) {
          serial = code;
          break;
        }
      }
      return { ...slot, serial };
    })
    .filter(slot => slot.serial);

  // ── SHOW EQUIPPABLE ITEMS ──────────────────────────────────────────────
  if (!args.length) {
    if (!equippableInInventory.length) {
      return m.reply(
        `🧰 You don't own any equippable item yet.\n` +
        `Fight monsters or visit *!shop* to get gear.`
      );
    }

    const lines = equippableInInventory.map(slot => {
      const item = getItem(slot.itemId);
      const slotType = SLOT_MAP[item.type];
      const isEquipped = player.equipment[slotType] === item.id ? ' ✅' : '';
      const emoji = RARITY_EMOJI[item.rarity] || '⬜';
      const stats = formatItemStats(item);
      return `  ${slot.serial} | ${emoji} *${item.name}* [${item.rarity}]${isEquipped}\n      └─ ${stats}`;
    });

    return m.reply(
      `🔧 *Your Equippable Items*\n\n` +
      lines.join('\n') +
      `\n\n💡 Usage: *!equip A00*`
    );
  }

  // ── EQUIP ITEM ─────────────────────────────────────────────────────────
  const serialInput = args[0].trim().toUpperCase();
  const itemId = getItemBySerial(serialInput);

  if (!itemId) {
    return m.reply(`❌ Unknown item code: *${serialInput}*`);
  }

  const item = getItem(itemId);
  if (!item) return m.reply(`❌ Item not found for code: *${serialInput}*`);

  if (!SLOT_MAP[item.type]) {
    return m.reply(`❌ *${item.name}* cannot be equipped (type: ${item.type}).`);
  }

  if (!hasItem(player, itemId)) {
    return m.reply(`❌ You don't own *${item.name}*.`);
  }

  const slot = SLOT_MAP[item.type];
  const current = player.equipment[slot];

  // Toggle unequip if already equipped
  if (current === itemId) {
    player.equipment[slot] = null;
    await savePlayer(player);
    return m.reply(`✅ Unequipped *${item.name}*.`);
  }

  // Equip item
  player.equipment[slot] = itemId;
  await savePlayer(player);

  const stats = formatItemStats(item);
  let response = `✅ Equipped *${item.name}* (${serialInput})!\n`;
  response += `Slot: *${slot}*\n`;
  response += `Stats: ${stats}`;

  if (current) {
    const prevItem = getItem(current);
    response += `\n(Replaced: *${prevItem?.name || current}*)`;
  }

  return m.reply(response);
};

handler.help = ['equip', 'equip <item_code>'];
handler.tags = ['rpg'];
handler.command = /^equip$/i;
handler.cooldown = 3;

export default handler;
