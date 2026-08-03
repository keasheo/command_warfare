/**
 * Balance pass 10b: floor lift for Dwarf / Undead / Dragon;
 * light UV bumps on overshot Human / Demon / Elf / Beastfolk.
 * Idempotent via balance_rev >= 11.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('C:/Users/keash/Projects/KingdomsBuilder/data/cards')
const REV = 11

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

/** Dwarf — core line UV + punch (officer trim alone didn't move needle) */
function tuneDwarf(card) {
  let ch = false
  const type = card.card_type
  if (type === 'Unit') {
    const uv = card.uv || 0
    const r = card.rarity || 'Common'
    if (['Common', 'Uncommon'].includes(r) && uv >= 3 && uv <= 5 && bump(card, 'uv', -1, 1)) {
      ch = true
      log(card, `UV ${uv}→${card.uv}`)
    }
    if ((card.damage || 0) <= 4 && ['Rare', 'Epic'].includes(r) && bump(card, 'damage', 1, 1, 6)) {
      ch = true
      log(card, `D→${card.damage}`)
    }
  } else if (type === 'Commander' && (card.uv || 0) >= 14 && bump(card, 'uv', -1, 1)) {
    ch = true
    log(card, `UV→${card.uv}`)
  }
  return ch
}

/** Undead — economy + line durability */
const UNDEAD_CMD_UV = new Set(['Bone Harvester Mire', 'Eclipse Lich Vesper'])
const UNDEAD_OFFICER_UV = new Set([
  'Grave Marshal',
  'Crypt Captain',
  'Plague Herald',
  'Bone Shepherd',
  'Wight Commander',
])

function tuneUndead(card) {
  let ch = false
  const type = card.card_type
  const name = card.name
  if (type === 'Commander' && UNDEAD_CMD_UV.has(name)) {
    const before = card.uv
    if (bump(card, 'uv', -1, 1)) {
      ch = true
      log(card, `UV ${before}→${card.uv}`)
    }
  } else if (type === 'Officer') {
    if (UNDEAD_OFFICER_UV.has(name) || (card.uv || 0) >= 10) {
      const before = card.uv
      if (bump(card, 'uv', -1, 1)) {
        ch = true
        log(card, `UV ${before}→${card.uv}`)
      }
    }
    if ((card.toughness || 0) <= 4 && bump(card, 'toughness', 1, 1, 7)) {
      ch = true
      log(card, `T→${card.toughness}`)
    }
  } else if (type === 'Unit') {
    const uv = card.uv || 0
    if (['Common', 'Uncommon'].includes(card.rarity || '') && uv >= 3 && uv <= 5 && bump(card, 'uv', -1, 1)) {
      ch = true
      log(card, `UV→${card.uv}`)
    }
    if ((card.toughness || 0) <= 4 && bump(card, 'toughness', 1, 1, 7)) {
      ch = true
      log(card, `T→${card.toughness}`)
    }
  }
  return ch
}

/** Dragon — small restore after pass-9 partial undo */
const DRAGON_UNIT_UV = new Set([
  'Stormwing Elite',
  'Ancient Winged Brood',
  'Wyrmscale Guard',
  'Brood Striker',
])
const DRAGON_OFFICER_UV = new Set(['Wing Captain Aeris', 'Clutch Marshal Tor', 'Terror Herald Nyx'])

function tuneDragon(card) {
  let ch = false
  const name = card.name
  if (card.card_type === 'Unit' && DRAGON_UNIT_UV.has(name)) {
    const before = card.uv
    if (bump(card, 'uv', -1, 1)) {
      ch = true
      log(card, `UV ${before}→${card.uv}`)
    }
  } else if (card.card_type === 'Officer' && DRAGON_OFFICER_UV.has(name)) {
    const before = card.uv
    if (bump(card, 'uv', -1, 1)) {
      ch = true
      log(card, `UV ${before}→${card.uv}`)
    }
  } else if (card.card_type === 'Unit' && (card.toughness || 0) <= 4 && bump(card, 'toughness', 1, 1, 7)) {
    ch = true
    log(card, `T→${card.toughness}`)
  }
  return ch
}

