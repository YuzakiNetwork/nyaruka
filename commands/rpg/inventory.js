/**
 * commands/rpg/inventory.js
 * View inventory and use consumable items.
 * Usage: !inventory | !use <item>
 */

import { getPlayer, savePlayer, removeItem } from '../../lib/game/player.js';
import { getItem, RARITY_EMOJI }              from '../../lib/game/item.js';

let handler = async (m, { args, command }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Register first: *!register <n> <class>*`);

  // ── USE ITEM ──────────────────────────────────────────────────────────
  if (command === 'use') {
    const itemId = args[0];
    if (!itemId) return m.reply(`Usage: *!use <item_id>*\nExample: *!use health_potion*`);

    const item = getItem(itemId);
    if (!item) return m.reply(`❌ Unknown item: *${itemId}*`);
    if (item.type !== 'consumable') return m.reply(`❌ *${item.name}* is not consumable.`);
    if (!player.inventory.find(i => i.itemId === itemId)) {
      return m.reply(`❌ You don't have *${item.name}* in your inventory.`);
    }

    const results = [];
    for (const mod of (item.modifiers || [])) {
      if (mod.id === 'heal') {
        const healed = Math.min(mod.healAmount, player.maxHp - player.hp);
        player.hp = Math.min(player.maxHp, player.hp + mod.healAmount);
        results.push(`❤️ Restored *${healed} HP* → ${player.hp}/${player.maxHp}`);
      }
      if (mod.id === 'mana_restore') {
        const restored = Math.min(mod.manaAmount, player.maxMana - player.mana);
        player.mana = Math.min(player.maxMana, player.mana + mod.manaAmount);
        results.push(`💙 Restored *${restored} Mana* → ${player.mana}/${player.maxMana}`);
      }
      if (mod.id === 'cure_poison') {
        player.statusEffects = player.statusEffects.filter(e => e.id !== 'poison');
        results.push(`✅ Poison *cured*!`);
      }
    }

    removeItem(player, itemId, 1);
    await savePlayer(player);

    return m.reply(
      `💊 Used *${item.name}*\n\n` + results.join('\n')
    );
  }

  // ── VIEW INVENTORY ────────────────────────────────────────────────────────
  if (!player.inventory.length) {
    return m.reply(`🎒 Your inventory is empty.\nFight monsters or visit *!shop* to get items!`);
  }

  const lines = player.inventory.map(slot => {
    const item  = getItem(slot.itemId);
    if (!item) return `  ❓ Unknown: ${slot.itemId} x${slot.qty}`;
    const emoji = item.emoji || RARITY_EMOJI[item.rarity] || '⬜';
    const equip = Object.values(player.equipment).includes(slot.itemId) ? ' *(equipped)*' : '';
    return `  ${emoji} *${item.name}* x${slot.qty}${equip}`;
  });

  return m.reply(
    `🎒 *${player.name}'s Inventory* (${player.inventory.length} items)\n\n` +
    lines.join('\n') +
    `\n\n💡 *!use <item>* — use a consumable\n` +
    `💡 *!equip <item>* — equip a weapon/armor`
  );
};

handler.help     = ['inventory', 'use <item_id>'];
handler.tags     = ['rpg'];
handler.command  = /^(inventory|inv|use)$/i;
handler.cooldown = 5;

export default handler;
