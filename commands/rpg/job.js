/**
 * commands/rpg/job.js
 * Job Advancement — Evolusi class ala anime isekai
 * !job → lihat status & pilihan advance
 * !job advance <nama_job> → advance ke job tersebut
 * !job tree → lihat seluruh job tree
 */

import { getPlayer, savePlayer }           from '../../lib/game/player.js';
import { JOB_TREE, getAvailableAdvances, getTierName } from '../../lib/game/job.js';
import { checkTitles }                     from '../../lib/game/title.js';

let handler = async (m, { args }) => {
  const player = getPlayer(m.sender);
  if (!player) return m.reply(`❌ Daftar dulu: *!register <nama> <class>*`);

  const sub     = args[0]?.toLowerCase() || 'status';
  const curJob  = player.job || player.class;
  const jobData = JOB_TREE[curJob];

  // ── !job tree ──────────────────────────────────────────────────────────────
  if (sub === 'tree') {
    const lines = [`🌳 *Job Advancement Tree*\n`];
    const rootJobs = ['Warrior', 'Mage', 'Archer', 'Assassin'];
    for (const root of rootJobs) {
      const j = JOB_TREE[root];
      lines.push(`${j.emoji} *${root}* (T1)`);
      const buildTree = (jobId, depth) => {
        const j2 = JOB_TREE[jobId];
        if (!j2) return;
        const indent = '  '.repeat(depth);
        const isUnlocked = player.level >= j2.reqLevel;
        const isCurrent  = (player.job || player.class) === jobId;
        lines.push(`${indent}${isCurrent ? '▶️' : isUnlocked ? '✅' : '🔒'} ${j2.emoji} *${jobId}* — Lv.${j2.reqLevel} (T${j2.tier})`);
        (j2.nextJobs || []).forEach(next => buildTree(next, depth + 1));
      };
      (j.nextJobs || []).forEach(next => buildTree(next, 1));
      lines.push('');
    }
    return m.reply(lines.join('\n'));
  }

  // ── !job advance <job> ─────────────────────────────────────────────────────
  if (sub === 'advance' || sub === 'evolve' || sub === 'up') {
    const targetJobName = args.slice(1).join(' ');
    if (!targetJobName) {
      const avail = getAvailableAdvances(player);
      if (!avail.length) {
        return m.reply(`❌ Belum bisa advance.\nJob: *${curJob}* | Level: *${player.level}*\n\nGunakan *!job* untuk lihat syarat.`);
      }
      return m.reply(
        `❓ Pilih job tujuan:\n\n` +
        avail.map(j => `• *${j.id}* — ${j.emoji} ${j.description}`).join('\n') +
        `\n\nGunakan: *!job advance <nama_job>*`
      );
    }

    // Cari job yang cocok
    const targetJob = Object.values(JOB_TREE).find(j =>
      j.prevJob === curJob &&
      (j.id || Object.keys(JOB_TREE).find(k => JOB_TREE[k] === j))?.toLowerCase() === targetJobName.toLowerCase()
    );
    // Lookup by key
    const targetKey = Object.keys(JOB_TREE).find(k => k.toLowerCase() === targetJobName.toLowerCase());
    const target    = targetKey ? JOB_TREE[targetKey] : null;

    if (!target || target.prevJob !== curJob) {
      return m.reply(`❌ Job *${targetJobName}* tidak tersedia dari *${curJob}*.`);
    }
    if (player.level < target.reqLevel) {
      return m.reply(`❌ Level tidak cukup! Butuh *Lv.${target.reqLevel}* (kamu Lv.${player.level}).`);
    }

    // Apply advance
    const oldJob   = curJob;
    player.job     = targetKey;
    player.class   = targetKey; // sync

    // Apply stat bonus
    const bonus = target.statBonus || {};
    player.maxHp    = (player.maxHp   || 0) + (bonus.hp      || 0);
    player.hp       = Math.min(player.hp + (bonus.hp || 0), player.maxHp);
    player.maxMana  = (player.maxMana  || 0) + (bonus.mana    || 0);
    player.mana     = Math.min(player.mana + (bonus.mana || 0), player.maxMana);
    player.attack   = (player.attack   || 0) + (bonus.attack  || 0);
    player.defense  = (player.defense  || 0) + (bonus.defense || 0);
    player.speed    = (player.speed    || 0) + (bonus.speed   || 0);

    // Unlock skills baru
    if (!player.skills) player.skills = [];
    for (const sk of (target.unlockSkills || [])) {
      if (!player.skills.includes(sk)) player.skills.push(sk);
    }

    // Cek title baru
    const newTitles = checkTitles(player);
    await savePlayer(player);

    const bonusLines = Object.entries(bonus)
      .filter(([, v]) => v !== 0)
      .map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k.toUpperCase()}`)
      .join(' | ');

    return m.reply(
      `🎊 *JOB ADVANCEMENT!* 🎊\n\n` +
      `${JOB_TREE[oldJob]?.emoji || '⚔️'} *${oldJob}*\n` +
      `  ↓↓↓\n` +
      `${target.emoji} *${targetKey}* — ${getTierName(target.tier)}\n\n` +
      `"_${target.description}_"\n\n` +
      `📊 *Stat Bonus:*\n${bonusLines || 'Tidak ada'}\n\n` +
      `🎯 *Skill Baru:*\n${(target.unlockSkills || []).join(', ') || 'Tidak ada'}\n\n` +
      (newTitles.length ? `🏆 Title baru: ${newTitles.map(t => t.name).join(', ')}\n\n` : '') +
      `Gunakan *!job* untuk lihat progress.`
    );
  }

  // ── !job status ────────────────────────────────────────────────────────────
  const avail   = getAvailableAdvances(player);
  const nextReq = jobData?.nextJobs
    ?.map(k => `${JOB_TREE[k]?.emoji} *${k}* — Lv.${JOB_TREE[k]?.reqLevel}`)
    .join('\n');

  return m.reply(
    `⚔️ *Job Status*\n\n` +
    `Job:   ${jobData?.emoji || '⚔️'} *${curJob}* ${getTierName(jobData?.tier)}\n` +
    `Level: *${player.level}*\n\n` +
    `"_${jobData?.description || '-'}_"\n\n` +
    (avail.length
      ? `✅ *Bisa advance ke:*\n${avail.map(j => `${j.emoji} *${j.id}*`).join('\n')}\n\nGunakan: *!job advance <job>*`
      : nextReq
      ? `🔒 *Job selanjutnya:*\n${nextReq}\n\nTerus level up!`
      : `🏆 Kamu sudah di *Tier Pinnacle*!`
    )
  );
};

handler.help    = ['job', 'job tree', 'job advance <job>'];
handler.tags    = ['rpg'];
handler.command = /^(job|class|advance)$/i;
handler.cooldown = 10;
export default handler;
