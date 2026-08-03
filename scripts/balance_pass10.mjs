/**
 * Balance pass 10: lift Dwarf + Elf toward mid-pack (floor 48.5%),
 * light UV bumps on runaway Demon / Beastfolk if needed.
 * Idempotent via balance_rev >= 10.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const KB = path.resolve('C:/Users/keash/Projects/KingdomsBuilder/data/cards')
const REV = 10

const changes = []

/** Dwarf — commander UV trim + fragile commander T */
const DWARF_CMD_UV = {
  'Thane of All Holds': -1,
  'Anvil-Thane Korrik': -1,
}
const DWARF_CMD_T = new Set(['Forge-Marshal Flintpick'])

/** Dwarf — officers still costing too much deploy */
const DWARF_OFFICER_UV = new Set([
  'Shield Captain Brann',
  'Gate Warden Hroth',
  'Ironbreaker Lead Mog',
  'Oathkeeper Ysra',
  'Stonewright Kel',
  'Battery Sergeant Korr',
  'Anvil Guard Durn',
  'Cannon Officer Durik',
  'Engineer Warden Thilda',
  'Quartermaster Stonekeg',
  'Trenchwright Olna',
  'Oathbinder Mira',
])

/** Dwarf — elite / line UV + durability */
const DWARF_UNIT = {
  'Grudge Lord Champions': { uv: -1, toughness: 1 },
  "King's Gatekeepers": { uv: -1, toughness: 1 },
  'Deepforge Ancients': { uv: -1, toughness: 1 },
  'Ironbreaker Phalanx': { toughness: 1 },
  'Stoneheart Defenders': { toughness: 1 },
}

/** Elf — commander UV trim */
const ELF_CMD_UV = new Set([
  'Whispercanopy Huntress',
  'Green Court Sovereign',
  'Rootweave Mystic',
  'Starfall Huntress',
])

/** Elf — officer UV trim */
const ELF_OFFICER_UV = new Set([
  'Thornpath Guide',
  'Leafsignal',
  'Ley Watcher',
  'Moonspotter',
  'Beastwhisper Liaison',
  'Gale String',
  'Greensignal',
  'Startrail Tracker',
  'Mistveil Pathfinder',
  'Longshot Choir Lead',
  'Mossweave Adept',
  'Glaive Circlet Rider',
])

/** Elf — skirmish / range line efficiency */
const ELF_UNIT_UV = new Set([
  'Elder Treant',
  'Fallen Star Ancient',
  'Dryad Circle',
  'Featherblade',
  'Spiritbow of Moonfall',
  'Wild Hunt Riders',
  'Briar Skirmish Line',
  'Spirit Hawk',
  'Thornclaw Sabertooth',
  'Constellation Greatbow',
  'Quietbranch Sniper',
  'Hawk of Starfall',
  'Grove Wolf Pack',
])

/** Elf — fragile skirmishers gain Reach or T */
const ELF_REACH = new Set([
  'Leafblade Duelist',
  'Whisperleaf Skirmisher',
  'Nightstem Stalker',
  'Silverstep Dancer',
  'Lunashade',
])
const ELF_FRAGILE_T = new Set([
  'Leafblade Duelist',
  'Starwing Falcon',
  'Featherblade',
  'Spiritbow of Moonfall',
  'Quietbranch Sniper',
  'Thornclaw Sabertooth',
])

/** Soft nerf — runaway leaders */
const DEMON_OFFICER_UV_BUMP = new Set([
  'Imp Overseer',
  'Ash Handler',
  'Cinderlash Handler',
  'Hellgate Warden',
  'Soulbrand Captain',
])
const DEMON_UNIT_UV_BUMP = new Set([
  'Infernal Vanguard',
  'Ash Legion',
  'Hellfire Brute',
  'Soul Reaver',
])

const BEAST_OFFICER_UV_BUMP = new Set([
  'Centaur Marshal',
  'Beastmaster Rowan',
  'Minotaur Champion',
  'Skirmish Pack Lead',
  'Alpha Huntress',
  'Stampede Herald',
])
const BEAST_UNIT_UV_BUMP = new Set([
  'Stampede Runners',
  'Alpha Wolf Pack',
  'Horned Rampager',
  'Gorehorn Bull',
])

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

