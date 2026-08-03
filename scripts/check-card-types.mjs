#!/usr/bin/env node
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '..', 'data', 'command-warfare.sqlite');

const db = new Database(DB_PATH);

// Check what card types exist
const cardTypes = db.prepare(`
  SELECT DISTINCT card_type, COUNT(*) as count
  FROM cards
  GROUP BY card_type
  ORDER BY count DESC
`).all();

console.log('Card types in database:');
console.log(cardTypes);

// Sample a few cards
const sampleCards = db.prepare(`
  SELECT id, name, card_type, race, uv, abilities_json
  FROM cards
  LIMIT 20
`).all();

console.log('\nSample cards:');
console.log(sampleCards);

db.close();
