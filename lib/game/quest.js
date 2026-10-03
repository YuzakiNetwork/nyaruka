/**
 * lib/game/quest.js
 * Quest system: pilih quest sendiri, level minimal, progress real-time.
 *
 * Reward quest dipengaruhi oleh:
 *   - Level pemain
 *   - World event (economy)
 *   - Bonus acak
 *   - Reputasi pemain
 */

import { randInt, chance } from '../utils/random.js';
import { getWorldEvent } from './economy.js';
import { savePlayer } from './player.js';

// ── Template quest ────────────────────────────────────────────────────────────
// Urutan array = nomor di !quest list (urut dari minLevel terendah).

export const QUEST_TEMPLATES = [
  {
    id: 'slay_wolves',
    title: '🐺 Wolf Culling',
    description: 'Desa diganggu serigala. Bunuh {count} Forest Wolf.',
    type: 'kill',
    targetId: 'forest_wolf',
    countRange: [3, 8],
    minLevel: 1,
    baseRewardGold: 80,
    baseRewardExp: 60,
    rewardItems: [
      { itemId: 'health_potion', qty: 2, chance: 0.8 },
    ],
  },
  {
    id: 'gather_materials',
    title: '⛏️ Material Gathering',
    description: 'Pandai besi butuh {count} Wolf Fang. Kumpulkan.',
    type: 'collect',
    targetId: 'wolf_fang',
    countRange: [3, 6],
    minLevel: 1,
    baseRewardGold: 60,
    baseRewardExp: 40,
    rewardItems: [],
  },
  {
    id: 'goblin_raid',
    title: '👺 Goblin Raid',
    description: 'Goblin Scout merampok kafilah. Kalahkan {count} Goblin Scout.',
    type: 'kill',
    targetId: 'goblin_scout',
    countRange: [5, 10],
    minLevel: 5,
    baseRewardGold: 100,
    baseRewardExp: 80,
    rewardItems: [
      { itemId: 'ancient_rune', qty: 1, chance: 0.5 },
    ],
  },
  {
    id: 'elite_hunt',
    title: '⭐ Elite Hunter',
    description: 'Buktikan dirimu dengan mengalahkan {count} monster Elite.',
    type: 'kill_elite',
    targetId: 'any_elite',
    countRange: [1, 3],
    minLevel: 15,
    baseRewardGold: 200,
    baseRewardExp: 180,
    rewardItems: [
      { itemId: 'ancient_rune', qty: 2, chance: 0.7 },
      { itemId: 'swift_amulet', qty: 1, chance: 0.15 },
    ],
  },
  {
    id: 'dungeon_clear',
    title: '🏰 Dungeon Delver',
    description: 'Taklukkan dungeon dan capai lantai {floor}.',
    type: 'dungeon',
    targetId: 'dungeon',
    countRange: [5, 10],
    minLevel: 25,
    baseRewardGold: 300,
    baseRewardExp: 250,
    rewardItems: [
      { itemId: 'mega_potion',  qty: 2, chance: 0.9 },
      { itemId: 'monster_core', qty: 1, chance: 0.6 },
    ],
  },
  {
    id: 'dragon_slayer',
    title: '🐉 Dragon Slayer',
    description: 'Ancient Dragon terlihat di pegunungan. Bunuh {count} naga.',
    type: 'kill',
    targetId: 'ancient_dragon',
    countRange: [1, 1],
    minLevel: 50,
    baseRewardGold: 2000,
    baseRewardExp: 1500,
    rewardItems: [
      { itemId: 'dragon_scale_mat', qty: 2, chance: 1.0 },
      { itemId: 'dragon_eye',       qty: 1, chance: 0.2 },
    ],
  },
];

// Nama tampilan item (fallback ke itemId kalau belum didaftarkan)
const ITEM_NAMES = {
  health_potion:    'Health Potion',
  mega_potion:      'Mega Potion',
  ancient_rune:     'Ancient Rune',
  monster_core:     'Monster Core',
  swift_amulet:     'Swift Amulet',
  dragon_scale_mat: 'Dragon Scale',
  dragon_eye:       'Dragon Eye',
  wolf_fang:        'Wolf Fang',
};

const QUEST_DURATION_MS = 24 * 60 * 60 * 1000;

// ── Helper ────────────────────────────────────────────────────────────────────

export function itemName(itemId) {
  return ITEM_NAMES[itemId] || itemId;
}

