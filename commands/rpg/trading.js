/**
 * commands/rpg/coin.js
 * Sistem trading koin: Sharkcoin & Harucoin.
 * Harga berubah otomatis tiap 10 menit (min 10g, maks 2000g per koin).
 *
 * Pemakaian:
 *   !coin                          — daftar harga koin
 *   !coin chart [koin]             — grafik harga
 *   !coin beli <koin> <jumlah|max> — beli koin dengan gold
 *   !coin jual <koin> <jumlah|all> — jual koin jadi gold
 *   !coin dompet                   — portofolio & untung/rugi
 *   !coin top                      — peringkat profit trader
 *
 * Cara kerja harga:
 *   Harga TIDAK memakai timer. Tiap kali ada yang memakai command ini, bot menghitung
 *   berapa "tick 10 menit" yang terlewat sejak update terakhir dan mensimulasikannya.
 *   Jadi harga tetap berjalan walau bot sempat mati / tidak ada yang membuka command.
 *   Tick selalu selaras dengan jam (xx:00, xx:10, xx:20, ...).
 */

import { getPlayer, savePlayer, getAllPlayers } from '../../lib/game/player.js';
import db from '../../lib/database/db.js';

// ── Konfigurasi umum ──────────────────────────────────────────────────────────
const MARKET_COL  = 'coinmarket';
const MARKET_ID   = 'coins';
const TICK_MS     = 10 * 60_000;   // harga berubah tiap 10 menit
const MIN_PRICE   = 10;            // harga minimum per koin (gold)
const MAX_PRICE   = 2000;          // harga maksimum per koin (gold)
const FEE_RATE    = 0.02;          // biaya transaksi 2% (beli & jual)
const HISTORY_MAX = 144;           // simpan 144 tick = 24 jam
const MAX_CATCHUP = 144;           // maks tick yang dikejar sekaligus (24 jam)

// ── Konfigurasi koin ──────────────────────────────────────────────────────────
//  CATATAN: key koin ('sharkcoin', 'harucoin') dipakai untuk menyimpan data pasar
//  dan dompet pemain di database. Jangan diganti lagi setelah bot berjalan.
//  Data koin lama (guracoin, winzzcoin) dihapus otomatis, lihat LEGACY_COIN_KEYS.
//
//  start       : harga awal saat pasar pertama kali dibuat
//  mean        : harga "rata-rata jangka panjang" (harga cenderung tertarik ke sini)
//  reversion   : kekuatan tarikan ke harga rata-rata per tick (0 = bebas liar)
//  vol         : volatilitas normal per tick (0.08 = sekitar ±8%)
//  eventChance : peluang lonjakan/anjlok mendadak per tick
const COINS = {
  sharkcoin: {
    name: 'Sharkcoin', symbol: 'SHARK', emoji: '🦈',
    aliases: ['shark', 'sc', 'sharkcoin'],
    start: 400, mean: 500, reversion: 0.030, vol: 0.08, eventChance: 0.04,
    desc: 'Relatif stabil, cocok untuk trader santai.',
  },
  harucoin: {
    name: 'Harucoin', symbol: 'HARU', emoji: '🚀',
    aliases: ['haru', 'hc', 'harucoin'],
    start: 250, mean: 400, reversion: 0.025, vol: 0.15, eventChance: 0.07,
    desc: 'Sangat liar. Untung besar atau rugi besar!',
  },
};

// Key koin lama yang dihapus dari pasar & dompet pemain secara otomatis
const LEGACY_COIN_KEYS = ['guracoin', 'winzzcoin'];

