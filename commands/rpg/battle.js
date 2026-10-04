/**
 * commands/rpg/battle.js
 * PvE Battle + Pet Capture + Stats Tracking + Title Check + Quest Tracking
 */

import { getPlayer, savePlayer }             from '../../lib/game/player.js';
import { randomMonster }                      from '../../lib/game/monster.js';
import { executeBattle, applyRewards }       from '../../lib/game/battleEngine.js';
import { getPet, tryCapture, createPet, awardPetExp } from '../../lib/game/pet.js';
import { ZONES }                                        from './zone.js';
import { checkTitles }                        from '../../lib/game/title.js';
import { trackQuest }                         from '../../lib/game/quest.js';

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);
  if (player.hp <= 0) return m.reply(`💀 Kamu mati! Gunakan *!rest* untuk pulihkan HP.`);
  if (player.dungeon?.active) return m.reply(`🏰 Kamu sedang di dungeon! Gunakan *!dungeon* untuk lanjutkan.`);

  const skillId = args[0] || null;
  const zoneId  = player.currentZone || 'village';
  const zone    = ZONES[zoneId] || ZONES.village;
  const monster = randomMonster(player.level, 0.12, false, zoneId);

  await m.reply(
    `📍 *${zone.name}*\n` +
    `⚔️ *Battle Dimulai!*\n` +
    `Kamu bertemu *${monster.name}* ${monster.emoji} [Lv.${monster.level}]\n` +
    `❤️ ${monster.currentHp} | ⚔️ ${monster.attack} | 🛡️ ${monster.defense}\n` +
    `─────────────────────\n⚡ Bertarung...`
  );

  const result = await executeBattle(player, monster, { skillId });

  // Apply zone multiplier ke rewards
  if (result.playerWon && zone) {
    result.rewards.gold = Math.floor((result.rewards.gold || 0) * (zone.goldMult || 1));
    result.rewards.exp  = Math.floor((result.rewards.exp  || 0) * (zone.expMult  || 1));
  }
  // Apply reincarnation multiplier
  if (result.playerWon && player.expMult > 1)  result.rewards.exp  = Math.floor((result.rewards.exp  || 0) * player.expMult);
  if (result.playerWon && player.goldMult > 1) result.rewards.gold = Math.floor((result.rewards.gold || 0) * player.goldMult);

  const levelMsgs = await applyRewards(player, result.rewards);
  player.hp   = result.finalHp;
  player.mana = result.finalMana;

  // Flag elite/boss (monster.js memakai 'elite' dan 'isElite', 'boss' dan 'isBoss')
  const isElite = !!(monster.elite || monster.isElite);
  const isBoss  = !!(monster.boss  || monster.isBoss);

  // Update stats tracking
  if (!player.stats) player.stats = {};
  if (result.playerWon) {
    player.stats.monstersKilled = (player.stats.monstersKilled || 0) + 1;
    player.stats.wins           = (player.stats.wins || 0) + 1;
    player.stats.totalDmgDealt  = (player.stats.totalDmgDealt || 0) + (result.totalDmg || 0);

    // Track boss/elite kills
    if (isBoss || isElite) {
      if (!player.stats.bossesKilled) player.stats.bossesKilled = [];
      if (!player.stats.bossesKilled.includes(monster.id)) {
        player.stats.bossesKilled.push(monster.id);
      }
    }
  } else {
    player.stats.losses = (player.stats.losses || 0) + 1;
  }

  // Pet capture attempt (hanya saat menang)
  let captureMsg = '';
  const existingPet = getPet(m.sender);
  if (result.playerWon && !existingPet?.active) {
    const captured = tryCapture({ ...monster, currentHp: result.monsterFinalHp || 0 });
    if (captured) {
      await createPet(m.sender, captured.id);
      captureMsg = `\n\n🎉 *PET TERTANGKAP!*\n${captured.name} bergabung bersamamu!\nGunakan *!pet* untuk lihat statusnya.`;
    } else if (Math.random() < 0.05) {
      captureMsg = `\n\n🥚 _Kamu melihat telur kecil di dekat monster... (${(Math.random() < 0.3 ? 'Tapi sudah pecah' : 'Tapi tidak bisa diambil')}.)_`;
    }
  }

  // Pet exp (jika punya pet aktif)
  let petMsg = '';
  if (existingPet?.active) {
    const petMsgs = await awardPetExp(existingPet, Math.floor((result.rewards.exp || 0) * 0.5));
    if (petMsgs.length) petMsg = '\n' + petMsgs.join('\n');
  }

  // Cek title baru
  const newTitles = checkTitles(player);
  await savePlayer(player);

  // ── Quest tracking (objek player yang sama, setelah savePlayer) ──
  // trackQuest menyimpan sendiri kalau ada progress.
  let questMsg = '';
  if (result.playerWon) {
    const qMsgs = [];

    const kill = await trackQuest(player, monster.id, 1, { isElite });
    if (kill) qMsgs.push(kill.message);

    // Quest collect (Wolf Fang, dll.)
    // Asumsi: loot ada di result.rewards.items / loot / drops dengan format { itemId, qty }.
    // Sesuaikan kalau battleEngine.js memakai nama lain.
    const drops = result.rewards.items || result.rewards.loot || result.rewards.drops || [];
    for (const it of drops) {
      const col = await trackQuest(player, it.itemId, it.qty || 1);
      if (col) qMsgs.push(col.message);
    }

    if (qMsgs.length) questMsg = '\n\n' + qMsgs.join('\n\n');
  }

  const logText    = result.log.slice(-12).join('\n');
  const rewardText = result.playerWon
    ? `💰 +${result.rewards.gold}g | ⭐ +${result.rewards.exp} EXP`
    : `💀 Kalah! -${Math.abs(result.rewards.gold || 0)}g (penalty 10%)`;

  return m.reply(
    `${logText}\n\n` +
    `${rewardText}` +
    (levelMsgs.length ? `\n\n${levelMsgs.join('\n')}` : '') +
    (newTitles.length ? `\n🏆 *Title baru:* ${newTitles.map(t => t.name).join(', ')}` : '') +
    petMsg +
    captureMsg +
    questMsg +
    `\n\n❤️ HP: *${player.hp}/${player.maxHp}*`
  );
};

handler.help     = ['battle [skill]'];
handler.tags     = ['rpg'];
handler.command  = /^(battle|fight|atk)$/i;
handler.cooldown = 300;
export default handler;
