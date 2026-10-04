/**
 * commands/rpg/rest.js
 * Istirahat di penginapan untuk memulihkan HP dan Mana (berisiko!).
 * Usage: !rest
 *
 * Hasil istirahat (acak):
 *   1. Buruk  — tidur tidak nyenyak / diserang, HP malah berkurang
 *   2. Biasa  — pemulihan kecil
 *   3. Prima  — HP & Mana pulih penuh
 */

import { getPlayer, savePlayer } from '../../lib/game/player.js';
import { weightedPick, randInt, pick } from '../../lib/utils/random.js';

// ── Konfigurasi ───────────────────────────────────────────────────────────────
const COST_BASE      = 20;   // biaya dasar
const COST_PER_LEVEL = 25;    // tambahan biaya per level
// Contoh biaya: Lv1 = 175g | Lv10 = 400g | Lv30 = 900g | Lv50 = 1.400g

// Peluang tiap hasil (bobot, total bebas)
const OUTCOME_WEIGHTS = [
  { value: 'bad',  weight: 20 },   // 20%
  { value: 'poor', weight: 50 },   // 50%
  { value: 'full', weight: 30 },   // 30%
];

const BAD_HP_LOSS    = [0.15, 0.30];  // kehilangan 15–30% max HP (HP minimal tersisa 1)
const BAD_MANA_LOSS  = [0.05, 0.15];  // kehilangan 5–15% max Mana
const SMALL_HP_HEAL  = [0.10, 0.20];  // pulih 10–20% max HP
const SMALL_MANA_HEAL = [0.10, 0.20]; // pulih 10–20% max Mana

const BAD_FLAVOR = [
  'Kamu diserang tikus raksasa saat tidur!',
  'Kasur penginapan penuh kutu, tidurmu tidak tenang.',
  'Seorang pencuri menyelinap dan melukaimu sebelum kabur.',
  'Kamu mimpi buruk dan terjatuh dari ranjang.',
];
const POOR_FLAVOR = [
  'Penginapannya berisik, tidurmu tidak nyenyak.',
  'Selimutnya tipis dan kamu terbangun kedinginan.',
  'Kamu hanya bisa tidur sebentar.',
];
const FULL_FLAVOR = [
  'Kamu tidur nyenyak di ranjang empuk. Tubuhmu terasa seperti baru!',
  'Pemilik penginapan menyajikan sup hangat. Kamu pulih sepenuhnya!',
  'Mimpi indah semalaman. Kamu bangun dengan tenaga penuh!',
];

const calcCost = (level) => COST_BASE + COST_PER_LEVEL * (level || 1);
const fmt = (n) => Number(n || 0).toLocaleString('id-ID');
const rand = ([min, max]) => min + Math.random() * (max - min);

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  if (player.dungeon) {
    return m.reply(`❌ Kamu tidak bisa istirahat di penginapan saat sedang berada di dungeon.`);
  }

  if (player.hp >= player.maxHp && player.mana >= player.maxMana) {
    return m.reply(`✅ HP dan Mana kamu sudah penuh, tidak perlu istirahat!`);
  }

  const cost = calcCost(player.level);
  if ((player.gold || 0) < cost) {
    return m.reply(
      `💰 Menginap di penginapan butuh *${fmt(cost)}g* (menyesuaikan levelmu).\n` +
      `Gold kamu: *${fmt(player.gold)}g*\n\n` +
      `⚠️ Hasil istirahat tidak selalu baik: bisa buruk, biasa, atau pulih penuh.`
    );
  }

  // Bayar dulu, hasil acak setelahnya
  player.gold -= cost;

  const outcome = weightedPick(OUTCOME_WEIGHTS);
  const hpBefore   = player.hp;
  const manaBefore = player.mana;
  let title, flavor;

  if (outcome === 'bad') {
    // Luka lebih parah — tidak sampai mati (HP minimal 1)
    const hpLoss   = Math.floor(player.maxHp   * rand(BAD_HP_LOSS));
    const manaLoss = Math.floor(player.maxMana * rand(BAD_MANA_LOSS));
    player.hp   = Math.max(1, player.hp   - hpLoss);
    player.mana = Math.max(0, player.mana - manaLoss);
    title  = `💢 *Istirahat Buruk!*`;
    flavor = pick(BAD_FLAVOR);

  } else if (outcome === 'poor') {
    // Heal sedikit
    const healHp   = Math.floor(player.maxHp   * rand(SMALL_HP_HEAL));
    const healMana = Math.floor(player.maxMana * rand(SMALL_MANA_HEAL));
    player.hp   = Math.min(player.maxHp,   player.hp   + healHp);
    player.mana = Math.min(player.maxMana, player.mana + healMana);
    title  = `😴 *Istirahat Biasa*`;
    flavor = pick(POOR_FLAVOR);

  } else {
    // Heal penuh
    player.hp   = player.maxHp;
    player.mana = player.maxMana;
    title  = `🛏️ *Istirahat Sempurna!*`;
    flavor = pick(FULL_FLAVOR);
  }

  await savePlayer(player);

  const hpDiff   = player.hp   - hpBefore;
  const manaDiff = player.mana - manaBefore;
  const sign = (n) => (n >= 0 ? `+${fmt(n)}` : `${fmt(n)}`);

  return m.reply(
    `${title} (-${fmt(cost)}g)\n\n` +
    `_${flavor}_\n\n` +
    `❤️ HP: *${fmt(player.hp)}/${fmt(player.maxHp)}* (${sign(hpDiff)})\n` +
    `💙 Mana: *${fmt(player.mana)}/${fmt(player.maxMana)}* (${sign(manaDiff)})\n` +
    `💰 Sisa gold: *${fmt(player.gold)}g*`
  );
};

handler.help     = ['rest'];
handler.tags     = ['rpg'];
handler.command  = /^rest$/i;
handler.cooldown = 30;

export default handler;
