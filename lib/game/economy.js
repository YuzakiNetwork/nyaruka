/**
 * lib/game/economy.js
 * Dynamic supply-demand economy engine.
 *
 * ── Algorithm explanation ──────────────────────────────────────────────────
 *
 * Each item has:
 *   basePrice     — the "true" equilibrium price
 *   currentPrice  — live price (drifts from base via supply/demand)
 *   demand        — 0.0–5.0, how much players are buying
 *   supply        — 0.0–5.0, how much players are selling
 *   volatility    — 0.0–1.0, how fast price moves (Mythic = 0.9, Common = 0.1)
 *
 * ON BUY:
 *   demand += demandImpact
 *   recalcPrice()
 *
 * ON SELL:
 *   supply += supplyImpact
 *   recalcPrice()
 *
 * TICK (every N minutes):
 *   demand × decayRate (mean reversion)
 *   supply × decayRate
 *   price drifts back toward basePrice at reversionRate
 *
 * PRICE FORMULA:
 *   pressureRatio = (demand + 1) / (supply + 1)
 *   delta = (pressureRatio - 1) × volatility
 *   currentPrice = basePrice × clamp(1 + delta, floorMult, capMult)
 *
 * WORLD EVENTS add a global multiplier layer on top.
 */

import db from '../database/db.js';
import { clamp, trendArrow, randInt, chance, pick, weightedPick } from '../utils/random.js';
import { config } from '../../config.js';
import { ITEMS, RARITY_PRICE_MULT } from './item.js';
import { logger } from '../utils/logger.js';

const ECONOMY_COL  = 'economy';
const WORLD_COL    = 'world';

// ── Economy item schema ───────────────────────────────────────────────────────
// {
//   itemId        : string
//   basePrice     : number
//   currentPrice  : number
//   demand        : number  (0–5)
//   supply        : number  (0–5)
//   volatility    : number  (0.05–0.9)
//   lastUpdated   : number  (timestamp)
//   history       : number[] (last 5 prices for trend)
// }

// Volatility per rarity
const VOLATILITY_MAP = {
  Common:    0.08,
  Rare:      0.18,
  Epic:      0.35,
  Legendary: 0.60,
  Mythic:    0.90,
};

// How much a single buy/sell affects demand/supply
const DEMAND_IMPACT = 0.25;
const SUPPLY_IMPACT = 0.25;

// ── World Events ──────────────────────────────────────────────────────────────

export const WORLD_EVENTS = {
  none: {
    id: 'none', name: 'Peaceful Times', emoji: '🌿',
    description: 'Nothing special. The market is calm.',
    duration: 60,  // minutes
    effects: {},
  },
  gold_rush: {
    id: 'gold_rush', name: '💰 Gold Rush', emoji: '💰',
    description: 'Gold mines overflow. Sell prices ×1.5!',
    duration: 30,
    effects: { sellPriceMult: 1.5 },
  },
  scarcity: {
    id: 'scarcity', name: '📦 Resource Scarcity', emoji: '📦',
    description: 'Supplies are short. Buy prices ×1.3!',
    duration: 25,
    effects: { buyPriceMult: 1.3 },
  },
  monster_invasion: {
    id: 'monster_invasion', name: '👹 Monster Invasion', emoji: '👹',
    description: 'Monsters flood the land. Loot quantity ×1.5, EXP ×1.2!',
    duration: 45,
    effects: { lootMult: 1.5, expMult: 1.2 },
  },
  divine_blessing: {
    id: 'divine_blessing', name: '✨ Divine Blessing', emoji: '✨',
    description: 'The gods smile. All EXP ×1.5!',
    duration: 30,
    effects: { expMult: 1.5 },
  },
  trade_fair: {
    id: 'trade_fair', name: '🎪 Grand Trade Fair', emoji: '🎪',
    description: 'Merchants flood the market. Buy prices ×0.85!',
    duration: 30,
    effects: { buyPriceMult: 0.85 },
  },
  ancient_curse: {
    id: 'ancient_curse', name: '💀 Ancient Curse', emoji: '💀',
    description: 'Dark magic blankets the land. All prices volatile!',
    duration: 20,
    effects: { volatilityMult: 1.5 },
  },
};

const EVENT_WEIGHTS = [
  { value: 'none',             weight: 35 },
  { value: 'gold_rush',        weight: 15 },
  { value: 'scarcity',         weight: 12 },
  { value: 'monster_invasion', weight: 12 },
  { value: 'divine_blessing',  weight: 12 },
  { value: 'trade_fair',       weight: 8  },
  { value: 'ancient_curse',    weight: 6  },
];

// ── Initialization ────────────────────────────────────────────────────────────

/**
 * Build the initial economy state from all item definitions.
 * Called once on first boot.
 */
