import { getDb } from './db.ts'

const rows = getDb()
  .prepare(
    "SELECT name, cc_generation AS cc FROM cards WHERE card_type = 'Commander' ORDER BY name",
  )
  .all() as Array<{ name: string; cc: number }>

console.log(rows)
console.log(
  'below 5:',
  rows.filter((r) => r.cc < 5).length,
)
