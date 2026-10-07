/**
 * commands/economy/shop.js
 * Browse the rotating shop with live economy pricing.
 * Usage: !shop [page]
 *
 * Shop pricing logic:
 *   buyPrice = economy.currentPrice × worldEvent.buyPriceMult
 *   sellPrice = economy.currentPrice × shopSellRatio × worldEvent.sellPriceMult
 *   Rotating inventory refreshes every hour (anti-monotony).
 */

import {
  getShopInventory,
  getBuyPrice,
  getSellPrice,
  getWorldEvent,
  getPriceEntry,
}               from '../../lib/game/economy.js';
import { getItem } from '../../lib/game/item.js';
import { trendArrow }            from '../../lib/utils/random.js';
import { config }                from '../../config.js';

const PAGE_SIZE = 6;

let handler = async (m, { args }) => {
  const page     = Math.max(1, parseInt(args[0]) || 1);
  const shopList = getShopInventory();
  const world    = await getWorldEvent();

  const totalPages = Math.ceil(shopList.length / PAGE_SIZE);
  const slice      = shopList.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // World event banner
  const eventBanner = world.id !== 'none'
    ? `\n${world.emoji} *${world.name}*\n   ${world.description}\n`
    : '';

  // Build item list with live prices
  const lines = (await Promise.all(slice.map(async itemId => {
    const item    = getItem(itemId);
    if (!item) return null;

    const buyPrice  = await getBuyPrice(itemId);
    const sellPrice = await getSellPrice(itemId);
    const entry     = await getPriceEntry(itemId);
    const emoji     = item.emoji || '⬜';
    const trend     = entry ? trendArrow(entry.currentPrice, entry.basePrice) : '➡️';
    const rarityBadge = `[${item.rarity}]`;

    return (
      `${emoji} *${item.name}* ${trend} ${rarityBadge}\n` +
      `   💰 Buy: *${buyPrice}g* | Sell: *${sellPrice}g*`
    );
  }))).filter(Boolean);

  const footer = totalPages > 1 
    ? `\n📄 Page ${page}/${totalPages} — !shop ${page + 1} for next page`
    : `\n📄 Page ${page}/${totalPages}`;

  return m.reply(
    `🏪 *═══ MARKET SHOP ═══*${eventBanner}` +
    `${lines.join('\n\n')}\n` +
    `─────────────────────\n` +
    `💡 *!buy <item_id>* to purchase\n` +
    `💡 *!sell <item_id>* to sell\n` +
    `💡 *!price <item_id>* for details${footer}`
  );
};

handler.help    = ['shop [page]'];
handler.tags    = ['economy'];
handler.command = /^shop$/i;
handler.cooldown = config.cooldowns.shop || 5;

export default handler;
