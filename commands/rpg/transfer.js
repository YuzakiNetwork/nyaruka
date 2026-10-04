/**
 * commands/rpg/transfer.js
 * Transfer gold dan item ke player lain.
 *
 * Pemakaian:
 *   !transfer gold @user <jumlah>          — kirim gold (mendukung 5k, 1.5k, 2m, 10.000)
 *   !transfer item @user <item> [jumlah]   — kirim item (id atau nama, jumlah bisa "all")
 *   !transfer confirm                      — konfirmasi transfer bernilai besar
 *   !transfer batal                        — batalkan transfer yang menunggu konfirmasi
 *
 * Contoh:
 *   !transfer gold @budi 2500
 *   !transfer item @budi health_potion 5
 *   !transfer item @budi iron sword
 */

import { getPlayer, savePlayer, addItem, removeItem } from '../../lib/game/player.js';
import { getItem, formatItem }                        from '../../lib/game/item.js';
import { normalizeJid }                               from '../../handler/index.js';
import { logger }                                     from '../../lib/utils/logger.js';

// ── Konfigurasi ───────────────────────────────────────────────────────────────
const GOLD_TAX       = 0;        // pajak transfer gold (0.05 = 5%). 0 = tanpa pajak
const CONFIRM_GOLD   = 5000;     // transfer gold >= ini butuh konfirmasi
const CONFIRM_RARITY = new Set(['Epic', 'Legendary', 'Mythic']);  // item rarity ini butuh konfirmasi
const CONFIRM_EXPIRE = 60_000;   // konfirmasi berlaku 60 detik

// senderId -> { spec, targetId, expiresAt, timer }
const pendingTransfers = new Map();

// ── Util ──────────────────────────────────────────────────────────────────────
const fmt = (n) => Number(n || 0).toLocaleString('id-ID');

function getMentioned(m) {
  const jids = m.raw?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  return jids[0] ? normalizeJid(jids[0]) : null;
}

/** Parse jumlah: "2500", "10.000", "5k", "1.5k", "2m". Mengembalikan integer atau NaN. */
function parseAmount(str) {
  const s = String(str || '').toLowerCase().trim();
  const match = s.match(/^(\d+(?:[.,]\d+)?)([km]?)$/);
  if (!match) return NaN;
  const [, num, suffix] = match;
  if (suffix) {
    const mult = suffix === 'k' ? 1_000 : 1_000_000;
    return Math.floor(parseFloat(num.replace(',', '.')) * mult);
  }
  // Tanpa suffix: titik/koma dianggap pemisah ribuan ("10.000")
  return parseInt(num.replace(/[.,]/g, ''), 10);
}

function clearPending(senderId) {
  const p = pendingTransfers.get(senderId);
  if (p) clearTimeout(p.timer);
  pendingTransfers.delete(senderId);
}

/** Cari slot inventory berdasarkan id atau nama (exact dulu, lalu partial yang unik). */
function findInventorySlot(player, query) {
  const q = query.toLowerCase().trim();
  const qId = q.replace(/\s+/g, '_');
  const inv = player.inventory || [];

  const exact = inv.find(s => {
    const it = getItem(s.itemId);
    return s.itemId === qId || it?.name.toLowerCase() === q;
  });
  if (exact) return { slot: exact };

  const partial = inv.filter(s => {
    const it = getItem(s.itemId);
    return s.itemId.includes(qId) || it?.name.toLowerCase().includes(q);
  });
  if (partial.length === 1) return { slot: partial[0] };
  if (partial.length > 1) {
    return { ambiguous: partial.map(s => getItem(s.itemId)?.name || s.itemId) };
  }
  return {};
}

/** Validasi transfer. Mengembalikan pesan error atau null jika valid. */
function validate(sender, target, spec) {
  if (sender.dungeon) return `❌ Kamu sedang berada di dungeon. Selesaikan dulu sebelum transfer.`;
  if (target.dungeon) return `❌ *${target.name}* sedang berada di dungeon. Coba lagi nanti.`;

  if (spec.type === 'gold') {
    if (!Number.isInteger(spec.amount) || spec.amount < 1) return `❌ Jumlah gold tidak valid.`;
    if ((sender.gold || 0) < spec.amount) {
      return `❌ Gold tidak cukup!\nKamu punya *${fmt(sender.gold)}g*, ingin kirim *${fmt(spec.amount)}g*.`;
    }
    return null;
  }

  // item
  const slot = (sender.inventory || []).find(s => s.itemId === spec.itemId);
  if (!slot || slot.qty < spec.qty) {
    return `❌ Item tidak cukup di inventory!\nKamu punya *${slot?.qty || 0}*, ingin kirim *${spec.qty}*.`;
  }

  // Cegah duplikasi bonus: item yang sedang dipakai tidak boleh dikirim jika habis dari inventory
  const equipped = Object.values(sender.equipment || {}).includes(spec.itemId);
  if (equipped && slot.qty - spec.qty < 1) {
    return `❌ *${getItem(spec.itemId)?.name || spec.itemId}* sedang kamu pakai. Lepas dulu sebelum mengirimnya.`;
  }
  return null;
}

