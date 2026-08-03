import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

const db = new Database('data/command-warfare.sqlite', { readonly: true })
const artDir = path.resolve('data/art')
const has = new Set(
  fs.existsSync(artDir)
    ? fs.readdirSync(artDir).map((f) => path.parse(f).name)
    : [],
)

const rows = db
  .prepare(
    `SELECT id, name, card_type, race, rarity, primary_type, secondary_type
     FROM cards
     WHERE card_type IN ('Commander', 'Officer', 'Unit')
       AND uv IS NOT NULL AND uv > 0
     ORDER BY race, card_type, name`,
  )
  .all()

const missing = rows.filter((r) => !has.has(r.id))
const byRace = {}
for (const r of missing) {
  const race = r.race || 'Unknown'
  byRace[race] = byRace[race] || { Commander: 0, Officer: 0, Unit: 0, total: 0 }
  byRace[race][r.card_type] = (byRace[race][r.card_type] || 0) + 1
  byRace[race].total++
}

const outPath = path.resolve('play/scripts/art-queue-remaining.json')
fs.writeFileSync(
  outPath,
  JSON.stringify({ total: missing.length, byRace, cards: missing }, null, 2),
)
console.log(JSON.stringify({ total: missing.length, byRace, artFiles: has.size }, null, 2))
console.log('Wrote', outPath)
