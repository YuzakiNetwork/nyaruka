/**
 * commands/rpg/training.js
 * Training — bayar gold untuk boost stat permanen kecil.
 * Usage: !train | !train <stat>
 */

import { getPlayer, savePlayer } from '../../lib/game/player.js';
import { randInt, chance }       from '../../lib/utils/random.js';

const TRAINABLE = {
  attack:  { emoji: '⚔️',  costMult: 1.2, cap: 500 },
  defense: { emoji: '🛡️',  costMult: 1.0, cap: 300 },
  speed:   { emoji: '💨',  costMult: 0.9, cap: 200 },
  hp:      { emoji: '❤️',  costMult: 1.5, cap: 2000, isHp: true },
  mana:    { emoji: '💙',  costMult: 1.3, cap: 1500, isMana: true },
};

function trainCost(player, stat) {
  const base   = 50 + player.level * 10;
  const mult   = TRAINABLE[stat].costMult;
  const current = stat === 'hp' ? player.maxHp : stat === 'mana' ? player.maxMana : player[stat];
  return Math.floor(base * mult * (current / 50));
}

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  if (!args[0]) {
    const lines = Object.entries(TRAINABLE).map(([stat, cfg]) => {
      const current = stat === 'hp' ? player.maxHp : stat === 'mana' ? player.maxMana : player[stat];
      const cost    = trainCost(player, stat);
      const atCap   = current >= cfg.cap;
      return `${cfg.emoji} *${stat}* — Saat ini: ${current} | Biaya: ${cost}g${atCap ? ' *(MAX)*' : ''}`;
    });

    return m.reply(
      `🏋️ *Training Center*\n\n` +
      lines.join('\n') +
      `\n\n💰 Goldmu: *${player.gold}g*\n\n` +
      `Gunakan: *!train <stat>*\n` +
      `Stats: ${Object.keys(TRAINABLE).join(' | ')}`
    );
  }

  const stat = args[0].toLowerCase();
  if (!TRAINABLE[stat]) {
    return m.reply(
      `❌ Stat tidak valid: *${stat}*\n` +
      `Pilihan: ${Object.keys(TRAINABLE).join(', ')}`
    );
  }

  const cfg     = TRAINABLE[stat];
  const current = stat === 'hp' ? player.maxHp : stat === 'mana' ? player.maxMana : player[stat];

  if (current >= cfg.cap) {
    return m.reply(`⚠️ *${stat}* sudah mencapai batas maximum (*${cfg.cap}*).`);
  }

  const cost = trainCost(player, stat);
  if (player.gold < cost) {
    return m.reply(
      `💸 Gold tidak cukup!\n` +
      `Butuh: *${cost}g* | Punya: *${player.gold}g*`
    );
  }

  player.gold -= cost;

  // Base gain 1–3, bonus dari level tinggi
  const gain     = randInt(1, 3);
  const critical = chance(0.10); // 10% double gain
  const total    = critical ? gain * 2 : gain;

  if (cfg.isHp) {
    player.maxHp = Math.min(cfg.cap, player.maxHp + total);
    player.hp    = Math.min(player.maxHp, player.hp + total);
  } else if (cfg.isMana) {
    player.maxMana = Math.min(cfg.cap, player.maxMana + total);
    player.mana    = Math.min(player.maxMana, player.mana + total);
  } else {
    player[stat] = Math.min(cfg.cap, player[stat] + total);
  }

  await savePlayer(player);

  const newVal = stat === 'hp' ? player.maxHp : stat === 'mana' ? player.maxMana : player[stat];

  return m.reply(
    `🏋️ *Training ${stat.toUpperCase()} Selesai!*\n\n` +
    (critical ? `⚡ *CRITICAL TRAINING!* Gain ×2!\n` : '') +
    `${cfg.emoji} ${stat}: *${current}* → *${newVal}* (+${total})\n` +
    `💰 Biaya: -${cost}g | Sisa: ${player.gold}g`
  );
};

handler.help     = ['train', 'train <stat>'];
handler.tags     = ['rpg'];
handler.command  = /^train(ing)?$/i;
handler.cooldown = 30;

export default handler;
