/**
 * commands/rpg/summon.js
 * Summon Battle — Summoner class skill
 */

import { getPlayer, savePlayer } from '../../lib/game/player.js';
import { GACHA_POOL }            from '../../lib/game/gacha.js';

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  const job = player.job || player.class;
  const isSummoner = ['Summoner', 'Invoker', 'Contractor', 'Tamer', 'Overlord', 'Beast God'].includes(job);

  if (!isSummoner) {
    return m.reply(`❌ Skill ini hanya untuk class Summoner!`);
  }

  const sub = args[0]?.toLowerCase() || 'list';

  // ── !summon list ───────────────────────────────────────────────────────────
  if (sub === 'list' || sub === 'owned') {
    // Cari summon yang dimiliki di inventory
    const summons = (player.inventory || [])
      .map(inv => {
        const item = GACHA_POOL[inv.itemId];
        if (item?.type === 'summon') return { ...item, qty: inv.quantity };
        return null;
      })
      .filter(Boolean)
      .sort((a, b) => (b.summonPower || 0) - (a.summonPower || 0));

    if (!summons.length) {
      return m.reply(
        `🎴 Kamu belum punya summon!\n\n` +
        `Cara dapat summon:\n` +
        `• Roll *!gacha* untuk dapetin summon random\n` +
        `• Summon ada di gacha pool dengan rate rendah\n` +
        `• SSR summon seperti Bahamut, Ifrit, Shiva sangat langka!`
      );
    }

    const lines = [
      `🎴 *Summon yang Dimiliki*`,
      `━━━━━━━━━━━━━━━━━━━━━`,
    ];

    for (const summon of summons) {
      const rarity = summon.rarity === 'SSR' ? '🟨' : summon.rarity === 'SR' ? '🟦' : '🟩';
      lines.push(`${rarity} ${summon.emoji} *${summon.name}* ×${summon.qty}`);
      lines.push(`   Power: ${summon.summonPower} | ATK: ${summon.stats?.attack || 0}`);
    }

    lines.push(``);
    lines.push(`Gunakan: *!summon call <nama>*`);
    lines.push(`Contoh: *!summon call bahamut*`);

    return m.reply(lines.join('\n'));
  }

  // ── !summon call <nama> ────────────────────────────────────────────────────
  if (sub === 'call' || sub === 'use' || sub === 'cast') {
    const summonName = args.slice(1).join(' ').toLowerCase();
    if (!summonName) {
      return m.reply(`Usage: *!summon call <nama>*\n\nContoh: *!summon call bahamut*\n\nLihat summon yang kamu punya: *!summon list*`);
    }

    // Cari summon di inventory
    const invItem = (player.inventory || []).find(inv => {
      const item = GACHA_POOL[inv.itemId];
      return item?.type === 'summon' && item.name.toLowerCase().includes(summonName);
    });

    if (!invItem) {
      return m.reply(`❌ Kamu tidak punya summon "${summonName}"!\n\nCek summon yang kamu punya: *!summon list*`);
    }

    const summon = GACHA_POOL[invItem.itemId];
    const manaCost = Math.floor(summon.summonPower / 2);

    if (player.mana < manaCost) {
      return m.reply(`❌ Mana tidak cukup!\n\nButuh: *${manaCost} MP*\nMana kamu: *${player.mana}/${player.maxMana}*\n\nRest dulu: *!rest*`);
    }

    // Cooldown check
    if (!player.summonCooldown) player.summonCooldown = {};
    const lastUse = player.summonCooldown[summon.id] || 0;
    const now     = Date.now();
    const cdTime  = 5 * 60 * 1000; // 5 menit

    if (now - lastUse < cdTime) {
      const remaining = Math.ceil((cdTime - (now - lastUse)) / 1000);
      return m.reply(`⏰ Summon *${summon.name}* masih cooldown!\n\nCooldown tersisa: *${remaining}s*`);
    }

    // Consume mana & set cooldown
    player.mana -= manaCost;
    player.summonCooldown[summon.id] = now;

    // Simpan active summon (untuk dipakai di battle)
    player.activeSummon = {
      id:    summon.id,
      name:  summon.name,
      emoji: summon.emoji,
      power: summon.summonPower,
      stats: summon.stats,
      uses:  3,  // bisa dipakai 3x battle
    };

    await savePlayer(player);

    return m.reply(
      `✨ *SUMMON CALLED!* ✨\n\n` +
      `${summon.emoji} *${summon.name}*\n` +
      `Power: ${summon.summonPower}\n` +
      `ATK: +${summon.stats?.attack || 0} | HP: +${summon.stats?.hp || 0}\n\n` +
      `Mana consumed: -${manaCost} MP\n` +
      `Remaining mana: ${player.mana}/${player.maxMana}\n\n` +
      `🎴 Summon ini akan membantu kamu di 3× battle berikutnya!\n` +
      `Serang monster: *!battle*`
    );
  }

  // ── !summon active ─────────────────────────────────────────────────────────
  if (sub === 'active' || sub === 'status') {
    if (!player.activeSummon || player.activeSummon.uses <= 0) {
      return m.reply(`🎴 Tidak ada summon aktif.\n\nCall summon: *!summon call <nama>*`);
    }

    const s = player.activeSummon;
    return m.reply(
      `🎴 *Active Summon*\n\n` +
      `${s.emoji} *${s.name}*\n` +
      `Power: ${s.power}\n` +
      `Bonus: ATK +${s.stats?.attack || 0}, HP +${s.stats?.hp || 0}\n\n` +
      `Uses remaining: *${s.uses}×*`
    );
  }

  return m.reply(
    `🎴 *Summon Commands*\n\n` +
    `!summon list   — summon yang kamu punya\n` +
    `!summon call   — panggil summon\n` +
    `!summon active — status summon aktif\n\n` +
    `💡 Summon membantu di battle!\nDapatkan dari *!gacha*`
  );
};

handler.help    = ['summon', 'summon list', 'summon call <nama>'];
handler.tags    = ['rpg'];
handler.command = /^(summon|召喚)$/i;
handler.cooldown = 20;
export default handler;
