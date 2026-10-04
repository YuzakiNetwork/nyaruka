/**
 * commands/rpg/party.js
 * Party System — Bentuk kelompok, party quest bersama
 *
 * Perintah:
 *   !party                     — status party
 *   !party buat                — buat party baru
 *   !party invite @user        — ajak member (leader)
 *   !party terima / tolak      — jawab undangan
 *   !party kick @user          — keluarkan member (leader)
 *   !party leader @user        — serahkan jabatan leader
 *   !party keluar              — keluar / bubarkan party
 *   !party quest               — lihat SEMUA party quest
 *   !party quest ambil <no>    — ambil quest (leader)
 *   !party quest progres       — lihat progres quest aktif
 *   !party quest batal         — batalkan quest aktif (leader)
 *
 * Integrasi battle/dungeon:
 *   import { addPartyQuestProgress } from './party.js';
 *   const res = await addPartyQuestProgress(playerId, 'kill', 'forest_wolf');
 *   if (res?.text) m.reply(res.text);
 *
 *   Tipe progres yang dikenali:
 *     'kill'          — monster dikalahkan (target = id monster, mis. 'forest_wolf')
 *     'dungeon_floor' — satu lantai dungeon selesai
 *     'boss'          — boss dikalahkan (target = id boss, mis. 'ancient_dragon')
 */

import { getPlayer, savePlayer, awardExp } from '../../lib/game/player.js';
import { normalizeJid }                    from '../../handler/index.js';
import db                                  from '../../lib/database/db.js';

const PARTY_COL    = 'parties';
const MAX_PARTY    = 4;
const INVITE_EXPIRE = 120_000;   // undangan berlaku 2 menit

// ── Daftar Party Quest ────────────────────────────────────────────────────────
// type: 'kill' (target spesifik) | 'kill_any' (monster apa saja) | 'dungeon_floor' | 'boss'
export const PARTY_QUESTS = [
  {
    id: 'wolf_pack', name: '🐺 Pemburuan Kawanan Serigala',
    desc: 'Kalahkan 10 Forest Wolf bersama.',
    type: 'kill', target: 'forest_wolf', goal: 10,
    reward: { gold: 500, exp: 300 }, minLevel: 5,
  },
  {
    id: 'dungeon_5', name: '🏰 Penjelajahan Dungeon Bersama',
    desc: 'Selesaikan 5 lantai dungeon.',
    type: 'dungeon_floor', target: null, goal: 5,
    reward: { gold: 1000, exp: 700 }, minLevel: 15,
  },
  {
    id: 'demon_army', name: '💀 Melawan Pasukan Iblis',
    desc: 'Kalahkan 30 monster dalam 1 hari.',
    type: 'kill_any', target: null, goal: 30, timeLimitMs: 24 * 60 * 60_000,
    reward: { gold: 2000, exp: 1500 }, minLevel: 20,
  },
  {
    id: 'dragon_hunt', name: '🐉 Perburuan Naga',
    desc: 'Kalahkan Ancient Dragon.',
    type: 'boss', target: 'ancient_dragon', goal: 1,
    reward: { gold: 5000, exp: 3000 }, minLevel: 40,
  },
];

// ── Storage helpers ───────────────────────────────────────────────────────────
function getParty(partyId) { return db.getRecord(PARTY_COL, partyId); }
function getPartyByMember(playerId) {
  return db.getAllRecords(PARTY_COL).find(p => p.active && p.members?.some(mem => mem.id === playerId));
}
async function saveParty(party) { return db.setRecord(PARTY_COL, party.id, party); }

// ── Undangan (in-memory) ──────────────────────────────────────────────────────
// targetId -> { partyId, inviterId, expiresAt, timer }
const pendingInvites = new Map();

function clearInvite(targetId) {
  const inv = pendingInvites.get(targetId);
  if (inv) clearTimeout(inv.timer);
  pendingInvites.delete(targetId);
}

// ── Util ──────────────────────────────────────────────────────────────────────
const fmt = (n) => Number(n || 0).toLocaleString('id-ID');

function bar(current, max, size = 10) {
  const ratio  = max > 0 ? Math.min(1, Math.max(0, current / max)) : 0;
  const filled = Math.round(ratio * size);
  return '█'.repeat(filled) + '░'.repeat(size - filled);
}

