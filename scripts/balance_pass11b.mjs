/**
 * Balance pass 11b: correct pass-11 commander UV overshoot.
 * Revert UV âˆ’1 on weak commanders (cheaper deploy hurt race win%).
 * Buff strong/borderline commanders + extra Construct soft nerf.
 * balance_rev >= 19.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('data/cards')
const REV = 19

const changes = []

/** Revert pass-11 weak-commander UV trims (balance_rev 18) */
const REVERT_CMD_UV = new Set([
  'Iron Covenant Spear',
  'Thunderhoof Caller',
  'Cataclysm Elder Pyrr',
  'Doomforge Tyrant',
  'Voidclaw Tormentor',
])

/** Strong / mid commanders â€” cheaper deploy helps race floor */
const HUMAN_CMD_UV = new Set(['Realmward High Marshal'])
const DRAGON_CMD_UV = new Set(['Kindred Tyrant'])
const DEMON_CMD_UV = new Set(['Brimstone Herald'])

/** Extra core line durability */
const HUMAN_UNIT = { 'Oathbill Halberdiers': { toughness: 1 } }
const DRAGON_UNIT = { 'Stormwing Elite': { toughness: 1 } }
const DEMON_UNIT = { 'Ashwrought Berserker': { toughness: 1 } }

/** Construct â€” additional soft nerf */
const CONSTRUCT_CMD_UV_BUMP = new Set(['Null Architect Void'])
const CONSTRUCT_OFFICER_UV_BUMP = new Set(['Overdrive Chief Spark'])

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

function applyUnitMap(card, map) {
  const spec = map[card.name]
  if (!spec) return false
  let ch = false
  for (const [field, amount] of Object.entries(spec)) {
    const min = field === 'toughness' ? 1 : 1
    const max = field === 'toughness' ? 7 : 99
    const before = card[field]
    if (bump(card, field, amount, min, max)) {
      ch = true
      log(card, `${field[0].toUpperCase()}${field.slice(1)} ${before}â†’${card[field]}`)
    }
  }
  return ch
}

function revertWeakCmd(card) {
  if (card.card_type !== 'Commander' || !REVERT_CMD_UV.has(card.name)) return false
  if ((card.balance_rev || 0) !== 18) return false
  const before = card.uv
  if (!bump(card, 'uv', 1, 1)) return false
  card.balance_rev = REV
  log(card, `UV ${before}â†’${card.uv} (revert 11)`)
  return true
}

function tuneConstruct(card) {
  let ch = false
  if (card.card_type === 'Commander' && CONSTRUCT_CMD_UV_BUMP.has(card.name)) {
    const before = card.uv
    if (bump(card, 'uv', 1, 1)) {
      ch = true
      log(card, `UV ${before}â†’${card.uv}`)
    }
  } else if (card.card_type === 'Officer' && CONSTRUCT_OFFICER_UV_BUMP.has(card.name)) {
    const before = card.uv
    if (bump(card, 'uv', 1, 1)) {
      ch = true
      log(card, `UV ${before}â†’${card.uv}`)
    }
  }
  return ch
}

function tuneHuman(card) {
  let ch = false
  if (card.card_type === 'Commander' && HUMAN_CMD_UV.has(card.name)) {
    const before = card.uv
    if (bump(card, 'uv', -1, 1)) {
      ch = true
      log(card, `UV ${before}â†’${card.uv}`)
    }
  } else if (card.card_type === 'Unit') {
    ch = applyUnitMap(card, HUMAN_UNIT)
  }
  return ch
}

function tuneDragon(card) {
  let ch = false
  if (card.card_type === 'Commander' && DRAGON_CMD_UV.has(card.name)) {
    const before = card.uv
    if (bump(card, 'uv', -1, 1)) {
      ch = true
      log(card, `UV ${before}â†’${card.uv}`)
    }
  } else if (card.card_type === 'Unit') {
    ch = applyUnitMap(card, DRAGON_UNIT)
  }
  return ch
}

function tuneDemon(card) {
  let ch = false
  if (card.card_type === 'Commander' && DEMON_CMD_UV.has(card.name)) {
    const before = card.uv
    if (bump(card, 'uv', -1, 1)) {
      ch = true
      log(card, `UV ${before}â†’${card.uv}`)
    }
  } else if (card.card_type === 'Unit') {
    ch = applyUnitMap(card, DEMON_UNIT)
  }
  return ch
}

function tune(card) {
  if (revertWeakCmd(card)) return true
  if ((card.balance_rev || 0) >= REV) return false
  let ch = false
  const race = card.race
  if (race === 'Construct') ch = tuneConstruct(card)
  else if (race === 'Human') ch = tuneHuman(card)
  else if (race === 'Dragon') ch = tuneDragon(card)
  else if (race === 'Demon') ch = tuneDemon(card)
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
for (const race of Object.keys(byRace).sort()) {
  const list = byRace[race]
  console.log(`${race}: ${list.length} changes`)
  for (const c of list) console.log(`  ${c.type} ${c.name}: ${c.note}`)
}
console.log('total', changes.length)
