import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyBaileysPatch, transformDecoderSource } from '../scripts/apply-baileys-pn-lid-patch.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const installedDecoderPath = join(
  projectRoot,
  'node_modules',
  '@whiskeysockets',
  'baileys',
  'lib',
  'Utils',
  'decode-wa-message.js',
);

test('recognizes the exact patched decoder and is idempotent', () => {
  const before = readFileSync(installedDecoderPath, 'utf8');
  const transformed = transformDecoderSource(before);
  assert.equal(transformed.changed, false);
  assert.equal(transformed.source, before);
  assert.equal(applyBaileysPatch(projectRoot), false);
  assert.equal(readFileSync(installedDecoderPath, 'utf8'), before);
});

test('refuses to patch a different Baileys version without changing files', () => {
  const root = mkdtempSync(join(tmpdir(), 'nyaruka-baileys-version-'));
  const packageRoot = join(root, 'node_modules', '@whiskeysockets', 'baileys');
  const packageJson = join(packageRoot, 'package.json');
  const decoder = join(packageRoot, 'lib', 'Utils', 'decode-wa-message.js');
  mkdirSync(dirname(decoder), { recursive: true });
  writeFileSync(packageJson, JSON.stringify({ version: '6.7.23' }));
  writeFileSync(decoder, 'synthetic source that must remain untouched');
  try {
    assert.throws(() => applyBaileysPatch(root), /Expected @whiskeysockets\/baileys 6\.7\.22/);
    assert.equal(readFileSync(decoder, 'utf8'), 'synthetic source that must remain untouched');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses an unexpected source fingerprint and leaves it unchanged', () => {
  const root = mkdtempSync(join(tmpdir(), 'nyaruka-baileys-source-'));
  const packageRoot = join(root, 'node_modules', '@whiskeysockets', 'baileys');
  const packageJson = join(packageRoot, 'package.json');
  const decoder = join(packageRoot, 'lib', 'Utils', 'decode-wa-message.js');
  const source = 'synthetic upstream source that is not the pinned decoder';
  mkdirSync(dirname(decoder), { recursive: true });
  writeFileSync(packageJson, JSON.stringify({ version: '6.7.22' }));
  writeFileSync(decoder, source);
  try {
    assert.throws(() => applyBaileysPatch(root), /Unexpected Baileys decoder fingerprint/);
    assert.equal(readFileSync(decoder, 'utf8'), source);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
