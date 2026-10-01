/**
 * commands/rpg/zone.js
 * Zone/Map System — Area berbeda dengan monster & reward berbeda
 */

import { getPlayer, savePlayer } from '../../lib/game/player.js';

export const ZONES = {
  village: {
    id: 'village', name: '🏘️ Desa Pemula', reqLevel: 1,
    desc: 'Area aman untuk petualang baru. Monster lemah, reward kecil.',
    monsters: ['slime', 'cave_bat', 'goblin_scout'],
    goldMult: 1.0, expMult: 1.0,
    bgm: '🎵 Musik desa yang damai...',
    danger: 'rendah',
  },
  forest: {
    id: 'forest', name: '🌲 Hutan Kuno', reqLevel: 5,
    desc: 'Hutan lebat dengan predator berbahaya.',
    monsters: ['forest_wolf', 'goblin_scout', 'cave_bat'],
    goldMult: 1.3, expMult: 1.3,
    bgm: '🎵 Suara desiran daun dan lolongan...',
    danger: 'sedang',
  },
  cave: {
    id: 'cave', name: '🏔️ Gua Kristal', reqLevel: 15,
    desc: 'Gua misterius dengan kristal berbahaya dan monster bertapis.',
    monsters: ['dark_knight', 'ice_golem', 'cave_bat'],
    goldMult: 1.8, expMult: 1.7,
    bgm: '🎵 Tetesan air dan gemuruh kristal...',
    danger: 'tinggi',
  },
  volcano: {
    id: 'volcano', name: '🌋 Kawah Api Abadi', reqLevel: 30,
    desc: 'Gunung berapi dengan monster elemen api. Butuh perlengkapan tahan panas.',
    monsters: ['fire_elemental', 'dark_knight'],
    goldMult: 2.5, expMult: 2.3,
    bgm: '🎵 Gemuruh magma dan lecutan api...',
    danger: 'sangat tinggi',
  },
  shadow_realm: {
    id: 'shadow_realm', name: '🌑 Alam Bayangan', reqLevel: 50,
    desc: 'Dimensi gelap tempat tinggal makhluk void. Hanya yang kuat bisa bertahan.',
    monsters: ['shadow_assassin', 'void_lich'],
    goldMult: 3.5, expMult: 3.0,
    bgm: '🎵 Kesunyian yang mengerikan...',
    danger: 'ekstrem',
  },
  sky_citadel: {
    id: 'sky_citadel', name: '☁️ Benteng Langit', reqLevel: 70,
    desc: 'Benteng mengambang di atas awan. Monster terkuat penjaga langit.',
    monsters: ['ancient_dragon', 'shadow_assassin'],
    goldMult: 5.0, expMult: 4.5,
    bgm: '🎵 Angin dewa yang membelah langit...',
    danger: 'dewa',
  },
  void_abyss: {
    id: 'void_abyss', name: '🕳️ Jurang Ketiadaan', reqLevel: 90,
    desc: '[ AREA TERAKHIR ] Kedalaman terbawah eksistensi. Boss tertinggi bersemayam di sini.',
    monsters: ['void_lich', 'ancient_dragon'],
    goldMult: 8.0, expMult: 7.0,
    bgm: '🎵 Kekosongan absolut...',
    danger: '☠️ MAUT',
  },
};

