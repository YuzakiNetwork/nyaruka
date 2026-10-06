import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { after, test } from 'node:test';
import {
  DownloadError,
  downloadDirectVideo,
  isPublicAddress,
  validateDownloadUrl,
} from '../lib/media/direct-video-downloader.js';
import { createBoundedQueue } from '../lib/utils/bounded-queue.js';
import { createDownloadHandler } from '../commands/info/download.js';

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nyaruka-video-test-'));
const allowedHosts = ['media.example.com'];
const PUBLIC_IPV4 = { address: '93.184.216.34', family: 4 };
const mp4Body = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00]);

after(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

function response({ statusCode = 200, headers = {}, body = mp4Body } = {}) {
  return {
    statusCode,
    headers,
    body: body instanceof Readable ? body : Readable.from([body]),
  };
}

function resolver(records = [PUBLIC_IPV4]) {
  return async () => records;
}

function fixtureRequest(result, onRequest = () => {}) {
  return async (url, options) => {
    onRequest(url, options);
    return typeof result === 'function' ? result(url, options) : result;
  };
}

function makeMessage() {
  const replies = [];
  return {
    replies,
    value: {
      chat: 'chat-id-not-to-be-logged',
      sender: 'sender-id-not-to-be-logged',
      raw: { key: { id: 'synthetic-message' } },
      reply: async text => { replies.push(text); },
    },
  };
}

test('downloads a synthetic direct MP4 and pins the request to its validated public DNS address', async () => {
  let pinnedAddress;
  const downloaded = await downloadDirectVideo('https://media.example.com/video.mp4', {
    allowedHosts,
    lookup: resolver(),
    requestImpl: fixtureRequest(response({ headers: { 'content-type': 'video/mp4', 'content-length': String(mp4Body.length) } }), (_url, options) => {
      pinnedAddress = options.address;
    }),
    tempRoot: testRoot,
  });
  try {
    assert.equal(downloaded.fileName, 'video.mp4');
    assert.equal(downloaded.mimeType, 'video/mp4');
    assert.equal(downloaded.size, mp4Body.length);
    assert.deepEqual(fs.readFileSync(downloaded.filePath), mp4Body);
    assert.equal(fs.statSync(path.dirname(downloaded.filePath)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(downloaded.filePath).mode & 0o777, 0o600);
    assert.deepEqual(pinnedAddress, PUBLIC_IPV4);
  } finally {
    const downloadedPath = downloaded.filePath;
    await downloaded.cleanup();
    assert.equal(fs.existsSync(downloadedPath), false);
  }
});

test('social platform URLs are rejected before DNS or network access', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=synthetic',
    'https://vm.tiktok.com/synthetic',
    'https://x.com/user/status/123',
    'https://www.instagram.com/reel/synthetic/',
  ]) {
    assert.throws(() => validateDownloadUrl(url, { allowedHosts }), error => error.code === 'unsupported_platform');
  }
});

test('only allowlisted HTTPS hostnames and default port are accepted', () => {
  assert.equal(validateDownloadUrl('https://media.example.com/a.mp4', { allowedHosts }).hostname, 'media.example.com');
  assert.throws(() => validateDownloadUrl('https://media.example.com/a.mp4', { allowedHosts: [] }), error => error.code === 'unsupported_host');
  for (const url of [
    'http://media.example.com/a.mp4',
    'file:///etc/passwd',
    'https://user:pass@media.example.com/a.mp4',
    'https://media.example.com:8443/a.mp4',
  ]) {
    assert.throws(() => validateDownloadUrl(url, { allowedHosts }), DownloadError);
  }
  assert.throws(() => validateDownloadUrl('https://not-allowed.example.net/a.mp4', { allowedHosts }), error => error.code === 'unsupported_host');
});

