/**
 * commands/rpg/adventure.js
 * Random adventure event — hasil acak setiap penggunaan.
 * Bisa dapat loot, gold, encounter, event unik, atau kutukan.
 * Anti-monotony: 20+ variasi event berbeda.
 * Usage: !adventure | !adv
 */

import { getPlayer, savePlayer, addItem, awardExp } from '../../lib/game/player.js';
import { weightedPick, randInt, chance, pick }      from '../../lib/utils/random.js';
import { getWorldEvent }                            from '../../lib/game/economy.js';
import { randomMonster, rollMonsterLoot, rollGold } from '../../lib/game/monster.js';
import { ITEMS, RARITY_EMOJI }                      from '../../lib/game/item.js';

const EVENTS = [
  // ── Lucky events ──
  {
    id: 'treasure_chest', weight: 8,
    emoji: '💎', title: 'Peti Harta!',
    fn: async (player) => {
      const gold = randInt(50, 200) + player.level * 10;
      player.gold += gold;
      return { msgs: [`Kamu menemukan peti harta tersembunyi!\n💰 +*${gold}g*`] };
    },
  },
  {
    id: 'ancient_tome', weight: 5,
    emoji: '📖', title: 'Kitab Kuno',
    fn: async (player) => {
      const exp = randInt(40, 100) + player.level * 5;
      const result = await awardExp(player, exp);
      return { msgs: [`Kamu membaca kitab kuno dan mendapat ilmu!\n⭐ +*${exp} EXP*`, ...result.messages] };
    },
  },
  {
    id: 'wandering_merchant', weight: 6,
    emoji: '🧙', title: 'Pedagang Kelana',
    fn: async (player) => {
      const items = ['health_potion', 'mana_elixir', 'antidote', 'wolf_fang', 'ancient_rune'];
      const itemId = pick(items);
      const qty    = randInt(1, 3);
      addItem(player, itemId, qty);
      return { msgs: [`Pedagang kelana memberimu hadiah!\n🎒 *${itemId}* ×${qty}`] };
    },
  },
  {
    id: 'lucky_find', weight: 7,
    emoji: '🍀', title: 'Keberuntungan!',
    fn: async (player) => {
      const gold = randInt(20, 80);
      player.gold += gold;
      return { msgs: [`Kamu menemukan koin jatuh di jalanan.\n💰 +*${gold}g*`] };
    },
  },
  {
    id: 'monster_ambush', weight: 10,
    emoji: '👹', title: 'Diserang Monster!',
    fn: async (player) => {
      const monster = randomMonster(player.level, 0);
      const loot    = rollMonsterLoot(monster, 0);
      const gold    = rollGold(monster);
      const exp     = monster.expReward;
      player.gold += gold;
      for (const l of loot) addItem(player, l.itemId, l.qty);
      const lvl = await awardExp(player, exp);
      const lootText = loot.length ? loot.map(l => `${l.itemId}×${l.qty}`).join(', ') : 'tidak ada';
      return {
        msgs: [
          `*${monster.name}* ${monster.emoji} menyerang! Kamu berhasil mengalahkannya!`,
          `💰 +${gold}g | ⭐ +${exp} EXP\n🎒 Loot: ${lootText}`,
          ...lvl.messages,
        ],
      };
    },
  },
  {
    id: 'healing_spring', weight: 7,
    emoji: '💧', title: 'Mata Air Suci',
    fn: async (player) => {
      const healHp   = Math.floor(player.maxHp   * 0.30);
      const healMana = Math.floor(player.maxMana * 0.30);
      player.hp   = Math.min(player.maxHp,   player.hp   + healHp);
      player.mana = Math.min(player.maxMana, player.mana + healMana);
      return { msgs: [`Kamu menemukan mata air suci dan beristirahat.\n❤️ +${healHp} HP | 💙 +${healMana} Mana`] };
    },
  },
  {
    id: 'rare_material', weight: 5,
    emoji: '⛏️', title: 'Bahan Langka!',
    fn: async (player) => {
      const mats = ['ancient_rune', 'monster_core', 'dragon_scale_mat', 'void_crystal'];
      // Pilih berdasarkan level
      const pool = player.level >= 40 ? mats : player.level >= 20 ? mats.slice(0, 3) : mats.slice(0, 2);
      const item = pick(pool);
      const qty  = randInt(1, 2);
      addItem(player, item, qty);
      const itm = ITEMS[item];
      const emoji = RARITY_EMOJI[itm?.rarity] || '🔹';
      return { msgs: [`Kamu menemukan bahan langka saat menggali!\n${emoji} *${item}* ×${qty}`] };
    },
  },
  {
    id: 'reputation_event', weight: 4,
    emoji: '🌟', title: 'Pahlawan Desa!',
    fn: async (player) => {
      const rep = randInt(5, 20);
      player.reputation = (player.reputation || 0) + rep;
      const gold = rep * 5;
      player.gold += gold;
      return { msgs: [`Penduduk desa mengenalimu dan berterima kasih!\n🌟 +${rep} Reputasi | 💰 +${gold}g`] };
    },
  },
  {
    id: 'double_loot', weight: 3,
    emoji: '✨', title: 'Hari Beruntung!',
    fn: async (player) => {
      const gold = randInt(100, 300) + player.level * 15;
      const exp  = randInt(50, 150)  + player.level * 8;
      player.gold += gold;
      const lvl = await awardExp(player, exp);
      return { msgs: [`Hari ini semuanya terasa beruntung!\n💰 +${gold}g | ⭐ +${exp} EXP`, ...lvl.messages] };
    },
  },
  // ── Neutral events ──
  {
    id: 'nothing', weight: 12,
    emoji: '🌿', title: 'Jalan-jalan Biasa',
    fn: async (player) => {
      const flavorTexts = [
        'Kamu berjalan mengelilingi hutan. Tidak ada yang terjadi.',
        'Angin sepoi-sepoi. Kamu beristirahat sejenak.',
        'Kamu mengamati bintang-bintang di langit malam.',
        'Perjalanan hari ini tenang dan damai.',
        'Kamu menemukan jalur baru tapi tidak ada yang menarik.',
      ];
      return { msgs: [pick(flavorTexts)] };
    },
  },
  // ── Bad events ──
  {
    id: 'ambush_fail', weight: 6,
    emoji: '💸', title: 'Dirampok!',
    fn: async (player) => {
      const lost = Math.min(Math.floor(player.gold * 0.10), 100);
      player.gold = Math.max(0, player.gold - lost);
      return { msgs: [`Perampok menyergapmu! Kamu kehilangan *${lost}g*.\nBerhati-hatilah di lain waktu.`] };
    },
  },
  {
    id: 'trap', weight: 5,
    emoji: '🪤', title: 'Kena Jebakan!',
    fn: async (player) => {
      const dmg = Math.floor(player.maxHp * 0.15);
      player.hp = Math.max(1, player.hp - dmg);
      return { msgs: [`Kamu menginjak jebakan tersembunyi! -${dmg} HP\n❤️ HP sekarang: ${player.hp}/${player.maxHp}`] };
    },
  },
  {
    id: 'cursed_item', weight: 3,
    emoji: '💀', title: 'Item Terkutuk!',
    fn: async (player) => {
      const gold = randInt(10, 50);
      player.gold = Math.max(0, player.gold - gold);
      return { msgs: [`Kamu menyentuh item terkutuk dan kehilangan energi.\n💸 -${gold}g (biaya penyembuhan)`] };
    },
  },
];

