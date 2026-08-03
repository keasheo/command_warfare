/**
 * Balance pass 9: partial Dragon pass-8 undo (~halfway to mid-pack),
 * slight Construct bump (UV trim + fragile core T/D).
 * Idempotent via balance_rev >= 9.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('data/cards')
const REV = 9

/** Partial undo of pass-8 commander UV bumps */
const DRAGON_CMD_UV = {
  'Kindred Tyrant': -1,
  'Hoard Sovereign Khar': -1,
}

/** Half of pass-8 officer UV +1 reverted */
const DRAGON_OFFICER_UV = new Set([
  'Brood Lieutenant Sath',
  'Eggvault Marshal',
  'Terror Herald Nyx',
  'Wing Captain Aeris',
  'Clutch Marshal Tor',
  'Basalt Scale Captain',
])

/** Half of pass-8 flying UV +1 reverted + D/T restore on key epics */
const DRAGON_UNIT = {
  'Stormwing Elite': { uv: -1 },
  'Ancient Winged Brood': { uv: -1, damage: 1 },
  'Catastrophic Ancient': { uv: -1, damage: 1 },
}

/** Construct officer / line UV trim */
const CONSTRUCT_UV = new Set([
  'Line Binder Rivet',
  'Overdrive Chief Spark',
  'Siege Conductor Bolt',
  'Null Juggernaut',
  'Siege Brain',
])

/** Fragile construct cores â€” +1 T */
const CONSTRUCT_T = new Set(['Overclock Blades', 'Null Juggernaut'])

const changes = []

function bump(card, field, amount, min = 0, max = 99) {
  if (typeof card[field] !== 'number') return false
  const next = Math.min(max, Math.max(min, card[field] + amount))
  if (next === card[field]) return false
  card[field] = next
  return true
}

function log(card, note) {
  changes.push({ race: card.race, type: card.card_type, name: card.name, note })
}

function tuneDragon(card) {
  let ch = false
  const name = card.name

  if (card.card_type === 'Commander' && name in DRAGON_CMD_UV) {
    const before = card.uv
    if (bump(card, 'uv', DRAGON_CMD_UV[name], 1)) {
      ch = true
      log(card, `UV ${before}â†’${card.uv}`)
    }
  } else if (card.card_type === 'Officer' && DRAGON_OFFICER_UV.has(name)) {
    const before = card.uv
    if (bump(card, 'uv', -1, 1)) {
      ch = true
      log(card, `UV ${before}â†’${card.uv}`)
    }
  } else if (card.card_type === 'Unit' && name in DRAGON_UNIT) {
    const spec = DRAGON_UNIT[name]
    if (spec.uv && bump(card, 'uv', spec.uv, 1)) {
      ch = true
      log(card, `UVâ†’${card.uv}`)
    }
    if (spec.damage && bump(card, 'damage', spec.damage, 1)) {
      ch = true
      log(card, `Dâ†’${card.damage}`)
    }
    if (spec.toughness && bump(card, 'toughness', spec.toughness, 1)) {
      ch = true
      log(card, `Tâ†’${card.toughness}`)
    }
  }

  return ch
}

function tuneConstruct(card) {
  let ch = false
  const name = card.name

  if (CONSTRUCT_UV.has(name)) {
    const before = card.uv
    if (bump(card, 'uv', -1, 1)) {
      ch = true
      log(card, `UV ${before}â†’${card.uv}`)
    }
  }

  if (CONSTRUCT_T.has(name) && bump(card, 'toughness', 1, 1, 8)) {
    ch = true
    log(card, `T+1â†’${card.toughness}`)
  }

  return ch
}

function tune(card) {
  if ((card.balance_rev || 0) >= REV) return false
  let ch = false
  if (card.race === 'Dragon') ch = tuneDragon(card)
  else if (card.race === 'Construct') ch = tuneConstruct(card)
  if (ch) card.balance_rev = REV
  return ch
}

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p)
    else if (name.endsWith('.yaml') && name !== 'index.yaml') {
      const doc = yaml.load(fs.readFileSync(p, 'utf8'))
      let n = 0
      for (const c of doc.cards || []) if (tune(c)) n++
      if (n) {
        fs.writeFileSync(p, yaml.dump(doc, { lineWidth: 100, noRefs: true, quotingType: '"' }))
        console.log(path.relative(KB, p), n)
      }
    }
  }
}

walk(KB)

const byRace = {}
for (const c of changes) {
  if (!byRace[c.race]) byRace[c.race] = []
  byRace[c.race].push(c)
}
console.log('\n=== Summary ===')
for (const race of ['Dragon', 'Construct']) {
  const list = byRace[race] || []
  console.log(`${race}: ${list.length} changes`)
  for (const c of list) console.log(`  ${c.type} ${c.name}: ${c.note}`)
}
console.log('total', changes.length)