test('rejects loopback, private, link-local, reserved IPv4/IPv6 and mapped private addresses', () => {
  for (const address of [
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.10.20',
    '172.16.0.1', '192.168.1.1', '198.18.0.1', '192.0.2.1', '224.0.0.1', '240.0.0.1',
    '::', '::1', 'fc00::1', 'fe80::1', 'ff02::1', '2001:db8::1', '2002::1', '::ffff:127.0.0.1',
  ]) assert.equal(isPublicAddress(address), false, `${address} should be rejected`);
  for (const address of ['93.184.216.34', '2001:4860:4860::8888']) {
    assert.equal(isPublicAddress(address), true, `${address} should be accepted as public`);
  }
  assert.throws(() => validateDownloadUrl('https://127.0.0.1/file.mp4', { allowedHosts }), error => error.code === 'private_address');
  assert.throws(() => validateDownloadUrl('https://[::1]/file.mp4', { allowedHosts }), error => error.code === 'private_address');
});

test('rejects a DNS answer set containing a private address to prevent rebinding', async () => {
  let requested = false;
  await assert.rejects(downloadDirectVideo('https://media.example.com/video.mp4', {
    allowedHosts,
    lookup: resolver([PUBLIC_IPV4, { address: '127.0.0.1', family: 4 }]),
    requestImpl: fixtureRequest(response({ headers: { 'content-type': 'video/mp4' } }), () => { requested = true; }),
    tempRoot: testRoot,
  }), error => error.code === 'private_address');
  assert.equal(requested, false);
});

test('validates every redirect and rejects a hop to an internal IP before requesting it', async () => {
  let requests = 0;
  await assert.rejects(downloadDirectVideo('https://media.example.com/redirect', {
    allowedHosts,
    lookup: resolver(),
    requestImpl: fixtureRequest(response({ statusCode: 302, headers: { location: 'https://127.0.0.1/internal.mp4' }, body: Buffer.alloc(0) }), () => { requests += 1; }),
    tempRoot: testRoot,
  }), error => error.code === 'private_address');
  assert.equal(requests, 1);
});

test('rejects a redirect to a host outside the allowlist', async () => {
  let requests = 0;
  await assert.rejects(downloadDirectVideo('https://media.example.com/redirect', {
    allowedHosts,
    lookup: resolver(),
    requestImpl: fixtureRequest(response({ statusCode: 307, headers: { location: 'https://outside.example.net/video.mp4' }, body: Buffer.alloc(0) }), () => { requests += 1; }),
    tempRoot: testRoot,
  }), error => error.code === 'unsupported_host');
  assert.equal(requests, 1);
});

test('rejects declared and streamed bodies larger than the configured size limit and removes partial files', async () => {
  await assert.rejects(downloadDirectVideo('https://media.example.com/video.mp4', {
    allowedHosts,
    maxBytes: 15,
    lookup: resolver(),
    requestImpl: fixtureRequest(response({ headers: { 'content-type': 'video/mp4', 'content-length': '16' } })),
    tempRoot: testRoot,
  }), error => error.code === 'too_large');

  await assert.rejects(downloadDirectVideo('https://media.example.com/video.mp4', {
    allowedHosts,
    maxBytes: 15,
    lookup: resolver(),
    requestImpl: fixtureRequest(response({ headers: { 'content-type': 'video/mp4' } })),
    tempRoot: testRoot,
  }), error => error.code === 'too_large');
  assert.deepEqual(fs.readdirSync(testRoot), []);
});

test('rejects non-video MIME and content without an MP4 signature', async () => {
  await assert.rejects(downloadDirectVideo('https://media.example.com/file', {
    allowedHosts,
    lookup: resolver(),
    requestImpl: fixtureRequest(response({ headers: { 'content-type': 'text/html' } })),
    tempRoot: testRoot,
  }), error => error.code === 'wrong_mime');

  await assert.rejects(downloadDirectVideo('https://media.example.com/file', {
    allowedHosts,
    lookup: resolver(),
    requestImpl: fixtureRequest(response({ headers: { 'content-type': 'video/mp4' }, body: Buffer.from('not a video file') })),
    tempRoot: testRoot,
  }), error => error.code === 'wrong_mime');
  assert.deepEqual(fs.readdirSync(testRoot), []);
});

