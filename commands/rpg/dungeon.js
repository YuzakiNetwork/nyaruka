/**
 * commands/rpg/dungeon.js
 * Enter or continue dungeon progression.
 * Usage: !dungeon [enter|status|flee]
 */

import { getPlayer, savePlayer }      from '../../lib/game/player.js';
import { executeBattle, applyRewards } from '../../lib/game/battleEngine.js';
import {
  createDungeon, saveDungeon, getDungeon, deleteDungeon,
  generateFloor, rollFloorEvent, dungeonStatusText,
  computeCompletionRewards, applyFloorModifier,
  DUNGEON_MODIFIERS,
}                                       from '../../lib/game/dungeon.js';
import { awardExp }                     from '../../lib/game/player.js';
import { config }                       from '../../config.js';

let handler = async (m, { args }) => {
  const player  = getPlayer(m.sender);
  if (!player)  return m.reply(`❌ Register first: *!register <n> <class>*`);
  if (player.hp <= 0) return m.reply(`💀 You're dead! Use *!rest* to recover.`);

  const sub = (args[0] || 'enter').toLowerCase();

  // ── STATUS ────────────────────────────────────────────────────────────────
  if (sub === 'status') {
    const dungeon = getDungeon(m.sender);
    if (!dungeon) return m.reply(`🏰 You're not in a dungeon. Use *!dungeon enter* to begin.`);
    return m.reply(dungeonStatusText(dungeon));
  }

  // ── FLEE ─────────────────────────────────────────────────────────────────
  if (sub === 'flee') {
    const dungeon = getDungeon(m.sender);
    if (!dungeon) return m.reply(`🏰 You're not in a dungeon.`);
    await deleteDungeon(m.sender);
    return m.reply(`🏃 You fled the dungeon. Progress lost.\n💰 Kept: ${dungeon.totalGold}g`);
  }

  // ── ENTER or CONTINUE ────────────────────────────────────────────────────
  let dungeon = getDungeon(m.sender);

  if (!dungeon || !dungeon.active) {
    dungeon = createDungeon(m.sender, player.level);
    await saveDungeon(dungeon);
    const mod = DUNGEON_MODIFIERS[dungeon.modifier];
    await m.reply(
      `🏰 *Entering the Dungeon!*\n\n` +
      `Modifier: ${mod.emoji} *${mod.name}*\n` +
      `${mod.description}\n\n` +
      `10 floors of darkness await... good luck.`
    );
  }

  // ── FLOOR EVENT ───────────────────────────────────────────────────────────
  const floorEvent = rollFloorEvent();
  const eventMsgs = [];

  if (floorEvent.id !== 'nothing') {
    eventMsgs.push(`🎲 *Floor Event:* ${floorEvent.message}`);
    if (floorEvent.id === 'trap') {
      player.hp = Math.max(1, player.hp - 15);
      eventMsgs.push(`❤️ Your HP: *${player.hp}/${player.maxHp}*`);
    }
    if (floorEvent.id === 'shrine') {
      player.hp   = Math.min(player.maxHp,   player.hp   + 20);
      player.mana = Math.min(player.maxMana, player.mana + 20);
      eventMsgs.push(`❤️ HP: *${player.hp}/${player.maxHp}* | 💙 Mana: *${player.mana}/${player.maxMana}*`);
    }
    if (floorEvent.id === 'merchant') {
      const { addItem } = await import('../../lib/game/player.js');
      addItem(player, 'health_potion', 1);
      eventMsgs.push(`🎒 Received: *Health Potion* x1`);
    }
  }

  // Apply floor modifier (poison/heal between floors)
  const modMsgs = applyFloorModifier(player, dungeon.modifier);
  eventMsgs.push(...modMsgs);

  // Generate floor monsters
  const floor = generateFloor(dungeon.floor, player.level, dungeon.modifier);

  await m.reply(
    `${eventMsgs.length ? eventMsgs.join('\n') + '\n\n' : ''}` +
    `🏰 *Floor ${dungeon.floor}/${dungeon.totalFloors}*\n` +
    `${floor.isBoss ? '💢 *BOSS FLOOR!*' : floor.isElite ? '⭐ *Elite Monster!*' : '👹 Monster Encounter'}\n\n` +
    `⚡ Battling *${floor.monsters.map(m => m.name).join(' + ')}*...\n` +
    `(${floor.monsters.length} monster${floor.monsters.length > 1 ? 's' : ''})`
  );

  // Battle each monster on the floor
  let floorGold = 0;
  let floorExp  = 0;
  let floorLoot = [];
  let survived  = true;

  for (const monster of floor.monsters) {
    if (player.hp <= 0) { survived = false; break; }

    const result = await executeBattle(player, monster, {});

    player.hp   = result.finalHp;
    player.mana = result.finalMana;

    if (result.playerWon) {
      floorGold += result.rewards.gold;
      floorExp  += result.rewards.exp;
      floorLoot = [...floorLoot, ...result.rewards.loot];
      dungeon.monstersKilled++;
    } else {
      survived = false;
      break;
    }
  }

  // ── DEATH IN DUNGEON ─────────────────────────────────────────────────────
  if (!survived) {
    const goldLost = Math.floor(player.gold * 0.15);
    player.gold    = Math.max(0, player.gold - goldLost);
    await savePlayer(player);
    await deleteDungeon(m.sender);

    return m.reply(
      `💀 *You fell in the dungeon!*\n` +
      `Reached Floor: *${dungeon.floor}*\n\n` +
      `Progress lost. You lost *${goldLost}g* (15% penalty).\n` +
      `❤️ HP: 1/${player.maxHp} (barely alive)\n\n` +
      `Use *!rest* to recover, then try again.`
    );
  }

  // ── FLOOR CLEARED ────────────────────────────────────────────────────────
  const { addItem } = await import('../../lib/game/player.js');
  const levelMsgs   = await applyRewards(player, { gold: floorGold, exp: floorExp, loot: floorLoot });

  dungeon.totalGold += floorGold;
  dungeon.totalExp  += floorExp;
  dungeon.lootCollected.push(...floorLoot);

  const lootText = floorLoot.length
    ? `\n🎒 Loot: ${floorLoot.map(l => `${l.itemId} x${l.qty}`).join(', ')}`
    : '';

  // ── DUNGEON COMPLETE ─────────────────────────────────────────────────────
  if (dungeon.floor >= dungeon.totalFloors) {
    const { bonusGold, bonusExp } = computeCompletionRewards(dungeon, player.level);
    player.gold += bonusGold;
    const lvlResult = await awardExp(player, bonusExp);
    player.reputation = (player.reputation || 0) + 50;

    await savePlayer(player);
    await deleteDungeon(m.sender);

    return m.reply(
      `🏆 *DUNGEON CLEARED!*\n\n` +
      `You conquered all ${dungeon.totalFloors} floors!\n\n` +
      `📊 Summary:\n` +
      `  ⚔️ Monsters Slain: ${dungeon.monstersKilled}\n` +
      `  💰 Gold Earned:    ${dungeon.totalGold + bonusGold}g\n` +
      `  ⭐ EXP Earned:     ${dungeon.totalExp + bonusExp}\n\n` +
      `🎁 *Completion Bonus:*\n` +
      `  +${bonusGold}g | +${bonusExp} EXP | +50 Reputation\n\n` +
      (levelMsgs.length ? levelMsgs.join('\n') + '\n\n' : '') +
      (lvlResult.messages?.length ? lvlResult.messages.join('\n') + '\n\n' : '') +
      `❤️ HP: *${player.hp}/${player.maxHp}*`
    );
  }

  // ── ADVANCE TO NEXT FLOOR ─────────────────────────────────────────────────
  dungeon.floor++;
  await saveDungeon(dungeon);
  await savePlayer(player);

  return m.reply(
    `✅ *Floor ${dungeon.floor - 1} Cleared!*\n\n` +
    `💰 +${floorGold}g | ⭐ +${floorExp} EXP${lootText}\n\n` +
    (levelMsgs.length ? levelMsgs.join('\n') + '\n\n' : '') +
    `📍 Next: *Floor ${dungeon.floor}/${dungeon.totalFloors}*\n` +
    `❤️ HP: *${player.hp}/${player.maxHp}*\n\n` +
    `Use *!dungeon* to advance or *!dungeon flee* to escape.`
  );
};

// Helper used inside handler
async function applyFloorRewards(player, rewards) {
  const { addItem, awardExp } = await import('../../lib/game/player.js');
  const messages = [];
  player.gold = Math.max(0, (player.gold || 0) + rewards.gold);
  for (const drop of rewards.loot || []) addItem(player, drop.itemId, drop.qty);
  if (rewards.exp > 0) {
    const r = await awardExp(player, rewards.exp);
    messages.push(...r.messages);
  }
  return messages;
}

handler.help     = ['dungeon [enter|status|flee]'];
handler.tags     = ['rpg'];
handler.command  = /^dungeon$/i;
handler.cooldown = config.cooldowns.dungeon;

export default handler;
