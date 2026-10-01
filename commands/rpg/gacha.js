/**
 * commands/rpg/gacha.js
 * Gacha System — Roll untuk dapetin item/summon random
 */

import { getPlayer, savePlayer, addItem } from '../../lib/game/player.js';
import {
  rollGacha, checkPity, incrementPity,
  formatGachaResult, GACHA_COST, RARITY_INFO, GACHA_POOL,
} from '../../lib/game/gacha.js';

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  const sub = args[0]?.toLowerCase() || 'info';

  // ── !gacha info / rates ────────────────────────────────────────────────────
  if (sub === 'info' || sub === 'rate' || sub === 'rates') {
    const lines = [
      `🎰 *GACHA SYSTEM* 🎰`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `💰 *Harga:*`,
      `• Single pull: *${GACHA_COST.single}g*`,
      `• 10× pull:    *${GACHA_COST.multi}g* (diskon 10%)`,
      ``,
      `📊 *Drop Rates:*`,
    ];

    for (const [rarity, info] of Object.entries(RARITY_INFO)) {
      lines.push(`${info.color} ${rarity.padEnd(3)} — ${info.name.padEnd(12)} (${info.totalRate}%)`);
    }

    lines.push(``);
    lines.push(`🎁 *Pity System:*`);
    lines.push(`Setelah 100× pull tanpa SSR → dijamin SSR!`);
    lines.push(`Pity kamu: *${player.gachaPity || 0}/100*`);
    lines.push(``);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`Gunakan:`);
    lines.push(`*!gacha pull* — single pull`);
    lines.push(`*!gacha 10* — 10× pull`);
    lines.push(`*!gacha list* — lihat semua item`);

    return m.reply(lines.join('\n'));
  }

  // ── !gacha list ────────────────────────────────────────────────────────────
  if (sub === 'list' || sub === 'items' || sub === 'pool') {
    const type = args[1]?.toLowerCase() || 'all';
    let pool   = Object.values(GACHA_POOL);

    if (type !== 'all') {
      pool = pool.filter(item => item.type === type);
    }

    // Group by type
    const byType = {};
    for (const item of pool) {
      if (!byType[item.type]) byType[item.type] = [];
      byType[item.type].push(item);
    }

    const lines = [`🎰 *GACHA POOL*`, `━━━━━━━━━━━━━━━━━━━`];

    for (const [typeName, items] of Object.entries(byType)) {
      lines.push(`\n📦 *${typeName.toUpperCase()}*`);
      // Sort by rarity SSR > SR > R > N
      const rarityOrder = { SSR: 0, SR: 1, R: 2, N: 3 };
      items.sort((a, b) => rarityOrder[a.rarity] - rarityOrder[b.rarity]);

      for (const item of items) {
        const rarity = RARITY_INFO[item.rarity].color;
        const rate   = (item.dropRate * 100).toFixed(2);
        lines.push(`${rarity} ${item.emoji} ${item.name} (${rate}%)`);
      }
    }

    lines.push(``);
    lines.push(`Filter by type:`);
    lines.push(`*!gacha list weapon/armor/ring/potion/summon*`);

    return m.reply(lines.join('\n'));
  }

  // ── !gacha pull / 10 ───────────────────────────────────────────────────────
  if (sub === 'pull' || sub === '1' || sub === '10') {
    const count = sub === '10' ? 10 : 1;
    const cost  = count === 10 ? GACHA_COST.multi : GACHA_COST.single;

    if ((player.gold || 0) < cost) {
      return m.reply(`❌ Gold tidak cukup!\n\nButuh: *${cost}g*\nGold kamu: *${player.gold || 0}g*`);
    }

    // Deduct gold
    player.gold -= cost;

    // Check pity first (untuk 10-pull, cek di akhir)
    let pityItem = null;
    if (count === 10) {
      pityItem = checkPity(player);
    }

    // Roll gacha
    const results = rollGacha(count);

    // Jika ada pity, replace item terakhir dengan SSR
    if (pityItem) {
      results[results.length - 1] = pityItem;
    }

    // Update pity counter
    const hasSSR = results.some(r => r.rarity === 'SSR');
    incrementPity(player, hasSSR);

    // Add items to inventory
    for (const item of results) {
      addItem(player, item.id, 1);
    }

    await savePlayer(player);

    // Format output
    const output = formatGachaResult(results);
    const pityText = pityItem ? `\n\n🎁 *PITY TRIGGERED!* Dijamin SSR!` : '';
    const newPity  = `\n\nPity: ${player.gachaPity}/100`;

    return m.reply(
      `${output}${pityText}${newPity}\n\n` +
      `💰 Gold tersisa: *${player.gold}g*\n` +
      `Cek inventory: *!inventory*`
    );
  }

  // ── !gacha pity ────────────────────────────────────────────────────────────
  if (sub === 'pity') {
    const current = player.gachaPity || 0;
    const remaining = 100 - current;
    const bar = '█'.repeat(Math.floor(current / 10)) + '░'.repeat(10 - Math.floor(current / 10));

    return m.reply(
      `🎁 *Pity System*\n\n` +
      `Progress: [${bar}] ${current}/100\n\n` +
      `${remaining > 0
        ? `Masih ${remaining}× pull lagi untuk dijamin SSR!`
        : `Pity sudah penuh! Pull sekarang dijamin SSR!`}`
    );
  }

  return m.reply(
    `🎰 *Gacha Commands*\n\n` +
    `!gacha info  — info & rates\n` +
    `!gacha pull  — single pull (${GACHA_COST.single}g)\n` +
    `!gacha 10    — 10× pull (${GACHA_COST.multi}g)\n` +
    `!gacha list  — lihat semua item\n` +
    `!gacha pity  — cek pity progress\n\n` +
    `💡 Tip: 10× pull lebih hemat 10%!`
  );
};

handler.help    = ['gacha', 'gacha pull', 'gacha 10', 'gacha list'];
handler.tags    = ['rpg'];
handler.command = /^(gacha|gача|roll)$/i;
handler.cooldown = 10;
export default handler;
