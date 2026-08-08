/**
 * Server-side CPU opponent for vs-AI rooms.
 * One shared policy parameterized by difficulty — uses real ClientActions via reduceAction.
 */
import {
  defaultBattleLoadout,
  resolveArmy,
} from '../shared/army.ts'
import { loadDemoArmy, type DemoArmyPack } from './demoArmy.ts'
import {
  previewAttack,
  unitInOfficerRadius,
  validateAttack,
  type CombatContext,
} from '../shared/combatResolve.ts'
import {
  findDeployedOfficer,
  officerDeployRadius,
  ownCommandRadiusKeys,
  tooCloseToObjective,
} from '../shared/game.ts'
import { hexDistOddR, hexKey, inBounds } from '../shared/hex.ts'
import { reachableMoveHexes } from '../shared/movement.ts'
import { objectiveZoneHexes } from '../shared/objectiveCards.ts'
import { FLOOD_TERRAIN_KINDS } from '../shared/terrainPieces.ts'
import type {
  AiDifficulty,
  ClientAction,
  GameState,
  ObjectiveMarker,
  SeatId,
  UnitToken,
} from '../shared/types.ts'
import {
  abilityNamesFromCards,
  armyCardIds,
  loadAbilityDefs,
  loadCardSnapshots,
} from './cards.ts'
import { isPassiveAbility } from '../shared/abilityCast.ts'

export { loadDemoArmy, loadQuickPickArmy, listQuickPickPresets, type DemoArmyPack } from './demoArmy.ts'

export function aiDisplayName(difficulty: AiDifficulty): string {
  const label =
    difficulty === 'easy' ? 'Easy' : difficulty === 'hard' ? 'Hard' : 'Medium'
  return `CPU (${label})`
}

export type DifficultyPolicy = {
  /** 0–1: chance to pick a random legal action instead of best. */
  noise: number
  /** Extra weight toward ending the turn early. */
  endTurnBias: number
  /** Chance to consider casting a simple ability when scoring. */
  abilityChance: number
  /** Prefer attacks / closing distance more aggressively. */
  aggression: number
  /**
   * Weight for objective contesting vs combat proximity.
   * Easy ≈ fight/random; Medium balanced; Hard prioritizes contested/unowned zones.
   */
  objectiveFocus: number
  thinkDelayMs: [number, number]
}

export function policyForDifficulty(d: AiDifficulty): DifficultyPolicy {
  switch (d) {
    case 'easy':
      return {
        noise: 0.65,
        endTurnBias: 0.45,
        abilityChance: 0.05,
        aggression: 0.55,
        objectiveFocus: 0.28,
        thinkDelayMs: [450, 900],
      }
    case 'hard':
      return {
        noise: 0.06,
        endTurnBias: 0.02,
        abilityChance: 0.55,
        aggression: 1.35,
        objectiveFocus: 1.05,
        thinkDelayMs: [220, 480],
      }
    case 'medium':
    default:
      return {
        noise: 0.22,
        endTurnBias: 0.12,
        abilityChance: 0.28,
        aggression: 1.0,
        objectiveFocus: 0.55,
        thinkDelayMs: [320, 650],
      }
  }
}

export function thinkDelayMs(d: AiDifficulty, rng = Math.random): number {
  const [lo, hi] = policyForDifficulty(d).thinkDelayMs
  return Math.floor(lo + rng() * (hi - lo))
}

export function aiSeatNeedingAction(state: GameState): SeatId | null {
  if (state.opponent !== 'ai' || state.winner) return null
  const ai = state.players.find((p) => p.isAi)
  if (!ai) return null
  const seat = ai.seat
  switch (state.phase) {
    case 'Lobby':
    case 'ArmyBuild':
      return ai.armyReady ? null : seat
    case 'Commanders':
      return ai.commanderReady ? null : seat
    case 'ForceSelect':
      return ai.forceSelectReady ? null : seat
    case 'Terrain':
      if (state.terrainStage === 'commandZone') {
        return ai.terrainReady ? null : seat
      }
      return state.activeSeat === seat ? seat : null
    case 'Deploy':
      return ai.deployDone ? null : seat
    case 'Play':
      return state.activeSeat === seat ? seat : null
    default:
      return null
  }
}

type ScoredAction = { action: ClientAction; score: number }

function travelerFromUnit(unit: UnitToken) {
  const kws = unit.keywords ?? []
  const has = (name: string) =>
    kws.some((k) => k === name || String(k).startsWith(`${name} `))
  return {
    flying: has('Flying'),
    amphibious: has('Amphibious'),
    rooted: Boolean(unit.rooted),
    slow: Boolean(unit.slow),
  }
}

