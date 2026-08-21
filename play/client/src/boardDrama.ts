import { useEffect, useMemo, useRef, useState } from 'react'
import {
  commandRadiusKeys,
  hexKey,
  objectiveZoneHexes,
  officerDeployRadius,
  type GameState,
  type SeatId,
  type UnitToken,
} from '../../shared/index'
import { combatResultKey } from './combatFx'
import { playSfx, type SfxKind } from './sfx'

export type BoardBeatTone =
  | 'hit'
  | 'miss'
  | 'kill'
  | 'claim'
  | 'contest'
  | 'activate'
  | 'info'

export type BoardBeat = {
  id: string
  kind: 'combat' | 'activate' | 'objective' | 'vp'
  title: string
  detail: string
  tone: BoardBeatTone
  focus: { col: number; row: number } | null
  flashKeys: string[]
}

const BEAT_MS = 2800

export function companyUnitIdsForOfficer(
  state: GameState,
  officer: UnitToken,
): Set<string> {
  const ids = new Set<string>([officer.id])
  for (const u of state.units) {
    if (u.seat === officer.seat && u.officerCardId === officer.cardId) {
      ids.add(u.id)
    }
  }
  return ids
}

export function useBoardDrama(state: GameState | null): {
  beat: BoardBeat | null
  flashKeys: Set<string>
  activeCompanyIds: Set<string>
  livingCrKeys: Set<string>
  cameraFocus: { col: number; row: number; nonce: number } | null
} {
  const [beat, setBeat] = useState<BoardBeat | null>(null)
  const combatKeyRef = useRef<string | null>(null)
  const officerRef = useRef<string | null>(null)
  const controlRef = useRef('')
  const scoreRef = useRef('')
  const primed = useRef(false)
  const nonceRef = useRef(0)

  useEffect(() => {
    if (!state) return

    const snapshot = () => {
      combatKeyRef.current = state.lastCombatResult
        ? combatResultKey(state.lastCombatResult)
        : null
      officerRef.current = state.activeCompanyOfficerId
      controlRef.current = state.objectives
        .map((o) => `${o.id}:${o.controller ?? ''}`)
        .join('|')
      scoreRef.current = JSON.stringify(state.scores ?? {})
    }

    if (state.phase !== 'Play') {
      primed.current = false
      snapshot()
      return
    }

    const push = (next: Omit<BoardBeat, 'id'>, sfx: SfxKind) => {
      nonceRef.current += 1
      setBeat({ ...next, id: `${next.kind}-${nonceRef.current}` })
      playSfx(sfx)
    }

    if (!primed.current) {
      primed.current = true
      snapshot()
      return
    }

    const combat = state.lastCombatResult
    const cKey = combat ? combatResultKey(combat) : null
    if (combat && cKey && cKey !== combatKeyRef.current) {
      combatKeyRef.current = cKey
      const splash = combat.splashHits ?? []
      const splashHits = splash.filter((s) => s.hit).length
      const pierce = combat.pierceHits ?? []
      const pierceHits = pierce.filter((s) => s.hit).length
      const extras = [
        combat.favoredTerrainHit ? 'home ground' : null,
        combat.flanking ? 'flank' : null,
        splash.length
          ? `blast ${splashHits}/${splash.length}`
          : null,
        pierce.length
          ? `pierce ${pierceHits}/${pierce.length}`
          : null,
      ].filter(Boolean)
      const outcome = !combat.hit
        ? splashHits
          ? `MISS · blast ${splashHits}`
          : 'MISS'
        : combat.killed
          ? `HIT ${combat.dealt} — destroyed`
          : combat.dealt > 0
            ? `HIT ${combat.dealt}`
            : 'HIT 0'
      push(
        {
          kind: 'combat',
          title: outcome,
          detail: `${combat.attackerName} → ${combat.defenderName}${
            extras.length ? ` · ${extras.join(' · ')}` : ''
          }`,
          tone:
            !combat.hit && !splashHits && !pierceHits
              ? 'miss'
              : combat.killed || splash.some((s) => s.killed) || pierce.some((s) => s.killed)
                ? 'kill'
                : 'hit',
          focus: { col: combat.defenderCol, row: combat.defenderRow },
          flashKeys: [
            hexKey(combat.attackerCol, combat.attackerRow),
            hexKey(combat.defenderCol, combat.defenderRow),
            ...splash.map((s) => hexKey(s.col, s.row)),
            ...pierce.map((s) => hexKey(s.col, s.row)),
          ],
        },
        !combat.hit ? 'miss' : combat.killed ? 'kill' : 'hit',
      )
    }

    const officerId = state.activeCompanyOfficerId
    if (officerId && officerId !== officerRef.current) {
      officerRef.current = officerId
      const officer = state.units.find((u) => u.id === officerId)
      if (officer) {
        const company = companyUnitIdsForOfficer(state, officer)
        push(
          {
            kind: 'activate',
            title: `${officer.seat} company`,
            detail: `${officer.cardName} takes the field`,
            tone: 'activate',
            focus: { col: officer.col, row: officer.row },
            flashKeys: state.units
              .filter((u) => company.has(u.id))
              .map((u) => hexKey(u.col, u.row)),
          },
          'activate',
        )
      }
    } else if (!officerId) {
      officerRef.current = null
    }

    const controlKey = state.objectives
      .map((o) => `${o.id}:${o.controller ?? ''}`)
      .join('|')
    if (controlKey !== controlRef.current) {
      const prev = new Map<string, SeatId | null>()
      for (const part of controlRef.current.split('|')) {
        if (!part) continue
        const [id, seat] = part.split(':')
        if (id) prev.set(id, (seat || null) as SeatId | null)
      }
      controlRef.current = controlKey
      for (const o of state.objectives) {
        const was = prev.has(o.id) ? prev.get(o.id)! : null
        if (was === o.controller) continue
        const zone = objectiveZoneHexes(o).map((h) => hexKey(h.col, h.row))
        if (o.controller && !was) {
          push(
            {
              kind: 'objective',
              title: `${o.controller} claims`,
              detail: `Objective at (${o.col},${o.row})`,
              tone: 'claim',
              focus: { col: o.col, row: o.row },
              flashKeys: zone,
            },
            'claim',
          )
        } else if (o.controller && was && o.controller !== was) {
          push(
            {
              kind: 'objective',
              title: `${o.controller} seizes`,
              detail: `Took the zone from ${was}`,
              tone: 'claim',
              focus: { col: o.col, row: o.row },
              flashKeys: zone,
            },
            'claim',
          )
        } else if (!o.controller && was) {
          push(
            {
              kind: 'objective',
              title: 'Contested',
              detail: `Zone at (${o.col},${o.row}) is unclaimed`,
              tone: 'contest',
              focus: { col: o.col, row: o.row },
              flashKeys: zone,
            },
            'contest',
          )
        }
      }
    }

    const scoreKey = JSON.stringify(state.scores ?? {})
    if (scoreKey !== scoreRef.current) {
      const prev = JSON.parse(scoreRef.current || '{}') as Record<string, number>
      scoreRef.current = scoreKey
      const parts: string[] = []
      for (const p of state.players) {
        const now = state.scores?.[p.seat] ?? 0
        const before = prev[p.seat] ?? 0
        if (now > before) parts.push(`${p.seat} +${now - before}`)
      }
      if (parts.length) {
        push(
          {
            kind: 'vp',
            title: 'Objective VP',
            detail: parts.join(' · '),
            tone: 'info',
            focus: state.objectives[0]
              ? { col: state.objectives[0].col, row: state.objectives[0].row }
              : null,
            flashKeys: state.objectives.flatMap((o) =>
              o.controller
                ? objectiveZoneHexes(o).map((h) => hexKey(h.col, h.row))
                : [],
            ),
          },
          'vp',
        )
      }
    }
  }, [state])

  useEffect(() => {
    if (!beat) return
    const t = window.setTimeout(() => setBeat(null), BEAT_MS)
    return () => window.clearTimeout(t)
  }, [beat?.id])

  const flashKeys = useMemo(() => new Set(beat?.flashKeys ?? []), [beat])

  const activeCompanyIds = useMemo(() => {
    const ids = new Set<string>()
    if (!state || state.phase !== 'Play' || !state.activeCompanyOfficerId) {
      return ids
    }
    const officer = state.units.find(
      (u) => u.id === state.activeCompanyOfficerId,
    )
    if (!officer) return ids
    return companyUnitIdsForOfficer(state, officer)
  }, [state])

  const livingCrKeys = useMemo(() => {
    const empty = new Set<string>()
    if (!state || state.phase !== 'Play' || !state.activeCompanyOfficerId) {
      return empty
    }
    const officer = state.units.find(
      (u) => u.id === state.activeCompanyOfficerId,
    )
    if (!officer) return empty
    return commandRadiusKeys(
      { col: officer.col, row: officer.row },
      officerDeployRadius(state, officer),
      state.boardSize,
    )
  }, [state])

  const cameraFocus = beat?.focus
    ? { col: beat.focus.col, row: beat.focus.row, nonce: nonceRef.current }
    : null

  return { beat, flashKeys, activeCompanyIds, livingCrKeys, cameraFocus }
}
