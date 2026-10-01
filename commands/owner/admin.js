/**
 * commands/owner/admin.js
 * Owner-only admin commands.
 */

import {
  rollWorldEvent, WORLD_EVENTS, buildInitialEconomy,
  saveEconomy, economyTick, saveWorldState,
} from '../../lib/game/economy.js';
import { getAllPlayers, getPlayer, savePlayer, awardExp, addItem, expRequired } from '../../lib/game/player.js';
import { getItem }      from '../../lib/game/item.js';
import { normalizeJid } from '../../handler/index.js';

// Helper: ambil target JID dari mention dalam pesan
function getMentionedJid(m) {
  const jids = m.raw?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  return jids[0] ? normalizeJid(jids[0]) : null;
}

let handler = async (m, { args, command, sock }) => {

  // ── !event <id> ────────────────────────────────────────────────────────────
  if (command === 'event') {
    const eventId = args[0];
    if (!eventId) {
      const list = Object.entries(WORLD_EVENTS)
        .map(([id, e]) => `  ${e.emoji} *${id}* — ${e.name} (${e.duration}m)`)
        .join('\n');
      return m.reply(`Pilih event:\n${list}\n\nGunakan: *!event <id>*`);
    }
    const event = WORLD_EVENTS[eventId];
    if (!event) return m.reply(`❌ Event tidak dikenal: ${eventId}`);
    await saveWorldState({
      eventId,
      startedAt: Date.now(),
      endsAt:    Date.now() + event.duration * 60_000,
    });
    return m.reply(`✅ World event: ${event.emoji} *${event.name}*\nDurasi: ${event.duration} menit`);
  }

  // ── !reseteconomy ──────────────────────────────────────────────────────────
  if (command === 'reseteconomy') {
    await saveEconomy(buildInitialEconomy());
    return m.reply(`✅ Economy direset ke harga dasar.`);
  }

  // ── !ecotick ──────────────────────────────────────────────────────────────
  if (command === 'ecotick') {
    const changed = await economyTick();
    return m.reply(`✅ Economy tick. *${changed}* harga diupdate.`);
  }

  // ── !broadcast <msg> ──────────────────────────────────────────────────────
  if (command === 'broadcast') {
    const msg = args.join(' ');
    if (!msg) return m.reply(`Usage: *!broadcast <pesan>*`);
    const players = getAllPlayers();
    let sent = 0;
    for (const p of players) {
      try {
        await sock.sendMessage(p.id, { text: `📢 *Broadcast:*\n${msg}` });
        sent++;
      } catch {}
    }
    return m.reply(`✅ Broadcast terkirim ke *${sent}* player.`);
  }

  // ── !addgold @user <jml> ──────────────────────────────────────────────────
  if (command === 'addgold') {
    const targetJid = getMentionedJid(m);
    const amount    = parseInt(args.find(a => !isNaN(a)));
    if (!targetJid || !amount) return m.reply(`Usage: *!addgold @player <jumlah>*`);
    const target = getPlayer(targetJid);
    if (!target) return m.reply(`❌ Player tidak ditemukan. (${targetJid})`);
    target.gold = (target.gold || 0) + amount;
    await savePlayer(target);
    return m.reply(`✅ +${amount}g → *${target.name}*. Total: ${target.gold}g`);
  }

  // ── !additem @user <item> <qty> ───────────────────────────────────────────
  if (command === 'additem') {
    const targetJid = getMentionedJid(m);
    // Cari argumen non-angka yang bukan mention sebagai itemId
    const itemId    = args.find(a => isNaN(a) && !a.startsWith('@'));
    const qty       = parseInt(args.find(a => !isNaN(a))) || 1;
    if (!targetJid || !itemId) return m.reply(`Usage: *!additem @player <item_id> [qty]*`);
    const target = getPlayer(targetJid);
    const item   = getItem(itemId);
    if (!target) return m.reply(`❌ Player tidak ditemukan.`);
    if (!item)   return m.reply(`❌ Item *${itemId}* tidak dikenal.`);
    addItem(target, itemId, qty);
    await savePlayer(target);
    return m.reply(`✅ *${item.name}* ×${qty} diberikan ke *${target.name}*`);
  }

  // ── !setlevel @user <level> ───────────────────────────────────────────────
  if (command === 'setlevel') {
    const targetJid = getMentionedJid(m);
    const level     = parseInt(args.find(a => !isNaN(a)));
    if (!targetJid || !level) return m.reply(`Usage: *!setlevel @player <level>*`);
    const target = getPlayer(targetJid);
    if (!target) return m.reply(`❌ Player tidak ditemukan.`);
    if (level < 1 || level > 100) return m.reply(`❌ Level harus 1–100.`);
    target.level    = level;
    target.expToNext = expRequired(level);
    target.exp      = 0;
    await savePlayer(target);
    return m.reply(`✅ Level *${target.name}* diset ke *${level}*`);
  }

  // ── !players ───────────────────────────────────────────────────────────────
  if (command === 'players') {
    const all = getAllPlayers();
    if (!all.length) return m.reply(`👥 Belum ada player terdaftar.`);
    const lines = all
      .sort((a, b) => b.level - a.level)
      .slice(0, 20)
      .map((p, i) => `${i + 1}. *${p.name}* [${p.class}] Lv.${p.level} — ${p.gold}g`);
    return m.reply(`👥 *Daftar Player (${all.length})*\n\n${lines.join('\n')}`);
  }

  return m.reply(`❓ Admin command tidak dikenal: *${command}*`);
};

handler.help      = ['event <id>', 'reseteconomy', 'ecotick', 'broadcast <msg>', 'addgold @p <jml>', 'additem @p <item>', 'setlevel @p <lvl>', 'players'];
handler.tags      = ['owner'];
handler.command   = /^(event|reseteconomy|ecotick|broadcast|addgold|additem|setlevel|players)$/i;
handler.ownerOnly = true;
handler.cooldown  = 2;

export default handler;
