/**
 * lib/database/db.js
 * Database router — switch between JSON and MongoDB
 */

import { config } from '../../config.js';
import { logger } from '../utils/logger.js';

let db = null;

/**
 * Initialize database based on config
 */
export async function initDatabase() {
  const dbType = config.db.type || 'json';

  if (dbType === 'mongodb') {
    try {
      const mongodb = await import('./mongodb.js');
      await mongodb.connect(config.db.mongoUri, config.db.mongoDb);
      db = mongodb.default;
      logger.warn('MongoDB mode is not verified end-to-end: legacy synchronous gameplay reads still need migration; JSON mode is the verified option.');
      logger.info('Database: MongoDB');
      return db;
    } catch (err) {
      logger.error({ err }, 'MongoDB init failed, fallback to JSON');
      // Fallback ke JSON
    }
  }

  // Default: JSON file-based
  const jsonDb = await import('./json.js');
  db = jsonDb.default;
  logger.info('Database: JSON (file-based)');
  return db;
}

/**
 * Export unified interface
 */
export function getRecord(collection, id) {
  return db?.getRecord(collection, id) || null;
}

export async function getRecordAsync(collection, id) {
  if (db?.getRecordAsync) {
    return await db.getRecordAsync(collection, id);
  }
  return db?.getRecord(collection, id) || null;
}

export async function setRecord(collection, id, data) {
  if (!db) throw new Error('Database not initialized');
  return await db.setRecord(collection, id, data);
}

export function getAllRecords(collection) {
  return db?.getAllRecords(collection) || [];
}

export async function getAllRecordsAsync(collection) {
  if (db?.getAllRecordsAsync) {
    return await db.getAllRecordsAsync(collection);
  }
  return db?.getAllRecords(collection) || [];
}

export function deleteRecord(collection, id) {
  return db?.deleteRecord(collection, id) || false;
}

export async function deleteRecordAsync(collection, id) {
  if (db?.deleteRecordAsync) {
    return await db.deleteRecordAsync(collection, id);
  }
  return db?.deleteRecord(collection, id) || false;
}

// MongoDB-specific exports (optional features)
export async function query(collection, filter, options) {
  if (db?.query) {
    return await db.query(collection, filter, options);
  }
  // Fallback: get all and filter in-memory
  const all = getAllRecords(collection);
  return all; // JSON doesn't support complex queries
}

export async function readCollection(collection) {
  if (db?.readCollection) {
    return await db.readCollection(collection);
  }
  return {}; // Fallback for JSON if not explicitly implemented
}

export async function writeCollection(collection, data) {
  if (!db) throw new Error('Database not initialized');
  if (db?.writeCollection) {
    return await db.writeCollection(collection, data);
  }
  // Fallback for JSON if not explicitly implemented, though JSON already has it
  return false;
}

export async function count(collection, filter) {
  if (db?.count) {
    return await db.count(collection, filter);
  }
  return getAllRecords(collection).length;
}

export async function hasRecord(collection, id) {
  if (!db) throw new Error('Database not initialized');
  if (db.hasRecord) return Boolean(await db.hasRecord(collection, id));
  return (await getRecordAsync(collection, id)) != null;
}

export default {
  initDatabase,
  getRecord, getRecordAsync,
  setRecord,
  getAllRecords, getAllRecordsAsync,
  deleteRecord, deleteRecordAsync,
  query, count,
  readCollection, writeCollection,
  hasRecord,
};
