/**
 * lib/game/player.js
 * Player schema, creation, leveling, rank progression.
 */

import db from '../database/db.js';
import { config } from '../../config.js';
import { randInt, clamp } from '../utils/random.js';
import { logger } from '../utils/logger.js';

const COLLECTION = 'players';

// ── Rank thresholds ───────────────────────────────────────────────────────────
const RANKS = [
  { rank: 'S', minLevel: 90 },
  { rank: 'A', minLevel: 75 },
  { rank: 'B', minLevel: 50 },
  { rank: 'C', minLevel: 25 },
  { rank: 'D', minLevel: 10 },
  { rank: 'E', minLevel: 0  },
];

export function calcRank(level) {
  return (RANKS.find(r => level >= r.minLevel) || RANKS[RANKS.length - 1]).rank;
}

// ── EXP formula ───────────────────────────────────────────────────────────────
export function expRequired(level) {
  return Math.floor(
    config.rpg.baseExpPerLevel * Math.pow(config.rpg.expScalingFactor, level - 1)
  );
}

// ── Starter skills per class ──────────────────────────────────────────────────
function getStarterSkills(cls) {
  const map = {
    Warrior:  ['power_strike', 'shield_bash'],
    Mage:     ['fireball', 'arcane_bolt'],
    Archer:   ['rapid_shot', 'eagle_eye'],
    Assassin: ['backstab', 'shadowstep'],
  };
  return map[cls] || [];
}

// ── Schema ────────────────────────────────────────────────────────────────────
export function createPlayerSchema(id, name, cls) {
  const base = config.rpg.classes[cls];
  if (!base) throw new Error(`Unknown class: ${cls}`);

  return {
    id,
    name,
    class: cls,
    rank: 'E',
    reputation: 0,

    level: 1,
    exp: 0,
    expToNext: expRequired(1),

    hp: base.hp,
    maxHp: base.hp,
    mana: base.mana,
    maxMana: base.mana,
    attack: base.attack,
    defense: base.defense,
    speed: base.speed,

    gold: 100,

    inventory: [],
    equipment: { weapon: null, armor: null, accessory: null, helmet: null },
    skills: getStarterSkills(cls),
    skillCooldowns: {},       // { skillId: turnsRemaining } — persisted for dungeon

    activeQuest: null,
    completedQuests: [],

    // Job advancement
    job: cls,              // current job (sama dengan class awalnya)

    // Stats tracking (untuk title system)
    stats: {
      monstersKilled: 0,
      dungeonsCleared: 0,
      pvpWins: 0,
      pvpLosses: 0,
      wins: 0,
      losses: 0,
      bossesKilled: [],
      worldBossKills: 0,
      totalDmgDealt: 0,
      craftCount: 0,
    },

    // Title system
    earnedTitles: [],
    activeTitle: null,

    // Guild
    guildId: null,
    guildRole: null,

    // Gacha
    gachaPity: 0,

    // Summon (Summoner class)
    summonCooldown: {},
    activeSummon:   null,

    dungeon: null,

    statusEffects: [],

    dailyStreak: 0,
    lastDaily: 0,
    lastActive: Date.now(),
    createdAt: Date.now(),
  };
}

