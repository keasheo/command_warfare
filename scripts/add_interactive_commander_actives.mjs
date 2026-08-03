/**
 * Add fun interactive commander actives (damage, CC, targeted buffs) and assign
 * them to kits that lacked punch (Rally / Move-only heavy).
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('data')
const abPath = path.join(KB, 'abilities.yaml')

/** New commander actives (description â‰¤175 chars). */
const NEW_ABILITIES = {
  'Alpha Rush': {
    type: 'Active',
    cost: '2 CC',
    cost_amount: 2,
    cost_resource: 'CC',
    description:
      'Choose an enemy within 3 hexes. Deal 2 damage to it. If a Beast ally is adjacent to that enemy, it gains Fear.',
    affects: 'single',
    used_by: 'Commander',
    cooldown: 2,
    tags: ['beastfolk', 'damage', 'fear'],
  },
  'Arc Discharge': {
    type: 'Active',
    cost: '2 CC',
    cost_amount: 2,
    cost_resource: 'CC',
    description: 'Deal 2 damage to an enemy within 6 hexes in Command Radius.',
    affects: 'single',
    used_by: 'Commander',
    cooldown: 2,
    tags: ['construct', 'damage'],
  },
  Hellspark: {
    type: 'Active',
    cost: '2 CC',
    cost_amount: 2,
    cost_resource: 'CC',
    description:
      'Deal 2 damage to an enemy in Command Radius. If it survives, it gains Fear.',
    affects: 'single',
    used_by: 'Commander',
    cooldown: 2,
    tags: ['demon', 'damage', 'fear'],
  },
  'Wyrm Lash': {
    type: 'Active',
    cost: '2 CC',
    cost_amount: 2,
    cost_resource: 'CC',
    description:
      'Deal 2 damage to an enemy within 4 hexes. Dragon allies in Command Radius gain +1 Damage this round.',
    affects: 'single',
    used_by: 'Commander',
    cooldown: 2,
    tags: ['dragon', 'damage'],
  },
  'Anvil Strike': {
    type: 'Active',
    cost: '2 CC',
    cost_amount: 2,
    cost_resource: 'CC',
    description:
      'Deal 2 damage to an enemy in Command Radius. Siege allies in Command Radius gain +1 Damage this round.',
    affects: 'single',
    used_by: 'Commander',
    cooldown: 2,
    tags: ['dwarf', 'damage'],
  },
  "Marshal's Shot": {
    type: 'Active',
    cost: '2 CC',
    cost_amount: 2,
    cost_resource: 'CC',
    description:
      'Deal 2 damage to an enemy within 6 hexes. Infantry allies in Command Radius gain Harden 1.',
    affects: 'single',
    used_by: 'Commander',
    cooldown: 2,
    tags: ['human', 'damage'],
  },
  Moonbind: {
    type: 'Active',
    cost: '2 CC',
    cost_amount: 2,
    cost_resource: 'CC',
    description:
      'Choose an enemy within 4 hexes. It gains Slow and âˆ’1 Damage until round refresh.',
    affects: 'single',
    used_by: 'Commander',
    cooldown: 2,
    tags: ['elf', 'control'],
  },
  'Basilisk Glare': {
    type: 'Active',
    cost: '2 CC',
    cost_amount: 2,
    cost_resource: 'CC',
    description:
      'Choose an enemy within 3 hexes in Command Radius. It is Rooted until round refresh.',
    affects: 'single',
    used_by: 'Commander',
    cooldown: 2,
    tags: ['lizardman', 'control'],
  },
  'Grave Bind': {
    type: 'Active',
    cost: '2 CC',
    cost_amount: 2,
    cost_resource: 'CC',
    description:
      'Choose an enemy within 3 hexes in Command Radius. It is Rooted until round refresh.',
    affects: 'single',
    used_by: 'Commander',
    cooldown: 2,
    tags: ['undead', 'control'],
  },
  'Siege Barrage': {
    type: 'Active',
    cost: '2 CC',
    cost_amount: 2,
    cost_resource: 'CC',
    description: 'Deal 1 damage to up to two enemies in Command Radius.',
    affects: 'self',
    used_by: 'Commander',
    cooldown: 2,
    tags: ['construct', 'damage'],
  },
  'Spear Thrust': {
    type: 'Active',
    cost: '2 CC',
    cost_amount: 2,
    cost_resource: 'CC',
    description:
      'Choose an enemy within 3 hexes. Deal 2 damage. Infantry allies adjacent to that enemy gain +1 Damage this round.',
    affects: 'single',
    used_by: 'Commander',
    cooldown: 2,
    tags: ['human', 'damage'],
  },
  'Forge Mend': {
    type: 'Active',
    cost: '1 CC',
    cost_amount: 1,
    cost_resource: 'CC',
    description:
      'Restore 2 Toughness to the most damaged Siege or Dwarf ally in Command Radius and grant Harden 1.',
    affects: 'single',
    used_by: 'Commander',
    cooldown: 2,
    tags: ['dwarf', 'support'],
  },
}

