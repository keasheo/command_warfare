/**
 * Normalize UV 1–2 Unit combat stats in place (preserves YAML formatting):
 * - UV 1 → damage 1, toughness 2
 * - UV 2 → damage 2, toughness 3
 *   (Formation March with ≤1 damage keeps damage 1, toughness 3)
 *
 * Usage: npx tsx scripts/normalizeLowUvUnits.ts
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
    else if (e.name === 'units.yaml') out.push(p)
  }
  return out
}

/** Split units.yaml into card blocks (each starts with "  - id:"). */
function splitCardBlocks(text: string): { header: string; blocks: string[] } {
  const marker = /\n  - id:/g
  const indices: number[] = []
  let m: RegExpExecArray | null
  while ((m = marker.exec(text))) {
    indices.push(m.index + 1) // start at "  - id:"
  }
  if (!indices.length) {
    // maybe first card at start after "cards:\n"
    const first = text.indexOf('\n  - id:')
    if (first < 0) return { header: text, blocks: [] }
  }
  const header = text.slice(0, indices[0])
  const blocks: string[] = []
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i]!
    const end = i + 1 < indices.length ? indices[i + 1]! : text.length
    blocks.push(text.slice(start, end))
  }
  return { header, blocks }
}

function fieldNum(block: string, key: string): number | null {
  const re = new RegExp(`^    ${key}:\\s*(-?\\d+)\\s*$`, 'm')
  const m = block.match(re)
  return m ? Number(m[1]) : null
}

function setField(block: string, key: string, value: number): string {
  const re = new RegExp(`^(    ${key}:\\s*)(-?\\d+)(\\s*)$`, 'm')
  if (!re.test(block)) return block
  return block.replace(re, `$1${value}$3`)
}

function hasFormationMarch(block: string): boolean {
  return /Formation March/.test(block)
}

type Change = {
  file: string
  name: string
  uv: number
  before: { d: number; t: number }
  after: { d: number; t: number }
  note?: string
}

const changes: Change[] = []
let uv1 = 0
let uv2 = 0

for (const file of walk(ROOT)) {
  const raw = fs.readFileSync(file, 'utf8')
  const { header, blocks } = splitCardBlocks(raw)
  if (!blocks.length) continue

  let dirty = false
  const nextBlocks = blocks.map((block) => {
    if (!/card_type:\s*Unit/.test(block)) return block
    const uv = fieldNum(block, 'uv')
    const d = fieldNum(block, 'damage')
    const t = fieldNum(block, 'toughness')
    if (uv == null || d == null || t == null) return block

    const nameMatch = block.match(/^    name:\s*(.+)\s*$/m)
    const name = nameMatch?.[1]?.trim() ?? '?'

    if (uv === 1) {
      uv1++
      if (d !== 1 || t !== 2) {
        dirty = true
        changes.push({
          file: path.relative(path.resolve(__dirname, '..'), file),
          name,
          uv: 1,
          before: { d, t },
          after: { d: 1, t: 2 },
        })
        return setField(setField(block, 'damage', 1), 'toughness', 2)
      }
    } else if (uv === 2) {
      uv2++
      const march = hasFormationMarch(block)
      const targetD = march && d <= 1 ? 1 : 2
      const targetT = 3
      if (d !== targetD || t !== targetT) {
        dirty = true
        changes.push({
          file: path.relative(path.resolve(__dirname, '..'), file),
          name,
          uv: 2,
          before: { d, t },
          after: { d: targetD, t: targetT },
          note: march && targetD === 1 ? 'Formation March support' : undefined,
        })
        return setField(setField(block, 'damage', targetD), 'toughness', targetT)
      }
    }
    return block
  })

  if (dirty) {
    // Preserve trailing newline style
    const body = nextBlocks.join('')
    const out = header + body
    fs.writeFileSync(file, out.endsWith('\n') ? out : out + '\n', 'utf8')
  }
}

console.log(
  JSON.stringify(
    {
      uv1Total: uv1,
      uv2Total: uv2,
      uv1Changed: changes.filter((c) => c.uv === 1).length,
      uv2Changed: changes.filter((c) => c.uv === 2).length,
      totalChanged: changes.length,
      changes,
    },
    null,
    2,
  ),
)
