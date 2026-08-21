/**
 * Copy data/art/{cardId}.png → unity/CommandWarfare/Assets/Art/Cards/
 * Usage: node unity/CommandWarfare/scripts/syncCardArtToUnity.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')
const srcDir = path.join(repoRoot, 'data/art')
const outDir = path.join(repoRoot, 'unity/CommandWarfare/Assets/Art/Cards')

if (!fs.existsSync(srcDir)) {
  console.error('Missing', srcDir)
  process.exit(1)
}

fs.mkdirSync(outDir, { recursive: true })
let copied = 0
let skipped = 0
for (const name of fs.readdirSync(srcDir)) {
  if (!name.endsWith('.png')) continue
  const from = path.join(srcDir, name)
  const to = path.join(outDir, name)
  const srcStat = fs.statSync(from)
  if (fs.existsSync(to) && fs.statSync(to).size === srcStat.size) {
    skipped++
    continue
  }
  fs.copyFileSync(from, to)
  copied++
}
console.log(`Card art: copied ${copied}, unchanged ${skipped} → ${outDir}`)
