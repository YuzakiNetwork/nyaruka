/**
 * commands/rpg/quest.js
 * Quest system.
 * Usage: !quest | !quest take | !quest claim
 */

import { getPlayer, savePlayer, addItem, awardExp } from '../../lib/game/player.js';
import { generateQuest, formatQuest }               from '../../lib/game/quest.js';

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  const sub = (args[0] || 'status').toLowerCase();

  // ── status ────────────────────────────────────────────────────────────────
  if (sub === 'status' || sub === 'info') {
    if (!player.activeQuest) {
      return m.reply(`📜 Belum ada quest aktif.\nGunakan *!quest take* untuk ambil quest baru!`);
    }
    if (Date.now() > player.activeQuest.expiresAt) {
      player.activeQuest = null;
      await savePlayer(player);
      return m.reply(`⏰ Quest sudah *kedaluwarsa*! Gunakan *!quest take* lagi.`);
    }
    return m.reply(formatQuest(player.activeQuest));
  }

  // ── take ──────────────────────────────────────────────────────────────────
  if (sub === 'take' || sub === 'new' || sub === 'ambil') {
    if (player.activeQuest && Date.now() < player.activeQuest.expiresAt) {
      return m.reply(
        `⚠️ Masih ada quest aktif!\n\n${formatQuest(player.activeQuest)}`
      );
    }
    const quest       = await generateQuest(player);
    player.activeQuest = quest;
    await savePlayer(player);
    return m.reply(
      `📜 *Quest Baru!*\n\n${formatQuest(quest)}\n\n⏰ Berakhir dalam *24 jam*.`
    );
  }

  // ── claim ─────────────────────────────────────────────────────────────────
  if (sub === 'claim' || sub === 'klaim') {
    if (!player.activeQuest) {
      return m.reply(`❌ Tidak ada quest aktif. Gunakan *!quest take* dulu.`);
    }
    if (!player.activeQuest.completed) {
      return m.reply(`⏳ Quest belum selesai!\n\n${formatQuest(player.activeQuest)}`);
    }

    const { rewards } = player.activeQuest;
    player.gold = (player.gold || 0) + (rewards.gold || 0);

    for (const item of rewards.items || []) {
      addItem(player, item.itemId, item.qty);
    }

    const lvlResult = await awardExp(player, rewards.exp || 0);

    if (!Array.isArray(player.completedQuests)) player.completedQuests = [];
    player.completedQuests.push(player.activeQuest.templateId);
    player.reputation    = (player.reputation || 0) + 10;
    player.activeQuest   = null;
    await savePlayer(player);

    const itemText = rewards.items?.length
      ? `\n🎒 Item: ${rewards.items.map(i => `*${i.itemId}* ×${i.qty}`).join(', ')}`
      : '';

    return m.reply(
      `🎉 *Quest Selesai!*\n\n` +
      `💰 +${rewards.gold}g\n` +
      `⭐ +${rewards.exp} EXP${itemText}\n` +
      `🌟 +10 Reputasi\n\n` +
      (lvlResult.messages?.length ? lvlResult.messages.join('\n') + '\n\n' : '') +
      `Total quest: *${player.completedQuests.length}*`
    );
  }

  return m.reply(`Usage: *!quest* | *!quest take* | *!quest claim*`);
};

handler.help     = ['quest', 'quest take', 'quest claim'];
handler.tags     = ['rpg'];
handler.command  = /^quest$/i;
handler.cooldown = 20;

export default handler;
