import type { Ability } from './api'

/** Sort key: Passive → AP Active → other Active → CC Active → Ultimate. */
export function abilityDisplayRank(ability: Ability | undefined | null): number {
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

/** Order ability refs: Passive → Company AP → CC (Ultimate stays in its own field). */
export function orderedAbilityNames(
  names: string[],
  library: Map<string, Ability> | Record<string, Ability | undefined>,
): string[] {
  const get = (name: string): Ability | undefined =>
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
