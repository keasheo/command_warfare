/**
 * Rebalance officer passives: enforce racial exclusivity and prefer role fit.
 * Does not touch the unique passives added earlier for the CC-strip officers
 * unless they violate race rules.
 */
import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const db = new Database(path.join(root, 'data', 'command-warfare.sqlite'))

const RACE_LOCKED = {
  'Pack Cadence': 'Beastfolk',
  'Oath Brace': 'Dwarf',
  'Marsh Stride': 'Lizardman',
  'Soul Draft': 'Undead',
  'Infernal Heat': 'Demon',
  'Clutch Bond': 'Dragon',
  'Root Latch': 'Elf',
  'Line Cadence': 'Human',
  'Null Lattice': 'Construct',
  'Gear Grease': 'Construct',
  'Repair Rites': 'Construct',
  'Fear Broker': 'Undead',
  'Named Fangs': 'Beastfolk',
  'Dust Declaration': 'Beastfolk',
  'Aftershock Charge': 'Beastfolk',
  'Eyes on Sky': 'Dragon',
  'Ozone Liturgy': 'Dragon',
  'Stoneblood Plates': 'Dragon',
  'Scar Ledger': 'Dwarf',
  'Spoken Bond': 'Dwarf',
  'Grave Interest': 'Undead',
}

