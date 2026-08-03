/**
 * Rebalance interactive commander actives per design rule:
 * - CC = command orders (army buffs, CR auras, free attacks, reposition)
 * - AP = targeted damage / enemy CC / precise heals
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('data')
const abPath = path.join(KB, 'abilities.yaml')

/** Retarget existing actives: AP for strikes/debuffs, simplified text. */
const PATCH_ABILITIES = {
  'Alpha Rush': {
    cost: '2 AP',
    cost_amount: 2,
    cost_resource: 'AP',
    description:
      'Choose an enemy within 3 hexes. Deal 2 damage to it. If a Beast ally is adjacent to that enemy, it gains Fear.',
    tags: ['beastfolk', 'damage', 'fear'],
  },
  'Arc Discharge': {
    cost: '2 AP',
    cost_amount: 2,
    cost_resource: 'AP',
    description: 'Deal 2 damage to an enemy within 6 hexes in Command Radius.',
    tags: ['construct', 'damage'],
  },
  Hellspark: {
    cost: '2 AP',
    cost_amount: 2,
    cost_resource: 'AP',
    description:
      'Deal 2 damage to an enemy in Command Radius. If it survives, it gains Fear.',
    tags: ['demon', 'damage', 'fear'],
  },
  'Wyrm Lash': {
    cost: '2 AP',
    cost_amount: 2,
    cost_resource: 'AP',
    description: 'Deal 2 damage to an enemy within 4 hexes in Command Radius.',
    tags: ['dragon', 'damage'],
  },
  'Anvil Strike': {
    cost: '2 AP',
    cost_amount: 2,
    cost_resource: 'AP',
    description: 'Deal 2 damage to an enemy in Command Radius.',
    tags: ['dwarf', 'damage'],
  },
  "Marshal's Shot": {
    cost: '2 AP',
    cost_amount: 2,
    cost_resource: 'AP',
    description: 'Deal 2 damage to an enemy within 6 hexes in Command Radius.',
    tags: ['human', 'damage'],
  },
  Moonbind: {
    cost: '1 AP',
    cost_amount: 1,
    cost_resource: 'AP',
    description:
      'Choose an enemy within 4 hexes. It gains Slow and âˆ’1 Damage until round refresh.',
    tags: ['elf', 'control'],
  },
  'Basilisk Glare': {
    cost: '1 AP',
    cost_amount: 1,
    cost_resource: 'AP',
    description:
      'Choose an enemy within 3 hexes in Command Radius. It is Rooted until round refresh.',
    tags: ['lizardman', 'control'],
  },
  'Grave Bind': {
    cost: '1 AP',
    cost_amount: 1,
    cost_resource: 'AP',
    description:
      'Choose an enemy within 3 hexes in Command Radius. It is Rooted until round refresh.',
    tags: ['undead', 'control'],
  },
  'Siege Barrage': {
    cost: '2 AP',
    cost_amount: 2,
    cost_resource: 'AP',
    description: 'Deal 1 damage to up to two enemies in Command Radius.',
    tags: ['construct', 'damage'],
  },
  'Spear Thrust': {
    cost: '2 AP',
    cost_amount: 2,
    cost_resource: 'AP',
    description: 'Choose an enemy within 3 hexes. Deal 2 damage to it.',
    tags: ['human', 'damage'],
  },
  'Forge Mend': {
    cost: '1 AP',
    cost_amount: 1,
    cost_resource: 'AP',
    description:
      'Restore 2 Toughness to the most damaged Siege or Dwarf ally in Command Radius.',
    tags: ['dwarf', 'support'],
  },
}

/** New CC command abilities where a hybrid was split into AP + command. */
const NEW_CC_ABILITIES = {
  'Kindred Roar': {
    type: 'Active',
    cost: '1 CC',
    cost_amount: 1,
    cost_resource: 'CC',
    description:
      'Dragon allies in Command Radius gain +1 Damage and Harden 1 this round.',
    affects: 'self',
    used_by: 'Commander',
    cooldown: 2,
    tags: ['dragon', 'command'],
    commanders: ['Kindred Tyrant'],
  },
}

function patchAbilities(doc) {
  let changed = 0
  for (const [name, spec] of Object.entries(PATCH_ABILITIES)) {
    const cur = doc[name]
    if (!cur) {
      console.error('missing', name)
      continue
    }
    if (spec.description.length > 175) {
      throw new Error(`${name} too long: ${spec.description.length}`)
    }
    doc[name] = {
      ...cur,
      type: 'Active',
      cost: spec.cost,
      cost_amount: spec.cost_amount,
      cost_resource: spec.cost_resource,
      description: spec.description,
      tags: spec.tags,
    }
    console.log('patched â†’', spec.cost_resource, name)
    changed++
  }
  return changed
}

function appendNewAbilities(doc) {
  let added = 0
  for (const [name, spec] of Object.entries(NEW_CC_ABILITIES)) {
    if (doc[name]) {
      console.log('exists:', name)
      continue
    }
    if (spec.description.length > 175) {
      throw new Error(`${name} too long: ${spec.description.length}`)
    }
    doc[name] = {
      type: spec.type,
      cost: spec.cost,
      description: spec.description,
      affects: spec.affects,
      cost_amount: spec.cost_amount,
      cost_resource: spec.cost_resource,
      used_by: spec.used_by,
      cooldown: spec.cooldown,
      tags: spec.tags,
    }
    console.log('new CC +', name, 'â†’', spec.commanders.join(', '))
    added++
  }
  return added
}

function assignCcAbilities() {
  const byCommander = new Map()
  for (const [name, spec] of Object.entries(NEW_CC_ABILITIES)) {
    for (const cmd of spec.commanders) {
      const list = byCommander.get(cmd) || []
      list.push(name)
      byCommander.set(cmd, list)
    }
  }

  const folders = fs
    .readdirSync(path.join(KB, 'cards'))
    .filter((d) => fs.existsSync(path.join(KB, 'cards', d, 'commanders.yaml')))

  for (const folder of folders) {
    const file = path.join(KB, 'cards', folder, 'commanders.yaml')
    const doc = yaml.load(fs.readFileSync(file, 'utf8'))
    let changed = false
    for (const card of doc.cards || []) {
      const adds = byCommander.get(card.name)
      if (!adds) continue
      for (const a of adds) {
        if (!card.abilities.includes(a)) {
          card.abilities.push(a)
          console.log('assign', card.name, 'â†', a)
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

const doc = yaml.load(fs.readFileSync(abPath, 'utf8'))
patchAbilities(doc)
appendNewAbilities(doc)
fs.writeFileSync(abPath, yaml.dump(doc, { lineWidth: 100, noRefs: true, quotingType: '"' }))
assignCcAbilities()
console.log('Done.')
