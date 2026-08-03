/**
 * Apply RENAMES to KingdomsBuilder card YAMLs and cardFlavors.mjs keys.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { RENAMES } from './cardRenames.mjs'
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

// Validate uniqueness of new names
const newNames = Object.values(RENAMES)
const seen = new Map()
for (const [oldN, newN] of Object.entries(RENAMES)) {
  if (seen.has(newN)) {
    console.error('DUPLICATE NEW NAME', newN, 'from', seen.get(newN), 'and', oldN)
    process.exit(1)
  }
  seen.set(newN, oldN)
}

let renamed = 0
const missing = []
for (const file of walk(ROOT)) {
  let raw = fs.readFileSync(file, 'utf8')
  let dirty = false
  const doc = yaml.load(raw)
  for (const card of doc.cards || []) {
    const next = RENAMES[card.name]
    if (!next) continue
    if (next === card.name) continue
    const esc = card.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`^(  name: )${esc}$`, 'm')
    if (!re.test(raw)) {
      missing.push({ file, name: card.name })
      continue
    }
    raw = raw.replace(re, `$1${next}`)
    dirty = true
    renamed++
  }
  if (dirty) fs.writeFileSync(file, raw)
}

// Update flavor map keys
const nextFlavor = {}
for (const [name, text] of Object.entries(FLAVOR)) {
  const newName = RENAMES[name] || name
  if (nextFlavor[newName] && nextFlavor[newName] !== text) {
    console.warn('Flavor collision on', newName)
  }
  nextFlavor[newName] = text
}

const flavorSrc = `/**
 * Unique flavor text for Command Warfare cards.
 * Commanders already have handcrafted lines â€” omitted here.
 */
export const FLAVOR = ${JSON.stringify(nextFlavor, null, 2).replace(/"([^"]+)":/g, "'$1':").replace(/"/g, "'")}
`
// JSON.stringify with single quotes is messy â€” write cleaner:
const lines = [
  '/**',
  ' * Unique flavor text for Command Warfare cards.',
  ' * Commanders already have handcrafted lines â€” omitted here.',
  ' */',
  'export const FLAVOR = {',
]
for (const [name, text] of Object.entries(nextFlavor).sort((a, b) => a[0].localeCompare(b[0]))) {
  lines.push(`  ${JSON.stringify(name)}: ${JSON.stringify(text)},`)
}
lines.push('}')
lines.push('')
fs.writeFileSync(new URL('./cardFlavors.mjs', import.meta.url), lines.join('\n'))

// Prefix report
const cards = []
for (const file of walk(ROOT)) {
  const doc = yaml.load(fs.readFileSync(file, 'utf8'))
  for (const c of doc.cards || []) cards.push(c.name)
}
const prefixes = {}
for (const n of cards) {
  const p = n.split(/[\s-]/)[0]
  prefixes[p] = (prefixes[p] || 0) + 1
}
const heavy = Object.entries(prefixes)
  .filter(([, n]) => n >= 3)
  .sort((a, b) => b[1] - a[1])

console.log(
  JSON.stringify(
    {
      renamed,
      missing,
      totalCards: cards.length,
      uniqueNames: new Set(cards).size,
      prefixesStillHeavy: heavy,
    },
    null,
    2,
  ),
)
