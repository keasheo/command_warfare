/**
 * Limit Racial Compact to one kinship commander per race.
 * Replace Compact on other commanders with thematic passives.
 * Finish Inspiring Presence swaps on kinship commanders.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('C:/Users/keash/Projects/KingdomsBuilder/data')
const abPath = path.join(KB, 'abilities.yaml')

const COMPACT_KEEPERS = {
  Human: 'Realmward High Marshal',
  Elf: 'Green Court Sovereign',
  Demon: 'Ashen Blood Sovereign',
  Lizardman: 'Fenbrood Scale-King',
  Dwarf: 'Thane of All Holds',
  Dragon: 'Kindred Tyrant',
  Beastfolk: 'High Alpha of Tribes',
  Undead: 'Lord of the Still Host',
  Construct: 'Prime Directive Core',
}

/** New commander passives (description ≤175 chars). */
const NEW_ABILITIES = {
  'Hearth Roads': {
    type: 'Passive',
    cost: 'Passive',
    description:
      'Infantry in your army beginning activation inside Command Radius gain +1 Move if they end that move closer to an objective.',
    affects: 'self',
    used_by: 'Commander',
    tags: ['passive', 'human', 'movement'],
  },
  'Spearpoint Advance': {
    type: 'Passive',
    cost: 'Passive',
    description:
      'Infantry in your army that moved toward the nearest enemy during activation inside Command Radius gain +1 Hit on their first attack.',
    affects: 'self',
    used_by: 'Commander',
    tags: ['passive', 'human', 'offense'],
  },
  'Open Ground': {
    type: 'Passive',
    cost: 'Passive',
    description:
      'Cavalry and Beast units in your army beginning activation inside Command Radius gain +1 Move and Open Ground (+1 Hit on Plains).',
    affects: 'self',
    used_by: 'Commander',
    tags: ['passive', 'human', 'movement'],
  },
  'Canopy Lanes': {
    type: 'Passive',
    cost: 'Passive',
    description:
      'Scout and Stealth units in your army beginning activation inside Command Radius gain +1 Move.',
    affects: 'self',
    used_by: 'Commander',
    tags: ['passive', 'elf', 'movement'],
  },
  'Starlit Stride': {
    type: 'Passive',
    cost: 'Passive',
    description:
      'Flying and Scout units in your army beginning activation inside Command Radius gain +1 Move.',
    affects: 'self',
    used_by: 'Commander',
    tags: ['passive', 'elf', 'movement'],
  },
  'Grove Lattice': {
    type: 'Passive',
    cost: 'Passive',
    description:
      'Nature units in your army within Command Radius in Forest gain +1 Toughness.',
    affects: 'self',
    used_by: 'Commander',
    tags: ['passive', 'elf', 'nature'],
  },
  'Summit Currents': {
    type: 'Passive',
    cost: 'Passive',
    description:
      'Amphibious units in your army beginning activation inside Command Radius gain +1 Move.',
    affects: 'self',
    used_by: 'Commander',
    tags: ['passive', 'lizardman', 'movement'],
  },
  'Regen Paths': {
    type: 'Passive',
    cost: 'Passive',
    description:
      'Beast units in your army beginning activation inside Command Radius gain +1 Move and Woodwalker (+1 Hit in Forest).',
    affects: 'self',
    used_by: 'Commander',
    tags: ['passive', 'lizardman', 'movement'],
  },
  'Infernal Heat': {
    type: 'Passive',
    cost: 'Passive',
    description:
      'Demon units in your army gain +1 Damage while adjacent to a damaged unit (friendly or enemy).',
    affects: 'self',
    used_by: 'Commander',
    tags: ['passive', 'demon', 'offense'],
  },
  'Torment Lattice': {
    type: 'Passive',
    cost: 'Passive',
    description:
      'Demon units in your army within Command Radius gain +1 Hit against enemies with Fear.',
    affects: 'self',
    used_by: 'Commander',
    tags: ['passive', 'demon', 'fear'],
  },
  'Forge Dominion': {
    type: 'Passive',
    cost: 'Passive',
    description: 'Fire units in your army within Command Radius gain +1 Damage.',
    affects: 'self',
    used_by: 'Commander',
    tags: ['passive', 'demon', 'fire'],
  },
  'Holdfast Doctrine': {
    type: 'Passive',
    cost: 'Passive',
    description: 'Dwarf units in your army on Hills within Command Radius gain Harden 1.',
    affects: 'self',
    used_by: 'Commander',
    tags: ['passive', 'dwarf', 'defense'],
  },
  'Siege Sync': {
    type: 'Passive',
    cost: 'Passive',
    description:
      'Siege units in your army within Command Radius adjacent to a friendly non-Siege unit gain +1 Hit.',
    affects: 'self',
    used_by: 'Commander',
    tags: ['passive', 'dwarf', 'siege'],
  },
  'Oath Anvil': {
    type: 'Passive',
    cost: 'Passive',
    description: 'Heavy Dwarf units in your army within Command Radius gain +1 Toughness.',
    affects: 'self',
    used_by: 'Commander',
    tags: ['passive', 'dwarf', 'defense'],
  },
  'Basilisk Ward': {
    type: 'Passive',
    cost: 'Passive',
    description:
      'Enemies adjacent to two or more Lizardman units in your army within Command Radius suffer −1 Hit on attacks.',
    affects: 'self',
    used_by: 'Commander',
    tags: ['passive', 'lizardman', 'control'],
  },
  'Repair Rites': {
    type: 'Passive',
    cost: 'Passive',
    description:
      'When you restore Toughness to a Construct in your army within Command Radius, restore 1 additional Toughness.',
    affects: 'self',
    used_by: 'Commander',
    tags: ['passive', 'construct', 'support'],
  },
  'Gear Grease': {
    type: 'Passive',
    cost: 'Passive',
    description:
      'Construct units in your army beginning activation inside Command Radius gain +1 Move.',
    affects: 'self',
    used_by: 'Commander',
    tags: ['passive', 'construct', 'movement'],
  },
  'Directive Tempo': {
    type: 'Passive',
    cost: 'Passive',
    description:
      'Construct units in your army gain +1 Move on their first activation each round while inside Command Radius.',
    affects: 'self',
    used_by: 'Commander',
    tags: ['passive', 'construct', 'movement'],
  },
  Ashwind: {
    type: 'Passive',
    cost: 'Passive',
    description:
      'Once per activation, a Demon unit in your army that destroys an enemy inside Command Radius may Move 1.',
    affects: 'self',
    used_by: 'Commander',
    tags: ['passive', 'demon', 'movement'],
  },
  'Kindred Flightpaths': {
    type: 'Passive',
    cost: 'Passive',
    description:
      'Dragon and Flying units in your army beginning activation inside Command Radius gain +1 Move.',
    affects: 'self',
    used_by: 'Commander',
    tags: ['passive', 'dragon', 'movement'],
  },
  'Hoard Routes': {
    type: 'Passive',
    cost: 'Passive',
    description:
      'Dragon units in your army beginning activation inside Command Radius gain Ashborn (+1 Hit on Volcanic).',
    affects: 'self',
    used_by: 'Commander',
    tags: ['passive', 'dragon', 'movement'],
  },
  'Vector March': {
    type: 'Passive',
    cost: 'Passive',
    description:
      'Construct units in your army beginning activation inside Command Radius gain Open Ground (+1 Hit on Plains).',
    affects: 'self',
    used_by: 'Commander',
    tags: ['passive', 'construct', 'movement'],
  },
}

