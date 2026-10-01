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

async function assertBackupFailurePreservesState(collection, sourceMode, method) {
  const filepath = path.join(dbDirectory, `${collection}.json`);
  const backupPath = `${filepath}.bak`;
  await jsonDb.setRecord(collection, 'entry', { version: 1 });
  fs.chmodSync(filepath, sourceMode);
  const previousContents = fs.readFileSync(filepath, 'utf-8');
  const originalMethod = fs[method];
  const failure = new Error(`simulated backup ${method} failure`);
  failure.code = 'EIO';
  let injectedFailure = false;

  fs[method] = function (source, destination) {
    const isBackupOperation = method === 'copyFileSync'
      ? destination.startsWith(`${filepath}.bak.`) && destination.endsWith('.tmp')
      : destination === backupPath;
    if (!injectedFailure && isBackupOperation) {
      injectedFailure = true;
      throw failure;
    }
    return originalMethod.call(fs, source, destination);
  };

  try {
    await assert.rejects(
      jsonDb.setRecord(collection, 'entry', { version: 2 }),
      (error) => error === failure,
    );
  } finally {
    fs[method] = originalMethod;
  }

  assert.equal(injectedFailure, true);
  assert.equal(fs.readFileSync(filepath, 'utf-8'), previousContents);
  assert.equal(fs.statSync(filepath).mode & 0o777, sourceMode);
  assert.equal(fs.existsSync(backupPath), false);
  assert.deepEqual(jsonDb.getRecord(collection, 'entry'), { version: 1 });
  assert.deepEqual(
    fs.readdirSync(dbDirectory).filter((name) => name.startsWith(`${collection}.json.`) && name.endsWith('.tmp')),
    [],
  );
}

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

test('preserves existing permissions and creates new files as owner-only', () => {
  const existingCollection = 'atomic-mode-existing';
  const existingPath = path.join(dbDirectory, `${existingCollection}.json`);
  const previousUmask = process.umask(0o022);
  try {
    fs.writeFileSync(existingPath, JSON.stringify({ version: 1 }), { mode: 0o600 });
    fs.chmodSync(existingPath, 0o600);
    jsonDb.writeCollection(existingCollection, { version: 2 });
    assert.equal(fs.statSync(existingPath).mode & 0o777, 0o600);
  } finally {
    process.umask(previousUmask);
  }

  const newCollection = 'atomic-mode-new';
  const newPath = path.join(dbDirectory, `${newCollection}.json`);
  const permissiveUmask = process.umask(0o000);
  try {
    jsonDb.writeCollection(newCollection, { version: 1 });
    assert.equal(fs.statSync(newPath).mode & 0o777, 0o600);
  } finally {
    process.umask(permissiveUmask);
  }
});

test('backup permissions are no broader than 0600 and 0640 source files', async () => {
  const previousUmask = process.umask(0o000);
  try {
    for (const sourceMode of [0o600, 0o640]) {
      const collection = `atomic-backup-mode-${sourceMode.toString(8)}`;
      const filepath = path.join(dbDirectory, `${collection}.json`);
      await jsonDb.setRecord(collection, 'entry', { version: 1 });
      fs.chmodSync(filepath, sourceMode);
      const previousContents = fs.readFileSync(filepath, 'utf-8');

      await jsonDb.setRecord(collection, 'entry', { version: 2 });

      const backupPath = `${filepath}.bak`;
      const backupMode = fs.statSync(backupPath).mode & 0o777;
      assert.equal(fs.readFileSync(backupPath, 'utf-8'), previousContents);
      assert.equal(backupMode & ~sourceMode, 0);
      assert.equal(fs.statSync(filepath).mode & 0o777, sourceMode);
    }
  } finally {
    process.umask(previousUmask);
  }
});

test('backup-copy failure preserves the original, cache, and temp-file cleanup', async () => {
  await assertBackupFailurePreservesState('atomic-backup-copy-failure', 0o600, 'copyFileSync');
});

test('backup-rename failure preserves the original, cache, and temp-file cleanup', async () => {
  await assertBackupFailurePreservesState('atomic-backup-rename-failure', 0o640, 'renameSync');
});

test('isolates nested values at read and write boundaries', () => {
  const collection = 'atomic-copy-boundaries';
  const writerInput = { entry: { nested: { value: 1 } } };
  assert.equal(jsonDb.writeCollection(collection, writerInput), true);
  writerInput.entry.nested.value = 2;

  const record = jsonDb.getRecord(collection, 'entry');
  record.nested.value = 3;
  const records = jsonDb.getAllRecords(collection);
  records[0].nested.value = 4;
  const fullCollection = jsonDb.readCollection(collection);
  fullCollection.entry.nested.value = 5;

  assert.deepEqual(jsonDb.getRecord(collection, 'entry'), { nested: { value: 1 } });
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

test('nested mutation followed by a failed save leaves cached data unchanged', async () => {
  const collection = 'atomic-nested-failure';
  const filepath = path.join(dbDirectory, `${collection}.json`);
  await jsonDb.setRecord(collection, 'entry', { nested: { value: 1 } });
  const previousContents = fs.readFileSync(filepath, 'utf-8');
  const exposedRecord = jsonDb.getRecord(collection, 'entry');
  exposedRecord.nested.value = 2;
  const originalRenameSync = fs.renameSync;

  fs.renameSync = function (source, destination) {
    if (destination === filepath) {
      const error = new Error('simulated nested replacement failure');
      error.code = 'EIO';
      throw error;
    }
    return originalRenameSync.call(fs, source, destination);
  };

  try {
    await assert.rejects(
      jsonDb.setRecord(collection, 'entry', exposedRecord),
      /simulated nested replacement failure/,
    );
  } finally {
    fs.renameSync = originalRenameSync;
  }

  assert.equal(fs.readFileSync(filepath, 'utf-8'), previousContents);
  assert.deepEqual(jsonDb.getRecord(collection, 'entry'), { nested: { value: 1 } });
  assert.deepEqual(fs.readdirSync(dbDirectory).filter((name) => name.endsWith('.tmp')), []);
});
