import type { Ability } from '../../api'

export function formatAbilityCost(ability: Ability): string {
  if (ability.type === 'Passive') return 'Passive'
  if (ability.type === 'Ultimate') return ability.cost || 'Ultimate'
  const amt = ability.costAmount
  const res = (ability.costResource || '').toUpperCase()
  if (amt != null && res) return `${amt} ${res}`
  if (ability.cost) return ability.cost
  return '—'
}

export function formatAbilityMeta(ability: Ability): string {
  const parts = [ability.type || 'Ability', formatAbilityCost(ability)]
  if (ability.usedBy) parts.push(ability.usedBy)
  if (ability.type === 'Active' && ability.cooldown != null && ability.cooldown > 0) {
    parts.push(`CD ${ability.cooldown}`)
  }
  return parts.join(' · ')
}
