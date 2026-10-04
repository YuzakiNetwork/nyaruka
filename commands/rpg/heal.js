/**
 * commands/rpg/heal.js
 * Gunakan item konsumabel dari inventory di luar battle.
 *
 * Usage:
 *   !heal                        → daftar item
 *   !heal <item_id>              → pakai 1
 *   !heal <item_id> <jumlah>     → pakai beberapa (maks 10)
 *   !heal <item_id> max          → pakai sampai penuh / habis
 */

import { getPlayer, savePlayer, removeItem } from '../../lib/game/player.js';
import { getItem } from '../../lib/game/item.js';

// Sudah dicocokkan dengan lib/game/player.js:
// - getPlayer sinkron, removeItem mengembalikan true/false.
// - player.dungeon bernilai null saat tidak sedang dungeon.
// Kalau battle/PvP disimpan di modul lain, tambahkan pengecekannya di sini.
// Hapus `p.dungeon` jika pemain boleh heal di sela-sela room dungeon.
const isInBattle = p => Boolean(p.dungeon);

// Modifier yang berguna di luar battle
const OUT_OF_BATTLE_MODS = ['heal', 'mana_restore', 'cure_poison'];
const MAX_PER_USE = 10;   // maksimal pemakaian per perintah

const usableOutside = item =>
  item?.type === 'consumable' &&
  (item.modifiers || []).some(m => OUT_OF_BATTLE_MODS.includes(m.id));

const describeMod = mod => {
  if (mod.healAmount) return `+${mod.healAmount} HP`;
  if (mod.manaAmount) return `+${mod.manaAmount} Mana`;
  if (mod.curesPoison) return 'Cure Poison';
  return mod.name;
};

/** Terapkan satu kali pemakaian. Mengembalikan null jika tidak ada efek. */
function applyOnce(player, item) {
  let hp = 0, mana = 0, cured = false;

  for (const mod of item.modifiers || []) {
    if (mod.id === 'heal' && player.hp < player.maxHp) {
      const before = player.hp;
      player.hp = Math.min(player.maxHp, player.hp + mod.healAmount);
      hp += player.hp - before;
    }
    if (mod.id === 'mana_restore' && player.mana < player.maxMana) {
      const before = player.mana;
      player.mana = Math.min(player.maxMana, player.mana + mod.manaAmount);
      mana += player.mana - before;
    }
    if (mod.id === 'cure_poison' && player.statusEffects?.some(e => e.id === 'poison')) {
      player.statusEffects = player.statusEffects.filter(e => e.id !== 'poison');
      cured = true;
    }
  }

  return hp || mana || cured ? { hp, mana, cured } : null;
}

/** Alasan item tidak berguna saat ini. */
function uselessReason(item) {
  const r = [];
  if (item.modifiers.some(x => x.id === 'heal'))         r.push('HP sudah penuh');
  if (item.modifiers.some(x => x.id === 'mana_restore')) r.push('Mana sudah penuh');
  if (item.modifiers.some(x => x.id === 'cure_poison'))  r.push('kamu tidak keracunan');
  return r.join(' / ');
}

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);
  if (isInBattle(player)) return m.reply(`⚔️ Kamu sedang di dalam dungeon/battle. Gunakan *!use* di sana.`);
  if (player.hp <= 0) return m.reply(`💀 Kamu sedang tumbang. Pulihkan dulu lewat cara revive di game ini.`);

  // ── Daftar item ────────────────────────────────────────────────────────────
  if (!args[0]) {
    const slots = player.inventory.filter(s => usableOutside(getItem(s.itemId)));
    if (!slots.length) {
      return m.reply(
        `💊 Tidak ada item penyembuh di inventory.\n` +
        `Beli di *!shop* atau drop dari monster.`
      );
    }

    const lines = slots.map(slot => {
      const item = getItem(slot.itemId);
      const mods = (item.modifiers || []).map(describeMod).join(', ');
      return `  • *${item.name}* ×${slot.qty} — ${mods} (\`${item.id}\`)`;
    });

    return m.reply(
      `💊 *Item Penyembuh Kamu*\n\n` +
      lines.join('\n') +
      `\n\n❤️ HP: *${player.hp}/${player.maxHp}*\n` +
      `💙 Mana: *${player.mana}/${player.maxMana}*\n\n` +
      `Contoh:\n` +
      `• *!heal health_potion*\n` +
      `• *!heal health_potion 3*\n` +
      `• *!heal health_potion max*`
    );
  }

  // ── Parse argumen: <item_id> [jumlah|max] ──────────────────────────────────
  const itemId = args[0].toLowerCase();
  const qtyArg = args[1]?.toLowerCase();

  if (args.length > 2 || (qtyArg && !/^\d+$/.test(qtyArg) && qtyArg !== 'max' && qtyArg !== 'all')) {
    return m.reply(`❌ Format salah.\nContoh: *!heal health_potion 3* atau *!heal health_potion max*`);
  }

  const requested = !qtyArg ? 1
    : (qtyArg === 'max' || qtyArg === 'all') ? Infinity
    : Math.max(1, parseInt(qtyArg, 10));

  // ── Validasi item ──────────────────────────────────────────────────────────
  const item = getItem(itemId);
  if (!item) return m.reply(`❌ Item *${itemId}* tidak dikenal.`);
  if (!usableOutside(item)) return m.reply(`❌ *${item.name}* tidak bisa dipakai lewat !heal.`);

  const slot = player.inventory.find(s => s.itemId === itemId);
  if (!slot || slot.qty < 1) return m.reply(`❌ Kamu tidak punya *${item.name}*.`);

  const wanted = Math.min(requested, MAX_PER_USE, slot.qty);

  // ── Pakai item (berhenti begitu tidak ada efek lagi) ───────────────────────
  const total = { hp: 0, mana: 0, cured: false };
  let used = 0;

  for (let i = 0; i < wanted; i++) {
    const res = applyOnce(player, item);
    if (!res) break;
    used++;
    total.hp += res.hp;
    total.mana += res.mana;
    total.cured ||= res.cured;
  }

  if (used === 0) {
    return m.reply(`💡 *${item.name}* belum diperlukan: ${uselessReason(item)}.`);
  }

  // `used` sudah dibatasi slot.qty, jadi ini hanya pengaman tambahan.
  if (removeItem(player, itemId, used) === false) {
    return m.reply(`❌ Gagal memakai *${item.name}*, coba lagi.`);
  }
  await savePlayer(player);

  const results = [];
  if (total.hp)    results.push(`❤️ HP pulih *+${total.hp}* → *${player.hp}/${player.maxHp}*`);
  if (total.mana)  results.push(`💙 Mana pulih *+${total.mana}* → *${player.mana}/${player.maxMana}*`);
  if (total.cured) results.push(`✅ Racun *disembuhkan*!`);
  if (item.modifiers.some(x => x.id === 'atk_buff')) {
    results.push(`ℹ️ Buff ATK tidak aktif di luar battle.`);
  }

  return m.reply(
    `💊 Menggunakan *${item.name}* ×${used}\n\n` +
    results.join('\n')
  );
};

handler.help     = ['heal', 'heal <item_id> [jumlah|max]'];
handler.tags     = ['rpg'];
handler.command  = /^heal$/i;
handler.cooldown = 20;

export default handler;
