/**
 * Bump printed command_radius by +2 (officers / commanders).
 * Usage: npx tsx scripts/bumpCommandRadius.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../data/cards')
const BUMP = 2

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.ya?ml$/i.test(e.name)) out.push(p)
  }
  return out
}

let files = 0
let cards = 0
for (const file of walk(ROOT)) {
  const text = fs.readFileSync(file, 'utf8')
  let n = 0
  const next = text.replace(
    /^(\s+command_radius:\s*)(\d+)\s*$/gm,
    (_m, prefix: string, num: string) => {
      n++
      return `${prefix}${Number(num) + BUMP}`
    },
  )
  if (n === 0 || next === text) continue
  fs.writeFileSync(file, next, 'utf8')
  files++
  cards += n
  console.log(`+${BUMP} on ${n} radii in ${path.relative(ROOT, file)}`)
}
console.log(`Done. ${cards} radii in ${files} files.`)
console.log('Re-import: npm run import:yaml')
