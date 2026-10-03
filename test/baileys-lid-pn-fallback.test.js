import assert from 'node:assert/strict';
import test from 'node:test';
import { proto } from '@whiskeysockets/baileys';
import { decryptMessageNode, hasDistinctNormalizedJids } from '../node_modules/@whiskeysockets/baileys/lib/Utils/decode-wa-message.js';
import { jidNormalizedUser } from '../node_modules/@whiskeysockets/baileys/lib/WABinary/index.js';

const OWN_PN = '15550000999@s.whatsapp.net';
const OWN_LID = '999999999@lid';
const SENDER_PN = '15550000001@s.whatsapp.net';
const SENDER_LID = '100000001@lid';
const GROUP_JID = '120363000000001@g.us';

function paddedMessage(conversation = 'synthetic message') {
  const message = Buffer.from(proto.Message.encode({ conversation }).finish());
  const paddingLength = 16 - (message.length % 16);
  return Buffer.concat([message, Buffer.alloc(paddingLength, paddingLength)]);
}

function makeStanza({
  from,
  participant,
  type = 'msg',
  tag = 'enc',
  attrs = {},
  content,
}) {
  return {
    attrs: { id: 'synthetic-message-id', from, participant, t: '1', ...attrs },
    content: [{
      tag,
      attrs: type ? { type } : {},
      content: content ?? Buffer.from('synthetic ciphertext'),
    }],
  };
}

function harness(stanza, decryptMessage, decryptGroupMessage = async () => {
  throw new Error('unexpected group decrypt');
}) {
  const calls = [];
  const logs = [];
  const logger = {
    trace(_details, message) { logs.push({ level: 'trace', message }); },
    debug(_details, message) { logs.push({ level: 'debug', message }); },
    info(_details, message) { logs.push({ level: 'info', message }); },
    warn(_details, message) { logs.push({ level: 'warn', message }); },
    error(details, message) {
      // Keep only the original error reference/message; never retain message keys or JIDs.
      logs.push({ level: 'error', message, error: details?.err });
    },
    fatal(_details, message) { logs.push({ level: 'fatal', message }); },
  };
  const repository = {
    async decryptMessage(options) {
      calls.push({ method: 'decryptMessage', jid: options.jid, type: options.type });
      return decryptMessage(options);
    },
    async decryptGroupMessage(options) {
      calls.push({ method: 'decryptGroupMessage', jid: options.authorJid });
      return decryptGroupMessage(options);
    },
  };
  const message = decryptMessageNode(stanza, OWN_PN, OWN_LID, repository, logger);
  return { calls, logs, message };
}

async function decryptWithPairedFallback({ stanza, primaryJid, alternateJid }) {
  const primaryError = new Error('synthetic primary decrypt failure');
  const { calls, logs, message } = harness(stanza, async ({ jid }) => {
    if (jid === primaryJid) throw primaryError;
    assert.equal(jid, alternateJid);
    return paddedMessage();
  });
  await message.decrypt();
  assert.deepEqual(calls.map(call => call.jid), [primaryJid, alternateJid]);
  assert.equal(message.fullMessage.message.conversation, 'synthetic message');
  assert.equal(logs.length, 0, 'successful alternate retry emits no identifier-bearing diagnostics');
  return { calls, logs, message };
}

test('retries a direct LID message with its same-stanza sender PN exactly once', async () => {
  await decryptWithPairedFallback({
    stanza: makeStanza({
      from: SENDER_LID,
      attrs: { sender_lid: SENDER_LID, sender_pn: SENDER_PN },
    }),
    primaryJid: SENDER_LID,
    alternateJid: SENDER_PN,
  });
});

test('retries a direct PN message with its same-stanza sender LID exactly once', async () => {
  const devicePn = '15550000001:7@s.whatsapp.net';
  await decryptWithPairedFallback({
    stanza: makeStanza({
      from: devicePn,
      type: 'pkmsg',
      attrs: { sender_lid: SENDER_LID, sender_pn: SENDER_PN },
    }),
    primaryJid: devicePn,
    alternateJid: SENDER_LID,
  });
});

test('retries a group participant LID using only participant PN/LID fields', async () => {
  await decryptWithPairedFallback({
    stanza: makeStanza({
      from: GROUP_JID,
      participant: SENDER_LID,
      attrs: {
        participant_lid: SENDER_LID,
        participant_pn: SENDER_PN,
        // Deliberately unrelated sender pair: group decrypt must use participant fields.
        sender_lid: '100000002@lid',
        sender_pn: '15550000002@s.whatsapp.net',
      },
    }),
    primaryJid: SENDER_LID,
    alternateJid: SENDER_PN,
  });
});

test('retries a group participant PN using its normalized participant LID pair', async () => {
  const devicePn = '15550000001:3@s.whatsapp.net';
  await decryptWithPairedFallback({
    stanza: makeStanza({
      from: GROUP_JID,
      participant: devicePn,
      type: 'pkmsg',
      attrs: { participant_lid: SENDER_LID, participant_pn: SENDER_PN },
    }),
    primaryJid: devicePn,
    alternateJid: SENDER_LID,
  });
});

