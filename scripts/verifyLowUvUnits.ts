import Database from 'better-sqlite3'

const db = new Database('data/command-warfare.sqlite', { readonly: true })
const rows = db
  .prepare(
    `SELECT uv, damage, toughness, COUNT(*) AS n
     FROM cards
     WHERE card_type = 'Unit' AND uv IN (1, 2)
     GROUP BY uv, damage, toughness
     ORDER BY uv, damage, toughness`,
  )
  .all()
console.log(rows)

const outliers = db
  .prepare(
    `SELECT name, race, uv, damage, toughness
     FROM cards
     WHERE card_type = 'Unit'
       AND (
         (uv = 1 AND (damage != 1 OR toughness != 2))
         OR (uv = 2 AND toughness != 3)
         OR (uv = 2 AND damage NOT IN (1, 2))
       )
     ORDER BY uv, race, name`,
  )
  .all()
console.log('outliers', outliers)
