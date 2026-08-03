/**
 * Printable damage pass:
 * - Beastfolk: trim overefficient D4 commons/uncommons toward Dragon avg (~3.2)
 * - Human / Demon: raise low damage toward mid-pack
 * Keeps Beastfolk Move identity untouched.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import Database from 'better-sqlite3'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('data/cards')
const RACES = {
  Beastfolk: path.join(KB, 'beastfolk/units.yaml'),
  Human: path.join(KB, 'humans/units.yaml'),
  Demon: path.join(KB, 'demons/units.yaml'),
}

function shouldNerfBeast(card) {
  const d = Number(card.damage) || 0
  const uv = Number(card.uv) || 0
  const rarity = String(card.rarity || 'Common')
  if (d < 4) return false
  if (rarity === 'Common') return true
  if (rarity === 'Uncommon' && uv <= 5) return true
  return false
}

function shouldBuffHuman(card) {
  // Lift the soft D2 line; leave D1 support/links alone.
  return Number(card.damage) === 2
}

function shouldBuffDemon(card) {
  const d = Number(card.damage) || 0
  const uv = Number(card.uv) || 0
  const rarity = String(card.rarity || 'Common')
  if (d <= 2) return true
  // Mid demons are stuck on D3 â€” bump Uncommon+ at UV>=4
  if (d === 3 && uv >= 4 && rarity !== 'Common') return true
  return false
}

const changes = []

for (const [race, file] of Object.entries(RACES)) {
  const doc = yaml.load(fs.readFileSync(file, 'utf8'))
  let dirty = false
  for (const card of doc.cards || []) {
    if (card.card_type && card.card_type !== 'Unit') continue
    const before = Number(card.damage) || 0
    let after = before
    if (race === 'Beastfolk' && shouldNerfBeast(card)) after = Math.max(1, before - 1)
    if (race === 'Human' && shouldBuffHuman(card)) after = before + 1
    if (race === 'Demon' && shouldBuffDemon(card)) after = before + 1
    if (after === before) continue
    card.damage = after
    changes.push({
      race,
      name: card.name,
      rarity: card.rarity,
      uv: card.uv,
      damage: `${before}â†’${after}`,
    })
    dirty = true
  }
  if (dirty) {
    fs.writeFileSync(file, yaml.dump(doc, { lineWidth: 100, noRefs: true, quotingType: '"' }))
  }
}

const db = new Database('data/command-warfare.sqlite')
const upd = db.prepare('UPDATE cards SET damage = ? WHERE name = ? AND card_type = ?')
let dbN = 0
for (const c of changes) {
  const info = upd.run(Number(c.damage.split('â†’')[1]), c.name, 'Unit')
  dbN += info.changes
}

function raceAvg(race) {
  const row = db
    .prepare(
      `SELECT AVG(damage) AS d, COUNT(*) AS n FROM cards WHERE card_type='Unit' AND race=?`,
    )
    .get(race)
  return { n: row.n, avg: Number(row.d).toFixed(2) }
}

console.log('changes', changes.length, 'dbRows', dbN)
console.log('byRace', {
  Beastfolk: changes.filter((c) => c.race === 'Beastfolk').length,
  Human: changes.filter((c) => c.race === 'Human').length,
  Demon: changes.filter((c) => c.race === 'Demon').length,
})
for (const c of changes) {
  console.log(`${c.race.padEnd(10)} ${String(c.uv).padStart(2)}UV ${c.damage} ${c.rarity} ${c.name}`)
}
console.log('avgs', {
  Beastfolk: raceAvg('Beastfolk'),
  Dragon: raceAvg('Dragon'),
  Human: raceAvg('Human'),
  Demon: raceAvg('Demon'),
})
db.close()