function needsConfirm(spec) {
  if (spec.type === 'gold') return spec.amount >= CONFIRM_GOLD;
  const item = getItem(spec.itemId);
  return item ? CONFIRM_RARITY.has(item.rarity) : false;
}

function describe(spec) {
  if (spec.type === 'gold') return `💰 *${fmt(spec.amount)}g*`;
  return formatItem(spec.itemId, spec.qty);
}

/** Jalankan transfer: mutasi, simpan, rollback jika gagal simpan. */
async function executeTransfer(sender, target, spec, sock) {
  const err = validate(sender, target, spec);
  if (err) return err;

  let received = 0;
  let durability = 100;

  // — mutasi —
  if (spec.type === 'gold') {
    const tax = Math.floor(spec.amount * GOLD_TAX);
    received = spec.amount - tax;
    sender.gold -= spec.amount;
    target.gold  = (target.gold || 0) + received;
  } else {
    const slot = sender.inventory.find(s => s.itemId === spec.itemId);
    durability = slot.durability ?? 100;
    removeItem(sender, spec.itemId, spec.qty);
    addItem(target, spec.itemId, spec.qty, durability);
  }

  // — simpan (dengan rollback bila gagal) —
  try {
    await savePlayer(sender);
    await savePlayer(target);
  } catch (e) {
    logger.error({ err: e?.message, from: sender.id, to: target.id, spec }, 'Transfer gagal, rollback');
    if (spec.type === 'gold') {
      sender.gold += spec.amount;
      target.gold -= received;
    } else {
      removeItem(target, spec.itemId, spec.qty);
      addItem(sender, spec.itemId, spec.qty, durability);
    }
    try { await savePlayer(sender); await savePlayer(target); } catch {}
    return `❌ Transfer gagal karena kesalahan penyimpanan. Tidak ada yang berubah, coba lagi.`;
  }

  logger.info(
    { from: sender.id, to: target.id, type: spec.type, amount: spec.amount, itemId: spec.itemId, qty: spec.qty, received },
    'Transfer berhasil'
  );

  // — notifikasi ke penerima (DM, boleh gagal) —
  try {
    await sock?.sendMessage(target.id, {
      text:
        `🎁 *Kamu menerima kiriman!*\n\n` +
        `Dari: *${sender.name}*\n` +
        (spec.type === 'gold'
          ? `💰 *${fmt(received)}g*\n\nGold kamu sekarang: *${fmt(target.gold)}g*`
          : `${formatItem(spec.itemId, spec.qty)}\n\nCek dengan *!inventory*`),
    });
  } catch {}

  if (spec.type === 'gold') {
    const taxLine = GOLD_TAX > 0
      ? `\n🧾 Pajak ${Math.round(GOLD_TAX * 100)}%: -${fmt(spec.amount - received)}g (diterima *${fmt(received)}g*)`
      : '';
    return (
      `✅ *Transfer berhasil!*\n\n` +
      `💰 *${fmt(spec.amount)}g* → *${target.name}*${taxLine}\n` +
      `Sisa gold kamu: *${fmt(sender.gold)}g*`
    );
  }
  return (
    `✅ *Transfer berhasil!*\n\n` +
    `${formatItem(spec.itemId, spec.qty)} → *${target.name}*`
  );
}

