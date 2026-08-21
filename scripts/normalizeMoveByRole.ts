/**
 * Normalize printed Move on cards:
 *   Mounted → 7
 *   Siege (primary_type or keyword) → 3
 *   Shieldwall → 4
 *   otherwise → 5 (Flying keeps max(current, 5))
 *
 * Usage: npx tsx scripts/normalizeMoveByRole.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../data/cards')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.ya?ml$/i.test(e.name)) out.push(p)
  }
  return out
}

function targetMove(block: string): number | null {
  if (!/\n\s+move:\s*\d+/.test(block)) return null
  const kwMatch = block.match(/\n\s+keywords:\n((?:\s+-\s+.+\n)*)/)
  const keywords = kwMatch
    ? [...kwMatch[1].matchAll(/-\s+(.+)/g)].map((m) => m[1].trim())
    : []
  const primary =
    block.match(/\n\s+primary_type:\s*(.+)/)?.[1]?.trim().replace(/^['"]|['"]$/g, '') ??
    ''
  const has = (name: string) =>
    keywords.some((k) => k === name || k.startsWith(`${name} `)) ||
    primary.toLowerCase() === name.toLowerCase()

  if (has('Mounted')) return 7
  if (has('Siege') || primary.toLowerCase() === 'siege') return 3
  if (has('Shieldwall')) return 4
  const cur = Number(block.match(/\n\s+move:\s*(\d+)/)?.[1] ?? 5)
  if (has('Flying')) return Math.max(cur, 5)
  return 5
}

function patchBlock(block: string): { block: string; changed: boolean } {
  const target = targetMove(block)
  if (target == null) return { block, changed: false }
  const next = block.replace(/\n(\s+)move:\s*\d+/, `\n$1move: ${target}`)
  return { block: next, changed: next !== block }
}

let filesChanged = 0
let cardsChanged = 0
for (const file of walk(ROOT)) {
  const text = fs.readFileSync(file, 'utf8')
  // Card blocks under list items starting with "  - id:"
  const parts = text.split(/\n(?=  - id:)/)
  if (parts.length < 2) continue
  let changed = false
  const header = parts[0]!
  const blocks = parts.slice(1).map((b) => {
    const r = patchBlock(b.startsWith('  - id:') ? b : `  - id:${b}`)
    if (r.changed) {
      changed = true
      cardsChanged++
    }
    return r.block
  })
  if (!changed) continue
  fs.writeFileSync(file, [header, ...blocks].join('\n').replace(/^\n/, ''), 'utf8')
  filesChanged++
  console.log(`updated ${path.relative(ROOT, file)}`)
}
console.log(`Done. ${cardsChanged} cards in ${filesChanged} files.`)
console.log('Re-import YAML into SQLite: npm run import:yaml')