export function buildInitialEconomy() {
  const economy = {};

  for (const item of Object.values(ITEMS)) {
    const basePrice = Math.floor(item.baseValue * RARITY_PRICE_MULT[item.rarity]);
    economy[item.id] = {
      itemId:       item.id,
      basePrice,
      currentPrice: basePrice,
      demand:       1.0,
      supply:       1.0,
      volatility:   VOLATILITY_MAP[item.rarity] || 0.1,
      lastUpdated:  Date.now(),
      history:      [basePrice],
    };
  }

  return economy;
}

/**
 * Load economy from DB, initialize if missing.
 */
export async function loadEconomy() {
  const saved = await db.readCollection(ECONOMY_COL);
  if (Object.keys(saved).length === 0) {
    const initial = buildInitialEconomy();
    await db.writeCollection(ECONOMY_COL, initial);
    return initial;
  }
  return saved;
}

export async function saveEconomy(economy) {
  return db.writeCollection(ECONOMY_COL, economy);
}

// ── Price calculation ─────────────────────────────────────────────────────────

/**
 * Recalculate currentPrice from supply/demand pressure.
 *
 * pressureRatio = (demand + 1) / (supply + 1)
 *   > 1 → buyers outnumber sellers → price rises
 *   < 1 → sellers outnumber buyers → price falls
 *
 * delta = (pressureRatio - 1) × volatility
 * newPrice = basePrice × (1 + delta), clamped to [floor, cap]
 */
function recalcPrice(entry) {
  const { basePrice, demand, supply, volatility } = entry;
  const pressureRatio = (demand + 1) / (supply + 1);
  const delta         = (pressureRatio - 1) * volatility;
  const multiplier    = clamp(
    1 + delta,
    config.economy.priceFloor,
    config.economy.priceCap,
  );
  entry.currentPrice = Math.max(1, Math.floor(basePrice * multiplier));

  // Track price history (last 5 ticks)
  entry.history = [...(entry.history || [basePrice]).slice(-4), entry.currentPrice];
  entry.lastUpdated = Date.now();
}

// ── Trade operations ──────────────────────────────────────────────────────────

/**
 * Record a BUY transaction → demand increases → price rises.
 * @param {string} itemId
 * @param {number} qty
 * @returns {number} actualPrice paid per unit
 */
export async function recordBuy(itemId, qty = 1) {
  const economy = await loadEconomy();
  const entry   = economy[itemId];
  if (!entry) return 0;

  const world   = await getWorldEvent();
  const eventMult = world?.effects?.buyPriceMult ?? 1.0;

  entry.demand = Math.min(5.0, entry.demand + DEMAND_IMPACT * qty);
  recalcPrice(entry);
  economy[itemId] = entry;
  await saveEconomy(economy);

  return Math.floor(entry.currentPrice * eventMult);
}

/**
 * Record a SELL transaction → supply increases → price falls.
 * @returns {number} actualPrice received per unit (shopSellRatio applied)
 */
export async function recordSell(itemId, qty = 1) {
  const economy = await loadEconomy();
  const entry   = economy[itemId];
  if (!entry) return 0;

  const world      = await getWorldEvent();
  const eventMult  = world?.effects?.sellPriceMult ?? 1.0;

  entry.supply = Math.min(5.0, entry.supply + SUPPLY_IMPACT * qty);
  recalcPrice(entry);
  economy[itemId] = entry;
  await saveEconomy(economy);

  return Math.floor(entry.currentPrice * config.economy.shopSellRatio * eventMult);
}

/**
 * Get the current buy price for an item (with world event).
 */
export async function getBuyPrice(itemId) {
  const economy = await loadEconomy();
  const entry   = economy[itemId];
  if (!entry) return 0;

  const world      = await getWorldEvent();
  const eventMult  = world?.effects?.buyPriceMult ?? 1.0;
  const volMult    = world?.effects?.volatilityMult ?? 1.0;

  if (volMult !== 1.0) {
    // Temporarily amplified volatility
    const boosted = clamp(entry.currentPrice * (1 + (Math.random() - 0.5) * volMult * 0.2), 1, 999999);
    return Math.floor(boosted * eventMult);
  }

  return Math.floor(entry.currentPrice * eventMult);
}

/**
 * Get the current sell price (what shop pays player).
 */
export async function getSellPrice(itemId) {
  const economy = await loadEconomy();
  const entry   = economy[itemId];
  if (!entry) return 0;

  const world     = await getWorldEvent();
  const eventMult = world?.effects?.sellPriceMult ?? 1.0;

  return Math.floor(entry.currentPrice * config.economy.shopSellRatio * eventMult);
}

/**
 * Get full price entry for an item (for display).
 */
export async function getPriceEntry(itemId) {
  const economy = await loadEconomy();
  return economy[itemId] || null;
}

// ── Economy Tick ──────────────────────────────────────────────────────────────

/**
 * Periodic decay tick — runs every N minutes via cron.
 * Mean reversion: demand/supply decay toward 1.0.
 * Price slowly returns toward basePrice.
 */
