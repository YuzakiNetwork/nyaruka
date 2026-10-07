/**
 * commands/rpg/heal.js
 * Gunakan item konsumabel dari inventory di luar battle.
 *
 * Usage:
 *   !heal                        → daftar item
 *   !heal <item>                 → pakai 1
 *   !heal <item> <jumlah>        → pakai beberapa (maks 10 per perintah)
 *   !heal <item> max             → pakai sampai penuh / stok habis
 *
 * <item> boleh berupa:
 *   - ID lengkap        : health_potion
 *   - Singkatan         : hp, mega, mp, anti, eop ...
 *   - Inisial otomatis  : gme (greater_mana_elixir)
 *   - Awalan / sebagian : health, mana, hyper ...
 *   - Format kurung     : hp(health_potion)
 *   - Nama dengan spasi : mega potion
 */

import { getPlayer, savePlayer, removeItem } from '../../lib/game/player.js';
import { ITEMS, getItem } from '../../lib/game/item.js';

// Kalau battle/PvP disimpan di modul lain, tambahkan pengecekannya di sini.
// Hapus `p.dungeon` jika pemain boleh heal di sela-sela room dungeon.
const isInBattle = p => Boolean(p.dungeon);

// Modifier yang berguna di luar battle
const OUT_OF_BATTLE_MODS = ['heal', 'mana_restore', 'cure_poison'];
const MAX_PER_USE = 10;    // batas untuk jumlah angka, mis. !heal hp 5
const MAX_PER_MAX = 100;   // batas pengaman untuk mode max

// ── Singkatan manual (prioritas tertinggi setelah ID persis) ─────────────────
// Tambah sendiri di sini kalau mau singkatan baru.
const ALIASES = {
  hp:     'health_potion',
  hpot:   'health_potion',
  mega:   'mega_potion',
  mp:     'mana_elixir',          // mp = mana point
  mana:   'mana_elixir',
  me:     'mana_elixir',
  eop:    'elixir_of_power',
  power:  'elixir_of_power',
  anti:   'antidote',
  sp:     'super_potion',
  hyper:  'hyper_potion',
  gme:    'greater_mana_elixir',
};

// ── Util item ────────────────────────────────────────────────────────────────
const usableOutside = item =>
  item?.type === 'consumable' &&
  (item.modifiers || []).some(m => OUT_OF_BATTLE_MODS.includes(m.id));

const describeMod = mod => {
  if (mod.healAmount) return `+${mod.healAmount} HP`;
  if (mod.manaAmount) return `+${mod.manaAmount} Mana`;
  if (mod.curesPoison) return 'Cure Poison';
  return mod.name;
};

