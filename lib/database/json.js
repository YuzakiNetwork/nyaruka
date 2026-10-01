/**
 * lib/database/json.js
 * JSON file-based database (original implementation)
 */

import fs from 'fs';
import path from 'path';
import { config } from '../../config.js';
import { logger } from '../utils/logger.js';

const DB_DIR = path.resolve(config.db.path || './data');
const _cache = new Map();

// Ensure DB directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

function getFilePath(collection) {
  return path.join(DB_DIR, `${collection}.json`);
}

function cloneJson(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError('Value must be JSON-serializable');
  }
  return JSON.parse(serialized);
}

function loadCollection(collection) {
  const cached = _cache.get(collection);
  if (cached) return cached;

  const filepath = getFilePath(collection);
  if (!fs.existsSync(filepath)) {
    _cache.set(collection, {});
    return {};
  }

  try {
    const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    _cache.set(collection, data);
    return data;
  } catch (err) {
    logger.error({ err, collection }, 'Failed to load collection');
    return {};
  }
}

// ecosystem.config.js uses one PM2 instance; atomic rename is not an
// inter-process lock, so this adapter assumes a single writer.
function saveCollection(collection, data) {
  const filepath = getFilePath(collection);
  const backupPath = `${filepath}.bak`;
  const suffix = `${process.pid}.${Date.now()}`;
  const tmpPath = `${filepath}.${suffix}.tmp`;
  const backupTmpPath = `${backupPath}.${suffix}.tmp`;
  try {
    const serialized = JSON.stringify(data, null, 2);
    if (serialized === undefined) {
      throw new TypeError('Collection data must be JSON-serializable');
    }
    const persistedData = JSON.parse(serialized);

    let hasExistingFile = true;
    try {
      fs.lstatSync(filepath);
    } catch (err) {
      if (err.code === 'ENOENT') hasExistingFile = false;
      else throw err;
    }

    const existingMode = hasExistingFile
      ? fs.statSync(filepath).mode & 0o777
      : null;

    // Keep new database files private by default; stage existing files as
    // private too, then restore their prior permission bits before replacing.
    fs.writeFileSync(tmpPath, serialized, {
      encoding: 'utf-8',
      flag: 'wx',
      mode: 0o600,
    });
    if (hasExistingFile) fs.chmodSync(tmpPath, existingMode);

    // Prepare the replacement on the same filesystem before touching the
    // current collection file.
    if (hasExistingFile) {
      fs.copyFileSync(filepath, backupTmpPath);
      fs.chmodSync(backupTmpPath, existingMode);
      fs.renameSync(backupTmpPath, backupPath);
    }

    // Rename is atomic on the same filesystem; the original is left in place
    // unless the complete replacement and its backup are ready.
    fs.renameSync(tmpPath, filepath);
    _cache.set(collection, persistedData);
  } catch (err) {
    // Do not let cleanup failures hide the write error or turn it into success.
    for (const temporaryPath of [tmpPath, backupTmpPath]) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch (cleanupErr) {
        if (cleanupErr.code !== 'ENOENT') {
          logger.error({ err: cleanupErr, collection }, 'Failed to clean up temporary database file');
        }
      }
    }
    logger.error({ err, collection }, 'Failed to save collection');
    throw err;
  }
}

export function getRecord(collection, id) {
  const data = loadCollection(collection);
  return data[id] ? cloneJson(data[id]) : null;
}

export async function getRecordAsync(collection, id) {
  return getRecord(collection, id);
}

export async function setRecord(collection, id, record) {
  const data = { ...loadCollection(collection), [id]: record };
  saveCollection(collection, data);
  return true;
}

export function getAllRecords(collection) {
  const data = loadCollection(collection);
  return Object.values(data).map(cloneJson);
}

export async function getAllRecordsAsync(collection) {
  return getAllRecords(collection);
}

export function deleteRecord(collection, id) {
  const data = loadCollection(collection);
  if (data[id]) {
    const updated = { ...data };
    delete updated[id];
    saveCollection(collection, updated);
    return true;
  }
  return false;
}

export function hasRecord(collection, id) {
  const data = loadCollection(collection);
  return !!data[id];
}

export async function deleteRecordAsync(collection, id) {
  return deleteRecord(collection, id);
}

export function readCollection(collection) {
  return cloneJson(loadCollection(collection));
}

export function writeCollection(collection, data) {
  saveCollection(collection, data);
  return true;
}

export default {
  getRecord, getRecordAsync,
  setRecord,
  getAllRecords, getAllRecordsAsync,
  deleteRecord, deleteRecordAsync,
  hasRecord,
  readCollection, writeCollection,
};
