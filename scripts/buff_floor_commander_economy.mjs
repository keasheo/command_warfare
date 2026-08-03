/**
 * Floor commander economy: +1 CC generation, slight UV cut so lists can field more units.
 * Targets commanders under ~42% decisive win in latest multi-commander suite.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import Database from 'better-sqlite3'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('C:/Users/keash/Projects/KingdomsBuilder/data/cards')

/** win% < 42 from sim/sim-commander-performance — economy help, not kit rewrites */
const FLOOR = [
  'Thunderhoof Caller',
  'Hearthstone Covenant',
  'Iron Covenant Spear',
  'Voidclaw Tormentor',
  'Doomforge Tyrant',
  'Hydra Broodmother',
  'Hold-Lord Granite',
  'Starfall Huntress',
  'Bone Harvester Mire',
  'Forge-Marshal Flintpick',
  'Gravemind Orth',
  'Cataclysm Elder Pyrr',
  'Whispercanopy Huntress',
  'Gorgon Basalt Matriarch',
]

function nextUv(uv) {
  const u = Number(uv) || 0
  if (u >= 24) return u - 3
  if (u >= 21) return u - 2
  if (u >= 16) return u - 2
  if (u >= 11) return Math.max(10, u - 1)
  return u
}

function nextCc(cc) {
  const c = Number(cc) || 5
  return Math.max(c + 1, 6) // at least +1, and match Compact floor of 6 when at 5
}

const files = fs
  .readdirSync(KB, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => path.join(KB, d.name, 'commanders.yaml'))
  .filter((f) => fs.existsSync(f))

const changes = []
const wanted = new Set(FLOOR)

for (const file of files) {
  const doc = yaml.load(fs.readFileSync(file, 'utf8'))
  let dirty = false
  for (const card of doc.cards || []) {
    if (!wanted.has(card.name)) continue
    const before = { uv: card.uv, cc: card.cc_generation }
    card.cc_generation = nextCc(card.cc_generation)
    card.uv = nextUv(card.uv)
    changes.push({
      name: card.name,
      race: card.race,
      rarity: card.rarity,
      uv: `${before.uv}→${card.uv}`,
      cc: `${before.cc}→${card.cc_generation}`,
      file: path.relative(KB, file),
    })
    wanted.delete(card.name)
    dirty = true
  }
  if (dirty) {
    fs.writeFileSync(file, yaml.dump(doc, { lineWidth: 100, noRefs: true, quotingType: '"' }))
  }
}

if (wanted.size) {
  console.error('Missing from YAML:', [...wanted].join(', '))
}

// Mirror into live SQLite so play/sim see it without full re-import
const db = new Database('data/command-warfare.sqlite')
const upd = db.prepare(
  `UPDATE cards SET uv = ?, cc_generation = ? WHERE name = ? AND card_type = 'Commander'`,
)
const sel = db.prepare(
  `SELECT name, uv, cc_generation FROM cards WHERE name = ? AND card_type = 'Commander'`,
)

console.log('name\tUV\tCC\tfile')
for (const c of changes) {
  const row = sel.get(c.name)
  if (!row) {
    console.error('SQLite miss', c.name)
    continue
  }
  const uv = nextUv(row.uv)
  const cc = nextCc(row.cc_generation)
  upd.run(uv, cc, c.name)
  console.log(`${c.name}\t${c.uv}\t${c.cc}\t${c.file}`)
}

console.log(`\nUpdated ${changes.length} commanders (YAML + SQLite).`)
