/**
 * commands/rpg/craft.js
 * Crafting system — gabungkan material jadi item lebih baik.
 * Usage: !craft | !craft <recipe_id>
 *
 * Mencatat player.stats.craftCount saat crafting BERHASIL
 * (dibaca oleh level.js dan sistem title).
 */

import { getPlayer, savePlayer, hasItem, removeItem, addItem } from '../../lib/game/player.js';
import { getItem, RARITY_EMOJI } from '../../lib/game/item.js';
import { chance } from '../../lib/utils/random.js';

// ── Recipe definitions ────────────────────────────────────────────────────────
// { id, name, result, resultQty, materials: [{itemId, qty}], successChance, description }
export const RECIPES = {
  mega_potion_craft: {
    id: 'mega_potion_craft',
    name: '🧪 Mega Potion',
    result: 'mega_potion',
    resultQty: 1,
    materials: [
      { itemId: 'health_potion', qty: 3 },
    ],
    successChance: 1.0,
    description: 'Gabungkan 3 Health Potion jadi 1 Mega Potion.',
  },
  flame_blade_craft: {
    id: 'flame_blade_craft',
    name: '🔥 Flame Blade',
    result: 'flame_blade',
    resultQty: 1,
    materials: [
      { itemId: 'iron_sword',  qty: 1 },
      { itemId: 'wolf_fang',   qty: 3 },
      { itemId: 'ancient_rune', qty: 2 },
    ],
    successChance: 0.80,
    description: 'Tempa Iron Sword dengan material api.',
  },
  dragon_scale_armor: {
    id: 'dragon_scale_armor',
    name: '🐉 Dragon Scale Armor',
    result: 'dragon_scale',
    resultQty: 1,
    materials: [
      { itemId: 'dragon_scale_mat', qty: 3 },
      { itemId: 'monster_core',      qty: 2 },
      { itemId: 'ancient_rune',      qty: 3 },
    ],
    successChance: 0.70,
    description: 'Baju baja dari sisik naga asli.',
  },
  elixir_craft: {
    id: 'elixir_craft',
    name: '✨ Elixir of Power',
    result: 'elixir_of_power',
    resultQty: 1,
    materials: [
      { itemId: 'mega_potion',  qty: 1 },
      { itemId: 'mana_elixir',  qty: 1 },
      { itemId: 'ancient_rune', qty: 1 },
    ],
    successChance: 0.90,
    description: 'Campurkan potion terbaik untuk hasil ultimate.',
  },
  shadow_fang_craft: {
    id: 'shadow_fang_craft',
    name: '🗡️ Shadow Fang',
    result: 'shadow_fang',
    resultQty: 1,
    materials: [
      { itemId: 'iron_sword',  qty: 1 },
      { itemId: 'monster_core', qty: 3 },
      { itemId: 'wolf_fang',   qty: 5 },
    ],
    successChance: 0.75,
    description: 'Pisau bayangan yang mematikan.',
  },
};

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  const recipeId = args[0]?.toLowerCase();

  // ── List semua recipe ──────────────────────────────────────────────────────
  if (!recipeId) {
    const lines = Object.values(RECIPES).map(r => {
      const mats   = r.materials.map(mat => `${mat.itemId} ×${mat.qty}`).join(', ');
      const result = getItem(r.result);
      const emoji  = result ? RARITY_EMOJI[result.rarity] : '🔹';
      const canCraft = r.materials.every(mat => hasItem(player, mat.itemId, mat.qty));
      const status = canCraft ? '✅' : '❌';
      return (
        `${status} *${r.name}* (\`${r.id}\`)\n` +
        `   ${emoji} Hasil: ${r.result}\n` +
        `   📦 Bahan: ${mats}\n` +
        `   🎯 Sukses: ${Math.round(r.successChance * 100)}%`
      );
    });

    return m.reply(
      `🔨 *Crafting Menu*\n\n` +
      lines.join('\n\n') +
      `\n\n💡 *!craft <recipe_id>* untuk membuat item\n` +
      `✅ = bahan cukup | ❌ = bahan kurang`
    );
  }

  // ── Craft specific recipe ──────────────────────────────────────────────────
  const recipe = RECIPES[recipeId];
  if (!recipe) {
    return m.reply(
      `❌ Recipe *${recipeId}* tidak ditemukan.\n` +
      `Ketik *!craft* untuk lihat daftar recipe.`
    );
  }

  // Cek material
  const missing = recipe.materials.filter(mat => !hasItem(player, mat.itemId, mat.qty));
  if (missing.length) {
    const missList = missing.map(mat => {
      const owned = player.inventory.find(i => i.itemId === mat.itemId)?.qty || 0;
      return `  • *${mat.itemId}*: punya ${owned}, butuh ${mat.qty}`;
    });
    return m.reply(
      `❌ Bahan tidak cukup untuk *${recipe.name}*:\n\n` +
      missList.join('\n')
    );
  }

  // Kurangi material
  for (const mat of recipe.materials) removeItem(player, mat.itemId, mat.qty);

  // Roll sukses
  const success = chance(recipe.successChance);
  if (success) {
    addItem(player, recipe.result, recipe.resultQty);

    // Catat statistik untuk level.js / title system
    player.stats = player.stats || {};
    player.stats.craftCount = (player.stats.craftCount || 0) + 1;

    await savePlayer(player);
    const result = getItem(recipe.result);
    const emoji  = result ? RARITY_EMOJI[result.rarity] : '🔹';
    return m.reply(
      `⚒️ *Crafting Berhasil!*\n\n` +
      `${emoji} *${result?.name || recipe.result}* ×${recipe.resultQty} dibuat!\n\n` +
      `Bahan yang digunakan:\n` +
      recipe.materials.map(mat => `  • ${mat.itemId} ×${mat.qty}`).join('\n')
    );
  } else {
    // Gagal — bahan hangus
    await savePlayer(player);
    return m.reply(
      `💥 *Crafting Gagal!*\n\n` +
      `Proses pembuatan *${recipe.name}* gagal.\n` +
      `Semua bahan hangus. Coba lagi!\n\n` +
      `(Chance sukses: ${Math.round(recipe.successChance * 100)}%)`
    );
  }
};

handler.help     = ['craft', 'craft <recipe_id>'];
handler.tags     = ['rpg'];
handler.command  = /^craft$/i;
handler.cooldown = 25;

export default handler;
