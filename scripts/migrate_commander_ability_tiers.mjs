/**
 * Commander ability tier migration:
 * - Create commander-native replacements for company-scoped / shared officer abilities
 * - Swap those onto commander cards
 * - Retag officer/unit used_by for taxonomy (Officer|Both|Unit|Commander)
 */
import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const db = new Database(path.join(root, 'data', 'command-warfare.sqlite'))

function searchBlob(row) {
  return Object.values(row)
    .filter((v) => v != null && v !== '')
    .map(String)
    .join(' ')
    .toLowerCase()
}

function assertLen(name, description) {
  const n = description.replace(/\s+/g, ' ').trim().length
  if (n > 175) throw new Error(`${name} description is ${n} chars (>175): ${description}`)
}

/** officerName -> { commanderName, description, cost?, cost_amount?, cost_resource?, cooldown? } */
const REPLACEMENTS = {
  'Alpha Mark': {
    name: 'Pack Mark',
    description:
      'Choose an enemy in Command Radius. Pack attacks from your army gain +1 Hit against it until end of round.',
  },
  'Anvil Advance': {
    name: 'Anvil Push',
    description:
      'Units in your army in Command Radius gain Harden 2 and may Move 1 toward an objective.',
  },
  'Battery Link': {
    name: 'Battery Volley',
    description:
      'Each Siege or Construct unit in Command Radius may make one free attack.',
  },
  "Beastmaster's Call": {
    name: 'Beast Banner',
    description: 'Beast units in your army in Command Radius gain +1 Move this round.',
  },
  'Brood Call': {
    name: 'Brood Banner',
    description:
      'Dragon units in Command Radius gain +1 Move and +1 Damage this round.',
  },
  'Cannon Drill': {
    name: 'Siege Drill',
    description: 'Siege units in Command Radius gain +1 Damage this activation.',
  },
  'Crypt Demolish': {
    name: 'Crypt Claim',
    description:
      'Demolish an enemy Fortification in Command Radius. If removed, return one destroyed unit of your army adjacent at 1 Toughness if space allows (no new units).',
  },
  'Death March': {
    name: 'Still Host March',
    description:
      'Undead units in Command Radius ignore Slow and gain +1 Move this round.',
  },
  'Draft Beasts': {
    name: 'Beast Haul',
    description:
      'Siege units in Command Radius adjacent to a Beast of your army gain +1 Move this activation.',
  },
  'Ember Burst': {
    name: 'Ember Mandate',
    description:
      'Choose a Dragon in Command Radius. Its next attack this activation is Blast 1 and gains +1 Damage.',
  },
  'Fortify Works': {
    name: 'Hold Works',
    description:
      'Fortify an occupied or adjacent hex in Command Radius. If occupied by a unit of your army, that unit gains Harden 1 until end of round.',
  },
  'Harden Order': {
    name: 'Harden Decree',
    description: 'Choose a unit in Command Radius. It gains Harden 2 until next round.',
  },
  'Haul Lines': {
    name: 'Haul Order',
    description:
      'Choose a Siege in Command Radius adjacent to a non-Siege of your army. That Siege gains +1 Move this activation (it may still attack).',
  },
  'Hold the Gate': {
    name: 'Gate Decree',
    description:
      'Fortify an objective hex in Command Radius. If occupied by a unit of your army, that unit gains Harden 1 until end of round.',
  },
  'Hold the Line': {
    name: 'Line Decree',
    description: 'Infantry in Command Radius gain Harden 1 until end of round.',
  },
  'Inferno Cone': {
    name: 'Inferno Mandate',
    description:
      'Choose a Dragon in Command Radius. Its next attack this activation is Blast 2. Once per round.',
  },
  Lockstep: {
    name: 'Lockstep Doctrine',
    description:
      'Siege and Construct actions in Command Radius cost 1 less Company AP this round (minimum 1).',
  },
  'Mass Fear': {
    name: 'Dread Wave',
    description:
      'All enemies adjacent to units of your army in Command Radius gain Fear.',
  },
  Overdrive: {
    name: 'Overdrive Pulse',
    description:
      'Choose a Construct in Command Radius. It gains +1 Damage until end of round.',
  },
  'Pack Hunt': {
    name: 'Tribal Hunt',
    description:
      'Beast or Pack units in Command Radius gain +1 Damage and +1 Hit this activation.',
  },
  'Raise Thrall': {
    name: 'Raise Host',
    description:
      'Once per battle. Return a destroyed unit of your army in Command Radius at 2 Toughness (board edge or adjacent). It cannot use Revenant this battle.',
  },
  'Rebuild Protocol': {
    name: 'Rebuild Signal',
    description:
      'Repair 3 Toughness to a Construct or Siege unit in Command Radius.',
  },
  Repair: {
    name: 'Siege Repair',
    description: 'Restore 2 Toughness to a Siege unit in Command Radius.',
  },
  'Scale Ward': {
    name: 'Scale Aegis',
    description: 'Dragon units in Command Radius gain Harden 2 until end of round.',
    cost: '1 CC',
    cost_amount: 1,
    cost_resource: 'CC',
  },
  'Scorch Mark': {
    name: 'Scorch Decree',
    description:
      'Choose a Dragon in Command Radius. Its Breath/Blast attack gains Siege (+1 vs Fortified) this activation.',
  },
  'Sealant Coat': {
    name: 'Sealant Field',
    description:
      'Construct units in Command Radius gain Fearless, Harden 1, and ignore Poison until end of round.',
  },
  'Shield Brotherhood': {
    name: 'Shield Host',
    description: 'Infantry in Command Radius gain Shieldwall until end of round.',
  },
  'Siege Elevation': {
    name: 'Elevation Order',
    description:
      'Choose a Siege in Command Radius. It gains +1 Range this activation (may exceed printed max 3) and cannot move this activation.',
  },
  'Soul Tithe': {
    name: 'Soul Levy',
    description:
      'When a unit of your army is destroyed in Command Radius this round, gain 1 Company AP or give +1 Damage to one unit of your army until end of round.',
  },
  'Stone Line': {
    name: 'Stone Host',
    description:
      'Dwarves of your army adjacent to this Commander gain +1 Toughness until end of round.',
  },
  'Terror Dive': {
    name: 'Terror Mandate',
    description:
      'Choose a Dragon in Command Radius that moved at least 2 this activation. Its attack applies Fear.',
  },
  'Wild Rush': {
    name: 'Wild Mandate',
    description:
      'Beast or Cavalry units in Command Radius may count Charge after moving only 1 hex this activation.',
  },
  // Shared officer actives without "this company" — still need commander variants
  Howl: {
    name: 'Alpha Howl Call',
    description: 'Enemies adjacent to this Commander gain Fear.',
  },
  'Null Pulse': {
    name: 'Null Suppress',
    description:
      'Choose an enemy in Command Radius. It cannot use Actives until end of round.',
  },
  Sappers: {
    name: 'Breach Order',
    description:
      'Fortify a hex in Command Radius, then Demolish one enemy Fortification within 2 hexes.',
  },
  'Wing Buffet': {
    name: 'Wing Gust',
    description: 'Push an enemy adjacent to this Commander 1 hex.',
  },
  'Withering Gaze': {
    name: 'Wither Gaze',
    description: 'Choose an enemy within 3 hexes of this Commander. It gains Fear.',
  },
}

