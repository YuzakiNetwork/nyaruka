/**
 * lib/game/guild.js
 * Guild System
 */

import db from '../database/db.js';
import { randInt } from '../utils/random.js';

const GUILD_COL = 'guilds';

export const GUILD_RANKS = ['Member', 'Elite', 'Officer', 'Vice Master', 'Master'];

export const MAX_GUILD_MEMBERS = 30;
export const GUILD_CREATE_COST = 5000;

// ── CRUD ──────────────────────────────────────────────────────────────────────
export function getGuild(guildId) { return db.getRecord(GUILD_COL, guildId); }
export function getGuildByName(name) {
  return db.getAllRecords(GUILD_COL).find(g => g.name?.toLowerCase() === name.toLowerCase());
}
export async function saveGuild(guild) {
  return db.setRecord(GUILD_COL, guild.id, guild);
}
export function getAllGuilds() { return db.getAllRecords(GUILD_COL); }

// ── Buat guild ─────────────────────────────────────────────────────────────
export async function createGuild(masterId, masterName, guildName, guildTag) {
  if (getGuildByName(guildName)) throw new Error(`Guild bernama "${guildName}" sudah ada.`);

  const guild = {
    id:          `guild_${Date.now()}`,
    name:        guildName,
    tag:         guildTag.toUpperCase().slice(0, 5),
    masterId,
    members: [{
      playerId:  masterId,
      name:      masterName,
      role:      'Master',
      joinedAt:  Date.now(),
      contribution: 0,
    }],
    bank:        0,
    exp:         0,
    level:       1,
    notice:      'Selamat datang di guild!',
    createdAt:   Date.now(),
    questLog:    [],
    wins:        0,
    totalDmg:    0,
  };
  await saveGuild(guild);
  return guild;
}

// ── Guild level/exp ───────────────────────────────────────────────────────────
export function guildExpRequired(level) { return level * 1000; }

export async function addGuildExp(guild, amount) {
  guild.exp = (guild.exp || 0) + amount;
  const msgs = [];
  while (guild.exp >= guildExpRequired(guild.level)) {
    guild.exp   -= guildExpRequired(guild.level);
    guild.level += 1;
    msgs.push(`🎉 Guild *${guild.name}* naik ke Level *${guild.level}*!`);
  }
  await saveGuild(guild);
  return msgs;
}

// ── Member management ─────────────────────────────────────────────────────────
export function getMember(guild, playerId) {
  return guild.members?.find(m => m.playerId === playerId);
}

export async function joinGuild(guild, player) {
  if (guild.members.length >= MAX_GUILD_MEMBERS)
    throw new Error('Guild sudah penuh!');
  if (getMember(guild, player.id))
    throw new Error('Kamu sudah di guild ini.');

  guild.members.push({
    playerId:     player.id,
    name:         player.name,
    role:         'Member',
    joinedAt:     Date.now(),
    contribution: 0,
  });
  await saveGuild(guild);
}

export async function leaveGuild(guild, playerId) {
  if (guild.masterId === playerId) throw new Error('Master tidak bisa keluar. Transfer dulu jabatan dengan !guild transfer.');
  guild.members = guild.members.filter(m => m.playerId !== playerId);
  await saveGuild(guild);
}

export async function promoteGuildMember(guild, playerId) {
  const member = getMember(guild, playerId);
  if (!member) throw new Error('Member tidak ditemukan.');
  const idx = GUILD_RANKS.indexOf(member.role);
  if (idx >= GUILD_RANKS.length - 2) throw new Error('Sudah rank tertinggi (tidak bisa ke Master).');
  member.role = GUILD_RANKS[idx + 1];
  await saveGuild(guild);
  return member.role;
}

export async function donateToGuild(guild, playerId, amount) {
  const member = getMember(guild, playerId);
  if (!member) throw new Error('Kamu bukan member guild ini.');
  guild.bank            = (guild.bank || 0) + amount;
  member.contribution   = (member.contribution || 0) + amount;
  await saveGuild(guild);
}

// ── Format ────────────────────────────────────────────────────────────────────
export function guildStatusText(guild) {
  const sorted = [...guild.members].sort((a, b) => (b.contribution || 0) - (a.contribution || 0));
  const memberLines = sorted.slice(0, 10).map((m, i) =>
    `${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`} *${m.name}* [${m.role}] — ${m.contribution || 0}g kontribusi`
  ).join('\n');

  return (
    `🏛️ *${guild.name}* [${guild.tag}]\n` +
    `Level: *${guild.level}* | Bank: *${guild.bank}g*\n` +
    `Members: *${guild.members.length}/${MAX_GUILD_MEMBERS}*\n\n` +
    `📌 ${guild.notice}\n\n` +
    `👥 *Top Members:*\n${memberLines}`
  );
}

export default { getGuild, getGuildByName, saveGuild, getAllGuilds, createGuild, addGuildExp, getMember, joinGuild, leaveGuild, promoteGuildMember, donateToGuild, guildStatusText };
