/**
 * lib/utils/ratelimit.js
 * Global rate limiter untuk mencegah abuse
 * Limit: max 20 command per menit per user
 */

const _commandCount = new Map();  // userId → { count, resetAt }
const MAX_COMMANDS_PER_MINUTE = 20;
const WINDOW_MS = 60 * 1000;  // 1 menit

export function checkRateLimit(userId) {
  const now = Date.now();
  const data = _commandCount.get(userId);

  // Reset jika window sudah lewat
  if (!data || now > data.resetAt) {
    _commandCount.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return { limited: false, remaining: MAX_COMMANDS_PER_MINUTE - 1 };
  }

  // Cek apakah sudah exceed
  if (data.count >= MAX_COMMANDS_PER_MINUTE) {
    const waitSeconds = Math.ceil((data.resetAt - now) / 1000);
    return { limited: true, remaining: 0, waitSeconds };
  }

  // Increment count
  data.count += 1;
  return { limited: false, remaining: MAX_COMMANDS_PER_MINUTE - data.count };
}

export function resetRateLimit(userId) {
  _commandCount.delete(userId);
}

export default { checkRateLimit, resetRateLimit };
