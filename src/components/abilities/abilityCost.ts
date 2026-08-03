import type { Ability } from '../../api'

export const USED_BY_OPTIONS = ['', 'Unit', 'Officer', 'Commander', 'Both'] as const

export const USED_BY_LABELS: Record<(typeof USED_BY_OPTIONS)[number], string> = {
  '': '— Unit (unset)',
  Unit: 'Unit',
  Officer: 'Officer',
  Commander: 'Commander',
  Both: 'Both (Officer + Unit)',
}

/** Human-readable tier from Type + Used By + cost resource. */
export function describeAbilityTier(draft: Ability): string | null {
  const type = (draft.type || '').trim()
  const usedBy = (draft.usedBy || '').trim() || 'Unit'
  const resource = (draft.costResource || '').trim().toUpperCase()
  const cost = (draft.cost || '').trim().toLowerCase()

  if (type === 'Ultimate' || cost === 'ultimate') {
    return 'Tier: Commander Ultimate (once per battle; ultimate slot only).'
  }
  if (type === 'Passive' || cost === 'passive') {
    if (usedBy === 'Commander') {
      return 'Tier: Commander Passive (army / Command Radius; no “this company”).'
    }
    if (usedBy === 'Officer') return 'Tier: Officer Passive (usually this company).'
    if (usedBy === 'Both') return 'Tier: Shared Passive (Officer + Unit).'
    return 'Tier: Unit Passive.'
  }
  if (resource === 'CC' || /\bcc\b/i.test(draft.cost || '')) {
    return 'Tier: Commander CC Ability (strategic; Used By must be Commander).'
  }
  if (usedBy === 'Commander') {
    return 'Tier: Commander AP Ability (spends Commander AP; army / Command Radius wording).'
  }
  if (usedBy === 'Officer' || usedBy === 'Both') {
    return 'Tier: Officer AP Ability (spends Company AP; “this company” is OK).'
  }
  return 'Tier: Unit Active (rare — prefer passives on units).'
}

export const COST_OPTIONS = [
  'Passive',
  'Ultimate',
  '1 AP',
  '2 AP',
  '3 AP',
  '4 AP',
  '5 AP',
  '1 CC',
  '2 CC',
  '3 CC',
  '4 CC',
  '5 CC',
] as const

export const RADIUS_FROM_OPTIONS = [
  '',
  'Commander',
  'Officer',
  'Self',
  'Unit',
  'Target',
] as const

export function parseCostDisplay(cost: string): {
  costAmount: number | null
  costResource: string | null
} {
  const match = cost.trim().match(/^(\d+)\s*(AP|CC)$/i)
  if (!match) return { costAmount: null, costResource: null }
  return {
    costAmount: Number(match[1]),
    costResource: match[2].toUpperCase(),
  }
}

export function costOptionsForDraft(cost: string | null | undefined): string[] {
  const costValue = cost ?? ''
  return costValue && !COST_OPTIONS.includes(costValue as (typeof COST_OPTIONS)[number])
    ? [costValue, ...COST_OPTIONS]
    : [...COST_OPTIONS]
}

export type AbilityPatch = <K extends keyof Ability>(key: K, value: Ability[K]) => void

export function setAbilityType(draft: Ability, onPatch: AbilityPatch, type: string) {
  onPatch('type', type)
  if (type === 'Passive') {
    onPatch('cost', 'Passive')
    onPatch('costAmount', null)
    onPatch('costResource', null)
    onPatch('cooldown', null)
    return
  }
  if (type === 'Ultimate') {
    onPatch('cost', 'Ultimate')
    onPatch('costAmount', null)
    onPatch('costResource', null)
    return
  }
  if (draft.cost === 'Passive' || draft.cost === 'Ultimate' || !draft.cost) {
    onPatch('cost', '1 AP')
    onPatch('costAmount', 1)
    onPatch('costResource', 'AP')
  }
}

export function setAbilityCost(onPatch: AbilityPatch, cost: string) {
  onPatch('cost', cost || null)
  if (cost === 'Passive' || cost === 'Ultimate' || !cost) {
    onPatch('costAmount', null)
    onPatch('costResource', null)
    return
  }
  const parsed = parseCostDisplay(cost)
  onPatch('costAmount', parsed.costAmount)
  onPatch('costResource', parsed.costResource)
}

export function setAbilityCostAmount(
  draft: Ability,
  onPatch: AbilityPatch,
  raw: string,
) {
  const costAmount = raw.trim() ? Number(raw) : null
  onPatch('costAmount', costAmount)
  const resource = (draft.costResource || 'AP').toUpperCase()
  if (costAmount != null && (resource === 'AP' || resource === 'CC')) {
    onPatch('costResource', resource)
    onPatch('cost', `${costAmount} ${resource}`)
  }
}

export function setAbilityCostResource(draft: Ability, onPatch: AbilityPatch, resource: string) {
  const next = resource || null
  onPatch('costResource', next)
  if (draft.costAmount != null && next) {
    onPatch('cost', `${draft.costAmount} ${next}`)
  }
}
