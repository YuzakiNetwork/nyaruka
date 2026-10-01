/**
 * lib/game/dungeon.js
 * Dungeon system — multi-floor progression, random modifiers,
 * elite chance, boss floor, reward tiers, dynamic scaling.
 *
 * Anti-monotony features:
 * - Random modifier per run (darkness, blessing, curse, poison air)
 * - Random monster composition per floor
 * - Elite encounters (10% base)
 * - Boss floor (floor 10)
 * - Reward tier tied to modifier + player level
 * - Floor exploration events
 */

import db from '../database/db.js';
import { randomMonster, rollMonsterLoot, rollGold, MONSTERS, scaleMonster } from './monster.js';
import { pick, weightedPick, randInt, chance, pickN } from '../utils/random.js';
import { addItem, savePlayer } from './player.js';
import { getItem, RARITY_EMOJI } from './item.js';

const COLLECTION = 'dungeons';
const TOTAL_FLOORS = 10;

// ── Dungeon Modifiers (anti-monotony) ─────────────────────────────────────────

export const DUNGEON_MODIFIERS = {
  none: {
    id: 'none', name: 'Normal', emoji: '⚔️',
    description: 'A standard dungeon. No special effects.',
    playerEffect: {},
    monsterEffect: {},
  },
  darkness: {
    id: 'darkness', name: 'Darkness', emoji: '🌑',
    description: 'Visibility is reduced. Player miss rate +15%, monster miss rate +10%.',
    playerEffect:  { missRateBonus: 0.15 },
    monsterEffect: { missRateBonus: 0.10 },
  },
  poison_air: {
    id: 'poison_air', name: 'Poison Air', emoji: '☠️',
    description: 'Toxic fumes. Player takes 5 HP damage per floor.',
    playerEffect: { floorDamage: 5 },
    monsterEffect: {},
  },
  blessing: {
    id: 'blessing', name: 'Divine Blessing', emoji: '✨',
    description: 'Holy energy. Player ATK and DEF +15%, bonus loot.',
    playerEffect: { attackMult: 1.15, defenseMult: 1.15, bonusLoot: true },
    monsterEffect: {},
  },
  curse: {
    id: 'curse', name: 'Ancient Curse', emoji: '💀',
    description: 'Monsters gain +20% ATK but gold reward ×2.',
    playerEffect:  { bonusGoldMult: 2.0 },
    monsterEffect: { attackMult: 1.20 },
  },
  sacred_ground: {
    id: 'sacred_ground', name: 'Sacred Ground', emoji: '🕍',
    description: 'Player heals 8 HP between floors.',
    playerEffect: { floorHeal: 8 },
    monsterEffect: {},
  },
  monster_horde: {
    id: 'monster_horde', name: 'Monster Horde', emoji: '👹',
    description: 'Multiple monsters per floor (2–3). Huge EXP bonus.',
    playerEffect: { expMult: 1.5 },
    monsterEffect: { multiMonster: true },
  },
};

const MODIFIER_WEIGHTS = [
  { value: 'none',          weight: 30 },
  { value: 'darkness',      weight: 15 },
  { value: 'poison_air',    weight: 12 },
  { value: 'blessing',      weight: 12 },
  { value: 'curse',         weight: 12 },
  { value: 'sacred_ground', weight: 10 },
  { value: 'monster_horde', weight: 9  },
];

// ── Floor events (random per floor, adds surprise) ────────────────────────────

const FLOOR_EVENTS = [
  { id: 'nothing',     weight: 50 },
  { id: 'treasure',    weight: 15, message: '💎 You find a hidden treasure chest! Bonus loot!' },
  { id: 'trap',        weight: 12, message: '🪤 A trap triggers! You take 15 HP damage.' },
  { id: 'shrine',      weight: 10, message: '⛩️ A shrine restores 20 HP and 20 Mana.' },
  { id: 'merchant',    weight: 8,  message: '🧙 A wandering merchant gives you a free potion!' },
  { id: 'ambush',      weight: 5,  message: '⚠️ AMBUSH! Monster strikes first this floor.' },
];

// ── Dungeon reward tiers ─────────────────────────────────────────────────────

const REWARD_TIERS = [
  { minFloor: 1,  goldMult: 1.0, expMult: 1.0,  rarityBoost: 0   },
  { minFloor: 3,  goldMult: 1.2, expMult: 1.2,  rarityBoost: 0.1 },
  { minFloor: 5,  goldMult: 1.5, expMult: 1.5,  rarityBoost: 0.2 },
  { minFloor: 7,  goldMult: 2.0, expMult: 2.0,  rarityBoost: 0.3 },
  { minFloor: 10, goldMult: 3.0, expMult: 3.0,  rarityBoost: 0.5 },
];

function getRewardTier(floor) {
  let tier = REWARD_TIERS[0];
  for (const t of REWARD_TIERS) {
    if (floor >= t.minFloor) tier = t;
  }
  return tier;
}

// ── Dungeon State ─────────────────────────────────────────────────────────────

/**
 * Create a new dungeon run for a player.
 */
