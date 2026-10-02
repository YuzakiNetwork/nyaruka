/**
 * commands/rpg/gamble.js
 * Kasino mini — taruhan gold dengan beberapa mode permainan.
 * Usage: !gamble <jumlah> | !gamble coinflip <jumlah> | !gamble dice <jumlah>
 */

import { getPlayer, savePlayer } from '../../lib/game/player.js';
import { randInt, chance, pick } from '../../lib/utils/random.js';

const MIN_BET = 10;
const MAX_BET = 5000;

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  const mode  = isNaN(args[0]) ? args[0]?.toLowerCase() : 'coinflip';
  const amtRaw = isNaN(args[0]) ? args[1] : args[0];
  const amount = parseInt(amtRaw);

  if (!amount || isNaN(amount)) {
    return m.reply(
      `🎲 *Uji Peruntungan*\n\n` +
      `Mode permainan:\n` +
      `  🪙 *!gamble coinflip <jumlah>* — 50/50, menang 2×\n` +
      `  🎲 *!gamble dice <jumlah>* — tebak genap/ganjil, menang 1.8×\n` +
      `  🎰 *!gamble slots <jumlah>* — 3 simbol, menang 3×\n\n` +
      `Min bet: *${MIN_BET}g* | Max bet: *${MAX_BET}g*\n` +
      `💰 Goldmu: *${player.gold}g*`
    );
  }

  if (amount < MIN_BET)    return m.reply(`❌ Minimum taruhan: *${MIN_BET}g*`);
  if (amount > MAX_BET)    return m.reply(`❌ Maximum taruhan: *${MAX_BET}g*`);
  if (player.gold < amount) return m.reply(`❌ Gold tidak cukup! Punya: *${player.gold}g*`);

  // ── Coin Flip ──────────────────────────────────────────────────────────────
  if (!mode || mode === 'coinflip' || mode === 'coin') {
    const win   = chance(0.48); // sedikit house edge
    const sides = ['Kepala 👑', 'Ekor 🌕'];
    const result = pick(sides);
    const pResult = pick(sides);

    const isWin = result === pResult;
    if (isWin) {
      player.gold += amount;
      await savePlayer(player);
      return m.reply(
        `🪙 *Coin Flip!*\n\n` +
        `Hasil: *${result}*\n\n` +
        `🎉 Menang! +*${amount}g*\n` +
        `💰 Total: *${player.gold}g*`
      );
    } else {
      player.gold -= amount;
      await savePlayer(player);
      return m.reply(
        `🪙 *Coin Flip!*\n\n` +
        `Hasil: *${result}*\n\n` +
        `💸 Kalah! -*${amount}g*\n` +
        `💰 Sisa: *${player.gold}g*`
      );
    }
  }

  // ── Dice ──────────────────────────────────────────────────────────────────
  if (mode === 'dice' || mode === 'dadu') {
    const roll     = randInt(1, 6);
    const isEven   = roll % 2 === 0;
    // Player selalu pilih genap (bisa dikembangkan untuk pilih sendiri)
    const playerPick = 'genap';
    const win        = isEven;
    const winAmount  = Math.floor(amount * 1.8);

    if (win) {
      player.gold += winAmount - amount;
      await savePlayer(player);
      return m.reply(
        `🎲 *Dadu!*\n\n` +
        `Hasil: *${roll}* (Genap ✅)\n` +
        `Tebakanmu: ${playerPick}\n\n` +
        `🎉 Menang! +*${winAmount - amount}g*\n` +
        `💰 Total: *${player.gold}g*`
      );
    } else {
      player.gold -= amount;
      await savePlayer(player);
      return m.reply(
        `🎲 *Dadu!*\n\n` +
        `Hasil: *${roll}* (Ganjil ❌)\n` +
        `Tebakanmu: ${playerPick}\n\n` +
        `💸 Kalah! -*${amount}g*\n` +
        `💰 Sisa: *${player.gold}g*`
      );
    }
  }

  // ── Slots ─────────────────────────────────────────────────────────────────
  if (mode === 'slots' || mode === 'slot') {
    const symbols    = ['🍒', '🍋', '🍊', '🍇', '⭐', '💎'];
    const weights    = [30, 25, 20, 15, 8, 2];
    const roll3      = () => {
      let r = Math.random() * 100, cum = 0;
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
    if (allSame && s1 === '💎') {
      winAmt = amount * 10; msg = `💎 JACKPOT! ×10!`;
    } else if (allSame && s1 === '⭐') {
      winAmt = amount * 5;  msg = `⭐ SUPER! ×5!`;
    } else if (allSame) {
      winAmt = amount * 3;  msg = `🎉 Tiga sama! ×3!`;
    } else if (twoSame) {
      winAmt = Math.floor(amount * 1.5); msg = `✨ Dua sama! ×1.5!`;
    } else {
      winAmt = 0; msg = `💸 Tidak ada match.`;
    }

    const profit = winAmt - amount;
    player.gold  = Math.max(0, player.gold + profit);
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

handler.help     = ['gamble <jumlah>', 'gamble coinflip <jml>', 'gamble dice <jml>', 'gamble slots <jml>'];
handler.tags     = ['rpg'];
handler.command  = /^(gamble|casino|bet|taruhan)$/i;
handler.cooldown = 15;

export default handler;
