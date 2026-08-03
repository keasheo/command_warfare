/**
 * Apply unique flavor_text from cardFlavors.mjs into KingdomsBuilder card YAMLs.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { FLAVOR } from './cardFlavors.mjs'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const ROOT = 'data/cards'

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.yaml')) out.push(p)
  }
  return out
}

const missing = []
const keptCommander = []
let updated = 0
const used = new Set()
const dupCheck = new Map()

for (const file of walk(ROOT)) {
  const raw = fs.readFileSync(file, 'utf8')
  const doc = yaml.load(raw)
  let dirty = false
  for (const card of doc.cards || []) {
    if (card.card_type === 'Commander') {
      keptCommander.push(card.name)
      continue
    }
    const line = FLAVOR[card.name]
    if (!line) {
      missing.push(card.name)
      continue
    }
    if (dupCheck.has(line) && dupCheck.get(line) !== card.name) {
      console.warn('DUPLICATE flavor:', line, 'â†’', dupCheck.get(line), 'and', card.name)
    }
    dupCheck.set(line, card.name)
    used.add(card.name)
    if (card.flavor_text !== line) {
      card.flavor_text = line
      dirty = true
      updated++
    }
  }
  if (dirty) {
    // Preserve file by regex-replacing flavor lines per card name (safer than full dump).
    let next = raw
    for (const card of doc.cards || []) {
      if (card.card_type === 'Commander') continue
      const line = FLAVOR[card.name]
      if (!line) continue
      const esc = card.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(
        `(name:\\s*${esc}[\\s\\S]*?flavor_text:\\s*)([^\\n]+)`,
        'm',
      )
      if (!re.test(next)) {
        console.warn('Could not patch flavor for', card.name, 'in', file)
        continue
      }
      const quoted = JSON.stringify(line)
      next = next.replace(re, `$1${quoted}`)
    }
    fs.writeFileSync(file, next)
  }
}

const unused = Object.keys(FLAVOR).filter((k) => !used.has(k))
console.log(
  JSON.stringify(
    {
      updated,
      missing,
      unused,
      commandersKept: keptCommander.length,
      uniqueFlavors: dupCheck.size,
    },
    null,
    2,
  ),
)
