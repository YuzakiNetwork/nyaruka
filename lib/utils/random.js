/**
 * lib/utils/random.js
 * Pure random/math helpers used throughout the game.
 */

/**
 * Integer in [min, max] inclusive.
 */
export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Float in [min, max].
 */
export function randFloat(min, max) {
  return Math.random() * (max - min) + min;
}

/**
 * Boolean with probability p ∈ [0, 1].
 */
export function chance(p) {
  return Math.random() < p;
}

/**
 * Pick a random element from an array.
 */
export function pick(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Pick N unique elements from an array (no repeats).
 */
export function pickN(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, arr.length));
}

/**
 * Weighted random pick.
 * @param {Array<{value: any, weight: number}>} items
 */
export function weightedPick(items) {
  if (!items?.length) return undefined;
  const total = items.reduce((sum, i) => sum + (i.weight || 0), 0);
  if (total <= 0) return items[0]?.value ?? items[0];
  let r = Math.random() * total;
  for (const item of items) {
    r -= (item.weight || 0);
    if (r <= 0) {
      // Kalau item punya .value pakai itu, kalau tidak return item-nya sendiri
      return 'value' in item ? item.value : item;
    }
  }
  const last = items[items.length - 1];
  return 'value' in last ? last.value : last;
}

/**
 * Apply ±variance% random swing to a number.
 * e.g. applyVariance(100, 0.15) → anywhere from 85–115
 */
export function applyVariance(value, variance = 0.15) {
  const factor = 1 + randFloat(-variance, variance);
  return Math.max(1, Math.round(value * factor));
}

/**
 * Clamp a number between min and max.
 */
export function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

/**
 * Format a number with K/M suffix.
 */
export function formatNumber(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * Return a trend arrow based on price delta.
 */
export function trendArrow(current, base) {
  const delta = (current - base) / base;
  if (delta > 0.03) return '📈';
  if (delta < -0.03) return '📉';
  return '➡️';
}

export default {
  randInt, randFloat, chance, pick, pickN,
  weightedPick, applyVariance, clamp, formatNumber, trendArrow,
};
