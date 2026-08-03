/**
 * Replace stripped CC slots on 9 officers with unique company-scoped passives.
 */
import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const db = new Database(path.join(root, 'data', 'command-warfare.sqlite'))

function abilitySearchBlob(row) {
  return Object.values(row)
    .filter((v) => v != null && v !== '')
    .map(String)
    .join(' ')
    .toLowerCase()
}

function cardSearchBlob(card) {
  const parts = []
  for (const [key, value] of Object.entries(card)) {
    if (value == null || value === '' || key === 'search_blob') continue
    if (Array.isArray(value)) parts.push(...value.map(String))
    else parts.push(String(value))
  }
  return parts.join(' ').toLowerCase()
}

/** @type {{ name: string, description: string, officer: string }[]} */
const passives = [
  {
    officer: 'Beastmaster Rowan',
    name: 'Named Fangs',
    description:
      "Beast units of this company in Command Radius gain +1 Hit against enemies that damaged a Beast of this company this round.",
  },
  {
    officer: 'Stampede Caller',
    name: 'Dust Declaration',
    description:
      'Cavalry of this company that moved at least 2 hexes this activation gain +1 Damage on their first attack this activation.',
  },
  {
    officer: 'Hoofthunder Lead',
    name: 'Aftershock Charge',
    description:
      'When a Cavalry unit of this company completes a Charge in Command Radius, enemies adjacent to it gain Slow until end of round.',
  },
  {
    officer: 'Scale Guard Officer Brak',
    name: 'Eyes on Sky',
    description:
      'While a Flying unit in your army is within this Command Radius, Infantry of this company gain Harden 1.',
  },
  {
    officer: 'Wyrm Priest Solace',
    name: 'Ozone Liturgy',
    description:
      'Spellcaster units of this company in Command Radius gain +1 Range.',
  },
  {
    officer: 'Basalt Scale Captain',
    name: 'Stoneblood Plates',
    description:
      'Heavy units of this company in Command Radius that have not moved this activation gain Harden 1.',
  },
  {
    officer: 'Oathkeeper Ysra',
    name: 'Scar Ledger',
    description:
      'Damaged units of this company in Command Radius gain +1 Hit.',
  },
  {
    officer: 'Oathbinder Mira',
    name: 'Spoken Bond',
    description:
      'When you restore Toughness to a unit of this company in Command Radius, restore 1 Toughness to one adjacent unit of this company.',
  },
  {
    officer: 'Soul Tither Coin',
    name: 'Grave Interest',
    description:
      'Undead of this company in Command Radius gain +1 Damage while this company has fewer living units than it began the battle with.',
  },
]

const insertAbility = db.prepare(`
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
    cost_amount=excluded.cost_amount,
    cost_resource=excluded.cost_resource,
    description=excluded.description,
    used_by=excluded.used_by,
    cooldown=excluded.cooldown,
    tags_json=excluded.tags_json,
    search_blob=excluded.search_blob
`)

const getOfficer = db.prepare(
  `SELECT * FROM cards WHERE name = ? AND card_type = 'Officer'`,
)
const updateOfficer = db.prepare(
  `UPDATE cards SET abilities_json = ?, search_blob = ? WHERE id = ?`,
)

const tx = db.transaction(() => {
  for (const p of passives) {
    const abilityRow = {
      name: p.name,
      ability_type: 'Passive',
      cost: 'Passive',
      cost_amount: null,
      cost_resource: null,
      description: p.description,
      affects: null,
      affect_count: null,
      radius_from: null,
      radius_size: null,
      used_by: 'Officer',
      cooldown: null,
      tags_json: '[]',
      search_blob: '',
    }
    abilityRow.search_blob = abilitySearchBlob(abilityRow)
    insertAbility.run(abilityRow)

    const card = getOfficer.get(p.officer)
    if (!card) throw new Error(`Officer not found: ${p.officer}`)
    let abilities = []
    try {
      abilities = JSON.parse(card.abilities_json || '[]')
    } catch {
      abilities = []
    }
    if (!abilities.includes(p.name)) {
      // Passives first, keep existing order otherwise.
      abilities = [p.name, ...abilities.filter((n) => n !== p.name)]
    }

    const keywords = JSON.parse(card.keywords_json || '[]')
    const tags = JSON.parse(card.tags_json || '[]')
    const search = cardSearchBlob({
      ...card,
      abilities,
      keywords,
      tags,
      unique: Boolean(card.unique_flag),
      abilities_json: undefined,
      keywords_json: undefined,
      tags_json: undefined,
    })
    updateOfficer.run(JSON.stringify(abilities), search, card.id)
    console.log(`${p.officer} ← ${p.name}`)
  }
})

tx()
console.log(`Done: ${passives.length} officer passives.`)
