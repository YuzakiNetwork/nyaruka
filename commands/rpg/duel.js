/**
 * commands/rpg/duel.js
 * PvP Duel antar player.
 * Usage: !duel @target | !duel accept [@penantang] | !duel decline
 *
 * Perbaikan dari versi sebelumnya:
 *  - Stat PvP (pvpWins, pvpLosses, wins, losses) sekarang tercatat
 *  - Taruhan dibatasi gold yang dimiliki kedua pihak (tidak ada gold "muncul" dari nol)
 *  - Timer tantangan di-clear, tidak menghapus tantangan baru
 *  - Accept bisa memilih penantang spesifik dengan mention
 *  - Pesan level up ditampilkan
 *  - Memakai effectiveStats + passive Awakening
 *  - Tidak bisa duel saat sedang di dungeon
 *  - Cooldown per pasangan untuk mencegah farming EXP
 */

import { getPlayer, savePlayer, awardExp, effectiveStats } from '../../lib/game/player.js';
import { chance, applyVariance }                          from '../../lib/utils/random.js';
import { normalizeJid }                                   from '../../handler/index.js';

// ── Konfigurasi ───────────────────────────────────────────────────────────────
const DUEL_EXPIRE   = 60_000;       // tantangan berlaku 60 detik
const PAIR_COOLDOWN = 5 * 60_000;   // pasangan yang sama baru bisa duel lagi setelah 5 menit
const MAX_TURNS     = 15;
const MISS_CHANCE   = 0.08;

// challengerId -> { targetId, expiresAt, timer }
const pendingDuels = new Map();
// "idA|idB" (terurut) -> timestamp duel terakhir
const pairCooldowns = new Map();

// ── Helper ────────────────────────────────────────────────────────────────────
const calcBet = (player) => Math.min(50 + (player.level || 1) * 10, 500);
const pairKey = (a, b) => [a, b].sort().join('|');

function clearPending(challengerId) {
  const d = pendingDuels.get(challengerId);
  if (d) clearTimeout(d.timer);
  pendingDuels.delete(challengerId);
}

function makeFighter(player) {
  // itemLib tidak di-pass, jadi hanya stat dasar. Sambungkan itemLib bila ingin bonus equipment:
  // effectiveStats(player, itemLib)
  const st = effectiveStats(player);
  return {
    ref:   player,
    name:  player.name,
    cls:   player.class,
    tier:  player.awakeningTier || 0,
    atk:   st.attack,
    def:   st.defense,
    spd:   st.speed,
    maxHp: st.maxHp,
    hp:    st.maxHp,
  };
}

