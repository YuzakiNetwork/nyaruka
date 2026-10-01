/**
 * commands/rpg/worldevent.js
 * Lihat world event yang sedang aktif dan efeknya.
 * Usage: !world | !event
 */

import { getWorldEvent, getWorldState, WORLD_EVENTS } from '../../lib/game/economy.js';

let handler = async (m) => {
  const world = await getWorldEvent();
  const state = await getWorldState();

  const msLeft   = Math.max(0, (state?.endsAt || 0) - Date.now());
  const minsLeft = Math.floor(msLeft / 60_000);
  const hLeft    = Math.floor(minsLeft / 60);
  const minRem   = minsLeft % 60;
  const timeText = hLeft > 0 ? `${hLeft}j ${minRem}m` : `${minsLeft}m`;

  if (world.id === 'none') {
    // Tampilkan semua event yang bisa muncul
    const comingUp = Object.values(WORLD_EVENTS)
      .filter(e => e.id !== 'none')
      .map(e => `${e.emoji} *${e.name}* — ${e.description} (${e.duration}m)`)
      .join('\n');

    return m.reply(
      `🌿 *Tidak ada World Event aktif saat ini.*\n\n` +
      `Event berikutnya akan muncul segera.\n\n` +
      `📋 *Event yang mungkin muncul:*\n` +
      comingUp
    );
  }

  // Efek aktif
  const effects = Object.entries(world.effects || {})
    .map(([key, val]) => {
      const labels = {
        sellPriceMult: `💰 Harga jual ×${val}`,
        buyPriceMult:  `🛍️ Harga beli ×${val}`,
        expMult:       `⭐ EXP ×${val}`,
        lootMult:      `🎒 Loot ×${val}`,
        volatilityMult:`📊 Volatilitas harga ×${val}`,
      };
      return labels[key] || `${key}: ${val}`;
    })
    .join('\n');

  return m.reply(
    `🌍 *World Event Aktif!*\n\n` +
    `${world.emoji} *${world.name}*\n` +
    `${world.description}\n\n` +
    `⏰ Berakhir dalam: *${timeText}*\n\n` +
    `✨ *Efek Aktif:*\n${effects || 'Tidak ada efek spesifik'}`
  );
};

handler.help     = ['world', 'event'];
handler.tags     = ['rpg'];
handler.command  = /^(world|worldevent|wevent)$/i;
handler.cooldown = 5;

export default handler;
