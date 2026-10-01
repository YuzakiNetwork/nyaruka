/**
 * lib/game/worldboss.js
 * World Boss System — Boss besar yang diserang semua player bersama
 */

import db           from '../database/db.js';
import { randInt, chance } from '../utils/random.js';

const WB_COL = 'worldboss';

export const WORLD_BOSSES = {
  demon_king: {
    id: 'demon_king', name: '😈 Demon King Zar\'ok', emoji: '👿',
    description: 'Raja iblis yang bangkit setiap bulan, menghancurkan dunia.',
    baseHp: 500000,
    attack: 800, defense: 300, speed: 50,
    element: 'dark',
    phases: [
      { threshold: 0.75, message: '😡 "Kutu busuk! Aku akan tunjukkan kekuatan sejatiku!"', atkBoost: 1.2 },
      { threshold: 0.50, message: '💀 "RARGH! Kalian berani melukaku?! MATI SEMUA!"', atkBoost: 1.5, defBoost: 1.2 },
      { threshold: 0.25, message: '🔥 "Ini... ini tidak mungkin... ULTIMA FORM!"', atkBoost: 2.0, defBoost: 1.5, superMode: true },
    ],
    rewards: {
      exp: 5000, gold: 2000,
      items: ['demon_core', 'king_crown', 'void_crystal'],
      titleReward: 'world_savior',
    },
    spawnDuration: 24 * 60 * 60 * 1000, // 24 jam window untuk serang
  },
  sea_titan: {
    id: 'sea_titan', name: '🌊 Sea Titan Leviath', emoji: '🐋',
    description: 'Titan laut kuno yang membekukan samudra.',
    baseHp: 350000,
    attack: 600, defense: 400, speed: 30,
    element: 'water',
    phases: [
      { threshold: 0.60, message: '🌊 "Samudra akan menelan kalian!"', atkBoost: 1.3 },
      { threshold: 0.30, message: '❄️ "TSUNAMI ABADI!"', atkBoost: 1.6, defBoost: 1.4 },
    ],
    rewards: {
      exp: 4000, gold: 1500,
      items: ['leviath_scale', 'ocean_gem', 'tidal_core'],
      titleReward: 'world_savior',
    },
    spawnDuration: 18 * 60 * 60 * 1000,
  },
  sky_emperor: {
    id: 'sky_emperor', name: '⚡ Sky Emperor Thorvald', emoji: '🦅',
    description: 'Kaisar langit yang menguasai petir dan angin.',
    baseHp: 400000,
    attack: 700, defense: 250, speed: 100,
    element: 'wind',
    phases: [
      { threshold: 0.70, message: '⚡ "Petir akan menghanguskanmu!"', atkBoost: 1.25, speedBoost: 1.3 },
      { threshold: 0.35, message: '🌪️ "STORM ABSOLUTE!"', atkBoost: 1.7, speedBoost: 1.5 },
    ],
    rewards: {
      exp: 4500, gold: 1800,
      items: ['thunder_feather', 'sky_crystal', 'storm_essence'],
      titleReward: 'world_savior',
    },
    spawnDuration: 20 * 60 * 60 * 1000,
  },
};

// ── State ─────────────────────────────────────────────────────────────────────
export function getWorldBossState() {
  return db.getRecord(WB_COL, 'current') || null;
}

export async function spawnWorldBoss(bossId) {
  const boss = WORLD_BOSSES[bossId];
  if (!boss) throw new Error('Unknown boss');

  const state = {
    bossId,
    name:       boss.name,
    emoji:      boss.emoji,
    maxHp:      boss.baseHp,
    currentHp:  boss.baseHp,
    attack:     boss.attack,
    defense:    boss.defense,
    speed:      boss.speed,
    phase:      0,
    attackers:  {},   // { playerId: { name, dmg, hits } }
    spawnedAt:  Date.now(),
    expiresAt:  Date.now() + boss.spawnDuration,
    defeated:   false,
    defeatedAt: null,
  };
  await db.setRecord(WB_COL, 'current', state);
  return state;
}

export async function attackWorldBoss(player, state) {
  if (!state || state.defeated) throw new Error('Tidak ada World Boss aktif.');
  if (Date.now() > state.expiresAt)  throw new Error('World Boss sudah kabur! (waktu habis)');

  const boss = WORLD_BOSSES[state.bossId];

  // Cek cooldown serangan (1 kali per 5 menit per player)
  const lastAtk = state.attackers?.[player.id]?.lastAttack || 0;
  const cooldownMs = 5 * 60 * 1000;
  if (Date.now() - lastAtk < cooldownMs) {
    const remaining = Math.ceil((cooldownMs - (Date.now() - lastAtk)) / 1000);
    throw new Error(`Cooldown serang boss: ${remaining}s lagi`);
  }

  // Hitung damage player ke boss
  const atkStat = (player.attack || 10) + Math.floor((player.level || 1) * 2);
  const baseDmg = Math.max(1, atkStat - Math.floor(state.defense * 0.3));
  const dmg     = randInt(Math.floor(baseDmg * 0.8), Math.floor(baseDmg * 1.2));

  // Hitung damage boss ke player (counter-attack)
  const bossAtk    = state.attack || 500;
  const playerDef  = player.defense || 10;
  const counterDmg = Math.max(1, Math.floor(bossAtk * 0.3) - playerDef);

  // Apply damage ke boss
  state.currentHp = Math.max(0, state.currentHp - dmg);

  // Update attacker record
  if (!state.attackers[player.id]) {
    state.attackers[player.id] = { name: player.name, dmg: 0, hits: 0, lastAttack: 0 };
  }
  state.attackers[player.id].dmg       += dmg;
  state.attackers[player.id].hits       += 1;
  state.attackers[player.id].lastAttack  = Date.now();

  // Cek phase change
  const hpPct = state.currentHp / state.maxHp;
  const phases = boss.phases || [];
  let phaseMsg = null;
  for (let i = phases.length - 1; i >= 0; i--) {
    const ph = phases[i];
    if (hpPct <= ph.threshold && state.phase <= i) {
      state.phase = i + 1;
      if (ph.atkBoost) state.attack = Math.floor((boss.attack || 500) * ph.atkBoost);
      if (ph.defBoost) state.defense = Math.floor((boss.defense || 300) * ph.defBoost);
      phaseMsg = ph.message;
      break;
    }
  }

  // Cek apakah boss kalah
  if (state.currentHp <= 0) {
    state.defeated  = true;
    state.defeatedAt = Date.now();
  }

  await db.setRecord(WB_COL, 'current', state);

  return {
    dmg,
    counterDmg,
    hpPct:   state.currentHp / state.maxHp,
    defeated: state.defeated,
    phaseMsg,
    bossHp:  state.currentHp,
    bossMaxHp: state.maxHp,
  };
}

// ── Ranking penyerang terbanyak ───────────────────────────────────────────────
export function getBossRanking(state) {
  if (!state?.attackers) return [];
  return Object.entries(state.attackers)
    .map(([id, a]) => ({ id, ...a }))
    .sort((a, b) => b.dmg - a.dmg);
}

// ── HP bar visual ─────────────────────────────────────────────────────────────
export function hpBar(current, max, len = 15) {
  const pct   = current / max;
  const fill  = Math.round(pct * len);
  const bar   = '█'.repeat(fill) + '░'.repeat(len - fill);
  return `[${bar}] ${(pct * 100).toFixed(1)}%`;
}

export default { WORLD_BOSSES, getWorldBossState, spawnWorldBoss, attackWorldBoss, getBossRanking, hpBar };
