/**
 * lib/utils/banner.js
 * Terminal launch banner — ASCII art bergaya isekai/fantasy
 */

// ── ANSI color codes ──────────────────────────────────────────────────────────
const C = {
  reset:    '\x1b[0m',
  bold:     '\x1b[1m',
  dim:      '\x1b[2m',
  blink:    '\x1b[5m',

  black:    '\x1b[30m',
  red:      '\x1b[31m',
  green:    '\x1b[32m',
  yellow:   '\x1b[33m',
  blue:     '\x1b[34m',
  magenta:  '\x1b[35m',
  cyan:     '\x1b[36m',
  white:    '\x1b[37m',
  gray:     '\x1b[90m',

  bgBlack:  '\x1b[40m',
  bgRed:    '\x1b[41m',
  bgBlue:   '\x1b[44m',
  bgCyan:   '\x1b[46m',
};

const G  = C.bold + C.green;     // Gold text
const Y  = C.bold + C.yellow;    // Yellow
const Cy = C.bold + C.cyan;      // Cyan
const Mg = C.bold + C.magenta;   // Magenta
const Wh = C.bold + C.white;     // White
const Gr = C.gray;               // Gray dim
const Re = C.reset;

// ── ASCII Art Title ───────────────────────────────────────────────────────────
const TITLE_ART = [
  `${Y}  ██████╗ ██████╗  ██████╗     ██████╗  ██████╗ ████████╗${Re}`,
  `${Y}  ██╔══██╗██╔══██╗██╔════╝     ██╔══██╗██╔═══██╗╚══██╔══╝${Re}`,
  `${Y}  ██████╔╝██████╔╝██║  ███╗    ██████╔╝██║   ██║   ██║   ${Re}`,
  `${Y}  ██╔══██╗██╔═══╝ ██║   ██║    ██╔══██╗██║   ██║   ██║   ${Re}`,
  `${Y}  ██║  ██║██║     ╚██████╔╝    ██████╔╝╚██████╔╝   ██║   ${Re}`,
  `${Y}  ╚═╝  ╚═╝╚═╝      ╚═════╝     ╚═════╝  ╚═════╝    ╚═╝   ${Re}`,
];

const SUBTITLE = `${Cy}  ⚔️  WhatsApp Fantasy RPG Bot  ⚔️  — Isekai Edition${Re}`;

// ── Decorative border ─────────────────────────────────────────────────────────
function border(char = '═', len = 56, color = Y) {
  return color + char.repeat(len) + Re;
}

