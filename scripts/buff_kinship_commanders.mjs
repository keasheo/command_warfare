/**
 * Buff kinship commanders: Human, Dwarf, Beastfolk, Construct, Undead.
 * - Compact aura: +1 Damage + Harden 1 (Beastfolk: +1 Damage + +1 Hit)
 * - Body: T5, radius 8, CC 6
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('C:/Users/keash/Projects/KingdomsBuilder/data')

const BUFFS = {
  'Human Compact':
    'Friendly Human units within Command Radius gain +1 Damage and Harden 1.',
  'Dwarf Compact':
    'Friendly Dwarf units within Command Radius gain +1 Damage and Harden 1.',
  'Beastfolk Compact':
    'Friendly Beastfolk units within Command Radius gain +1 Damage and +1 Hit.',
  'Undead Compact':
    'Friendly Undead units within Command Radius gain +1 Damage and Harden 1.',
  'Construct Compact':
    'Friendly Construct units within Command Radius gain +1 Damage and Harden 1.',
}

const COMMANDERS = [
  ['humans/commanders.yaml', 'Realmward High Marshal'],
  ['dwarves/commanders.yaml', 'Thane of All Holds'],
  ['beastfolk/commanders.yaml', 'High Alpha of Tribes'],
  ['constructs/commanders.yaml', 'Prime Directive Core'],
  ['undead/commanders.yaml', 'Lord of the Still Host'],
]

const abPath = path.join(KB, 'abilities.yaml')
let ab = fs.readFileSync(abPath, 'utf8')
for (const [name, desc] of Object.entries(BUFFS)) {
  const re = new RegExp(
    `(${name}:\\n(?:  [^\\n]+\\n)*?  description: )[^\\n]+`,
  )
  if (!re.test(ab)) {
    console.error('missing', name)
    continue
  }
  ab = ab.replace(re, `$1${desc}`)
  console.log('ability', name)
}
fs.writeFileSync(abPath, ab)

for (const [rel, name] of COMMANDERS) {
  const file = path.join(KB, 'cards', rel)
  const doc = yaml.load(fs.readFileSync(file, 'utf8'))
  const card = (doc.cards || []).find((c) => c.name === name)
  if (!card) {
    console.error('missing card', name)
    continue
  }
  card.toughness = 5
  card.command_radius = 7
  card.cc_generation = 6
  card.uv = 16
  fs.writeFileSync(file, yaml.dump(doc, { lineWidth: 100, noRefs: true, quotingType: '"' }))
  console.log('commander', name, 'T5 R8 CC6 UV16')
}
