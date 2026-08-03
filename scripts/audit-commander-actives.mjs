/**
 * Audit all 36 commanders for non-ultimate active abilities.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('data')
const abPath = path.join(KB, 'abilities.yaml')
const abilities = yaml.load(fs.readFileSync(abPath, 'utf8'))

function isPassive(a) {
  const kind = (a.type || '').trim()
  const cost = (a.cost || '').trim().toLowerCase()
  return kind === 'Passive' || cost === 'passive'
}
function isUltimate(a) {
  const kind = (a.type || '').trim()
  const cost = (a.cost || '').trim().toLowerCase()
  return kind === 'Ultimate' || cost === 'ultimate'
}
function isActive(a) {
  return !isPassive(a) && !isUltimate(a)
}

const RALLY_SOFT = new Set([
  'Rally',
  'Inspire',
  'Inspiring Presence',
  'Disciplined Advance',
  'Covenant Drill',
])

const folders = fs
  .readdirSync(path.join(KB, 'cards'))
  .filter((d) => fs.existsSync(path.join(KB, 'cards', d, 'commanders.yaml')))

const all = []
const zeroActives = []
const softOnly = []

for (const folder of folders) {
  const doc = yaml.load(
    fs.readFileSync(path.join(KB, 'cards', folder, 'commanders.yaml'), 'utf8'),
  )
  for (const card of doc.cards || []) {
    const actives = []
    const passives = []
    const missing = []
    for (const name of card.abilities || []) {
      const def = abilities[name]
      if (!def) {
        missing.push(name)
        continue
      }
      if (isActive(def)) {
        actives.push({
          name,
          cost: def.cost,
          resource: def.cost_resource,
          desc: def.description,
          soft: RALLY_SOFT.has(name),
        })
      } else if (isPassive(def)) {
        passives.push(name)
      }
    }
    const entry = {
      name: card.name,
      race: card.race,
      id: card.id,
      actives,
      passives,
      missing,
      ultimate: card.ultimate,
      activeCount: actives.length,
      distinctActives: actives.filter((a) => !a.soft).length,
    }
    all.push(entry)
    if (actives.length === 0) zeroActives.push(entry)
    else if (actives.every((a) => a.soft)) softOnly.push(entry)
  }
}

console.log('=== COMMANDERS WITH 0 NON-ULTIMATE ACTIVES ===')
for (const c of zeroActives) {
  console.log(
    `${c.race} | ${c.name}\n  passives: ${c.passives.join(', ')}\n  ultimate: ${c.ultimate}`,
  )
}

console.log('\n=== SOFT-ONLY ACTIVES (Rally/Inspire style only) ===')
for (const c of softOnly) {
  console.log(
    `${c.race} | ${c.name} | actives: ${c.actives.map((a) => a.name).join(', ')} | passives: ${c.passives.join(', ')}`,
  )
}

console.log('\n=== ALL COMMANDERS ===')
for (const r of all.sort((a, b) => a.race.localeCompare(b.race) || a.name.localeCompare(b.name))) {
  const activeStr = r.actives.map((a) => `${a.name}(${a.cost})`).join(', ') || 'NONE'
  console.log(
    `${r.race.padEnd(12)} | ${r.name.padEnd(28)} | actives(${r.activeCount}): ${activeStr}`,
  )
}

console.log(`\nTotal: ${all.length}, zero actives: ${zeroActives.length}, soft-only: ${softOnly.length}`)
