/**
 * Build rich Card / Ability maps for CardFace previews in play.
 * Prefers the card API when available; falls back to game snapshots + abilityCatalog.
 */
import type { Ability, Card } from '../../../src/api'
import type { AbilityDef } from '../../shared/abilityCast'
import type { CardSnapshot } from '../../shared/index'

export function abilityDefToAbility(def: AbilityDef): Ability {
  return {
    name: def.name,
    type: def.type,
    cost: def.cost,
    costAmount: def.costAmount,
    costResource: def.costResource,
    description: def.description,
    affects: null,
    affectCount: null,
    radiusFrom: null,
    radiusSize: null,
    usedBy: def.usedBy,
    cooldown: def.cooldown,
    tags: [],
  }
}

/** Merge API abilities with in-room abilityCatalog (catalog fills gaps). */
export function mergeAbilityMaps(
  fromApi: Map<string, Ability>,
  catalog?: Record<string, AbilityDef> | null,
): Map<string, Ability> {
  const out = new Map(fromApi)
  if (!catalog) return out
  for (const def of Object.values(catalog)) {
    if (!def?.name) continue
    const existing = out.get(def.name)
    if (!existing || !existing.description) {
      out.set(def.name, abilityDefToAbility(def))
    }
  }
  return out
}

export function snapshotToCard(s: CardSnapshot): Card {
  return {
    id: s.id,
    name: s.name,
    cardType: s.cardType,
    rarity: s.rarity,
    unique: s.unique,
    race: s.race,
    primaryType: s.primaryType ?? null,
    secondaryType: s.secondaryType ?? null,
    uv: s.uv,
    move: s.move,
    damage: s.damage,
    range: s.range,
    toughness: s.toughness,
    companyAp: s.companyAp,
    companyCapacity: s.companyCapacity,
    companyUnitCap: s.companyUnitCap ?? null,
    commandRadius: s.commandRadius,
    apGeneration: s.apGeneration,
    ccGeneration: s.ccGeneration,
    favoredTerrain: s.favoredTerrain ?? null,
    abilities: [...(s.abilities ?? [])],
    keywords: [...(s.keywords ?? [])],
    ultimate: s.ultimate ?? null,
    flavorText: s.flavorText ?? null,
    complexity: null,
    role: null,
    tags: [],
    supportedRaces: [],
    supportedTypes: [],
    supportedKeywords: [],
    // Art lives in data/art/{id}.png; served by the card API.
    hasArt: true,
    artUrl: `/api/cards/${s.id}/art`,
  }
}

/** Prefer full API card; otherwise snapshot; always ensure art URL when id is known. */
export function resolvePreviewCard(
  cardId: string | null | undefined,
  cardsById: Map<string, Card>,
  catalog?: Record<string, CardSnapshot> | null,
): Card | null {
  if (!cardId) return null
  const fromApi = cardsById.get(cardId)
  if (fromApi) {
    if (fromApi.hasArt && fromApi.artUrl) return fromApi
    return {
      ...fromApi,
      hasArt: fromApi.hasArt ?? true,
      artUrl: fromApi.artUrl ?? `/api/cards/${cardId}/art`,
    }
  }
  const snap = catalog?.[cardId]
  return snap ? snapshotToCard(snap) : null
}
