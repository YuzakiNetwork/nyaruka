/**
 * commands/rpg/heal.js
 * Gunakan item heal dari inventory di luar battle.
 * Merge dengan !use tapi dedicated healing UX.
 * Usage: !heal | !heal <item_id>
 */

import { getPlayer, savePlayer, removeItem, hasItem } from '../../lib/game/player.js';
import { getItem } from '../../lib/game/item.js';

const HEALABLE = ['health_potion', 'mega_potion', 'mana_elixir', 'elixir_of_power', 'antidote'];

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  // Cek item di inventory yang bisa di-heal
  const healItems = player.inventory
    .filter(slot => {
      const item = getItem(slot.itemId);
      return item?.type === 'consumable';
    });

  if (!args[0]) {
    if (!healItems.length) {
      return m.reply(
        `💊 Tidak ada item konsumabel di inventory.\n` +
        `Beli di *!shop* atau drop dari monster.`
      );
    }
    const lines = healItems.map(slot => {
      const item = getItem(slot.itemId);
      const mods = (item.modifiers || []).map(mod => {
        if (mod.healAmount) return `+${mod.healAmount} HP`;
        if (mod.manaAmount) return `+${mod.manaAmount} Mana`;
        if (mod.curesPoison) return 'Cure Poison';
        return mod.name;
      }).join(', ');
      return `  • *${item.name}* ×${slot.qty} — ${mods} (\`${item.id}\`)`;
    });

    return m.reply(
      `💊 *Item Konsumabel Kamu*\n\n` +
      lines.join('\n') +
      `\n\n❤️ HP: *${player.hp}/${player.maxHp}*\n` +
      `💙 Mana: *${player.mana}/${player.maxMana}*\n\n` +
      `Gunakan: *!heal <item_id>*`
    );
  }

  const itemId = args[0].toLowerCase();
  const item   = getItem(itemId);

  if (!item)                           return m.reply(`❌ Item *${itemId}* tidak dikenal.`);
  if (item.type !== 'consumable')      return m.reply(`❌ *${item.name}* tidak bisa dikonsumsi.`);
  if (!hasItem(player, itemId))        return m.reply(`❌ Kamu tidak punya *${item.name}*.`);

  const results = [];
  for (const mod of item.modifiers || []) {
    if (mod.id === 'heal') {
      const before  = player.hp;
      player.hp     = Math.min(player.maxHp, player.hp + mod.healAmount);
      const healed  = player.hp - before;
      results.push(`❤️ HP pulih *+${healed}* → *${player.hp}/${player.maxHp}*`);
    }
    if (mod.id === 'mana_restore') {
      const before  = player.mana;
      player.mana   = Math.min(player.maxMana, player.mana + mod.manaAmount);
      const restored = player.mana - before;
      results.push(`💙 Mana pulih *+${restored}* → *${player.mana}/${player.maxMana}*`);
    }
    if (mod.id === 'cure_poison') {
      const hadPoison = player.statusEffects?.some(e => e.id === 'poison');
      player.statusEffects = (player.statusEffects || []).filter(e => e.id !== 'poison');
      results.push(hadPoison ? `✅ Racun *disembuhkan*!` : `💡 Kamu tidak keracunan.`);
    }
    if (mod.id === 'atk_buff' && mod.statBuff) {
      results.push(`💪 ATK +${mod.statBuff.val} selama ${mod.statBuff.turns} turn (berlaku saat battle)`);
    }
  }

  removeItem(player, itemId, 1);
  await savePlayer(player);

  return m.reply(
    `💊 Menggunakan *${item.name}*\n\n` +
    results.join('\n')
  );
};

handler.help     = ['heal', 'heal <item_id>'];
handler.tags     = ['rpg'];
handler.command  = /^heal$/i;
handler.cooldown = 20;

export default handler;
