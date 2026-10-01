/**
 * commands/rpg/story.js
 * Story/Lore System — Cerita utama bergaya anime isekai
 */

import { getPlayer, savePlayer } from '../../lib/game/player.js';

const STORY_CHAPTERS = [
  {
    id: 1, title: 'Awal Dari Segalanya', reqLevel: 1,
    scenes: [
      { text: `📖 *Prolog*\n\nTahun 2024. Kamu adalah seorang biasa yang tiba-tiba...\n\n*CRASH!*\n\nSebuah kilatan cahaya menelanmu.\n\nSaat matamu terbuka — langit yang kamu lihat bukan langit kotamu.`, choices: null },
      { text: `🌟 *Suara dari Langit*\n\n_"Dengarkan aku, Yang Terpilih..."_\n\nSosok cahaya muncul di hadapanmu.\n\n_"Dunia ini dalam bahaya. Setan Agung Zar'ok bangkit dari tidur abadinya. Kamu adalah satu-satunya yang bisa menghentikannya."_`, choices: null },
      { text: `⚔️ *Petualangan Dimulai*\n\nKamu terdampar di *Desa Pemula* dengan tangan kosong.\n\nSeorang tua menghampiri:\n_"Ah... sorot matamu. Kamu bukan orang biasa. Ambillah pedang ini, dan mulailah jalanmu."_\n\nDan begitulah — petualanganmu dimulai.`, choices: null },
    ],
    completionReward: { gold: 100, exp: 50 },
  },
  {
    id: 2, title: 'Ancaman Hutan Kuno', reqLevel: 10,
    scenes: [
      { text: `🌲 *Bab 2 — Ancaman Hutan Kuno*\n\nKamu tiba di gerbang Hutan Kuno.\nSeorang penjaga menghentikanmu:\n\n_"Berhenti! Hutan itu... berubah. Serigala-serigala menjadi ganas semalaman. Beberapa desa sudah diserang."_`, choices: null },
      { text: `🐺 *Sang Alpha*\n\nDi jantung hutan, kamu menemukan sebuah altar hitam.\nDi atasnya — kristal gelap yang memancarkan aura jahat.\n\nTiba-tiba sebuah raungan menggelegar:\n_"AUUUUU— RUNTUHKAN MEREKA!"_\n\nAlpha Wolf, diperkuat oleh kekuatan iblis, muncul.`, choices: null },
      { text: `✨ *Setelah Kemenangan*\n\nKristal itu hancur. Hutan kembali tenang.\nSi tua kembali berkata:\n\n_"Begitu... Ini bukan kebetulan. Seseorang atau sesuatu menyebarkan kristal-kristal ini ke seluruh dunia. Kamu perlu menjadi lebih kuat... jauh lebih kuat dari ini."_`, choices: null },
    ],
    completionReward: { gold: 300, exp: 200 },
  },
  {
    id: 3, title: 'Kota Di Bawah Bayangan', reqLevel: 25,
    scenes: [
      { text: `🏙️ *Bab 3 — Kota Di Bawah Bayangan*\n\nKota Aldrath — kota terbesar di selatan — kini diselimuti kegelapan.\nPenduduknya ketakutan, jalanan sepi.\n\nSeorang gadis berlari ke arahmu:\n_"Tolong! Para Shadow Assassin mengambil alih kota! Mereka bekerja untuk... seseorang. Seseorang yang sangat kuat."_`, choices: null },
      { text: `👥 *Pengkhianatan*\n\nKamu menerobos markas Shadow Assassin.\nDi sana — wajah yang mengejutkanmu.\n\nSi Tua yang memberimu pedang di awal.\n\n_"...Maaf. Aku tidak punya pilihan. Zar'ok sudah bangkit. Jika kamu tidak bisa dihentikan sekarang, dunia akan berakhir lebih cepat."_\n\n_"Tapi aku salah menilaimu. Pergilah. Dan jadilah lebih kuat dari yang pernah ada."_`, choices: null },
    ],
    completionReward: { gold: 1000, exp: 700 },
  },
  {
    id: 4, title: 'Menuju Puncak', reqLevel: 50,
    scenes: [
      { text: `🌌 *Bab 4 — Menuju Puncak*\n\n_"Kamu sudah melampaui batas manusia,"_ bisik suara dalam dirimu.\n\nKamu berdiri di depan Gunung Terlarang.\nDi puncaknya — Gerbang menuju Alam Bayangan.\nDi balik gerbang itu — Zar'ok menunggumu.\n\n_"Tidak ada yang pernah kembali dari sana."_\n_"Tapi kamu bukan 'tidak ada'."_`, choices: null },
    ],
    completionReward: { gold: 5000, exp: 3000 },
  },
  {
    id: 5, title: 'Pertarungan Terakhir', reqLevel: 80,
    scenes: [
      { text: `💢 *BAB FINAL — Pertarungan Terakhir*\n\n_"Jadi kamu akhirnya tiba juga... Yang Terpilih."_\n\nZar'ok berdiri di hadapanmu, memancarkan aura yang membekukan dunia.\n\n_"Aku telah menunggu ribuan tahun. Untuk seseorang yang layak menjadi korbanku."_\n\n_"...Atau mungkin... musuh yang layak."_\n\nLangit pecah. Tanah berguncang.\n*Ini adalah pertarunganmu.*`, choices: null },
      { text: `🌟 *Epilog*\n\nDengan satu tebasan terakhir — Zar'ok jatuh.\n\nLangit yang gelap perlahan-lahan kembali biru.\n\nSuara dari seluruh dunia mengalun:\n_"Terima kasih... Yang Terpilih."_\n\nKamu tersenyum.\n\nBukan karena kamu pahlawan.\nBukan karena kamu terpilih.\n\nTapi karena perjalanan ini — adalah milikmu.\n\n*THE END... or is it?* ✨`, choices: null },
    ],
    completionReward: { gold: 20000, exp: 10000 },
  },
];

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  const sub = args[0]?.toLowerCase() || 'progress';
  if (!player.storyProgress) player.storyProgress = { chapter: 0, scene: 0 };

  // ── !story progress ────────────────────────────────────────────────────────
  if (sub === 'progress' || sub === 'status') {
    const current = player.storyProgress.chapter;
    const lines   = STORY_CHAPTERS.map(ch => {
      const done   = current > ch.id;
      const active = current === ch.id;
      const locked = player.level < ch.reqLevel;
      return `${done ? '✅' : active ? '📖' : locked ? '🔒' : '⬜'} Bab ${ch.id}: *${ch.title}* — Lv.${ch.reqLevel}+`;
    });

    return m.reply(
      `📚 *Story Progress*\n\n` +
      lines.join('\n') +
      `\n\n${current === 0
        ? 'Mulai petualanganmu: *!story mulai*'
        : current > STORY_CHAPTERS.length
        ? '🎉 *Semua bab selesai!*'
        : `Lanjutkan: *!story lanjut*`}`
    );
  }

  // ── !story mulai / lanjut ──────────────────────────────────────────────────
  if (sub === 'mulai' || sub === 'lanjut' || sub === 'next' || sub === 'baca') {
    const chIdx = (player.storyProgress.chapter || 0);
    const ch    = STORY_CHAPTERS[chIdx];

    if (!ch) {
      return m.reply(`📚 *Semua chapter sudah selesai!*\n\n_"Petualanganmu tidak pernah benar-benar berakhir..."_`);
    }
    if (player.level < ch.reqLevel) {
      return m.reply(`🔒 Chapter ini butuh Level *${ch.reqLevel}*\nKamu: Level *${player.level}*\n\nTerus bertarung dan naik level!`);
    }

    const sceneIdx = player.storyProgress.scene || 0;
    const scene    = ch.scenes[sceneIdx];

    if (!scene) {
      // Chapter selesai
      player.storyProgress.chapter += 1;
      player.storyProgress.scene   = 0;
      player.gold = (player.gold || 0) + ch.completionReward.gold;
      player.exp  = (player.exp  || 0) + ch.completionReward.exp;
      await savePlayer(player);
      return m.reply(
        `✅ *Chapter "${ch.title}" Selesai!*\n\n` +
        `💰 +${ch.completionReward.gold}g | ⭐ +${ch.completionReward.exp} EXP\n\n` +
        `Lanjut ke chapter berikutnya: *!story lanjut*`
      );
    }

    // Tampilkan scene
    player.storyProgress.scene = sceneIdx + 1;
    await savePlayer(player);

    const isLast  = sceneIdx === ch.scenes.length - 1;
    return m.reply(
      `📖 *Bab ${ch.id}: ${ch.title}*\n` +
      `(${sceneIdx + 1}/${ch.scenes.length})\n\n` +
      scene.text +
      `\n\n${isLast ? '✅ Chapter hampir selesai!\nLanjut: *!story lanjut*' : '▶️ Lanjut: *!story lanjut*'}`
    );
  }

  return m.reply(
    `📚 *Story System*\n\n` +
    `!story          — lihat progress\n` +
    `!story mulai    — mulai / lanjut cerita\n\n` +
    `Selesaikan chapter untuk reward besar!`
  );
};

handler.help    = ['story', 'story lanjut'];
handler.tags    = ['rpg'];
handler.command = /^(story|lore|cerita|bab)$/i;
handler.cooldown = 10;
export default handler;
