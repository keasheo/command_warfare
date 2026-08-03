/**
 * Add one race-Compact passive + kinship commander per playable race.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('C:/Users/keash/Projects/KingdomsBuilder/data')

const races = [
  {
    race: 'Human',
    folder: 'humans',
    name: 'Realmward High Marshal',
    compact: 'Human Compact',
    ultimate: 'Unbroken Hearth',
    active: 'Hold the Line',
    flavor: 'One banner. Every hearth answers.',
    role: 'Support',
    prim: 'Infantry',
  },
  {
    race: 'Elf',
    folder: 'elves',
    name: 'Green Court Sovereign',
    compact: 'Elf Compact',
    ultimate: 'Ancient Canopy Stand',
    active: 'Arrowstorm Command',
    flavor: 'The forest crowns only its own.',
    role: 'Artillery',
    prim: 'Ranged',
  },
  {
    race: 'Demon',
    folder: 'demons',
    name: 'Ashen Blood Sovereign',
    compact: 'Demon Compact',
    ultimate: 'Abyssal Onslaught',
    active: 'Cinder March',
    flavor: 'Infernal blood recognizes infernal blood.',
    role: 'Damage',
    prim: 'Infantry',
  },
  {
    race: 'Lizardman',
    folder: 'lizardmen',
    name: 'Fenbrood Scale-King',
    compact: 'Lizardman Compact',
    ultimate: 'Fen Unity',
    active: 'Poison Tide',
    flavor: "The clutch hears only the king's drum.",
    role: 'Control',
    prim: 'Infantry',
  },
  {
    race: 'Dwarf',
    folder: 'dwarves',
    name: 'Thane of All Holds',
    compact: 'Dwarf Compact',
    ultimate: 'Anvil Decree',
    active: 'Fortify Works',
    flavor: 'Every hold under one oath.',
    role: 'Tank',
    prim: 'Infantry',
  },
  {
    race: 'Dragon',
    folder: 'dragons',
    name: 'Kindred Tyrant',
    compact: 'Dragon Compact',
    ultimate: 'Sky Tyrant',
    active: 'Brood Call',
    flavor: 'Wings answer only their own sky.',
    role: 'Damage',
    prim: 'Infantry',
  },
  {
    race: 'Beastfolk',
    folder: 'beastfolk',
    name: 'High Alpha of Tribes',
    compact: 'Beastfolk Compact',
    ultimate: 'Blood Moon',
    active: 'Pack Hunt',
    flavor: 'Many packs. One howl.',
    role: 'Damage',
    prim: 'Beast',
  },
  {
    race: 'Undead',
    folder: 'undead',
    name: 'Lord of the Still Host',
    compact: 'Undead Compact',
    ultimate: 'Eclipse of Fear',
    active: 'Death March',
    flavor: 'The dead march for their own.',
    role: 'Control',
    prim: 'Infantry',
  },
  {
    race: 'Construct',
    folder: 'constructs',
    name: 'Prime Directive Core',
    compact: 'Construct Compact',
    ultimate: 'Full Rebuild',
    active: 'Sealant Coat',
    flavor: 'Only compliant chassis receive the signal.',
    role: 'Support',
    prim: 'Infantry',
  },
]

const abPath = path.join(KB, 'abilities.yaml')
let abText = fs.readFileSync(abPath, 'utf8')
if (!abText.includes('Human Compact:')) {
  let block = '\n# --- Racial Compacts (same-race commander auras) ---\n'
  for (const r of races) {
    block += `${r.compact}:
  type: Passive
  cost: Passive
  description: Friendly ${r.race} units within Command Radius gain +1 Damage.
  affects: self
  used_by: Commander
  tags:
  - passive
  - ${r.race.toLowerCase()}
  - kinship
`
  }
  fs.writeFileSync(abPath, `${abText.trimEnd()}\n${block}`)
  console.log('abilities appended')
} else {
  console.log('abilities already present')
}

for (const r of races) {
  const file = path.join(KB, 'cards', r.folder, 'commanders.yaml')
  const doc = yaml.load(fs.readFileSync(file, 'utf8'))
  if (
    (doc.cards || []).some(
      (c) => c.name === r.name || (c.abilities || []).includes(r.compact),
    )
  ) {
    console.log('skip', r.race, '- exists')
    continue
  }
  doc.cards.push({
    id: crypto.randomBytes(16).toString('hex'),
    name: r.name,
    card_type: 'Commander',
    rarity: 'Epic',
    unique: false,
    race: r.race,
    primary_type: r.prim,
    secondary_type: null,
    uv: 15,
    move: 3,
    damage: 2,
    range: 1,
    toughness: 4,
    company_ap: null,
    company_capacity: null,
    command_radius: 7,
    ap_generation: 5,
    cc_generation: 5,
    keywords: [],
    abilities: [r.compact, 'Inspiring Presence', 'Rally', r.active],
    ultimate: r.ultimate,
    flavor_text: r.flavor,
    complexity: 4,
    role: r.role,
    tags: [r.race.toLowerCase(), 'kinship', 'compact'],
  })
  fs.writeFileSync(file, yaml.dump(doc, { lineWidth: 100, noRefs: true, quotingType: '"' }))
  console.log('added', r.race, r.name)
}