/** Pool of freely assignable officer passives (from diversify set). */
const POOL = [
  {
    name: 'Close Order',
    tags: ['Frontline', 'Infantry', 'Shieldwall', 'Heavy', 'Tank'],
    races: null,
  },
  {
    name: 'Vanguard Push',
    tags: ['Frontline', 'Damage', 'Infantry', 'Light'],
    races: null,
  },
  {
    name: 'Shield Echo',
    tags: ['Frontline', 'Tank', 'Shieldwall', 'Guard', 'Heavy'],
    races: null,
  },
  {
    name: 'Kill Rhythm',
    tags: ['Damage', 'Artillery', 'Ranged'],
    races: null,
  },
  {
    name: 'Blood Scent',
    tags: ['Damage', 'Beast', 'Pack', 'Scout'],
    races: ['Beastfolk', 'Demon', 'Lizardman'],
  },
  {
    name: 'Frenzy Contagion',
    tags: ['Damage', 'Beast', 'Demon', 'Pack'],
    races: ['Beastfolk', 'Demon', 'Lizardman'],
  },
  {
    name: 'Volley Discipline',
    tags: ['Artillery', 'Ranged', 'Support'],
    races: null,
  },
  {
    name: 'Spotting Line',
    tags: ['Artillery', 'Scout', 'Ranged'],
    races: null,
  },
  {
    name: 'Ember Elevation',
    tags: ['Artillery', 'Fire', 'Dragon', 'Demon', 'Ranged'],
    races: ['Dragon', 'Demon'],
  },
  {
    name: 'Trail Dust',
    tags: ['Scout', 'Light', 'Stealth', 'Harass'],
    races: null,
  },
  {
    name: 'Harrier Net',
    tags: ['Scout', 'Harass', 'Control', 'Cavalry'],
    races: null,
  },
  {
    name: 'Sidestep Doctrine',
    tags: ['Scout', 'Light', 'Cavalry', 'Damage'],
    races: null,
  },
  {
    name: 'Triage Cadence',
    tags: ['Healer', 'Support'],
    races: null,
  },
  {
    name: 'Banner Lift',
    tags: ['Support', 'Healer', 'Frontline'],
    races: null,
  },
  {
    name: 'Supply Cache',
    tags: ['Support', 'Healer', 'Tank'],
    races: null,
  },
  {
    name: 'Lockstep Brace',
    tags: ['Tank', 'Heavy', 'Construct', 'Frontline'],
    races: null,
  },
  {
    name: 'Bulwark Aura',
    tags: ['Tank', 'Frontline', 'Control', 'Guard'],
    races: null,
  },
  {
    name: 'Unyielding Post',
    tags: ['Tank', 'Frontline', 'Unyielding'],
    races: null,
  },
  {
    name: 'Hex Pressure',
    tags: ['Control', 'Magic', 'Nature'],
    races: null,
  },
  {
    name: 'Suppressing Cadence',
    tags: ['Control', 'Artillery', 'Ranged'],
    races: null,
  },
  {
    name: 'Null Lattice',
    tags: ['Control', 'Construct'],
    races: ['Construct'],
  },
  {
    name: 'Winglash',
    tags: ['Scout', 'Flying', 'Dragon', 'Damage'],
    races: ['Dragon', 'Elf'],
  },
  {
    name: 'Dive Screen',
    tags: ['Flying', 'Fear', 'Control', 'Dragon'],
    races: ['Dragon', 'Demon'],
  },
  {
    name: 'Gear Grease',
    tags: ['Construct', 'Support', 'Damage'],
    races: ['Construct'],
  },
  {
    name: 'Siege Sync',
    tags: ['Artillery', 'Siege', 'Construct', 'Dwarf'],
    races: ['Construct', 'Dwarf', 'Undead', 'Human'],
  },
  {
    name: 'Reload Drill',
    tags: ['Artillery', 'Siege', 'Ranged'],
    races: null,
  },
  {
    name: 'Marsh Stride',
    tags: ['Lizardman', 'Amphibious', 'Scout', 'Frontline'],
    races: ['Lizardman'],
  },
  {
    name: 'Oath Brace',
    tags: ['Dwarf', 'Frontline', 'Tank', 'Support'],
    races: ['Dwarf'],
  },
  {
    name: 'Pack Cadence',
    tags: ['Beastfolk', 'Pack', 'Beast', 'Damage'],
    races: ['Beastfolk'],
  },
  {
    name: 'Soul Draft',
    tags: ['Undead', 'Support', 'Frontline', 'Damage'],
    races: ['Undead'],
  },
  {
    name: 'Infernal Heat',
    tags: ['Demon', 'Damage', 'Fire', 'Frontline'],
    races: ['Demon'],
  },
  {
    name: 'Clutch Bond',
    tags: ['Dragon', 'Frontline', 'Support', 'Tank'],
    races: ['Dragon'],
  },
  {
    name: 'Root Latch',
    tags: ['Elf', 'Nature', 'Support', 'Control'],
    races: ['Elf'],
  },
  {
    name: 'Line Cadence',
    tags: ['Human', 'Frontline', 'Support', 'Infantry'],
    races: ['Human'],
  },
  {
    name: 'Mounted Pressure',
    tags: ['Cavalry', 'Mounted', 'Charge', 'Damage', 'Scout'],
    races: null,
  },
  {
    name: 'Fear Broker',
    tags: ['Undead', 'Fear', 'Control', 'Tank'],
    races: ['Undead'],
  },
  {
    name: 'Repair Rites',
    tags: ['Construct', 'Healer', 'Support'],
    races: ['Construct'],
  },
  {
    name: 'Skirmish Drift',
    tags: ['Scout', 'Light', 'Harass', 'Cavalry'],
    races: null,
  },
  // Extra generic fillers for healers / support so we stop borrowing badly
  {
    name: 'Steady Hands',
    tags: ['Healer', 'Support'],
    races: null,
    description:
      'Once each round, when you restore Toughness to a unit of this company, that unit gains +1 Hit until end of round.',
  },
  {
    name: 'Company Standard',
    tags: ['Support', 'Healer', 'Frontline'],
    races: null,
    description:
      'Units of this company beginning activation within 2 spaces of this officer gain Harden 1 until end of that activation.',
  },
  {
    name: 'Measured Advance',
    tags: ['Frontline', 'Tank', 'Infantry', 'Control'],
    races: null,
    description:
      'Units of this company that moved 1 hex or fewer this activation gain +1 Toughness until end of round.',
  },
]

const DESCRIPTIONS = Object.fromEntries(
  [
    ...POOL.filter((p) => p.description).map((p) => [p.name, p.description]),
  ],
)

// Pull descriptions already in DB for known passives
for (const p of POOL) {
  if (DESCRIPTIONS[p.name]) continue
  const row = db.prepare('SELECT description FROM abilities WHERE name=?').get(p.name)
  if (row?.description) DESCRIPTIONS[p.name] = row.description
}

