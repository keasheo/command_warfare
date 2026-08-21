/**
 * Export abilities YAML to JSON for Unity JsonUtility.
 * Usage: node unity/CommandWarfare/scripts/exportAbilitiesJson.mjs [dataRoot] [outPath]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as loadYaml } from 'js-yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')
const dataRoot = path.resolve(process.argv[2] ?? path.join(repoRoot, 'data'))
const outPath = path.resolve(
  process.argv[3] ?? path.join(repoRoot, 'unity/CommandWarfare/Assets/Data/abilities-unity.json'),
)

const abilitiesPath = path.join(dataRoot, 'abilities.yaml')
if (!fs.existsSync(abilitiesPath)) {
  console.error('abilities.yaml not found:', abilitiesPath)
  process.exit(1)
}

const raw = loadYaml(fs.readFileSync(abilitiesPath, 'utf8'))
const abilities = []

function toUnityAbility(name, a) {
  return {
    name,
    type: a.type ?? '',
    cost: a.cost ?? '',
    costAmount: a.cost_amount ?? 0,
    costResource: a.cost_resource ?? '',
    description: a.description ?? '',
    affects: a.affects ?? '',
    usedBy: a.used_by ?? '',
    cooldown: a.cooldown ?? 0,
    tags: a.tags ?? [],
  }
}

for (const [name, doc] of Object.entries(raw ?? {})) {
  if (!doc || typeof doc !== 'object') continue
  abilities.push(toUnityAbility(name, doc))
}

abilities.sort((a, b) => a.name.localeCompare(b.name))

const exportedAt = new Date().toISOString()
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify({ abilities, exportedAt }, null, 2))
console.log(`Exported ${abilities.length} abilities → ${outPath}`)
