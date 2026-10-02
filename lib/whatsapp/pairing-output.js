export function writePairingCodeToTerminal(code, { stdout = process.stdout } = {}) {
  if (typeof code !== 'string' || !code || stdout?.isTTY !== true || typeof stdout.write !== 'function') {
    return false;
  }

  const formatted = code.match(/.{1,4}/g)?.join('-') ?? code;
  stdout.write([
    '',
    '\x1b[33m╔════════════════════════════════════════╗',
    '║        🔑  PAIRING CODE BOT             ║',
    '╠════════════════════════════════════════╣',
    '║                                        ║',
    `║      \x1b[1m\x1b[37m${formatted}\x1b[0m\x1b[33m                     ║`,
    '║                                        ║',
    '║  1. Buka WhatsApp di HP                ║',
    '║  2. Setelan → Perangkat Tertaut        ║',
    '║  3. Tautkan Perangkat                  ║',
    '║  4. Tautkan dengan nomor telepon       ║',
    `║  5. Masukkan: \x1b[1m\x1b[37m${formatted}\x1b[0m\x1b[33m               ║`,
    '╚════════════════════════════════════════╝\x1b[0m',
    '',
  ].join('\n'));
  return true;
}
