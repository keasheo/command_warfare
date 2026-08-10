/**
 * Diversify overused passives (Inspire / Inspiring Presence / Disciplined Advance)
 * across officers and commanders.
 */
import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const db = new Database(path.join(root, 'data', 'command-warfare.sqlite'))

const REMOVE = new Set(['Inspire', 'Inspiring Presence', 'Disciplined Advance'])
const OFFICER_MAX_USES = 4

function abilitySearchBlob(row) {
  return Object.values(row)
    .filter((v) => v != null && v !== '')
    .map(String)
    .join(' ')
    .toLowerCase()
}

function cardSearchBlob(card, abilities, keywords, tags) {
  const parts = []
  for (const [key, value] of Object.entries(card)) {
    if (value == null || value === '' || key === 'search_blob') continue
    if (
      key === 'abilities_json' ||
      key === 'keywords_json' ||
      key === 'tags_json'
    )
      continue
    parts.push(String(value))
  }
  parts.push(...abilities, ...keywords, ...tags)
  return parts.join(' ').toLowerCase()
}

/** Officer-scoped archetype passives (company-focused). */
const OFFICER_PASSIVES = [
  {
    name: 'Close Order',
    tags: ['Frontline', 'Infantry', 'Shieldwall', 'Heavy', 'Tank'],
    description:
      'Infantry of this company adjacent to another unit of this company gain Harden 1.',
  },
  {
    name: 'Vanguard Push',
    tags: ['Frontline', 'Damage', 'Infantry', 'Light'],
    description:
      'Units of this company that moved this activation gain +1 Hit on their first attack this activation.',
  },
  {
    name: 'Shield Echo',
    tags: ['Frontline', 'Tank', 'Shieldwall', 'Guard', 'Heavy'],
    description:
      'When a Shieldwall or Guard unit of this company is attacked, adjacent units of this company gain Harden 1 until end of that attack.',
  },
  {
    name: 'Kill Rhythm',
    tags: ['Damage', 'Artillery', 'Ranged'],
    description:
      'Units of this company gain +1 Damage against enemies that have already been damaged this round.',
  },
  {
    name: 'Blood Scent',
    tags: ['Damage', 'Beast', 'Pack', 'Scout'],
    description:
      'Beast units of this company gain +1 Hit while adjacent to a damaged enemy.',
  },
  {
    name: 'Frenzy Contagion',
    tags: ['Damage', 'Beast', 'Demon', 'Pack'],
    description:
      'When a unit of this company destroys an enemy, another unit of this company in Command Radius gains +1 Damage until end of round.',
  },
  {
    name: 'Volley Discipline',
    tags: ['Artillery', 'Ranged', 'Support'],
    description:
      'Ranged units of this company attacking an enemy already attacked by this company this round gain +1 Hit.',
  },
  {
    name: 'Spotting Line',
    tags: ['Artillery', 'Scout', 'Ranged'],
    description:
      'Ranged units of this company gain +1 Range while adjacent to a Scout of this company.',
  },
  {
    name: 'Ember Elevation',
    tags: ['Artillery', 'Fire', 'Dragon', 'Demon', 'Ranged'],
    description:
      'Fire units of this company gain +1 Damage on their first attack each round.',
  },
  {
    name: 'Trail Dust',
    tags: ['Scout', 'Light', 'Stealth', 'Harass'],
    description:
      'Scout and Stealth units of this company gain +1 Move and Woodwalker (+1 Hit in Forest).',
  },
  {
    name: 'Harrier Net',
    tags: ['Scout', 'Harass', 'Control', 'Cavalry'],
    description:
      'Enemies damaged by a Scout or Harass unit of this company this round gain Slow until end of round.',
  },
  {
    name: 'Sidestep Doctrine',
    tags: ['Scout', 'Light', 'Cavalry', 'Damage'],
    description:
      'Once per activation, a Light unit of this company may Move 1 after an attack that did not destroy its target.',
  },
  {
    name: 'Triage Cadence',
    tags: ['Healer', 'Support', 'Medic'],
    description:
      'When you restore Toughness to a unit of this company, it gains Harden 1 until end of round.',
  },
  {
    name: 'Banner Lift',
    tags: ['Support', 'Healer', 'Frontline'],
    description:
      'Units of this company beginning activation within 2 spaces of this officer gain +1 Move.',
  },
  {
    name: 'Supply Cache',
    tags: ['Support', 'Healer', 'Tank'],
    description:
      'Once each round, the first time a unit of this company in Command Radius would take damage, reduce it by 1.',
  },
  {
    name: 'Lockstep Brace',
    tags: ['Tank', 'Heavy', 'Construct', 'Frontline'],
    description:
      'Heavy units of this company that have not attacked this activation gain +1 Toughness.',
  },
  {
    name: 'Bulwark Aura',
    tags: ['Tank', 'Frontline', 'Control', 'Guard'],
    description:
      'Enemies adjacent to two or more units of this company suffer −1 Hit on attacks against this company.',
  },
  {
    name: 'Unyielding Post',
    tags: ['Tank', 'Frontline', 'Unyielding', 'Objective'],
    description:
      'Units of this company on an objective or fortified hex gain Harden 1.',
  },
  {
    name: 'Hex Pressure',
    tags: ['Control', 'Magic', 'Nature'],
    description:
      'Magic units of this company gain +1 Hit against enemies in difficult terrain or water.',
  },
  {
    name: 'Suppressing Cadence',
    tags: ['Control', 'Artillery', 'Ranged'],
    description:
      'Enemies attacked by this company this round lose 1 Move on their next activation (once each).',
  },
  {
    name: 'Null Lattice',
    tags: ['Control', 'Construct'],
    description:
      'Construct units of this company adjacent to this officer ignore the first status effect applied to them each round.',
  },
  {
    name: 'Winglash',
    tags: ['Scout', 'Flying', 'Dragon', 'Damage'],
    description:
      'Flying units of this company that moved this activation gain +1 Damage on their first attack this activation.',
  },
  {
    name: 'Dive Screen',
    tags: ['Flying', 'Fear', 'Control', 'Dragon'],
    description:
      'While a Flying unit of this company is within Command Radius, units of this company ignore Fear.',
  },
  {
    name: 'Gear Grease',
    tags: ['Construct', 'Support', 'Damage'],
    description:
      'Construct units of this company beginning activation in Command Radius gain +1 Move.',
  },
  {
    name: 'Siege Sync',
    tags: ['Artillery', 'Siege', 'Construct', 'Dwarf'],
    description:
      'Siege units of this company adjacent to a non-Siege unit of this company gain +1 Hit.',
  },
  {
    name: 'Reload Drill',
    tags: ['Artillery', 'Siege', 'Ranged'],
    description:
      'Siege or Ranged units of this company that did not move this activation gain +1 Damage.',
  },
  {
    name: 'Marsh Stride',
    tags: ['Lizardman', 'Amphibious', 'Scout', 'Frontline'],
    description:
      'Amphibious units of this company treat water as normal terrain and gain +1 Hit while in water.',
  },
  {
    name: 'Oath Brace',
    tags: ['Dwarf', 'Frontline', 'Tank', 'Support'],
    description:
      'Dwarf units of this company adjacent to this officer gain +1 Toughness.',
  },
  {
    name: 'Pack Cadence',
    tags: ['Beastfolk', 'Pack', 'Beast', 'Damage'],
    description:
      'Pack units of this company gain +1 Hit while another Pack unit of this company is adjacent.',
  },
  {
    name: 'Soul Draft',
    tags: ['Undead', 'Support', 'Frontline', 'Damage'],
    description:
      'When an Undead unit of this company is destroyed in Command Radius, another Undead of this company gains +1 Damage until end of round.',
  },
  {
    name: 'Infernal Heat',
    tags: ['Demon', 'Damage', 'Fire', 'Frontline'],
    description:
      'Demon units of this company gain +1 Damage while adjacent to a damaged unit (friendly or enemy).',
  },
  {
    name: 'Clutch Bond',
    tags: ['Dragon', 'Frontline', 'Support', 'Tank'],
    description:
      'Dragon units of this company adjacent to another Dragon of this company gain Harden 1.',
  },
  {
    name: 'Root Latch',
    tags: ['Elf', 'Nature', 'Support', 'Control'],
    description:
      'Nature units of this company in forest or difficult terrain gain +1 Toughness.',
  },
  {
    name: 'Line Cadence',
    tags: ['Human', 'Frontline', 'Support', 'Infantry'],
    description:
      'Human units of this company beginning activation in Command Radius gain +1 Hit on their first attack this activation.',
  },
  {
    name: 'Mounted Pressure',
    tags: ['Cavalry', 'Mounted', 'Charge', 'Damage', 'Scout'],
    description:
      'Cavalry of this company that ended a move adjacent to an enemy gain +1 Damage on their first attack this activation.',
  },
  {
    name: 'Fear Broker',
    tags: ['Undead', 'Fear', 'Control', 'Tank'],
    description:
      'Fear attacks by this company force the target to reroll one successful Hit die.',
  },
  {
    name: 'Repair Rites',
    tags: ['Construct', 'Healer', 'Support'],
    description:
      'When you restore Toughness to a Construct of this company, restore 1 additional Toughness.',
  },
  {
    name: 'Skirmish Drift',
    tags: ['Scout', 'Light', 'Harass', 'Cavalry'],
    description:
      'After a Harass unit of this company attacks, it may Move 1 (once per activation).',
  },
]

