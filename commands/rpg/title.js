/**
 * commands/rpg/title.js
 * Title System — Lihat dan pakai title/gelar
 */

import { getPlayer, savePlayer }           from '../../lib/game/player.js';
import { TITLES, RARITY_COLOR, checkTitles } from '../../lib/game/title.js';

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  const sub = args[0]?.toLowerCase() || 'list';

  // Cek title baru dulu
  const newTitles = checkTitles(player);
  if (newTitles.length) await savePlayer(player);

  // ── !title list ────────────────────────────────────────────────────────────
  if (sub === 'list' || sub === 'all') {
    const earned  = player.earnedTitles || [];
    const total   = Object.keys(TITLES).length;
    const lines   = [];

    const byRarity = { legendary: [], epic: [], rare: [], uncommon: [], common: [] };
    for (const [id, t] of Object.entries(TITLES)) {
      byRarity[t.rarity]?.push({ id, ...t, have: earned.includes(id) });
    }

    for (const [rarity, list] of Object.entries(byRarity)) {
      if (!list.length) continue;
      lines.push(`${RARITY_COLOR[rarity]} *${rarity.toUpperCase()}*`);
      for (const t of list) {
        const active = player.activeTitle === t.id ? ' ◀ aktif' : '';
        lines.push(`  ${t.have ? '✅' : '🔒'} ${t.name}${active}`);
      }
    }

    return m.reply(
      `🏆 *Title Collection*\n` +
      `${earned.length}/${total} diraih\n\n` +
      lines.join('\n') +
      (newTitles.length ? `\n\n✨ *Title baru:* ${newTitles.map(t => t.name).join(', ')}` : '')
    );
  }

  // ── !title info <id> ───────────────────────────────────────────────────────
  if (sub === 'info') {
    const id    = args[1]?.toLowerCase();
    const title = TITLES[id];
    if (!title) return m.reply(`❌ Title tidak ditemukan. Cek *!title list*`);

    const have    = (player.earnedTitles || []).includes(id);
    const bonuses = Object.entries(title.bonus || {}).map(([k,v]) => `+${v} ${k}`).join(', ');

    return m.reply(
      `${RARITY_COLOR[title.rarity]} *${title.name}*\n\n` +
      `Rarity: *${title.rarity}*\n` +
      `Status: ${have ? '✅ Dimiliki' : '🔒 Belum'}\n` +
      `Kondisi: ${title.desc}\n` +
      `Bonus: ${bonuses || 'tidak ada'}`
    );
  }

  // ── !title equip <id> ──────────────────────────────────────────────────────
  if (sub === 'equip' || sub === 'use' || sub === 'wear' || sub === 'pakai') {
    const id = args[1]?.toLowerCase();
    if (!id) return m.reply(`Usage: *!title equip <id>*\nContoh: !title equip slayer`);

    if (!(player.earnedTitles || []).includes(id)) {
      return m.reply(`❌ Kamu belum punya title ini.\nCara dapat: lihat kondisi di *!title info ${id}*`);
    }

    player.activeTitle = id;
    await savePlayer(player);
    return m.reply(`✅ Title *${TITLES[id].name}* diaktifkan!\nBonus: ${Object.entries(TITLES[id].bonus || {}).map(([k,v]) => `+${v} ${k}`).join(', ') || 'tidak ada'}`);
  }

  // ── !title unequip ─────────────────────────────────────────────────────────
  if (sub === 'unequip' || sub === 'remove' || sub === 'off') {
    player.activeTitle = null;
    await savePlayer(player);
    return m.reply(`✅ Title dilepas.`);
  }

  return m.reply(`Usage:\n*!title list* — semua title\n*!title info <id>* — detail\n*!title equip <id>* — pakai title`);
};

handler.help    = ['title list', 'title equip <id>'];
handler.tags    = ['rpg'];
handler.command = /^(title|titles|gelar)$/i;
handler.cooldown = 5;
export default handler;
