/**
 * Raise move floor to 3 for all cards below 3, except non-creature siege weapons
 * (catapult, ballista, trebuchet, onager, culverin, tower, ram, engine, etc.).
 *
 * Patches KingdomsBuilder YAML in place (surgical move: edits), then SQLite.
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const kbCards = path.resolve(root, '../KingdomsBuilder/data/cards')
const dbPath = path.join(root, 'data/command-warfare.sqlite')
const FLOOR = 3

const WEAPON_RE =
  /\b(catapult|ballista|trebuchet|onager|culverin|ram|engine|tower|brandram|mortar|cannon|bombard|mangonel|scorpion)\b/i
const CREATURE_OPERATOR_RE =
  /\b(crew|crewman|crewmen|team|sergeant|officer|hauler|engineer|psalm|warden|conductor|herald|captain)\b/i

function isNonCreatureSiegeWeapon(row) {
  if (row.card_type !== 'Unit') return false
  if (CREATURE_OPERATOR_RE.test(row.name)) return false
  if (!WEAPON_RE.test(row.name)) return false
  return (
    row.primary_type === 'Siege' ||
    row.race === 'Siege' ||
    row.secondary_type === 'Siege' ||
    WEAPON_RE.test(row.name)
  )
}

function shouldBump(row) {
  const move = Number(row.move)
  if (!Number.isFinite(move) || move <= 0 || move >= FLOOR) return false
  return !isNonCreatureSiegeWeapon(row)
}

function walkYamlFiles(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walkYamlFiles(p, out)
    else if (/\.ya?ml$/i.test(ent.name)) out.push(p)
  }
  return out
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Replace the first `move:` under a given card name block. */
function bumpMoveInText(text, cardName, fromMove) {
  const nameRe = new RegExp(
    `(name:\\s*(?:["']?)${escapeRegExp(cardName)}(?:["']?)\\s*\\n)([\\s\\S]*?)(\\n[ \\t]*move:\\s*)${fromMove}\\b`,
  )
  const m = text.match(nameRe)
  if (!m) return { text, ok: false }
  // Only rewrite if this name's following move is still the low value
  // (nameRe already anchors to that move). Cap the middle span so we don't
  // jump into the next card — stop at the next top-level "- id:" / "id:".
  const start = m.index
  const head = text.slice(0, start)
  const rest = text.slice(start)
  const blockEnd = rest.search(/\n-\s+id:|\n[ \t]*id:\s+[0-9a-f]{8}/i)
  const block = blockEnd >= 0 ? rest.slice(0, blockEnd) : rest
  const after = blockEnd >= 0 ? rest.slice(blockEnd) : ''
  const moved = block.replace(
    new RegExp(`(\\n[ \\t]*move:\\s*)${fromMove}\\b`),
    `$1${FLOOR}`,
  )
  if (moved === block) return { text, ok: false }
  return { text: head + moved + after, ok: true }
}

if (!fs.existsSync(kbCards)) {
  console.error('Missing KingdomsBuilder cards at', kbCards)
  process.exit(1)
}

const keep = []
const bump = []
let yamlFilesTouched = 0

for (const file of walkYamlFiles(kbCards)) {
  const raw = fs.readFileSync(file, 'utf8')
  const doc = yaml.load(raw)
  const cards = Array.isArray(doc?.cards)
    ? doc.cards
    : Array.isArray(doc)
      ? doc
      : null
  if (!cards) continue

  let text = raw
  let fileChanged = false
  for (const card of cards) {
    if (!card || typeof card !== 'object' || !card.name) continue
    const move = Number(card.move)
    if (!Number.isFinite(move) || move <= 0 || move >= FLOOR) continue
    if (!shouldBump(card)) {
      keep.push({
        name: card.name,
        card_type: card.card_type,
        race: card.race,
        primary_type: card.primary_type,
        move,
      })
      continue
    }
    const res = bumpMoveInText(text, card.name, move)
    if (!res.ok) {
      console.warn('WARN: could not patch YAML move for', card.name, 'in', file)
      continue
    }
    text = res.text
    fileChanged = true
    bump.push({
      name: card.name,
      card_type: card.card_type,
      race: card.race,
      from: move,
      file: path.relative(kbCards, file),
    })
  }

  if (fileChanged) {
    fs.writeFileSync(file, text)
    yamlFilesTouched++
  }
}

console.log('KEEP below floor (siege weapons):', keep.length)
for (const r of keep) {
  console.log(
    `  ${r.name} [${r.card_type}/${r.race}/${r.primary_type}] move ${r.move}`,
  )
}
console.log('BUMP to move', FLOOR, ':', bump.length)
for (const r of bump) {
  console.log(`  ${r.name} [${r.card_type}/${r.race}] ${r.from} → ${FLOOR}`)
}
console.log('YAML files touched:', yamlFilesTouched)

if (fs.existsSync(dbPath)) {
  const db = new Database(dbPath)
  const low = db
    .prepare(
      `SELECT id, name, card_type, race, primary_type, secondary_type, move
       FROM cards
       WHERE move IS NOT NULL AND move > 0 AND move < ?
       ORDER BY name`,
    )
    .all(FLOOR)
  const dbBump = low.filter((row) => shouldBump(row))
  const upd = db.prepare(`UPDATE cards SET move = ? WHERE id = ?`)
  db.transaction((rows) => {
    for (const r of rows) upd.run(FLOOR, r.id)
  })(dbBump)
  console.log(`SQLite updated ${dbBump.length} cards.`)
  db.close()
}