export function createDungeon(playerId, playerLevel) {
  const modId     = weightedPick(MODIFIER_WEIGHTS);
  const modifier  = DUNGEON_MODIFIERS[modId];

  return {
    playerId,
    active: true,
    floor: 1,
    totalFloors: TOTAL_FLOORS,
    modifier: modId,
    playerLevel,
    monstersKilled: 0,
    lootCollected: [],
    totalGold: 0,
    totalExp: 0,
    startedAt: Date.now(),
    currentMonster: null,
    inBattle: false,
  };
}

export async function saveDungeon(dungeon) {
  return db.setRecord(COLLECTION, dungeon.playerId, dungeon);
}

export function getDungeon(playerId) {
  return db.getRecord(COLLECTION, playerId);
}

export async function deleteDungeon(playerId) {
  return db.deleteRecord(COLLECTION, playerId);
}

// ── Floor generation ──────────────────────────────────────────────────────────

/**
 * Generate the monster(s) for a given floor.
 * Floor 10 = Boss.
 * Floors 6–9 = Elite chance 25%.
 * Floors 1–5 = Elite chance 10%.
 */
export function generateFloor(floor, playerLevel, modifier) {
  const mod = DUNGEON_MODIFIERS[modifier] || DUNGEON_MODIFIERS.none;
  const isBoss = floor === TOTAL_FLOORS;

  if (isBoss) {
    const boss = scaleMonster(MONSTERS.dungeon_overlord, playerLevel);
    // Apply monster modifier
    if (mod.monsterEffect.attackMult) {
      boss.attack  = Math.floor(boss.attack  * mod.monsterEffect.attackMult);
    }
    return { monsters: [boss], isBoss: true, isElite: false };
  }

  const eliteChance = floor >= 6 ? 0.25 : 0.10;
  const monsterCount = mod.playerEffect.multiMonster ? randInt(2, 3) : 1;

  const monsters = [];
  for (let i = 0; i < monsterCount; i++) {
    const m = randomMonster(playerLevel, eliteChance, false);
    if (mod.monsterEffect.attackMult) {
      m.attack = Math.floor(m.attack * mod.monsterEffect.attackMult);
    }
    monsters.push(m);
  }

  return {
    monsters,
    isBoss: false,
    isElite: monsters.some(m => m.elite),
  };
}

/**
 * Roll a floor event for variety.
 */
export function rollFloorEvent() {
  return weightedPick(FLOOR_EVENTS);
}

// ── Dungeon summary ───────────────────────────────────────────────────────────

/**
 * Build a text summary of dungeon progress.
 */
export function dungeonStatusText(dungeon) {
  const mod = DUNGEON_MODIFIERS[dungeon.modifier] || DUNGEON_MODIFIERS.none;
  const floors = [];

  for (let f = 1; f <= dungeon.totalFloors; f++) {
    if (f < dungeon.floor) {
      floors.push(`✅ Floor ${f}`);
    } else if (f === dungeon.floor) {
      floors.push(`⚔️ Floor ${f} ← *Current*`);
    } else if (f === dungeon.totalFloors) {
      floors.push(`💀 Floor ${f} — *BOSS*`);
    } else {
      floors.push(`🔲 Floor ${f}`);
    }
  }

  return (
    `🏰 *Dungeon Progress*\n` +
    `Modifier: ${mod.emoji} *${mod.name}*\n` +
    `${mod.description}\n\n` +
    floors.join('\n') +
    `\n\n📊 Kills: ${dungeon.monstersKilled} | 💰 Gold: ${dungeon.totalGold} | ⭐ EXP: ${dungeon.totalExp}`
  );
}

/**
 * Compute final dungeon completion rewards.
 */
export function computeCompletionRewards(dungeon, playerLevel) {
  const tier = getRewardTier(dungeon.floor);
  const mod  = DUNGEON_MODIFIERS[dungeon.modifier] || DUNGEON_MODIFIERS.none;

  const bonusGold = Math.floor(
    randInt(playerLevel * 20, playerLevel * 40)
    * tier.goldMult
    * (mod.playerEffect.bonusGoldMult || 1.0)
  );
  const bonusExp = Math.floor(
    playerLevel * 30
    * tier.expMult
    * (mod.playerEffect.expMult || 1.0)
  );

  return { bonusGold, bonusExp, rarityBoost: tier.rarityBoost };
}

/**
 * Apply floor modifier effects to player (call between floors).
 * Returns messages for the effect.
 */
export function applyFloorModifier(player, modifier) {
  const mod = DUNGEON_MODIFIERS[modifier] || DUNGEON_MODIFIERS.none;
  const msgs = [];

  if (mod.playerEffect.floorDamage) {
    const dmg = mod.playerEffect.floorDamage;
    player.hp = Math.max(1, player.hp - dmg);
    msgs.push(`☠️ Poison air damages you for *${dmg} HP*!`);
  }

  if (mod.playerEffect.floorHeal) {
    const heal = mod.playerEffect.floorHeal;
    player.hp = Math.min(player.maxHp, player.hp + heal);
    msgs.push(`✨ Sacred ground heals you for *${heal} HP*!`);
  }

  return msgs;
}

export default {
  DUNGEON_MODIFIERS, createDungeon, saveDungeon, getDungeon,
  deleteDungeon, generateFloor, rollFloorEvent, dungeonStatusText,
  computeCompletionRewards, applyFloorModifier,
};