function fmtDuration(ms) {
  const totalMin = Math.max(0, Math.ceil(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return h > 0 ? `${h} jam ${min} menit` : `${min} menit`;
}

function getMentioned(m) {
  const jids = m.raw?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  return jids[0] ? normalizeJid(jids[0]) : null;
}

function lowestLevel(party) {
  const levels = party.members.map(mem => getPlayer(mem.id)?.level || 1);
  return Math.min(...levels);
}

async function dm(sock, jid, text) {
  try {
    await sock.sendMessage(jid, { text });
    return true;
  } catch {
    return false;
  }
}

// Cek quest aktif kedaluwarsa; kembalikan true jika baru saja dihapus
async function expireQuestIfNeeded(party) {
  const q = party.quest;
  if (q?.expiresAt && Date.now() > q.expiresAt) {
    party.quest = null;
    await saveParty(party);
    return true;
  }
  return false;
}

// ── API untuk battle / dungeon engine ─────────────────────────────────────────
/**
 * Tambah progres party quest dari aksi seorang player.
 * @returns {Promise<null | { completed: boolean, text: string }>}
 *   null jika player tidak di party / tidak ada quest yang cocok.
 */
export async function addPartyQuestProgress(playerId, type, target = null, amount = 1) {
  const party = getPartyByMember(playerId);
  if (!party?.quest) return null;
  if (await expireQuestIfNeeded(party)) return null;

  const def = PARTY_QUESTS.find(q => q.id === party.quest.id);
  if (!def) return null;

  const matches =
    (def.type === 'kill_any' && type === 'kill') ||
    (def.type === type && (!def.target || def.target === target));
  if (!matches) return null;

  party.quest.progress = Math.min(def.goal, (party.quest.progress || 0) + amount);

  if (party.quest.progress < def.goal) {
    await saveParty(party);
    return {
      completed: false,
      text: `📜 *Party Quest:* ${def.name} — ${party.quest.progress}/${def.goal}`,
    };
  }

  // ── Quest selesai: bagi reward ke semua member ──
  party.quest = null;
  party.questsCompleted = (party.questsCompleted || 0) + 1;
  await saveParty(party);

  const lines = [
    `🎉 *PARTY QUEST SELESAI!*`,
    `${def.name}`,
    `Reward untuk tiap member: 💰 ${fmt(def.reward.gold)}g | ⭐ ${fmt(def.reward.exp)} EXP`,
  ];

  for (const mem of party.members) {
    const p = getPlayer(mem.id);
    if (!p) continue;
    p.gold = (p.gold || 0) + def.reward.gold;
    const { messages } = await awardExp(p, def.reward.exp);
    await savePlayer(p);
    for (const msg of messages) lines.push(`\n*${p.name}*\n${msg}`);
  }

  return { completed: true, text: lines.join('\n') };
}

// ── Handler ───────────────────────────────────────────────────────────────────
let handler = async (m, { args, sock }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  const sub = args[0]?.toLowerCase() || 'status';
  const myParty = getPartyByMember(m.sender);
  if (myParty) await expireQuestIfNeeded(myParty);

  // ── !party quest [ambil|progres|batal] ─────────────────────────────────────
  if (sub === 'quest' || sub === 'raid') {
    const action = args[1]?.toLowerCase();

    // — progres —
    if (action === 'progres' || action === 'progress' || action === 'status') {
      if (!myParty) return m.reply(`❌ Kamu tidak di party.`);
      if (!myParty.quest) return m.reply(`📜 Party belum punya quest aktif.\nLihat daftar: *!party quest*`);
      const def = PARTY_QUESTS.find(q => q.id === myParty.quest.id);
      if (!def) return m.reply(`❌ Data quest tidak valid.`);
      const prog = myParty.quest.progress || 0;
      const timeLeft = myParty.quest.expiresAt
        ? `\n⏰ Sisa waktu: *${fmtDuration(myParty.quest.expiresAt - Date.now())}*`
        : '';
      return m.reply(
        `📜 *Quest Aktif*\n\n` +
        `${def.name}\n_"${def.desc}"_\n\n` +
        `Progres: *${prog}/${def.goal}*\n[${bar(prog, def.goal)}]${timeLeft}\n` +
        `🎁 Reward tiap member: 💰 ${fmt(def.reward.gold)}g | ⭐ ${fmt(def.reward.exp)} EXP`
      );
    }

    // — ambil —
    if (action === 'ambil' || action === 'take' || action === 'start') {
      if (!myParty) return m.reply(`❌ Kamu tidak di party. Buat dulu: *!party buat*`);
      if (myParty.leaderId !== m.sender) return m.reply(`❌ Hanya leader yang bisa mengambil quest.`);
      if (myParty.quest) return m.reply(`❌ Party masih punya quest aktif. Selesaikan atau *!party quest batal*.`);

      const idx = parseInt(args[2], 10);
      if (!Number.isInteger(idx) || idx < 1 || idx > PARTY_QUESTS.length) {
        return m.reply(`Usage: *!party quest ambil <nomor>*\nLihat nomor di *!party quest*`);
      }
      const def = PARTY_QUESTS[idx - 1];
      const lvl = lowestLevel(myParty);
      if (lvl < def.minLevel) {
        return m.reply(
          `❌ Level member terendah di party (*${lvl}*) belum cukup.\n` +
          `*${def.name}* butuh Lv.*${def.minLevel}*.`
        );
      }

      myParty.quest = {
        id: def.id,
        progress: 0,
        startedAt: Date.now(),
        expiresAt: def.timeLimitMs ? Date.now() + def.timeLimitMs : null,
      };
      await saveParty(myParty);

      for (const mem of myParty.members) {
        if (mem.id === m.sender) continue;
        await dm(sock, mem.id, `📜 Leader mengambil party quest: *${def.name}*\n_"${def.desc}"_\nCek: *!party quest progres*`);
      }

      return m.reply(
        `✅ *Quest diambil!*\n\n` +
        `${def.name}\n_"${def.desc}"_\n\n` +
        `Target: *${def.goal}*` +
        (def.timeLimitMs ? `\n⏰ Batas waktu: *${fmtDuration(def.timeLimitMs)}*` : '') +
        `\n🎁 Reward tiap member: 💰 ${fmt(def.reward.gold)}g | ⭐ ${fmt(def.reward.exp)} EXP`
      );
    }

    // — batal —
    if (action === 'batal' || action === 'cancel') {
      if (!myParty) return m.reply(`❌ Kamu tidak di party.`);
      if (myParty.leaderId !== m.sender) return m.reply(`❌ Hanya leader yang bisa membatalkan quest.`);
      if (!myParty.quest) return m.reply(`❌ Tidak ada quest aktif.`);
      myParty.quest = null;
      await saveParty(myParty);
      return m.reply(`✅ Quest dibatalkan. Progres direset.`);
    }

    // — daftar semua quest (default) —
    const refLevel = myParty ? lowestLevel(myParty) : player.level;
    const activeId = myParty?.quest?.id;

    const list = PARTY_QUESTS.map((q, i) => {
      const locked = refLevel < q.minLevel;
      const active = activeId === q.id;
      const icon   = active ? '▶️' : locked ? '🔒' : '✅';
      const status = active
        ? `   ▶️ _Sedang dikerjakan (${myParty.quest.progress || 0}/${q.goal})_`
        : locked
          ? `   🔒 _Butuh Lv.${q.minLevel}_`
          : `   ✅ _Tersedia_`;
      return (
        `${icon} *${i + 1}. ${q.name}*\n` +
        `   "${q.desc}"\n` +
        `   🎯 Target: ${q.goal}${q.timeLimitMs ? ` | ⏰ ${fmtDuration(q.timeLimitMs)}` : ''}\n` +
        `   💰 ${fmt(q.reward.gold)}g | ⭐ ${fmt(q.reward.exp)} EXP (tiap member)\n` +
        `   Min. Lv.${q.minLevel}\n` +
        status
      );
    }).join('\n\n');

    return m.reply(
      `⚔️ *PARTY QUEST*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      (myParty
        ? `👥 Level member terendah: *${refLevel}*\n\n`
        : `👤 Levelmu: *${refLevel}* _(belum di party)_\n\n`) +
      `${list}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      (myParty
        ? `*!party quest ambil <no>* — ambil quest (leader)\n*!party quest progres* — lihat progres`
        : `Buat party dulu dengan *!party buat*, lalu ajak teman.`)
    );
  }

  // ── !party status ──────────────────────────────────────────────────────────
  if (sub === 'status' || sub === 'info') {
    if (!myParty) {
      return m.reply(
        `👥 *Kamu tidak di party manapun.*\n\n` +
        `*Perintah:*\n` +
        `!party buat      — buat party baru\n` +
        `!party quest     — lihat daftar party quest\n\n` +
        `Party memungkinkan:\n` +
        `• Party Quest bersama\n` +
        `• Reward gold & EXP untuk semua member\n` +
        `• Support antar member`
      );
    }
    const leader = getPlayer(myParty.leaderId);
    const memberLines = myParty.members.map((mem, i) => {
      const p = getPlayer(mem.id);
      const mark = mem.id === myParty.leaderId ? '👑' : `${i + 1}.`;
      return `${mark} *${mem.name}* [Lv.${p?.level || '?'}] ${mem.id === m.sender ? '← kamu' : ''}`;
    });

    let questLine = `\n\n📜 Quest: _belum ada_ (*!party quest*)`;
    if (myParty.quest) {
      const def = PARTY_QUESTS.find(q => q.id === myParty.quest.id);
      if (def) questLine = `\n\n📜 Quest: *${def.name}* — ${myParty.quest.progress || 0}/${def.goal}`;
    }

    return m.reply(
      `👥 *Party Info*\n\n` +
      `👑 Leader: *${leader?.name || '?'}*\n` +
      `Members: *${myParty.members.length}/${MAX_PARTY}*\n\n` +
      memberLines.join('\n') +
      questLine +
      `\n🏅 Quest selesai: *${myParty.questsCompleted || 0}*`
    );
  }

  // ── !party buat ────────────────────────────────────────────────────────────
  if (sub === 'buat' || sub === 'create' || sub === 'new') {
    if (myParty) return m.reply(`❌ Kamu sudah di party! Keluar dulu: *!party keluar*`);
    const party = {
      id:        `party_${m.sender}_${Date.now()}`,
      leaderId:  m.sender,
      members:   [{ id: m.sender, name: player.name, joinedAt: Date.now() }],
      quest:     null,
      questsCompleted: 0,
      active:    true,
      createdAt: Date.now(),
    };
    await saveParty(party);
    return m.reply(
      `✅ *Party dibuat!*\n\n` +
      `👑 Kamu adalah leader.\n` +
      `Ajak teman: *!party invite @user*\n` +
      `Lihat quest: *!party quest*\n` +
      `Kapasitas: ${party.members.length}/${MAX_PARTY} member`
    );
  }

  // ── !party invite @user ────────────────────────────────────────────────────
  if (sub === 'invite' || sub === 'ajak') {
    if (!myParty) return m.reply(`❌ Buat party dulu: *!party buat*`);
    if (myParty.leaderId !== m.sender) return m.reply(`❌ Hanya leader yang bisa invite.`);
    if (myParty.members.length >= MAX_PARTY) return m.reply(`❌ Party sudah penuh! (${MAX_PARTY} max)`);

    const targetId = getMentioned(m);
    if (!targetId) return m.reply(`Usage: *!party invite @user*`);
    if (targetId === m.sender) return m.reply(`❌ Tidak bisa mengundang diri sendiri.`);

    const target = getPlayer(targetId);
    if (!target) return m.reply(`❌ User belum terdaftar di bot.`);
    if (getPartyByMember(targetId)) return m.reply(`❌ *${target.name}* sudah di party lain.`);

    clearInvite(targetId);
    const timer = setTimeout(() => pendingInvites.delete(targetId), INVITE_EXPIRE);
    pendingInvites.set(targetId, {
      partyId: myParty.id,
      inviterId: m.sender,
      expiresAt: Date.now() + INVITE_EXPIRE,
      timer,
    });

    const sent = await dm(
      sock, targetId,
      `👥 *Party Invitation!*\n\n` +
      `*${player.name}* [Lv.${player.level}] mengajakmu bergabung ke party-nya!\n\n` +
      `Terima: *!party terima*\n` +
      `Tolak: *!party tolak*\n` +
      `⏰ Berlaku 2 menit`
    );

    return m.reply(
      sent
        ? `✅ Undangan dikirim ke *${target.name}*!\nMereka bisa balas dengan *!party terima*`
        : `✅ Undangan untuk *${target.name}* sudah dibuat, tapi DM gagal terkirim.\n` +
          `Minta dia mengetik *!party terima* dalam 2 menit.`
    );
  }

  // ── !party terima ──────────────────────────────────────────────────────────
  if (sub === 'terima' || sub === 'accept') {
    if (myParty) return m.reply(`❌ Kamu sudah di party. Keluar dulu.`);
    const inv = pendingInvites.get(m.sender);
    if (!inv || Date.now() > inv.expiresAt) {
      clearInvite(m.sender);
      return m.reply(`❌ Tidak ada undangan untukmu (atau sudah kedaluwarsa).`);
    }

    const party = getParty(inv.partyId);
    clearInvite(m.sender);
    if (!party || !party.active) return m.reply(`❌ Party tidak ditemukan / sudah tidak aktif.`);
    if (party.members.length >= MAX_PARTY) return m.reply(`❌ Party sudah penuh!`);

    party.members.push({ id: m.sender, name: player.name, joinedAt: Date.now() });
    await saveParty(party);

    const leader = getPlayer(party.leaderId);
    await dm(sock, party.leaderId, `👥 *${player.name}* bergabung ke party!`);

    return m.reply(
      `✅ *Bergabung ke party ${leader?.name || '?'}!*\n` +
      `Members: ${party.members.length}/${MAX_PARTY}\n\n` +
      `Gunakan *!party status* untuk lihat info, atau *!party quest* untuk daftar quest.`
    );
  }

  // ── !party tolak ───────────────────────────────────────────────────────────
  if (sub === 'tolak' || sub === 'decline') {
    const inv = pendingInvites.get(m.sender);
    if (!inv || Date.now() > inv.expiresAt) {
      clearInvite(m.sender);
      return m.reply(`❌ Tidak ada undangan untukmu.`);
    }
    clearInvite(m.sender);
    await dm(sock, inv.inviterId, `👥 *${player.name}* menolak undangan party.`);
    return m.reply(`✋ Kamu menolak undangan party.`);
  }

  // ── !party kick @user ──────────────────────────────────────────────────────
  if (sub === 'kick' || sub === 'keluarkan') {
    if (!myParty) return m.reply(`❌ Kamu tidak di party.`);
    if (myParty.leaderId !== m.sender) return m.reply(`❌ Hanya leader yang bisa kick.`);

    const targetId = getMentioned(m);
    if (!targetId) return m.reply(`Usage: *!party kick @user*`);
    if (targetId === m.sender) return m.reply(`❌ Tidak bisa kick diri sendiri. Gunakan *!party keluar*.`);
    const mem = myParty.members.find(x => x.id === targetId);
    if (!mem) return m.reply(`❌ User itu bukan member party-mu.`);

    myParty.members = myParty.members.filter(x => x.id !== targetId);
    await saveParty(myParty);
    await dm(sock, targetId, `👥 Kamu dikeluarkan dari party oleh leader.`);
    return m.reply(`✅ *${mem.name}* dikeluarkan dari party.`);
  }

  // ── !party leader @user ────────────────────────────────────────────────────
  if (sub === 'leader' || sub === 'transfer') {
    if (!myParty) return m.reply(`❌ Kamu tidak di party.`);
    if (myParty.leaderId !== m.sender) return m.reply(`❌ Hanya leader yang bisa menyerahkan jabatan.`);

    const targetId = getMentioned(m);
    if (!targetId) return m.reply(`Usage: *!party leader @user*`);
    if (targetId === m.sender) return m.reply(`❌ Kamu sudah leader.`);
    const mem = myParty.members.find(x => x.id === targetId);
    if (!mem) return m.reply(`❌ User itu bukan member party-mu.`);

    myParty.leaderId = targetId;
    await saveParty(myParty);
    await dm(sock, targetId, `👑 Kamu sekarang leader party!`);
    return m.reply(`✅ Jabatan leader diserahkan ke *${mem.name}*.`);
  }

  // ── !party keluar ──────────────────────────────────────────────────────────
  if (sub === 'keluar' || sub === 'leave' || sub === 'quit') {
    if (!myParty) return m.reply(`❌ Kamu tidak di party.`);
    if (myParty.leaderId === m.sender) {
      // Leader bubarkan party
      myParty.active = false;
      myParty.quest  = null;
      await saveParty(myParty);
      for (const mem of myParty.members) {
        if (mem.id === m.sender) continue;
        await dm(sock, mem.id, `👥 Party dibubarkan oleh leader.`);
      }
      return m.reply(`✅ Party dibubarkan.`);
    }
    myParty.members = myParty.members.filter(mem => mem.id !== m.sender);
    await saveParty(myParty);
    await dm(sock, myParty.leaderId, `👥 *${player.name}* keluar dari party.`);
    return m.reply(`✅ Kamu keluar dari party.`);
  }

  return m.reply(
    `👥 *Party Commands*\n\n` +
    `!party              — status party\n` +
    `!party buat         — buat party\n` +
    `!party invite @u    — ajak member\n` +
    `!party terima       — terima undangan\n` +
    `!party tolak        — tolak undangan\n` +
    `!party kick @u      — keluarkan member\n` +
    `!party leader @u    — serahkan leader\n` +
    `!party quest        — lihat daftar quest\n` +
    `!party quest ambil <no> — ambil quest\n` +
    `!party quest progres    — progres quest\n` +
    `!party keluar       — keluar / bubarkan party`
  );
};

handler.help    = ['party', 'party buat', 'party invite @user', 'party quest'];
handler.tags    = ['rpg'];
handler.command = /^(party|grup|kelompok)$/i;
handler.cooldown = 5;
export default handler;
