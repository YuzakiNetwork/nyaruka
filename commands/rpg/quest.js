/**
 * commands/rpg/quest.js
 * Sistem quest: pilih sendiri, level minimal, progress real-time.
 *
 * Usage:
 *   !quest                  → status quest aktif
 *   !quest list             → daftar quest
 *   !quest take <nomor|id>  → ambil quest
 *   !quest claim            → klaim hadiah
 *   !quest abandon          → batalkan quest aktif
 */

import { getPlayer, savePlayer, addItem, awardExp } from '../../lib/game/player.js';
import {
  generateQuest,
  formatQuest,
  formatQuestList,
  findTemplate,
  canTakeQuest,
  isQuestLive,
  itemName,
} from '../../lib/game/quest.js';

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  const sub = (args[0] || 'status').toLowerCase();

  // ── status ────────────────────────────────────────────────────────────────
  if (sub === 'status' || sub === 'info') {
    const quest = player.activeQuest;

    if (!quest) {
      return m.reply(
        `📜 Belum ada quest aktif.\n` +
        `Lihat daftar dengan *!quest list*, lalu ambil dengan *!quest take <nomor>*.`
      );
    }
    if (!isQuestLive(quest)) {
      player.activeQuest = null;
      await savePlayer(player);
      return m.reply(`⏰ Quest sudah *kedaluwarsa*! Lihat *!quest list* untuk ambil yang baru.`);
    }
    return m.reply(formatQuest(quest));
  }

  // ── list ──────────────────────────────────────────────────────────────────
  if (sub === 'list' || sub === 'daftar') {
    return m.reply(formatQuestList(player));
  }

  // ── take ──────────────────────────────────────────────────────────────────
  if (sub === 'take' || sub === 'ambil') {
    if (isQuestLive(player.activeQuest)) {
      return m.reply(
        `⚠️ Masih ada quest aktif!\n` +
        `Selesaikan, klaim, atau batalkan dengan *!quest abandon*.\n\n` +
        formatQuest(player.activeQuest)
      );
    }

    const ref = args[1];
    if (!ref) {
      return m.reply(
        `❓ Pilih quest dulu.\n` +
        `Lihat daftar: *!quest list*\n` +
        `Ambil: *!quest take <nomor>*`
      );
    }

    const template = findTemplate(ref);
    if (!template) {
      return m.reply(`❌ Quest *${ref}* tidak ditemukan. Cek *!quest list*.`);
    }

    const check = canTakeQuest(player, template);
    if (!check.ok) {
      return m.reply(`🔒 ${check.reason}`);
    }

    const quest = await generateQuest(player, ref);
    player.activeQuest = quest;
    await savePlayer(player);

    return m.reply(
      `📜 *Quest Diambil!*\n\n${formatQuest(quest)}\n\n` +
      `Progress akan diberitahu otomatis saat bertambah.`
    );
  }

  // ── claim ─────────────────────────────────────────────────────────────────
  if (sub === 'claim' || sub === 'klaim') {
    const quest = player.activeQuest;

    if (!quest) {
      return m.reply(`❌ Tidak ada quest aktif. Gunakan *!quest list* dulu.`);
    }
    if (!quest.completed) {
      return m.reply(`⏳ Quest belum selesai!\n\n${formatQuest(quest)}`);
    }

    // Lepas quest lebih dulu supaya klaim ganda tidak mungkin
    player.activeQuest = null;

    try {
      const { rewards } = quest;
      player.gold = (player.gold || 0) + (rewards.gold || 0);

      for (const item of rewards.items || []) {
        addItem(player, item.itemId, item.qty);
      }

      const lvlResult = await awardExp(player, rewards.exp || 0);

      if (!Array.isArray(player.completedQuests)) player.completedQuests = [];
      player.completedQuests.push(quest.templateId);
      player.reputation = (player.reputation || 0) + 10;
      await savePlayer(player);

      const itemText = rewards.items?.length
        ? `\n🎒 Item: ${rewards.items.map(i => `*${itemName(i.itemId)}* ×${i.qty}`).join(', ')}`
        : '';

      return m.reply(
        `🎉 *Quest Selesai!*\n\n` +
        `💰 +${rewards.gold}g\n` +
        `⭐ +${rewards.exp} EXP${itemText}\n` +
        `🌟 +10 Reputasi\n\n` +
        (lvlResult?.messages?.length ? lvlResult.messages.join('\n') + '\n\n' : '') +
        `Total quest: *${player.completedQuests.length}*\n` +
        `Lihat quest lain: *!quest list*`
      );
    } catch (err) {
      // Kembalikan quest jika proses hadiah gagal
      player.activeQuest = quest;
      await savePlayer(player);
      console.error('[quest claim]', err);
      return m.reply(`❌ Gagal klaim hadiah. Coba lagi sebentar.`);
    }
  }

  // ── abandon ───────────────────────────────────────────────────────────────
  if (sub === 'abandon' || sub === 'batal') {
    if (!player.activeQuest) {
      return m.reply(`❌ Tidak ada quest aktif.`);
    }
    const title = player.activeQuest.title;
    player.activeQuest = null;
    await savePlayer(player);
    return m.reply(`🗑️ Quest *${title}* dibatalkan. Progress hilang.\nLihat *!quest list* untuk quest lain.`);
  }

  return m.reply(
    `Usage:\n` +
    `*!quest* — status\n` +
    `*!quest list* — daftar quest\n` +
    `*!quest take <nomor>* — ambil quest\n` +
    `*!quest claim* — klaim hadiah\n` +
    `*!quest abandon* — batalkan quest`
  );
};

handler.help     = ['quest', 'quest list', 'quest take <nomor>', 'quest claim', 'quest abandon'];
handler.tags     = ['rpg'];
handler.command  = /^quest$/i;
handler.cooldown = 5;

export default handler;
