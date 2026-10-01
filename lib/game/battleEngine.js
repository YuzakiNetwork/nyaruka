/**
 * lib/game/battleEngine.js
 * Complete turn-based PvE battle system.
 * Updated: zone multiplier, pet bonus, stats tracking, awakening passive
 */

import {
  randInt, chance, applyVariance, clamp, pick, weightedPick,
} from '../utils/random.js';
import { config } from '../../config.js';
import { getSkill } from './skill.js';
import { rollMonsterLoot, rollGold } from './monster.js';
import { awardExp, addItem, tickStatusEffects, addStatusEffect } from './player.js';
import { getPetBonus } from './pet.js';
import { getTitleBonus } from './title.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Element system ────────────────────────────────────────────────────────────

function elementMultiplier(attackerElement, defenderElement) {
  const chart = config.rpg.elementChart;
  return chart[attackerElement]?.[defenderElement] ?? 1.0;
}

// ── Damage calculation ────────────────────────────────────────────────────────

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

// ── Build entity ──────────────────────────────────────────────────────────────

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

  // Base entity
  const entity = {
    ...data,
    name:             data.name || (isPlayer ? 'Player' : 'Monster'),
    isPlayer,
    effectiveAttack:  Math.max(1, data.attack  || 0),
    effectiveDefense: Math.max(0, data.defense || 0),
    currentHp:        data.currentHp  ?? data.hp   ?? 1,
    currentMana:      data.currentMana ?? data.mana ?? 0,
    statusEffects:    Array.isArray(data.statusEffects) ? data.statusEffects : [],
    skillCooldowns:   cooldowns,
    skills:           Array.isArray(data.skills) ? data.skills : [],
    activeBuffs:      [],
    speed:            data.speed   || 5,
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

// ── Monster turn ──────────────────────────────────────────────────────────────

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

// ── MAIN BATTLE ENGINE ────────────────────────────────────────────────────────

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

  // ── Battle event ──────────────────────────────────────────────────────────
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

  // ── Combat loop ───────────────────────────────────────────────────────────
  for (let turn = 1; turn <= 20; turn++) {
    log.push(`\n*Turn ${turn}*`);

    // Blessed wind — heal player setiap turn
    if (event.id === 'blessed_wind' && turn > 1) {
      player.currentHp = Math.min(player.currentHp + 10, rawPlayer.maxHp || 999);
      log.push(`🌬️ Blessed wind heals you for *10 HP*!`);
    }

    for (const actor of turnOrder) {

      // ── PLAYER TURN ────────────────────────────────────────────────────────
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
            // Fallback ke normal attack jika skill tidak bisa dipakai
            opts.skillId = null;
          }
        }

        if (!opts.skillId || turn > 1) {
          if (isMiss(player, monster)) {
            log.push(`💨 *${player.name}* swings but *misses*!`);
          } else {
            const crit  = isCritical(player, []);
            const dmg   = calcDamage(
              { effectiveAttack: Math.floor(player.effectiveAttack * atkMult), element: player.element },
              { effectiveDefense: monster.effectiveDefense, element: monster.element },
              { attackMult: crit ? 1.8 : 1 },
            );
            monster.currentHp -= dmg;
            totalDmgDealt     += dmg;

            log.push(
              crit
                ? `💥 *CRITICAL!* You hit ${monster.name} for *${dmg}*`
                : `⚔️ You hit ${monster.name} for *${dmg}*`,
            );
          }
        }

        if (monster.currentHp <= 0) { monsterDefeated = true; break; }
      }

      // ── MONSTER TURN ───────────────────────────────────────────────────────
      if (actor === 'monster' && !monsterDefeated) {
        const statusMsgs = tickStatusEffects(monster);
        log.push(...safeArray(statusMsgs));
        if (monster.currentHp <= 0) { monsterDefeated = true; break; }

        // Awakening III — 10% chance invulnerable (skip damage)
        if (awakeningTier >= 3 && chance(0.10)) {
          log.push(`🔱 *Divine Invulnerability!* Serangan ${monster.name} tidak berpengaruh!`);
        } else {
          const result      = monsterTurn(monster, player, eventContext);
          player.currentHp -= result.damage;
          log.push(...safeArray(result.messages));
        }

        if (player.currentHp <= 0) { playerDefeated = true; break; }
      }
    }

    // Tick skill cooldowns setiap turn
    for (const [skillId, cd] of player.skillCooldowns.entries()) {
      if (cd > 0) player.skillCooldowns.set(skillId, cd - 1);
    }

    if (monsterDefeated || playerDefeated) break;
  }

  // ── Result ────────────────────────────────────────────────────────────────
  log.push('\n' + '═'.repeat(30));

  if (monsterDefeated) {
    playerWon  = true;
    loot       = rollMonsterLoot(monster, 0);
    battleGold = rollGold(monster);
    battleExp  = monster.expReward || monster.exp || 0;

    // Rare encounter: bonus loot
    if (event.id === 'rare_encounter') {
      battleGold = Math.floor(battleGold * 1.5);
      battleExp  = Math.floor(battleExp  * 1.5);
      log.push(`✨ *Rare Encounter bonus!* Gold & EXP ×1.5`);
    }

    log.push(
      `🎉 *Victory!* You defeated *${monster.name}*!\n` +
      `💰 +${battleGold}g\n⭐ +${battleExp} EXP`,
    );
  } else {
    battleGold = -Math.floor((rawPlayer.gold || 0) * 0.1);
    log.push(`💀 *Defeat!* You were slain by *${monster.name}*`);
  }

  // Update summon uses
  if (rawPlayer.activeSummon && rawPlayer.activeSummon.uses > 0) {
    rawPlayer.activeSummon.uses -= 1;
    if (rawPlayer.activeSummon.uses <= 0) {
      log.push(`\n🎴 *${rawPlayer.activeSummon.name}* kembali ke dimensi asalnya.`);
    }
  }

  return {
    playerWon,
    log,
    rewards:         { gold: battleGold, exp: battleExp, loot },
    finalHp:         Math.max(0, player.currentHp),
    finalMana:       Math.max(0, player.currentMana),
    monsterFinalHp:  Math.max(0, monster.currentHp),
    totalDmg:        totalDmgDealt,
    eventId:         event.id,
    skillCooldowns:  Object.fromEntries(player.skillCooldowns),
  };
}

// ── Apply rewards to player ───────────────────────────────────────────────────

export async function applyRewards(player, rewards) {
  const messages = [];

  player.gold = Math.max(0, (player.gold || 0) + rewards.gold);

  for (const drop of rewards.loot || []) {
    addItem(player, drop.itemId, drop.qty);
  }

  if (rewards.exp > 0) {
    const levelResult = await awardExp(player, rewards.exp);
    messages.push(...safeArray(levelResult.messages));
  }

  return messages;
}

export default { executeBattle, applyRewards };
