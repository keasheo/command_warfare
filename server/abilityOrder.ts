/** Sort key: Passive → AP Active → other Active → CC Active → Ultimate. */
export function abilityDisplayRank(ability: {
  type?: string | null
  cost?: string | null
  costResource?: string | null
  costAmount?: number | null
} | null | undefined): number {
  if (!ability) return 90
  const kind = (ability.type || '').trim()
  const cost = (ability.cost || '').trim().toLowerCase()
  if (kind === 'Passive' || cost === 'passive') return 0
  if (kind === 'Ultimate' || cost === 'ultimate') return 40

  let resource = (ability.costResource || '').trim().toUpperCase()
  if (!resource) {
    const upper = (ability.cost || '').toUpperCase()
    if (upper.includes('CC') && !upper.includes('COMPANY')) resource = 'CC'
    else if (upper.includes('AP')) resource = 'AP'
  }
  if (resource === 'AP') return 10
  if (resource === 'CC') return 20
  return 15
}

/** True when the ability spends Command CC (commander pool only). */
export function abilityCostsCc(ability: {
  cost?: string | null
  costResource?: string | null
} | null | undefined): boolean {
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
export function abilityCreatesNewUnit(ability: {
  name?: string | null
  description?: string | null
} | null | undefined): boolean {
  if (!ability) return false
  const d = String(ability.description || '')
  const lower = d.toLowerCase()
  const resurrects =
    /\b(return|resurrect|bring back)\b/i.test(d) || /\bdestroyed\b/i.test(d)
  const spawnsNew =
    /\b1-toughness thrall\b/i.test(lower) ||
    /\bplace a thrall\b/i.test(lower) ||
    /\braise (?:a|one|an) (?:\d+-toughness )?thrall\b/i.test(lower) ||
    /\bsummon\b/i.test(lower) ||
    /\bspawn (?:a|an|one)\b/i.test(lower) ||
    /\bnew unit\b/i.test(lower) ||
    /\btoken unit\b/i.test(lower)
  if (spawnsNew && !resurrects) return true
  if (spawnsNew && resurrects) {
    if (/\bdestroyed\b/i.test(d) && /\b(return|resurrect|bring back)\b/i.test(d)) {
      return false
    }
    return true
  }
  return false
}

export function isUltimateAbilityLike(ability: {
  type?: string | null
  cost?: string | null
} | null | undefined): boolean {
  if (!ability) return false
  const kind = (ability.type || '').trim()
  const cost = (ability.cost || '').trim().toLowerCase()
  return kind === 'Ultimate' || cost === 'ultimate'
}

/**
 * Strict used_by taxonomy for card ability slots (regular, not ultimate).
 */
export function abilityUsedByAllowsCard(
  ability: {
    type?: string | null
    cost?: string | null
    costResource?: string | null
    usedBy?: string | null
    name?: string | null
    description?: string | null
  } | null | undefined,
  cardType: string,
): boolean {
  if (!ability) return false
  if (isUltimateAbilityLike(ability)) return false
  const usedBy = (ability.usedBy || '').trim()
  const type = (cardType || '').trim()
  // Brand-new token summons stay unit-only; commanders/officers may run raise/demolish kits.
  if (abilityCreatesNewUnit(ability) && type === 'Unit') return false
  if (type === 'Commander') return usedBy === 'Commander'
  if (abilityCostsCc(ability)) return false
  if (type === 'Officer') return usedBy === 'Officer' || usedBy === 'Both'
  if (type === 'Unit') return !usedBy || usedBy === 'Unit' || usedBy === 'Both'
  return true
}

type AbilityLike = {
  name: string
  type?: string | null
  cost?: string | null
  costResource?: string | null
  costAmount?: number | null
}

/** Order ability refs: Passive → Company AP → CC (Ultimate stays in its own field). */
export function orderedAbilityNames(
  names: string[],
  library: Map<string, AbilityLike> | Record<string, AbilityLike | undefined>,
): string[] {
  const get = (name: string): AbilityLike | undefined =>
    library instanceof Map ? library.get(name) : library[name]

  const seen = new Set<string>()
  const cleaned: string[] = []
  for (const raw of names) {
    const name = raw.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    cleaned.push(name)
  }

  return cleaned.sort((a, b) => {
    const abilityA = get(a)
    const abilityB = get(b)
    const rankA = abilityDisplayRank(abilityA)
    const rankB = abilityDisplayRank(abilityB)
    if (rankA !== rankB) return rankA - rankB
    const amountA = abilityA?.costAmount ?? 0
    const amountB = abilityB?.costAmount ?? 0
    if (amountA !== amountB) return amountA - amountB
    return a.toLowerCase().localeCompare(b.toLowerCase())
  })
}