/** Explicit commander replacements for Inspiring Presence / Disciplined Advance. */
const COMMANDER_PASSIVES = [
  {
    commander: 'High Alpha of Tribes',
    replace: ['Inspiring Presence'],
    name: 'Tribal Cadence',
    description:
      'Beastfolk units in your army beginning activation inside Command Radius adjacent to another Beastfolk gain +1 Move.',
  },
  {
    commander: 'Howling Matriarch',
    replace: ['Inspiring Presence'],
    name: "Matriarch's Pace",
    description:
      'Pack units in your army beginning activation inside Command Radius gain +1 Move.',
  },
  {
    commander: 'Null Architect Void',
    replace: ['Inspiring Presence'],
    name: 'Vector March',
    description:
      'Construct units in your army beginning activation inside Command Radius gain Open Ground (+1 Hit on Plains).',
  },
  {
    commander: 'Prime Directive Core',
    replace: ['Inspiring Presence'],
    name: 'Directive Tempo',
    description:
      'Construct units in your army gain +1 Move on their first activation each round while inside Command Radius.',
  },
  {
    commander: 'Ashen Blood Sovereign',
    replace: ['Inspiring Presence'],
    name: 'Ashwind',
    description:
      'Once per activation, a Demon unit in your army that destroys an enemy inside Command Radius may Move 1.',
  },
  {
    commander: 'Hoard Sovereign Khar',
    replace: ['Inspiring Presence'],
    name: 'Hoard Routes',
    description:
      'Dragon units in your army beginning activation inside Command Radius gain Ashborn (+1 Hit on Volcanic).',
  },
  {
    commander: 'Kindred Tyrant',
    replace: ['Inspiring Presence'],
    name: 'Kindred Flightpaths',
    description:
      'Dragon and Flying units in your army beginning activation inside Command Radius gain +1 Move.',
  },
  {
    commander: 'Thane of All Holds',
    replace: ['Inspiring Presence'],
    name: 'Stone Highways',
    description:
      'Dwarf units in your army beginning activation inside Command Radius gain +1 Move and Mountainborn (+1 Harden in Mountains).',
  },
  {
    commander: 'Green Court Sovereign',
    replace: ['Inspiring Presence'],
    name: 'Court Paths',
    description:
      'Elf units in your army beginning activation inside Command Radius gain +1 Move while in Forest. Additionally, they gain Woodwalker (+1 Hit in Forest).',
  },
  {
    commander: 'Rootweave Mystic',
    replace: ['Disciplined Advance'],
    name: 'Rootways',
    description:
      'Nature units in your army beginning activation inside Command Radius gain Amphibious (treat Water as normal terrain) and Woodwalker (+1 Hit in Forest).',
  },
  {
    commander: 'Starfall Huntress',
    replace: ['Inspiring Presence'],
    name: 'Starlit Stride',
    description:
      'Flying and Scout units in your army beginning activation inside Command Radius gain +1 Move.',
  },
  {
    commander: 'Whispercanopy Huntress',
    replace: ['Inspiring Presence'],
    name: 'Canopy Lanes',
    description:
      'Scout and Stealth units in your army beginning activation inside Command Radius gain +1 Move.',
  },
  {
    commander: 'Hearthstone Covenant',
    replace: ['Inspiring Presence'],
    name: 'Hearth Roads',
    description:
      'Infantry in your army beginning activation inside Command Radius gain +1 Move if they end that move closer to an objective.',
  },
  {
    commander: 'Iron Covenant Spear',
    replace: ['Inspiring Presence'],
    name: 'Spearpoint Advance',
    description:
      'Infantry in your army that moved toward the nearest enemy during activation inside Command Radius gain +1 Hit on their first attack.',
  },
  {
    commander: 'Realmward High Marshal',
    replace: ['Inspiring Presence'],
    name: 'Realmward March',
    description:
      'Human units in your army beginning activation inside Command Radius gain +1 Move.',
  },
  {
    commander: 'Thunderhoof Caller',
    replace: ['Disciplined Advance'],
    name: 'Open Ground',
    description:
      'Cavalry and Beast units in your army beginning activation inside Command Radius gain +1 Move and Open Ground (+1 Hit on Plains).',
  },
  {
    commander: 'Fenbrood Scale-King',
    replace: ['Inspiring Presence'],
    name: 'Fen Drift',
    description:
      'Lizardman units in your army beginning activation inside Command Radius gain +1 Move while in Water or Swamp. Additionally, they gain Bogstrider (+1 Hit in Swamp).',
  },
  {
    commander: 'Hydra Broodmother',
    replace: ['Disciplined Advance'],
    name: 'Regen Paths',
    description:
      'Beast units in your army beginning activation inside Command Radius gain +1 Move and Woodwalker (+1 Hit in Forest).',
  },
  {
    commander: 'Scalefen Summit',
    replace: ['Inspiring Presence'],
    name: 'Summit Currents',
    description:
      'Amphibious units in your army beginning activation inside Command Radius gain +1 Move.',
  },
  {
    commander: 'Lord of the Still Host',
    replace: ['Inspiring Presence'],
    name: 'Still Paths',
    description:
      'Undead units in your army beginning activation inside Command Radius gain +1 Move and Bogstrider (+1 Hit in Swamp).',
  },
]

