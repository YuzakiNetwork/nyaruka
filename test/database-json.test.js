import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nyaruka-json-db-'));
const dbDirectory = path.join(testRoot, 'collections');
process.env.DB_PATH = dbDirectory;

const { default: jsonDb } = await import('../lib/database/json.js');

after(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

test('writes collection JSON and returns success', () => {
  assert.equal(jsonDb.writeCollection('atomic-new', { value: 'first' }), true);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(dbDirectory, 'atomic-new.json'), 'utf-8')),
    { value: 'first' },
  );
});

test('backs up the existing JSON file before replacing it', () => {
  const filepath = path.join(dbDirectory, 'atomic-backup.json');
  jsonDb.writeCollection('atomic-backup', { version: 1 });
  const previousContents = fs.readFileSync(filepath, 'utf-8');

  assert.equal(jsonDb.writeCollection('atomic-backup', { version: 2 }), true);
  assert.equal(fs.readFileSync(`${filepath}.bak`, 'utf-8'), previousContents);
  assert.deepEqual(JSON.parse(fs.readFileSync(filepath, 'utf-8')), { version: 2 });
});

test('propagates replacement failure without clobbering the original or cache', async () => {
  const collection = 'atomic-failure';
  const filepath = path.join(dbDirectory, `${collection}.json`);
  await jsonDb.setRecord(collection, 'entry', { version: 1 });
  const previousContents = fs.readFileSync(filepath, 'utf-8');
  const originalRenameSync = fs.renameSync;
  let injectedFailure = false;

  fs.renameSync = function (source, destination) {
    if (destination === filepath && !injectedFailure) {
      injectedFailure = true;
      const error = new Error('simulated replacement failure');
      error.code = 'EIO';
      throw error;
    }
    return originalRenameSync.call(fs, source, destination);
  };

  try {
    await assert.rejects(
      jsonDb.setRecord(collection, 'entry', { version: 2 }),
      /simulated replacement failure/,
    );
  } finally {
    fs.renameSync = originalRenameSync;
  }

  assert.equal(injectedFailure, true);
  assert.equal(fs.readFileSync(filepath, 'utf-8'), previousContents);
  assert.equal(fs.readFileSync(`${filepath}.bak`, 'utf-8'), previousContents);
  assert.deepEqual(jsonDb.readCollection(collection), { entry: { version: 1 } });
  assert.deepEqual(fs.readdirSync(dbDirectory).filter((name) => name.endsWith('.tmp')), []);
});