test('aborts a stalled request after the bounded wall-clock timeout', async () => {
  await assert.rejects(downloadDirectVideo('https://media.example.com/hang', {
    allowedHosts,
    timeoutMs: 10,
    lookup: resolver(),
    requestImpl: (_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('synthetic abort')), { once: true });
    }),
    tempRoot: testRoot,
  }), error => error.code === 'timeout');
});

test('command returns promptly, uses official-link copy for social URLs, and avoids downloader calls', async () => {
  const queue = createBoundedQueue({ concurrency: 1, maxQueued: 1 });
  let calls = 0;
  const command = createDownloadHandler({
    queue,
    allowedHosts,
    downloader: async () => { calls += 1; throw new Error('should not be called'); },
  });
  const { value: message, replies } = makeMessage();
  await command(message, { sock: { sendMessage: async () => {} }, args: ['https://youtu.be/synthetic'], prefix: '!' });
  assert.match(replies[0], /belum bisa diunduh/);
  assert.match(replies[0], /opsi resmi/);
  assert.equal(calls, 0);
});

test('command distinguishes an empty default-deny allowlist from an unsupported hostname', async () => {
  let calls = 0;
  const downloader = async () => { calls += 1; };
  const emptyCommand = createDownloadHandler({
    queue: createBoundedQueue(),
    allowedHosts: [],
    downloader,
  });
  const { value: disabledMessage, replies: disabledReplies } = makeMessage();
  await emptyCommand(disabledMessage, { sock: { sendMessage: async () => {} }, args: ['https://media.example.com/video.mp4'], prefix: '!' });
  assert.equal(disabledReplies[0], '⚠️ Fitur download belum diaktifkan. Minta admin mengonfigurasi domain file tepercaya.');

  const restrictedCommand = createDownloadHandler({
    queue: createBoundedQueue(),
    allowedHosts: ['trusted.example.net'],
    downloader,
  });
  const { value: restrictedMessage, replies: restrictedReplies } = makeMessage();
  await restrictedCommand(restrictedMessage, { sock: { sendMessage: async () => {} }, args: ['https://media.example.com/video.mp4'], prefix: '!' });
  assert.equal(restrictedReplies[0], '⚠️ Domain ini belum didukung. Gunakan tautan HTTPS langsung dari domain yang diizinkan.');
  assert.equal(calls, 0);
});

test('command sends a video and cleans its temporary file after successful send', async () => {
  const queue = createBoundedQueue({ concurrency: 1, maxQueued: 1 });
  const { value: message, replies } = makeMessage();
  const tempFile = path.join(testRoot, 'synthetic-video.mp4');
  fs.writeFileSync(tempFile, mp4Body);
  let cleaned = false;
  let sent;
  const command = createDownloadHandler({
    queue,
    allowedHosts,
    downloader: async () => ({
      filePath: tempFile,
      fileName: 'video.mp4',
      mimeType: 'video/mp4',
      cleanup: async () => { cleaned = true; fs.rmSync(tempFile, { force: true }); },
    }),
  });
  await command(message, {
    sock: { sendMessage: async (_chat, content) => { sent = content; } },
    args: ['https://media.example.com/video.mp4'],
    prefix: '!',
  });
  assert.deepEqual(replies, ['⏬ Link diterima. Sedang menyiapkan file…']);
  await queue.whenIdle();
  assert.equal(sent.video.url, tempFile);
  assert.equal(sent.mimetype, 'video/mp4');
  assert.match(sent.caption, /✅ Siap! video\.mp4/);
  assert.equal(cleaned, true);
  assert.equal(fs.existsSync(tempFile), false);
});

