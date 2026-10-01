/**
 * commands/rpg/pet.js
 * Pet/Familiar System
 */

import { getPlayer, savePlayer }                     from '../../lib/game/player.js';
import { getPet, savePet, createPet, feedPet, awardPetExp, getPetStats, PET_TYPES } from '../../lib/game/pet.js';

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  const sub = args[0]?.toLowerCase() || 'status';
  const pet = getPet(m.sender);

  // ── !pet status ────────────────────────────────────────────────────────────
  if (sub === 'status' || sub === 'info' || sub === 'stat') {
    if (!pet) return m.reply(`🐾 Kamu belum punya pet!\n\nCara dapat pet:\n• Battle monster dan ada % chance tangkap\n• Gunakan *!pet list* untuk lihat yang bisa ditangkap`);

    const stats   = getPetStats(pet);
    const type    = PET_TYPES[pet.typeId];
    const evoInfo = type?.evoLevel ? ` | Evolusi: Lv.${type.evoLevel}` : '';
    const happyBar = '❤️'.repeat(Math.floor((pet.happiness || 0) / 20)) + '🖤'.repeat(5 - Math.floor((pet.happiness || 0) / 20));
    const hungerBar = '🍖'.repeat(Math.floor((pet.hunger || 0) / 20)) + '⬛'.repeat(5 - Math.floor((pet.hunger || 0) / 20));

    return m.reply(
      `🐾 *Pet Status*\n\n` +
      `${type?.id?.includes('dragon') ? '🔥' : '⭐'} *${pet.name || type?.name}*\n` +
      `Level: *${pet.level}* | EXP: ${pet.exp}/${pet.expToNext}${evoInfo}\n\n` +
      `❤️ ${happyBar} (${pet.happiness || 0}%)\n` +
      `🍖 ${hungerBar} (${pet.hunger || 0}%)\n\n` +
      `📊 *Stats:*\n` +
      `HP: ${stats.hp} | ATK: ${stats.attack}\n` +
      `DEF: ${stats.defense} | SPD: ${stats.speed}\n\n` +
      `🎁 Bonus ke kamu: +${Math.floor(stats.attack * 0.15)} ATK | +${Math.floor(stats.defense * 0.15)} DEF\n\n` +
      `"_${type?.description}_"`
    );
  }

  // ── !pet list ──────────────────────────────────────────────────────────────
  if (sub === 'list' || sub === 'all') {
    const catchable = Object.values(PET_TYPES).filter(p => p.catchRate > 0);
    const lines = catchable.map(p =>
      `${p.name} — Rate: *${(p.catchRate * 100).toFixed(0)}%* | Dari: ${p.catchFrom}`
    );
    return m.reply(
      `🐾 *Pet yang Bisa Ditangkap*\n\n` +
      lines.join('\n') +
      `\n\n💡 Tangkap saat battle! Makin lemah monster = makin tinggi chance.`
    );
  }

  // ── !pet feed ──────────────────────────────────────────────────────────────
  if (sub === 'feed' || sub === 'makan' || sub === 'kasih') {
    if (!pet) return m.reply(`❌ Kamu belum punya pet!`);
    if ((pet.hunger || 0) >= 100) return m.reply(`🍖 Pet sudah kenyang!`);

    const cost = 50;
    if ((player.gold || 0) < cost) return m.reply(`❌ Gold tidak cukup! Butuh ${cost}g`);
    player.gold -= cost;
    await savePlayer(player);
    await feedPet(pet);

    return m.reply(`🍖 *${pet.name}* diberi makan!\nHunger: ${pet.hunger}% | Happiness: ${pet.happiness}%`);
  }

  // ── !pet release ───────────────────────────────────────────────────────────
  if (sub === 'release' || sub === 'lepas') {
    if (!pet) return m.reply(`❌ Kamu belum punya pet!`);
    await savePet({ ...pet, ownerId: m.sender, active: false });
    return m.reply(`👋 *${pet.name}* dilepaskan ke alam bebas.\n\n_Terima kasih atas petualangan bersamamu..._`);
  }

  // ── !pet rename <nama> ─────────────────────────────────────────────────────
  if (sub === 'rename' || sub === 'nama') {
    if (!pet) return m.reply(`❌ Kamu belum punya pet!`);
    const newName = args.slice(1).join(' ').trim();
    if (!newName || newName.length > 20) return m.reply(`Usage: *!pet rename <nama>* (maks 20 karakter)`);
    pet.name = newName;
    await savePet(pet);
    return m.reply(`✅ Pet berganti nama menjadi *${newName}*!`);
  }

  return m.reply(
    `🐾 *Pet Commands*\n\n` +
    `!pet         — status pet kamu\n` +
    `!pet list    — pet yang bisa ditangkap\n` +
    `!pet feed    — beri makan (50g)\n` +
    `!pet rename  — ganti nama\n` +
    `!pet release — lepaskan pet\n\n` +
    `💡 Pet otomatis tertangkap saat !battle.`
  );
};

handler.help    = ['pet', 'pet feed', 'pet list'];
handler.tags    = ['rpg'];
handler.command = /^(pet|familiar|peliharaan)$/i;
handler.cooldown = 5;
export default handler;
