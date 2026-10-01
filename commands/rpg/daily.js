/**
 * commands/rpg/daily.js
 * Daily reward — claim sekali per 24 jam.
 * Streak bonus: makin banyak hari berturut-turut, makin besar reward.
 * Usage: !daily
 */

import { getPlayer, savePlayer, addItem, awardExp } from '../../lib/game/player.js';
import { getWorldEvent } from '../../lib/game/economy.js';
import { randInt, chance, pick } from '../../lib/utils/random.js';

const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 jam
const STREAK_WINDOW_MS = 26 * 60 * 60 * 1000; // 26 jam grace period

// Bonus item harian acak
const DAILY_BONUS_ITEMS = [
  { itemId: 'health_potion', qty: 2 },
  { itemId: 'mana_elixir',   qty: 1 },
  { itemId: 'antidote',      qty: 2 },
  { itemId: 'ancient_rune',  qty: 1 },
  { itemId: 'wolf_fang',     qty: 3 },
];

let handler = async (m) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  const now        = Date.now();
  const lastDaily  = player.lastDaily || 0;
  const elapsed    = now - lastDaily;

  // Cek cooldown 24 jam
  if (elapsed < COOLDOWN_MS) {
    const remaining = COOLDOWN_MS - elapsed;
    const h = Math.floor(remaining / 3_600_000);
    const min = Math.floor((remaining % 3_600_000) / 60_000);
    return m.reply(
      `⏰ Daily reward belum tersedia!\n\n` +
      `Kembali lagi dalam *${h}j ${min}m*`
    );
  }

  // Hitung streak
  const streakBroken = elapsed > STREAK_WINDOW_MS;
  player.dailyStreak = streakBroken ? 1 : (player.dailyStreak || 0) + 1;
  player.lastDaily   = now;

  // Base reward naik per level
  const baseGold = randInt(50, 100) + player.level * 5;
  const baseExp  = randInt(30, 60)  + player.level * 3;

  // Streak multiplier (max 7 hari = 2×)
  const streakMult = Math.min(1 + (player.dailyStreak - 1) * 0.15, 2.0);

  // World event bonus
  const world    = await getWorldEvent();
  const expMult  = world?.effects?.expMult  || 1.0;
  const goldMult = world?.effects?.sellPriceMult || 1.0;

  const finalGold = Math.floor(baseGold * streakMult * goldMult);
  const finalExp  = Math.floor(baseExp  * streakMult * expMult);

  // Random bonus item
  const bonusItem = chance(0.6) ? pick(DAILY_BONUS_ITEMS) : null;

  // Apply
  player.gold += finalGold;
  if (bonusItem) addItem(player, bonusItem.itemId, bonusItem.qty);
  const lvlResult = await awardExp(player, finalExp);
  await savePlayer(player);

  const streakEmoji = player.dailyStreak >= 7 ? '🔥' : player.dailyStreak >= 3 ? '✨' : '📅';
  const worldNote   = world.id !== 'none' ? `\n${world.emoji} *${world.name}* bonus aktif!` : '';

  return m.reply(
    `🎁 *Daily Reward!*\n\n` +
    `${streakEmoji} Streak: *${player.dailyStreak} hari* (×${streakMult.toFixed(2)})\n\n` +
    `💰 +${finalGold} Gold\n` +
    `⭐ +${finalExp} EXP\n` +
    (bonusItem ? `🎒 Bonus: *${bonusItem.itemId}* ×${bonusItem.qty}\n` : '') +
    worldNote +
    (lvlResult.messages?.length ? '\n\n' + lvlResult.messages.join('\n') : '') +
    `\n\n⏰ Kembali lagi besok untuk melanjutkan streak!`
  );
};

handler.help     = ['daily'];
handler.tags     = ['rpg'];
handler.command  = /^(daily|claim|hadir)$/i;
handler.cooldown = 86400;

export default handler;
