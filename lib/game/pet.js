/**
 * lib/game/pet.js
 * Pet/Familiar System — Tangkap monster, besarkan, bertarung bersama
 */

import db           from '../database/db.js';
import { randInt, chance } from '../utils/random.js';

const PET_COL = 'pets';

// ── Tipe Pet yang bisa ditangkap ──────────────────────────────────────────────
export const PET_TYPES = {
  wolf_pup: {
    id: 'wolf_pup', name: '🐺 Wolf Pup', catchFrom: 'forest_wolf',
    catchRate: 0.15,
    baseStats: { hp: 40, attack: 12, defense: 5, speed: 15 },
    growthRate: { hp: 6, attack: 2, defense: 1, speed: 2 },
    maxLevel: 50,
    skills: ['bite', 'howl'],
    evoLevel: 20,
    evolution: 'dire_wolf',
    description: 'Anak serigala yang setia. Cepat dan agresif.',
  },
  dire_wolf: {
    id: 'dire_wolf', name: '🐺 Dire Wolf', catchFrom: null,
    catchRate: 0,
    baseStats: { hp: 120, attack: 35, defense: 15, speed: 40 },
    growthRate: { hp: 10, attack: 3, defense: 2, speed: 3 },
    maxLevel: 80,
    skills: ['bite', 'howl', 'pack_hunt'],
    evoLevel: 50,
    evolution: 'fenrir',
    description: 'Serigala raksasa dari legenda.',
  },
  fenrir: {
    id: 'fenrir', name: '❄️ Fenrir', catchFrom: null,
    catchRate: 0,
    baseStats: { hp: 300, attack: 90, defense: 40, speed: 80 },
    growthRate: { hp: 15, attack: 5, defense: 3, speed: 4 },
    maxLevel: 100,
    skills: ['bite', 'howl', 'pack_hunt', 'ragnarok'],
    evoLevel: null,
    description: '[ LEGENDARY ] Serigala dewa penghancur dunia.',
  },
  goblin_kid: {
    id: 'goblin_kid', name: '👺 Goblin Kid', catchFrom: 'goblin_scout',
    catchRate: 0.20,
    baseStats: { hp: 30, attack: 8, defense: 4, speed: 18 },
    growthRate: { hp: 5, attack: 2, defense: 1, speed: 3 },
    maxLevel: 40,
    skills: ['scratch', 'steal'],
    evoLevel: 20,
    evolution: 'hobgoblin',
    description: 'Goblin kecil yang lincah. Bisa mencuri item musuh.',
  },
  hobgoblin: {
    id: 'hobgoblin', name: '👹 Hobgoblin', catchFrom: null,
    catchRate: 0,
    baseStats: { hp: 100, attack: 25, defense: 18, speed: 25 },
    growthRate: { hp: 9, attack: 3, defense: 2, speed: 2 },
    maxLevel: 70,
    skills: ['scratch', 'steal', 'war_drum'],
    evoLevel: null,
    description: 'Goblin besar yang kuat dan cerdik.',
  },
  bat_familiar: {
    id: 'bat_familiar', name: '🦇 Shadow Bat', catchFrom: 'cave_bat',
    catchRate: 0.25,
    baseStats: { hp: 20, attack: 10, defense: 3, speed: 25 },
    growthRate: { hp: 4, attack: 2, defense: 1, speed: 4 },
    maxLevel: 40,
    skills: ['sonic_wave', 'drain'],
    evoLevel: 20,
    evolution: 'vampire_bat',
    description: 'Kelelawar yang menyerap HP musuh.',
  },
  vampire_bat: {
    id: 'vampire_bat', name: '🧛 Vampire Bat', catchFrom: null,
    catchRate: 0,
    baseStats: { hp: 80, attack: 30, defense: 10, speed: 55 },
    growthRate: { hp: 8, attack: 3, defense: 1, speed: 4 },
    maxLevel: 75,
    skills: ['sonic_wave', 'drain', 'blood_suck'],
    evoLevel: null,
    description: 'Kelelawar vampir yang memulihkan HP setiap serangan.',
  },
  slime_blob: {
    id: 'slime_blob', name: '🟢 Slime', catchFrom: 'slime',
    catchRate: 0.40,
    baseStats: { hp: 60, attack: 5, defense: 20, speed: 4 },
    growthRate: { hp: 15, attack: 1, defense: 4, speed: 1 },
    maxLevel: 50,
    skills: ['absorb', 'split'],
    evoLevel: 25,
    evolution: 'king_slime',
    description: 'Slime yang bisa menyerap elemen apapun.',
  },
  king_slime: {
    id: 'king_slime', name: '👑 King Slime', catchFrom: null,
    catchRate: 0,
    baseStats: { hp: 400, attack: 20, defense: 80, speed: 10 },
    growthRate: { hp: 20, attack: 2, defense: 5, speed: 1 },
    maxLevel: 80,
    skills: ['absorb', 'split', 'royal_jelly', 'tsunami'],
    evoLevel: null,
    description: '[ RARE ] Raja semua slime, pertahanan absolut.',
  },
  dragon_hatchling: {
    id: 'dragon_hatchling', name: '🐣 Dragon Hatchling', catchFrom: null,
    catchRate: 0.02,  // super rare drop dari ancient_dragon
    baseStats: { hp: 100, attack: 30, defense: 20, speed: 20 },
    growthRate: { hp: 20, attack: 5, defense: 4, speed: 3 },
    maxLevel: 100,
    skills: ['fire_breath', 'dragon_roar'],
    evoLevel: 40,
    evolution: 'young_dragon',
    description: '[ ULTRA RARE ] Anak naga. Perlu waktu lama untuk tumbuh.',
  },
  young_dragon: {
    id: 'young_dragon', name: '🐲 Young Dragon', catchFrom: null,
    catchRate: 0,
    baseStats: { hp: 500, attack: 100, defense: 70, speed: 50 },
    growthRate: { hp: 25, attack: 7, defense: 5, speed: 3 },
    maxLevel: 100,
    skills: ['fire_breath', 'dragon_roar', 'wing_storm', 'dragon_claw'],
    evoLevel: 80,
    evolution: 'elder_dragon',
    description: '[ LEGENDARY ] Naga muda yang sudah melampaui kebanyakan monster.',
  },
  elder_dragon: {
    id: 'elder_dragon', name: '🐉 Elder Dragon', catchFrom: null,
    catchRate: 0,
    baseStats: { hp: 1500, attack: 250, defense: 180, speed: 80 },
    growthRate: { hp: 30, attack: 8, defense: 6, speed: 2 },
    maxLevel: 100,
    skills: ['fire_breath', 'dragon_roar', 'wing_storm', 'dragon_claw', 'true_dragon'],
    evoLevel: null,
    description: '[ PINNACLE ] Naga tertua. Kekuatannya setara raja.',
  },
};

