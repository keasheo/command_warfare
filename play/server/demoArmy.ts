/**
 * Load fixed quick-pick army presets (one per commander) from data/quick-pick-armies.json.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  resolveArmy,
  type ArmyList,
  type CardSnapshot,
} from '../shared/army.ts'
import {
  indexCardsByName,
  resolveNamedArmy,
  type NamedArmyList,
} from '../shared/armyFile.ts'
import { loadCardSnapshots } from './cards.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PRESETS_PATH = path.resolve(__dirname, '../../data/quick-pick-armies.json')

export type DemoArmyPack = {
  army: ArmyList
  cards: CardSnapshot[]
}

export type QuickPickPresetSummary = {
  commanderId: string
  commanderName: string
  race: string
  totalUv: number
  companyCount: number
}

type PresetFile = {
  version: number
  generatedAt: string
  presets: Record<
    string,
    QuickPickPresetSummary & { list: NamedArmyList }
  >
}

let cachedPresets: PresetFile | null = null

function loadPresetFile(): PresetFile {
  if (cachedPresets) return cachedPresets
  const raw = fs.readFileSync(PRESETS_PATH, 'utf8')
  cachedPresets = JSON.parse(raw) as PresetFile
  return cachedPresets
}

/** All commanders with a quick-pick preset army. */
export function listQuickPickPresets(): QuickPickPresetSummary[] {
  const file = loadPresetFile()
  return Object.values(file.presets)
    .map(({ commanderId, commanderName, race, totalUv, companyCount }) => ({
      commanderId,
      commanderName,
      race,
      totalUv,
      companyCount,
    }))
    .sort(
      (a, b) =>
        a.race.localeCompare(b.race) ||
        a.commanderName.localeCompare(b.commanderName),
    )
}

function allCardsForNamedList(list: NamedArmyList): CardSnapshot[] {
  const dbCards = loadCardSnapshots([])
  const all = [...dbCards.values()]
  const byName = indexCardsByName(all)
  const names = new Set<string>()
  names.add(list.commander.trim())
  for (const co of list.companies) {
    names.add(co.officer.trim())
    for (const u of co.units) names.add(u.name.trim())
  }
  const out: CardSnapshot[] = []
  const seen = new Set<string>()
  for (const name of names) {
    const key = name.toLowerCase()
    for (const c of byName.get(key) ?? []) {
      if (!seen.has(c.id)) {
        seen.add(c.id)
        out.push(c)
      }
    }
  }
  return out
}

/** Load a preset army for the given commander (or the first preset if omitted). */
export function loadQuickPickArmy(commanderId?: string | null): DemoArmyPack {
  const file = loadPresetFile()
  const preset =
    (commanderId && file.presets[commanderId]) ||
    Object.values(file.presets)[0]
  if (!preset) {
    throw new Error('No quick-pick army presets found')
  }

  const cardList = allCardsForNamedList(preset.list)
  const lookup = new Map(cardList.map((c) => [c.id, c]))
  const resolved = resolveNamedArmy(preset.list, lookup, undefined, {
    enforceCommanderRace: true,
  })
  if (!resolved.ok) {
    throw new Error(
      `Quick-pick army invalid for ${preset.commanderName}: ${resolved.error}`,
    )
  }

  const armyCheck = resolveArmy(resolved.army, lookup, {
    enforceCommanderRace: true,
  })
  if (!armyCheck.ok) {
    throw new Error(armyCheck.error)
  }

  const ids = new Set<string>([resolved.army.commanderCardId])
  for (const co of resolved.army.companies) {
    ids.add(co.officerCardId)
    for (const u of co.units) ids.add(u.cardId)
  }
  const cards = [...ids]
    .map((id) => lookup.get(id))
    .filter((c): c is CardSnapshot => Boolean(c))

  return { army: resolved.army, cards }
}

/** Default preset for CPU / smoke (stable: first commander in file). */
export function loadDemoArmy(): DemoArmyPack {
  return loadQuickPickArmy()
}
