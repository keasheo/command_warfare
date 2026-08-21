/** Siege identification + deploy caps. */

import type { CardSnapshot } from './army'
import type { UnitToken } from './types'
import { MAX_DEPLOY_SIEGE } from './constants'

export function isSiegeCard(card: {
  primaryType?: string | null
  keywords?: string[] | null
}): boolean {
  if ((card.primaryType || '').toLowerCase() === 'siege') return true
  return (card.keywords ?? []).some(
    (k) => k.toLowerCase() === 'siege' || k.toLowerCase().startsWith('siege '),
  )
}

export function isSiegeUnit(
  unit: UnitToken,
  card?: { primaryType?: string | null; keywords?: string[] | null } | null,
): boolean {
  return isSiegeCard({
    primaryType: card?.primaryType ?? null,
    keywords: unit.keywords?.length ? unit.keywords : card?.keywords,
  })
}

/** Rams and other Range 1 Siege engines (not artillery). */
export function isMeleeSiegeWeapon(
  unit: UnitToken,
  card?: { primaryType?: string | null; keywords?: string[] | null; range?: number | null } | null,
): boolean {
  const range = unit.range ?? card?.range ?? 1
  if ((range ?? 1) > 1) return false
  return isSiegeUnit(unit, card)
}

/** Count Siege models assigned to the Deploy battle bucket. */
export function countDeploySiege(
  companies: Array<{
    officer: { id: string }
    units: Array<{ primaryType?: string | null; keywords?: string[] | null }>
  }>,
  loadout: Record<string, 'deploy' | 'reserve' | 'unused' | undefined>,
): number {
  let n = 0
  for (const co of companies) {
    if (loadout[co.officer.id] !== 'deploy') continue
    for (const u of co.units) {
      if (isSiegeCard(u)) n += 1
    }
  }
  return n
}

export function validateDeploySiegeCap(
  companies: Array<{
    officer: { id: string }
    units: Array<{ primaryType?: string | null; keywords?: string[] | null }>
  }>,
  loadout: Record<string, 'deploy' | 'reserve' | 'unused' | undefined>,
): { ok: true } | { ok: false; error: string } {
  const n = countDeploySiege(companies, loadout)
  if (n > MAX_DEPLOY_SIEGE) {
    return {
      ok: false,
      error: `Deploy may include at most ${MAX_DEPLOY_SIEGE} Siege units (have ${n}).`,
    }
  }
  return { ok: true }
}

export type { CardSnapshot }
