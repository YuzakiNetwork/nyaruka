/**
 * commands/rpg/gamble.js
 * Kasino mini — taruhan gold dengan beberapa mode permainan.
 *
 * Usage:
 *   !gamble <jumlah>                       → coinflip (pilihan: kepala)
 *   !gamble coinflip <jumlah> [kepala|ekor]
 *   !gamble dice <jumlah> [genap|ganjil]
 *   !gamble slots <jumlah>
 *
 * Return to player (RTP): coinflip 96%, dice 90%, slots ±91.8%.
 */

import { getPlayer, savePlayer } from '../../lib/game/player.js';
import { randInt, chance } from '../../lib/utils/random.js';

const MIN_BET = 10;
const MAX_BET = 5000;

const COIN_WIN_CHANCE = 0.48;   // house edge 4%
const DICE_PAYOUT     = 1.8;    // 50% × 1.8 = RTP 90%

const COIN_SIDES = { kepala: 'Kepala 👑', ekor: 'Ekor 🌕' };
const COIN_ALIAS = { kepala: 'kepala', head: 'kepala', heads: 'kepala', ekor: 'ekor', tail: 'ekor', tails: 'ekor' };
const DICE_ALIAS = { genap: 'genap', even: 'genap', ganjil: 'ganjil', odd: 'ganjil' };

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  // ── Parse argumen ──────────────────────────────────────────────────────────
  const first        = args[0]?.toLowerCase();
  const numericFirst = /^\d+$/.test(first ?? '');
  const mode         = numericFirst ? 'coinflip' : first;
  const amtRaw       = numericFirst ? args[0] : args[1];
  const pickRaw      = (numericFirst ? args[1] : args[2])?.toLowerCase();
  const amount       = /^\d+$/.test(amtRaw ?? '') ? parseInt(amtRaw, 10) : NaN;

  if (!amount) {
    return m.reply(
      `🎲 *Uji Peruntungan*\n\n` +
      `Mode permainan:\n` +
      `  🪙 *!gamble coinflip <jumlah> [kepala|ekor]* — menang 2×\n` +
      `  🎲 *!gamble dice <jumlah> [genap|ganjil]* — menang ${DICE_PAYOUT}×\n` +
      `  🎰 *!gamble slots <jumlah>* — menang hingga 10×\n\n` +
      `Min bet: *${MIN_BET}g* | Max bet: *${MAX_BET}g*\n` +
      `💰 Goldmu: *${player.gold}g*`
    );
  }

  if (amount < MIN_BET)     return m.reply(`❌ Minimum taruhan: *${MIN_BET}g*`);
  if (amount > MAX_BET)     return m.reply(`❌ Maximum taruhan: *${MAX_BET}g*`);
  if (player.gold < amount) return m.reply(`❌ Gold tidak cukup! Punya: *${player.gold}g*`);

  // ── Coin Flip ──────────────────────────────────────────────────────────────
  if (mode === 'coinflip' || mode === 'coin') {
    const choice = pickRaw ? COIN_ALIAS[pickRaw] : 'kepala';
    if (!choice) return m.reply(`❌ Pilihan tidak valid. Gunakan: *kepala* atau *ekor*`);

    const win    = chance(COIN_WIN_CHANCE);
    const other  = choice === 'kepala' ? 'ekor' : 'kepala';
    const result = win ? choice : other;

    player.gold += win ? amount : -amount;
    await savePlayer(player);

    return m.reply(
      `🪙 *Coin Flip!*\n\n` +
      `Pilihanmu: ${COIN_SIDES[choice]}\n` +
      `Hasil: *${COIN_SIDES[result]}*\n\n` +
      (win ? `🎉 Menang! +*${amount}g*\n💰 Total: *${player.gold}g*`
           : `💸 Kalah! -*${amount}g*\n💰 Sisa: *${player.gold}g*`)
    );
  }

  // ── Dice ───────────────────────────────────────────────────────────────────
  if (mode === 'dice' || mode === 'dadu') {
    const choice = pickRaw ? DICE_ALIAS[pickRaw] : 'genap';
    if (!choice) return m.reply(`❌ Pilihan tidak valid. Gunakan: *genap* atau *ganjil*`);

    const roll      = randInt(1, 6);
    const rollType  = roll % 2 === 0 ? 'genap' : 'ganjil';
    const win       = rollType === choice;
    const profit    = Math.floor(amount * DICE_PAYOUT) - amount;

    player.gold += win ? profit : -amount;
    await savePlayer(player);

    return m.reply(
      `🎲 *Dadu!*\n\n` +
      `Hasil: *${roll}* (${rollType === 'genap' ? 'Genap' : 'Ganjil'})\n` +
      `Tebakanmu: ${choice}\n\n` +
      (win ? `🎉 Menang! +*${profit}g*\n💰 Total: *${player.gold}g*`
           : `💸 Kalah! -*${amount}g*\n💰 Sisa: *${player.gold}g*`)
    );
  }

  // ── Slots ──────────────────────────────────────────────────────────────────
  if (mode === 'slots' || mode === 'slot') {
    const symbols = ['🍒', '🍋', '🍊', '🍇', '⭐', '💎'];
    const weights = [30, 25, 20, 15, 8, 2];
    const roll3 = () => {
      const r = Math.random() * 100;
      let cum = 0;
      for (let i = 0; i < symbols.length; i++) {
        cum += weights[i];
        if (r < cum) return symbols[i];
      }
      return symbols[0];
    };

    const [s1, s2, s3] = [roll3(), roll3(), roll3()];
    const allSame = s1 === s2 && s2 === s3;
    const twoSame = s1 === s2 || s2 === s3 || s1 === s3;

    let winAmt = 0, msg = '';
    if (allSame && s1 === '💎')      { winAmt = amount * 10;               msg = `💎 JACKPOT! ×10!`; }
    else if (allSame && s1 === '⭐') { winAmt = amount * 5;                msg = `⭐ SUPER! ×5!`; }
    else if (allSame)                { winAmt = amount * 3;                msg = `🎉 Tiga sama! ×3!`; }
    else if (twoSame)                { winAmt = Math.floor(amount * 1.5);  msg = `✨ Dua sama! ×1.5!`; }
    else                             { msg = `💸 Tidak ada match.`; }

    const profit = winAmt - amount;
    player.gold += profit;
    await savePlayer(player);

    return m.reply(
      `🎰 *SLOTS!*\n\n` +
      `[ ${s1} | ${s2} | ${s3} ]\n\n` +
      `${msg}\n` +
      (profit > 0 ? `💰 +${profit}g` : `💸 -${amount}g`) +
      `\n💰 Sisa: *${player.gold}g*`
    );
  }

  return m.reply(`❌ Mode tidak dikenal. Gunakan: *coinflip* | *dice* | *slots*`);
};

handler.help     = [
  'gamble <jumlah>',
  'gamble coinflip <jml> [kepala|ekor]',
  'gamble dice <jml> [genap|ganjil]',
  'gamble slots <jml>',
];
handler.tags     = ['rpg'];
handler.command  = /^(gamble|casino|bet|taruhan)$/i;
handler.cooldown = 15;

export default handler;
