/**
 * commands/owner/exec.js
 * Jalankan shell command di server — owner only.
 * Usage: !exec <command>
 *
 * PERINGATAN: Akses penuh ke sistem. Hanya untuk owner terpercaya.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

let handler = async (m, { args }) => {
  const cmd = args.join(' ');
  if (!cmd) return m.reply(`Usage: *!exec <command>*\nContoh: !exec ls -la`);

  // Blacklist command berbahaya
  const BLOCKED = ['rm -rf /', 'mkfs', ':(){:|:&};:', 'dd if=/dev/zero'];
  if (BLOCKED.some(b => cmd.includes(b))) {
    return m.reply(`🚫 Command ini diblokir demi keamanan.`);
  }

  await m.reply(`⚙️ Menjalankan: \`${cmd}\`...`);

  const start = Date.now();
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: 15_000,    // max 15 detik
      maxBuffer: 1024 * 512,  // 512KB output max
    });

    const ms     = Date.now() - start;
    const out    = (stdout || '').trim();
    const err    = (stderr || '').trim();
    const output = [out, err ? `[stderr]\n${err}` : ''].filter(Boolean).join('\n');
    const trunc  = output.length > 3000 ? output.slice(0, 3000) + '\n...[truncated]' : output;

    return m.reply(
      `✅ *Exec Done* (${ms}ms)\n\`\`\`\n${trunc || '(no output)'}\n\`\`\``
    );
  } catch (err) {
    const ms = Date.now() - start;
    const msg = err.killed ? 'Process killed (timeout 15s)' : err.message;
    return m.reply(`❌ *Exec Error* (${ms}ms)\n\`\`\`\n${msg}\n\`\`\``);
  }
};

handler.help      = ['exec <command>'];
handler.tags      = ['owner'];
handler.command   = /^(exec|shell|cmd|sh)$/i;
handler.ownerOnly = true;
handler.cooldown  = 5;

export default handler;