test('does not retry when the stanza has no complete paired identity or it does not match the primary', async (t) => {
  for (const [name, from, attrs] of [
    ['missing pair', SENDER_LID, {}],
    ['incomplete pair', SENDER_LID, { sender_lid: SENDER_LID }],
    ['mismatched primary', '15550000003@s.whatsapp.net', { sender_lid: SENDER_LID, sender_pn: SENDER_PN }],
  ]) {
    await t.test(name, async () => {
      const firstError = new Error('synthetic primary decrypt failure');
      const { calls, logs, message } = harness(
        makeStanza({ from, attrs }),
        async () => { throw firstError; },
      );
      await message.decrypt();
      assert.equal(calls.length, 1);
      assert.equal(message.fullMessage.messageStubParameters[0], firstError.message);
      assert.equal(logs.at(-1)?.error, firstError);
      assert.equal(logs.some(entry => entry.level === 'debug'), false);
    });
  }
});

test('does not retry when the alternate JID normalizes to the primary address', async () => {
  const primary = '15550000001:7@s.whatsapp.net';
  const primaryPair = '15550000001@s.whatsapp.net';
  const alternate = '15550000001:3@s.whatsapp.net';
  assert.equal(jidNormalizedUser(primary), jidNormalizedUser(alternate));
  assert.equal(hasDistinctNormalizedJids(primary, alternate), false);

  const firstError = new Error('synthetic primary decrypt failure');
  const { calls, logs, message } = harness(
    makeStanza({
      from: primary,
      attrs: { sender_pn: primaryPair, sender_lid: alternate },
    }),
    async () => { throw firstError; },
  );
  await message.decrypt();
  assert.equal(calls.length, 1);
  assert.equal(message.fullMessage.messageStubParameters[0], firstError.message);
  assert.equal(JSON.stringify(logs).includes(primary), false);
  assert.equal(JSON.stringify(logs).includes(alternate), false);
});

test('does not try an alternate identity when the primary decrypt succeeds', async () => {
  const { calls, logs, message } = harness(
    makeStanza({
      from: SENDER_PN,
      attrs: { sender_lid: SENDER_LID, sender_pn: SENDER_PN },
    }),
    async () => paddedMessage('primary succeeded'),
  );
  await message.decrypt();
  assert.equal(calls.length, 1);
  assert.equal(message.fullMessage.message.conversation, 'primary succeeded');
  assert.equal(logs.length, 0);
});

test('does not retry other encryption types or plaintext nodes', async (t) => {
  await t.test('group sender-key message uses only group decryption', async () => {
    const originalError = new Error('synthetic group decrypt failure');
    const { calls, message } = harness(
      makeStanza({
        from: GROUP_JID,
        participant: SENDER_LID,
        type: 'skmsg',
        attrs: { participant_lid: SENDER_LID, participant_pn: SENDER_PN },
      }),
      async () => { throw new Error('decryptMessage must not be called'); },
      async () => { throw originalError; },
    );
    await message.decrypt();
    assert.deepEqual(calls.map(call => call.method), ['decryptGroupMessage']);
    assert.equal(message.fullMessage.messageStubParameters[0], originalError.message);
  });

  await t.test('plaintext is decoded without Signal retry', async () => {
    const plaintext = Buffer.from(proto.Message.encode({ conversation: 'synthetic plaintext' }).finish());
    const { calls, logs, message } = harness(
      makeStanza({ from: SENDER_LID, tag: 'plaintext', type: undefined, attrs: { sender_lid: SENDER_LID, sender_pn: SENDER_PN }, content: plaintext }),
      async () => { throw new Error('decryptMessage must not be called'); },
    );
    await message.decrypt();
    assert.equal(calls.length, 0);
    assert.equal(message.fullMessage.message.conversation, 'synthetic plaintext');
    assert.equal(logs.length, 0);
  });

  await t.test('a post-decrypt decode error does not trigger a second decrypt', async () => {
    const { calls, message } = harness(
      makeStanza({
        from: SENDER_LID,
        attrs: { sender_lid: SENDER_LID, sender_pn: SENDER_PN },
      }),
      async () => Buffer.alloc(0),
    );
    await message.decrypt();
    assert.equal(calls.length, 1);
    assert.match(message.fullMessage.messageStubParameters[0], /empty bytes/i);
  });
});

test('when the alternate decrypt also fails, preserves the exact first error', async () => {
  const firstError = new Error('original Bad MAC');
  const alternateError = new Error('alternate has no session');
  let attempts = 0;
  const { calls, logs, message } = harness(
    makeStanza({
      from: SENDER_LID,
      attrs: { sender_lid: SENDER_LID, sender_pn: SENDER_PN },
    }),
    async () => {
      attempts += 1;
      throw attempts === 1 ? firstError : alternateError;
    },
  );
  await message.decrypt();
  assert.deepEqual(calls.map(call => call.jid), [SENDER_LID, SENDER_PN]);
  assert.equal(message.fullMessage.messageStubParameters[0], firstError.message);
  assert.equal(logs.at(-1)?.error, firstError);
  assert.notEqual(logs.at(-1)?.error, alternateError);
  assert.equal(logs.some(entry => entry.level === 'debug'), false);
});
