/**
 * Export keywords.yaml for Unity JsonUtility.
 * Usage: node unity/CommandWarfare/scripts/exportKeywordsJson.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as loadYaml } from 'js-yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')
const src = path.join(repoRoot, 'data/keywords.yaml')
const outPath = path.join(repoRoot, 'unity/CommandWarfare/Assets/Data/keywords-unity.json')

const raw = loadYaml(fs.readFileSync(src, 'utf8'))
const keywords = []
for (const [name, doc] of Object.entries(raw ?? {})) {
  if (!doc || typeof doc !== 'object') continue
  keywords.push({
    name,
    description: doc.description ?? '',
    tags: doc.tags ?? [],
  })
}
keywords.sort((a, b) => a.name.localeCompare(b.name))
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify({ keywords, exportedAt: new Date().toISOString() }, null, 2))
console.log(`Exported ${keywords.length} keywords → ${outPath}`)