// ── Handler ───────────────────────────────────────────────────────────────────
let handler = async (m, { args, sock }) => {
  const sender = getPlayer(m.sender);
  if (!sender) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  const sub = args[0]?.toLowerCase();

  // ── confirm ───────────────────────────────────────────────────────────────
  if (sub === 'confirm' || sub === 'konfirmasi' || sub === 'ya') {
    const pending = pendingTransfers.get(m.sender);
    if (!pending || Date.now() > pending.expiresAt) {
      clearPending(m.sender);
      return m.reply(`❌ Tidak ada transfer yang menunggu konfirmasi (atau sudah kedaluwarsa).`);
    }
    clearPending(m.sender);

    const target = getPlayer(pending.targetId);
    if (!target) return m.reply(`❌ Penerima tidak ditemukan.`);
    return m.reply(await executeTransfer(sender, target, pending.spec, sock));
  }

  // ── batal ─────────────────────────────────────────────────────────────────
  if (sub === 'batal' || sub === 'cancel' || sub === 'tidak') {
    if (!pendingTransfers.has(m.sender)) return m.reply(`❌ Tidak ada transfer yang menunggu konfirmasi.`);
    clearPending(m.sender);
    return m.reply(`✋ Transfer dibatalkan.`);
  }

  // ── bantuan ───────────────────────────────────────────────────────────────
  if (sub !== 'gold' && sub !== 'item' && sub !== 'barang' && sub !== 'koin') {
    return m.reply(
      `🎁 *Transfer*\n\n` +
      `*!transfer gold @user <jumlah>*\n` +
      `   Contoh: !transfer gold @budi 2500 / 5k / 1.5k\n\n` +
      `*!transfer item @user <item> [jumlah]*\n` +
      `   Contoh: !transfer item @budi health_potion 5\n` +
      `   Contoh: !transfer item @budi iron sword\n\n` +
      `Transfer bernilai besar (≥ ${fmt(CONFIRM_GOLD)}g atau item Epic ke atas) perlu konfirmasi: *!transfer confirm*\n` +
      `Transfer tidak bisa dibatalkan setelah berhasil, pastikan penerimanya benar.`
    );
  }

  // ── tentukan penerima ─────────────────────────────────────────────────────
  const targetId = getMentioned(m);
  if (!targetId) return m.reply(`❌ Tag penerimanya. Contoh: *!transfer ${sub} @user ...*`);
  if (targetId === m.sender) return m.reply(`❌ Tidak bisa transfer ke diri sendiri.`);

  const target = getPlayer(targetId);
  if (!target) return m.reply(`❌ Penerima belum terdaftar di game.`);

  // Argumen tanpa mention (@...)
  const rest = args.slice(1).filter(a => !a.startsWith('@'));

  // ── bangun spec transfer ──────────────────────────────────────────────────
  let spec;

  if (sub === 'gold' || sub === 'koin') {
    const amount = parseAmount(rest[0]);
    if (!Number.isInteger(amount) || amount < 1) {
      return m.reply(`❌ Jumlah tidak valid. Contoh: *!transfer gold @user 2500*`);
    }
    spec = { type: 'gold', amount };
  } else {
    if (!rest.length) {
      return m.reply(`❌ Sebutkan itemnya. Contoh: *!transfer item @user health_potion 5*`);
    }

    // Token terakhir dianggap jumlah jika angka / "all"
    let qtyToken = null;
    let nameTokens = rest;
    if (rest.length > 1 && /^(\d+|all|semua)$/i.test(rest[rest.length - 1])) {
      qtyToken = rest[rest.length - 1].toLowerCase();
      nameTokens = rest.slice(0, -1);
    }

    const found = findInventorySlot(sender, nameTokens.join(' '));
    if (found.ambiguous) {
      return m.reply(
        `❓ Nama item ambigu, maksudmu yang mana?\n` +
        found.ambiguous.map(n => `• ${n}`).join('\n') +
        `\n\nGunakan nama atau id yang lebih lengkap.`
      );
    }
    if (!found.slot) return m.reply(`❌ Item tidak ditemukan di inventory-mu.`);

    let qty = 1;
    if (qtyToken === 'all' || qtyToken === 'semua') qty = found.slot.qty;
    else if (qtyToken) qty = parseInt(qtyToken, 10);

    if (!Number.isInteger(qty) || qty < 1) return m.reply(`❌ Jumlah item tidak valid.`);
    spec = { type: 'item', itemId: found.slot.itemId, qty };
  }

  // ── validasi awal ─────────────────────────────────────────────────────────
  const err = validate(sender, target, spec);
  if (err) return m.reply(err);

  // ── butuh konfirmasi? ─────────────────────────────────────────────────────
  if (needsConfirm(spec)) {
    clearPending(m.sender);
    const timer = setTimeout(() => pendingTransfers.delete(m.sender), CONFIRM_EXPIRE);
    pendingTransfers.set(m.sender, {
      spec, targetId, expiresAt: Date.now() + CONFIRM_EXPIRE, timer,
    });
    return m.reply(
      `⚠️ *Konfirmasi Transfer*\n\n` +
      `Kirim ${describe(spec)} ke *${target.name}* [Lv.${target.level}]?\n\n` +
      `Ketik *!transfer confirm* untuk melanjutkan atau *!transfer batal*.\n` +
      `⏰ Berlaku 60 detik`
    );
  }

  return m.reply(await executeTransfer(sender, target, spec, sock));
};

handler.help     = ['transfer gold @user <jumlah>', 'transfer item @user <item> [jumlah]'];
handler.tags     = ['rpg'];
handler.command  = /^(transfer|tf|kirim)$/i;
handler.cooldown = 5;
export default handler;