const normalize = s => String(s || '')
  .toLowerCase()
  .replace(/['’]/g, '')
  .replace(/[\s\-]+/g, '_')
  .replace(/^_+|_+$/g, '');

const initials = id => id.split('_').map(w => w[0]).join('');

const stockOf = (player, itemId) =>
  (player.inventory || []).find(s => s.itemId === itemId)?.qty || 0;

/** Singkatan terpendek untuk ditampilkan di daftar. */
function shortcutOf(itemId) {
  const alias = Object.entries(ALIASES).find(([, id]) => id === itemId)?.[0];
  return alias || itemId;
}

// ── Pencarian item dari singkatan ────────────────────────────────────────────
function lookup(q, player) {
  if (!q) return {};

  // 1. ID persis
  if (ITEMS[q]) return { item: ITEMS[q] };

  // 2. Singkatan manual
  if (ALIASES[q] && ITEMS[ALIASES[q]]) return { item: ITEMS[ALIASES[q]] };

  // 3. Nama persis (mis. "mega potion")
  const byName = Object.values(ITEMS).find(i => normalize(i.name) === q);
  if (byName) return { item: byName };

  // 4. Tebakan otomatis di antara item yang bisa dipakai lewat !heal
  const candidates = Object.values(ITEMS).filter(usableOutside);

  let matches = candidates.filter(i =>
    initials(i.id) === q ||
    i.id.startsWith(q) ||
    normalize(i.name).startsWith(q)
  );
  if (!matches.length && q.length >= 2) {
    matches = candidates.filter(i => i.id.includes(q) || normalize(i.name).includes(q));
  }

  if (matches.length === 1) return { item: matches[0] };
  if (matches.length > 1) {
    // Utamakan yang ada di inventory pemain
    const owned = matches.filter(i => stockOf(player, i.id) > 0);
    if (owned.length === 1) return { item: owned[0] };
    return { ambiguous: owned.length > 1 ? owned : matches };
  }
  return {};
}

/** Terima juga format kurung: hp(health_potion). */
function resolveItem(query, player) {
  const raw = normalize(query);
  const paren = raw.match(/^([^()]+?)_?\(([^()]+)\)$/);
  const tries = paren ? [normalize(paren[2]), normalize(paren[1])] : [raw];

  for (const q of tries) {
    const res = lookup(q, player);
    if (res.item || res.ambiguous) return res;
  }
  return {};
}

// ── Efek item ────────────────────────────────────────────────────────────────
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

// ── Tampilan ─────────────────────────────────────────────────────────────────
/**
 * Bar tiga segmen:
 *   █ = nilai lama   ▓ = tambahan dari item   ░ = kosong
 */
function gainBar(before, after, max, len = 12) {
  const ratio = v => (max > 0 ? Math.min(Math.max(v / max, 0), 1) : 0);
  const old   = Math.round(ratio(before) * len);
  const now   = Math.round(ratio(after) * len);
  const gain  = Math.max(0, now - old);
  return '█'.repeat(old) + '▓'.repeat(gain) + '░'.repeat(len - old - gain);
}

function hpMood(pct) {
  if (pct >= 100) return '💖';
  if (pct >= 70)  return '💚';
  if (pct >= 40)  return '💛';
  return '🧡';
}

/** Blok tampilan satu stat: `20 (+10) ➜ 30/100` + bar. */
function vitalBlock({ icon, label, before, gain, after, max, wasted, stockOut }) {
  const pct = max > 0 ? Math.round((after / max) * 100) : 0;
  const lines = [
    `${icon} *${label}*`,
    `   ${before} (+${gain}) ➜ *${after}*/${max}`,
    `   ${gainBar(before, after, max)} ${pct}%`,
  ];

  if (after >= max) {
    lines.push(`   ${hpMood(100)} *Penuh!*`);
  } else {
    lines.push(`   ${hpMood(pct)} Kurang *${max - after}* lagi untuk penuh`);
  }
  if (wasted > 0)  lines.push(`   🗑️ Kelebihan ${wasted} terbuang`);
  if (stockOut)    lines.push(`   📦 Stok habis, beli lagi di *!shop*`);
  return lines.join('\n');
}

// ── Handler ──────────────────────────────────────────────────────────────────
let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);
  if (isInBattle(player)) return m.reply(`⚔️ Kamu sedang di dalam dungeon/battle. Gunakan *!use* di sana.`);
  if (player.hp <= 0) return m.reply(`💀 Kamu sedang tumbang. Pulihkan dulu lewat cara revive di game ini.`);

  // ── Daftar item ────────────────────────────────────────────────────────────
  if (!args[0]) {
    const slots = (player.inventory || []).filter(s => usableOutside(getItem(s.itemId)));
    if (!slots.length) {
      return m.reply(
        `💊 Tidak ada item penyembuh di inventory.\n` +
        `Beli di *!shop* atau drop dari monster.`
      );
    }

    const lines = slots.map(slot => {
      const item = getItem(slot.itemId);
      const mods = (item.modifiers || []).map(describeMod).join(', ');
      return `  • *${item.name}* ×${slot.qty} — ${mods}\n      ➜ *!heal ${shortcutOf(item.id)}*`;
    });

    return m.reply(
      `💊 *Item Penyembuh Kamu*\n\n` +
      lines.join('\n') +
      `\n\n❤️ HP: *${player.hp}/${player.maxHp}*\n` +
      `💙 Mana: *${player.mana}/${player.maxMana}*\n\n` +
      `Contoh:\n` +
      `• *!heal hp*  (pakai 1)\n` +
      `• *!heal hp 3*\n` +
      `• *!heal hp max*  (sampai penuh / stok habis)`
    );
  }

  // ── Parse argumen: <item...> [jumlah|max] ──────────────────────────────────
  let qtyArg;
  let nameParts = args;
  const last = args[args.length - 1].toLowerCase();
  if (args.length > 1 && (/^\d+$/.test(last) || last === 'max' || last === 'all')) {
    qtyArg    = last;
    nameParts = args.slice(0, -1);
  }
  const query = nameParts.join(' ');

  const isMax     = qtyArg === 'max' || qtyArg === 'all';
  const requested = !qtyArg ? 1 : isMax ? Infinity : Math.max(1, parseInt(qtyArg, 10));

  // ── Cari item (termasuk singkatan) ─────────────────────────────────────────
  const found = resolveItem(query, player);

  if (found.ambiguous) {
    const opts = found.ambiguous.map(i => {
      const have = stockOf(player, i.id);
      return `  • *${i.name}* — *!heal ${shortcutOf(i.id)}*${have ? ` (punya ×${have})` : ''}`;
    });
    return m.reply(`🤔 *${query}* bisa berarti beberapa item. Maksudmu yang mana?\n\n${opts.join('\n')}`);
  }

  const item = found.item;
  if (!item) {
    return m.reply(`❌ Item *${query}* tidak dikenal.\nKetik *!heal* untuk melihat item penyembuhmu.`);
  }
  if (!usableOutside(item)) return m.reply(`❌ *${item.name}* tidak bisa dipakai lewat !heal.`);

  const slot = (player.inventory || []).find(s => s.itemId === item.id);
  if (!slot || slot.qty < 1) return m.reply(`❌ Kamu tidak punya *${item.name}*.`);

  const stockBefore = slot.qty;
  const cap         = isMax ? MAX_PER_MAX : MAX_PER_USE;
  const wanted      = Math.min(requested, cap, stockBefore);

  // ── Pakai item (berhenti begitu tidak ada efek lagi) ───────────────────────
  const before = { hp: player.hp, mana: player.mana };
  const total  = { hp: 0, mana: 0, cured: false };
  let used = 0;

  for (let i = 0; i < wanted; i++) {
    const res = applyOnce(player, item);
    if (!res) break;
    used++;
    total.hp   += res.hp;
    total.mana += res.mana;
    total.cured ||= res.cured;
  }

  if (used === 0) {
    return m.reply(`💡 *${item.name}* belum diperlukan: ${uselessReason(item)}.`);
  }

  // `used` sudah dibatasi stok, jadi ini hanya pengaman tambahan.
  if (removeItem(player, item.id, used) === false) {
    return m.reply(`❌ Gagal memakai *${item.name}*, coba lagi.`);
  }
  await savePlayer(player);

  const left = stockOf(player, item.id);

  // ── Susun tampilan ─────────────────────────────────────────────────────────
  const healPer = (item.modifiers || []).find(x => x.id === 'heal')?.healAmount || 0;
  const manaPer = (item.modifiers || []).find(x => x.id === 'mana_restore')?.manaAmount || 0;
  const usedAll = used === stockBefore;

  const blocks = [];

  if (total.hp) {
    blocks.push(vitalBlock({
      icon: '❤️', label: 'HP',
      before: before.hp, gain: total.hp, after: player.hp, max: player.maxHp,
      wasted: Math.max(0, healPer * used - total.hp),
      stockOut: isMax && usedAll && player.hp < player.maxHp,
    }));
  }
  if (total.mana) {
    blocks.push(vitalBlock({
      icon: '💙', label: 'Mana',
      before: before.mana, gain: total.mana, after: player.mana, max: player.maxMana,
      wasted: Math.max(0, manaPer * used - total.mana),
      stockOut: isMax && usedAll && player.mana < player.maxMana,
    }));
  }
  if (total.cured) blocks.push(`✅ *Racun disembuhkan!*`);
  if (item.modifiers.some(x => x.id === 'atk_buff')) {
    blocks.push(`ℹ️ Buff ATK tidak aktif di luar battle.`);
  }

  const recognized = normalize(query) !== item.id
    ? `🔎 _"${query}" dikenali sebagai ${item.name}_\n`
    : '';
  const capNote = !isMax && requested !== Infinity && requested > MAX_PER_USE
    ? `\nℹ️ Maksimal ${MAX_PER_USE} item per perintah.`
    : '';

  return m.reply(
    `🧪 *ITEM DIPAKAI*\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    recognized +
    `${item.emoji || '🧴'} *${item.name}* ×${used}\n` +
    `📦 Sisa stok: *${left}*\n\n` +
    blocks.join('\n\n') +
    `\n\n_█ lama  ▓ tambahan  ░ kosong_` +
    capNote
  );
};

handler.help     = ['heal', 'heal <item> [jumlah|max]'];
handler.tags     = ['rpg'];
handler.command  = /^heal$/i;
handler.cooldown = 20;

export default handler;
