import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import handler from '../commands/owner/filemanager.js';

const BOT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function getFileReply(inputPath) {
  let reply;
  await handler(
    { reply: message => { reply = message; return message; } },
    { args: [inputPath], command: 'getfile', sock: {} }
  );
  return reply;
}

async function listFilesReply(inputPath) {
  let reply;
  await handler(
    { reply: message => { reply = message; return message; } },
    { args: [inputPath], command: 'listfiles', sock: {} }
  );
  return reply;
}

test('rejects parent-directory traversal', async () => {
  assert.match(await getFileReply('../package.json'), /Akses ditolak/);
});

test('rejects absolute paths outside the bot root', async () => {
  assert.match(await getFileReply('/etc/passwd'), /Akses ditolak/);
});

test('rejects URL-encoded traversal', async () => {
  assert.match(await getFileReply('%2e%2e/package.json'), /Akses ditolak/);
});

test('rejects sibling paths that share the bot-root string prefix', async () => {
  const siblingPath = path.join(path.dirname(BOT_ROOT), `${path.basename(BOT_ROOT)}-sibling`, 'secret.txt');
  assert.match(await getFileReply(siblingPath), /Akses ditolak/);
});

test('rejects a symlink that resolves outside the bot root', async () => {
  const linkDirectory = fs.mkdtempSync(path.join(BOT_ROOT, '.filemanager-path-test-'));
  const outsideDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nyaruka-filemanager-outside-'));
  try {
    fs.writeFileSync(path.join(outsideDirectory, 'marker.txt'), 'must not be read');
    fs.symlinkSync(outsideDirectory, path.join(linkDirectory, 'outside'), 'dir');
    const relativePath = path.relative(BOT_ROOT, path.join(linkDirectory, 'outside', 'marker.txt'));
    const reply = await getFileReply(relativePath);
    assert.match(reply, /Akses ditolak/);
    assert.doesNotMatch(reply, /must not be read/);
  } finally {
    fs.rmSync(linkDirectory, { recursive: true, force: true });
    fs.rmSync(outsideDirectory, { recursive: true, force: true });
  }
});

test('does not disclose external target size when listing a symlink', async () => {
  const listingDirectory = fs.mkdtempSync(path.join(BOT_ROOT, '.filemanager-list-test-'));
  const outsideDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nyaruka-filemanager-list-outside-'));
  try {
    const targetPath = path.join(outsideDirectory, 'large-target.bin');
    fs.writeFileSync(targetPath, 'x'.repeat(4096));
    fs.symlinkSync(targetPath, path.join(listingDirectory, 'external-link'));

    const reply = await listFilesReply(path.relative(BOT_ROOT, listingDirectory));
    assert.match(reply, /external-link/);
    assert.doesNotMatch(reply, /4\.0 KB/);
  } finally {
    fs.rmSync(listingDirectory, { recursive: true, force: true });
    fs.rmSync(outsideDirectory, { recursive: true, force: true });
  }
});
