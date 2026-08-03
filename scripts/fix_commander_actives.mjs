/**
 * Convert generic commander passives (from diversify pass) into thematic actives
 * for kits that lacked distinct non-ultimate actives.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('C:/Users/keash/Projects/KingdomsBuilder/data')
const abPath = path.join(KB, 'abilities.yaml')

/** Passive → Active conversions (same name, new spend + cast text). */
const CONVERT_TO_ACTIVE = {
  'Directive Tempo': {
    type: 'Active',
    cost: '1 CC',
    cost_amount: 1,
    cost_resource: 'CC',
    description:
      'Construct units in your army in Command Radius gain +1 Move this activation.',
    affects: 'self',
    used_by: 'Commander',
    cooldown: 2,
    tags: ['construct', 'movement'],
    commanders: ['Prime Directive Core'],
  },
  'Summit Currents': {
    type: 'Active',
    cost: '1 CC',
    cost_amount: 1,
    cost_resource: 'CC',
    description:
      'Amphibious units in your army in Command Radius gain +1 Move this activation.',
    affects: 'self',
    used_by: 'Commander',
    cooldown: 2,
    tags: ['lizardman', 'movement'],
    commanders: ['Scalefen Summit'],
  },
  'Repair Rites': {
    type: 'Active',
    cost: '1 CC',
    cost_amount: 1,
    cost_resource: 'CC',
    description:
      'Restore 3 Toughness to the most damaged Construct or Siege in your army in Command Radius.',
    affects: 'single',
    used_by: 'Commander',
    cooldown: 2,
    tags: ['construct', 'support'],
    commanders: ['Rebuild Core Sigma'],
  },
}

function patchAbilities() {
  const doc = yaml.load(fs.readFileSync(abPath, 'utf8'))
  let changed = 0
  for (const [name, spec] of Object.entries(CONVERT_TO_ACTIVE)) {
    const cur = doc[name]
    if (!cur) {
      console.error('missing ability', name)
      continue
    }
    if (cur.type === 'Active' && cur.cost_resource === 'CC') {
      console.log('already active:', name)
      continue
    }
    if (spec.description.length > 175) {
      throw new Error(`${name} description too long: ${spec.description.length}`)
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
    console.log('converted → active:', name, '→', spec.commanders.join(', '))
    changed++
  }
  if (changed) {
    fs.writeFileSync(abPath, yaml.dump(doc, { lineWidth: 100, noRefs: true, quotingType: '"' }))
  }
  return changed
}

patchAbilities()
console.log('Done.')