function tuneDwarf(card) {
  let ch = false
  const name = card.name
  const type = card.card_type

  if (type === 'Commander') {
    if (name in DWARF_CMD_UV && bump(card, 'uv', DWARF_CMD_UV[name], 1)) {
      ch = true
      log(card, `UV→${card.uv}`)
    }
    if (DWARF_CMD_T.has(name) && bump(card, 'toughness', 1, 1, 8)) {
      ch = true
      log(card, `T→${card.toughness}`)
    }
  } else if (type === 'Officer' && DWARF_OFFICER_UV.has(name)) {
    const before = card.uv
    if (bump(card, 'uv', -1, 1)) {
      ch = true
      log(card, `UV ${before}→${card.uv}`)
    }
  } else if (type === 'Unit') {
    if (name in DWARF_UNIT) {
      const spec = DWARF_UNIT[name]
      if (spec.uv && bump(card, 'uv', spec.uv, 1)) {
        ch = true
        log(card, `UV→${card.uv}`)
      }
      if (spec.toughness && bump(card, 'toughness', spec.toughness, 1, 8)) {
        ch = true
        log(card, `T→${card.toughness}`)
      }
    } else if (
      ['Rare', 'Epic'].includes(card.rarity || '') &&
      (card.uv || 0) >= 8 &&
      bump(card, 'uv', -1, 1)
    ) {
      ch = true
      log(card, `UV ${card.uv + 1}→${card.uv}`)
    }
  }

  return ch
}

function tuneElf(card) {
  let ch = false
  const name = card.name
  const type = card.card_type

  if (type === 'Commander' && ELF_CMD_UV.has(name)) {
    const before = card.uv
    if (bump(card, 'uv', -1, 1)) {
      ch = true
      log(card, `UV ${before}→${card.uv}`)
    }
  } else if (type === 'Officer' && ELF_OFFICER_UV.has(name)) {
    const before = card.uv
    if (bump(card, 'uv', -1, 1)) {
      ch = true
      log(card, `UV ${before}→${card.uv}`)
    }
  } else if (type === 'Unit') {
    if (ELF_UNIT_UV.has(name)) {
      const before = card.uv
      if (bump(card, 'uv', -1, 1)) {
        ch = true
        log(card, `UV ${before}→${card.uv}`)
      }
    }
    if (ELF_REACH.has(name) && (card.range || 1) === 1 && addReach(card)) {
      ch = true
      log(card, '+Reach')
    }
    if (ELF_FRAGILE_T.has(name) && bump(card, 'toughness', 1, 1, 7)) {
      ch = true
      log(card, `T→${card.toughness}`)
    } else if (
      (card.toughness || 0) <= 3 &&
      ['Uncommon', 'Rare'].includes(card.rarity || '') &&
      bump(card, 'toughness', 1, 1, 7)
    ) {
      ch = true
      log(card, `T→${card.toughness}`)
    }
  }

  return ch
}

function tuneDemon(card) {
  let ch = false
  const name = card.name
  if (card.card_type === 'Officer' && DEMON_OFFICER_UV_BUMP.has(name)) {
    const before = card.uv
    if (bump(card, 'uv', 1, 1)) {
      ch = true
      log(card, `UV ${before}→${card.uv}`)
    }
  } else if (card.card_type === 'Unit' && DEMON_UNIT_UV_BUMP.has(name)) {
    const before = card.uv
    if (bump(card, 'uv', 1, 1)) {
      ch = true
      log(card, `UV ${before}→${card.uv}`)
    }
  }
  return ch
}

function tuneBeastfolk(card) {
  let ch = false
  const name = card.name
  if (card.card_type === 'Officer' && BEAST_OFFICER_UV_BUMP.has(name)) {
    const before = card.uv
    if (bump(card, 'uv', 1, 1)) {
      ch = true
      log(card, `UV ${before}→${card.uv}`)
    }
  } else if (card.card_type === 'Unit' && BEAST_UNIT_UV_BUMP.has(name)) {
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
for (const race of ['Dwarf', 'Elf', 'Demon', 'Beastfolk']) {
  const list = byRace[race] || []
  console.log(`${race}: ${list.length} changes`)
  for (const c of list) console.log(`  ${c.type} ${c.name}: ${c.note}`)
}
console.log('total', changes.length)