function occupiedKeys(state: GameState): Set<string> {
  const s = new Set<string>()
  for (const u of state.units) s.add(hexKey(u.col, u.row))
  return s
}

function friendlyOccupiedKeys(
  state: GameState,
  seat: SeatId,
  excludeUnitId?: string,
): Set<string> {
  const s = new Set<string>()
  for (const u of state.units) {
    if (u.seat === seat && u.id !== excludeUnitId) s.add(hexKey(u.col, u.row))
  }
  return s
}

function nearestEnemyDist(state: GameState, seat: SeatId, cell: { col: number; row: number }) {
  let best = Infinity
  for (const u of state.units) {
    if (u.seat === seat) continue
    if (u.kind === 'commander') continue
    best = Math.min(best, hexDistOddR(cell, u))
  }
  return best
}

type ZonePresence = {
  objective: ObjectiveMarker
  zoneKeys: Set<string>
  friendly: number
  enemy: number
}

/** Living units on a zone (`state.units` only — graves do not count). */
function zonePresence(
  state: GameState,
  seat: SeatId,
  objective: ObjectiveMarker,
  excludeUnitId?: string,
): ZonePresence {
  const zoneKeys = new Set(
    objectiveZoneHexes(objective).map((h) => hexKey(h.col, h.row)),
  )
  let friendly = 0
  let enemy = 0
  for (const u of state.units) {
    if (excludeUnitId && u.id === excludeUnitId) continue
    if (!zoneKeys.has(hexKey(u.col, u.row))) continue
    if (u.seat === seat) friendly++
    else enemy++
  }
  return { objective, zoneKeys, friendly, enemy }
}

function distToZone(cell: { col: number; row: number }, objective: ObjectiveMarker): number {
  let best = Infinity
  for (const h of objectiveZoneHexes(objective)) {
    best = Math.min(best, hexDistOddR(cell, h))
  }
  return best
}

/**
 * How valuable it is for `seat` to put one more living unit on this zone
 * (empty / contested / reclaimable score higher than already-safe holds).
 */
function zoneContestPriority(presence: ZonePresence, seat: SeatId): number {
  const { objective, friendly, enemy } = presence
  const controller = objective.controller
  if (friendly === 0 && enemy === 0) return 42 // empty — claimable
  if (friendly === enemy) return 48 // contested / tied
  if (friendly === enemy - 1) return 55 // one body flips/reclaims
  if (friendly > enemy) {
    // Already majority; small reinforce if thin lead, else deprioritize
    return friendly === enemy + 1 ? 14 : 4
  }
  // Enemy majority by 2+: still worth contesting, less than flip-range
  if (controller && controller !== seat) return 28
  return 22
}

/** Distance to nearest objective worth contesting (skips safe owned majorities). */
function nearestContestObjectiveDist(
  state: GameState,
  seat: SeatId,
  cell: { col: number; row: number },
  movingUnitId?: string,
): number {
  let best = Infinity
  for (const objective of state.objectives) {
    const presence = zonePresence(state, seat, objective, movingUnitId)
    if (zoneContestPriority(presence, seat) < 8) continue
    best = Math.min(best, distToZone(cell, objective))
  }
  return best
}

/**
 * On-hex claim value if `cell` is inside a contestable zone (else 0).
 * `movingUnitId` is excluded from counts so origin/destination deltas stay consistent.
 */
function objectiveOnHexValue(
  state: GameState,
  seat: SeatId,
  cell: { col: number; row: number },
  movingUnitId?: string,
): number {
  if (!state.objectives.length) return 0
  const key = hexKey(cell.col, cell.row)
  let best = 0
  for (const objective of state.objectives) {
    const presence = zonePresence(state, seat, objective, movingUnitId)
    if (!presence.zoneKeys.has(key)) continue
    best = Math.max(best, zoneContestPriority(presence, seat))
  }
  return best
}

/**
 * Combined objective desirability at `cell`: on-zone claim value, else soft
 * proximity so companies near contested/unowned zones activate preferentially.
 */
function objectiveCellValue(
  state: GameState,
  seat: SeatId,
  cell: { col: number; row: number },
  movingUnitId?: string,
): number {
  if (!state.objectives.length) return 0
  const onHex = objectiveOnHexValue(state, seat, cell, movingUnitId)
  if (onHex > 0) return onHex
  const dist = nearestContestObjectiveDist(state, seat, cell, movingUnitId)
  if (!Number.isFinite(dist)) return 0
  return Math.max(0, 16 - dist)
}

