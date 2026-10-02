import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import helpHandler from '../commands/info/help.js';
import { loadCommands, getCommands } from '../handler/index.js';
import { config } from '../config.js';

before(async () => {
  await loadCommands();
});

async function getHelpReply(args = [], isOwner = false) {
  let reply;
  await helpHandler(
    { reply: text => { reply = text; return text; } },
    { args, isOwner }
  );
  return reply;
}

test('default help shows only the approved onboarding steps and category filters', async () => {
  const p = config.bot.prefix;
  assert.equal(await getHelpReply(),
    `✨ *Nyaruka • Mulai dari sini* ✨\n` +
    `Baru bergabung? Ikuti langkah ini:\n\n` +
    `1. Buat karakter: *${p}register <name> <class>*\n` +
    `2. Ambil hadiah harian: *${p}daily*\n` +
    `3. Mulai menjelajah: *${p}adventure* atau *${p}battle*\n\n` +
    `Cari perintah lain?\n` +
    `Game: *${p}help game* • Ekonomi: *${p}help economy* • Sosial: *${p}help social* • Info: *${p}help info*\n` +
    `Detail command: *${p}help <command>*`
  );
});

test('game alias and all category filters return their complete localized command lists', async () => {
  const p = config.bot.prefix;
  const game = await getHelpReply(['game']);
  assert.equal(await getHelpReply(['rpg']), game);
  assert.match(game, /\*Game Commands\*/);
  assert.doesNotMatch(game, /\*RPG(?: Commands)?\*/);

  for (const [filter, tag, label] of [
    ['economy', 'economy', 'Ekonomi'],
    ['social', 'social', 'Sosial'],
    ['info', 'info', 'Info'],
  ]) {
    const output = await getHelpReply([filter]);
    assert.match(output, new RegExp(`\\*${label} Commands\\*`));
    const usages = getCommands()
      .filter(({ handler }) => handler.tags?.[0] === tag && !handler.ownerOnly)
      .flatMap(({ handler }) => handler.help || []);
    assert.ok(usages.length > 0, `expected ${tag} commands to be registered`);
    for (const usage of usages) assert.ok(output.includes(`${p}${usage}`), `${filter} omitted ${usage}`);
  }

  const gameUsages = getCommands()
    .filter(({ handler }) => handler.tags?.[0] === 'rpg' && !handler.ownerOnly)
    .flatMap(({ handler }) => handler.help || []);
  for (const usage of gameUsages) assert.ok(game.includes(`${p}${usage}`), `game omitted ${usage}`);
});

test('command-detail lookup still includes its usage variants and cooldown', async () => {
  const p = config.bot.prefix;
  const reply = await getHelpReply(['battle']);
  assert.match(reply, new RegExp(`Command: ${p}battle`));
  assert.match(reply, /Cooldown:/);
  assert.match(reply, /Usage:/);
  assert.ok(reply.includes(`${p}battle [skill]`));
});
