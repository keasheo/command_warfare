import type { Ability } from './api'

export function isUltimateAbility(ability: Ability | undefined | null): boolean {
  if (!ability) return false
  const kind = (ability.type || '').trim()
  const cost = (ability.cost || '').trim().toLowerCase()
  return kind === 'Ultimate' || cost === 'ultimate'
}

/** True when the ability spends Command CC (commander pool only). */
export function abilityCostsCc(ability: Ability | undefined | null): boolean {
  if (!ability) return false
  if ((ability.costResource || '').trim().toUpperCase() === 'CC') return true
  const upper = (ability.cost || '').toUpperCase()
  if (!upper.includes('CC') || upper.includes('COMPANY')) return false
  return /\b\d+\s*CC\b/.test(upper) || upper.trim() === 'CC'
}

/**
 * True when the ability spawns a brand-new unit (stat sheet / token).
 * Resurrecting destroyed units is allowed and returns false.
 */
export function abilityCreatesNewUnit(
  ability: { name?: string | null; description?: string | null } | null | undefined,
): boolean {
  if (!ability) return false
  const d = String(ability.description || '')
  const lower = d.toLowerCase()
  // Explicit revive language without new-token spawn language → OK
  const resurrects =
    /\b(return|resurrect|bring back)\b/i.test(d) ||
    /\bdestroyed\b/i.test(d)
  const spawnsNew =
    /\b1-toughness thrall\b/i.test(lower) ||
    /\bplace a thrall\b/i.test(lower) ||
    /\braise (?:a|one|an) (?:\d+-toughness )?thrall\b/i.test(lower) ||
    /\bsummon\b/i.test(lower) ||
    /\bspawn (?:a|an|one)\b/i.test(lower) ||
    /\bnew unit\b/i.test(lower) ||
    /\btoken unit\b/i.test(lower)
  if (spawnsNew && !resurrects) return true
  // Mixed: "raise thrall" without destroyed = create
  if (spawnsNew && resurrects) {
    // "return destroyed … at 1 Toughness" is fine; "raise thrall per fortification" is not
    if (/\bdestroyed\b/i.test(d) && /\b(return|resurrect|bring back)\b/i.test(d)) return false
    return true
  }
  return false
}

/**
 * Who may take an ability on a card (strict taxonomy).
 *
 * - Commander regular: used_by=Commander only (Passive / AP / CC)
 * - Officer: used_by=Officer or Both; never ultimates; never CC
 * - Unit: Unit / empty / Both; never Officer/Commander; never ultimates; never CC
 * - Ultimate slot (Commanders only): Ultimate abilities only
 * - CC-cost actives are commander-only (not officers)
 * - Brand-new token summons stay unit-only; commanders/officers may run raise/demolish kits
 */
export function abilityAllowedForCard(
  ability: Ability,
  cardType: string,
  options: { slot?: 'regular' | 'ultimate' } = {},
): boolean {
  const slot = options.slot ?? 'regular'
  if (slot === 'ultimate') {
    if (abilityCreatesNewUnit(ability)) return false
    return isUltimateAbility(ability)
  }
  if (isUltimateAbility(ability)) return false

  const usedBy = (ability.usedBy || '').trim()
  const type = (cardType || '').trim()

  if (abilityCreatesNewUnit(ability) && type === 'Unit') return false
  if (type === 'Commander') {
    return usedBy === 'Commander'
  }
  if (abilityCostsCc(ability)) return false
  if (type === 'Officer') {
    return usedBy === 'Officer' || usedBy === 'Both'
  }
  if (type === 'Unit') {
    return !usedBy || usedBy === 'Unit' || usedBy === 'Both'
  }
  return true
}
