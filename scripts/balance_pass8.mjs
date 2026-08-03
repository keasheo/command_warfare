/**
 * Balance pass 8: lift bottom 3 (Undead hardest, Dwarf, Demon), soft-nerf Dragon + Human.
 * High-leverage UV / Damage / Toughness / Reach — idempotent via balance_rev >= 8.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('C:/Users/keash/Projects/KingdomsBuilder/data/cards')
const REV = 8

const BUFF = new Set(['Undead', 'Dwarf', 'Demon'])
const NERF = new Set(['Dragon', 'Human'])

const UNDEAD_CMD_UV_TRIM = new Set([
  'Bone Harvester Mire',
  'Eclipse Lich Vesper',
  'Lord of the Still Host',
])
const DRAGON_CMD_UV_BUMP = new Set(['Hoard Sovereign Khar', 'Kindred Tyrant'])
const HUMAN_CMD_UV_BUMP = new Set(['Realmward High Marshal', 'Iron Covenant Spear'])

const UNDEAD_REACH_NAMES = new Set([
  'Shambling Spears',
  'Pale Militia',
  'Skeleton Levy',
  'Zombie Horde',
  'Chained Dead',
  'Grave Diggers',
  'Crypt Guard',
  'Bone Wolves',
])

const changes = []

function bump(card, field, amount, min = 0, max = 99) {
  if (typeof card[field] !== 'number') return false
  const next = Math.min(max, Math.max(min, card[field] + amount))
  if (next === card[field]) return false
  card[field] = next
  return true
}

function addReach(card) {
  if (!card.keywords) card.keywords = []
  if (card.keywords.includes('Reach')) return false
  card.keywords.push('Reach')
  return true
}

function log(card, note) {
  changes.push({ race: card.race, type: card.card_type, name: card.name, note })
}

function tuneUndead(card) {
  let ch = false
  const type = card.card_type

  if (type === 'Unit') {
    const uv = card.uv || 0
    const r = card.rarity || 'Common'
    if (['Common', 'Uncommon'].includes(r) && uv >= 3 && uv <= 5 && bump(card, 'uv', -1, 1)) {
      ch = true
      log(card, `UV ${uv}→${card.uv}`)
    }
    if ((card.toughness || 0) <= 4 && bump(card, 'toughness', 1, 1, 8)) {
      ch = true
      log(card, `T+1→${card.toughness}`)
    }
    if (
      UNDEAD_REACH_NAMES.has(card.name) &&
      (card.range || 1) === 1 &&
      addReach(card)
    ) {
      ch = true
      log(card, '+Reach')
    }
  } else if (type === 'Officer') {
    if ((card.uv || 0) >= 10 && bump(card, 'uv', -1, 1)) {
      ch = true
      log(card, `UV→${card.uv}`)
    }
    if ((card.toughness || 0) <= 4 && bump(card, 'toughness', 1, 1, 7)) {
      ch = true
      log(card, `T+1→${card.toughness}`)
    }
  } else if (type === 'Commander' && UNDEAD_CMD_UV_TRIM.has(card.name)) {
    const before = card.uv
    if (bump(card, 'uv', -2, 1)) {
      ch = true
      log(card, `UV ${before}→${card.uv}`)
    }
  }

  return ch
}

function tuneDwarf(card) {
  let ch = false
  if (card.card_type === 'Unit') {
    const uv = card.uv || 0
    const r = card.rarity || 'Common'
    if (['Common', 'Uncommon', 'Rare'].includes(r) && uv >= 5 && uv <= 7 && bump(card, 'uv', -1, 1)) {
      ch = true
      log(card, `UV ${uv}→${card.uv}`)
    }
    if ((card.move || 0) <= 2 && bump(card, 'move', 1, 1, 4)) {
      ch = true
      log(card, `M+1→${card.move}`)
    }
  } else if (card.card_type === 'Officer' && (card.uv || 0) >= 10 && bump(card, 'uv', -1, 1)) {
    ch = true
    log(card, `UV→${card.uv}`)
  }
  return ch
}

function tuneDemon(card) {
  let ch = false
  if (card.card_type === 'Unit') {
    const uv = card.uv || 0
    const r = card.rarity || 'Common'
    const isLine = ['Uncommon', 'Rare', 'Epic'].includes(r) || uv >= 3
    if (isLine && (card.toughness || 0) <= 3 && bump(card, 'toughness', 1, 1, 7)) {
      ch = true
      log(card, `T+1→${card.toughness}`)
    }
    if ((card.damage || 0) <= 2 && bump(card, 'damage', 1, 1, 5)) {
      ch = true
      log(card, `D+1→${card.damage}`)
    }
    if (uv >= 8 && (card.toughness || 0) <= 3 && bump(card, 'uv', -1, 1)) {
      ch = true
      log(card, `UV→${card.uv}`)
    }
  } else if (card.card_type === 'Officer') {
    if ((card.uv || 0) >= 10 && bump(card, 'uv', -1, 1)) {
      ch = true
      log(card, `UV→${card.uv}`)
    }
    if ((card.toughness || 0) <= 4 && bump(card, 'toughness', 1, 1, 7)) {
      ch = true
      log(card, `T+1→${card.toughness}`)
    }
  }
  return ch
}

function tuneDragon(card) {
  let ch = false
  const kws = card.keywords || []
  if (card.card_type === 'Unit') {
    const uv = card.uv || 0
    if (kws.includes('Flying') && uv >= 8 && bump(card, 'uv', 1, 1)) {
      ch = true
      log(card, `UV→${card.uv}`)
    }
    if ((card.damage || 0) >= 5 && bump(card, 'damage', -1, 1)) {
      ch = true
      log(card, `D→${card.damage}`)
    }
    if ((card.toughness || 0) >= 6 && bump(card, 'toughness', -1, 2)) {
      ch = true
      log(card, `T→${card.toughness}`)
    }
  } else if (card.card_type === 'Officer' && (card.uv || 0) >= 10 && bump(card, 'uv', 1, 1)) {
    ch = true
    log(card, `UV→${card.uv}`)
  } else if (card.card_type === 'Commander' && DRAGON_CMD_UV_BUMP.has(card.name)) {
    const amt = card.name === 'Hoard Sovereign Khar' ? 2 : 1
    const before = card.uv
    if (bump(card, 'uv', amt, 1)) {
      ch = true
      log(card, `UV ${before}→${card.uv}`)
    }
  }
  return ch
}

function tuneHuman(card) {
  let ch = false
  const kws = card.keywords || []
  if (card.card_type === 'Unit') {
    const uv = card.uv || 0
    if (uv >= 9 && bump(card, 'uv', 1, 1)) {
      ch = true
      log(card, `UV→${card.uv}`)
    } else if (kws.includes('Flying') && uv >= 7 && bump(card, 'uv', 1, 1)) {
      ch = true
      log(card, `UV→${card.uv}`)
    }
    if ((card.damage || 0) >= 5 && bump(card, 'damage', -1, 1)) {
      ch = true
      log(card, `D→${card.damage}`)
    }
    if ((card.toughness || 0) >= 7 && bump(card, 'toughness', -1, 2)) {
      ch = true
      log(card, `T→${card.toughness}`)
    }
  } else if (card.card_type === 'Officer' && (card.uv || 0) >= 10 && bump(card, 'uv', 1, 1)) {
    ch = true
    log(card, `UV→${card.uv}`)
  } else if (card.card_type === 'Commander' && HUMAN_CMD_UV_BUMP.has(card.name)) {
    const amt = card.name === 'Realmward High Marshal' ? 2 : 1
    const before = card.uv
    if (bump(card, 'uv', amt, 1)) {
      ch = true
      log(card, `UV ${before}→${card.uv}`)
    }
  }
  return ch
}

function tune(card) {
  if ((card.balance_rev || 0) >= REV) return false
  const race = card.race
  let ch = false
  if (race === 'Undead') ch = tuneUndead(card)
  else if (race === 'Dwarf') ch = tuneDwarf(card)
  else if (race === 'Demon') ch = tuneDemon(card)
  else if (race === 'Dragon') ch = tuneDragon(card)
  else if (race === 'Human') ch = tuneHuman(card)
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
for (const race of [...BUFF, ...NERF]) {
  const list = byRace[race] || []
  console.log(`${race}: ${list.length} changes`)
  for (const c of list.slice(0, 12)) console.log(`  ${c.type} ${c.name}: ${c.note}`)
  if (list.length > 12) console.log(`  ... +${list.length - 12} more`)
}
console.log('total', changes.length)
