#!/usr/bin/env node
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '..', 'data', 'command-warfare.sqlite');

const db = new Database(DB_PATH);

// Check what abilities look like
const sampleAbilities = db.prepare(`
  SELECT name, ability_type, cost, cost_amount, description
  FROM abilities
  LIMIT 30
`).all();

console.log('Sample abilities from database:');
console.log(JSON.stringify(sampleAbilities, null, 2));

// Check which abilities are used by officers
const officerAbilities = db.prepare(`
  SELECT DISTINCT abilities_json
  FROM cards
  WHERE card_type = 'Officer'
  LIMIT 10
`).all();

console.log('\n\nSample officer abilities_json:');
console.log(JSON.stringify(officerAbilities, null, 2));

db.close();