export async function economyTick() {
  const economy = await loadEconomy();
  const { demandDecayRate, meanReversionRate } = config.economy;
  let changed = 0;

  for (const entry of Object.values(economy)) {
    const prevPrice = entry.currentPrice;

    // Decay demand/supply toward neutral (1.0)
    entry.demand = entry.demand + (1.0 - entry.demand) * demandDecayRate;
    entry.supply = entry.supply + (1.0 - entry.supply) * demandDecayRate;

    // Mean reversion: nudge currentPrice toward basePrice
    entry.currentPrice = Math.floor(
      entry.currentPrice + (entry.basePrice - entry.currentPrice) * meanReversionRate
    );
    entry.currentPrice = Math.max(1, entry.currentPrice);

    // Recalculate from supply/demand anyway
    recalcPrice(entry);

    if (entry.currentPrice !== prevPrice) changed++;
  }

  await saveEconomy(economy);
  logger.debug({ changed }, 'Economy tick completed');
  return changed;
}

// ── World Events ──────────────────────────────────────────────────────────────

export async function getWorldState() {
  return await db.getRecordAsync(WORLD_COL, 'current') || {
    eventId: 'none',
    startedAt: Date.now(),
    endsAt: Date.now() + 60 * 60 * 1000,
  };
}

export async function saveWorldState(state) {
  return db.setRecord(WORLD_COL, 'current', state);
}

export async function getWorldEvent() {
  const state = await getWorldState();
  if (!state || Date.now() > state.endsAt) return WORLD_EVENTS.none;
  return WORLD_EVENTS[state.eventId] || WORLD_EVENTS.none;
}

/**
 * Roll a new world event (called by cron when current event expires).
 */
export async function rollWorldEvent() {
  const eventId = weightedPick(EVENT_WEIGHTS);
  const event   = WORLD_EVENTS[eventId];
  const state   = {
    eventId,
    startedAt: Date.now(),
    endsAt:    Date.now() + event.duration * 60 * 1000,
  };
  await saveWorldState(state);
  logger.info({ eventId, duration: event.duration }, 'New world event started');
  return event;
}

/**
 * Check if world event has expired and roll a new one.
 */
export async function checkAndRotateWorldEvent() {
  const state = await getWorldState();
  if (Date.now() > state.endsAt) {
    return rollWorldEvent();
  }
  return WORLD_EVENTS[state.eventId] || WORLD_EVENTS.none;
}

// ── Shop inventory ────────────────────────────────────────────────────────────

// Rotating shop: refreshes every hour, shows a subset of items
let _shopCache = { items: [], generatedAt: 0 };

/**
 * Get the current shop inventory.
 * Rotates hourly for anti-monotony.
 */
export function getShopInventory() {
  const now = Date.now();
  const ttl = 60 * 60 * 1000;  // 1 hour rotation

  if (now - _shopCache.generatedAt < ttl && _shopCache.items.length) {
    return _shopCache.items;
  }

  // Shop always stocks: all consumables + random weapon/armor/accessory selection
  const allItems = Object.values(ITEMS);
  const consumables = allItems.filter(i => i.type === 'consumable');
  const equipment   = allItems.filter(i => ['weapon', 'armor', 'helmet', 'accessory'].includes(i.type));

  // Pick 6 random equipment pieces
  const pickedEquip = equipment.sort(() => Math.random() - 0.5).slice(0, 6);

  _shopCache = {
    items: [...consumables, ...pickedEquip].map(i => i.id),
    generatedAt: now,
  };

  return _shopCache.items;
}

/**
 * Format a price entry for display.
 */
export async function formatPriceEntry(itemId, entry) {
  if (!entry) return '❓ No market data.';
  const item  = ITEMS[itemId];
  if (!item)  return '❓ Unknown item.';

  const trend = trendArrow(entry.currentPrice, entry.basePrice);
  const pct   = Math.round(((entry.currentPrice - entry.basePrice) / entry.basePrice) * 100);
  const sign  = pct >= 0 ? '+' : '';
  const buyPrice = await getBuyPrice(itemId);
  const sellPrice = await getSellPrice(itemId);

  return (
    `${trend} *${item.name}*\n` +
    `💰 Buy: *${buyPrice}g* | Sell: *${sellPrice}g*\n` +
    `📊 Base: ${entry.basePrice}g | Change: ${sign}${pct}%\n` +
    `📈 Demand: ${entry.demand.toFixed(2)} | Supply: ${entry.supply.toFixed(2)}`
  );
}

export default {
  buildInitialEconomy, loadEconomy, saveEconomy,
  recordBuy, recordSell, getBuyPrice, getSellPrice,
  getPriceEntry, economyTick,
  getWorldState, getWorldEvent, rollWorldEvent, checkAndRotateWorldEvent,
  getShopInventory, formatPriceEntry,
  WORLD_EVENTS,
};