function abilitySearchBlob(row) {
  return Object.values(row)
    .filter((v) => v != null && v !== '')
    .map(String)
    .join(' ')
    .toLowerCase()
}

function insertAbility(name, description, usedBy = 'Officer') {
  const row = {
    name,
    ability_type: 'Passive',
    cost: 'Passive',
    cost_amount: null,
    cost_resource: null,
    description,
    affects: null,
    affect_count: null,
    radius_from: null,
    radius_size: null,
    used_by: usedBy,
    cooldown: null,
    tags_json: '[]',
    search_blob: '',
  }
  row.search_blob = abilitySearchBlob(row)
  db.prepare(`
    INSERT INTO abilities (
      name, ability_type, cost, cost_amount, cost_resource, description,
      affects, affect_count, radius_from, radius_size, used_by, cooldown,
      tags_json, search_blob
    ) VALUES (
      @name, @ability_type, @cost, @cost_amount, @cost_resource, @description,
      @affects, @affect_count, @radius_from, @radius_size, @used_by, @cooldown,
      @tags_json, @search_blob
    )
    ON CONFLICT(name) DO UPDATE SET
      description=excluded.description,
      used_by=excluded.used_by,
      search_blob=excluded.search_blob
  `).run(row)
}

for (const [name, desc] of Object.entries(DESCRIPTIONS)) {
  if (desc) insertAbility(name, desc)
}
insertAbility(
  'Steady Hands',
  'Once each round, when you restore Toughness to a unit of this company, that unit gains +1 Hit until end of round.',
)
insertAbility(
  'Company Standard',
  'Units of this company beginning activation within 2 spaces of this officer gain Harden 1 until end of that activation.',
)
insertAbility(
  'Measured Advance',
  'Units of this company that moved 1 hex or fewer this activation gain +1 Toughness until end of round.',
)

function illegal(name, race) {
  const locked = RACE_LOCKED[name]
  if (locked && locked !== race) return true
  const pool = POOL.find((p) => p.name === name)
  if (pool?.races && !pool.races.includes(race)) return true
  return false
}

function score(p, card) {
  if (illegal(p.name, card.race)) return -9999
  if (p.races && !p.races.includes(card.race)) return -9999
  const bag = new Set(
    [card.race, card.role, card.primary_type, card.secondary_type, ...card.keywords]
      .filter(Boolean)
      .map(String),
  )
  let s = 0
  for (const t of p.tags) if (bag.has(t)) s += 4
  if (p.tags.includes(card.role)) s += 3
  if (p.races?.includes(card.race)) s += 6
  return s
}

const MAX = 4
const useCounts = new Map(POOL.map((p) => [p.name, 0]))

const officers = db
  .prepare(`SELECT * FROM cards WHERE card_type='Officer'`)
  .all()
  .map((c) => ({
    ...c,
    abilities: JSON.parse(c.abilities_json || '[]'),
    keywords: JSON.parse(c.keywords_json || '[]'),
    tags: JSON.parse(c.tags_json || '[]'),
  }))

// Count current legal uses
for (const o of officers) {
  for (const a of o.abilities) {
    if (useCounts.has(a) && !illegal(a, o.race)) {
      useCounts.set(a, (useCounts.get(a) || 0) + 1)
    }
  }
}

function pickReplacement(card, have) {
  const ranked = POOL.map((p) => ({
    p,
    s:
      score(p, card) * 10 -
      (useCounts.get(p.name) || 0) * 6 -
      (have.has(p.name) ? 5000 : 0) -
      ((useCounts.get(p.name) || 0) >= MAX ? 5000 : 0),
  })).sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name))
  const choice = ranked.find(
    (r) =>
      r.s > -1000 &&
      !have.has(r.p.name) &&
      (useCounts.get(r.p.name) || 0) < MAX,
  )
  return choice?.p.name ?? null
}

const update = db.prepare(
  `UPDATE cards SET abilities_json = ?, search_blob = ? WHERE id = ?`,
)

