/**
 * Balance pass 10e: surgical floor lift for Human / Lizardman / Beastfolk /
 * Undead / Dragon; soft Demon commander nerf only. balance_rev >= 14.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('C:/Users/keash/Projects/KingdomsBuilder/data/cards')
const REV = 14

const changes = []

/** Human — +0.1pp nudge */
const HUMAN_CMD_UV = new Set(['Hearthstone Covenant'])

/** Lizardman — deploy + line durability */
const LIZ_CMD_UV = new Set(['Scalefen Summit'])
const LIZ_UNIT = {
  'Chameleon Warden': { toughness: 1 },
}

/** Beastfolk — commander deploy + elite punch */
const BEAST_CMD_UV = new Set(['Wild Hunt Lord'])
const BEAST_UNIT = {
  'Blood Moon Chosen': { toughness: 1 },
}

/** Undead — economy + common line */
const UNDEAD_CMD_UV = new Set(['Gravemind Orth'])
const UNDEAD_UNIT = {
  'Marrow Crossbows': { uv: -1 },
}

/** Dragon — biggest shortfall: commander + core line */
const DRAGON_CMD_UV = new Set(['Sky Tyrant Vexis'])
const DRAGON_UNIT = {
  'Bipedal Champion': { toughness: 1 },
  'Clutch Flamebows': { uv: -1 },
}

/** Demon — soft nerf, one commander only */
const DEMON_CMD_UV_BUMP = new Set(['Ashen Blood Sovereign'])

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
    const min = field === 'toughness' ? 1 : field === 'damage' ? 1 : 1
    const max = field === 'toughness' ? 7 : field === 'damage' ? 6 : 99
    const before = card[field]
    if (bump(card, field, amount, min, max)) {
      ch = true
      log(card, `${field === 'uv' ? 'UV' : field[0].toUpperCase()} ${before}→${card[field]}`)
    }
  }
  return ch
}

function tuneHuman(card) {
  if (card.card_type === 'Commander' && HUMAN_CMD_UV.has(card.name) && bump(card, 'uv', -1, 1)) {
    log(card, `UV→${card.uv}`)
    return true
  }
  return false
}

function tuneLizardman(card) {
  let ch = false
  if (card.card_type === 'Commander' && LIZ_CMD_UV.has(card.name) && bump(card, 'uv', -1, 1)) {
    ch = true
    log(card, `UV→${card.uv}`)
  } else if (card.card_type === 'Unit') ch = applyUnitMap(card, LIZ_UNIT)
  return ch
}

function tuneBeastfolk(card) {
  let ch = false
  if (card.card_type === 'Commander' && BEAST_CMD_UV.has(card.name) && bump(card, 'uv', -1, 1)) {
    ch = true
    log(card, `UV→${card.uv}`)
  } else if (card.card_type === 'Unit') ch = applyUnitMap(card, BEAST_UNIT)
  return ch
}

function tuneUndead(card) {
  let ch = false
  if (card.card_type === 'Commander' && UNDEAD_CMD_UV.has(card.name) && bump(card, 'uv', -1, 1)) {
    ch = true
    log(card, `UV→${card.uv}`)
  } else if (card.card_type === 'Unit') ch = applyUnitMap(card, UNDEAD_UNIT)
  return ch
}

function tuneDragon(card) {
  let ch = false
  if (card.card_type === 'Commander' && DRAGON_CMD_UV.has(card.name) && bump(card, 'uv', -1, 1)) {
    ch = true
    log(card, `UV→${card.uv}`)
  } else if (card.card_type === 'Unit') ch = applyUnitMap(card, DRAGON_UNIT)
  return ch
}

function tuneDemon(card) {
  if (card.card_type === 'Commander' && DEMON_CMD_UV_BUMP.has(card.name) && bump(card, 'uv', 1, 1)) {
    log(card, `UV→${card.uv}`)
    return true
  }
  return false
}

function tune(card) {
  if ((card.balance_rev || 0) >= REV) return false
  let ch = false
  const race = card.race
  if (race === 'Human') ch = tuneHuman(card)
  else if (race === 'Lizardman') ch = tuneLizardman(card)
  else if (race === 'Beastfolk') ch = tuneBeastfolk(card)
  else if (race === 'Undead') ch = tuneUndead(card)
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
