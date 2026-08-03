/**
 * Re-audit: commanders must not have company-scoped non-Rally abilities,
 * and used_by must match card role taxonomy.
 */
import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const db = new Database(path.join(root, 'data', 'command-warfare.sqlite'), {
  readonly: true,
})

const companyRe = /\bthis company'?s?\b|\bof this company\b/i
const keep = new Set(['Rally', 'Covenant Drill', 'Ruin Tithe'])

let fail = 0
for (const c of db
  .prepare(`SELECT name, abilities_json FROM cards WHERE card_type='Commander'`)
  .all()) {
  for (const n of JSON.parse(c.abilities_json || '[]')) {
    const a = db
      .prepare('SELECT used_by, description FROM abilities WHERE name = ?')
      .get(n)
    const ub = (a?.used_by || '').trim()
    const company = companyRe.test(a?.description || '') && !keep.has(n)
    if (ub !== 'Commander' || company) {
      console.error('FAIL', c.name, n, ub, company)
      fail++
    }
  }
}

const shared = new Map()
for (const c of db.prepare(`SELECT card_type, abilities_json FROM cards`).all()) {
  for (const n of JSON.parse(c.abilities_json || '[]')) {
    if (!shared.has(n)) shared.set(n, new Set())
    shared.get(n).add(c.card_type)
  }
}
for (const [n, types] of shared) {
  if (types.has('Commander') && (types.has('Officer') || types.has('Unit'))) {
    console.error('SHARED', n, [...types])
    fail++
  }
}

console.log(fail === 0 ? 'OK: commander tiers clean' : `FAILED: ${fail} issues`)
db.close()
process.exit(fail === 0 ? 0 : 1)