const DANGER_EMOJI = {
  'rendah': '🟢', 'sedang': '🟡', 'tinggi': '🟠',
  'sangat tinggi': '🔴', 'ekstrem': '🔴⚠️', 'dewa': '💀', '☠️ MAUT': '☠️',
};

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  const sub = args[0]?.toLowerCase() || 'map';

  // ── !zone map ──────────────────────────────────────────────────────────────
  if (sub === 'map' || sub === 'list' || sub === 'semua') {
    const current = player.currentZone || 'village';
    const lines   = Object.values(ZONES).map(z => {
      const unlocked = player.level >= z.reqLevel;
      const isCurrent = z.id === current;
      const dangerEmoji = DANGER_EMOJI[z.danger] || '❓';
      return (
        `${isCurrent ? '▶️' : unlocked ? '✅' : '🔒'} ${z.name}\n` +
        `   Lv.${z.reqLevel}+ | Bahaya: ${dangerEmoji} ${z.danger}\n` +
        `   EXP ×${z.expMult} | Gold ×${z.goldMult}`
      );
    });
    return m.reply(
      `🗺️ *Peta Dunia*\n\n` +
      lines.join('\n\n') +
      `\n\n▶️ = sekarang | ✅ = bisa masuk | 🔒 = belum terbuka\n` +
      `Pindah: *!zone pergi <nama_zona>*`
    );
  }

  // ── !zone info ─────────────────────────────────────────────────────────────
  if (sub === 'info' || sub === 'cek') {
    const zoneId = args.slice(1).join('_') || player.currentZone || 'village';
    const zone   = ZONES[zoneId] || Object.values(ZONES).find(z => z.id === zoneId || z.name.toLowerCase().includes(args.slice(1).join(' ').toLowerCase()));

    if (!zone) return m.reply(`❌ Zona tidak ditemukan. Cek *!zone map*`);

    return m.reply(
      `${zone.name}\n\n` +
      `"_${zone.desc}_"\n\n` +
      `⚠️ Bahaya: *${zone.danger}*\n` +
      `📊 Bonus: EXP ×${zone.expMult} | Gold ×${zone.goldMult}\n` +
      `🔓 Syarat: Level *${zone.reqLevel}*+\n` +
      `${zone.bgm}\n\n` +
      `Pindah ke sini: *!zone pergi ${zone.id}*`
    );
  }

  // ── !zone pergi <zone> ─────────────────────────────────────────────────────
  if (sub === 'pergi' || sub === 'go' || sub === 'masuk' || sub === 'travel') {
    const input  = args.slice(1).join('_').toLowerCase();
    const zone   = ZONES[input] || Object.values(ZONES).find(z =>
      z.id.includes(input) || z.name.toLowerCase().includes(input.replace(/_/g, ' '))
    );

    if (!zone) return m.reply(`❌ Zona tidak ditemukan. Cek *!zone map*`);
    if (player.level < zone.reqLevel) {
      return m.reply(`❌ Level tidak cukup!\n\n*${zone.name}* butuh Level *${zone.reqLevel}*\nKamu: Level *${player.level}*`);
    }
    if (player.currentZone === zone.id) {
      return m.reply(`❌ Kamu sudah berada di *${zone.name}*!`);
    }

    const prevZone = ZONES[player.currentZone || 'village'];
    player.currentZone = zone.id;
    await savePlayer(player);

    return m.reply(
      `🚀 *Berpindah Zona!*\n\n` +
      `${prevZone?.name || '?'} ──→ ${zone.name}\n\n` +
      `"_${zone.desc}_"\n\n` +
      `${zone.bgm}\n\n` +
      `⚠️ Tingkat bahaya: *${zone.danger}*\n` +
      `📊 Bonus battle: EXP ×${zone.expMult} | Gold ×${zone.goldMult}\n\n` +
      `Gunakan *!battle* untuk bertarung di zona ini!`
    );
  }

  // ── !zone status ───────────────────────────────────────────────────────────
  const current = ZONES[player.currentZone || 'village'] || ZONES.village;
  const dangerEmoji = DANGER_EMOJI[current.danger] || '❓';
  return m.reply(
    `📍 *Zona Saat Ini*\n\n` +
    `${current.name}\n` +
    `"_${current.desc}_"\n\n` +
    `⚠️ Bahaya: ${dangerEmoji} *${current.danger}*\n` +
    `📊 Bonus: EXP ×${current.expMult} | Gold ×${current.goldMult}\n` +
    `${current.bgm}\n\n` +
    `🗺️ Lihat semua zona: *!zone map*\n` +
    `🚀 Pindah zona: *!zone pergi <nama>*`
  );
};

handler.help    = ['zone', 'zone map', 'zone pergi <zona>'];
handler.tags    = ['rpg'];
handler.command = /^(zone|map|area|wilayah)$/i;
handler.cooldown = 10;
export default handler;