test('command cleans its temporary file after WhatsApp send fails', async () => {
  const queue = createBoundedQueue({ concurrency: 1, maxQueued: 1 });
  const { value: message, replies } = makeMessage();
  const tempFile = path.join(testRoot, 'failed-send.mp4');
  fs.writeFileSync(tempFile, mp4Body);
  let cleaned = false;
  const command = createDownloadHandler({
    queue,
    allowedHosts,
    downloader: async () => ({
      filePath: tempFile,
      fileName: 'video.mp4',
      mimeType: 'video/mp4',
      cleanup: async () => { cleaned = true; fs.rmSync(tempFile, { force: true }); },
    }),
  });
  await command(message, {
    sock: { sendMessage: async () => { throw new Error('synthetic send error'); } },
    args: ['https://media.example.com/video.mp4'],
    prefix: '!',
  });
  await queue.whenIdle();
  assert.equal(cleaned, true);
  assert.equal(fs.existsSync(tempFile), false);
  assert.match(replies.at(-1), /tidak bisa dikirim/);
});

test('a stalled acknowledgment never blocks the message handler and releases its queue slot', async () => {
  const queue = createBoundedQueue({ concurrency: 1, maxQueued: 0 });
  let downloads = 0;
  const command = createDownloadHandler({
    queue,
    allowedHosts,
    replyTimeoutMs: 5,
    downloader: async () => { downloads += 1; },
  });
  const message = {
    chat: 'synthetic-chat',
    reply: () => new Promise(() => {}),
  };
  const started = Date.now();
  const result = command(message, { sock: { sendMessage: async () => {} }, args: ['https://media.example.com/video.mp4'], prefix: '!' });
  assert.equal(result, undefined);
  assert.ok(Date.now() - started < 50, 'command handler should return without awaiting WhatsApp reply');
  await queue.whenIdle();
  assert.equal(downloads, 0);
  assert.equal(queue.active, 0);
});

test('a stalled video send times out and cleans its temporary file', async () => {
  const queue = createBoundedQueue({ concurrency: 1, maxQueued: 0 });
  const { value: message, replies } = makeMessage();
  const tempFile = path.join(testRoot, 'stalled-send.mp4');
  fs.writeFileSync(tempFile, mp4Body);
  let cleaned = false;
  const command = createDownloadHandler({
    queue,
    allowedHosts,
    replyTimeoutMs: 10,
    mediaSendTimeoutMs: 5,
    downloader: async () => ({
      filePath: tempFile,
      fileName: 'video.mp4',
      mimeType: 'video/mp4',
      cleanup: async () => { cleaned = true; fs.rmSync(tempFile, { force: true }); },
    }),
  });
  command(message, {
    sock: { sendMessage: () => new Promise(() => {}) },
    args: ['https://media.example.com/video.mp4'],
    prefix: '!',
  });
  await queue.whenIdle();
  assert.equal(cleaned, true);
  assert.equal(fs.existsSync(tempFile), false);
  assert.match(replies.at(-1), /tidak bisa dikirim/);
  assert.equal(queue.active, 0);
});

test('cleanup failures emit a static warning without request metadata', async () => {
  const queue = createBoundedQueue({ concurrency: 1, maxQueued: 0 });
  const { value: message } = makeMessage();
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const command = createDownloadHandler({
      queue,
      allowedHosts,
      downloader: async () => ({
        filePath: '/tmp/private-media-path.mp4',
        fileName: 'video.mp4',
        mimeType: 'video/mp4',
        cleanup: async () => { throw new Error('signed-url-fixture sender-fixture /tmp/private-media-path.mp4'); },
      }),
    });
    command(message, {
      sock: { sendMessage: async () => {} },
      args: ['https://media.example.com/private-signed-token'],
      prefix: '!',
    });
    await queue.whenIdle();
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(warnings, ['[download] Temporary media cleanup failed']);
  assert.doesNotMatch(warnings.join(' '), /signed-url-fixture|sender-fixture|private-media-path/);
});

test('bounded queue rejects work beyond the active-plus-pending capacity', async () => {
  const queue = createBoundedQueue({ concurrency: 1, maxQueued: 1 });
  let release;
  const blocker = new Promise(resolve => { release = resolve; });
  assert.equal(queue.add(() => blocker), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(queue.add(() => blocker), true);
  assert.equal(queue.add(() => blocker), false);
  release();
  await queue.whenIdle();
});
