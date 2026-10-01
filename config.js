/**
 * config.js
 * Global configuration dengan MongoDB support
 */

import 'dotenv/config';

function parseList(envVal, suffix = '') {
  return (envVal || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => suffix && !s.endsWith(suffix) ? `${s}${suffix}` : s);
}

// ── Owner ID sets ─────────────────────────────────────────────────────────────
// WhatsApp kini pakai DUA format ID secara bersamaan:
//   @s.whatsapp.net  — nomor WA lama, masih ada tapi makin jarang di grup
//   @lid             — Linked Device ID, format baru, permanen
//
// Kita simpan keduanya dan cek keduanya saat isOwner().
const ownerNumbers = parseList(process.env.BOT_OWNER_NUMBER, '@s.whatsapp.net');
const ownerLids    = parseList(process.env.BOT_OWNER_LID, '@lid');

// Backward compat: BOT_OWNER (format lama) → masuk ke ownerNumbers
const legacyOwners = parseList(process.env.BOT_OWNER, '@s.whatsapp.net');
for (const jid of legacyOwners) {
  if (!ownerNumbers.includes(jid)) ownerNumbers.push(jid);
}

// Set gabungan untuk lookup O(1)
const _ownerSet = new Set([...ownerNumbers, ...ownerLids]);

/**
 * Cek apakah sebuah JID adalah owner.
 * Handle semua format: @s.whatsapp.net, @lid, angka saja.
 */
export function isOwner(jid) {
  if (!jid) return false;
  if (_ownerSet.has(jid)) return true;

  // Coba match angka saja (tanpa suffix)
  const num = jid.split('@')[0];
  for (const o of _ownerSet) {
    if (o.split('@')[0] === num) return true;
  }
  return false;
}

export const config = {
  bot: {
    name:        process.env.BOT_NAME    || 'Haruka Fuyune',
    prefix:      process.env.BOT_PREFIX  || '!',  // default prefix
    prefixes:    process.env.BOT_PREFIXES?.split(',') || ['!', '.', '/', '#', '>', '+'],  // multi-prefix
    number:      process.env.BOT_NUMBER  || '',
    sessionName: process.env.SESSION_NAME || 'session',
    ownerNumber: process.env.BOT_OWNER_NUMBER || process.env.BOT_OWNER_LID || '',
  },

  db: {
    type: process.env.DB_TYPE || (process.env.MONGO_URI ? 'mongodb' : 'json'),
    // MongoDB config
    mongoUri:  process.env.MONGO_URI || '',
    mongoDb:   process.env.MONGO_DB  || 'fuyune',
    // JSON fallback (jika MongoDB off)
    path: process.env.DB_PATH || './data',
  },

  rpg: {
    classes: {
      Warrior:  { hp: 150, mana: 60,  attack: 18, defense: 15, speed: 10, description: '⚔️ Tank. HP & DEF tinggi.' },
      Mage:     { hp: 80,  mana: 200, attack: 25, defense: 6,  speed: 12, description: '🔮 Mage. Mana & ATK magic tinggi.' },
      Archer:   { hp: 100, mana: 80,  attack: 22, defense: 8,  speed: 20, description: '🏹 Hunter. Speed & range tinggi.' },
      Assassin: { hp: 90,  mana: 100, attack: 28, defense: 7,  speed: 25, description: '🗡️ Striker. ATK & crit tertinggi.' },
      Summoner: { hp: 85,  mana: 180, attack: 20, defense: 9,  speed: 15, description: '🎴 Summoner. Panggil summon lewat gacha!' },
    },
    critChanceBase:  0.1,
    missChanceBase:  0.05,
    damageVariance:  0.1,
    elementChart: {
      fire:    { water: 0.5, earth: 1.5, fire: 0.8, wind: 1.0 },
      water:   { fire: 1.5,  earth: 0.8, water: 0.5, wind: 1.0 },
      earth:   { fire: 0.8,  water: 1.5, earth: 0.8, wind: 1.2 },
      wind:    { fire: 1.2,  water: 1.0, earth: 0.8, wind: 0.5 },
      light:   { dark: 1.5,  light: 0.5 },
      dark:    { light: 1.5, dark: 0.5 },
      neutral: {},
    },
    baseExpPerLevel: 100,
    expScalingFactor: 1.15,
    maxLevel: 100,
  },

  cooldowns: {
    battle:  parseInt(process.env.BATTLE_COOLDOWN) || 3,
    dungeon: parseInt(process.env.DUNGEON_COOLDOWN) || 3,
    shop:    parseInt(process.env.SHOP_COOLDOWN) || 3,
  },

  donate: {
    enabled:       process.env.DONATE_ENABLED === 'true' || false,
    apiKey:        process.env.TRAKTEER_API_KEY || '',
    pollInterval:  parseInt(process.env.TRAKTEER_POLL_INTERVAL) || 30000,
    notifyTargets: process.env.DONATE_NOTIFY?.split(',') || [],
  },

  log: {
    level: process.env.LOG_LEVEL || 'info',
  },

  economy: {
    tickInterval:      parseInt(process.env.ECONOMY_TICK_INTERVAL) || 5,
    priceFloor:        parseFloat(process.env.PRICE_FLOOR) || 0.3,
    priceCap:          parseFloat(process.env.PRICE_CAP) || 3.0,
    shopSellRatio:     parseFloat(process.env.SHOP_SELL_RATIO) || 0.6,
    demandDecayRate:   parseFloat(process.env.DEMAND_DECAY_RATE) || 0.1,
    meanReversionRate: parseFloat(process.env.PRICE_MEAN_REVERSION_RATE) || 0.02,
    volatilityBase:    parseFloat(process.env.PRICE_VOLATILITY_BASE) || 0.05,
  },
};

export function loadConfig() {
  return config;
}

export default config;