const CARD_SWAPS = {
  'Hearthstone Covenant': {
    remove: ['Human Compact'],
    add: ['Hearth Roads'],
  },
  'Thunderhoof Caller': {
    remove: ['Human Compact', 'Disciplined Advance'],
    add: ['Open Ground'],
  },
  'Iron Covenant Spear': {
    remove: ['Human Compact', 'Inspiring Presence'],
    add: ['Spearpoint Advance'],
  },
  'Whispercanopy Huntress': {
    remove: ['Elf Compact', 'Inspiring Presence'],
    add: ['Canopy Lanes'],
  },
  'Rootweave Mystic': { remove: ['Elf Compact'], add: ['Grove Lattice'] },
  'Starfall Huntress': {
    remove: ['Elf Compact', 'Inspiring Presence'],
    add: ['Starlit Stride'],
  },
  'Brimstone Herald': { remove: ['Demon Compact'], add: ['Infernal Heat'] },
  'Voidclaw Tormentor': { remove: ['Demon Compact'], add: ['Torment Lattice'] },
  'Doomforge Tyrant': { remove: ['Demon Compact'], add: ['Forge Dominion'] },
  'Hold-Lord Granite': { remove: ['Dwarf Compact'], add: ['Holdfast Doctrine'] },
  'Forge-Marshal Flintpick': { remove: ['Dwarf Compact'], add: ['Siege Sync'] },
  'Anvil-Thane Korrik': { remove: ['Dwarf Compact'], add: ['Oath Anvil'] },
  'Scalefen Summit': {
    remove: ['Lizardman Compact', 'Inspiring Presence'],
    add: ['Summit Currents'],
  },
  'Hydra Broodmother': {
    remove: ['Lizardman Compact', 'Disciplined Advance'],
    add: ['Regen Paths'],
  },
  'Gorgon Basalt Matriarch': {
    remove: ['Lizardman Compact'],
    add: ['Basilisk Ward'],
  },
  'Rebuild Core Sigma': { remove: ['Construct Compact'], add: ['Repair Rites'] },
  'Barrage Mind Helix': { remove: ['Construct Compact'], add: ['Gear Grease'] },
  'Prime Directive Core': {
    remove: ['Inspiring Presence'],
    add: ['Directive Tempo'],
  },
  'Ashen Blood Sovereign': { remove: ['Inspiring Presence'], add: ['Ashwind'] },
  'Kindred Tyrant': {
    remove: ['Inspiring Presence'],
    add: ['Kindred Flightpaths'],
  },
  'Hoard Sovereign Khar': { remove: ['Inspiring Presence'], add: ['Hoard Routes'] },
  'Null Architect Void': { remove: ['Inspiring Presence'], add: ['Vector March'] },
}

