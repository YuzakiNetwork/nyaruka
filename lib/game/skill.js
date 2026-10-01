/**
 * lib/game/skill.js
 * Skill definitions and execution logic.
 * Skills are referenced by ID and resolved at battle time.
 */

import { randInt, chance, clamp } from '../utils/random.js';

// ── Skill Schema ──────────────────────────────────────────────────────────────
// {
//   id:          string
//   name:        string
//   class:       string[]        — which classes can use it
//   manaCost:    number
//   cooldown:    number          — turns
//   type:        damage|heal|buff|debuff|utility
//   element:     string
//   description: string
//   execute:     fn(user, target, context) → { messages[], damage, healing, effect }
// }

export const SKILLS = {

  // ════════════════════════════════════════════════
  //  WARRIOR
  // ════════════════════════════════════════════════

  power_strike: {
    id: 'power_strike', name: '⚔️ Power Strike',
    class: ['Warrior'], manaCost: 15, cooldown: 2,
    type: 'damage', element: 'neutral',
    description: 'A heavy strike dealing 150% ATK damage.',
    execute(user, target) {
      const dmg = Math.floor(user.effectiveAttack * 1.5);
      const final = clamp(dmg - target.effectiveDefense / 2, 1, 9999);
      return {
        damage: final,
        messages: [`⚔️ *Power Strike* slams ${target.name} for *${final}* damage!`],
      };
    },
  },

  shield_bash: {
    id: 'shield_bash', name: '🛡️ Shield Bash',
    class: ['Warrior'], manaCost: 10, cooldown: 3,
    type: 'debuff', element: 'neutral',
    description: 'Stuns target for 1 turn and deals 80% ATK.',
    execute(user, target) {
      const dmg = Math.floor(user.effectiveAttack * 0.8);
      const final = clamp(dmg - target.effectiveDefense, 1, 9999);
      return {
        damage: final,
        statusEffect: { id: 'stun', name: '💫 Stun', duration: 1, skipTurn: true },
        messages: [
          `🛡️ *Shield Bash* hits ${target.name} for *${final}* damage!`,
          `💫 ${target.name} is *stunned* for 1 turn!`,
        ],
      };
    },
  },

  berserker_rage: {
    id: 'berserker_rage', name: '🔥 Berserker Rage',
    class: ['Warrior'], manaCost: 30, cooldown: 5,
    type: 'buff', element: 'neutral',
    description: 'ATK +50% for 3 turns but DEF -30%.',
    execute(user) {
      return {
        damage: 0,
        selfEffect: [
          { id: 'atk_up',  name: '💪 ATK+50%', duration: 3, attackMult: 1.5 },
          { id: 'def_down', name: '💔 DEF-30%', duration: 3, defenseMult: 0.7 },
        ],
        messages: [
          `🔥 *${user.name}* enters BERSERKER RAGE!`,
          `💪 ATK +50% | ⚠️ DEF -30% for 3 turns!`,
        ],
      };
    },
  },

  // ════════════════════════════════════════════════
  //  MAGE
  // ════════════════════════════════════════════════

  fireball: {
    id: 'fireball', name: '🔥 Fireball',
    class: ['Mage'], manaCost: 25, cooldown: 2,
    type: 'damage', element: 'fire',
    description: 'Launches a fireball, 170% ATK. May burn.',
    execute(user, target) {
      const dmg = Math.floor(user.effectiveAttack * 1.7);
      const final = clamp(dmg - Math.floor(target.effectiveDefense * 0.5), 1, 9999);
      const burned = chance(0.3);
      return {
        damage: final,
        statusEffect: burned
          ? { id: 'burn', name: '🔥 Burn', duration: 3, tickDamage: Math.floor(final * 0.1) }
          : null,
        messages: [
          `🔥 *Fireball* scorches ${target.name} for *${final}* fire damage!`,
          burned ? `🔥 ${target.name} is set *on fire*! (${Math.floor(final * 0.1)}/turn)` : '',
        ].filter(Boolean),
      };
    },
  },

  arcane_bolt: {
    id: 'arcane_bolt', name: '⚡ Arcane Bolt',
    class: ['Mage'], manaCost: 12, cooldown: 1,
    type: 'damage', element: 'neutral',
    description: 'Fast arcane bolt. Ignores 40% of defense.',
    execute(user, target) {
      const dmg = Math.floor(user.effectiveAttack * 1.2);
      const final = clamp(dmg - Math.floor(target.effectiveDefense * 0.6), 1, 9999);
      return {
        damage: final,
        messages: [`⚡ *Arcane Bolt* pierces ${target.name} for *${final}* damage!`],
      };
    },
  },

  blizzard: {
    id: 'blizzard', name: '❄️ Blizzard',
    class: ['Mage'], manaCost: 40, cooldown: 4,
    type: 'damage', element: 'water',
    description: 'Ice storm hits for 200% ATK and slows.',
    execute(user, target) {
      const dmg = Math.floor(user.effectiveAttack * 2.0);
      const final = clamp(dmg - Math.floor(target.effectiveDefense * 0.4), 1, 9999);
      return {
        damage: final,
        statusEffect: { id: 'slow', name: '🐌 Slow', duration: 2, speedMult: 0.5 },
        messages: [
          `❄️ *Blizzard* engulfs ${target.name} for *${final}* ice damage!`,
          `🐌 ${target.name} is *slowed* (Speed -50%) for 2 turns!`,
        ],
      };
    },
  },

  mana_shield: {
    id: 'mana_shield', name: '🔵 Mana Shield',
    class: ['Mage'], manaCost: 20, cooldown: 4,
    type: 'buff', element: 'neutral',
    description: 'Absorbs next 150 damage using mana.',
    execute(user) {
      return {
        damage: 0,
        selfEffect: [{ id: 'shield', name: '🔵 Mana Shield', duration: 3, absorbAmount: 150 }],
        messages: [`🔵 *${user.name}* raises a Mana Shield! (Absorbs 150 damage)`],
      };
    },
  },

  // ════════════════════════════════════════════════
  //  ARCHER
  // ════════════════════════════════════════════════

  rapid_shot: {
    id: 'rapid_shot', name: '🏹 Rapid Shot',
    class: ['Archer'], manaCost: 18, cooldown: 2,
    type: 'damage', element: 'wind',
    description: 'Fires 3 arrows. Each deals 60% ATK.',
    execute(user, target) {
      let total = 0;
      const hits = [];
      for (let i = 0; i < 3; i++) {
        const dmg = Math.max(1, Math.floor(user.effectiveAttack * 0.6) - Math.floor(target.effectiveDefense * 0.3));
        total += dmg;
        hits.push(dmg);
      }
      return {
        damage: total,
        messages: [
          `🏹 *Rapid Shot* — 3 arrows! [${hits.join(' + ')}] = *${total}* total damage!`,
        ],
      };
    },
  },

  eagle_eye: {
    id: 'eagle_eye', name: '🦅 Eagle Eye',
    class: ['Archer'], manaCost: 15, cooldown: 3,
    type: 'buff', element: 'neutral',
    description: 'Next attack is guaranteed crit + 200% damage.',
    execute(user) {
      return {
        damage: 0,
        selfEffect: [{ id: 'guaranteed_crit', name: '🎯 Guaranteed Crit', duration: 1, guaranteedCrit: true, critDamage: 2.0 }],
        messages: [`🦅 *${user.name}* focuses — next strike is a *GUARANTEED CRITICAL*!`],
      };
    },
  },

  poison_arrow: {
    id: 'poison_arrow', name: '☠️ Poison Arrow',
    class: ['Archer'], manaCost: 20, cooldown: 3,
    type: 'damage', element: 'neutral',
    description: 'Poisons target, dealing damage for 4 turns.',
    execute(user, target) {
      const dot = Math.floor(user.effectiveAttack * 0.3);
      const hit = Math.max(1, Math.floor(user.effectiveAttack * 0.7) - target.effectiveDefense);
      return {
        damage: hit,
        statusEffect: { id: 'poison', name: '☠️ Poison', duration: 4, tickDamage: dot },
        messages: [
          `☠️ *Poison Arrow* hits for *${hit}* damage!`,
          `🟢 ${target.name} is *poisoned*! (${dot} per turn for 4 turns)`,
        ],
      };
    },
  },

  // ════════════════════════════════════════════════
  //  ASSASSIN
  // ════════════════════════════════════════════════

  backstab: {
    id: 'backstab', name: '🗡️ Backstab',
    class: ['Assassin'], manaCost: 20, cooldown: 2,
    type: 'damage', element: 'neutral',
    description: 'Ignores defense entirely. 200% ATK.',
    execute(user, target) {
      const dmg = Math.floor(user.effectiveAttack * 2.0);  // true damage
      return {
        damage: dmg,
        trueDamage: true,
        messages: [
          `🗡️ *Backstab!* ${user.name} strikes from the shadows — *${dmg}* TRUE damage!`,
        ],
      };
    },
  },

  shadowstep: {
    id: 'shadowstep', name: '👥 Shadowstep',
    class: ['Assassin'], manaCost: 15, cooldown: 3,
    type: 'utility', element: 'neutral',
    description: 'Dodge next attack + counterattack for 150% ATK.',
    execute(user) {
      return {
        damage: 0,
        selfEffect: [
          { id: 'dodge_next', name: '👥 Dodge+Counter', duration: 1, dodgesNextAttack: true, counterPercent: 1.5 },
        ],
        messages: [`👥 *${user.name}* vanishes into the shadows... ready to counter!`],
      };
    },
  },

  death_mark: {
    id: 'death_mark', name: '💀 Death Mark',
    class: ['Assassin'], manaCost: 35, cooldown: 5,
    type: 'debuff', element: 'neutral',
    description: 'Mark target — they take +40% damage for 3 turns.',
    execute(user, target) {
      return {
        damage: 0,
        statusEffect: { id: 'death_mark', name: '💀 Death Mark', duration: 3, damageReceivedMult: 1.4 },
        messages: [
          `💀 *Death Mark* is placed on ${target.name}!`,
          `⚠️ They will take *40% more damage* for 3 turns!`,
        ],
      };
    },
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getSkill(id) {
  return SKILLS[id] || null;
}

export function getClassSkills(cls) {
  return Object.values(SKILLS).filter(s => s.class.includes(cls));
}

/**
 * Check if player can use a skill (mana, cooldown).
 * @param {Object} player
 * @param {string} skillId
 * @param {Map} cooldownMap  — Map of skillId → turnsRemaining
 */
export function canUseSkill(player, skillId, cooldownMap = new Map()) {
  const skill = getSkill(skillId);
  if (!skill) return { can: false, reason: 'Skill not found.' };
  if (!player.skills.includes(skillId))  return { can: false, reason: "You don't know this skill." };
  if (player.mana < skill.manaCost)      return { can: false, reason: `Not enough mana. (${player.mana}/${skill.manaCost})` };
  if ((cooldownMap.get(skillId) || 0) > 0) {
    return { can: false, reason: `Skill on cooldown (${cooldownMap.get(skillId)} turns left).` };
  }
  return { can: true };
}

export default { SKILLS, getSkill, getClassSkills, canUseSkill };