// Validate lengths
for (const [src, rep] of Object.entries(REPLACEMENTS)) {
  assertLen(rep.name, rep.description)
}

const insertAbility = db.prepare(`
  INSERT INTO abilities (
    name, ability_type, cost, cost_amount, cost_resource, description,
    affects, affect_count, radius_from, radius_size, used_by, cooldown, tags_json, search_blob
  ) VALUES (
    @name, @ability_type, @cost, @cost_amount, @cost_resource, @description,
    @affects, @affect_count, @radius_from, @radius_size, @used_by, @cooldown, @tags_json, @search_blob
  )
  ON CONFLICT(name) DO UPDATE SET
    ability_type=excluded.ability_type,
    cost=excluded.cost,
    cost_amount=excluded.cost_amount,
    cost_resource=excluded.cost_resource,
    description=excluded.description,
    affects=excluded.affects,
    affect_count=excluded.affect_count,
    radius_from=excluded.radius_from,
    radius_size=excluded.radius_size,
    used_by=excluded.used_by,
    cooldown=excluded.cooldown,
    tags_json=excluded.tags_json,
    search_blob=excluded.search_blob
`)

const run = db.transaction(() => {
  let created = 0
  for (const [srcName, rep] of Object.entries(REPLACEMENTS)) {
    const src = db.prepare('SELECT * FROM abilities WHERE name = ?').get(srcName)
    if (!src) {
      console.warn('Missing source ability', srcName)
      continue
    }
    const row = {
      name: rep.name,
      ability_type: src.ability_type || 'Active',
      cost: rep.cost ?? src.cost,
      cost_amount: rep.cost_amount ?? src.cost_amount,
      cost_resource: rep.cost_resource ?? src.cost_resource,
      description: rep.description,
      affects: src.affects,
      affect_count: src.affect_count,
      radius_from: 'Commander',
      radius_size: src.radius_size,
      used_by: 'Commander',
      cooldown: src.cooldown,
      tags_json: src.tags_json || '[]',
      search_blob: '',
    }
    row.search_blob = searchBlob(row)
    insertAbility.run(row)
    created++
  }

  // Swap on commander cards
  const cmds = db
    .prepare(`SELECT id, name, abilities_json FROM cards WHERE card_type = 'Commander'`)
    .all()
  let swapped = 0
  for (const c of cmds) {
    const abs = JSON.parse(c.abilities_json || '[]')
    let changed = false
    const next = abs.map((n) => {
      if (REPLACEMENTS[n]) {
        changed = true
        swapped++
        return REPLACEMENTS[n].name
      }
      return n
    })
    if (changed) {
      db.prepare('UPDATE cards SET abilities_json = ? WHERE id = ?').run(
        JSON.stringify(next),
        c.id,
      )
    }
  }

  // Retag: abilities that appear only on commanders → Commander (if not Ultimate)
  // abilities on officers → Officer or Both
  const allCards = db
    .prepare(`SELECT card_type, abilities_json, ultimate FROM cards`)
    .all()
  const usage = new Map() // name -> Set(card_type)
  for (const c of allCards) {
    const names = [...JSON.parse(c.abilities_json || '[]')]
    if (c.ultimate && c.card_type === 'Commander') {
      // ultimates stay as-is
    }
    for (const n of names) {
      if (!usage.has(n)) usage.set(n, new Set())
      usage.get(n).add(c.card_type)
    }
  }

  let retagged = 0
  for (const [name, types] of usage) {
    if (REPLACEMENTS[name]) continue // officer originals stay Officer
    const a = db.prepare('SELECT used_by, ability_type, cost FROM abilities WHERE name = ?').get(name)
    if (!a) continue
    if ((a.ability_type || '') === 'Ultimate' || (a.cost || '').toLowerCase() === 'ultimate') {
      continue
    }
    let next = (a.used_by || '').trim()
    const hasCmd = types.has('Commander')
    const hasOff = types.has('Officer')
    const hasUnit = types.has('Unit')
    if (hasCmd && !hasOff && !hasUnit) next = 'Commander'
    else if (hasOff && hasUnit) next = 'Both'
    else if (hasOff && !hasUnit) next = 'Officer'
    else if (hasUnit && !hasOff && !hasCmd) next = next || 'Unit'
    // If still on a commander after swaps, must be Commander
    if (hasCmd) next = 'Commander'

    if (next !== (a.used_by || '').trim()) {
      const row = db.prepare('SELECT * FROM abilities WHERE name = ?').get(name)
      row.used_by = next
      row.search_blob = searchBlob(row)
      db.prepare('UPDATE abilities SET used_by = ?, search_blob = ? WHERE name = ?').run(
        next,
        row.search_blob,
        name,
      )
      retagged++
    }
  }

  // Ensure Keep-as-is economy tools are Commander
  for (const n of ['Rally', 'Covenant Drill', 'Ruin Tithe']) {
    const row = db.prepare('SELECT * FROM abilities WHERE name = ?').get(n)
    if (!row) continue
    if ((row.used_by || '').trim() !== 'Commander') {
      row.used_by = 'Commander'
      row.search_blob = searchBlob(row)
      db.prepare('UPDATE abilities SET used_by = ?, search_blob = ? WHERE name = ?').run(
        'Commander',
        row.search_blob,
        n,
      )
      retagged++
    }
  }

  console.log({ created, swapped, retagged })
})

run()
db.close()