// ── Defensive migration: fill missing fields on old player docs ───────────────
export function migratePlayer(player) {
  // Fill any missing field with safe default
  const defaults = {
    skillCooldowns:   {},
    statusEffects:    [],
    completedQuests:  [],
    activeQuest:      null,
    dungeon:          null,
    reputation:       0,
    dailyStreak:      0,
    lastDaily:        0,
    lastActive:       Date.now(),
  };
  for (const [key, val] of Object.entries(defaults)) {
    if (player[key] === undefined || player[key] === null) {
      if (key === 'activeQuest' || key === 'dungeon') {
        player[key] = null;          // nullable fields stay null
      } else {
        player[key] = val;
      }
    }
  }
  return player;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
export function getPlayer(id) {
  const p = db.getRecord(COLLECTION, id);
  return p ? migratePlayer(p) : null;   // auto-migrate on read
}

export async function hasPlayer(id) {
  return await db.hasRecord(COLLECTION, id);
}

export async function savePlayer(player) {
  player.lastActive = Date.now();
  return db.setRecord(COLLECTION, player.id, player);
}

export async function createPlayer(id, name, cls) {
  if (await db.hasRecord(COLLECTION, id)) throw new Error('Player already exists.');
  const player = createPlayerSchema(id, name, cls);
  await db.setRecord(COLLECTION, id, player);
  logger.info({ id, name, cls }, 'New player created');
  return player;
}

export function getAllPlayers() {
  return db.getAllRecords(COLLECTION).map(migratePlayer);
}

// ── Leveling ──────────────────────────────────────────────────────────────────
export async function awardExp(player, amount) {
  const messages = [];
  player.exp = (player.exp || 0) + amount;

  while (player.exp >= player.expToNext) {
    player.exp      -= player.expToNext;
    player.level    += 1;
    player.expToNext = expRequired(player.level);

    // Stat growth with slight variance
    const hpGain  = randInt(8, 14);
    const atkGain = randInt(1, 3);
    const defGain = randInt(1, 2);
    const mnaGain = randInt(3, 7);

    player.maxHp   += hpGain;
    player.hp       = Math.min(player.hp + hpGain, player.maxHp);
    player.maxMana += mnaGain;
    player.mana     = Math.min(player.mana + mnaGain, player.maxMana);
    player.attack  += atkGain;
    player.defense += defGain;

    const oldRank = player.rank;
    player.rank   = calcRank(player.level);
    const rankUp  = player.rank !== oldRank;

    messages.push(
      `🎉 *LEVEL UP!* Lv.${player.level - 1} → *Lv.${player.level}*\n` +
      `❤️ +${hpGain} HP | ⚔️ +${atkGain} ATK | 🛡️ +${defGain} DEF | 💙 +${mnaGain} Mana` +
      (rankUp ? `\n🏅 Rank naik! *${oldRank} → ${player.rank}*` : '')
    );
  }
  return { messages };
}

// ── Effective stats (equipment bonuses) ───────────────────────────────────────
export function effectiveStats(player, itemLib = null) {
  // itemLib opsional — kalau tidak di-pass, tidak ada equipment bonus
  const stats = {
    attack:  player.attack  || 0,
    defense: player.defense || 0,
    speed:   player.speed   || 0,
    maxHp:   player.maxHp   || player.hp || 0,
    maxMana: player.maxMana || player.mana || 0,
  };
  if (!itemLib) return stats;
  for (const [, itemId] of Object.entries(player.equipment || {})) {
    if (!itemId) continue;
    const item = itemLib[itemId];
    if (!item?.stats) continue;
    for (const [stat, val] of Object.entries(item.stats)) {
      if (stats[stat] !== undefined) stats[stat] += (val || 0);
    }
  }
  return stats;
}

// ── Inventory helpers ─────────────────────────────────────────────────────────
export function hasItem(player, itemId, qty = 1) {
  const slot = (player.inventory || []).find(s => s.itemId === itemId);
  return slot ? slot.qty >= qty : false;
}

export function addItem(player, itemId, qty = 1, durability = 100) {
  if (!player.inventory) player.inventory = [];
  const slot = player.inventory.find(s => s.itemId === itemId);
  if (slot) {
    slot.qty += qty;
  } else {
    player.inventory.push({ itemId, qty, durability });
  }
}

export function removeItem(player, itemId, qty = 1) {
  if (!player.inventory) return false;
  const slot = player.inventory.find(s => s.itemId === itemId);
  if (!slot || slot.qty < qty) return false;
  slot.qty -= qty;
  if (slot.qty <= 0) player.inventory = player.inventory.filter(s => s.itemId !== itemId);
  return true;
}

// ── Status effects ────────────────────────────────────────────────────────────
export function addStatusEffect(player, effect) {
  if (!player.statusEffects) player.statusEffects = [];
  player.statusEffects = player.statusEffects.filter(e => e.id !== effect.id);
  player.statusEffects.push(effect);
}

export function tickStatusEffects(entity, log = []) {
  if (!entity.statusEffects?.length) return 0;
  let totalDmg = 0;
  const remaining = [];

  for (const eff of entity.statusEffects) {
    // DoT damage
    if (eff.dotDamage) {
      const dmg = eff.dotDamage;
      entity.currentHp = Math.max(0, (entity.currentHp ?? entity.hp) - dmg);
      totalDmg += dmg;
      log.push(`🩸 ${entity.name} terkena ${eff.id}: *-${dmg} HP*`);
    }
    // Decrement duration
    if (eff.duration !== undefined) {
      eff.duration--;
      if (eff.duration > 0) remaining.push(eff);
      else log.push(`✅ ${eff.id} pada ${entity.name} berakhir.`);
    } else {
      remaining.push(eff);
    }
  }
  entity.statusEffects = remaining;
  return totalDmg;
}

export default {
  createPlayerSchema, createPlayer, getPlayer, hasPlayer,
  savePlayer, getAllPlayers, awardExp, expRequired, calcRank,
  effectiveStats, hasItem, addItem, removeItem,
  addStatusEffect, tickStatusEffects, migratePlayer,
};
