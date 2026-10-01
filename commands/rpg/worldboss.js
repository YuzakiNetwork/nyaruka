/**
 * commands/rpg/worldboss.js
 * World Boss — Boss raksasa yang diserang semua player bareng
 */

import { getPlayer, savePlayer, getAllPlayers } from '../../lib/game/player.js';
import {
  WORLD_BOSSES, getWorldBossState, spawnWorldBoss,
  attackWorldBoss, getBossRanking, hpBar,
} from '../../lib/game/worldboss.js';
import { checkTitles } from '../../lib/game/title.js';

let handler = async (m, { args, isOwner, sock }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  const sub = args[0]?.toLowerCase() || 'status';

  // ── !boss status ───────────────────────────────────────────────────────────
  if (sub === 'status' || sub === 'info' || !args.length) {
    const state = getWorldBossState();
    if (!state || state.defeated) {
      return m.reply(
        `🌍 *World Boss*\n\n` +
        `😴 Saat ini tidak ada World Boss yang aktif.\n\n` +
        `World Boss muncul secara terjadwal atau di-spawn oleh owner.\n\n` +
        `📖 *Boss yang pernah ada:*\n` +
        Object.values(WORLD_BOSSES).map(b => `${b.emoji} *${b.name}*\n   ${b.description}`).join('\n\n')
      );
    }

    const timeLeft = Math.max(0, state.expiresAt - Date.now());
    const hours    = Math.floor(timeLeft / 3600000);
    const mins     = Math.floor((timeLeft % 3600000) / 60000);
    const ranking  = getBossRanking(state).slice(0, 5);
    const attackers = Object.keys(state.attackers || {}).length;

    return m.reply(
      `💢 *WORLD BOSS AKTIF!* 💢\n\n` +
      `${state.emoji} *${state.name}*\n\n` +
      `❤️ HP: ${hpBar(state.currentHp, state.maxHp)}\n` +
      `   ${state.currentHp.toLocaleString()}/${state.maxHp.toLocaleString()}\n\n` +
      `⚔️ ATK: ${state.attack} | 🛡️ DEF: ${state.defense}\n` +
      `⏳ Waktu tersisa: *${hours}j ${mins}m*\n` +
      `👥 Penyerang: *${attackers} player*\n\n` +
      `🏆 *Top Damage:*\n` +
      (ranking.length
        ? ranking.map((r, i) => `${['🥇','🥈','🥉','4️⃣','5️⃣'][i]} ${r.name}: *${r.dmg.toLocaleString()}* dmg`).join('\n')
        : '_Belum ada_') +
      `\n\n⚔️ Serang dengan *!boss attack* (cooldown 5 menit)`
    );
  }

  // ── !boss attack ───────────────────────────────────────────────────────────
  if (sub === 'attack' || sub === 'serang' || sub === 'atk') {
    if (player.hp <= 0) return m.reply(`💀 HP kamu 0! Gunakan *!rest* dulu.`);

    const state = getWorldBossState();
    if (!state || state.defeated) return m.reply(`❌ Tidak ada World Boss aktif. Tunggu spawn berikutnya!`);

    try {
      const result = await attackWorldBoss(player, state);
      const boss   = WORLD_BOSSES[state.bossId];

      // Kurangi HP player (counter-attack boss)
      player.hp = Math.max(1, player.hp - result.counterDmg);

      const rewardExp  = Math.floor(50 + player.level * 5);
      const rewardGold = Math.floor(100 + player.level * 10);
      player.exp  = (player.exp  || 0) + rewardExp;
      player.gold = (player.gold || 0) + rewardGold;

      // Cek level up
      let levelMsg = '';
      while ((player.exp || 0) >= (player.expToNext || 999)) {
        player.exp -= player.expToNext;
        player.level += 1;
        player.expToNext = Math.floor(100 * Math.pow(1.15, player.level - 1));
        levelMsg += `\n🎊 LEVEL UP! → *Lv.${player.level}*`;
      }

      // Handle boss defeated
      let defeatMsg = '';
      if (result.defeated) {
        // Bonus reward untuk semua participant
        const bonusExp  = 5000;
        const bonusGold = 2000;
        player.exp  += bonusExp;
        player.gold += bonusGold;
        if (!player.stats) player.stats = {};
        player.stats.worldBossKills = (player.stats.worldBossKills || 0) + 1;
        defeatMsg = `\n\n🎉🎊 *WORLD BOSS DIKALAHKAN!* 🎊🎉\n+${bonusExp} EXP | +${bonusGold}g bonus!`;

        // Announce ke semua
        const ranking = getBossRanking(state).slice(0, 3);
        defeatMsg += `\n\n🏆 *MVP:*\n${ranking.map((r, i) => `${['🥇','🥈','🥉'][i]} ${r.name} — ${r.dmg.toLocaleString()} dmg`).join('\n')}`;
      }

      const newTitles = checkTitles(player);
      await savePlayer(player);

      return m.reply(
        `⚔️ *Menyerang ${state.name}!*\n\n` +
        `💥 Damage-mu: *${result.dmg.toLocaleString()}*\n` +
        `💢 Counter Attack: *-${result.counterDmg} HP*\n\n` +
        `${result.phaseMsg ? `😡 *${result.phaseMsg}*\n\n` : ''}` +
        `❤️ Boss HP: ${hpBar(result.bossHp, result.bossMaxHp)}\n\n` +
        `+${rewardExp} EXP | +${rewardGold}g${levelMsg}` +
        (newTitles.length ? `\n🏆 *Title baru:* ${newTitles.map(t => t.name).join(', ')}` : '') +
        defeatMsg +
        `\n\n❤️ HP-mu: *${player.hp}/${player.maxHp}*`
      );
    } catch (err) {
      return m.reply(`❌ ${err.message}`);
    }
  }

  // ── !boss rank ─────────────────────────────────────────────────────────────
  if (sub === 'rank' || sub === 'ranking' || sub === 'top') {
    const state = getWorldBossState();
    if (!state) return m.reply(`❌ Tidak ada World Boss aktif.`);
    const ranking = getBossRanking(state);
    if (!ranking.length) return m.reply(`📊 Belum ada yang menyerang boss!`);
    return m.reply(
      `🏆 *World Boss Damage Ranking*\n` +
      `${state.emoji} ${state.name}\n\n` +
      ranking.slice(0, 10).map((r, i) =>
        `${['🥇','🥈','🥉'][i] || `${i+1}.`} *${r.name}*\n   ${r.dmg.toLocaleString()} dmg | ${r.hits} hits`
      ).join('\n\n')
    );
  }

  // ── !boss spawn (owner only) ───────────────────────────────────────────────
  if (sub === 'spawn') {
    if (!isOwner) return m.reply(`❌ Owner only.`);
    const bossId = args[1] || 'demon_king';
    if (!WORLD_BOSSES[bossId]) {
      return m.reply(`❌ Boss tidak valid. Pilihan:\n${Object.keys(WORLD_BOSSES).join(', ')}`);
    }
    const state = await spawnWorldBoss(bossId);
    const boss  = WORLD_BOSSES[bossId];
    return m.reply(
      `💢 *WORLD BOSS MUNCUL!* 💢\n\n` +
      `${boss.emoji} *${boss.name}*\n` +
      `"${boss.description}"\n\n` +
      `❤️ HP: ${state.maxHp.toLocaleString()}\n` +
      `⚔️ ATK: ${boss.attack} | 🛡️ DEF: ${boss.defense}\n` +
      `⏳ Waktu: 24 jam\n\n` +
      `⚔️ Serang dengan *!boss attack*!\n` +
      `Semua player bisa ikut menyerang!`
    );
  }

  return m.reply(
    `💢 *World Boss Commands*\n\n` +
    `!boss           — status boss\n` +
    `!boss attack    — serang boss (cd 5 menit)\n` +
    `!boss rank      — ranking damage\n\n` +
    `World Boss muncul secara berkala — pantau terus!`
  );
};

handler.help    = ['boss', 'boss attack', 'boss rank'];
handler.tags    = ['rpg'];
handler.command = /^(boss|worldboss|wb)$/i;
handler.cooldown = 300;
export default handler;