// ── Pet stat sesuai level ─────────────────────────────────────────────────────
export function getPetStats(pet) {
  const type = PET_TYPES[pet.typeId];
  if (!type) return pet.stats || {};
  const lvl = pet.level || 1;
  return {
    hp:      type.baseStats.hp      + type.growthRate.hp      * (lvl - 1),
    attack:  type.baseStats.attack  + type.growthRate.attack  * (lvl - 1),
    defense: type.baseStats.defense + type.growthRate.defense * (lvl - 1),
    speed:   type.baseStats.speed   + type.growthRate.speed   * (lvl - 1),
  };
}

// ── Bonus stat dari pet ke player ─────────────────────────────────────────────
export function getPetBonus(pet) {
  if (!pet || !pet.active) return {};
  const stats  = getPetStats(pet);
  const factor = 0.15; // pet kasih 15% stat-nya ke player
  return {
    attack:  Math.floor(stats.attack  * factor),
    defense: Math.floor(stats.defense * factor),
    speed:   Math.floor(stats.speed   * factor),
    hp:      Math.floor(stats.hp      * factor),
  };
}

// ── Coba tangkap monster ──────────────────────────────────────────────────────
export function tryCapture(monster) {
  const catchable = Object.values(PET_TYPES).filter(p => p.catchFrom === monster.id && p.catchRate > 0);
  if (!catchable.length) return null;

  for (const petType of catchable) {
    const hpFactor  = 1 - (monster.currentHp / monster.hp);  // makin lemah makin gampang
    const realRate  = petType.catchRate * (0.5 + hpFactor * 1.5);
    if (chance(realRate)) return petType;
  }
  return null;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
export function getPet(playerId) {
  return db.getRecord(PET_COL, playerId);
}

export async function savePet(pet) {
  return db.setRecord(PET_COL, pet.ownerId, pet);
}

export async function createPet(ownerId, petTypeId) {
  const type = PET_TYPES[petTypeId];
  if (!type) throw new Error('Unknown pet type');
  const pet = {
    ownerId,
    typeId:    petTypeId,
    name:      type.name,
    level:     1,
    exp:       0,
    expToNext: 100,
    active:    true,
    happiness: 100,
    hunger:    100,
    caughtAt:  Date.now(),
  };
  await savePet(pet);
  return pet;
}

export async function feedPet(pet) {
  pet.hunger    = Math.min(100, (pet.hunger || 0) + 30);
  pet.happiness = Math.min(100, (pet.happiness || 0) + 10);
  await savePet(pet);
}

export async function awardPetExp(pet, amount) {
  const msgs = [];
  pet.exp = (pet.exp || 0) + amount;

  while (pet.exp >= pet.expToNext) {
    pet.exp      -= pet.expToNext;
    pet.level     = (pet.level || 1) + 1;
    pet.expToNext = Math.floor(100 * Math.pow(1.1, pet.level - 1));
    msgs.push(`🎉 *${pet.name}* naik ke Level ${pet.level}!`);

    // Cek evolusi
    const type = PET_TYPES[pet.typeId];
    if (type?.evoLevel && pet.level >= type.evoLevel && type.evolution) {
      const evo = PET_TYPES[type.evolution];
      if (evo) {
        pet.typeId = type.evolution;
        pet.name   = evo.name;
        msgs.push(`✨ *${pet.name}* BEREVOLUSI menjadi *${evo.name}*! 🌟`);
      }
    }
  }
  await savePet(pet);
  return msgs;
}

export default { PET_TYPES, getPetStats, getPetBonus, tryCapture, getPet, savePet, createPet, feedPet, awardPetExp };