/** Best objective opportunity near a company (for activation scoring). */
function companyObjectivePull(
  state: GameState,
  seat: SeatId,
  company: UnitToken[],
): number {
  if (!state.objectives.length || !company.length) return 0
  let best = 0
  for (const u of company) {
    best = Math.max(best, objectiveCellValue(state, seat, u, u.id))
  }
  return best
}

function deployPreferredRow(seat: SeatId, boardSize: number): number {
  if (seat === 'N') return 1
  if (seat === 'S') return boardSize - 2
  if (seat === 'W') return Math.floor(boardSize / 2)
  return Math.floor(boardSize / 2)
}

function tryDeploySpot(
  state: GameState,
  seat: SeatId,
  queueIndex: number,
): ClientAction | null {
  const queue = state.deployQueues[seat] ?? []
  const item = queue[queueIndex]
  if (!item || item.placed) return null

  const occ = occupiedKeys(state)
  const candidates: Array<{ col: number; row: number }> = []

  if (item.kind === 'officer') {
    for (const key of ownCommandRadiusKeys(state, seat)) {
      const [col, row] = key.split(',').map(Number) as [number, number]
      candidates.push({ col, row })
    }
  } else {
    const officer = findDeployedOfficer(state, seat, item.officerCardId)
    if (!officer) return null
    const radius = officerDeployRadius(state, officer)
    for (let col = 0; col < state.boardSize; col++) {
      for (let row = 0; row < state.boardSize; row++) {
        if (
          unitInOfficerRadius(
            { col, row },
            { col: officer.col, row: officer.row },
            radius,
            null,
          )
        ) {
          candidates.push({ col, row })
        }
      }
    }
  }

  const preferredRow = deployPreferredRow(seat, state.boardSize)
  candidates.sort(
    (a, b) =>
      Math.abs(a.row - preferredRow) - Math.abs(b.row - preferredRow) ||
      Math.abs(a.col - 15) - Math.abs(b.col - 15),
  )

  for (const { col, row } of candidates) {
    if (!inBounds({ col, row }, state.boardSize)) continue
    if (occ.has(hexKey(col, row))) continue
    if ((state.terrain ?? {})[hexKey(col, row)] === 'wall') continue
    if (tooCloseToObjective({ col, row }, state)) continue
    return { type: 'deploy', queueIndex, col, row }
  }
  return null
}

function setupAction(state: GameState, seat: SeatId): ClientAction | null {
  const player = state.players.find((p) => p.seat === seat)
  if (!player) return null

  if (
    (state.phase === 'Lobby' || state.phase === 'ArmyBuild') &&
    !player.armyReady
  ) {
    try {
      const demo = loadDemoArmy()
      const serverCards = loadCardSnapshots(armyCardIds(demo.army))
      const cards = [...demo.cards]
      for (const [id, c] of serverCards) {
        if (!cards.some((x) => x.id === id)) cards.push(c)
      }
      return { type: 'submitArmy', army: demo.army, cards }
    } catch {
      return null
    }
  }

  if (state.phase === 'Commanders' && !player.commanderReady) {
    return { type: 'readyCommander' }
  }

  if (state.phase === 'ForceSelect' && !player.forceSelectReady) {
    const armyList = player.army
    if (!armyList) return null
    const lookup = new Map(
      Object.values(state.cardCatalog).map((c) => [c.id, c]),
    )
    const resolved = resolveArmy(armyList, lookup, {
      enforceCommanderRace: state.enforceCommanderRace !== false,
    })
    if (!resolved.ok) {
      const loadout: Record<string, 'deploy'> = {}
      for (const co of armyList.companies) loadout[co.officerCardId] = 'deploy'
      return { type: 'confirmForceSelect', battleLoadout: loadout }
    }
    return {
      type: 'confirmForceSelect',
      battleLoadout: defaultBattleLoadout(resolved.army, state.loadoutPools),
    }
  }

  if (state.phase === 'Terrain') {
    if (state.terrainStage === 'commandZone' && !player.terrainReady) {
      if (!state.commandZoneModes[seat]) {
        return { type: 'chooseCommandZoneMode', mode: 'flood' }
      }
      if (state.commandZoneModes[seat] === 'flood') {
        const hand = state.terrainHands[seat] ?? []
        if (!hand.some((q) => q.flooded)) {
          const kind = FLOOD_TERRAIN_KINDS.includes('plains')
            ? 'plains'
            : FLOOD_TERRAIN_KINDS[0]
          return { type: 'floodCommandZone', kind }
        }
      }
      return null
    }
    if (
      state.terrainStage !== 'commandZone' &&
      state.activeSeat === seat
    ) {
      return { type: 'skipTerrain' }
    }
  }

  if (state.phase === 'Deploy' && !player.deployDone) {
    const queue = state.deployQueues[seat] ?? []
    const nextIdx = queue.findIndex((q) => !q.placed)
    if (nextIdx >= 0) {
      return tryDeploySpot(state, seat, nextIdx)
    }
    return { type: 'confirmDeploy' }
  }

  return null
}