/** Commander â†’ ability to add (skip if already present). */
const COMMANDER_ADDS = {
  'High Alpha of Tribes': ['Alpha Rush'],
  'Prime Directive Core': ['Arc Discharge'],
  'Ashen Blood Sovereign': ['Hellspark'],
  'Kindred Tyrant': ['Wyrm Lash'],
  'Thane of All Holds': ['Anvil Strike'],
  'Realmward High Marshal': ["Marshal's Shot"],
  'Green Court Sovereign': ['Moonbind'],
  'Scalefen Summit': ['Basilisk Glare'],
  'Lord of the Still Host': ['Grave Bind'],
  'Barrage Mind Helix': ['Siege Barrage'],
  'Iron Covenant Spear': ['Spear Thrust'],
  'Forge-Marshal Flintpick': ['Forge Mend'],
}

function appendAbilities() {
  let text = fs.readFileSync(abPath, 'utf8')
  let added = 0
  for (const [name, spec] of Object.entries(NEW_ABILITIES)) {
    if (text.includes(`${name}:`)) {
      console.log('ability exists:', name)
      continue
    }
    if (spec.description.length > 175) {
      throw new Error(`${name} description too long: ${spec.description.length}`)
    }
    let block = `\n${name}:\n  type: ${spec.type}\n  cost: ${spec.cost}\n  description: ${spec.description}\n  affects: ${spec.affects}\n  cost_amount: ${spec.cost_amount}\n  cost_resource: ${spec.cost_resource}\n  used_by: ${spec.used_by}\n  cooldown: ${spec.cooldown}\n  tags:\n`
    for (const tag of spec.tags) block += `    - ${tag}\n`
    text = `${text.trimEnd()}${block}`
    added++
    console.log('ability +', name)
  }
  if (added) fs.writeFileSync(abPath, `${text}\n`)
  return added
}

function updateCommanders() {
  const folders = fs
    .readdirSync(path.join(KB, 'cards'))
    .filter((d) => fs.existsSync(path.join(KB, 'cards', d, 'commanders.yaml')))

  let changed = 0
  for (const folder of folders) {
    const file = path.join(KB, 'cards', folder, 'commanders.yaml')
    const doc = yaml.load(fs.readFileSync(file, 'utf8'))
    let fileChanged = false
    for (const card of doc.cards || []) {
      const adds = COMMANDER_ADDS[card.name]
      if (!adds) continue
      const before = [...(card.abilities || [])]
      for (const a of adds) {
        if (!card.abilities.includes(a)) card.abilities.push(a)
      }
      if (JSON.stringify(before) !== JSON.stringify(card.abilities)) {
        console.log(card.name, 'â†’', adds.join(', '))
        fileChanged = true
        changed++
      }
    }
    if (fileChanged) {
      fs.writeFileSync(
        file,
        yaml.dump(doc, { lineWidth: 100, noRefs: true, quotingType: '"' }),
      )
    }
  }
  return changed
}

appendAbilities()
updateCommanders()
console.log('Done.')