// ── Simulasi ──────────────────────────────────────────────────────────────────
function simulateDuel(p1, p2) {
  const f1 = makeFighter(p1);
  const f2 = makeFighter(p2);
  const order = f1.spd >= f2.spd ? [f1, f2] : [f2, f1];
  const log = [];

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    // Passive Awakening I+: regenerasi 5% HP per turn
    for (const f of order) {
      if (f.tier >= 1 && f.hp > 0) {
        const heal = Math.floor(f.maxHp * 0.05);
        const before = f.hp;
        f.hp = Math.min(f.maxHp, f.hp + heal);
        if (f.hp > before) log.push(`💚 *${f.name}* regenerasi +${f.hp - before} HP`);
      }
    }

    for (const att of order) {
      const def = att === f1 ? f2 : f1;
      if (f1.hp <= 0 || f2.hp <= 0) break;

      if (chance(MISS_CHANCE)) {
        log.push(`💨 *${att.name}* meleset!`);
        continue;
      }

      // Passive Awakening III: 10% Divine Invulnerability
      if (def.tier >= 3 && chance(0.10)) {
        log.push(`🔱 *${def.name}* kebal! Serangan *${att.name}* tidak berefek.`);
        continue;
      }

      const crit = chance(att.cls === 'Assassin' ? 0.20 : 0.10);
      let dmg = Math.floor(applyVariance(att.atk, 0.15) - def.def * 0.5);
      dmg = Math.max(1, dmg);

      // Passive Awakening II+: damage +15% saat HP di bawah 50%
      if (att.tier >= 2 && att.hp < att.maxHp * 0.5) dmg = Math.floor(dmg * 1.15);

      const final = crit ? Math.floor(dmg * 1.8) : dmg;
      def.hp = Math.max(0, def.hp - final);

      log.push(
        crit
          ? `💥 *${att.name}* CRITICAL *${final}* → ${def.name} HP: ${def.hp}`
          : `⚔️ *${att.name}* serang *${final}* → ${def.name} HP: ${def.hp}`
      );
    }
    if (f1.hp <= 0 || f2.hp <= 0) break;
  }

  // Penentuan pemenang: yang HP-nya nol kalah; jika sama-sama hidup, bandingkan persentase HP
  let winner = null;
  if (f1.hp <= 0 && f2.hp <= 0) winner = null;
  else if (f1.hp <= 0) winner = p2;
  else if (f2.hp <= 0) winner = p1;
  else {
    const r1 = f1.hp / f1.maxHp;
    const r2 = f2.hp / f2.maxHp;
    winner = r1 > r2 ? p1 : r2 > r1 ? p2 : null;
  }

  return { log, winner };
}