// ── Menu (muncul di bawah setiap balasan) ─────────────────────────────────────
const MENU =
  `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
  `📋 *MENU KOIN*\n` +
  `!coin — harga koin\n` +
  `!coin chart [koin] — grafik harga\n` +
  `!coin beli <koin> <jumlah|max>\n` +
  `!coin jual <koin> <jumlah|all>\n` +
  `!coin dompet — portofolio & profit\n` +
  `!coin top — peringkat profit\n` +
  `Koin: sharkcoin (shark), harucoin (haru)`;

// ── Util ──────────────────────────────────────────────────────────────────────
const fmt   = (n) => Number(n || 0).toLocaleString('id-ID');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const signed = (n) => (n >= 0 ? `+${fmt(n)}` : `-${fmt(Math.abs(n))}`);
const pctStr = (p) => `${p >= 0 ? '+' : '-'}${Math.abs(p).toFixed(1)}%`;

/** Aproksimasi distribusi normal (rata-rata 0, deviasi ~1). */
function gauss() {
  return (Math.random() + Math.random() + Math.random() - 1.5) / 0.5;
}

/** Cocokkan input pemain (nama, simbol, atau alias) ke key internal koin. */
function resolveCoin(str) {
  const s = String(str || '').toLowerCase().trim();
  if (!s) return null;
  for (const [key, cfg] of Object.entries(COINS)) {
    if (
      cfg.name.toLowerCase() === s ||
      cfg.symbol.toLowerCase() === s ||
      cfg.aliases.includes(s)
    ) return key;
  }
  return null;
}

/** Parse jumlah: "10", "1.000", "5k", "1.5k", "2m". Mengembalikan integer atau NaN. */
function parseAmount(str) {
  const s = String(str || '').toLowerCase().trim();
  const match = s.match(/^(\d+(?:[.,]\d+)?)([km]?)$/);
  if (!match) return NaN;
  const [, num, suffix] = match;
  if (suffix) {
    const mult = suffix === 'k' ? 1_000 : 1_000_000;
    return Math.floor(parseFloat(num.replace(',', '.')) * mult);
  }
  return parseInt(num.replace(/[.,]/g, ''), 10);   // titik/koma = pemisah ribuan
}

function sparkline(values) {
  if (!values.length) return '';
  const chars = '▁▂▃▄▅▆▇█';
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return chars[3].repeat(values.length);
  return values
    .map(v => chars[Math.round(((v - min) / (max - min)) * (chars.length - 1))])
    .join('');
}

function fmtCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return min > 0 ? `${min} menit ${sec} detik` : `${sec} detik`;
}

const alignTick = (t) => Math.floor(t / TICK_MS) * TICK_MS;

/** Teks rentang waktu dari jumlah titik riwayat (tiap titik = 10 menit). */
function fmtSpan(points) {
  const minutes = Math.max(0, (points - 1) * 10);
  if (minutes === 0) return 'baru dimulai';
  if (minutes < 60) return `${minutes} menit terakhir`;
  return `${Math.round((minutes / 60) * 10) / 10} jam terakhir`;
}

// ── Mesin harga ───────────────────────────────────────────────────────────────
function newCoinState(cfg) {
  return { price: cfg.start, prev: cfg.start, event: null, history: [cfg.start] };
}

function stepCoin(state, cfg) {
  state.prev = state.price;
  state.event = null;

  // Gerak acak (skala log) + tarikan ke harga rata-rata
  const pull = cfg.reversion * Math.log(cfg.mean / state.price);
  let change = cfg.vol * gauss() + pull;

  // Kejadian mendadak: lonjakan (pump) atau anjlok (crash) sekitar 15-40%
  if (Math.random() < cfg.eventChance) {
    const up = Math.random() < 0.5;
    change += (up ? 1 : -1) * (0.15 + Math.random() * 0.25);
    state.event = up ? 'pump' : 'crash';
  }

  change = clamp(change, -0.7, 0.5);
  state.price = clamp(Math.round(state.price * Math.exp(change)), MIN_PRICE, MAX_PRICE);

  state.history.push(state.price);
  if (state.history.length > HISTORY_MAX) state.history.shift();
}

/** Muat pasar, kejar tick yang terlewat, simpan bila berubah. */
async function getMarket() {
  let mk = db.getRecord(MARKET_COL, MARKET_ID);
  let dirty = false;
  const now = Date.now();

  if (!mk) {
    mk = { coins: {}, lastTick: alignTick(now), tickCount: 0, createdAt: now };
    dirty = true;
  }
  if (!mk.coins) { mk.coins = {}; dirty = true; }
  for (const old of LEGACY_COIN_KEYS) {
    if (mk.coins[old]) { delete mk.coins[old]; dirty = true; }
  }
  for (const [key, cfg] of Object.entries(COINS)) {
    if (!mk.coins[key]) { mk.coins[key] = newCoinState(cfg); dirty = true; }
  }

  let steps = 0;
  while (now - mk.lastTick >= TICK_MS && steps < MAX_CATCHUP) {
    for (const [key, cfg] of Object.entries(COINS)) stepCoin(mk.coins[key], cfg);
    mk.lastTick += TICK_MS;
    mk.tickCount = (mk.tickCount || 0) + 1;
    steps++;
    dirty = true;
  }
  // Tertinggal terlalu jauh (> 24 jam): lompat ke tick terkini
  if (now - mk.lastTick >= TICK_MS) {
    mk.lastTick = alignTick(now);
    dirty = true;
  }

  if (dirty) await db.setRecord(MARKET_COL, MARKET_ID, mk);
  return mk;
}

// ── Data player ───────────────────────────────────────────────────────────────
function getWallet(player) {
  if (!player.crypto || typeof player.crypto !== 'object') {
    player.crypto = { realizedPnl: 0, trades: 0 };
  }
  const w = player.crypto;
  w.realizedPnl = w.realizedPnl || 0;
  w.trades      = w.trades      || 0;
  for (const old of LEGACY_COIN_KEYS) delete w[old];
  for (const key of Object.keys(COINS)) {
    if (!w[key]) w[key] = { qty: 0, cost: 0 };
  }
  return w;
}

const buyCost = (qty, price) => {
  const gross = qty * price;
  const fee   = Math.ceil(gross * FEE_RATE);
  return { gross, fee, total: gross + fee };
};
const sellValue = (qty, price) => {
  const gross = qty * price;
  const fee   = Math.ceil(gross * FEE_RATE);
  return { gross, fee, net: Math.max(0, gross - fee) };
};

// ── Tampilan ──────────────────────────────────────────────────────────────────
function changeInfo(state) {
  const pct = state.prev > 0 ? ((state.price - state.prev) / state.prev) * 100 : 0;
  const icon = pct > 0.05 ? '📈' : pct < -0.05 ? '📉' : '➖';
  return { pct, icon };
}

function eventTag(state) {
  if (state.event === 'pump')  return ' 🔥 _Lonjakan mendadak!_';
  if (state.event === 'crash') return ' 💥 _Anjlok mendadak!_';
  return '';
}

function renderPrices(mk) {
  const lines = [`📊 *PASAR KOIN*`, `━━━━━━━━━━━━━━━━━━━━━━━━━`];
  for (const [key, cfg] of Object.entries(COINS)) {
    const st = mk.coins[key];
    const { pct, icon } = changeInfo(st);
    const hi = Math.max(...st.history);
    const lo = Math.min(...st.history);
    lines.push(
      `${cfg.emoji} *${cfg.name}* (${cfg.symbol})`,
      `   💰 *${fmt(st.price)}g* ${icon} ${pctStr(pct)} (dari ${fmt(st.prev)}g)${eventTag(st)}`,
      `   ${sparkline(st.history.slice(-12))}`,
      `   Tertinggi ${fmt(hi)}g | Terendah ${fmt(lo)}g _(${fmtSpan(st.history.length)})_`,
      `   _${cfg.desc}_`,
      ``
    );
  }
  lines.push(
    `⏰ Update harga berikutnya: *${fmtCountdown(mk.lastTick + TICK_MS - Date.now())}*`,
    `📏 Batas harga: ${fmt(MIN_PRICE)}g – ${fmt(MAX_PRICE)}g | Biaya transaksi: ${Math.round(FEE_RATE * 100)}%`
  );
  return lines.join('\n');
}

function renderChart(mk, key) {
  const cfg = COINS[key];
  const st  = mk.coins[key];
  const h   = st.history.slice(-36);
  const first = h[0];
  const pct = first > 0 ? ((st.price - first) / first) * 100 : 0;
  return (
    `${cfg.emoji} *${cfg.name}* (${cfg.symbol})\n` +
    `${sparkline(h)}\n` +
    `Rentang: ${fmtSpan(h.length)}\n` +
    `Sekarang: *${fmt(st.price)}g* (${pctStr(pct)} dari awal rentang)\n` +
    `Tertinggi: ${fmt(Math.max(...h))}g | Terendah: ${fmt(Math.min(...h))}g`
  );
}

// ── Handler ───────────────────────────────────────────────────────────────────
let handler = async (m, { args }) => {
  const reply = (text) => m.reply(`${text}\n\n${MENU}`);

  const player = getPlayer(m.sender);
  if (!player) return reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  const mk  = await getMarket();
  const sub = (args[0] || 'harga').toLowerCase();

  // ── harga ─────────────────────────────────────────────────────────────────
  if (['harga', 'price', 'list', 'pasar', 'market'].includes(sub)) {
    return reply(renderPrices(mk));
  }

  // ── chart ─────────────────────────────────────────────────────────────────
  if (['chart', 'grafik', 'graph'].includes(sub)) {
    if (args[1]) {
      const key = resolveCoin(args[1]);
      if (!key) return reply(`❌ Koin tidak dikenal. Pilih: *sharkcoin* atau *harucoin*.`);
      return reply(renderChart(mk, key));
    }
    return reply(Object.keys(COINS).map(k => renderChart(mk, k)).join('\n\n'));
  }

  // ── beli ──────────────────────────────────────────────────────────────────
  if (['beli', 'buy'].includes(sub)) {
    const key = resolveCoin(args[1]);
    if (!key) return reply(`Usage: *!coin beli <koin> <jumlah|max>*\nContoh: !coin beli shark 10`);

    const cfg   = COINS[key];
    const price = mk.coins[key].price;
    const gold  = player.gold || 0;
    const raw   = String(args[2] || '').toLowerCase();

    let qty;
    if (['max', 'all', 'semua'].includes(raw)) {
      qty = Math.floor(gold / (price * (1 + FEE_RATE)));
      while (qty > 0 && buyCost(qty, price).total > gold) qty--;
    } else {
      qty = parseAmount(raw);
    }

    if (!Number.isInteger(qty) || qty < 1) {
      if (['max', 'all', 'semua'].includes(raw)) {
        const min = buyCost(1, price).total;
        return reply(`❌ Gold tidak cukup. Untuk membeli 1 ${cfg.symbol} butuh *${fmt(min)}g*, gold kamu *${fmt(gold)}g*.`);
      }
      return reply(`❌ Jumlah tidak valid. Contoh: *!coin beli ${cfg.aliases[0]} 10* atau *max*`);
    }

    const { gross, fee, total } = buyCost(qty, price);
    if (total > gold) {
      return reply(
        `❌ Gold tidak cukup!\n` +
        `Beli ${fmt(qty)} ${cfg.symbol} butuh *${fmt(total)}g* (termasuk fee ${fmt(fee)}g).\n` +
        `Gold kamu: *${fmt(gold)}g*`
      );
    }

    const w = getWallet(player);
    player.gold -= total;
    w[key].qty  += qty;
    w[key].cost += total;
    w.trades    += 1;
    await savePlayer(player);

    return reply(
      `✅ *Pembelian Berhasil*\n\n` +
      `${cfg.emoji} ${fmt(qty)} *${cfg.symbol}* @ ${fmt(price)}g\n` +
      `💵 Harga: ${fmt(gross)}g\n` +
      `🧾 Fee ${Math.round(FEE_RATE * 100)}%: ${fmt(fee)}g\n` +
      `💸 Total bayar: *${fmt(total)}g*\n\n` +
      `📦 Kepemilikan: *${fmt(w[key].qty)} ${cfg.symbol}* (rata-rata beli ${fmt(Math.round(w[key].cost / w[key].qty))}g)\n` +
      `💰 Sisa gold: *${fmt(player.gold)}g*`
    );
  }

  // ── jual ──────────────────────────────────────────────────────────────────
  if (['jual', 'sell'].includes(sub)) {
    const key = resolveCoin(args[1]);
    if (!key) return reply(`Usage: *!coin jual <koin> <jumlah|all>*\nContoh: !coin jual shark all`);

    const cfg   = COINS[key];
    const price = mk.coins[key].price;
    const w     = getWallet(player);
    const held  = w[key].qty;

    if (held < 1) return reply(`❌ Kamu tidak punya *${cfg.name}*.`);

    const raw = String(args[2] || '').toLowerCase();
    const qty = ['all', 'max', 'semua'].includes(raw) ? held : parseAmount(raw);

    if (!Number.isInteger(qty) || qty < 1) {
      return reply(`❌ Jumlah tidak valid. Contoh: *!coin jual ${cfg.aliases[0]} 5* atau *all*`);
    }
    if (qty > held) {
      return reply(`❌ Koin tidak cukup! Kamu punya *${fmt(held)} ${cfg.symbol}*, ingin jual ${fmt(qty)}.`);
    }

    const { gross, fee, net } = sellValue(qty, price);
    const costPortion = qty === held ? w[key].cost : Math.round((w[key].cost * qty) / held);
    const pnl = net - costPortion;

    player.gold    = (player.gold || 0) + net;
    w[key].qty    -= qty;
    w[key].cost    = w[key].qty === 0 ? 0 : Math.max(0, w[key].cost - costPortion);
    w.realizedPnl += pnl;
    w.trades      += 1;
    await savePlayer(player);

    return reply(
      `✅ *Penjualan Berhasil*\n\n` +
      `${cfg.emoji} ${fmt(qty)} *${cfg.symbol}* @ ${fmt(price)}g\n` +
      `💵 Hasil kotor: ${fmt(gross)}g\n` +
      `🧾 Fee ${Math.round(FEE_RATE * 100)}%: ${fmt(fee)}g\n` +
      `💰 Diterima: *${fmt(net)}g*\n\n` +
      `${pnl >= 0 ? '🟢 Untung' : '🔴 Rugi'}: *${signed(pnl)}g* (modal ${fmt(costPortion)}g)\n` +
      `📦 Sisa ${cfg.symbol}: *${fmt(w[key].qty)}*\n` +
      `💰 Gold sekarang: *${fmt(player.gold)}g*`
    );
  }

  // ── dompet / portofolio ───────────────────────────────────────────────────
  if (['dompet', 'wallet', 'portfolio', 'pf', 'aset'].includes(sub)) {
    const w = getWallet(player);
    let totalValue = 0;
    let totalCost  = 0;
    const lines = [`💼 *PORTOFOLIO ${player.name}*`, `━━━━━━━━━━━━━━━━━━━━━━━━━`];

    for (const [key, cfg] of Object.entries(COINS)) {
      const { qty, cost } = w[key];
      const price = mk.coins[key].price;
      const value = qty * price;
      totalValue += value;
      totalCost  += cost;

      if (qty < 1) {
        lines.push(`${cfg.emoji} *${cfg.name}*: 0 ${cfg.symbol} _(harga ${fmt(price)}g)_`, ``);
        continue;
      }
      const unreal = value - cost;
      const unrealPct = cost > 0 ? (unreal / cost) * 100 : 0;
      lines.push(
        `${cfg.emoji} *${cfg.name}*: ${fmt(qty)} ${cfg.symbol}`,
        `   Rata-rata beli: ${fmt(Math.round(cost / qty))}g | Harga kini: ${fmt(price)}g`,
        `   Nilai: *${fmt(value)}g*`,
        `   ${unreal >= 0 ? '🟢' : '🔴'} ${signed(unreal)}g (${pctStr(unrealPct)})`,
        ``
      );
    }

    const totalUnreal = totalValue - totalCost;
    lines.push(
      `📦 Total nilai koin: *${fmt(totalValue)}g*`,
      `${totalUnreal >= 0 ? '🟢' : '🔴'} Untung/rugi belum terealisasi: *${signed(totalUnreal)}g*`,
      `${w.realizedPnl >= 0 ? '🟢' : '🔴'} Profit terealisasi: *${signed(w.realizedPnl)}g*`,
      `🔁 Total transaksi: ${fmt(w.trades)}`,
      `💰 Gold: *${fmt(player.gold)}g*`,
      ``,
      `_Nilai koin dihitung dari harga pasar, belum dipotong fee jual._`
    );
    return reply(lines.join('\n'));
  }

  // ── top ───────────────────────────────────────────────────────────────────
  if (['top', 'rank', 'peringkat', 'leaderboard'].includes(sub)) {
    const traders = getAllPlayers()
      .filter(p => p.crypto && (p.crypto.trades || 0) > 0)
      .sort((a, b) => (b.crypto.realizedPnl || 0) - (a.crypto.realizedPnl || 0))
      .slice(0, 10);

    if (!traders.length) return reply(`🏆 Belum ada trader. Jadilah yang pertama dengan *!coin beli*!`);

    const medals = ['🥇', '🥈', '🥉'];
    const rows = traders.map((p, i) =>
      `${medals[i] || `${i + 1}.`} *${p.name}* — ${signed(p.crypto.realizedPnl || 0)}g (${fmt(p.crypto.trades)} transaksi)`
    );
    return reply(`🏆 *TOP TRADER* _(profit terealisasi)_\n\n${rows.join('\n')}`);
  }

  return reply(renderPrices(mk));
};

handler.help     = ['coin', 'coin chart', 'coin beli <koin> <jumlah>', 'coin jual <koin> <jumlah>', 'coin dompet', 'coin top'];
handler.tags     = ['rpg'];
handler.command  = /^(coin|koin|crypto|trading)$/i;
handler.cooldown = 3;
export default handler;
