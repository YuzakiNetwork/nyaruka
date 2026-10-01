#!/usr/bin/env node
/**
 * scripts/migrate-to-mongo.js
 * Migrasi data dari JSON files ke MongoDB
 */

import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';
import 'dotenv/config';

const JSON_DIR = process.env.DB_PATH || './data';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const MONGO_DB = process.env.MONGO_DB || 'rpgbot';

async function migrate() {
  console.log('🚀 Starting migration: JSON → MongoDB');
  console.log(`   Source: ${JSON_DIR}`);
  console.log(`   Target: ${MONGO_URI}/${MONGO_DB}\n`);

  if (!fs.existsSync(JSON_DIR)) {
    console.error(`❌ JSON directory not found: ${JSON_DIR}`);
    process.exit(1);
  }

  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    const db = client.db(MONGO_DB);
    console.log('✅ Connected to MongoDB\n');

    const files = fs.readdirSync(JSON_DIR).filter(f => f.endsWith('.json'));

    for (const file of files) {
      const collection = file.replace('.json', '');
      console.log(`📦 Migrating: ${collection}`);

      const filepath = path.join(JSON_DIR, file);
      const rawData = JSON.parse(fs.readFileSync(filepath, 'utf-8'));

      // Convert object to array of docs
      const docs = Object.entries(rawData).map(([id, data]) => ({
        ...data,
        _id: id,
        migratedAt: new Date(),
      }));

      if (docs.length === 0) {
        console.log(`   ⏭️  Empty, skipped`);
        continue;
      }

      const coll = db.collection(collection);
      
      // Clear existing
      await coll.deleteMany({});
      
      // Insert migrated data
      const result = await coll.insertMany(docs);
      console.log(`   ✅ ${result.insertedCount} documents inserted`);
    }

    console.log('\n🎉 Migration completed!');
    console.log('\n💡 Next steps:');
    console.log('   1. Update .env: DB_TYPE=mongodb');
    console.log('   2. Restart bot: npm start');
    console.log('   3. (Optional) Backup JSON files: tar -czf data-backup.tar.gz data/');

  } catch (err) {
    console.error('\n❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

migrate();
