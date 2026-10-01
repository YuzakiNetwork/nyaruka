/**
 * lib/game/quest.js
 * Dynamic quest generation with economy-aware rewards.
 *
 * Quest rewards scale with:
 *   - Player level
 *   - Current world event (economy state)
 *   - Random bonus roll
 *   - Player reputation
 */

import db from '../database/db.js';
import { randInt, chance, pick, weightedPick } from '../utils/random.js';
import { getWorldEvent } from './economy.js';

const QUEST_COL = 'quests';

// ── Quest templates ───────────────────────────────────────────────────────────

export const QUEST_TEMPLATES = [
  {
    id: 'slay_wolves',
    title: '🐺 Wolf Culling',
    description: 'The village is plagued by wolves. Slay {count} Forest Wolves.',
    type: 'kill',
    targetId: 'forest_wolf',
    countRange: [3, 8],
    difficulty: 1,
    baseRewardGold: 80,
    baseRewardExp: 60,
    rewardItems: [
      { itemId: 'health_potion', qty: 2, chance: 0.8 },
    ],
  },
  {
    id: 'goblin_raid',
    title: '👺 Goblin Raid',
    description: 'Goblin scouts are raiding caravans. Defeat {count} Goblin Scouts.',
    type: 'kill',
    targetId: 'goblin_scout',
    countRange: [5, 10],
    difficulty: 1,
    baseRewardGold: 100,
    baseRewardExp: 80,
    rewardItems: [
      { itemId: 'ancient_rune', qty: 1, chance: 0.5 },
    ],
  },
  {
    id: 'dungeon_clear',
    title: '🏰 Dungeon Delver',
    description: 'Clear a dungeon and reach floor {floor}.',
    type: 'dungeon',
    targetId: 'dungeon',
    countRange: [5, 10],
    difficulty: 3,
    baseRewardGold: 300,
    baseRewardExp: 250,
    rewardItems: [
      { itemId: 'mega_potion',  qty: 2, chance: 0.9 },
      { itemId: 'monster_core', qty: 1, chance: 0.6 },
    ],
  },
  {
    id: 'gather_materials',
    title: '⛏️ Material Gathering',
    description: 'The blacksmith needs {count} Wolf Fangs. Gather them.',
    type: 'collect',
    targetId: 'wolf_fang',
    countRange: [3, 6],
    difficulty: 1,
    baseRewardGold: 60,
    baseRewardExp: 40,
    rewardItems: [],
  },
  {
    id: 'elite_hunt',
    title: '⭐ Elite Hunter',
    description: 'Prove yourself by defeating an Elite monster.',
    type: 'kill_elite',
    targetId: 'any_elite',
    countRange: [1, 3],
    difficulty: 2,
    baseRewardGold: 200,
    baseRewardExp: 180,
    rewardItems: [
      { itemId: 'ancient_rune', qty: 2, chance: 0.7 },
      { itemId: 'swift_amulet', qty: 1, chance: 0.15 },
    ],
  },
  {
    id: 'dragon_slayer',
    title: '🐉 Dragon Slayer',
    description: 'An Ancient Dragon has been spotted. Slay it.',
    type: 'kill',
    targetId: 'ancient_dragon',
    countRange: [1, 1],
    difficulty: 5,
    baseRewardGold: 2000,
    baseRewardExp: 1500,
    rewardItems: [
      { itemId: 'dragon_scale_mat', qty: 2, chance: 1.0 },
      { itemId: 'dragon_eye',       qty: 1, chance: 0.2 },
    ],
  },
];

// ── Quest generation ──────────────────────────────────────────────────────────

/**
 * Generate a dynamic quest for a player.
 * Scales rewards with level, reputation, economy state.
 *
 * @param {Object} player
 */
export async function generateQuest(player) {
  const level      = player.level;
  const reputation = player.reputation || 0;

  // Filter appropriate difficulty quests
  const diffCap = Math.ceil(level / 20) + 1;  // unlock harder quests as level grows
  const pool = QUEST_TEMPLATES.filter(q => q.difficulty <= diffCap);

  const template = pick(pool);
  const count    = randInt(template.countRange[0], template.countRange[1]);

  // Economy-aware reward multiplier
  const worldEvent = await getWorldEvent();
  const expMult    = worldEvent?.effects?.expMult  ?? 1.0;
  const goldMult   = worldEvent?.effects?.sellPriceMult ?? 1.0;

  // Reputation bonus (0–50% gold/exp bonus at max rep)
  const repBonus = 1 + Math.min(reputation / 1000, 0.5);

  // Level scaling (higher level = higher rewards)
  const levelMult = 1 + (level - 1) * 0.05;

  // Random bonus (5–30% surprise bonus)
  const randomBonus = 1 + (Math.random() * 0.25 + 0.05);

  const rewardGold = Math.floor(
    template.baseRewardGold * levelMult * goldMult * repBonus * randomBonus
  );
  const rewardExp = Math.floor(
    template.baseRewardExp * levelMult * expMult * repBonus * randomBonus
  );

  // Roll reward items
  const rewardItems = template.rewardItems
    .filter(ri => chance(ri.chance))
    .map(ri => ({ itemId: ri.itemId, qty: ri.qty }));

  const description = template.description
    .replace('{count}', count)
    .replace('{floor}', Math.min(count, 10));

  return {
    id:           `${template.id}_${Date.now()}`,
    templateId:   template.id,
    title:        template.title,
    description,
    type:         template.type,
    targetId:     template.targetId,
    required:     count,
    progress:     0,
    completed:    false,
    rewards: {
      gold:  rewardGold,
      exp:   rewardExp,
      items: rewardItems,
    },
    worldEvent:   worldEvent?.id || 'none',
    generatedAt:  Date.now(),
    expiresAt:    Date.now() + 24 * 60 * 60 * 1000,  // 24hr expiry
  };
}

/**
 * Progress a quest for the player.
 * @param {Object} quest
 * @param {string} targetId — what was killed/collected
 * @param {number} count
 * @returns {boolean} wasCompleted
 */
export function progressQuest(quest, targetId, count = 1) {
  if (quest.completed) return false;
  if (quest.targetId !== targetId && quest.targetId !== 'any_elite') return false;

  quest.progress = Math.min(quest.required, quest.progress + count);
  quest.completed = quest.progress >= quest.required;
  return quest.completed;
}

/**
 * Format quest for display.
 */
export function formatQuest(quest) {
  const bar = progressBar(quest.progress, quest.required);
  const expired = Date.now() > quest.expiresAt;

  return (
    `📜 *${quest.title}*\n` +
    `${quest.description}\n\n` +
    `Progress: ${bar} (${quest.progress}/${quest.required})\n\n` +
    `🎁 Rewards:\n` +
    `  💰 ${quest.rewards.gold}g\n` +
    `  ⭐ ${quest.rewards.exp} EXP\n` +
    (quest.rewards.items.length
      ? `  🎒 ${quest.rewards.items.map(i => `${i.itemId} x${i.qty}`).join(', ')}\n`
      : '') +
    (expired ? '\n⚠️ *Quest Expired!*' : '')
  );
}

function progressBar(current, max, length = 10) {
  const filled = Math.round((current / max) * length);
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}

export default {
  QUEST_TEMPLATES, generateQuest, progressQuest, formatQuest,
};