const SIMPLE_ABILITY_NAMES = new Set([
  'Heal',
  'Repair',
  'Rebuild Protocol',
  'Bolster',
  'Inspire',
])

function enumeratePlayActions(
  state: GameState,
  seat: SeatId,
  policy: DifficultyPolicy,
  rng: () => number,
): ScoredAction[] {
  const out: ScoredAction[] = []
  const mine = state.units.filter((u) => u.seat === seat)
  const enemies = state.units.filter(
    (u) => u.seat !== seat && u.kind !== 'commander',
  )

  if (state.pendingTrample) {
    const atk = state.units.find((u) => u.id === state.pendingTrample!.attackerId)
    if (atk?.seat === seat) {
      out.push({ action: { type: 'continueTrample' }, score: 80 * policy.aggression })
      out.push({ action: { type: 'declineTrample' }, score: 10 })
      return out
    }
  }

  // Attacks (any of our units with damage in range — engine does not require activation)
  for (const attacker of mine) {
    if ((attacker.damage ?? 0) <= 0 && !(attacker.trampleLeftoverDamage > 0)) {
      continue
    }
    for (const defender of enemies) {
      const ctx: CombatContext = { state, attacker, defender }
      const check = validateAttack(ctx)
      if (!check.ok) continue
      const preview = previewAttack(ctx)
      if (!preview.legal) continue
      const kill =
        defender.toughnessCurrent != null &&
        preview.rawDamage >= defender.toughnessCurrent
          ? 40
          : 0
      out.push({
        action: {
          type: 'resolveAttack',
          attackerUnitId: attacker.id,
          defenderUnitId: defender.id,
        },
        score: (35 + preview.rawDamage * 8 + kill) * policy.aggression,
      })
    }
  }

  // Activate commander if not yet this round
  if (!state.commanderActivatedThisRound[seat]) {
    const cmd = mine.find((u) => u.kind === 'commander')
    if (cmd) {
      out.push({
        action: { type: 'activateCommander' },
        score: 18 + policy.aggression * 4,
      })
    }
  }

  // Activate companies — only one per turn; each officer once per round.
  const activatedThisRound = state.companiesActivatedThisRound ?? {}
  const activatedThisTurn = state.companyActivatedThisTurn?.[seat]
  const canActivateAnotherCompany = !activatedThisTurn
  if (canActivateAnotherCompany) {
    for (const officer of mine.filter((u) => u.kind === 'officer')) {
      if (state.activeCompanyOfficerId === officer.id) continue
      if (activatedThisRound[officer.id]) continue
      const company = mine.filter(
        (u) => u.id === officer.id || u.officerCardId === officer.cardId,
      )
      const near = Math.min(
        ...company.map((u) => nearestEnemyDist(state, seat, u)),
        Infinity,
      )
      const proximity = Number.isFinite(near) ? Math.max(0, 20 - near) : 0
      const objPull = companyObjectivePull(state, seat, company)
      out.push({
        action: { type: 'activateCompany', officerUnitId: officer.id },
        score:
          15 +
          proximity * policy.aggression +
          objPull * 0.55 * policy.objectiveFocus,
      })
    }
  }

  // Moves for activated units / commander with move remaining
  const movable = mine.filter((u) => {
    if (u.moveRemaining <= 0 || u.rooted) return false
    if (u.kind === 'commander') return true
    if (!state.activeCompanyOfficerId) return false
    const officer = state.units.find((o) => o.id === state.activeCompanyOfficerId)
    if (!officer) return false
    return u.id === officer.id || u.officerCardId === officer.cardId
  })

  for (const unit of movable) {
    const occ = occupiedKeys(state)
    occ.delete(hexKey(unit.col, unit.row))
    const reach = reachableMoveHexes({
      origin: { col: unit.col, row: unit.row },
      budget: unit.moveRemaining,
      boardSize: state.boardSize,
      terrain: state.terrain ?? {},
      occupied: occ,
      friendlyOccupied: friendlyOccupiedKeys(state, seat, unit.id),
      traveler: travelerFromUnit(unit),
    })
    const before = nearestEnemyDist(state, seat, unit)
    const objDistBefore = nearestContestObjectiveDist(state, seat, unit, unit.id)
    const onHexBefore = objectiveOnHexValue(state, seat, unit, unit.id)
    let bestMove: ScoredAction | null = null
    for (const cell of reach.values()) {
      if (cell.col === unit.col && cell.row === unit.row) continue
      if (occ.has(hexKey(cell.col, cell.row))) continue
      const after = nearestEnemyDist(state, seat, cell)
      const closed =
        (Number.isFinite(before) ? before : 30) -
        (Number.isFinite(after) ? after : 30)
      const objDistAfter = nearestContestObjectiveDist(state, seat, cell, unit.id)
      const objClosed =
        (Number.isFinite(objDistBefore) ? objDistBefore : 30) -
        (Number.isFinite(objDistAfter) ? objDistAfter : 30)
      const onHexAfter = objectiveOnHexValue(state, seat, cell, unit.id)
      const onHexDelta = onHexAfter - onHexBefore
      // Combat close + objective approach/claim; claim can outscore pure chase
      const score =
        closed * 12 * policy.aggression +
        objClosed * 10 * policy.objectiveFocus +
        onHexDelta * 0.95 * policy.objectiveFocus +
        (cell.spent > 0 ? 2 : 0) -
        (closed < 0 ? 8 : 0)
      if (!bestMove || score > bestMove.score) {
        bestMove = {
          action: { type: 'move', unitId: unit.id, col: cell.col, row: cell.row },
          score,
        }
      }
    }
    if (bestMove && bestMove.score > 0) out.push(bestMove)
  }

  // Prefer finishing the active company before ending the turn.
  // Once a company has been activated this turn, ending turn is how we pass.
  const endBias =
    activatedThisTurn || state.activeCompanyOfficerId
      ? policy.endTurnBias * 40 + (movable.length === 0 ? 25 : 5)
      : 1 + policy.endTurnBias * 40

  // Optional simple abilities (Medium/Hard mostly) — never cast passives.
  if (rng() < policy.abilityChance) {
    for (const caster of mine) {
      const names = [
        ...(caster.abilities ?? []),
        ...(caster.ultimate ? [caster.ultimate] : []),
      ]
      for (const abilityName of names) {
        if (!SIMPLE_ABILITY_NAMES.has(abilityName)) continue
        const def = state.abilityCatalog?.[abilityName]
        if (isPassiveAbility(def)) continue
        const allies = mine.filter(
          (u) =>
            u.id !== caster.id &&
            u.toughnessCurrent != null &&
            u.toughness != null &&
            u.toughnessCurrent < u.toughness,
        )
        const targets = allies.length ? allies : [null]
        for (const target of targets) {
          out.push({
            action: {
              type: 'castAbility',
              casterUnitId: caster.id,
              abilityName,
              ...(target ? { targetUnitId: target.id } : {}),
            },
            score: 22 * policy.aggression + (target ? 8 : 0),
          })
        }
      }
    }
  }

  out.push({
    action: { type: 'endTurn' },
    score: endBias,
  })

  return out
}