function centerPad(text, totalWidth = 56) {
  // Strip ANSI codes untuk hitung panjang teks asli
  const stripped = text.replace(/\x1b\[[0-9;]*m/g, '');
  const padLen   = Math.max(0, Math.floor((totalWidth - stripped.length) / 2));
  return ' '.repeat(padLen) + text;
}

function row(content, color = Wh) {
  const stripped = content.replace(/\x1b\[[0-9;]*m/g, '');
  const rightPad = Math.max(0, 54 - stripped.length);
  return `${Y}║${Re} ${color}${content}${Re}${' '.repeat(rightPad)} ${Y}║${Re}`;
}

function emptyRow() {
  return `${Y}║${Re}${' '.repeat(56)}${Y}║${Re}`;
}

// ── Splash animasi sederhana (tanpa library) ───────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Main banner function ──────────────────────────────────────────────────────
export async function printBanner(info = {}) {
  const {
    version       = '1.0.0',
    prefix        = '!',
    ownerNumber   = 'Unknown',
    totalCommands = 0,
    dbPath        = './data',
    logLevel      = 'info',
    donateEnabled = false,
    apiKey        = '',
  } = info;

  // Clear screen
  process.stdout.write('\x1b[2J\x1b[0f');

  // ── Header ──────────────────────────────────────────────────────────────
  await sleep(80);
  console.log('');
  console.log(border('═', 58, Y));
  await sleep(60);

  for (const line of TITLE_ART) {
    console.log(line);
    await sleep(40);
  }

  await sleep(80);
  console.log('');
  console.log(centerPad(SUBTITLE, 70));
  await sleep(60);
  console.log('');
  console.log(border('═', 58, Y));
  await sleep(100);

  // ── Info Box ─────────────────────────────────────────────────────────────
  console.log('');
  console.log(`${Y}  ╔${'═'.repeat(54)}╗${Re}`);
  console.log(emptyRow());
  await sleep(50);

  // Tagline animasi
  const tagline = `✨  "Petualanganmu di Dunia Lain Dimulai..."  ✨`;
  console.log(row(centerPad(Mg + tagline + Re, 75)));
  await sleep(80);

  console.log(emptyRow());
  console.log(`${Y}  ╠${'═'.repeat(54)}╣${Re}`);
  await sleep(50);

  // Bot Info
  const infoLines = [
    [`🤖 Version`,   `v${version}`],
    [`🎮 Prefix`,    `"${prefix}"`],
    [`📋 Commands`,  `${totalCommands} commands loaded`],
    [`👑 Owner`,     ownerNumber || 'Belum diset (.env)'],
    [`💾 Database`,  dbPath],
    [`📝 Log Level`, logLevel.toUpperCase()],
    [`💝 Donate`,    donateEnabled && apiKey ? `✅ Trakteer API Aktif` : `❌ Nonaktif`],
  ];

  for (const [label, value] of infoLines) {
    const line = `${Cy}${label.padEnd(14)}${Re} ${Gr}│${Re} ${Wh}${value}${Re}`;
    console.log(row(line));
    await sleep(40);
  }

  console.log(`${Y}  ╠${'═'.repeat(54)}╣${Re}`);
  await sleep(50);

  // Features
  console.log(row(`${Y}  ⚔️  FITUR AKTIF${Re}`));
  await sleep(30);

  const features = [
    `${G}✓${Re} Job Advancement (Tier 1-4)   ${G}✓${Re} World Boss System`,
    `${G}✓${Re} Pet & Familiar System        ${G}✓${Re} Guild System`,
    `${G}✓${Re} Awakening & Reincarnation    ${G}✓${Re} Zone/Map System`,
    `${G}✓${Re} Title & Achievement          ${G}✓${Re} Story Mode (5 Bab)`,
    `${G}✓${Re} Party System                 ${G}✓${Re} Hot-reload Commands`,
  ];

  for (const feat of features) {
    console.log(row(`  ${feat}`));
    await sleep(35);
  }

  console.log(`${Y}  ╠${'═'.repeat(54)}╣${Re}`);
  await sleep(50);

  // Status loading bar simulasi
  const stages = [
    ['💾 Database',    '✅'],
    ['📦 Commands',    '✅'],
    ['🌍 Economy',     '✅'],
    ['⏰ Cron Jobs',   '⏳'],
    ['📡 WhatsApp',    '⏳'],
  ];

  console.log(row(`${Cy}  🚀 Initializing...${Re}`));
  await sleep(40);

  for (const [label, icon] of stages) {
    const bar  = '█'.repeat(Math.floor(Math.random() * 6) + 10);
    const line = `  ${label.padEnd(16)} ${Gr}[${G}${bar}${Gr}]${Re} ${icon}`;
    console.log(row(line));
    await sleep(80);
  }

  console.log(emptyRow());
  console.log(`${Y}  ╚${'═'.repeat(54)}╝${Re}`);
  await sleep(100);

  // ── Footer ────────────────────────────────────────────────────────────────
  console.log('');
  console.log(border('─', 58, Gr));

  const footerLines = [
    `${Gr}  🕒 Started : ${Re}${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false })}`,
    `${Gr}  💻 Node.js : ${Re}${process.version}   ${Gr}Platform: ${Re}${process.platform}`,
    `${Gr}  📌 Session : ${Re}Menunggu pairing...`,
  ];

  for (const line of footerLines) {
    console.log(line);
    await sleep(40);
  }

  console.log(border('─', 58, Gr));
  console.log('');

  // ── Quote ─────────────────────────────────────────────────────────────────
  const quotes = [
    `"${Mg}Kekuatan sejati bukan dari level, tapi dari tekad.${Re}"`,
    `"${Mg}Di dunia lain ini, petualanganmu baru saja dimulai.${Re}"`,
    `"${Mg}Setiap monster yang kau kalahkan membuatmu selangkah lebih kuat.${Re}"`,
    `"${Mg}Tidak ada yang tidak mungkin bagi Yang Terpilih.${Re}"`,
    `"${Mg}Jalan menuju Awakening penuh darah dan keringat.${Re}"`,
  ];

  const quote = quotes[Math.floor(Math.random() * quotes.length)];
  console.log(`  ${Cy}✨${Re} ${quote}`);
  console.log('');

  await sleep(150);

  // ── Connecting message ─────────────────────────────────────────────────────
  console.log(`${Y}  ⚡ Menghubungkan ke WhatsApp...${Re}`);
  console.log(`${Gr}  (Jika pertama kali, masukkan kode pairing yang akan muncul)${Re}`);
  console.log('');
}

// ── Connected banner ──────────────────────────────────────────────────────────
export function printConnected(botName = 'RPG Bot') {
  console.log('');
  console.log(`${G}  ╔${'═'.repeat(40)}╗${Re}`);
  console.log(`${G}  ║  ✅  WHATSAPP CONNECTED!            ║${Re}`);
  console.log(`${G}  ║                                      ║${Re}`);
  console.log(`${G}  ║  🤖 ${Wh}${botName.padEnd(34)}${G}║${Re}`);
  console.log(`${G}  ║  🎮 ${Wh}Bot RPG siap menerima perintah!  ${G}║${Re}`);
  console.log(`${G}  ║  💡 ${Wh}Kirim !help untuk mulai          ${G}║${Re}`);
  console.log(`${G}  ╚${'═'.repeat(40)}╝${Re}`);
  console.log('');
}

// ── Disconnected / Reconnecting ───────────────────────────────────────────────
export function printReconnecting(attempt = 1) {
  const dots = '●'.repeat(Math.min(attempt, 5)) + '○'.repeat(Math.max(0, 5 - attempt));
  console.log(`${Y}  ⚠️  Terputus — Reconnecting... [${dots}] Attempt #${attempt}${Re}`);
}

export default { printBanner, printConnected, printReconnecting };