let handler = async (m) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  if (player.hp <= 0) return m.reply(`💀 HP habis! Gunakan *!rest* dulu.`);

  // World event modifikasi peluang lucky events
  const world = await getWorldEvent();
  const events = EVENTS.map(e => ({
    ...e,
    weight: world.id === 'monster_invasion' && e.id === 'monster_ambush'
      ? e.weight * 2
      : world.id === 'divine_blessing' && ['treasure_chest', 'lucky_find', 'double_loot'].includes(e.id)
      ? e.weight * 2
      : e.weight,
  }));

  const event = weightedPick(events.map(e => ({ value: e, weight: e.weight })));
  const { msgs } = await event.fn(player);
  await savePlayer(player);

  const worldNote = world.id !== 'none'
    ? `\n${world.emoji} *${world.name}* mempengaruhi petualanganmu!`
    : '';

  return m.reply(
    `${event.emoji} *${event.title}*\n\n` +
    msgs.join('\n') +
    worldNote +
    `\n\n❤️ HP: *${player.hp}/${player.maxHp}* | 💰 Gold: *${player.gold}*`
  );
};

handler.help     = ['adventure', 'adv'];
handler.tags     = ['rpg'];
handler.command  = /^(adventure|adv|petualangan)$/i;
handler.cooldown = 45;

export default handler;
