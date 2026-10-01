/**
 * lib/game/job.js
 * Job Advancement System — Class Evolution bertingkat ala anime isekai
 *
 * Tree:
 *   Warrior  → Knight (30) → Paladin (60) → Dragon Knight (90)
 *                          → Berserker (60) → Chaos Lord (90)
 *   Mage     → Archmage (30) → Sage (60) → Transcendent (90)
 *                            → Necromancer (60) → Lich King (90)
 *   Archer   → Ranger (30) → Sniper (60) → God Archer (90)
 *                          → Beastmaster (60) → Wild Emperor (90)
 *   Assassin → Shadow (30) → Phantom (60) → Death God (90)
 *                          → Reaper (60) → Sin Eater (90)
 */

// ── Job Tree ──────────────────────────────────────────────────────────────────
export const JOB_TREE = {

  // ── WARRIOR LINE ───────────────────────────────────────────────────────────
  Warrior: {
    tier: 1, emoji: '⚔️', element: 'earth',
    description: 'Prajurit tangguh dengan pertahanan tinggi.',
    nextJobs: ['Knight'],
    reqLevel: 1,
    statBonus: {},
    passiveSkill: null,
  },
  Knight: {
    tier: 2, emoji: '🛡️', element: 'earth',
    description: 'Ksatria pelindung dengan aura pertahanan.',
    prevJob: 'Warrior', nextJobs: ['Paladin', 'Berserker'],
    reqLevel: 30,
    statBonus: { hp: 100, defense: 30, attack: 15 },
    passiveSkill: 'iron_will',
    unlockSkills: ['holy_shield', 'war_cry'],
  },
  Paladin: {
    tier: 3, emoji: '✨', element: 'light',
    description: 'Ksatria cahaya yang bisa heal dan menyerang.',
    prevJob: 'Knight', nextJobs: ['Dragon Knight'],
    reqLevel: 60,
    statBonus: { hp: 200, defense: 50, attack: 30, mana: 80 },
    passiveSkill: 'holy_aura',
    unlockSkills: ['divine_smite', 'resurrect'],
  },
  Berserker: {
    tier: 3, emoji: '🔥', element: 'fire',
    description: 'Berserker yang menukar DEF dengan ATK brutal.',
    prevJob: 'Knight', nextJobs: ['Chaos Lord'],
    reqLevel: 60,
    statBonus: { hp: 150, attack: 80, speed: 20, defense: -10 },
    passiveSkill: 'blood_rage',
    unlockSkills: ['berserk_slash', 'carnage'],
  },
  'Dragon Knight': {
    tier: 4, emoji: '🐉', element: 'fire',
    description: '[ PINNACLE ] Menunggangi naga, menyatukan kekuatan langit dan bumi.',
    prevJob: 'Paladin', nextJobs: [],
    reqLevel: 90,
    statBonus: { hp: 500, attack: 150, defense: 100, speed: 40, mana: 150 },
    passiveSkill: 'dragon_soul',
    unlockSkills: ['dragon_breath', 'heavenly_strike', 'final_dragon'],
  },
  'Chaos Lord': {
    tier: 4, emoji: '💢', element: 'dark',
    description: '[ PINNACLE ] Penguasa kekacauan yang menghancurkan segalanya.',
    prevJob: 'Berserker', nextJobs: [],
    reqLevel: 90,
    statBonus: { hp: 400, attack: 200, speed: 60, mana: 50 },
    passiveSkill: 'chaos_incarnate',
    unlockSkills: ['void_slash', 'annihilation'],
  },

  // ── MAGE LINE ──────────────────────────────────────────────────────────────
  Mage: {
    tier: 1, emoji: '🔮', element: 'neutral',
    description: 'Penyihir dengan kekuatan sihir tinggi.',
    nextJobs: ['Archmage'],
    reqLevel: 1,
    statBonus: {},
    passiveSkill: null,
  },
  Archmage: {
    tier: 2, emoji: '🌟', element: 'neutral',
    description: 'Penyihir agung penguasa semua elemen.',
    prevJob: 'Mage', nextJobs: ['Sage', 'Necromancer'],
    reqLevel: 30,
    statBonus: { mana: 150, attack: 40, hp: 30 },
    passiveSkill: 'mana_surge',
    unlockSkills: ['meteor', 'chain_lightning'],
  },
  Sage: {
    tier: 3, emoji: '📖', element: 'light',
    description: 'Bijak agung yang menguasai sihir kuno.',
    prevJob: 'Archmage', nextJobs: ['Transcendent'],
    reqLevel: 60,
    statBonus: { mana: 300, attack: 60, hp: 80, speed: 15 },
    passiveSkill: 'ancient_wisdom',
    unlockSkills: ['time_stop', 'gravity_well'],
  },
  Necromancer: {
    tier: 3, emoji: '💀', element: 'dark',
    description: 'Pemanggil arwah yang mengedalikan kematian.',
    prevJob: 'Archmage', nextJobs: ['Lich King'],
    reqLevel: 60,
    statBonus: { mana: 200, attack: 80, hp: 50 },
    passiveSkill: 'undying',
    unlockSkills: ['soul_harvest', 'army_of_dead'],
  },
  Transcendent: {
    tier: 4, emoji: '🌌', element: 'void',
    description: '[ PINNACLE ] Melampaui batas manusia, menyentuh hukum semesta.',
    prevJob: 'Sage', nextJobs: [],
    reqLevel: 90,
    statBonus: { mana: 700, attack: 180, hp: 200, speed: 30 },
    passiveSkill: 'law_of_nature',
    unlockSkills: ['big_bang', 'singularity', 'akashic_record'],
  },
  'Lich King': {
    tier: 4, emoji: '☠️', element: 'dark',
    description: '[ PINNACLE ] Raja kematian yang tak bisa dibunuh.',
    prevJob: 'Necromancer', nextJobs: [],
    reqLevel: 90,
    statBonus: { mana: 500, attack: 200, hp: 150, defense: 80 },
    passiveSkill: 'phylactery',
    unlockSkills: ['death_coil', 'apocalypse', 'undead_army'],
  },

  // ── ARCHER LINE ────────────────────────────────────────────────────────────
  Archer: {
    tier: 1, emoji: '🏹', element: 'wind',
    description: 'Penembak jitu dengan kecepatan tinggi.',
    nextJobs: ['Ranger'],
    reqLevel: 1,
    statBonus: {},
    passiveSkill: null,
  },
  Ranger: {
    tier: 2, emoji: '🌿', element: 'wind',
    description: 'Penjaga hutan, ahli jebakan dan alam.',
    prevJob: 'Archer', nextJobs: ['Sniper', 'Beastmaster'],
    reqLevel: 30,
    statBonus: { speed: 30, attack: 25, hp: 60 },
    passiveSkill: 'keen_eye',
    unlockSkills: ['multi_shot', 'poison_arrow'],
  },
  Sniper: {
    tier: 3, emoji: '🎯', element: 'wind',
    description: 'Penembak legendaris, tidak pernah meleset.',
    prevJob: 'Ranger', nextJobs: ['God Archer'],
    reqLevel: 60,
    statBonus: { speed: 50, attack: 70, hp: 50 },
    passiveSkill: 'zero_miss',
    unlockSkills: ['piercing_shot', 'headshot'],
  },
  Beastmaster: {
    tier: 3, emoji: '🦁', element: 'earth',
    description: 'Penguasa binatang buas yang bertarung bersama kawanan.',
    prevJob: 'Ranger', nextJobs: ['Wild Emperor'],
    reqLevel: 60,
    statBonus: { speed: 40, attack: 50, hp: 100, defense: 20 },
    passiveSkill: 'pack_leader',
    unlockSkills: ['summon_beast', 'feral_fury'],
  },
  'God Archer': {
    tier: 4, emoji: '⚡', element: 'void',
    description: '[ PINNACLE ] Memanah bintang, anak panah menembus dimensi.',
    prevJob: 'Sniper', nextJobs: [],
    reqLevel: 90,
    statBonus: { speed: 120, attack: 180, hp: 150 },
    passiveSkill: 'divine_aim',
    unlockSkills: ['arrow_of_god', 'universe_shot', 'dimension_pierce'],
  },
  'Wild Emperor': {
    tier: 4, emoji: '🌙', element: 'earth',
    description: '[ PINNACLE ] Kaisar alam liar yang satu dengan semua makhluk.',
    prevJob: 'Beastmaster', nextJobs: [],
    reqLevel: 90,
    statBonus: { speed: 80, attack: 150, hp: 300, defense: 70 },
    passiveSkill: 'nature_incarnate',
    unlockSkills: ['stampede', 'nature_wrath', 'primal_roar'],
  },

  // ── ASSASSIN LINE ──────────────────────────────────────────────────────────
  Assassin: {
    tier: 1, emoji: '🗡️', element: 'dark',
    description: 'Pembunuh bayaran dengan critical tertinggi.',
    nextJobs: ['Shadow'],
    reqLevel: 1,
    statBonus: {},
    passiveSkill: null,
  },
  Shadow: {
    tier: 2, emoji: '🌑', element: 'dark',
    description: 'Penguasa kegelapan yang menyatu dengan bayangan.',
    prevJob: 'Assassin', nextJobs: ['Phantom', 'Reaper'],
    reqLevel: 30,
    statBonus: { speed: 35, attack: 30, hp: 50 },
    passiveSkill: 'shadow_step',
    unlockSkills: ['shadow_clone', 'night_slash'],
  },
  Phantom: {
    tier: 3, emoji: '👻', element: 'void',
    description: 'Sosok antara hidup dan mati, tak tersentuh.',
    prevJob: 'Shadow', nextJobs: ['Death God'],
    reqLevel: 60,
    statBonus: { speed: 60, attack: 90, hp: 60 },
    passiveSkill: 'ethereal',
    unlockSkills: ['phantom_blade', 'soul_rip'],
  },
  Reaper: {
    tier: 3, emoji: '⚰️', element: 'dark',
    description: 'Malaikat maut yang memanen nyawa.',
    prevJob: 'Shadow', nextJobs: ['Sin Eater'],
    reqLevel: 60,
    statBonus: { speed: 50, attack: 100, hp: 40, mana: 60 },
    passiveSkill: 'death_touch',
    unlockSkills: ['grim_harvest', 'life_drain'],
  },
  'Death God': {
    tier: 4, emoji: '🌀', element: 'void',
    description: '[ PINNACLE ] Dewa kematian, satu serangan = nyawa melayang.',
    prevJob: 'Phantom', nextJobs: [],
    reqLevel: 90,
    statBonus: { speed: 150, attack: 220, hp: 200, mana: 100 },
    passiveSkill: 'one_hit_kill',
    unlockSkills: ['death_sentence', 'void_blade', 'instant_kill'],
  },
  'Sin Eater': {
    tier: 4, emoji: '🔱', element: 'dark',
    description: '[ PINNACLE ] Memakan dosa seluruh dunia, kuat dari penderitaan.',
    prevJob: 'Reaper', nextJobs: [],
    reqLevel: 90,
    statBonus: { speed: 100, attack: 190, hp: 300, mana: 150 },
    passiveSkill: 'pain_absorb',
    unlockSkills: ['soul_devour', 'darkness_realm', 'seven_sins'],
  },


  // ── SUMMONER LINE ─────────────────────────────────────────────────────────
  Summoner: {
    tier: 1, emoji: '🎴', element: 'neutral',
    description: 'Pemanggil yang mengandalkan gacha dan summon.',
    nextJobs: ['Invoker'],
    reqLevel: 1,
    statBonus: {},
    passiveSkill: null,
  },
  Invoker: {
    tier: 2, emoji: '🔮', element: 'neutral',
    description: 'Invoker yang bisa panggil summon lebih kuat.',
    prevJob: 'Summoner', nextJobs: ['Contractor', 'Tamer'],
    reqLevel: 30,
    statBonus: { mana: 150, attack: 20, hp: 40 },
    passiveSkill: 'summon_boost',
    unlockSkills: ['summon_enhance', 'multi_summon'],
  },
  Contractor: {
    tier: 3, emoji: '📜', element: 'dark',
    description: 'Membuat kontrak dengan makhluk dimensi lain.',
    prevJob: 'Invoker', nextJobs: ['Overlord'],
    reqLevel: 60,
    statBonus: { mana: 250, attack: 50, hp: 70 },
    passiveSkill: 'demon_contract',
    unlockSkills: ['summon_demon', 'sacrifice'],
  },
  Tamer: {
    tier: 3, emoji: '🦁', element: 'earth',
    description: 'Penjinak monster, bisa summon berkali-kali.',
    prevJob: 'Invoker', nextJobs: ['Beast God'],
    reqLevel: 60,
    statBonus: { mana: 200, attack: 40, hp: 100, defense: 20 },
    passiveSkill: 'beast_taming',
    unlockSkills: ['summon_horde', 'tame'],
  },
  Overlord: {
    tier: 4, emoji: '👁️', element: 'void',
    description: '[ PINNACLE ] Penguasa summon dari dimensi lain.',
    prevJob: 'Contractor', nextJobs: [],
    reqLevel: 90,
    statBonus: { mana: 600, attack: 150, hp: 250, defense: 50 },
    passiveSkill: 'dimension_gate',
    unlockSkills: ['gate_of_babylon', 'ultimate_summon', 'army_召喚'],
  },
  'Beast God': {
    tier: 4, emoji: '🌿', element: 'earth',
    description: '[ PINNACLE ] Dewa binatang yang menyatu dengan alam.',
    prevJob: 'Tamer', nextJobs: [],
    reqLevel: 90,
    statBonus: { mana: 500, attack: 130, hp: 350, defense: 80, speed: 30 },
    passiveSkill: 'nature_lord',
    unlockSkills: ['primal_召喚', 'gaia_blessing', 'beast_army'],
  },
};

// ── Helper: apakah bisa advance? ──────────────────────────────────────────────
export function getAvailableAdvances(player) {
  const currentJob = JOB_TREE[player.job || player.class];
  if (!currentJob || !currentJob.nextJobs?.length) return [];

  return currentJob.nextJobs
    .map(jobId => ({ id: jobId, ...JOB_TREE[jobId] }))
    .filter(j => player.level >= j.reqLevel);
}

export function canAdvance(player) {
  return getAvailableAdvances(player).length > 0;
}

export function getTierName(tier) {
  return ['', '⬜ Novice', '🟩 Adept', '🟦 Expert', '🟨 Pinnacle'][tier] || '?';
}

export default { JOB_TREE, getAvailableAdvances, canAdvance, getTierName };