/** Soft nerfs on overshot leaders */
const HUMAN_UV_BUMP = new Set([
  'Realmward High Marshal',
  'Iron Covenant Spear',
  'Banner Knight',
  'Line Captain Aldric',
  'Crossbow Sergeant',
  'Pike Marshal',
])
const ELF_REVERT_UV = new Set([
  'Briar Skirmish Line',
  'Spirit Hawk',
  'Thornclaw Sabertooth',
  'Elder Treant',
  'Greensignal',
  'Longshot Choir Lead',
])
const DEMON_UV_BUMP = new Set([
  'Hellgate Warden',
  'Soulbrand Captain',
  'Brimstone Knight',
  'Pit Captain',
])
const BEAST_UV_BUMP = new Set([
  'Alpha Huntress',
  'Stampede Herald',
  'Primal Warden',
  'Horn Lord',
  'Stampede Runners',
  'Alpha Wolf Pack',
])

function tuneHuman(card) {
  let ch = false
  const name = card.name
  if (card.card_type === 'Commander' && HUMAN_UV_BUMP.has(name)) {
    const before = card.uv
    if (bump(card, 'uv', 1, 1)) {
      ch = true
      log(card, `UV ${before}→${card.uv}`)
    }
  } else if (card.card_type === 'Officer' && (card.uv || 0) >= 10 && bump(card, 'uv', 1, 1)) {
    ch = true
    log(card, `UV→${card.uv}`)
  } else if (card.card_type === 'Unit' && (card.uv || 0) >= 8 && bump(card, 'uv', 1, 1)) {
    ch = true
    log(card, `UV→${card.uv}`)
  }
  return ch
}

function tuneElf(card) {
  let ch = false
  const name = card.name
  if (card.card_type === 'Unit' && ELF_REVERT_UV.has(name)) {
    const before = card.uv
    if (bump(card, 'uv', 1, 1)) {
      ch = true
      log(card, `UV ${before}→${card.uv} (trim overshoot)`)
    }
  } else if (card.card_type === 'Officer' && ['Greensignal', 'Longshot Choir Lead', 'Beastwhisper Liaison'].includes(name)) {
    const before = card.uv
    if (bump(card, 'uv', 1, 1)) {
      ch = true
      log(card, `UV ${before}→${card.uv} (trim overshoot)`)
    }
  }
  return ch
}

function tuneDemon(card) {
  let ch = false
  const name = card.name
  if (card.card_type === 'Officer' && (DEMON_UV_BUMP.has(name) || (card.uv || 0) >= 10)) {
    const before = card.uv
    if (bump(card, 'uv', 1, 1)) {
      ch = true
      log(card, `UV ${before}→${card.uv}`)
    }
  } else if (card.card_type === 'Unit' && (card.uv || 0) >= 7 && bump(card, 'uv', 1, 1)) {
    ch = true
    log(card, `UV→${card.uv}`)
  }
  return ch
}

function tuneBeastfolk(card) {
  let ch = false
  const name = card.name
  if (card.card_type === 'Officer' && (BEAST_UV_BUMP.has(name) || (card.uv || 0) >= 11)) {
    const before = card.uv
    if (bump(card, 'uv', 1, 1)) {
      ch = true
      log(card, `UV ${before}→${card.uv}`)
    }
  } else if (card.card_type === 'Unit' && BEAST_UV_BUMP.has(name)) {
    const before = card.uv
    if (bump(card, 'uv', 1, 1)) {
      ch = true
      log(card, `UV ${before}→${card.uv}`)
    }
  }
  return ch
}

function tune(card) {
  if ((card.balance_rev || 0) >= REV) return false
  let ch = false
  const race = card.race
  if (race === 'Dwarf') ch = tuneDwarf(card)
  else if (race === 'Undead') ch = tuneUndead(card)
  else if (race === 'Dragon') ch = tuneDragon(card)
  else if (race === 'Human') ch = tuneHuman(card)
  else if (race === 'Elf') ch = tuneElf(card)
  else if (race === 'Demon') ch = tuneDemon(card)
  else if (race === 'Beastfolk') ch = tuneBeastfolk(card)
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
