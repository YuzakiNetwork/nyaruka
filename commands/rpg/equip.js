/**
 * commands/rpg/equip.js
 * Equip or unequip items using serial code.
 * Usage: !equip | !equip A00
 */

import { getPlayer, savePlayer, hasItem } from '../../lib/game/player.js';
import { getItem } from '../../lib/game/item.js';

const SLOT_MAP = {
  weapon: 'weapon',
  armor: 'armor',
  helmet: 'helmet',
  accessory: 'accessory',
};

function makeSerial(index) {
  return `A${String(index).padStart(2, '0')}`;
}

function getEquippableSerialMap(player) {
  const map = {};
  let index = 0;

  for (const slot of player.inventory || []) {
    const item = getItem(slot.itemId);
    if (!item || !SLOT_MAP[item.type]) continue;

    const serial = makeSerial(index);
    map[serial] = { itemId: item.id, qty: slot.qty };
    index += 1;
  }

  return map;
}

function formatItemStats(item) {
  const entries = Object.entries(item.stats || {});
  if (!entries.length) return 'No stat';
  return entries.map(([stat, value]) => `+${value} ${stat}`).join(' | ');
}

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Register first: *!register <n> <class>*`);

  const serialMap = getEquippableSerialMap(player);
  const serialKeys = Object.keys(serialMap);

  // ── SHOW EQUIPPABLE ITEMS ──────────────────────────────────────────────
  if (!args.length) {
    if (!serialKeys.length) {
      return m.reply(
        `🧰 You don't own any equippable item yet.\n` +
        `Fight monsters or visit *!shop* to get gear.`
      );
    }

    const lines = serialKeys.map((serial) => {
      const { itemId } = serialMap[serial];
      const item = getItem(itemId);
      const slot = SLOT_MAP[item.type];
      const equipped = player.equipment[slot] === itemId ? ' *(equipped)*' : '';
      const rarity = item.rarity || 'Unknown';
      const stats = formatItemStats(item);
      return `  ${serial} | *${item.name}* [${rarity}]${equipped}\n      └─ ${item.type.toUpperCase()} | ${stats}`;
    });

    return m.reply(
      `🔧 *Your Equippable Items*\n\n` +
      lines.join('\n') +
      `\n\n💡 Usage: *!equip A00*`
    );
  }

  // ── EQUIP ITEM ─────────────────────────────────────────────────────────
  const rawInput = args[0].trim();
  let itemId = rawInput;

  // Check if input is a serial code (A00, A01, etc)
  if (/^[A-Za-z]\d{2,}$/i.test(rawInput)) {
    const match = Object.entries(serialMap).find(
      ([serial]) => serial.toLowerCase() === rawInput.toLowerCase()
    );

    if (!match) {
      return m.reply(`❌ Unknown item code: *${rawInput}*`);
    }

    itemId = match[1].itemId;
  }

  const item = getItem(itemId);
  if (!item) return m.reply(`❌ Unknown item: *${rawInput}*`);

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
  let response = `✅ Equipped *${item.name}*!\n`;
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
