/**
 * lib/game/battleEngine.js
 * Complete turn-based PvE battle system.
 * Updated: zone multiplier, pet bonus, stats tracking, awakening passive
 * FIXED: Equipment bonuses now properly applied to stats
 */

import {
  randInt, chance, applyVariance, clamp, pick, weightedPick,
} from '../utils/random.js';
import { config } from '../../config.js';
import { getSkill } from './skill.js';
import { rollMonsterLoot, rollGold } from './monster.js';
import { awardExp, addItem, tickStatusEffects, addStatusEffect, effectiveStats } from './player.js';
import { getPetBonus } from './pet.js';
import { getTitleBonus } from './title.js';
import { ITEMS } from './item.js';

// ── Helpers ───────────────────────────────────────────────────────────

function safeArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [v];
}

// ── Random battle events ──────────────────────────────────────────────────────

const BATTLE_EVENTS = [
  { id: 'nothing',        weight: 60, message: null },
  { id: 'adrenaline',     weight: 10, message: '⚡ Adrenaline rush! ATK +20% this battle!' },
  { id: 'focus',          weight: 8,  message: '🎯 You enter a focused state. Crit rate +10%!' },
  { id: 'cursed_ground',  weight: 6,  message: '💀 Cursed ground! Both sides take +10% damage.' },
  { id: 'blessed_wind',   weight: 6,  message: '🌬️ A gentle wind heals you for 10 HP each turn.' },
  { id: 'rage',           weight: 5,  message: '🔥 Rage ignites! Monster ATK +15%.' },
  { id: 'rare_encounter', weight: 5,  message: '✨ Rare encounter! Bonus loot guaranteed!' },
];

function rollBattleEvent() {
  return weightedPick(BATTLE_EVENTS);
}

// ── Element system ─────────────────────────────────────────────────────────

function elementMultiplier(attackerElement, defenderElement) {
  const chart = config.rpg.elementChart;
  return chart[attackerElement]?.[defenderElement] ?? 1.0;
}

// ── Damage calculation ─────────────────────────────────────────────────────

function calcDamage(attacker, defender, options = {}) {
  const {
    attackMult  = 1.0,
    trueDamage  = false,
    elementAtk  = attacker.element || 'neutral',
    elementDef  = defender.element || 'neutral',
  } = options;

  const baseAtk  = Math.floor(attacker.effectiveAttack * attackMult);
  const baseDmg  = applyVariance(baseAtk, config.rpg.damageVariance);
  const defense  = trueDamage ? 0 : Math.floor(defender.effectiveDefense * 0.5);
  const rawDmg   = Math.max(1, baseDmg - defense);
  const elemMult = elementMultiplier(elementAtk, elementDef);
  const dmgMult  = defender.statusEffects?.find(e => e.id === 'death_mark')?.damageReceivedMult ?? 1.0;

  return Math.floor(rawDmg * elemMult * dmgMult);
}

function isCritical(attacker, activeEffects = []) {
  let critChance = config.rpg.critChanceBase;
  if (attacker.class === 'Assassin' || attacker.job === 'Assassin' ||
      ['Shadow','Phantom','Reaper','Death God','Sin Eater'].includes(attacker.job)) critChance += 0.12;
  if (attacker.class === 'Archer'   || attacker.job === 'Archer'   ||
      ['Ranger','Sniper','God Archer','Beastmaster','Wild Emperor'].includes(attacker.job)) critChance += 0.06;

  for (const eff of activeEffects) {
    if (eff.critBonus)       critChance += eff.critBonus;
    if (eff.guaranteedCrit)  return true;
  }
  if (attacker.critBonus) critChance += attacker.critBonus;

  return chance(critChance);
}

function isMiss(attacker, defender) {
  const speedDiff = defender.speed - attacker.speed;
  const missChance = clamp(
    config.rpg.missChanceBase + speedDiff * 0.01,
    0.02,
    0.4,
  );
  // zero_miss passive (Sniper job)
  if (attacker.passiveSkill === 'zero_miss') return false;
  return chance(missChance);
}

// ── Build entity ─────────────────────────────────────────────────────────

