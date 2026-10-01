/**
 * commands/owner/filemanager.js
 * Owner file management — remove, save, get file di server.
 *
 * Usage:
 *   !removefile <path>              → hapus file/folder di server
 *   !savefile <path> <isi>          → buat/timpa file dengan konten
 *   !getfile <path>                 → kirim konten file sebagai pesan
 *   !listfiles [path]               → list isi direktori
 *   !appendfile <path> <isi>        → append ke file yang ada
 *   !movefile <from> <to>           → rename/pindah file
 *   !statfile <path>                → info file (size, modified, dll)
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../lib/utils/logger.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const BOT_ROOT   = path.resolve(__dirname, '../..');

// Batasi akses hanya dalam direktori bot (keamanan)
function safePath(inputPath) {
  // Resolve relatif terhadap root bot
  const resolved = path.resolve(BOT_ROOT, inputPath.replace(/^\/+/, ''));
  // Pastikan masih dalam root bot
  if (!resolved.startsWith(BOT_ROOT)) {
    throw new Error(`Akses ditolak: path di luar direktori bot`);
  }
  return resolved;
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
    const inputPath = args.join(' ');
    if (!inputPath) return m.reply(`Usage: *!removefile <path>*\nContoh: !removefile logs/old.log`);

    let fp;
    try { fp = safePath(inputPath); } catch (e) { return m.reply(`🚫 ${e.message}`); }

    if (!fs.existsSync(fp)) return m.reply(`❌ File tidak ditemukan: \`${inputPath}\``);

    const stat = fs.statSync(fp);
    const isDir = stat.isDirectory();

    try {
      fs.rmSync(fp, { recursive: true, force: true });
      logger.warn({ path: fp, isDir }, '🗑️  File removed by owner');
      return m.reply(
        `✅ *Berhasil dihapus!*\n\n` +
        `📄 ${isDir ? 'Folder' : 'File'}: \`${inputPath}\`\n` +
        `📦 Ukuran: ${fmtSize(stat.size)}`
      );
    } catch (err) {
      return m.reply(`❌ Gagal hapus: ${err.message}`);
    }
  }

  // ── !savefile <path> <konten> ─────────────────────────────────────────────
  if (command === 'savefile' || command === 'writefile' || command === 'mkfile') {
    // Format: !savefile path/to/file.js konten...
    if (args.length < 2) return m.reply(
      `Usage: *!savefile <path> <konten>*\n` +
      `Contoh: !savefile test/hello.txt Hello World!`
    );

    const filePath = args[0];
    const content  = args.slice(1).join(' ')
      // Support \\n sebagai newline
      .replace(/\\n/g, '\n')
      // Support code block dari WA (strip backticks)
      .replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');

    let fp;
    try { fp = safePath(filePath); } catch (e) { return m.reply(`🚫 ${e.message}`); }

    try {
      // Buat direktori jika belum ada
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, content, 'utf8');
      logger.info({ path: fp, bytes: content.length }, '💾 File saved by owner');
      return m.reply(
        `✅ *File disimpan!*\n\n` +
        `📄 Path: \`${filePath}\`\n` +
        `📦 Size: ${fmtSize(Buffer.byteLength(content))}\n` +
        `📝 Lines: ${content.split('\n').length}`
      );
    } catch (err) {
      return m.reply(`❌ Gagal simpan: ${err.message}`);
    }
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
          const s = fs.statSync(path.join(fp, e.name));
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
    if (args.length < 2) return m.reply(`Usage: *!appendfile <path> <konten>*`);
    const filePath = args[0];
    const content  = '\n' + args.slice(1).join(' ').replace(/\\n/g, '\n');

    let fp;
    try { fp = safePath(filePath); } catch (e) { return m.reply(`🚫 ${e.message}`); }

    try {
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.appendFileSync(fp, content, 'utf8');
      const size = fs.statSync(fp).size;
      return m.reply(`✅ Appended ke \`${filePath}\` | Total size: ${fmtSize(size)}`);
    } catch (err) {
      return m.reply(`❌ Gagal append: ${err.message}`);
    }
  }

  // ── !movefile <from> <to> ─────────────────────────────────────────────────
  if (command === 'movefile' || command === 'mvfile') {
    if (args.length < 2) return m.reply(`Usage: *!movefile <from> <to>*`);
    const [from, to] = [args[0], args[1]];

    let fpFrom, fpTo;
    try {
      fpFrom = safePath(from);
      fpTo   = safePath(to);
    } catch (e) { return m.reply(`🚫 ${e.message}`); }

    if (!fs.existsSync(fpFrom)) return m.reply(`❌ File tidak ditemukan: \`${from}\``);

    try {
      fs.mkdirSync(path.dirname(fpTo), { recursive: true });
      fs.renameSync(fpFrom, fpTo);
      return m.reply(`✅ Pindah: \`${from}\` → \`${to}\``);
    } catch (err) {
      return m.reply(`❌ Gagal pindah: ${err.message}`);
    }
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
  'removefile <path>',
  'savefile <path> <konten>',
  'getfile <path>',
  'listfiles [path]',
  'appendfile <path> <konten>',
  'movefile <from> <to>',
  'statfile <path>',
];
handler.tags      = ['owner'];
handler.command   = /^(removefile|rmfile|delfile|savefile|writefile|mkfile|getfile|readfile|catfile|listfiles|ls|lsfile|appendfile|movefile|mvfile|statfile|fileinfo)$/i;
handler.ownerOnly = true;
handler.cooldown  = 2;

export default handler;
