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

function saveCollection(collection, data) {
  const filepath = getFilePath(collection);
  try {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
    _cache.set(collection, data);
  } catch (err) {
    logger.error({ err, collection }, 'Failed to save collection');
  }
}

export function getRecord(collection, id) {
  const data = loadCollection(collection);
  return data[id] || null;
}

export async function getRecordAsync(collection, id) {
  return getRecord(collection, id);
}

export async function setRecord(collection, id, record) {
  const data = loadCollection(collection);
  data[id] = record;
  saveCollection(collection, data);
  return true;
}

export function getAllRecords(collection) {
  const data = loadCollection(collection);
  return Object.values(data);
}

export async function getAllRecordsAsync(collection) {
  return getAllRecords(collection);
}

export function deleteRecord(collection, id) {
  const data = loadCollection(collection);
  if (data[id]) {
    delete data[id];
    saveCollection(collection, data);
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
  return loadCollection(collection);
}

export function writeCollection(collection, data) {
  saveCollection(collection, data);
}

export default {
  getRecord, getRecordAsync,
  setRecord,
  getAllRecords, getAllRecordsAsync,
  deleteRecord, deleteRecordAsync,
  hasRecord,
  readCollection, writeCollection,
};
