/**
 * Export data/docs/rulebook.yaml → Assets/Data/rulebook-unity.json (flat for JsonUtility)
 * Usage: node unity/CommandWarfare/scripts/exportRulebookJson.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as loadYaml } from 'js-yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')
const src = path.resolve(process.argv[2] ?? path.join(repoRoot, 'data/docs/rulebook.yaml'))
const out = path.resolve(
  process.argv[3] ?? path.join(repoRoot, 'unity/CommandWarfare/Assets/Data/rulebook-unity.json'),
)

function flatten(sections, depth, outList) {
  if (!Array.isArray(sections)) return
  for (const s of sections) {
    if (!s) continue
    outList.push({
      id: s.id ?? '',
      title: s.title ?? '',
      body: s.body ?? '',
      depth,
    })
    flatten(s.children, depth + 1, outList)
  }
}

const doc = loadYaml(fs.readFileSync(src, 'utf8'))
const sections = []
flatten(doc?.sections, 0, sections)

const exported = {
  title: doc?.title ?? 'Rulebook',
  exportedAt: new Date().toISOString(),
  sections,
}

fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(exported))
console.log(`Exported ${sections.length} flat rulebook sections → ${out}`)