function insertAbility(name, description, usedBy) {
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
      ability_type=excluded.ability_type,
      cost=excluded.cost,
      description=excluded.description,
      used_by=excluded.used_by,
      search_blob=excluded.search_blob
  `).run(row)
}

function scorePassive(passive, card) {
  const bag = new Set(
    [
      card.race,
      card.role,
      card.primary_type,
      card.secondary_type,
      ...card.keywords,
    ]
      .filter(Boolean)
      .map((s) => String(s)),
  )
  let score = 0
  for (const tag of passive.tags) {
    if (bag.has(tag)) score += 3
  }
  // Soft preferences
  if (passive.tags.includes(card.role)) score += 1
  return score
}

const useCounts = new Map(OFFICER_PASSIVES.map((p) => [p.name, 0]))

function pickPassives(card, needed) {
  const have = new Set(card.abilities)
  const picks = []
  for (let n = 0; n < needed; n++) {
    const ranked = OFFICER_PASSIVES.map((p) => ({
      p,
      score:
        scorePassive(p, card) * 10 -
        (useCounts.get(p.name) || 0) * 5 -
        (have.has(p.name) || picks.includes(p.name) ? 1000 : 0) -
        ((useCounts.get(p.name) || 0) >= OFFICER_MAX_USES ? 1000 : 0),
    })).sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))

    const choice = ranked.find(
      (r) =>
        !have.has(r.p.name) &&
        !picks.includes(r.p.name) &&
        (useCounts.get(r.p.name) || 0) < OFFICER_MAX_USES,
    )
    if (!choice) break
    picks.push(choice.p.name)
    useCounts.set(choice.p.name, (useCounts.get(choice.p.name) || 0) + 1)
  }
  return picks
}

const updateCard = db.prepare(
  `UPDATE cards SET abilities_json = ?, search_blob = ? WHERE id = ?`,
)

const tx = db.transaction(() => {
  for (const p of OFFICER_PASSIVES) {
    insertAbility(p.name, p.description, 'Officer')
  }
  for (const c of COMMANDER_PASSIVES) {
    insertAbility(c.name, c.description, 'Commander')
  }

  // Seed use counts from any preexisting assignments of these names
  for (const row of db
    .prepare(`SELECT abilities_json FROM cards WHERE card_type='Officer'`)
    .all()) {
    const abs = JSON.parse(row.abilities_json || '[]')
    for (const a of abs) {
      if (useCounts.has(a)) useCounts.set(a, (useCounts.get(a) || 0) + 1)
    }
  }

  const officers = db
    .prepare(
      `SELECT * FROM cards WHERE card_type='Officer' ORDER BY race, name`,
    )
    .all()
    .map((c) => ({
      ...c,
      abilities: JSON.parse(c.abilities_json || '[]'),
      keywords: JSON.parse(c.keywords_json || '[]'),
      tags: JSON.parse(c.tags_json || '[]'),
    }))

  let officerChanges = 0
  for (const card of officers) {
    const removed = card.abilities.filter((a) => REMOVE.has(a))
    if (!removed.length) continue
    const kept = card.abilities.filter((a) => !REMOVE.has(a))
    const picks = pickPassives(
      { ...card, abilities: kept },
      removed.length,
    )
    const next = [...picks, ...kept]
    // Deduplicate while preserving order
    const seen = new Set()
    const unique = next.filter((n) => {
      if (seen.has(n)) return false
      seen.add(n)
      return true
    })
    const search = cardSearchBlob(card, unique, card.keywords, card.tags)
    updateCard.run(JSON.stringify(unique), search, card.id)
    officerChanges += 1
    console.log(
      `Officer ${card.name}: -[${removed.join(', ')}] +[${picks.join(', ')}]`,
    )
  }

  let commanderChanges = 0
  for (const spec of COMMANDER_PASSIVES) {
    const card = db
      .prepare(`SELECT * FROM cards WHERE name = ? AND card_type='Commander'`)
      .get(spec.commander)
    if (!card) throw new Error(`Missing commander ${spec.commander}`)
    const abilities = JSON.parse(card.abilities_json || '[]')
    const keywords = JSON.parse(card.keywords_json || '[]')
    const tags = JSON.parse(card.tags_json || '[]')
    let next = abilities.filter((a) => !spec.replace.includes(a))
    if (!next.includes(spec.name)) next = [spec.name, ...next]
    const search = cardSearchBlob(card, next, keywords, tags)
    updateCard.run(JSON.stringify(next), search, card.id)
    commanderChanges += 1
    console.log(
      `Commander ${spec.commander}: -[${spec.replace.join(', ')}] +${spec.name}`,
    )
  }

  return { officerChanges, commanderChanges }
})

const result = tx()
console.log('\nDone.', result)

// Summary
const counts = new Map()
for (const row of db
  .prepare(
    `SELECT card_type, abilities_json FROM cards WHERE card_type IN ('Officer','Commander')`,
  )
  .all()) {
  for (const a of JSON.parse(row.abilities_json || '[]')) {
    counts.set(a, (counts.get(a) || 0) + 1)
  }
}
console.log('\nRemaining overused:')
for (const n of REMOVE) console.log(`  ${n}: ${counts.get(n) || 0}`)
console.log('\nNew officer passive usage:')
for (const p of OFFICER_PASSIVES) {
  console.log(`  ${(counts.get(p.name) || 0).toString().padStart(2)}  ${p.name}`)
}
console.log('\nNew commander passive usage:')
for (const p of COMMANDER_PASSIVES) {
  console.log(`  ${(counts.get(p.name) || 0).toString().padStart(2)}  ${p.name}`)
}
