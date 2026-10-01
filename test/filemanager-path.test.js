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

async function removeFileReply(inputPath) {
  let reply;
  await handler(
    { reply: message => { reply = message; return message; } },
    { args: [inputPath], command: 'removefile', sock: {} }
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

test('refuses to remove an internal symlink and preserves its target', async () => {
  const testDirectory = fs.mkdtempSync(path.join(BOT_ROOT, '.filemanager-remove-test-'));
  try {
    const targetDirectory = path.join(testDirectory, 'target');
    fs.mkdirSync(targetDirectory);
    fs.writeFileSync(path.join(targetDirectory, 'keep.txt'), 'still here');
    fs.symlinkSync(targetDirectory, path.join(testDirectory, 'target-link'), 'dir');

    const reply = await removeFileReply(path.relative(BOT_ROOT, path.join(testDirectory, 'target-link')));
    assert.match(reply, /symlink tidak dapat dihapus/);
    assert.equal(fs.readFileSync(path.join(targetDirectory, 'keep.txt'), 'utf8'), 'still here');
    assert.equal(fs.lstatSync(path.join(testDirectory, 'target-link')).isSymbolicLink(), true);

    const nestedReply = await removeFileReply(path.relative(BOT_ROOT, path.join(testDirectory, 'target-link', 'keep.txt')));
    assert.match(nestedReply, /symlink tidak dapat dihapus/);
    assert.equal(fs.readFileSync(path.join(targetDirectory, 'keep.txt'), 'utf8'), 'still here');
  } finally {
    fs.rmSync(testDirectory, { recursive: true, force: true });
  }
});

test('rejects bot-root deletion aliases without calling rmSync', async () => {
  const canonicalRoot = fs.realpathSync(BOT_ROOT);
  const aliases = [
    '.',
    canonicalRoot,
    `${canonicalRoot}/commands/owner/../..`
  ];
  const originalRmSync = fs.rmSync;
  const rmCalls = [];
  try {
    fs.rmSync = (...args) => { rmCalls.push(args); };
    for (const alias of aliases) {
      const reply = await removeFileReply(alias);
      assert.match(reply, /tidak dapat menghapus direktori bot/);
    }
    assert.equal(rmCalls.length, 0);
  } finally {
    fs.rmSync = originalRmSync;
  }
});

test('still removes an ordinary in-root file', async () => {
  const testDirectory = fs.mkdtempSync(path.join(BOT_ROOT, '.filemanager-remove-file-test-'));
  const filePath = path.join(testDirectory, 'ordinary.txt');
  try {
    fs.writeFileSync(filePath, 'ordinary in-root file');
    const reply = await removeFileReply(path.relative(BOT_ROOT, filePath));
    assert.match(reply, /Berhasil dihapus/);
    assert.equal(fs.existsSync(filePath), false);
  } finally {
    fs.rmSync(testDirectory, { recursive: true, force: true });
  }
});