function buildEntity(data, isPlayer = true) {
  // Skill cooldowns — handle Map, Object, undefined
  let cooldowns;
  if (data.skillCooldowns instanceof Map) {
    cooldowns = data.skillCooldowns;
  } else if (data.skillCooldowns && typeof data.skillCooldowns === 'object') {
    cooldowns = new Map(Object.entries(data.skillCooldowns));
  } else {
    cooldowns = new Map();
  }

  // Get effective stats WITH equipment bonuses for player
  const baseStats = isPlayer 
    ? effectiveStats(data, ITEMS)  // FIXED: Apply equipment bonuses
    : {
        attack:  data.attack  || 0,
        defense: data.defense || 0,
        speed:   data.speed   || 0,
        maxHp:   data.maxHp   || data.hp || 0,
        maxMana: data.maxMana || data.mana || 0,
        hp:      data.hp      || 0,
        mana:    data.mana    || 0,
      };

  // Base entity
  const entity = {
    ...data,
    name:             data.name || (isPlayer ? 'Player' : 'Monster'),
    isPlayer,
    effectiveAttack:  Math.max(1, baseStats.attack || 0),
    effectiveDefense: Math.max(0, baseStats.defense || 0),
    currentHp:        data.currentHp  ?? data.hp   ?? 1,
    currentMana:      data.currentMana ?? data.mana ?? 0,
    statusEffects:    Array.isArray(data.statusEffects) ? data.statusEffects : [],
    skillCooldowns:   cooldowns,
    skills:           Array.isArray(data.skills) ? data.skills : [],
    activeBuffs:      [],
    speed:            baseStats.speed || 5,
    element:          data.element || 'neutral',
    critBonus:        data.critBonus || 0,
  };

  // Jika player: tambah bonus dari pet + title + summon
  if (isPlayer) {
    try {
      // Pet bonus (15% dari stat pet)
      const petBonus = getPetBonus(data._pet);
      if (petBonus.attack)  entity.effectiveAttack  += petBonus.attack;
      if (petBonus.defense) entity.effectiveDefense += petBonus.defense;
      if (petBonus.speed)   entity.speed            += petBonus.speed;
      if (petBonus.hp)      entity.currentHp        = Math.min(entity.currentHp + petBonus.hp, entity.maxHp || entity.currentHp);
    } catch {}

    try {
      // Summon bonus (khusus Summoner class)
      if (data.activeSummon && data.activeSummon.uses > 0) {
        const summon = data.activeSummon;
        if (summon.stats?.attack)  entity.effectiveAttack  += summon.stats.attack;
        if (summon.stats?.defense) entity.effectiveDefense += summon.stats.defense;
        if (summon.stats?.hp)      entity.currentHp        = Math.min(entity.currentHp + summon.stats.hp, entity.maxHp || entity.currentHp);
        if (summon.stats?.speed)   entity.speed            += summon.stats.speed;
        entity._hasSummon = true;
      }
    } catch {}

    try {
      // Title bonus
      const titleBonus = getTitleBonus(data);
      if (titleBonus.attack)    entity.effectiveAttack  += titleBonus.attack;
      if (titleBonus.defense)   entity.effectiveDefense += titleBonus.defense;
      if (titleBonus.speed)     entity.speed            += titleBonus.speed;
      if (titleBonus.critBonus) entity.critBonus        += titleBonus.critBonus;
    } catch {}

    // Job-based passive stat adjustments
    const job = data.job || data.class;
    if (['Berserker','Chaos Lord'].includes(job)) {
      // Berserker: swap some DEF for ATK
      entity.effectiveAttack  = Math.floor(entity.effectiveAttack  * 1.1);
      entity.effectiveDefense = Math.floor(entity.effectiveDefense * 0.9);
    }
    if (['Paladin','Dragon Knight'].includes(job)) {
      // Paladin: bonus self-healing factor
      entity._paladinheal = true;
    }
    if (['Sniper','God Archer'].includes(job)) {
      entity.passiveSkill = 'zero_miss';
    }
    if (['Death God','Sin Eater'].includes(job)) {
      entity.critBonus += 0.08;
    }
  }

  return entity;
}

// ── Monster turn ─────────────────────────────────────────────────────────

function monsterTurn(monster, player, context) {
  const messages = [];

  // Stun check
  const stun = monster.statusEffects.find(e => e.id === 'stun');
  if (stun) {
    messages.push(`💫 ${monster.name} is *stunned* and skips their turn!`);
    return { messages, damage: 0 };
  }

  // Monster skill attempt
  if (monster.skills?.length && chance(0.3)) {
    const skillId = pick(monster.skills);
    const skill   = getSkill(skillId);
    if (skill && monster.currentMana >= (skill.manaCost || 0)) {
      monster.currentMana -= skill.manaCost || 0;
      const result = skill.execute(monster, player, context);
      if (result.statusEffect) addStatusEffect(player, result.statusEffect);
      messages.push(...safeArray(result.messages));
      return { messages, damage: result.damage || 0 };
    }
  }

  // Miss check
  if (isMiss(monster, player)) {
    messages.push(`💨 ${monster.name} attacks but *misses*!`);
    return { messages, damage: 0 };
  }

  // Normal attack
  const crit = isCritical(monster, []);
  const dmg  = calcDamage(
    { effectiveAttack: monster.effectiveAttack, element: monster.element },
    { effectiveDefense: player.effectiveDefense, element: player.element || 'neutral', statusEffects: player.statusEffects },
    { attackMult: crit ? 1.8 : 1 },
  );

  messages.push(
    crit
      ? `💥 ${monster.emoji || '👹'} *CRITICAL!* ${monster.name} hits for *${dmg}* damage!`
      : `⚔️ ${monster.emoji || '👹'} ${monster.name} attacks for *${dmg}* damage!`,
  );

  return { messages, damage: dmg };
}

