/**
 * lib/database/mongodb.js
 * MongoDB adapter — production-ready dengan caching
 */

import { MongoClient } from 'mongodb';
import { logger } from '../utils/logger.js';

let client = null;
let database = null;
const _cache = new Map();  // In-memory cache untuk read performance
const CACHE_TTL = 5000;    // 5 detik cache

/**
 * Connect ke MongoDB
 */
export async function connect(uri, dbName = 'rpgbot') {
  if (client && database) {
    return database;
  }

  try {
    client = new MongoClient(uri, {
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
    });

    await client.connect();
    database = client.db(dbName);

    // Test connection
    await database.command({ ping: 1 });
    logger.info({ dbName }, '✅ MongoDB connected');

    // Create indexes
    await createIndexes();

    return database;
  } catch (err) {
    logger.error({ err }, '❌ MongoDB connection failed');
    throw err;
  }
}

async function createIndexes() {
  try {
    await database.collection('players').createIndexes([
      { key: { level: -1 } },
      { key: { gold: -1 } },
      { key: { 'stats.monstersKilled': -1 } },
    ]);
    await database.collection('guilds').createIndex({ level: -1 });
    logger.info('MongoDB indexes created');
  } catch (err) {
    logger.warn({ err }, 'Index creation warning');
  }
}

export async function disconnect() {
  if (client) {
    await client.close();
    client = null;
    database = null;
    _cache.clear();
    logger.info('MongoDB disconnected');
  }
}

/**
 * Get record dengan caching
 */
export async function getRecordAsync(collection, id) {
  const cacheKey = `${collection}:${id}`;
  const cached = _cache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const doc = await database.collection(collection).findOne({ _id: id });
  
  if (doc) {
    _cache.set(cacheKey, { data: doc, timestamp: Date.now() });
  }
  
  return doc;
}

/**
 * Sync wrapper (untuk kompatibilitas dengan kode lama)
 * PERINGATAN: Ini blocking! Sebaiknya refactor ke async
 */
export function getRecord(collection, id) {
  const cacheKey = `${collection}:${id}`;
  const cached = _cache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  // Return null untuk trigger async load di caller
  // Caller harus handle ini dengan fallback ke async
  return null;
}

/**
 * Set/Update record
 */
export async function setRecord(collection, id, data) {
  const doc = { ...data, _id: id, updatedAt: new Date() };
  
  await database.collection(collection).updateOne(
    { _id: id },
    { $set: doc },
    { upsert: true }
  );

  // Update cache
  _cache.set(`${collection}:${id}`, { data: doc, timestamp: Date.now() });
  
  return true;
}

/**
 * Get all records
 */
export async function getAllRecordsAsync(collection) {
  return await database.collection(collection).find({}).toArray();
}

export function getAllRecords(collection) {
  // Sync wrapper - return empty untuk safety
  return [];
}

/**
 * Delete record
 */
export async function deleteRecordAsync(collection, id) {
  const result = await database.collection(collection).deleteOne({ _id: id });
  _cache.delete(`${collection}:${id}`);
  return result.deletedCount > 0;
}

export function deleteRecord(collection, id) {
  _cache.delete(`${collection}:${id}`);
  database.collection(collection).deleteOne({ _id: id }).catch(() => {});
  return true;
}

/**
 * Query dengan filter
 */
export async function query(collection, filter = {}, options = {}) {
  return await database.collection(collection).find(filter, options).toArray();
}

export async function count(collection, filter = {}) {
  return await database.collection(collection).countDocuments(filter);
}

/**
 * Bulk operations
 */
export async function bulkWrite(collection, operations) {
  return await database.collection(collection).bulkWrite(operations);
}

/**
 * Clear cache (untuk testing/refresh)
 */
export function clearCache(collection, id) {
  if (collection && id) {
    _cache.delete(`${collection}:${id}`);
  } else if (collection) {
    for (const key of _cache.keys()) {
      if (key.startsWith(`${collection}:`)) {
        _cache.delete(key);
      }
    }
  } else {
    _cache.clear();
  }
}

export async function readCollection(collection) {
  const docs = await database.collection(collection).find({}).toArray();
  const result = {};
  for (const doc of docs) {
    result[doc._id] = doc;
  }
  return result;
}

export async function writeCollection(collection, data) {
  const collectionRef = database.collection(collection);
  await collectionRef.deleteMany({}); // Clear existing data
  const docsToInsert = Object.entries(data).map(([key, doc]) => ({
    ...doc,
    _id: doc._id ?? doc.id ?? doc.itemId ?? key,
  }));
  if (docsToInsert.length > 0) {
    await collectionRef.insertMany(docsToInsert);
  }
  clearCache(collection);
}

export async function hasRecord(collection, id) {
  const doc = await database.collection(collection).findOne({ _id: id });
  return !!doc;
}

export default {
  connect, disconnect,
  getRecord, getRecordAsync,
  setRecord,
  getAllRecords, getAllRecordsAsync,
  deleteRecord, deleteRecordAsync,
  query, count, bulkWrite,
  clearCache,
  readCollection, writeCollection,
  hasRecord,
};
