/**
 * lib/utils/cooldown.js
 * Enhanced cooldown manager with spam protection
 * - Command cooldown yang lebih lama
 * - Cooldown message throttle (10 detik sekali)
 */

const _store = new Map();  // key: `${userId}:${command}` → timestamp
const _lastWarning = new Map();  // key: `${userId}:${command}` → last warning timestamp

/**
 * Check if a user is on cooldown for a command.
 * @returns {{ onCooldown: boolean, remaining: number, showMessage: boolean }}
 */
export function checkCooldown(userId, command, seconds) {
  const key  = `${userId}:${command}`;
  const last = _store.get(key);
  if (!last) return { onCooldown: false, remaining: 0, showMessage: false };

  const elapsed   = (Date.now() - last) / 1000;
  const remaining = Math.ceil(seconds - elapsed);

  if (remaining > 0) {
    // Cek apakah boleh show warning message
    const lastWarn = _lastWarning.get(key) || 0;
    const sinceWarn = (Date.now() - lastWarn) / 1000;
    const showMessage = sinceWarn >= 10;  // 10 detik throttle

    if (showMessage) {
      _lastWarning.set(key, Date.now());
    }

    return { onCooldown: true, remaining, showMessage };
  }

  _store.delete(key);
  _lastWarning.delete(key);
  return { onCooldown: false, remaining: 0, showMessage: false };
}

/**
 * Set the cooldown for a user+command NOW.
 */
export function setCooldown(userId, command) {
  _store.set(`${userId}:${command}`, Date.now());
  // Reset warning counter saat command berhasil dijalankan
  _lastWarning.delete(`${userId}:${command}`);
}

/**
 * Forcibly clear a cooldown (e.g., after owner override).
 */
export function clearCooldown(userId, command) {
  _store.delete(`${userId}:${command}`);
  _lastWarning.delete(`${userId}:${command}`);
}

/**
 * Returns remaining seconds or 0.
 */
export function getRemaining(userId, command, seconds) {
  const { remaining } = checkCooldown(userId, command, seconds);
  return remaining;
}

export default { checkCooldown, setCooldown, clearCooldown, getRemaining };
