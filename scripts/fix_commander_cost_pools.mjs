/**
 * Fix commander active cost pools: CC for command orders, AP for targeted strikes.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('data')
const abPath = path.join(KB, 'abilities.yaml')

/** ability â†’ { resource, amount?, rationale } */
const POOL_FIXES = {
  'Brood Banner': {
    resource: 'CC',
    amount: 1,
    rationale: 'CR army buff (+Move/+Damage to all Dragons) â€” command order',
  },
  'Entangling Roots': {
    resource: 'AP',
    amount: 3,
    rationale: 'Root/debuff on one chosen enemy â€” targeted CC',
  },
  'Focused Assault': {
    resource: 'AP',
    amount: 2,
    rationale: 'Mark one chosen enemy for focus fire â€” targeted',
  },
  'Null Pulse': {
    resource: 'AP',
    amount: 2,
    rationale: 'Suppress actives on one chosen enemy â€” targeted debuff',
  },
  Overdrive: {
    resource: 'AP',
    amount: 1,
    rationale: 'Buff one chosen Construct â€” targeted ally strike',
  },
  'Pack Reform': {
    resource: 'CC',
    amount: 2,
    rationale: 'Reposition Pack units â€” company command order',
  },
  'Regenerative Surge': {
    resource: 'AP',
    amount: 2,
    rationale: 'Precision heal split among injured allies â€” targeted support',
  },
  'Repair Rites': {
    resource: 'AP',
    amount: 1,
    rationale: 'Heal most damaged Construct/Siege â€” precision repair',
  },
  'Serpent Coil': {
    resource: 'AP',
    amount: 2,
    rationale: 'Root + debuff one chosen enemy â€” targeted CC',
  },
  'Shadow Orb': {
    resource: 'AP',
    amount: 1,
    rationale: 'Snipe 2 damage + Slow on one enemy â€” targeted strike',
  },
  'Spectral Strike': {
    resource: 'AP',
    amount: 1,
    rationale: 'Grant one chosen Undead a precision attack â€” targeted',
  },
  'Poison Tide': {
    resource: 'AP',
    amount: 2,
    rationale: 'Poison up to three chosen enemies â€” targeted debuff',
  },
  'Tactical Withdrawal': {
    resource: 'AP',
    amount: 1,
    rationale: 'Move one chosen unit without ZoC â€” targeted reposition',
  },
  Counterattack: {
    resource: 'AP',
    amount: 2,
    rationale: 'Grant reactive strike to one chosen unit â€” targeted',
  },
}

const doc = yaml.load(fs.readFileSync(abPath, 'utf8'))
const changes = []

for (const [name, fix] of Object.entries(POOL_FIXES)) {
  const cur = doc[name]
  if (!cur) {
    console.error('missing:', name)
    continue
  }
  const oldResource = (cur.cost_resource || '').trim().toUpperCase()
  const oldCost = cur.cost
  const amount = fix.amount ?? cur.cost_amount ?? 1
  const newCost = `${amount} ${fix.resource}`
  if (oldResource === fix.resource && cur.cost_amount === amount) {
    console.log('ok:', name, fix.resource)
    continue
  }
  doc[name] = {
    ...cur,
    cost: newCost,
    cost_amount: amount,
    cost_resource: fix.resource,
  }
  changes.push({
    name,
    old: `${oldResource} (${oldCost})`,
    new: `${fix.resource} (${newCost})`,
    rationale: fix.rationale,
  })
  console.log(`${name}: ${oldResource} â†’ ${fix.resource} (${newCost})`)
}

if (changes.length) {
  fs.writeFileSync(abPath, yaml.dump(doc, { lineWidth: 100, noRefs: true, quotingType: '"' }))
}

console.log('\n=== CHANGES ===')
for (const c of changes) {
  console.log(`${c.name}: ${c.old} â†’ ${c.new}`)
  console.log(`  ${c.rationale}`)
}
console.log(`\nTotal changed: ${changes.length}`)
