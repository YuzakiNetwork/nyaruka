import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { loadCommands, routeMessage } from '../handler/index.js';

before(async () => {
  await loadCommands();
});

test('download command log omits the raw URL, sender, and chat identifiers', async () => {
  const originalLog = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.join(' '));
  try {
    const url = 'https://www.instagram.com/reel/private-token-fixture/';
    await routeMessage({
      sendMessage: async () => {},
    }, {
      body: `!download ${url}`,
      sender: '6281234567890@s.whatsapp.net',
      chat: '120363012345678901@g.us',
      isGroup: true,
      raw: { key: { id: 'synthetic-message' } },
      reply: async () => {},
    });
  } finally {
    console.log = originalLog;
  }
  const output = logs.join('\n');
  assert.doesNotMatch(output, /instagram\.com|private-token-fixture|6281234567890|120363012345678901/);
});
