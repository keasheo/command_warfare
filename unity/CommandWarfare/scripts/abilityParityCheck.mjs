/**
 * Lists ability effectNames implemented in C# AbilityCastResolver vs named blocks in game.ts.
 * Usage: node unity/CommandWarfare/scripts/abilityParityCheck.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')
const csPath = path.join(repoRoot, 'unity/CommandWarfare/Assets/Scripts/Core/State/AbilityCastResolver.cs')
const tsPath = path.join(repoRoot, 'play/shared/game.ts')

const cs = fs.readFileSync(csPath, 'utf8')
const ts = fs.readFileSync(tsPath, 'utf8')

const csCases = new Set(
  [...cs.matchAll(/case\s+"([^"]+)":/g)].map((m) => m[1].toLowerCase()),
)

const tsEffects = new Set()
for (const m of ts.matchAll(/effectName\s*===\s*'([^']+)'/g)) {
  tsEffects.add(m[1].toLowerCase())
}
for (const m of ts.matchAll(/effectName\s*===\s*"([^"]+)"/g)) {
  tsEffects.add(m[1].toLowerCase())
}
for (const m of ts.matchAll(/opts\.abilityName\s*===\s*'([^']+)'/g)) {
  tsEffects.add(m[1].toLowerCase())
}
for (const m of ts.matchAll(/opts\.abilityName\s*===\s*"([^"]+)"/g)) {
  tsEffects.add(m[1].toLowerCase())
}

const missingInCs = [...tsEffects].filter((e) => !csCases.has(e)).sort()
const extraInCs = [...csCases].filter((e) => !tsEffects.has(e)).sort()

console.log(`TS named effects/ability hooks: ${tsEffects.size}`)
console.log(`C# switch cases: ${csCases.size}`)
console.log(`\nMissing in C# (${missingInCs.length}):`)
for (const e of missingInCs) console.log(`  - ${e}`)
console.log(`\nC# cases not matched in TS scan (${extraInCs.length}):`)
for (const e of extraInCs) console.log(`  - ${e}`)