// ── Handler ───────────────────────────────────────────────────────────────────
let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  const sub = args[0]?.toLowerCase();

  // Ambil mention dari contextInfo (lebih reliable dari parse teks)
  const mentionedJids = m.raw?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  const mentioned     = mentionedJids[0] ? normalizeJid(mentionedJids[0]) : null;

  // Bersihkan tantangan kedaluwarsa
  for (const [id, d] of pendingDuels) {
    if (Date.now() > d.expiresAt) clearPending(id);
  }

  // ── accept ────────────────────────────────────────────────────────────────
  if (sub === 'accept' || sub === 'terima') {
    const entries = [...pendingDuels.entries()].filter(([, d]) => d.targetId === m.sender);
    if (!entries.length) return m.reply(`❌ Tidak ada tantangan duel untukmu.`);

    // Jika ada mention, pilih penantang itu; kalau tidak, ambil yang paling lama menunggu
    let entry = mentioned ? entries.find(([id]) => id === mentioned) : entries[0];
    if (!entry) return m.reply(`❌ Tidak ada tantangan dari orang tersebut.`);

    const [challengerId] = entry;
    const challenger = getPlayer(challengerId);
    if (!challenger) {
      clearPending(challengerId);
      return m.reply(`❌ Penantang tidak ditemukan.`);
    }

    if (player.dungeon || challenger.dungeon) {
      return m.reply(`❌ Salah satu pemain sedang berada di dungeon. Selesaikan dulu sebelum duel.`);
    }

    const key  = pairKey(challengerId, m.sender);
    const last = pairCooldowns.get(key) || 0;
    const wait = last + PAIR_COOLDOWN - Date.now();
    if (wait > 0) {
      return m.reply(`⏳ Kalian baru saja duel. Tunggu *${Math.ceil(wait / 1000)} detik* lagi untuk duel dengan lawan yang sama.`);
    }

    clearPending(challengerId);
    pairCooldowns.set(key, Date.now());

    const result = simulateDuel(challenger, player);
    const logText = result.log.slice(-10).join('\n');
    const header = `⚔️ *DUEL: ${challenger.name} vs ${player.name}*\n━━━━━━━━━━━━━━━\n`;

    if (!result.winner) {
      return m.reply(`${header}${logText}\n━━━━━━━━━━━━━━━\n\n🤝 *SERI!* Tidak ada yang kalah.`);
    }

    const win  = result.winner;
    const lose = win === challenger ? player : challenger;

    // Taruhan tidak boleh melebihi gold siapa pun
    const bet = Math.max(0, Math.min(calcBet(challenger), win.gold || 0, lose.gold || 0));
    win.gold  = (win.gold  || 0) + bet;
    lose.gold = (lose.gold || 0) - bet;

    // Catat statistik PvP
    win.stats  = win.stats  || {};
    lose.stats = lose.stats || {};
    win.stats.pvpWins    = (win.stats.pvpWins    || 0) + 1;
    win.stats.wins       = (win.stats.wins       || 0) + 1;
    lose.stats.pvpLosses = (lose.stats.pvpLosses || 0) + 1;
    lose.stats.losses    = (lose.stats.losses    || 0) + 1;

    const expGain = 30 + win.level * 2;
    const { messages } = await awardExp(win, expGain);

    await savePlayer(challenger);
    await savePlayer(player);

    let reply =
      `${header}${logText}\n━━━━━━━━━━━━━━━\n\n` +
      `🏆 *${win.name}* MENANG!\n` +
      `✨ +${expGain} EXP\n` +
      (bet > 0
        ? `💰 +${bet}g → ${win.name}\n💸 -${bet}g → ${lose.name}`
        : `💰 Tidak ada taruhan (gold tidak cukup).`);

    if (messages.length) reply += `\n\n${messages.join('\n\n')}`;
    return m.reply(reply);
  }

  // ── decline ───────────────────────────────────────────────────────────────
  if (sub === 'decline' || sub === 'tolak') {
    const entries = [...pendingDuels.entries()].filter(([, d]) => d.targetId === m.sender);
    if (!entries.length) return m.reply(`❌ Tidak ada tantangan duel untukmu.`);

    const entry = mentioned ? entries.find(([id]) => id === mentioned) : entries[0];
    if (!entry) return m.reply(`❌ Tidak ada tantangan dari orang tersebut.`);

    clearPending(entry[0]);
    return m.reply(`✋ Kamu menolak tantangan duel.`);
  }

  // ── challenge @target ─────────────────────────────────────────────────────
  if (!mentioned) {
    return m.reply(
      `⚔️ *Duel System*\n\n` +
      `*!duel @player* — tantang player\n` +
      `*!duel accept* — terima tantangan\n` +
      `*!duel decline* — tolak tantangan\n\n` +
      `Taruhan: *${calcBet(player)}g* (maks, menyesuaikan gold kedua pihak)`
    );
  }

  if (mentioned === m.sender) return m.reply(`❌ Tidak bisa duel dengan diri sendiri.`);

  const target = getPlayer(mentioned);
  if (!target) {
    return m.reply(
      `❌ Pemain itu belum bergabung di Nyaruka.\n` +
      `Ajak dia membuat karakter dengan *!register <name> <class>*, lalu coba lagi.`
    );
  }

  if (player.dungeon) return m.reply(`❌ Kamu sedang berada di dungeon. Selesaikan dulu sebelum duel.`);
  if (target.dungeon) return m.reply(`❌ *${target.name}* sedang berada di dungeon.`);

  // Ganti tantangan lama (jika ada) dan bersihkan timernya
  clearPending(m.sender);
  const timer = setTimeout(() => pendingDuels.delete(m.sender), DUEL_EXPIRE);
  pendingDuels.set(m.sender, {
    targetId:  mentioned,
    expiresAt: Date.now() + DUEL_EXPIRE,
    timer,
  });

  return m.reply(
    `⚔️ *${player.name}* menantang *${target.name}* untuk DUEL!\n\n` +
    `💰 Taruhan: maks *${calcBet(player)}g*\n` +
    `⏰ Berlaku *60 detik*\n\n` +
    `Ketik *!duel accept* untuk menerima atau *!duel decline* untuk menolak.`
  );
};

handler.help     = ['duel @player', 'duel accept', 'duel decline'];
handler.tags     = ['rpg'];
handler.command  = /^duel$/i;
handler.cooldown = 60;

export default handler;
