/**
 * Ability tier casting helpers for play (and shared rules with the battle sim).
 * Alias map is kept in commanderEffectAliases.json (also loaded by battleSim.mjs).
 */
import aliasesJson from './commanderEffectAliases.json' with { type: 'json' }

export type AbilityDef = {
  name: string
  type: string | null
  cost: string | null
  costAmount: number | null
  costResource: string | null
  description: string | null
  usedBy: string | null
  cooldown: number | null
}

export const COMMANDER_EFFECT_ALIASES: Record<string, string> = {
  ...(aliasesJson as Record<string, string>),
}

export function resolveEffectAbilityName(abilityName: string): string {
  return COMMANDER_EFFECT_ALIASES[abilityName] || abilityName
}

export function isUltimateAbility(def: AbilityDef | null | undefined): boolean {
  if (!def) return false
  const kind = (def.type || '').trim()
  const cost = (def.cost || '').trim().toLowerCase()
  return kind === 'Ultimate' || cost === 'ultimate'
}

export function isPassiveAbility(def: AbilityDef | null | undefined): boolean {
  if (!def) return false
  const kind = (def.type || '').trim()
  const cost = (def.cost || '').trim().toLowerCase()
  return kind === 'Passive' || cost === 'passive'
}

export function abilityCostsCc(def: AbilityDef | null | undefined): boolean {
  if (!def) return false
  if ((def.costResource || '').trim().toUpperCase() === 'CC') return true
  const upper = (def.cost || '').toUpperCase()
  if (!upper.includes('CC') || upper.includes('COMPANY')) return false
  return /\b\d+\s*CC\b/.test(upper) || upper.trim() === 'CC'
}

/** Whether a unit kind may cast this ability under the Used By taxonomy. */
export function casterMayUseAbility(
  def: AbilityDef,
  casterKind: 'commander' | 'officer' | 'unit',
): boolean {
  if (isPassiveAbility(def)) return false
  const usedBy = (def.usedBy || '').trim()
  if (casterKind === 'commander') {
    if (isUltimateAbility(def)) return true
    return usedBy === 'Commander'
  }
  if (casterKind === 'officer') {
    if (isUltimateAbility(def) || abilityCostsCc(def)) return false
    return usedBy === 'Officer' || usedBy === 'Both'
  }
  if (isUltimateAbility(def) || abilityCostsCc(def)) return false
  return !usedBy || usedBy === 'Unit' || usedBy === 'Both'
}

export type AbilitySpend =
  | { pool: 'commanderAp'; amount: number }
  | { pool: 'commanderCc'; amount: number }
  | { pool: 'companyAp'; amount: number }
  | { pool: 'none'; amount: 0 }

/** Resolve which pool an active ability spends (by caster role + cost). */
export function abilitySpendForCaster(
  def: AbilityDef,
  casterKind: 'commander' | 'officer' | 'unit',
): AbilitySpend | { error: string } {
  if (isPassiveAbility(def)) return { error: 'Passives are always on — do not cast them.' }
  if (isUltimateAbility(def)) return { pool: 'none', amount: 0 }

  const amount = Math.max(0, Number(def.costAmount) || 0)
  if (abilityCostsCc(def)) {
    if (casterKind !== 'commander') {
      return { error: 'CC abilities are commander-only.' }
    }
    return { pool: 'commanderCc', amount: Math.max(1, amount || 1) }
  }

  const resource = (def.costResource || '').trim().toUpperCase()
  if (resource === 'AP' || /\bAP\b/i.test(def.cost || '')) {
    const n = Math.max(1, amount || 1)
    if (casterKind === 'commander') return { pool: 'commanderAp', amount: n }
    // Officers and Combat Units spend Company AP from the company pool.
    return { pool: 'companyAp', amount: n }
  }

  return { error: 'Ability has no spendable cost.' }
}