/** Cari template dari nomor (1-based) atau id. */
export function findTemplate(input) {
  if (input === undefined || input === null || input === '') return null;
  const str = String(input).toLowerCase();
  if (/^\d+$/.test(str)) return QUEST_TEMPLATES[Number(str) - 1] || null;
  return QUEST_TEMPLATES.find(t => t.id === str) || null;
}

/** Quest masih "hidup" jika sudah selesai (tidak pernah kedaluwarsa) atau belum lewat waktu. */
export function isQuestLive(quest) {
  return !!quest && (quest.completed || Date.now() < quest.expiresAt);
}

/** Cek apakah pemain boleh mengambil template tertentu. */
export function canTakeQuest(player, template) {
  if (!template) return { ok: false, reason: 'Quest tidak ditemukan.' };
  if ((player.level || 1) < template.minLevel) {
    return {
      ok: false,
      reason: `Level kamu belum cukup. Butuh minimal *Lv.${template.minLevel}* (kamu Lv.${player.level || 1}).`,
    };
  }
  return { ok: true };
}

function progressBar(current, max, length = 10) {
  const ratio  = max > 0 ? Math.min(current / max, 1) : 0;
  const filled = Math.round(ratio * length);
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}

function formatRemaining(ms) {
  if (ms <= 0) return '0 menit';
  const totalMin = Math.ceil(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} jam ${m} menit` : `${m} menit`;
}

// ── Daftar quest ──────────────────────────────────────────────────────────────

/** Daftar quest untuk ditampilkan ke pemain. */
export function formatQuestList(player) {
  const level = player.level || 1;
  const lines = QUEST_TEMPLATES.map((t, i) => {
    const locked = level < t.minLevel;
    const count  = t.countRange[0] === t.countRange[1]
      ? `${t.countRange[0]}`
      : `${t.countRange[0]}-${t.countRange[1]}`;
    return (
      `${locked ? '🔒' : '✅'} *${i + 1}. ${t.title}*  (Lv.${t.minLevel}+)\n` +
      `   Target: ${count} • Hadiah dasar: ${t.baseRewardGold}g, ${t.baseRewardExp} EXP`
    );
  });

  return (
    `📋 *Daftar Quest*\n\n` +
    lines.join('\n\n') +
    `\n\nAmbil dengan *!quest take <nomor>*\n` +
    `Contoh: *!quest take 1*`
  );
}

// ── Generate quest ────────────────────────────────────────────────────────────

/**
 * Buat quest dari template yang dipilih pemain.
 * Validasi level dilakukan lewat canTakeQuest() (dicek lagi di sini untuk keamanan).
 *
 * @param {Object} player
 * @param {string|number} templateRef — nomor atau id template
 */
export async function generateQuest(player, templateRef) {
  const template = findTemplate(templateRef);
  const check = canTakeQuest(player, template);
  if (!check.ok) throw new Error(check.reason);

  const level      = player.level || 1;
  const reputation = player.reputation || 0;
  const count      = randInt(template.countRange[0], template.countRange[1]);

  // Multiplier dari world event
  const worldEvent = await getWorldEvent();
  const expMult    = worldEvent?.effects?.expMult ?? 1.0;
  const goldMult   = worldEvent?.effects?.questGoldMult
                  ?? worldEvent?.effects?.sellPriceMult
                  ?? 1.0;

  const repBonus    = 1 + Math.min(reputation / 1000, 0.5);   // maks +50%
  const levelMult   = 1 + (level - 1) * 0.05;
  const randomBonus = 1 + (Math.random() * 0.25 + 0.05);      // +5–30%

  const rewardGold = Math.floor(
    template.baseRewardGold * levelMult * goldMult * repBonus * randomBonus
  );
  const rewardExp = Math.floor(
    template.baseRewardExp * levelMult * expMult * repBonus * randomBonus
  );

  const rewardItems = template.rewardItems
    .filter(ri => chance(ri.chance))
    .map(ri => ({ itemId: ri.itemId, qty: ri.qty }));

  const description = template.description
    .replaceAll('{count}', count)
    .replaceAll('{floor}', Math.min(count, 10));

  return {
    id:          `${template.id}_${Date.now()}`,
    templateId:  template.id,
    title:       template.title,
    description,
    type:        template.type,
    targetId:    template.targetId,
    minLevel:    template.minLevel,
    required:    count,
    progress:    0,
    completed:   false,
    log:         [],
    rewards: {
      gold:  rewardGold,
      exp:   rewardExp,
      items: rewardItems,
    },
    worldEvent:  worldEvent?.id || 'none',
    generatedAt: Date.now(),
    expiresAt:   Date.now() + QUEST_DURATION_MS,
  };
}

// ── Progress ──────────────────────────────────────────────────────────────────

/**
 * Tambah progress ke quest (mengubah objek langsung, TIDAK menyimpan).
 * Untuk pemakaian normal, gunakan trackQuest() di bawah.
 *
 * @param {Object}  quest
 * @param {string}  targetId — monster/item yang dibunuh/didapat
 * @param {number}  count
 * @param {Object}  opts
 * @param {boolean} opts.isElite — true jika monster yang dibunuh adalah Elite
 * @returns {boolean} true jika quest baru saja selesai
 */
export function progressQuest(quest, targetId, count = 1, { isElite = false } = {}) {
  if (!quest || quest.completed) return false;
  if (Date.now() > quest.expiresAt) return false;

  const matches = quest.targetId === 'any_elite'
    ? isElite
    : quest.targetId === targetId;
  if (!matches) return false;

  const before = quest.progress;
  quest.progress  = Math.min(quest.required, quest.progress + count);
  quest.completed = quest.progress >= quest.required;

  // Catatan progress (maks 20 entri terakhir)
  if (!Array.isArray(quest.log)) quest.log = [];
  quest.log.push({ at: Date.now(), targetId, gained: quest.progress - before });
  if (quest.log.length > 20) quest.log.shift();

  return quest.completed;
}

/**
 * Progress real-time: update quest aktif pemain, simpan, dan kembalikan pesan.
 *
 * Panggil dari command lain (hunt, dungeon, drop item, dll):
 *
 *   const q = await trackQuest(player, monster.id, 1, { isElite: monster.elite });
 *   if (q) await m.reply(q.message);
 *
 * @returns {Promise<null | {gained, progress, required, completed, message}>}
 *          null jika tidak ada quest yang relevan / tidak ada perubahan.
 */
export async function trackQuest(player, targetId, count = 1, opts = {}) {
  const quest = player?.activeQuest;
  if (!isQuestLive(quest)) return null;

  const before = quest.progress;
  progressQuest(quest, targetId, count, opts);
  const gained = quest.progress - before;
  if (gained <= 0) return null;

  await savePlayer(player);

  const bar = progressBar(quest.progress, quest.required);
  const message = quest.completed
    ? `✅ *Quest selesai!* ${quest.title}\n${bar} (${quest.progress}/${quest.required})\nKetik *!quest claim* untuk ambil hadiah.`
    : `📜 *${quest.title}*\n${bar} (${quest.progress}/${quest.required})`;

  return {
    gained,
    progress:  quest.progress,
    required:  quest.required,
    completed: quest.completed,
    message,
  };
}

// ── Tampilan ──────────────────────────────────────────────────────────────────

/** Format quest aktif untuk ditampilkan. */
export function formatQuest(quest) {
  const bar     = progressBar(quest.progress, quest.required);
  const expired = !quest.completed && Date.now() > quest.expiresAt;
  const status  = quest.completed
    ? '\n✅ *Selesai! Ketik !quest claim*'
    : expired
      ? '\n⚠️ *Quest kedaluwarsa!*'
      : `\n⏰ Sisa waktu: ${formatRemaining(quest.expiresAt - Date.now())}`;

  return (
    `📜 *${quest.title}*  (Lv.${quest.minLevel || 1}+)\n` +
    `${quest.description}\n\n` +
    `Progress: ${bar} (${quest.progress}/${quest.required})\n\n` +
    `🎁 Hadiah:\n` +
    `  💰 ${quest.rewards.gold}g\n` +
    `  ⭐ ${quest.rewards.exp} EXP\n` +
    (quest.rewards.items?.length
      ? `  🎒 ${quest.rewards.items.map(i => `${itemName(i.itemId)} ×${i.qty}`).join(', ')}\n`
      : '') +
    status
  );
}

export default {
  QUEST_TEMPLATES,
  findTemplate,
  canTakeQuest,
  isQuestLive,
  itemName,
  generateQuest,
  progressQuest,
  trackQuest,
  formatQuest,
  formatQuestList,
};
