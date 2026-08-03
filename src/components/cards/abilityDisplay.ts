import type { Ability } from '../../api'

export function resolveAbilityIconKind(
  ability: Ability | undefined,
  forceUltimate = false,
): 'passive' | 'active' | 'ultimate' {
  if (forceUltimate) return 'ultimate'
  if (!ability) return 'active'
  const type = (ability.type || '').trim()
  const cost = (ability.cost || '').trim().toLowerCase()
  if (type === 'Passive' || cost === 'passive') return 'passive'
  if (type === 'Ultimate' || cost === 'ultimate') return 'ultimate'
  return 'active'
}

/** Explicit cost label, e.g. "2 AP" / "3 CC". Empty for passive/ultimate. */
export function formatAbilityCostLabel(ability: Ability | undefined): string {
  if (!ability) return ''
  const type = (ability.type || '').trim()
  if (type === 'Passive' || type === 'Ultimate') return ''
  const resource = (ability.costResource || '').trim().toUpperCase()
  if (ability.costAmount != null && (resource === 'AP' || resource === 'CC')) {
    return `${ability.costAmount} ${resource}`
  }
  const cost = (ability.cost || '').trim()
  if (!cost || /^(passive|ultimate)$/i.test(cost)) return ''
  const match = cost.match(/^(\d+)\s*(CC|AP|COMPANY\s*AP)\b/i)
  if (match) {
    const res = match[2].toUpperCase().includes('CC') ? 'CC' : 'AP'
    return `${match[1]} ${res}`
  }
  return cost
}
