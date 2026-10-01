/**
 * commands/owner/filemanager.js
 * Owner file management — temporarily read-only due to path-based TOCTOU risk.
 *
 * Usage:
 *   !getfile <path>                 → kirim konten file sebagai pesan
 *   !listfiles [path]               → list isi direktori
 *   !statfile <path>                → info file (size, modified, dll)
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const BOT_ROOT   = path.resolve(__dirname, '../..');
const BOT_ROOT_REAL = fs.realpathSync(BOT_ROOT);

// Batasi akses hanya dalam direktori bot (keamanan)
function safePath(inputPath) {
  let normalizedInput;
  try {
    normalizedInput = path.normalize(decodeURIComponent(inputPath));
  } catch {
    throw new Error('Akses ditolak: path tidak valid');
  }

  const resolved = path.resolve(BOT_ROOT_REAL, normalizedInput);
  const isWithinRoot = candidate => {
    const relative = path.relative(BOT_ROOT_REAL, candidate);
    return relative === '' || (
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  };

  if (!isWithinRoot(resolved)) {
    throw new Error(`Akses ditolak: path di luar direktori bot`);
  }

  // Resolve existing symlinks, including the nearest existing parent for new files.
  let current = resolved;
  const missing = [];
  while (true) {
    let exists = true;
    try {
      fs.lstatSync(current);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      exists = false;
    }

    if (exists) {
      let realCurrent;
      try {
        realCurrent = fs.realpathSync(current);
      } catch {
        throw new Error('Akses ditolak: symlink/path tidak valid');
      }
      const canonical = path.resolve(realCurrent, ...missing);
      if (!isWithinRoot(canonical)) {
        throw new Error(`Akses ditolak: path di luar direktori bot`);
      }
      return canonical;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Akses ditolak: path di luar direktori bot`);
    }
    missing.unshift(path.basename(current));
    current = parent;
  }
}

function fmtSize(bytes) {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1048576)    return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1048576).toFixed(1)} MB`;
}

function fmtDate(date) {
  return new Date(date).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
}

let handler = async (m, { args, command, sock }) => {

  // ── !removefile <path> ────────────────────────────────────────────────────
  if (command === 'removefile' || command === 'rmfile' || command === 'delfile') {
    return m.reply('🚫 Perintah removefile sementara dinonaktifkan demi keamanan; tidak ada file yang diubah.');
  }

  // ── !savefile <path> <konten> ─────────────────────────────────────────────
  if (command === 'savefile' || command === 'writefile' || command === 'mkfile') {
    return m.reply('🚫 File manager sementara hanya-baca; operasi tulis file dinonaktifkan demi keamanan.');
  }

  // ── !getfile <path> ───────────────────────────────────────────────────────
  if (command === 'getfile' || command === 'readfile' || command === 'catfile') {
    const filePath = args.join(' ');
    if (!filePath) return m.reply(`Usage: *!getfile <path>*\nContoh: !getfile .env`);

    let fp;
    try { fp = safePath(filePath); } catch (e) { return m.reply(`🚫 ${e.message}`); }

    if (!fs.existsSync(fp)) return m.reply(`❌ File tidak ditemukan: \`${filePath}\``);

    const stat = fs.statSync(fp);
    if (stat.isDirectory()) return m.reply(`❌ Itu direktori, bukan file. Gunakan *!listfiles ${filePath}*`);
    if (stat.size > 100_000) return m.reply(`❌ File terlalu besar (${fmtSize(stat.size)}). Max 100KB.`);

    try {
      const content  = fs.readFileSync(fp, 'utf8');
      const lines    = content.split('\n').length;
      const preview  = content.length > 3500
        ? content.slice(0, 3500) + '\n...[truncated]'
        : content;

      return m.reply(
        `📄 *${filePath}*\n` +
        `${fmtSize(stat.size)} | ${lines} baris | ${fmtDate(stat.mtime)}\n` +
        `\`\`\`\n${preview}\n\`\`\``
      );
    } catch (err) {
      return m.reply(`❌ Gagal baca: ${err.message}`);
    }
  }

  // ── !listfiles [path] ─────────────────────────────────────────────────────
  if (command === 'listfiles' || command === 'ls' || command === 'lsfile') {
    const dirPath = args.join(' ') || '.';

    let fp;
    try { fp = safePath(dirPath); } catch (e) { return m.reply(`🚫 ${e.message}`); }

    if (!fs.existsSync(fp)) return m.reply(`❌ Path tidak ditemukan: \`${dirPath}\``);

    const stat = fs.statSync(fp);
    if (!stat.isDirectory()) return m.reply(`❌ Itu file, bukan folder. Gunakan *!getfile ${dirPath}*`);

    try {
      const entries = fs.readdirSync(fp, { withFileTypes: true })
        .sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      if (!entries.length) return m.reply(`📂 \`${dirPath}\` — _kosong_`);

      const lines = entries.slice(0, 50).map(e => {
        if (e.isDirectory()) return `📁 ${e.name}/`;
        try {
          const s = fs.lstatSync(path.join(fp, e.name));
          return `📄 ${e.name} (${fmtSize(s.size)})`;
        } catch { return `📄 ${e.name}`; }
      });

      const extra = entries.length > 50 ? `\n...dan ${entries.length - 50} lainnya` : '';
      return m.reply(
        `📂 *${dirPath}/*\n` +
        `${entries.length} items\n\n` +
        lines.join('\n') + extra
      );
    } catch (err) {
      return m.reply(`❌ Gagal list: ${err.message}`);
    }
  }

  // ── !appendfile <path> <konten> ───────────────────────────────────────────
  if (command === 'appendfile') {
    return m.reply('🚫 File manager sementara hanya-baca; operasi tulis file dinonaktifkan demi keamanan.');
  }

  // ── !movefile <from> <to> ─────────────────────────────────────────────────
  if (command === 'movefile' || command === 'mvfile') {
    return m.reply('🚫 File manager sementara hanya-baca; operasi pindah file dinonaktifkan demi keamanan.');
  }

  // ── !statfile <path> ──────────────────────────────────────────────────────
  if (command === 'statfile' || command === 'fileinfo') {
    const filePath = args.join(' ');
    if (!filePath) return m.reply(`Usage: *!statfile <path>*`);

    let fp;
    try { fp = safePath(filePath); } catch (e) { return m.reply(`🚫 ${e.message}`); }

    if (!fs.existsSync(fp)) return m.reply(`❌ Tidak ditemukan: \`${filePath}\``);

    const stat = fs.statSync(fp);
    return m.reply(
      `📊 *File Info: ${filePath}*\n\n` +
      `Type:     ${stat.isDirectory() ? '📁 Direktori' : '📄 File'}\n` +
      `Size:     ${fmtSize(stat.size)}\n` +
      `Created:  ${fmtDate(stat.birthtime)}\n` +
      `Modified: ${fmtDate(stat.mtime)}\n` +
      `Accessed: ${fmtDate(stat.atime)}\n` +
      `Mode:     ${stat.mode.toString(8)}`
    );
  }
};

handler.help      = [
  'getfile <path>',
  'listfiles [path]',
  'statfile <path>',
];
handler.tags      = ['owner'];
handler.command   = /^(removefile|rmfile|delfile|savefile|writefile|mkfile|getfile|readfile|catfile|listfiles|ls|lsfile|appendfile|movefile|mvfile|statfile|fileinfo)$/i;
handler.ownerOnly = true;
handler.cooldown  = 2;

export default handler;
