/**
 * commands/rpg/awaken.js
 * Awakening / Breakthrough System — Tembok kekuatan ala xianxia/isekai
 *
 * Di level tertentu, player harus "Awakening" untuk bisa naik lebih tinggi.
 * Awakening mengubah appearance (nama), buka passive ultimate, boost besar.
 *
 * Lv 30 → Awakening I  : "Yang Terpilih"
 * Lv 60 → Awakening II : "Melampaui Manusia"
 * Lv 90 → Awakening III: "Setara Dewa"
 */

import { getPlayer, savePlayer } from '../../lib/game/player.js';
import { checkTitles }           from '../../lib/game/title.js';

const AWAKENINGS = [
  {
    tier: 1, reqLevel: 30, name: '✨ Awakening I',
    suffix: 'Yang Terpilih',
    desc: 'Kamu merasakan sesuatu dalam dirimu yang selama ini tertidur, kini bangkit.',
    flavor: '"Kekuatanku... aku bisa merasakannya sekarang. Ini baru permulaan!"',
    statBoost: { hp: 200, attack: 30, defense: 20, mana: 100, speed: 10 },
    passiveDesc: 'Passive Awakening: HP regenerasi +5% per battle turn.',
    goldCost: 0, itemCost: null,
  },
  {
    tier: 2, reqLevel: 60, name: '🌟 Awakening II',
    suffix: 'Melampaui Manusia',
    desc: 'Batas antara manusia dan sesuatu yang lebih tinggi mulai memudar dalam dirimu.',
    flavor: '"Aku tidak bisa lagi disebut manusia biasa. Dan aku tidak menyesal."',
    statBoost: { hp: 500, attack: 80, defense: 50, mana: 300, speed: 30 },
    passiveDesc: 'Passive Awakening: Damage +15% saat HP di bawah 50%.',
    goldCost: 10000, itemCost: null,
  },
  {
    tier: 3, reqLevel: 90, name: '🔱 Awakening III',
    suffix: 'Setara Dewa',
    desc: 'Langit dan bumi mengakui keberadaanmu. Kamu bukan lagi bagian dari dunia ini — kamu adalah hukumnya.',
    flavor: '"...Aku sudah melampaui segalanya. Tidak ada lagi yang bisa menahanku."',
    statBoost: { hp: 1500, attack: 200, defense: 120, mana: 800, speed: 80 },
    passiveDesc: 'Passive Awakening: 10% chance "Divine Invulnerability" — tidak terima damage satu turn.',
    goldCost: 50000, itemCost: null,
  },
];

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  const sub = args[0]?.toLowerCase() || 'status';
  const currentTier = player.awakeningTier || 0;

  // ── !awaken status ─────────────────────────────────────────────────────────
  if (sub === 'status' || sub === 'info') {
    const next = AWAKENINGS[currentTier]; // tier 0 index 0, dst
    const lines = [
      `⚡ *Awakening Status*\n`,
      `Tier saat ini: *${currentTier === 0 ? 'Belum Awakening' : AWAKENINGS[currentTier-1].name}*`,
      `Level: *${player.level}*\n`,
    ];

    AWAKENINGS.forEach((aw, i) => {
      const done = currentTier > i;
      const canDo = currentTier === i && player.level >= aw.reqLevel;
      const icon  = done ? '✅' : canDo ? '⚡' : '🔒';
      lines.push(`${icon} *${aw.name}* — Lv.${aw.reqLevel}+${aw.goldCost ? ` | ${aw.goldCost}g` : ''}`);
      if (done) lines.push(`   "${aw.suffix}"`);
    });

    if (next && player.level >= next.reqLevel) {
      lines.push(`\n⚡ *SIAP AWAKENING!*\nGunakan: *!awaken now*`);
    } else if (next) {
      lines.push(`\nSelanjutnya: *${next.name}* (Lv.${next.reqLevel})`);
    } else {
      lines.push(`\n🔱 *Kamu sudah mencapai puncak Awakening!*`);
    }

    return m.reply(lines.join('\n'));
  }

  // ── !awaken now ────────────────────────────────────────────────────────────
  if (sub === 'now' || sub === 'ya' || sub === 'mulai' || sub === 'go') {
    const next = AWAKENINGS[currentTier];
    if (!next) {
      return m.reply(`🔱 Kamu sudah mencapai *Awakening III* — puncak tertinggi!\n"_Tidak ada lagi yang bisa melampaui dirimu._"`);
    }
    if (player.level < next.reqLevel) {
      return m.reply(
        `❌ Level belum cukup!\n\n` +
        `*${next.name}* butuh Level *${next.reqLevel}*\n` +
        `Kamu: Level *${player.level}*\n\n` +
        `Masih kurang *${next.reqLevel - player.level} level* lagi.`
      );
    }
    if (next.goldCost && (player.gold || 0) < next.goldCost) {
      return m.reply(`❌ Gold tidak cukup!\n\n*${next.name}* butuh *${next.goldCost}g*\nGold kamu: *${player.gold}g*`);
    }

    // Apply awakening
    if (next.goldCost) player.gold -= next.goldCost;
    player.awakeningTier  = currentTier + 1;
    player.awakeningName  = next.suffix;

    const boost = next.statBoost;
    player.maxHp   = (player.maxHp   || 100) + boost.hp;
    player.hp      = Math.min(player.hp + boost.hp, player.maxHp);
    player.maxMana = (player.maxMana  || 50)  + boost.mana;
    player.mana    = Math.min(player.mana + boost.mana, player.maxMana);
    player.attack  = (player.attack   || 10)  + boost.attack;
    player.defense = (player.defense  || 5)   + boost.defense;
    player.speed   = (player.speed    || 5)   + boost.speed;

    const newTitles = checkTitles(player);
    await savePlayer(player);

    return m.reply(
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `✨ *${next.name.toUpperCase()}* ✨\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `${next.desc}\n\n` +
      `_${next.flavor}_\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 *${player.name}*, ${next.suffix}\n\n` +
      `📊 *Stat Boost:*\n` +
      `+${boost.hp} HP | +${boost.mana} MP\n` +
      `+${boost.attack} ATK | +${boost.defense} DEF | +${boost.speed} SPD\n\n` +
      `⚡ *${next.passiveDesc}*\n` +
      (newTitles.length ? `\n🏆 *Title baru:* ${newTitles.map(t => t.name).join(', ')}\n` : '') +
      `━━━━━━━━━━━━━━━━━━━━━━━━━`
    );
  }

  return m.reply(
    `⚡ *Awakening System*\n\n` +
    `!awaken        — lihat status\n` +
    `!awaken now    — lakukan awakening\n\n` +
    `Awakening meningkatkan stat besar-besaran\ndan membuka passive skill eksklusif.`
  );
};

handler.help    = ['awaken', 'awaken now'];
handler.tags    = ['rpg'];
handler.command = /^(awaken|awakening|breakthrough)$/i;
handler.cooldown = 10;
export default handler;