const tx = db.transaction(() => {
  let fixes = 0
  for (const card of officers) {
    let changed = false
    const next = []
    const have = new Set()
    for (const a of card.abilities) {
      if (!illegal(a, card.race)) {
        next.push(a)
        have.add(a)
        continue
      }
      // free a use count if it was counted
      if (useCounts.has(a)) {
        useCounts.set(a, Math.max(0, (useCounts.get(a) || 0) - 1))
      }
      const replacement = pickReplacement(card, have)
      if (!replacement) {
        console.warn(`No replacement for ${card.name} losing ${a}`)
        continue
      }
      next.push(replacement)
      have.add(replacement)
      useCounts.set(replacement, (useCounts.get(replacement) || 0) + 1)
      console.log(`${card.name}: ${a} → ${replacement}`)
      changed = true
      fixes += 1
    }
    if (!changed) continue
    const parts = []
    for (const [k, v] of Object.entries(card)) {
      if (
        v == null ||
        v === '' ||
        k === 'search_blob' ||
        k === 'abilities_json' ||
        k === 'keywords_json' ||
        k === 'tags_json' ||
        k === 'abilities' ||
        k === 'keywords' ||
        k === 'tags'
      )
        continue
      parts.push(String(v))
    }
    parts.push(...next, ...card.keywords, ...card.tags)
    update.run(JSON.stringify(next), parts.join(' ').toLowerCase(), card.id)
    card.abilities = next
  }
  return fixes
})

console.log('Fixes:', tx())

// Healer role soft fix: Vanguard Push / Kill Rhythm on pure Healers → Steady Hands / Triage
const healerBad = new Set(['Vanguard Push', 'Kill Rhythm', 'Frenzy Contagion', 'Mounted Pressure'])
const healerPrefer = ['Steady Hands', 'Triage Cadence', 'Supply Cache', 'Banner Lift', 'Company Standard']

const tx2 = db.transaction(() => {
  let n = 0
  for (const card of db
    .prepare(`SELECT * FROM cards WHERE card_type='Officer' AND role='Healer'`)
    .all()
    .map((c) => ({
      ...c,
      abilities: JSON.parse(c.abilities_json || '[]'),
      keywords: JSON.parse(c.keywords_json || '[]'),
      tags: JSON.parse(c.tags_json || '[]'),
    }))) {
    const have = new Set(card.abilities)
    let changed = false
    const next = []
    for (const a of card.abilities) {
      if (!healerBad.has(a)) {
        next.push(a)
        continue
      }
      const pick =
        healerPrefer.find((p) => !have.has(p) && !next.includes(p)) ||
        pickReplacement(
          { ...card, race: card.race },
          new Set([...have, ...next]),
        )
      if (!pick) {
        next.push(a)
        continue
      }
      next.push(pick)
      have.add(pick)
      console.log(`Healer ${card.name}: ${a} → ${pick}`)
      changed = true
      n += 1
    }
    if (!changed) continue
    const parts = []
    for (const [k, v] of Object.entries(card)) {
      if (
        v == null ||
        v === '' ||
        k === 'search_blob' ||
        k === 'abilities_json' ||
        k === 'keywords_json' ||
        k === 'tags_json' ||
        k === 'abilities' ||
        k === 'keywords' ||
        k === 'tags'
      )
        continue
      parts.push(String(v))
    }
    parts.push(...next, ...card.keywords, ...card.tags)
    update.run(JSON.stringify(next), parts.join(' ').toLowerCase(), card.id)
  }
  return n
})

console.log('Healer fixes:', tx2())

const counts = new Map()
for (const row of db
  .prepare(
    `SELECT abilities_json FROM cards WHERE card_type IN ('Officer','Commander')`,
  )
  .all()) {
  for (const a of JSON.parse(row.abilities_json || '[]')) {
    counts.set(a, (counts.get(a) || 0) + 1)
  }
}
console.log('\nTop passives now:')
;[...counts.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .slice(0, 25)
  .forEach(([n, c]) => console.log(`  ${c}\t${n}`))
