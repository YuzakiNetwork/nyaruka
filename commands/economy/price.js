/**
 * commands/economy/price.js
 * Check detailed market price data for an item.
 * Usage: !price <item_id>
 */

import { getItem, RARITY_EMOJI }                     from '../../lib/game/item.js';
import { getBuyPrice, getSellPrice, getPriceEntry }  from '../../lib/game/economy.js';
import { trendArrow }                                from '../../lib/utils/random.js';

let handler = async (m, { args }) => {
  const itemId = args[0];

  if (!itemId) {
    return m.reply(`Usage: *!price <item_id>*\nExample: *!price flame_blade*`);
  }

  const item  = getItem(itemId);
  if (!item)  return m.reply(`❌ Unknown item: *${itemId}*`);

  const entry = await getPriceEntry(itemId);
  if (!entry) return m.reply(`❌ No market data for *${item.name}* yet.`);

  const emoji     = RARITY_EMOJI[item.rarity] || '⬜';
  const buyPrice  = await getBuyPrice(itemId);
  const sellPrice = await getSellPrice(itemId);
  const trend     = trendArrow(entry.currentPrice, entry.basePrice);
  const pctDelta  = Math.round(((entry.currentPrice - entry.basePrice) / entry.basePrice) * 100);
  const sign      = pctDelta >= 0 ? '+' : '';

  // Price history sparkline
  const history = entry.history || [entry.basePrice];
  const sparkline = history.map((p, i) => {
    if (i === 0) return '─';
    const prev = history[i - 1];
    if (p > prev) return '↗';
    if (p < prev) return '↘';
    return '─';
  }).join('');

  const pressureBar = (val, max = 5) => {
    const filled = Math.round((val / max) * 10);
    return '▓'.repeat(filled) + '░'.repeat(10 - filled);
  };

  return m.reply(
    `📊 *Market Data: ${item.name}*\n` +
    `${emoji} ${item.rarity} | ${item.type}\n` +
    `─────────────────────────\n` +
    `${trend} Current Price: *${entry.currentPrice}g*\n` +
    `📌 Base Price:    *${entry.basePrice}g*\n` +
    `📈 Change:        *${sign}${pctDelta}%*\n\n` +
    `🛍️ Shop Buy Price:  *${buyPrice}g*\n` +
    `💰 Shop Sell Price: *${sellPrice}g*\n\n` +
    `📉 Demand [${pressureBar(entry.demand)}] ${entry.demand.toFixed(2)}\n` +
    `📦 Supply [${pressureBar(entry.supply)}] ${entry.supply.toFixed(2)}\n\n` +
    `📜 Price Trend: ${sparkline}\n\n` +
    `⚡ Volatility: *${(entry.volatility * 100).toFixed(0)}%*\n` +
    `🕒 Updated: ${timeAgo(entry.lastUpdated)}`
  );
};

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

handler.help    = ['price <item_id>'];
handler.tags    = ['economy'];
handler.command = /^price$/i;
handler.cooldown = 3;

export default handler;