function pickScored(
  scored: ScoredAction[],
  policy: DifficultyPolicy,
  rng: () => number,
): ClientAction {
  if (!scored.length) return { type: 'endTurn' }
  if (rng() < policy.noise) {
    return scored[Math.floor(rng() * scored.length)]!.action
  }
  scored.sort((a, b) => b.score - a.score)
  // Softmax-ish: sometimes take 2nd best on medium
  if (scored.length > 1 && policy.noise > 0.1 && rng() < policy.noise * 0.5) {
    return scored[1]!.action
  }
  return scored[0]!.action
}

/**
 * Choose the next legal-ish action for the AI seat.
 * Caller should apply via reduceAction; if rejected, call again or endTurn.
 */
export function chooseBotAction(
  state: GameState,
  seat: SeatId,
  difficulty: AiDifficulty,
  rng: () => number = Math.random,
): ClientAction | null {
  if (state.phase !== 'Play') {
    return setupAction(state, seat)
  }
  if (state.activeSeat !== seat) return null
  const policy = policyForDifficulty(difficulty)
  const scored = enumeratePlayActions(state, seat, policy, rng)
  return pickScored(scored, policy, rng)
}

/** Enrich submitArmy with DB cards/abilities like the human path. */
export function enrichSubmitArmy(action: Extract<ClientAction, { type: 'submitArmy' }>) {
  const serverCards = loadCardSnapshots(armyCardIds(action.army))
  const serverAbilities = loadAbilityDefs(abilityNamesFromCards(serverCards))
  return { serverCards, serverAbilities }
}
