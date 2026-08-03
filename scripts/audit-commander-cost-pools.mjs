/**
 * Audit commander non-ultimate actives: classify CC (command) vs AP (targeted).
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('C:/Users/keash/Projects/KingdomsBuilder/data')
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

/** Explicit AP = targeted strike/debuff/heal on chosen enemy or ally. */
const FORCE_AP = new Set([
  'Alpha Rush',
  'Arc Discharge',
  'Hellspark',
  'Wyrm Lash',
  'Anvil Strike',
  "Marshal's Shot",
  'Moonbind',
  'Basilisk Glare',
  'Grave Bind',
  'Siege Barrage',
  'Spear Thrust',
  'Forge Mend',
  'Shadow Orb',
  'Snare',
  'Bone Prison',
  'Withering Gaze',
  'Howl',
  'Pack Mark',
  'Alpha Mark',
  'Null Pulse',
  'Focused Assault',
  'Serpent Coil',
  'Entangling Roots',
  'Wing Gust',
  'Ember Mandate',
  'Scorch Decree',
  'Inferno Mandate',
  'Terror Mandate',
  'Magnetic Line',
  'Beast Banner',
  'Beast Haul',
  "Matriarch's Protection",
  'Tactical Withdrawal',
  'Regenerative Surge',
  'Overdrive',
  'Repair Rites',
  'Spectral Strike',
  'Poison Tide',
  'Counterattack',
  'Alpha Howl Call',
  'Decay',
  'Necrotic Bolt',
  "Reaper's Touch",
])

/** Explicit CC = army/CR command orders. */
const FORCE_CC = new Set([
  'Rally',
  'Line Decree',
  'Shield Column',
  'Covenant Drill',
  'Battle Cry',
  'Horn of Advance',
  'Last Stand',
  'Anvil Advance',
  'Holdfast Gate',
  'Cannon Order',
  'Arrowstorm Command',
  'Moonlit Volley',
  'Cinder March',
  'Summit Currents',
  'Directive Tempo',
  'Tribal Cadence',
  'Brood Banner',
  'Scale Aegis',
  'Siege Cadence',
  'Death March',
  'Still March',
  'Dread Wave',
  'Phantom Rally',
  'Gravespan Call',
  'Soul Harvest',
  'Grave Fortify',
  'Blood Lottery',
  'Overwhelming Offensive',
  'Overwhelming Inferno',
  'Hydra Wrath',
  'Kindred Roar',
  'Null Field',
  'Pack Reform',
  'Wild Rush',
  'Gale Reposition',
  'Reposition',
])

function classify(name, desc) {
  if (FORCE_AP.has(name)) return 'AP'
  if (FORCE_CC.has(name)) return 'CC'
  const d = (desc || '').toLowerCase()
  if (/^choose an enemy|^deal \d damage|it is rooted|it gains slow|gains fear\.|restore \d toughness to the most damaged|choose one enemy within|choose an enemy within/.test(d)) {
    return 'AP'
  }
  if (/in your army|allies in command radius|officer|company|generate \d additional company ap|free attack|may make one free|gain \+\d move|units in your army within command radius gain/.test(d)) {
    return 'CC'
  }
  if (/choose one (undead|dragon|construct|friendly)/i.test(desc || '')) return 'AP'
  return null
}

const folders = fs
  .readdirSync(path.join(KB, 'cards'))
  .filter((d) => fs.existsSync(path.join(KB, 'cards', d, 'commanders.yaml')))

const onCommanders = new Map()
for (const folder of folders) {
  const doc = yaml.load(
    fs.readFileSync(path.join(KB, 'cards', folder, 'commanders.yaml'), 'utf8'),
  )
  for (const card of doc.cards || []) {
    for (const name of card.abilities || []) {
      const def = abilities[name]
      if (!def || !isActive(def)) continue
      if (!onCommanders.has(name)) {
        onCommanders.set(name, {
          name,
          current: (def.cost_resource || '').trim().toUpperCase(),
          cost: def.cost,
          amount: def.cost_amount,
          desc: def.description,
          commanders: [],
        })
      }
      onCommanders.get(name).commanders.push(`${card.name} (${card.race})`)
    }
  }
}

const rows = [...onCommanders.values()].sort((a, b) => a.name.localeCompare(b.name))
const mismatches = []

console.log('=== COMMANDER ACTIVES AUDIT ===\n')
console.log('Ability | Current | Should | Commanders')
for (const r of rows) {
  const should = classify(r.name, r.desc) || r.current
  const flag = should !== r.current ? ' ***' : ''
  if (flag) mismatches.push({ ...r, should })
  console.log(
    `${r.name} | ${r.current} (${r.cost}) | ${should}${flag} | ${r.commanders.slice(0, 2).join('; ')}${r.commanders.length > 2 ? '…' : ''}`,
  )
}

console.log(`\nTotal: ${rows.length}, mismatches: ${mismatches.length}`)
if (mismatches.length) {
  console.log('\n=== MISMATCHES ===')
  for (const m of mismatches) {
    console.log(`${m.name}: ${m.current} → ${m.should}`)
    console.log(`  ${m.desc?.slice(0, 100)}`)
  }
}
