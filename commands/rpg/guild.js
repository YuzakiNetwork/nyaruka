/**
 * commands/rpg/guild.js
 * Guild System
 */

import { getPlayer, savePlayer, getAllPlayers } from '../../lib/game/player.js';
import {
  getGuild, getGuildByName, saveGuild, getAllGuilds,
  createGuild, addGuildExp, getMember,
  joinGuild, leaveGuild, promoteGuildMember,
  donateToGuild, guildStatusText,
  GUILD_CREATE_COST, MAX_GUILD_MEMBERS,
} from '../../lib/game/guild.js';

let handler = async (m, { args, command }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  const sub = args[0]?.toLowerCase() || 'status';

  // ── !guild status / info ───────────────────────────────────────────────────
  if (sub === 'status' || sub === 'info' || sub === 'cek') {
    if (!player.guildId) {
      const all = getAllGuilds().slice(0, 5);
      return m.reply(
        `🏛️ *Kamu belum punya guild.*\n\n` +
        `*Perintah:*\n` +
        `!guild buat <nama> <tag> — Buat guild (${GUILD_CREATE_COST}g)\n` +
        `!guild gabung <nama>    — Gabung guild\n` +
        `!guild list             — Lihat semua guild\n\n` +
        (all.length ? `🌍 *Guild Aktif:*\n${all.map(g => `• *${g.name}* [${g.tag}] — Lv.${g.level} (${g.members.length} anggota)`).join('\n')}` : '')
      );
    }
    const guild = getGuild(player.guildId);
    if (!guild) return m.reply(`❌ Guild tidak ditemukan. Data mungkin corrupt.`);
    return m.reply(guildStatusText(guild));
  }

  // ── !guild list ────────────────────────────────────────────────────────────
  if (sub === 'list' || sub === 'semua') {
    const guilds = getAllGuilds().sort((a, b) => b.level - a.level);
    if (!guilds.length) return m.reply(`🏛️ Belum ada guild. Buat yang pertama: *!guild buat <nama> <tag>*`);
    return m.reply(
      `🏛️ *Daftar Guild (${guilds.length})*\n\n` +
      guilds.map((g, i) =>
        `${i + 1}. *${g.name}* [${g.tag}] — Lv.${g.level}\n` +
        `   ${g.members.length}/${MAX_GUILD_MEMBERS} anggota | Bank: ${g.bank}g`
      ).join('\n\n')
    );
  }

  // ── !guild buat <nama> <tag> ───────────────────────────────────────────────
  if (sub === 'buat' || sub === 'create') {
    if (player.guildId) return m.reply(`❌ Kamu sudah punya guild. Keluar dulu: *!guild keluar*`);
    const guildName = args[1];
    const guildTag  = args[2];
    if (!guildName || !guildTag) return m.reply(`Usage: *!guild buat <nama> <tag>*\nContoh: !guild buat SwordMaster SM`);
    if ((player.gold || 0) < GUILD_CREATE_COST) return m.reply(`❌ Gold tidak cukup! Butuh *${GUILD_CREATE_COST}g* untuk buat guild.`);

    try {
      const guild = await createGuild(m.sender, player.name, guildName, guildTag);
      player.gold    -= GUILD_CREATE_COST;
      player.guildId  = guild.id;
      player.guildRole = 'Master';
      await savePlayer(player);
      return m.reply(
        `🎉 *Guild "${guild.name}" [${guild.tag}] berhasil dibuat!*\n\n` +
        `👑 Kamu adalah Master guild.\n` +
        `Ajak teman: *!guild invite*\n` +
        `Atur pengumuman: *!guild notice <pesan>*`
      );
    } catch (err) {
      return m.reply(`❌ ${err.message}`);
    }
  }

  // ── !guild gabung <nama> ───────────────────────────────────────────────────
  if (sub === 'gabung' || sub === 'join') {
    if (player.guildId) return m.reply(`❌ Kamu sudah di guild. Keluar dulu.`);
    const guildName = args.slice(1).join(' ');
    if (!guildName) return m.reply(`Usage: *!guild gabung <nama_guild>*`);

    const guild = getGuildByName(guildName);
    if (!guild) return m.reply(`❌ Guild "${guildName}" tidak ditemukan. Cek *!guild list*`);

    try {
      await joinGuild(guild, player);
      player.guildId   = guild.id;
      player.guildRole = 'Member';
      await savePlayer(player);
      return m.reply(`✅ Berhasil bergabung dengan guild *${guild.name}* [${guild.tag}]!\n\nSelamat datang! Gunakan *!guild* untuk lihat info guild.`);
    } catch (err) {
      return m.reply(`❌ ${err.message}`);
    }
  }

  // ── !guild keluar ──────────────────────────────────────────────────────────
  if (sub === 'keluar' || sub === 'leave' || sub === 'quit') {
    if (!player.guildId) return m.reply(`❌ Kamu tidak di guild manapun.`);
    const guild = getGuild(player.guildId);
    if (!guild) { player.guildId = null; player.guildRole = null; await savePlayer(player); return m.reply(`✅ Keluar dari guild.`); }

    try {
      await leaveGuild(guild, m.sender);
      player.guildId   = null;
      player.guildRole = null;
      await savePlayer(player);
      return m.reply(`✅ Kamu telah keluar dari guild *${guild.name}*.`);
    } catch (err) {
      return m.reply(`❌ ${err.message}`);
    }
  }

  // ── !guild notice <pesan> ──────────────────────────────────────────────────
  if (sub === 'notice' || sub === 'pengumuman') {
    if (!player.guildId) return m.reply(`❌ Kamu tidak di guild manapun.`);
    const guild = getGuild(player.guildId);
    const member = getMember(guild, m.sender);
    if (!['Master', 'Vice Master', 'Officer'].includes(member?.role)) return m.reply(`❌ Hanya Officer ke atas yang bisa ubah pengumuman.`);

    const notice = args.slice(1).join(' ');
    if (!notice) return m.reply(`Usage: *!guild notice <pesan>*`);
    guild.notice = notice;
    await saveGuild(guild);
    return m.reply(`✅ Pengumuman guild diperbarui:\n"${notice}"`);
  }

  // ── !guild donasi <jumlah> ─────────────────────────────────────────────────
  if (sub === 'donasi' || sub === 'donate' || sub === 'setor') {
    if (!player.guildId) return m.reply(`❌ Kamu tidak di guild manapun.`);
    const amount = parseInt(args[1]);
    if (!amount || amount < 1) return m.reply(`Usage: *!guild donasi <jumlah>*`);
    if ((player.gold || 0) < amount) return m.reply(`❌ Gold tidak cukup!`);

    const guild = getGuild(player.guildId);
    await donateToGuild(guild, m.sender, amount);
    player.gold -= amount;
    const expMsgs = await addGuildExp(guild, Math.floor(amount / 10));
    await savePlayer(player);

    return m.reply(
      `✅ *Donasi ${amount}g ke guild "${guild.name}"!*\n\n` +
      `Bank guild: ${guild.bank}g\n` +
      (expMsgs.length ? expMsgs.join('\n') : '')
    );
  }

  // ── !guild promote @user ───────────────────────────────────────────────────
  if (sub === 'promote' || sub === 'naik') {
    if (!player.guildId) return m.reply(`❌ Kamu tidak di guild manapun.`);
    const guild  = getGuild(player.guildId);
    const master = getMember(guild, m.sender);
    if (!['Master', 'Vice Master'].includes(master?.role)) return m.reply(`❌ Hanya Master/Vice Master yang bisa promote.`);

    const mentions = m.raw?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (!mentions.length) return m.reply(`Usage: *!guild promote @user*`);

    for (const jid of mentions) {
      try {
        const newRole = await promoteGuildMember(guild, jid);
        return m.reply(`✅ Member dipromosi menjadi *${newRole}*!`);
      } catch (err) {
        return m.reply(`❌ ${err.message}`);
      }
    }
  }

  // ── !guild transfer @user ──────────────────────────────────────────────────
  if (sub === 'transfer') {
    if (!player.guildId) return m.reply(`❌ Kamu tidak di guild manapun.`);
    const guild = getGuild(player.guildId);
    if (guild.masterId !== m.sender) return m.reply(`❌ Hanya Master yang bisa transfer jabatan.`);

    const mentions = m.raw?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (!mentions.length) return m.reply(`Usage: *!guild transfer @user*`);

    const target = getMember(guild, mentions[0]);
    if (!target) return m.reply(`❌ User bukan member guild.`);

    guild.masterId = mentions[0];
    const oldMaster = getMember(guild, m.sender);
    if (oldMaster) oldMaster.role = 'Officer';
    target.role = 'Master';
    player.guildRole = 'Officer';

    await saveGuild(guild);
    await savePlayer(player);
    return m.reply(`👑 Jabatan Master berhasil ditransfer ke *${target.name}*!`);
  }

  return m.reply(
    `🏛️ *Guild Commands*\n\n` +
    `!guild              — status guild\n` +
    `!guild list         — semua guild\n` +
    `!guild buat <n> <t> — buat guild\n` +
    `!guild gabung <n>   — bergabung\n` +
    `!guild keluar       — keluar guild\n` +
    `!guild donasi <g>   — donasi gold\n` +
    `!guild notice <p>   — ubah pengumuman\n` +
    `!guild promote @u   — naikan rank\n` +
    `!guild transfer @u  — transfer master`
  );
};

handler.help    = ['guild', 'guild buat <nama> <tag>', 'guild gabung <nama>'];
handler.tags    = ['rpg'];
handler.command = /^(guild|g)$/i;
handler.cooldown = 5;
export default handler;
