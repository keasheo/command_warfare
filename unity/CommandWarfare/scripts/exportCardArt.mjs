/**
 * Copy data/art card images → Assets/StreamingAssets/CardArt for Unity CardArtLoader.
 * Usage: node unity/CommandWarfare/scripts/exportCardArt.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')
const src = path.resolve(process.argv[2] ?? path.join(repoRoot, 'data/art'))
const out = path.resolve(
  process.argv[3] ??
    path.join(repoRoot, 'unity/CommandWarfare/Assets/StreamingAssets/CardArt'),
)

const exts = new Set(['.png', '.jpg', '.jpeg', '.webp'])
if (!fs.existsSync(src)) {
  console.error('Art dir missing:', src)
  process.exit(1)
}

fs.mkdirSync(out, { recursive: true })
let n = 0
for (const name of fs.readdirSync(src)) {
  const ext = path.extname(name).toLowerCase()
  if (!exts.has(ext)) continue
  fs.copyFileSync(path.join(src, name), path.join(out, name))
  n++
}
console.log(`Copied ${n} card art files → ${out}`)
