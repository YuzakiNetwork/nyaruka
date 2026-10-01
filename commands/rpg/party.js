/**
 * commands/rpg/party.js
 * Party System — Bentuk kelompok, party quest bersama
 */

import { getPlayer, savePlayer } from '../../lib/game/player.js';
import db from '../../lib/database/db.js';

const PARTY_COL = 'parties';
const MAX_PARTY = 4;

function getParty(partyId) { return db.getRecord(PARTY_COL, partyId); }
function getPartyByLeader(leaderId) {
  return db.getAllRecords(PARTY_COL).find(p => p.leaderId === leaderId && p.active);
}
function getPartyByMember(playerId) {
  return db.getAllRecords(PARTY_COL).find(p => p.members?.some(m => m.id === playerId) && p.active);
}
async function saveParty(party) { return db.setRecord(PARTY_COL, party.id, party); }

let handler = async (m, { args, sock }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  const sub = args[0]?.toLowerCase() || 'status';
  const myParty = getPartyByMember(m.sender);

  // ── !party status ──────────────────────────────────────────────────────────
  if (sub === 'status' || sub === 'info') {
    if (!myParty) {
      return m.reply(
        `👥 *Kamu tidak di party manapun.*\n\n` +
        `*Perintah:*\n` +
        `!party buat        — buat party baru\n` +
        `!party gabung @u   — gabung party orang\n\n` +
        `Party memungkinkan:\n` +
        `• Party Quest bersama\n` +
        `• Berbagi exp & gold\n` +
        `• Support antar member`
      );
    }
    const leader = getPlayer(myParty.leaderId);
    const memberLines = myParty.members.map((mem, i) => {
      const p = getPlayer(mem.id);
      return `${i === 0 ? '👑' : `${i+1}.`} *${mem.name}* [Lv.${p?.level || '?'}] ${mem.id === m.sender ? '← kamu' : ''}`;
    });
    return m.reply(
      `👥 *Party Info*\n\n` +
      `👑 Leader: *${leader?.name || '?'}*\n` +
      `Members: *${myParty.members.length}/${MAX_PARTY}*\n\n` +
      memberLines.join('\n') +
      `\n\n!party quest — lihat party quest`
    );
  }

  // ── !party buat ────────────────────────────────────────────────────────────
  if (sub === 'buat' || sub === 'create' || sub === 'new') {
    if (myParty) return m.reply(`❌ Kamu sudah di party! Keluar dulu: *!party keluar*`);
    const party = {
      id:       `party_${m.sender}_${Date.now()}`,
      leaderId: m.sender,
      members:  [{ id: m.sender, name: player.name, joinedAt: Date.now() }],
      active:   true,
      createdAt: Date.now(),
    };
    await saveParty(party);
    return m.reply(
      `✅ *Party dibuat!*\n\n` +
      `👑 Kamu adalah leader.\n` +
      `Ajak teman: *!party invite @user*\n` +
      `Kapasitas: ${party.members.length}/${MAX_PARTY} member`
    );
  }

  // ── !party invite @user ────────────────────────────────────────────────────
  if (sub === 'invite' || sub === 'ajak') {
    if (!myParty) return m.reply(`❌ Buat party dulu: *!party buat*`);
    if (myParty.leaderId !== m.sender) return m.reply(`❌ Hanya leader yang bisa invite.`);
    if (myParty.members.length >= MAX_PARTY) return m.reply(`❌ Party sudah penuh! (${MAX_PARTY} max)`);

    const mentions = m.raw?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (!mentions.length) return m.reply(`Usage: *!party invite @user*`);

    const targetId = mentions[0];
    const target   = getPlayer(targetId);
    if (!target)   return m.reply(`❌ User belum terdaftar di bot.`);
    if (getPartyByMember(targetId)) return m.reply(`❌ User sudah di party lain.`);

    // Kirim invite DM ke target
    try {
      await sock.sendMessage(targetId, {
        text: `👥 *Party Invitation!*\n\n` +
          `*${player.name}* [Lv.${player.level}] mengajakmu bergabung ke party-nya!\n\n` +
          `Balas dengan: *!party terima ${myParty.id}*\n` +
          `Atau tolak: *!party tolak*`
      });
    } catch {}

    return m.reply(`✅ Undangan dikirim ke *${target.name}*!\nMereka bisa balas dengan *!party terima*`);
  }

  // ── !party terima <partyId> ────────────────────────────────────────────────
  if (sub === 'terima' || sub === 'accept') {
    if (myParty) return m.reply(`❌ Kamu sudah di party. Keluar dulu.`);
    const partyId = args[1];
    if (!partyId) return m.reply(`Usage: *!party terima <partyId>*`);
    const party = getParty(partyId);
    if (!party || !party.active) return m.reply(`❌ Party tidak ditemukan / sudah tidak aktif.`);
    if (party.members.length >= MAX_PARTY) return m.reply(`❌ Party sudah penuh!`);

    party.members.push({ id: m.sender, name: player.name, joinedAt: Date.now() });
    await saveParty(party);

    const leader = getPlayer(party.leaderId);
    try {
      await sock.sendMessage(party.leaderId, {
        text: `👥 *${player.name}* bergabung ke party!`
      });
    } catch {}

    return m.reply(
      `✅ *Bergabung ke party ${leader?.name || '?'}!*\n` +
      `Members: ${party.members.length}/${MAX_PARTY}\n\n` +
      `Gunakan *!party status* untuk lihat info.`
    );
  }

  // ── !party keluar ──────────────────────────────────────────────────────────
  if (sub === 'keluar' || sub === 'leave' || sub === 'quit') {
    if (!myParty) return m.reply(`❌ Kamu tidak di party.`);
    if (myParty.leaderId === m.sender) {
      // Leader bubar partai
      myParty.active = false;
      await saveParty(myParty);
      for (const mem of myParty.members) {
        if (mem.id === m.sender) continue;
        try { await sock.sendMessage(mem.id, { text: `👥 Party dibubarkan oleh leader.` }); } catch {}
      }
      return m.reply(`✅ Party dibubarkan.`);
    }
    myParty.members = myParty.members.filter(mem => mem.id !== m.sender);
    await saveParty(myParty);
    return m.reply(`✅ Kamu keluar dari party.`);
  }

  // ── !party quest ───────────────────────────────────────────────────────────
  if (sub === 'quest' || sub === 'raid') {
    if (!myParty) return m.reply(`❌ Kamu tidak di party.`);

    const PARTY_QUESTS = [
      { name: '🐺 Pemburuan Kawanan Serigala', desc: 'Kalahkan 10 Forest Wolf bersama.', reward: { gold: 500, exp: 300 }, minLevel: 5 },
      { name: '🏰 Penjelajahan Dungeon Bersama', desc: 'Selesaikan dungeon 5 lantai.', reward: { gold: 1000, exp: 700 }, minLevel: 15 },
      { name: '🐉 Perburuan Naga', desc: 'Kalahkan Ancient Dragon.', reward: { gold: 5000, exp: 3000 }, minLevel: 40 },
      { name: '💀 Melawan Pasukan Iblis', desc: 'Kalahkan 30 monster dalam 1 hari.', reward: { gold: 2000, exp: 1500 }, minLevel: 20 },
    ];

    const avgLevel = Math.floor(myParty.members.reduce((sum, mem) => {
      const p = getPlayer(mem.id);
      return sum + (p?.level || 1);
    }, 0) / myParty.members.length);

    const available = PARTY_QUESTS.filter(q => avgLevel >= q.minLevel);

    return m.reply(
      `⚔️ *Party Quest*\n\n` +
      `Party Level Avg: *${avgLevel}*\n\n` +
      (available.length
        ? available.map((q, i) =>
          `${i + 1}. ${q.name}\n   "${q.desc}"\n   💰 ${q.reward.gold}g | ⭐ ${q.reward.exp} EXP`
        ).join('\n\n')
        : '_Belum ada quest tersedia untuk level ini._') +
      `\n\n💡 Party quest akan ditambahkan lebih lanjut!`
    );
  }

  return m.reply(
    `👥 *Party Commands*\n\n` +
    `!party         — status party\n` +
    `!party buat    — buat party\n` +
    `!party invite @u — ajak member\n` +
    `!party terima  — terima undangan\n` +
    `!party quest   — lihat party quest\n` +
    `!party keluar  — keluar party`
  );
};

handler.help    = ['party', 'party buat', 'party invite @user'];
handler.tags    = ['rpg'];
handler.command = /^(party|grup|kelompok)$/i;
handler.cooldown = 5;
export default handler;