// ── MAIN BATTLE ENGINE ───────────────────────────────────────────────────────

export async function executeBattle(rawPlayer, rawMonster, opts = {}) {
  const log     = [];
  const player  = buildEntity(rawPlayer, true);
  const monster = buildEntity(rawMonster, false);

  let battleGold      = 0;
  let battleExp       = 0;
  let loot            = [];
  let playerWon       = false;
  let monsterDefeated = false;
  let playerDefeated  = false;
  let totalDmgDealt   = 0;  // tracking for stats

  // ── Battle event ────────────────────────────────────────────────────────
  const event        = rollBattleEvent();
  const eventContext = { event: event.id, rareEncounter: event.id === 'rare_encounter' };
  if (event.message) log.push(`🎲 *Event:* ${event.message}`);

  // Summon message
  if (player._hasSummon && rawPlayer.activeSummon) {
    log.push(`🎴 *${rawPlayer.activeSummon.emoji} ${rawPlayer.activeSummon.name}* bergabung di battle!`);
  }

  // Apply event modifiers
  if (event.id === 'adrenaline')    player.effectiveAttack  = Math.floor(player.effectiveAttack  * 1.20);
  if (event.id === 'focus')         player.critBonus       += 0.10;
  if (event.id === 'rage')          monster.effectiveAttack = Math.floor(monster.effectiveAttack * 1.15);
  if (event.id === 'cursed_ground') {
    player.effectiveDefense  = Math.floor(player.effectiveDefense  * 0.90);
    monster.effectiveDefense = Math.floor(monster.effectiveDefense * 0.90);
  }

  // Awakening II passive — damage boost saat HP rendah
  const awakeningTier = rawPlayer.awakeningTier || 0;

  // ── Speed / turn order ────────────────────────────────────────────────────
  const playerFirst = player.speed >= monster.speed || chance(0.6);
  const turnOrder   = playerFirst ? ['player', 'monster'] : ['monster', 'player'];
  log.push(`⚡ ${playerFirst ? player.name + ' attacks first!' : monster.name + ' strikes first!'}`);
  log.push('─'.repeat(30));

  // ── Combat loop ─────────────────────────────────────────────────────────
  for (let turn = 1; turn <= 20; turn++) {
    log.push(`\n*Turn ${turn}*`);

    // Blessed wind — heal player setiap turn
    if (event.id === 'blessed_wind' && turn > 1) {
      player.currentHp = Math.min(player.currentHp + 10, rawPlayer.maxHp || 999);
      log.push(`🌬️ Blessed wind heals you for *10 HP*!`);
    }

    for (const actor of turnOrder) {

      // ── PLAYER TURN ───────────────────────────────────────────────────────
      if (actor === 'player') {
        // Tick status effects
        const statusMsgs = tickStatusEffects(player);
        log.push(...safeArray(statusMsgs));
        if (player.currentHp <= 0) { playerDefeated = true; break; }

        // Awakening II passive — kalau HP < 50%, ATK naik 15%
        let atkMult = 1.0;
        if (awakeningTier >= 2 && player.currentHp < (rawPlayer.maxHp || 100) * 0.5) {
          atkMult = 1.15;
        }

        // Awakening III passive — 10% chance invulnerable skip turn (player skip dmg receive)
        // ditangani di monster turn

        // Paladin passive — setiap 3 turn, heal 5% max HP
        if (player._paladinheal && turn % 3 === 0) {
          const healAmt = Math.max(1, Math.floor((rawPlayer.maxHp || 100) * 0.05));
          player.currentHp = Math.min(player.currentHp + healAmt, rawPlayer.maxHp || 999);
          log.push(`✨ *Holy Aura* heals you for *${healAmt} HP*!`);
        }

        // ── Skill or normal attack ────────────────────────────────────────
        if (opts.skillId && turn === 1) {
          const skill  = getSkill(opts.skillId);
          const cdLeft = player.skillCooldowns.get(opts.skillId) || 0;

          if (skill && player.currentMana >= skill.manaCost && cdLeft === 0) {
            player.currentMana -= skill.manaCost;
            player.skillCooldowns.set(opts.skillId, skill.cooldown);

            const result = skill.execute(player, monster, eventContext);
            if (result.statusEffect) addStatusEffect(monster, result.statusEffect);

            const skillDmg = result.damage || 0;
            monster.currentHp -= skillDmg;
            totalDmgDealt     += skillDmg;

            log.push(...safeArray(result.messages));
          } else {
            // Fallback ke normal attack j