function appendAbilities() {
  let text = fs.readFileSync(abPath, 'utf8')
  let added = 0
  for (const [name, spec] of Object.entries(NEW_ABILITIES)) {
    if (text.includes(`${name}:`)) continue
    if (spec.description.length > 175) {
      throw new Error(`${name} description too long: ${spec.description.length}`)
    }
    let block = `\n${name}:\n  type: ${spec.type}\n  cost: ${spec.cost}\n  description: ${spec.description}\n  affects: ${spec.affects}\n  used_by: ${spec.used_by}\n  tags:\n`
    for (const tag of spec.tags) block += `    - ${tag}\n`
    text = `${text.trimEnd()}${block}`
    added += 1
    console.log('ability +', name)
  }
  if (added) fs.writeFileSync(abPath, `${text}\n`)
  else console.log('abilities already present')
}

function swapAbilities(list, remove, add) {
  let next = list.filter((a) => !remove.includes(a))
  for (const a of add) {
    if (!next.includes(a)) next.push(a)
  }
  return next
}

function updateCommanders() {
  const folders = fs
    .readdirSync(path.join(KB, 'cards'))
    .filter((d) => fs.existsSync(path.join(KB, 'cards', d, 'commanders.yaml')))

  for (const folder of folders) {
    const file = path.join(KB, 'cards', folder, 'commanders.yaml')
    const doc = yaml.load(fs.readFileSync(file, 'utf8'))
    let changed = false
    for (const card of doc.cards || []) {
      const keeper = COMPACT_KEEPERS[card.race]
      const compact = `${card.race === 'Construct' ? 'Construct' : card.race === 'Lizardman' ? 'Lizardman' : card.race === 'Beastfolk' ? 'Beastfolk' : card.race} Compact`
      const hasCompact = (card.abilities || []).some((a) => a.endsWith(' Compact'))
      if (hasCompact && card.name !== keeper) {
        console.warn('unexpected compact', card.name, '- expected explicit swap entry')
      }
      const spec = CARD_SWAPS[card.name]
      if (spec) {
        const before = [...(card.abilities || [])]
        card.abilities = swapAbilities(before, spec.remove, spec.add)
        if (JSON.stringify(before) !== JSON.stringify(card.abilities)) {
          console.log(
            card.name,
            ':',
            spec.remove.join(', '),
            '→',
            spec.add.join(', '),
          )
          changed = true
        }
      }
    }
    if (changed) {
      fs.writeFileSync(
        file,
        yaml.dump(doc, { lineWidth: 100, noRefs: true, quotingType: '"' }),
      )
    }
  }
}

appendAbilities()
updateCommanders()

// Verify: at most one Compact per race
const violations = []
for (const folder of fs
  .readdirSync(path.join(KB, 'cards'))
  .filter((d) => fs.existsSync(path.join(KB, 'cards', d, 'commanders.yaml')))) {
  const doc = yaml.load(
    fs.readFileSync(path.join(KB, 'cards', folder, 'commanders.yaml'), 'utf8'),
  )
  const byRace = new Map()
  for (const card of doc.cards || []) {
    for (const a of card.abilities || []) {
      if (!a.endsWith(' Compact')) continue
      const list = byRace.get(card.race) || []
      list.push(card.name)
      byRace.set(card.race, list)
    }
  }
  for (const [race, names] of byRace) {
    if (names.length > 1) violations.push(`${race}: ${names.join(', ')}`)
  }
}
if (violations.length) {
  console.error('Compact violations:', violations)
  process.exit(1)
}
console.log('\nCompact keepers:', COMPACT_KEEPERS)
console.log('Done.')
