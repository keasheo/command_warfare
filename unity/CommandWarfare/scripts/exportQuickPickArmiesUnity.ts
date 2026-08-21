/**
 * Export resolved quick-pick armies as pre-built WebSocket actions for Unity.
 * Usage: tsx unity/CommandWarfare/scripts/exportQuickPickArmiesUnity.ts [outPath]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  listQuickPickPresets,
  loadQuickPickArmy,
} from '../../../play/server/demoArmy.ts'
import {
  defaultBattleLoadout,
  resolveArmy,
  type ArmyList,
} from '../../../play/shared/army.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outPath = path.resolve(
  process.argv[2] ??
    path.join(__dirname, '../Assets/Data/quick-pick-armies-unity.json'),
)

function confirmForceSelectJson(
  army: ArmyList,
  cards: import('../../../play/shared/army.ts').CardSnapshot[],
): string {
  const lookup = new Map(cards.map((c) => [c.id, c]))
  const resolved = resolveArmy(army, lookup, { enforceCommanderRace: true })
  if (!resolved.ok) {
    throw new Error(`Cannot resolve army for force select: ${resolved.error}`)
  }
  const battleLoadout = defaultBattleLoadout(resolved.army)
  return JSON.stringify({ type: 'confirmForceSelect', battleLoadout })
}

const presets = listQuickPickPresets()
const exported = presets.map((p) => {
  const pack = loadQuickPickArmy(p.commanderId)
  return {
    commanderId: p.commanderId,
    commanderName: p.commanderName,
    race: p.race,
    totalUv: p.totalUv,
    companyCount: p.companyCount,
    submitArmyJson: JSON.stringify({
      type: 'submitArmy',
      army: pack.army,
      cards: pack.cards,
    }),
    confirmForceSelectJson: confirmForceSelectJson(pack.army, pack.cards),
  }
})

const doc = {
  version: 1,
  generatedAt: new Date().toISOString(),
  presetCount: exported.length,
  presets: exported,
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(doc, null, 2))
console.log(`Exported ${exported.length} quick-pick presets → ${outPath}`)
