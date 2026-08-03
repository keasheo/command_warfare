import {
  ARMY_UV_MAX,
  BOARD_SIZE,
  boardMid,
  boardSizeForPlayers,
  DEFAULT_UNIT_MOVE,
  DEPLOY_DEPTH,
  MIN_OBJECTIVE_DISTANCE,
  SCOUT_CR_EXTENSION,
  SEATS_2P,
  SEATS_4P,
  TERRAIN_LAND_DROPS_PER_SIZE,
  commandZonePieceQuota,
  commandZoneSlotsTotal,
} from './constants'
import {
  deployQueueFromArmy,
  resolveArmy,
  validateArmyUv,
  validateBattleLoadout,
  type ArmyList,
  type BattleBucket,
  type BattleLoadout,
  type CardLookup,
  type CardSnapshot,
  type ResolvedArmy,
} from './army'
import { hexDistOddR, hexKey, inBounds, type OddR } from './hex'
import {
  drawObjectiveCardOutsideCommandRadii,
  flattenObjectiveHexes,
  objectiveHexKeySet,
  objectiveZoneHexes,
  objectiveZonesOnBoard,
} from './objectiveCards'
import {
  commanderHasEscapePath,
  FLOOD_TERRAIN_KINDS,
  commandZonePieceCatalog,
  commandZonePiecesComplete,
  commandZoneSizeUsed,
  expandTerrainPiece,
  fillEmptyHexesWithPlains,
  landPiecesForSize,
  makeTerrainHandItem,
  normalizeRotation,
  terrainMayCoverCommander,
  terrainPieceById,
  terrainSetupStayConnected,
  TERRAIN_CONNECTIVITY_ERROR,
  validateTerrainPlacement,
  WATER_HEX_CAP,
  type TerrainKind,
  type TerrainQueueItem,
  type TerrainSizeClass,
} from './terrainPieces'
import { validateTerrainMove, reachableMoveHexes, type MoveCostOptions } from './movement'
import {
  abilitySpendForCaster,
  casterMayUseAbility,
  isPassiveAbility,
  isUltimateAbility,
  resolveEffectAbilityName,
  type AbilityDef,
} from './abilityCast'
import {
  applyAttackResultToState,
  effectiveDamage,
  hasScoutAbility,
  hasUnitAbility,
  resolveAttack as resolveCombatAttack,
  unitInOfficerRadius,
} from './combatResolve'
import {
  DEFAULT_UNIT_STATUSES,
  canGainFear,
  clearConsumedSlow,
  clearRoundStatuses,
  markSlowForActivation,
  patchBonePrison,
  patchFear,
  patchRoot,
  patchSlow,
  patchTempFearless,
  patchUnyielding,
} from './statusEffects'
import { formatGameLogLine } from './constants'
import type {
  ClientAction,
  DeathRecord,
  DeployItem,
  GameState,
  PlayerSlot,
  SeatId,
  UnitToken,
} from './types'

function seatOrder(maxPlayers: 2 | 4): SeatId[] {
  return maxPlayers === 2 ? [...SEATS_2P] : [...SEATS_4P]
}

export function edgeCommanderHex(seat: SeatId, boardSize = BOARD_SIZE): OddR {
  const mid = Math.floor((boardSize - 1) / 2)
  if (seat === 'N') return { col: mid, row: 0 }
  if (seat === 'S') return { col: mid, row: boardSize - 1 }
  if (seat === 'W') return { col: 0, row: mid }
  return { col: boardSize - 1, row: mid }
}

export function inDeployZone(seat: SeatId, cell: OddR, boardSize = BOARD_SIZE): boolean {
  if (seat === 'N') return cell.row >= 0 && cell.row < DEPLOY_DEPTH
  if (seat === 'S') return cell.row > boardSize - 1 - DEPLOY_DEPTH && cell.row < boardSize
  if (seat === 'W') return cell.col >= 0 && cell.col < DEPLOY_DEPTH
  return cell.col > boardSize - 1 - DEPLOY_DEPTH && cell.col < boardSize
}

/** All hex keys in a seat's edge deploy wedge. */
export function deployWedgeKeys(seat: SeatId, boardSize = BOARD_SIZE): Set<string> {
  const keys = new Set<string>()
  for (let row = 0; row < boardSize; row++) {
    for (let col = 0; col < boardSize; col++) {
      if (inDeployZone(seat, { col, row }, boardSize)) {
        keys.add(hexKey(col, row))
      }
    }
  }
  return keys
}

export function tooCloseToObjective(cell: OddR, state: GameState): boolean {
  for (const o of state.objectives) {
    for (const h of objectiveZoneHexes(o)) {
      if (hexDistOddR(cell, h) < MIN_OBJECTIVE_DISTANCE) return true
    }
  }
  return false
}

/** Find the on-board officer token for a company (by officer card id). */
export function findDeployedOfficer(
  state: GameState,
  seat: SeatId,
  officerCardId: string,
): UnitToken | null {
  return (
    state.units.find(
      (u) =>
        u.seat === seat &&
        u.kind === 'officer' &&
        u.cardId === officerCardId,
    ) ?? null
  )
}

export function officerDeployRadius(
  state: GameState,
  officer: UnitToken,
): number {
  const fromToken = officer.commandRadius
  if (fromToken && fromToken > 0) return fromToken
  const fromCard = state.cardCatalog?.[officer.cardId]?.commandRadius
  if (fromCard && fromCard > 0) return fromCard
  return 2
}

export function createEmptyRoom(
  roomCode: string,
  maxPlayers: 2 | 4 = 2,
  enforceCommanderRace = true,
): GameState {
  const raceRule = enforceCommanderRace
    ? 'mono-race armies'
    : 'mixed-race armies allowed'
  const boardSize = boardSizeForPlayers(maxPlayers)
  return {
    roomCode,
    maxPlayers,
    enforceCommanderRace,
    boardSize,
    hostSeat: 'N',
    phase: 'Lobby',
    players: [],
    commanders: {},
    commanderRadii: {},
    objectives: [],
    objectiveCardId: null,
    terrain: {},
    fortifiedHexes: {},
    pendingTrample: null,
    terrainHands: {},
    terrainQueue: [],
    terrainStage: 'commandZone',
    commandZoneModes: {},
    landDropsUsed: {},
    units: [],
    deaths: [],
    activeSeat: null,
    turnOrder: [],
    round: 0,
    activeCompanyOfficerId: null,
    commanderActivatedThisRound: {},
    commanderPools: {},
    companyPools: {},
    lastDiceRoll: null,
    lastCombatResult: null,
    winner: null,
    deployQueues: {},
    cardCatalog: {},
    abilityCatalog: {},
    log: [
      formatGameLogLine(
        `Room ${roomCode} created (${maxPlayers}P, ${boardSize}×${boardSize}, ${raceRule}). Build armies before commanders.`,
      ),
    ],
  }
}


function pushLog(state: GameState, line: string): GameState {
  return { ...state, log: [...state.log.slice(-40), formatGameLogLine(line)] }
}

function occupiedKeys(state: GameState): Set<string> {
  const s = new Set<string>()
  for (const u of state.units) s.add(`${u.col},${u.row}`)
  return s
}

function friendlyOccupiedKeys(
  state: GameState,
  seat: SeatId,
  excludeUnitId?: string,
): Set<string> {
  const s = new Set<string>()
  for (const u of state.units) {
    if (u.seat === seat && u.id !== excludeUnitId) s.add(`${u.col},${u.row}`)
  }
  return s
}

function nextSeat(order: SeatId[], current: SeatId): SeatId {
  const i = order.indexOf(current)
  return order[(i + 1) % order.length]!
}

function majorityNeeded(objectiveCount: number): number {
  return Math.floor(objectiveCount / 2) + 1
}

function checkWinner(state: GameState): GameState {
  if (state.objectives.length === 0) return state
  const need = majorityNeeded(state.objectives.length)
  const counts: Partial<Record<SeatId, number>> = {}
  for (const o of state.objectives) {
    if (!o.controller) continue
    counts[o.controller] = (counts[o.controller] ?? 0) + 1
  }
  for (const seat of Object.keys(counts) as SeatId[]) {
    if ((counts[seat] ?? 0) >= need) {
      return pushLog(
        { ...state, phase: 'Ended', winner: seat, activeSeat: null },
        `${seat} wins by claiming ${counts[seat]} objective(s).`,
      )
    }
  }
  return state
}

/**
 * Majority claim: seat with the most living units inside the zone wins control.
 * Ties (including 0–0) leave the zone contested / unclaimed.
 * Dead units and grave markers do not count — only `state.units`.
 */
function resolveObjectiveController(
  counts: Partial<Record<SeatId, number>>,
): SeatId | null {
  let best: SeatId | null = null
  let bestCount = 0
  let tied = false
  for (const seat of Object.keys(counts) as SeatId[]) {
    const n = counts[seat] ?? 0
    if (n > bestCount) {
      best = seat
      bestCount = n
      tied = false
    } else if (n === bestCount && n > 0) {
      tied = true
    }
  }
  if (bestCount === 0 || tied) return null
  return best
}

function countUnitsInObjectiveZone(
  state: GameState,
  objective: GameState['objectives'][0],
): Partial<Record<SeatId, number>> {
  const zoneKeys = new Set(
    objectiveZoneHexes(objective).map((h) => hexKey(h.col, h.row)),
  )
  const counts: Partial<Record<SeatId, number>> = {}
  for (const u of state.units) {
    if (!zoneKeys.has(hexKey(u.col, u.row))) continue
    counts[u.seat] = (counts[u.seat] ?? 0) + 1
  }
  return counts
}

function recalculateObjectiveControl(
  state: GameState,
): { state: GameState; changedIds: string[] } {
  let next = state
  const changedIds: string[] = []
  const objectives = state.objectives.map((o) => {
    const controller = resolveObjectiveController(countUnitsInObjectiveZone(state, o))
    if (controller === o.controller) return o
    changedIds.push(o.id)
    if (controller && !o.controller) {
      next = pushLog(
        next,
        `${controller} claims objective zone at (${o.col},${o.row}) — majority inside.`,
      )
    } else if (o.controller && !controller) {
      next = pushLog(
        next,
        `Objective zone at (${o.col},${o.row}) is contested — unclaimed.`,
      )
    } else if (controller && o.controller && controller !== o.controller) {
      next = pushLog(
        next,
        `${controller} takes objective zone at (${o.col},${o.row}) from ${o.controller}.`,
      )
    }
    return { ...o, controller }
  })
  return {
    state: checkWinner({ ...next, objectives }),
    changedIds,
  }
}

export type ReduceResult =
  | { ok: true; state: GameState; seat?: SeatId; token?: string }
  | { ok: false; error: string }

function makeToken(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6)
}

function makeUnitId(seat: SeatId, kind: string): string {
  return `${seat}-${kind}-${Math.random().toString(36).slice(2, 7)}`
}

function armySummary(army: ResolvedArmy): string {
  const parts = [`${army.commander.name}`]
  for (const c of army.companies) {
    parts.push(
      `${c.officer.name}[${c.units.map((u) => u.name).join(', ')}]`,
    )
  }
  return `${parts.join(' · ')} (${army.totalUv} UV)`
}

/** In-memory armies after submit (server-side only enrichment). */
const resolvedBySeat = new Map<string, Map<SeatId, ResolvedArmy>>()
const loadoutBySeat = new Map<string, Map<SeatId, BattleLoadout>>()
const reserveQueuesBySeat = new Map<string, Map<SeatId, DeployItem[]>>()

function roomArmies(roomCode: string): Map<SeatId, ResolvedArmy> {
  let m = resolvedBySeat.get(roomCode)
  if (!m) {
    m = new Map()
    resolvedBySeat.set(roomCode, m)
  }
  return m
}

function roomLoadouts(roomCode: string): Map<SeatId, BattleLoadout> {
  let m = loadoutBySeat.get(roomCode)
  if (!m) {
    m = new Map()
    loadoutBySeat.set(roomCode, m)
  }
  return m
}

function roomReserveQueues(roomCode: string): Map<SeatId, DeployItem[]> {
  let m = reserveQueuesBySeat.get(roomCode)
  if (!m) {
    m = new Map()
    reserveQueuesBySeat.set(roomCode, m)
  }
  return m
}

export function createEmptyRoomState(
  roomCode: string,
  maxPlayers: 2 | 4 = 2,
  enforceCommanderRace = true,
): GameState {
  resolvedBySeat.delete(roomCode)
  loadoutBySeat.delete(roomCode)
  reserveQueuesBySeat.delete(roomCode)
  return createEmptyRoom(roomCode, maxPlayers, enforceCommanderRace)
}

export function reduceJoin(
  state: GameState,
  name: string,
  token?: string,
): ReduceResult {
  // Token reclaim: works in ANY phase
  if (token) {
    const existing = state.players.find((p) => p.token === token)
    if (existing) {
      const players = state.players.map((p) =>
        p.token === token ? { ...p, connected: true, name: name || p.name } : p,
      )
      return {
        ok: true,
        state: pushLog({ ...state, players }, `${existing.seat} (${name}) reconnected.`),
        seat: existing.seat,
        token: existing.token,
      }
    }
  }

  // New joins only allowed in Lobby/ArmyBuild
  if (state.phase !== 'Lobby' && state.phase !== 'ArmyBuild') {
    return { ok: false, error: 'Game already started — cannot join without a token.' }
  }
  if (state.players.length >= state.maxPlayers) {
    return { ok: false, error: 'Room is full.' }
  }

  const order = seatOrder(state.maxPlayers)
  const taken = new Set(state.players.map((p) => p.seat))
  const seat = order.find((s) => !taken.has(s))
  if (!seat) return { ok: false, error: 'No seats left.' }

  const slot: PlayerSlot = {
    seat,
    name: name.trim() || `Player ${seat}`,
    connected: true,
    token: makeToken(),
    army: null,
    armyReady: false,
    commanderReady: false,
    forceSelectReady: false,
    terrainReady: false,
    deployDone: false,
    armySummary: null,
    armyUv: null,
  }

  let next: GameState = {
    ...state,
    phase: 'ArmyBuild',
    players: [...state.players, slot],
  }
  next = pushLog(next, `${slot.name} joined as ${seat}. Build your army.`)

  return { ok: true, state: next, seat, token: slot.token }
}

export type LeaveResult =
  | { ok: true; state: GameState; removed: boolean }
  | { ok: false; error: string }

/** Intentional leave — remove seat in Lobby / pre-lock ArmyBuild, else reserve for rejoin. */
export function reduceLeave(state: GameState, seat: SeatId): LeaveResult {
  const player = state.players.find((p) => p.seat === seat)
  if (!player) return { ok: false, error: 'Not in room.' }

  const canRemove =
    state.phase === 'Lobby' ||
    (state.phase === 'ArmyBuild' && !player.armyReady)

  if (canRemove) {
    roomArmies(state.roomCode).delete(seat)
    roomLoadouts(state.roomCode).delete(seat)
    roomReserveQueues(state.roomCode).delete(seat)
    const players = state.players.filter((p) => p.seat !== seat)
    let next: GameState = { ...state, players }
    if (players.length === 0) {
      next = { ...next, phase: 'Lobby' }
    }
    next = pushLog(next, `${player.name} (${seat}) left the room.`)
    return { ok: true, state: next, removed: true }
  }

  const players = state.players.map((p) =>
    p.seat === seat ? { ...p, connected: false } : p,
  )
  return {
    ok: true,
    state: pushLog(
      { ...state, players },
      `${player.name} (${seat}) left — seat reserved for rejoin.`,
    ),
    removed: false,
  }
}

function lookupFromSnapshots(cards: CardSnapshot[]): CardLookup {
  const map: CardLookup = new Map()
  for (const c of cards) map.set(c.id, c)
  return map
}

function allArmiesReady(state: GameState): boolean {
  if (state.players.length < 2) return false
  if (state.players.length < state.maxPlayers) return false
  return state.players.every((p) => p.armyReady && p.army)
}

function allCommandersReady(state: GameState): boolean {
  if (state.players.length < 2) return false
  if (state.players.length < state.maxPlayers) return false
  return state.players.every((p) => p.commanderReady)
}

function beginObjectives(state: GameState): GameState {
  const card = drawObjectiveCardOutsideCommandRadii(
    state.boardSize,
    state.commanders,
    state.commanderRadii,
    state.roomCode,
  )
  const zones = objectiveZonesOnBoard(card, state.boardSize, state.roomCode)
  const objectives = zones.map((z, i) => ({
    id: `obj-${card.id}-${i}`,
    col: z.anchor.col,
    row: z.anchor.row,
    hexes: z.hexes,
    controller: null as SeatId | null,
  }))
  let next = pushLog(
    {
      ...state,
      phase: 'ForceSelect',
      objectiveCardId: card.id,
      objectives,
      terrain: {},
      terrainHands: {},
      terrainQueue: [],
      terrainStage: 'commandZone',
      commandZoneModes: {},
      landDropsUsed: {},
      players: state.players.map((p) => ({
        ...p,
        forceSelectReady: false,
      })),
    },
    `Objective card: ${card.name} (${objectives.length} zone(s)) — choose deploy / reserve / flex before terrain.`,
  )
  return next
}

function allForceSelectReady(state: GameState): boolean {
  if (state.players.length < 2) return false
  if (state.players.length < state.maxPlayers) return false
  if (!state.players.every((p) => p.forceSelectReady)) return false
  const loadouts = roomLoadouts(state.roomCode)
  return state.players.every((p) => loadouts.has(p.seat))
}

/** Host may start with fewer than maxPlayers once every joined seat is ready. */
export function canForceStart(
  state: GameState,
  seat: SeatId,
): { ok: true; next: 'Commanders' | 'ForceSelect' | 'Terrain' } | { ok: false; error: string } {
  if (seat !== state.hostSeat) {
    return { ok: false, error: 'Only the host can force-start.' }
  }
  const joined = state.players.length
  if (joined < 2) {
    return { ok: false, error: 'Need at least 2 players.' }
  }
  if (joined >= state.maxPlayers) {
    return { ok: false, error: 'Room is full — play proceeds normally.' }
  }
  if (!state.players.every((p) => p.armyReady && p.army)) {
    return { ok: false, error: 'Every joined player must lock an army first.' }
  }
  if (state.phase === 'ArmyBuild') {
    return { ok: true, next: 'Commanders' }
  }
  if (state.phase === 'Commanders') {
    if (!state.players.every((p) => p.commanderReady)) {
      return { ok: false, error: 'Every joined player must confirm commander first.' }
    }
    return { ok: true, next: 'ForceSelect' }
  }
  if (state.phase === 'ForceSelect') {
    if (!state.players.every((p) => p.forceSelectReady)) {
      return { ok: false, error: 'Every joined player must confirm force selection first.' }
    }
    const loadouts = roomLoadouts(state.roomCode)
    if (!state.players.every((p) => loadouts.has(p.seat))) {
      return { ok: false, error: 'Missing force loadouts.' }
    }
    return { ok: true, next: 'Terrain' }
  }
  return { ok: false, error: 'Force start is not available in this phase.' }
}

function queueItemsFromArmyBucket(
  army: ResolvedArmy,
  loadout: BattleLoadout,
  bucket: BattleBucket,
): DeployItem[] {
  return deployQueueFromArmy(army, loadout, bucket).map((item) => ({
    kind: item.kind,
    cardId: item.card.id,
    cardName: item.card.name,
    officerCardId: item.officerCardId,
    move: item.card.move && item.card.move > 0 ? item.card.move : DEFAULT_UNIT_MOVE,
    placed: false,
  }))
}

function makeUnitToken(opts: {
  seat: SeatId
  kind: UnitToken['kind']
  card: CardSnapshot
  officerCardId: string | null
  col: number
  row: number
}): UnitToken {
  const move =
    opts.card.move && opts.card.move > 0 ? opts.card.move : DEFAULT_UNIT_MOVE
  return {
    id: makeUnitId(opts.seat, opts.kind),
    seat: opts.seat,
    kind: opts.kind,
    cardId: opts.card.id,
    cardName: opts.card.name,
    officerCardId: opts.officerCardId,
    col: opts.col,
    row: opts.row,
    move,
    moveRemaining: 0,
    activationCol: null,
    activationRow: null,
    claimsThisActivation: [],
    movedBeyondLimit: false,
    damage: opts.card.damage,
    range: opts.card.range,
    toughness: opts.card.toughness,
    toughnessCurrent: opts.card.toughness,
    commandRadius: opts.card.commandRadius,
    keywords: [...(opts.card.keywords ?? [])],
    abilities: [...(opts.card.abilities ?? [])],
    ultimate: opts.card.ultimate ?? null,
    rooted: false,
    ...DEFAULT_UNIT_STATUSES,
    tempDamage: 0,
    tempMove: 0,
    harden: 0,
    abilityReadyRound: {},
    raiseOnceUsed: false,
    ultimateUsed: false,
    evadeActive: false,
    poisonTokens: 0,
    trampleLeftoverDamage: 0,
    assaultMarked: false,
    nullPulsed: false,
    counterattack: false,
    spectralStrike: false,
  }
}

function travelerFromUnit(unit: UnitToken): MoveCostOptions {
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

function commandZoneQuota(state: GameState) {
  return commandZonePieceQuota(state.maxPlayers)
}

function commandZoneTotalSlots(state: GameState) {
  return commandZoneSlotsTotal(state.maxPlayers)
}

function commandZoneMode(
  state: GameState,
  seat: SeatId,
): 'pieces' | 'flood' | undefined {
  return state.commandZoneModes[seat]
}

function commandZoneHasProgress(hand: TerrainQueueItem[]): boolean {
  return hand.some((q) => q.placed || q.skipped || q.flooded)
}

function commandZoneComplete(
  state: GameState,
  seat: SeatId,
): boolean {
  const hand = state.terrainHands[seat] ?? []
  const mode = commandZoneMode(state, seat)
  if (mode === 'flood') return hand.some((q) => q.flooded)
  if (mode === 'pieces') {
    return commandZonePiecesComplete(hand, commandZoneQuota(state))
  }
  return false
}

function terrainQuotaLabel(state: GameState): string {
  const q = commandZoneQuota(state)
  const parts: string[] = []
  if (q.large > 0) parts.push(`${q.large} large`)
  if (q.medium > 0) parts.push(`${q.medium} medium`)
  parts.push(`${q.small} small`)
  return parts.join(' + ')
}

function beginTerrain(state: GameState): GameState {
  const armies = roomArmies(state.roomCode)
  const commanderRadii: GameState['commanderRadii'] = { ...state.commanderRadii }
  for (const p of state.players) {
    const army = armies.get(p.seat)
    const cr = army?.commander.commandRadius
    commanderRadii[p.seat] = cr && cr > 0 ? cr : 5
  }
  const terrainHands: GameState['terrainHands'] = {}
  for (const p of state.players) terrainHands[p.seat] = []
  const quota = terrainQuotaLabel(state)
  return pushLog(
    {
      ...state,
      phase: 'Terrain',
      terrainStage: 'commandZone',
      terrainHands,
      terrainQueue: [],
      commandZoneModes: {},
      landDropsUsed: {},
      commanderRadii,
      activeSeat: null,
      players: state.players.map((p) => ({ ...p, terrainReady: false })),
    },
    `Terrain — command zone: flood your CR with one terrain type OR place pieces (${quota}). Then large → medium → small land on the battlefield. Same-kind overlap OK. CR water is small-only; battlefield water uses the soft cap (${WATER_HEX_CAP} hexes). Water/Wall may not seal your commander in.`,
  )
}

function makeSkippedCommandZoneSlot(
  seat: SeatId,
  index: number,
  sizeClass: TerrainSizeClass,
): TerrainQueueItem {
  return {
    instanceId: `${seat}-skip-${index}`,
    pieceId: '__skip__',
    name: 'Skipped',
    kind: 'plains',
    sizeClass,
    shape: [],
    placed: false,
    skipped: true,
  }
}

function finishCommandZoneIfReady(state: GameState, seat: SeatId): GameState {
  if (!commandZoneComplete(state, seat)) return state
  let next: GameState = {
    ...state,
    players: state.players.map((p) =>
      p.seat === seat ? { ...p, terrainReady: true } : p,
    ),
  }
  next = pushLog(next, `${seat} finished command-zone terrain.`)
  if (next.players.every((p) => p.terrainReady)) {
    next = beginLandStage(next, 'landLarge')
  }
  return next
}

type LandStage = 'landLarge' | 'landMedium' | 'landSmall'

function landSizeForStage(stage: LandStage): TerrainSizeClass {
  if (stage === 'landLarge') return 'large'
  if (stage === 'landMedium') return 'medium'
  return 'small'
}

function isLandTerrainStage(
  stage: GameState['terrainStage'],
): stage is LandStage {
  return (
    stage === 'landLarge' ||
    stage === 'landMedium' ||
    stage === 'landSmall'
  )
}

function beginLandStage(state: GameState, stage: LandStage): GameState {
  const turnOrder = seatOrder(state.maxPlayers).filter((s) =>
    state.players.some((p) => p.seat === s),
  )
  const first = turnOrder[0] ?? null
  const size = landSizeForStage(stage)
  const step =
    stage === 'landLarge' ? '2/4' : stage === 'landMedium' ? '3/4' : '4/4'
  const landDropsUsed: GameState['landDropsUsed'] = {}
  for (const p of state.players) landDropsUsed[p.seat] = 0
  return pushLog(
    {
      ...state,
      phase: 'Terrain',
      terrainStage: stage,
      terrainQueue: [],
      landDropsUsed,
      turnOrder,
      activeSeat: first,
      players: state.players.map((p) => ({ ...p, terrainReady: false })),
    },
    `Terrain ${step} — ${size} land on the battlefield: each player places or skips ${TERRAIN_LAND_DROPS_PER_SIZE} pieces (pick shape, then type). Stay out of other commanders' CR. Starting: ${first}.`,
  )
}

function advanceAfterLandDrop(state: GameState, seat: SeatId): GameState {
  const used = {
    ...state.landDropsUsed,
    [seat]: (state.landDropsUsed[seat] ?? 0) + 1,
  }
  let next: GameState = { ...state, landDropsUsed: used }
  const allDone = next.players.every(
    (p) => (used[p.seat] ?? 0) >= TERRAIN_LAND_DROPS_PER_SIZE,
  )
  if (!allDone) {
    const nextActive = nextSeat(next.turnOrder, seat)
    next = { ...next, activeSeat: nextActive }
    return pushLog(next, `${nextActive}'s land drop.`)
  }

  if (next.terrainStage === 'landLarge') {
    return beginLandStage(next, 'landMedium')
  }
  if (next.terrainStage === 'landMedium') {
    return beginLandStage(next, 'landSmall')
  }
  next = { ...next, activeSeat: null }
  next = pushLog(next, 'All battlefield land drops finished — deploying armies.')
  return beginDeploy(next)
}

/** Hexes inside a seat's Command Radius (including the commander hex). */
export function commandRadiusKeys(
  origin: OddR,
  radius: number,
  boardSize: number,
): Set<string> {
  const keys = new Set<string>()
  const r = Math.max(0, radius)
  for (let row = 0; row < boardSize; row++) {
    for (let col = 0; col < boardSize; col++) {
      if (hexDistOddR(origin, { col, row }) <= r) keys.add(hexKey(col, row))
    }
  }
  return keys
}

function validateWaterWallTerrain(
  state: GameState,
  terrain: GameState['terrain'],
  commander: OddR,
  ownCr: Set<string>,
  kind: TerrainKind,
): { ok: true } | { ok: false; error: string } {
  if (kind !== 'water' && kind !== 'wall') return { ok: true }
  if (!commanderHasEscapePath(commander, terrain, state.boardSize, ownCr)) {
    return {
      ok: false,
      error:
        'That Water/Wall seals your commander in — leave an open path out of your Command Radius.',
    }
  }
  const commanders = Object.values(state.commanders).filter(
    (c): c is OddR => !!c,
  )
  const objectiveHexes = flattenObjectiveHexes(state.objectives)
  if (
    !terrainSetupStayConnected(
      commanders,
      objectiveHexes,
      terrain,
      state.boardSize,
    )
  ) {
    return { ok: false, error: TERRAIN_CONNECTIVITY_ERROR }
  }
  return { ok: true }
}

function validateImpassableTerrainConnectivity(
  state: GameState,
  terrain: GameState['terrain'],
): { ok: true } | { ok: false; error: string } {
  const commanders = Object.values(state.commanders).filter(
    (c): c is OddR => !!c,
  )
  const objectiveHexes = flattenObjectiveHexes(state.objectives)
  if (
    terrainSetupStayConnected(
      commanders,
      objectiveHexes,
      terrain,
      state.boardSize,
    )
  ) {
    return { ok: true }
  }
  return { ok: false, error: TERRAIN_CONNECTIVITY_ERROR }
}

/** Other players' command radii — blocked for the placer during terrain setup. */
export function foreignCommandRadiusKeys(
  state: GameState,
  placerSeat: SeatId,
): Set<string> {
  const blocked = new Set<string>()
  for (const seat of Object.keys(state.commanders) as SeatId[]) {
    if (seat === placerSeat) continue
    const origin = state.commanders[seat]
    if (!origin) continue
    const radius = state.commanderRadii[seat] ?? 5
    for (const key of commandRadiusKeys(origin, radius, state.boardSize)) {
      blocked.add(key)
    }
  }
  return blocked
}

export function ownCommandRadiusKeys(
  state: GameState,
  seat: SeatId,
): Set<string> {
  const origin = state.commanders[seat]
  if (!origin) return new Set()
  const radius = state.commanderRadii[seat] ?? 5
  return commandRadiusKeys(origin, radius, state.boardSize)
}

function beginDeploy(state: GameState): GameState {
  const armies = roomArmies(state.roomCode)
  const commanders: GameState['commanders'] = {}
  const units: UnitToken[] = []
  const deployQueues: GameState['deployQueues'] = {}
  const reserveStore = roomReserveQueues(state.roomCode)
  reserveStore.clear()
  const terrain = fillEmptyHexesWithPlains(state.terrain ?? {}, state.boardSize)
  const filled =
    Object.keys(terrain).length - Object.keys(state.terrain ?? {}).length

  for (const p of state.players) {
    const army = armies.get(p.seat)
    const loadout = roomLoadouts(state.roomCode).get(p.seat)
    if (!army || !loadout) continue
    const hex = edgeCommanderHex(p.seat, state.boardSize)
    commanders[p.seat] = hex
    units.push(
      makeUnitToken({
        seat: p.seat,
        kind: 'commander',
        card: army.commander,
        officerCardId: null,
        col: hex.col,
        row: hex.row,
      }),
    )
    deployQueues[p.seat] = queueItemsFromArmyBucket(army, loadout, 'deploy')
    reserveStore.set(p.seat, queueItemsFromArmyBucket(army, loadout, 'reserve'))
  }

  return pushLog(
    {
      ...state,
      phase: 'Deploy',
      terrain,
      commanders,
      units,
      deployQueues,
      activeSeat: null,
      activeCompanyOfficerId: null,
      players: state.players.map((p) => ({ ...p, deployDone: false })),
    },
    `Open hexes filled with plains (${filled} hexes). Deploy: officers in your Command Radius; units inside their officer’s Command Radius. ≥${MIN_OBJECTIVE_DISTANCE} hexes from objective zones.`,
  )
}

function beginPlay(state: GameState): GameState {
  const turnOrder = seatOrder(state.maxPlayers).filter((s) =>
    state.players.some((p) => p.seat === s),
  )
  const withPools = refreshAllPools({
    ...state,
    phase: 'Play',
    turnOrder,
    activeSeat: turnOrder[0] ?? null,
    round: 1,
    activeCompanyOfficerId: null,
    lastDiceRoll: null,
    lastCombatResult: null,
    units: state.units.map((u) => ({ ...u, moveRemaining: 0 })),
  })
  return pushLog(
    withPools,
    `Play begins — Round 1. ${turnOrder[0]} acts first. Activate a company, spend AP/CC, resolve attacks (auto or manual).`,
  )
}

function advanceTurn(state: GameState, fromSeat: SeatId): GameState {
  const next = nextSeat(state.turnOrder, fromSeat)
  const wrapped = state.turnOrder[0] === next
  const round = wrapped ? state.round + 1 : state.round
  let out = endPreviousCompanyActivation(state, fromSeat)
  out = {
    ...out,
    activeSeat: next,
    activeCompanyOfficerId: null,
    round,
    units: out.units.map((u) =>
      u.seat === fromSeat || u.seat === next
        ? {
            ...u,
            moveRemaining: 0,
            activationCol: null,
            activationRow: null,
            claimsThisActivation: [],
            movedBeyondLimit: false,
          }
        : u,
    ),
  }
  if (wrapped) {
    out = {
      ...out,
      commanderActivatedThisRound: {},
      units: out.units.map((u) =>
        clearRoundStatuses({
          ...u,
          tempDamage: 0,
          tempMove: 0,
          harden: 0,
          evadeActive: false,
          trampleLeftoverDamage: 0,
        }),
      ),
    }
    out = refreshCommanderPools(out)
    out = pushLog(out, `Round ${round} begins — commander AP/CC refreshed.`)
  }
  return pushLog(out, `${next}'s turn.`)
}

function catalogCard(
  state: GameState,
  cardId: string | null | undefined,
): CardSnapshot | null {
  if (!cardId) return null
  return state.cardCatalog[cardId] ?? null
}

function refreshCommanderPools(state: GameState): GameState {
  const commanderPools: GameState['commanderPools'] = {
    ...state.commanderPools,
  }
  for (const p of state.players) {
    const cmdr = state.units.find(
      (u) => u.seat === p.seat && u.kind === 'commander',
    )
    const snap = catalogCard(state, cmdr?.cardId)
    const apMax = Math.max(0, snap?.apGeneration ?? 0)
    const ccMax = Math.max(0, snap?.ccGeneration ?? 0)
    commanderPools[p.seat] = {
      ap: apMax,
      cc: ccMax,
      apMax,
      ccMax,
    }
  }
  return { ...state, commanderPools }
}

function refreshCompanyPool(
  state: GameState,
  officer: UnitToken,
): GameState {
  const snap = catalogCard(state, officer.cardId)
  const max = Math.max(0, snap?.companyAp ?? 0)
  return {
    ...state,
    companyPools: {
      ...state.companyPools,
      [officer.id]: { ap: max, apMax: max },
    },
  }
}

function refreshAllPools(state: GameState): GameState {
  let next = refreshCommanderPools(state)
  const companyPools: GameState['companyPools'] = {}
  for (const u of next.units) {
    if (u.kind !== 'officer') continue
    const snap = catalogCard(next, u.cardId)
    const max = Math.max(0, snap?.companyAp ?? 0)
    companyPools[u.id] = { ap: max, apMax: max }
  }
  return { ...next, companyPools }
}

function deathRecordFromUnit(state: GameState, unit: UnitToken): DeathRecord {
  return {
    id: `grave-${unit.id}-${Math.random().toString(36).slice(2, 7)}`,
    unitId: unit.id,
    seat: unit.seat,
    kind: unit.kind,
    cardId: unit.cardId,
    cardName: unit.cardName,
    officerCardId: unit.officerCardId,
    col: unit.col,
    row: unit.row,
    round: state.round,
    move: unit.move,
    damage: unit.damage,
    range: unit.range,
    toughness: unit.toughness,
    commandRadius: unit.commandRadius,
    keywords: [...unit.keywords],
    abilities: [...unit.abilities],
    ultimate: unit.ultimate,
  }
}

function cardSnapshotFromDeath(
  state: GameState,
  death: DeathRecord,
): CardSnapshot {
  const fromCatalog = state.cardCatalog[death.cardId]
  if (fromCatalog) return fromCatalog
  return {
    id: death.cardId,
    name: death.cardName,
    cardType: death.kind === 'officer' ? 'Officer' : 'Unit',
    rarity: null,
    unique: false,
    race: null,
    uv: null,
    move: death.move,
    damage: death.damage,
    range: death.range,
    toughness: death.toughness,
    companyCapacity: null,
    commandRadius: death.commandRadius,
    companyAp: null,
    apGeneration: null,
    ccGeneration: null,
    keywords: death.keywords,
    abilities: death.abilities,
    ultimate: death.ultimate,
  }
}

function buildRevivedUnit(
  state: GameState,
  death: DeathRecord,
  col: number,
  row: number,
  toughnessParam: number,
): UnitToken {
  const card = cardSnapshotFromDeath(state, death)
  const unit = makeUnitToken({
    seat: death.seat,
    kind: death.kind,
    card,
    officerCardId: death.officerCardId,
    col,
    row,
  })
  const printed = unit.toughness ?? death.toughness ?? 1
  const start = Math.max(
    1,
    Math.min(printed, Math.floor(toughnessParam) || 1),
  )
  return {
    ...unit,
    moveRemaining: 0,
    toughnessCurrent: start,
  }
}

function removeDestroyedUnits(state: GameState): GameState {
  const destroyed = state.units.filter(
    (u) =>
      u.kind !== 'commander' &&
      u.toughnessCurrent != null &&
      u.toughnessCurrent <= 0,
  )
  if (!destroyed.length) return state
  let next = state
  const deaths = [...(state.deaths ?? [])]
  const deadIds = new Set<string>()
  for (const u of destroyed) {
    deadIds.add(u.id)
    deaths.push(deathRecordFromUnit(next, u))
    next = pushLog(
      next,
      `${u.cardName} (${u.seat}) is destroyed at (${u.col},${u.row}).`,
    )
  }
  const companyPools = { ...next.companyPools }
  for (const id of deadIds) delete companyPools[id]
  const cleared: GameState = {
    ...next,
    units: next.units.filter((u) => !deadIds.has(u.id)),
    deaths,
    companyPools,
    activeCompanyOfficerId:
      next.activeCompanyOfficerId && deadIds.has(next.activeCompanyOfficerId)
        ? null
        : next.activeCompanyOfficerId,
  }
  return recalculateObjectiveControl(cleared).state
}

/**
 * Friendly targets for Officer/Commander casts (Command Radius).
 * Officer: Combat Units of that Officer's company only (never other companies,
 * never the Commander, never other Officers).
 * Commander: army in CR.
 */
function friendsInCasterRadius(
  state: GameState,
  caster: UnitToken,
): UnitToken[] {
  const rad = caster.commandRadius ?? 0
  return state.units.filter((u) => {
    if (!u || u.seat !== caster.seat) return false
    if (hexDistOddR(caster, u) > rad) return false
    if (caster.kind === 'officer') {
      return u.kind === 'unit' && u.officerCardId === caster.cardId
    }
    // Commander: army in Command Radius
    return true
  })
}

/**
 * Combat Unit abilities (e.g. Heal): any friendly model within printed Range.
 */
function friendsInUnitRange(state: GameState, caster: UnitToken): UnitToken[] {
  const range = Math.max(0, caster.range ?? 1)
  return state.units.filter((u) => {
    if (!u || u.seat !== caster.seat) return false
    return hexDistOddR(caster, u) <= range
  })
}

function friendsForCaster(state: GameState, caster: UnitToken): UnitToken[] {
  if (caster.kind === 'unit') return friendsInUnitRange(state, caster)
  return friendsInCasterRadius(state, caster)
}

/** Same-seat target must be in the caster's legal friend pool. */
function resolveFriendlyTarget(
  friends: UnitToken[],
  target: UnitToken | null,
  casterSeat: string,
): UnitToken | null {
  if (target && target.seat === casterSeat && friends.some((f) => f.id === target.id)) {
    return target
  }
  return friends[0] ?? null
}

function unitRace(state: GameState, u: UnitToken): string {
  return (catalogCard(state, u.cardId)?.race || '').toLowerCase()
}

function unitKeywords(state: GameState, u: UnitToken): string[] {
  if (u.keywords?.length) return u.keywords
  return catalogCard(state, u.cardId)?.keywords ?? []
}

function hasUnitKeyword(state: GameState, u: UnitToken, kw: string): boolean {
  const needle = kw.toLowerCase()
  return unitKeywords(state, u).some((k) => k.toLowerCase() === needle)
}

function isBeastfolkUnit(state: GameState, u: UnitToken): boolean {
  return unitRace(state, u) === 'beastfolk' || hasUnitKeyword(state, u, 'beast')
}

function isConstructUnit(state: GameState, u: UnitToken): boolean {
  return unitRace(state, u) === 'construct' || hasUnitKeyword(state, u, 'construct')
}

function isUndeadUnit(state: GameState, u: UnitToken): boolean {
  return unitRace(state, u) === 'undead' || hasUnitKeyword(state, u, 'undead')
}

function isDragonUnit(state: GameState, u: UnitToken): boolean {
  return unitRace(state, u) === 'dragon' || hasUnitKeyword(state, u, 'dragon')
}

function isLizardmanUnit(state: GameState, u: UnitToken): boolean {
  return unitRace(state, u) === 'lizardman' || hasUnitKeyword(state, u, 'lizardman')
}

function isNatureUnit(state: GameState, u: UnitToken): boolean {
  const race = unitRace(state, u)
  return (
    race === 'elf' ||
    hasUnitKeyword(state, u, 'nature') ||
    hasUnitKeyword(state, u, 'elf') ||
    isLizardmanUnit(state, u)
  )
}

function isInfantryUnit(state: GameState, u: UnitToken): boolean {
  const range = u.range ?? catalogCard(state, u.cardId)?.range ?? 1
  if (range > 1) return false
  if (hasUnitKeyword(state, u, 'beast') || hasUnitKeyword(state, u, 'cavalry')) {
    return false
  }
  return u.kind === 'unit'
}

function applyDamageToUnits(
  state: GameState,
  targets: UnitToken[],
  amount: number,
  opts: { applyStatuses?: Partial<UnitToken> } = {},
): GameState {
  const hit = new Set(targets.map((t) => t.id))
  let next: GameState = {
    ...state,
    units: state.units.map((u) => {
      if (!hit.has(u.id) || u.toughnessCurrent == null) return u
      if (u.unyielding && amount > 0) {
        return { ...u, unyielding: false, ...(opts.applyStatuses ?? {}) }
      }
      const nextTough = Math.max(0, u.toughnessCurrent - amount)
      const patch = nextTough > 0 ? (opts.applyStatuses ?? {}) : {}
      return { ...u, toughnessCurrent: nextTough, ...patch }
    }),
  }
  return removeDestroyedUnits(next)
}

function endPreviousCompanyActivation(
  state: GameState,
  seat: SeatId,
): GameState {
  const prevOfficerId = state.activeCompanyOfficerId
  if (!prevOfficerId) return state
  const prevOfficer = state.units.find((u) => u.id === prevOfficerId)
  if (!prevOfficer || prevOfficer.seat !== seat) return state
  const companyCardId = prevOfficer.cardId
  return {
    ...state,
    units: state.units.map((u) => {
      const inPrevCompany =
        u.seat === seat &&
        (u.id === prevOfficerId || u.officerCardId === companyCardId)
      if (!inPrevCompany) return u
      return clearConsumedSlow(u)
    }),
  }
}

function patchUnitsById(
  state: GameState,
  ids: Set<string>,
  patch: Partial<UnitToken>,
): GameState {
  return {
    ...state,
    units: state.units.map((u) => (ids.has(u.id) ? { ...u, ...patch } : u)),
  }
}

function foesInRange(
  state: GameState,
  caster: UnitToken,
  radius: number,
  seat?: SeatId,
): UnitToken[] {
  return state.units.filter(
    (u) =>
      u.seat !== (seat ?? caster.seat) &&
      hexDistOddR(caster, u) <= radius &&
      u.toughnessCurrent != null &&
      u.kind !== 'commander',
  )
}

function applyCastEffect(opts: {
  state: GameState
  caster: UnitToken
  abilityName: string
  effectName: string
  def: AbilityDef
  target: UnitToken | null
}): { ok: true; state: GameState; note: string } | { ok: false; error: string } {
  const { state, caster, effectName, target } = opts
  const friends = friendsForCaster(state, caster)
  const foeRad =
    caster.kind === 'unit'
      ? Math.max(0, caster.range ?? 1)
      : (caster.commandRadius ?? 0)
  const foes = state.units.filter(
    (u) => u.seat !== caster.seat && hexDistOddR(caster, u) <= foeRad,
  )

  const bumpFriends = (
    pred: (u: UnitToken) => boolean,
    patch: (u: UnitToken) => Partial<UnitToken>,
  ) => {
    const hit = friends.filter(pred)
    return {
      units: state.units.map((u) => {
        const f = hit.find((h) => h.id === u.id)
        return f ? { ...u, ...patch(f) } : u
      }),
      count: hit.length,
    }
  }

  // Beast Banner: one company in CR (not whole army).
  if (opts.abilityName === 'Beast Banner' && caster.kind === 'commander') {
    const rad = caster.commandRadius ?? 0
    const officers = state.units.filter(
      (u) => u.seat === caster.seat && u.kind === 'officer',
    )
    let companyCardId: string | null = null
    const active = state.activeCompanyOfficerId
      ? state.units.find((u) => u.id === state.activeCompanyOfficerId)
      : null
    if (active?.kind === 'officer' && active.seat === caster.seat) {
      companyCardId = active.cardId
    } else {
      let best = -1
      for (const off of officers) {
        const n = state.units.filter(
          (u) =>
            u.seat === caster.seat &&
            u.kind === 'unit' &&
            u.officerCardId === off.cardId &&
            hexDistOddR(caster, u) <= rad,
        ).length
        if (n > best) {
          best = n
          companyCardId = off.cardId
        }
      }
    }
    const hit = state.units.filter(
      (u) =>
        u.seat === caster.seat &&
        u.kind === 'unit' &&
        u.officerCardId === companyCardId &&
        hexDistOddR(caster, u) <= rad,
    )
    return {
      ok: true,
      state: {
        ...state,
        units: state.units.map((u) => {
          const f = hit.find((h) => h.id === u.id)
          return f ? { ...u, tempMove: (u.tempMove || 0) + 1 } : u
        }),
      },
      note: `Beast Banner: +1 Move to ${hit.length} Beast(s) of one company in CR.`,
    }
  }

  // Matriarch's Protection: one company in CR gains Harden 1.
  if (opts.abilityName === "Matriarch's Protection" && caster.kind === 'commander') {
    const rad = caster.commandRadius ?? 0
    const officers = state.units.filter(
      (u) => u.seat === caster.seat && u.kind === 'officer',
    )
    let companyCardId: string | null = null
    const active = state.activeCompanyOfficerId
      ? state.units.find((u) => u.id === state.activeCompanyOfficerId)
      : null
    if (active?.kind === 'officer' && active.seat === caster.seat) {
      companyCardId = active.cardId
    } else {
      let best = -1
      for (const off of officers) {
        const n = state.units.filter(
          (u) =>
            u.seat === caster.seat &&
            u.kind === 'unit' &&
            u.officerCardId === off.cardId &&
            hexDistOddR(caster, u) <= rad,
        ).length
        if (n > best) {
          best = n
          companyCardId = off.cardId
        }
      }
    }
    const hit = state.units.filter(
      (u) =>
        u.seat === caster.seat &&
        u.kind === 'unit' &&
        u.officerCardId === companyCardId &&
        hexDistOddR(caster, u) <= rad,
    )
    return {
      ok: true,
      state: {
        ...state,
        units: state.units.map((u) => {
          const f = hit.find((h) => h.id === u.id)
          return f ? { ...u, harden: Math.max(u.harden || 0, 1) } : u
        }),
      },
      note: `Matriarch's Protection: Harden 1 on ${hit.length} Beast(s) of one company in CR.`,
    }
  }

  // Buff packages (army/company in CR)
  if (
    effectName === 'Brood Call' ||
    effectName === 'Death March' ||
    effectName === "Beastmaster's Call" ||
    effectName === 'Pack Hunt' ||
    effectName === 'Hold the Line' ||
    effectName === 'Scale Ward' ||
    effectName === 'Sealant Coat' ||
    effectName === 'Shield Brotherhood' ||
    effectName === 'Wild Rush' ||
    effectName === 'Cannon Drill' ||
    effectName === 'Anvil Advance'
  ) {
    const { units, count } = bumpFriends(
      () => true,
      (u) => {
        const next: Partial<UnitToken> = {}
        if (
          effectName === 'Brood Call' ||
          effectName === 'Death March' ||
          effectName === "Beastmaster's Call" ||
          effectName === 'Anvil Advance'
        ) {
          next.tempMove = (u.tempMove || 0) + 1
        }
        if (effectName === 'Death March' && isUndeadUnit(state, u)) {
          next.slow = false
          next.slowPendingClear = false
        }
        if (
          effectName === 'Brood Call' ||
          effectName === 'Pack Hunt' ||
          effectName === 'Cannon Drill'
        ) {
          next.tempDamage = (u.tempDamage || 0) + 1
        }
        if (
          effectName === 'Hold the Line' ||
          effectName === 'Scale Ward' ||
          effectName === 'Sealant Coat' ||
          effectName === 'Anvil Advance'
        ) {
          next.harden = Math.max(u.harden || 0, effectName === 'Scale Ward' ? 2 : 1)
        }
        return next
      },
    )
    return {
      ok: true,
      state: { ...state, units },
      note: `Buffed ${count} ally unit(s) in radius.`,
    }
  }

  if (effectName === 'Harden Order') {
    const ally = resolveFriendlyTarget(friends, target, caster.seat)
    if (!ally) {
      return {
        ok: false,
        error:
          caster.kind === 'officer'
            ? 'Choose a Combat Unit of this company.'
            : 'Choose a friendly ally.',
      }
    }
    return {
      ok: true,
      state: {
        ...state,
        units: state.units.map((u) =>
          u.id === ally.id ? { ...u, harden: Math.max(u.harden || 0, 2) } : u,
        ),
      },
      note: `${ally.cardName} gains Harden 2.`,
    }
  }

  if (
    effectName === 'Fortify Position' ||
    effectName === 'Fortify Works' ||
    effectName === 'Stoneworks' ||
    effectName === 'Grave Fortify'
  ) {
    const hex =
      target != null
        ? { col: target.col, row: target.row }
        : { col: caster.col, row: caster.row }
    const key = hexKey(hex.col, hex.row)
    const fortifiedHexes = { ...(state.fortifiedHexes ?? {}), [key]: true }
    let units = state.units
    const occupant = state.units.find((u) => u.col === hex.col && u.row === hex.row)
    if (occupant && occupant.seat === caster.seat) {
      units = state.units.map((u) =>
        u.id === occupant.id
          ? {
              ...u,
              harden: Math.max(
                u.harden || 0,
                effectName === 'Fortify Works' || effectName === 'Stoneworks' ? 2 : 1,
              ),
            }
          : u,
      )
    }
    return {
      ok: true,
      state: { ...state, fortifiedHexes, units },
      note: `Fortified (${hex.col},${hex.row})${occupant ? ` — ${occupant.cardName} gains Harden` : ''}.`,
    }
  }

  if (effectName === 'Overdrive') {
    const ally = resolveFriendlyTarget(friends, target, caster.seat)
    if (!ally) {
      return {
        ok: false,
        error:
          caster.kind === 'officer'
            ? 'Choose a Combat Unit of this company.'
            : 'Choose a friendly ally.',
      }
    }
    return {
      ok: true,
      state: {
        ...state,
        units: state.units.map((u) =>
          u.id === ally.id
            ? { ...u, tempDamage: (u.tempDamage || 0) + 1 }
            : u,
        ),
      },
      note: `${ally.cardName} gains +1 Damage.`,
    }
  }

  if (
    effectName === 'Withering Gaze' ||
    effectName === 'Howl' ||
    effectName === 'Mass Fear'
  ) {
    if (effectName === 'Withering Gaze' && !target) {
      return { ok: false, error: 'Choose an enemy target.' }
    }
    let feared = 0
    let next = state
    if (effectName === 'Mass Fear') {
      const enemyIds = new Set<string>()
      for (const foe of state.units.filter((u) => u.seat !== caster.seat)) {
        const nearAlly = friends.some((u) => hexDistOddR(u, foe) === 1)
        if (nearAlly && canGainFear(foe)) enemyIds.add(foe.id)
      }
      next = {
        ...next,
        units: next.units.map((u) =>
          enemyIds.has(u.id) ? { ...u, ...patchFear(u) } : u,
        ),
      }
      feared = enemyIds.size
    } else {
      const radius = effectName === 'Howl' ? 1 : 3
      const targets =
        effectName === 'Withering Gaze' && target
          ? [target]
          : foesInRange(state, caster, radius)
      const enemyIds = new Set(
        targets.filter((f) => canGainFear(f)).map((f) => f.id),
      )
      next = {
        ...state,
        units: state.units.map((u) =>
          enemyIds.has(u.id) ? { ...u, ...patchFear(u) } : u,
        ),
      }
      feared = enemyIds.size
    }
    const note =
      effectName === 'Howl'
        ? `Adjacent enemies gain Fear (${feared} affected).`
        : effectName === 'Mass Fear'
          ? `Enemies near allies in CR gain Fear (${feared} affected).`
          : `${target?.cardName ?? 'Target'} gains Fear.`
    return { ok: true, state: next, note }
  }

  if (effectName === 'Eclipse of Fear' || effectName === 'Alpha Howl') {
    const rad = caster.commandRadius ?? 6
    const enemyIds = new Set(
      foesInRange(state, caster, rad)
        .filter((f) => canGainFear(f))
        .map((f) => f.id),
    )
    return {
      ok: true,
      state: {
        ...state,
        units: state.units.map((u) => {
          if (!enemyIds.has(u.id)) return u
          return {
            ...u,
            ...patchFear(u),
            tempDamage: Math.max((u.tempDamage || 0) - 1, -1),
          }
        }),
      },
      note: `${effectName}: ${enemyIds.size} enemy/enemies gain Fear${effectName === 'Eclipse of Fear' ? ' and −1 Damage' : ''}.`,
    }
  }

  if (effectName === 'Snare') {
    const candidates = foesInRange(state, caster, 3).sort((a, b) => {
      const packBias = (x: UnitToken) => (hasUnitAbility(x, 'Pack') ? 0 : 1)
      const moveBias = (x: UnitToken) => -(x.move || 0)
      return (
        packBias(a) - packBias(b) ||
        moveBias(a) - moveBias(b) ||
        hexDistOddR(caster, a) - hexDistOddR(caster, b) ||
        (a.toughnessCurrent ?? 0) - (b.toughnessCurrent ?? 0)
      )
    })
    const foe = candidates[0]
    if (!foe) return { ok: true, state, note: 'Snare: no enemy in range.' }
    return {
      ok: true,
      state: patchUnitsById(state, new Set([foe.id]), patchRoot()),
      note: `${foe.cardName} is Rooted until round refresh.`,
    }
  }

  if (effectName === 'Bone Prison') {
    const candidates = foesInRange(state, caster, 3).sort((a, b) => {
      const moveBias = (x: UnitToken) => -(x.move || 0)
      const dmgBias = (x: UnitToken) => -(x.damage || 0)
      return (
        moveBias(a) - moveBias(b) ||
        dmgBias(a) - dmgBias(b) ||
        hexDistOddR(caster, a) - hexDistOddR(caster, b) ||
        (a.toughnessCurrent ?? 0) - (b.toughnessCurrent ?? 0)
      )
    })
    const foe = candidates[0]
    if (!foe) return { ok: true, state, note: 'Bone Prison: no enemy in range.' }
    return {
      ok: true,
      state: patchUnitsById(state, new Set([foe.id]), patchBonePrison()),
      note: `${foe.cardName} is Rooted and cannot attack until round refresh.`,
    }
  }

  if (effectName === 'Entangling Roots') {
    const foe = foesInRange(state, caster, 4).sort(
      (a, b) => (a.toughnessCurrent ?? 0) - (b.toughnessCurrent ?? 0),
    )[0]
    if (!foe) {
      return { ok: true, state, note: 'Entangling Roots: no enemy in range.' }
    }
    return {
      ok: true,
      state: patchUnitsById(state, new Set([foe.id]), {
        ...patchRoot(),
        tempMove: Math.min(foe.tempMove || 0, -1),
      }),
      note: `${foe.cardName} is Rooted (−1 Move).`,
    }
  }

  if (effectName === 'Serpent Coil') {
    const foe = foesInRange(state, caster, 3).sort(
      (a, b) => (a.toughnessCurrent ?? 0) - (b.toughnessCurrent ?? 0),
    )[0]
    if (!foe) return { ok: true, state, note: 'Serpent Coil: no enemy in range.' }
    return {
      ok: true,
      state: patchUnitsById(state, new Set([foe.id]), patchRoot()),
      note: `${foe.cardName} is Rooted.`,
    }
  }

  if (effectName === 'Shadow Orb') {
    const foe = foesInRange(state, caster, 6).sort(
      (a, b) => (a.toughnessCurrent ?? 0) - (b.toughnessCurrent ?? 0),
    )[0]
    if (!foe) return { ok: true, state, note: 'Shadow Orb: no enemy in range.' }
    let next = applyDamageToUnits(state, [foe], 2)
    const survivor = next.units.find((u) => u.id === foe.id)
    if (survivor && (survivor.toughnessCurrent ?? 0) > 0) {
      next = patchUnitsById(next, new Set([foe.id]), patchSlow())
    }
    return {
      ok: true,
      state: next,
      note: `${foe.cardName} takes 2 damage${survivor && (survivor.toughnessCurrent ?? 0) > 0 ? ' and gains Slow' : ''}.`,
    }
  }

  if (effectName === 'Rally') {
    const officerId =
      state.activeCompanyOfficerId ||
      state.units.find((u) => u.seat === caster.seat && u.kind === 'officer')?.id
    if (!officerId) return { ok: false, error: 'No officer company to Rally.' }
    const pool = state.companyPools[officerId] ?? { ap: 0, apMax: 0 }
    return {
      ok: true,
      state: {
        ...state,
        companyPools: {
          ...state.companyPools,
          [officerId]: { ...pool, ap: pool.ap + 1 },
        },
      },
      note: 'Granted +1 Company AP.',
    }
  }

  if (
    effectName === 'Repair' ||
    effectName === 'Rebuild Protocol' ||
    effectName === 'Heal' ||
    effectName === 'Medic'
  ) {
    const preferred =
      target &&
      target.seat === caster.seat &&
      friends.some((f) => f.id === target.id)
        ? target
        : friends.find(
            (u) =>
              u.toughnessCurrent != null &&
              u.toughness != null &&
              u.toughnessCurrent < u.toughness,
          )
    const ally = preferred
    if (!ally || ally.toughnessCurrent == null || ally.toughness == null) {
      return {
        ok: false,
        error:
          caster.kind === 'unit'
            ? 'Choose an injured friendly model in Range.'
            : caster.kind === 'officer'
              ? 'Choose an injured Combat Unit of this company.'
              : 'Choose an injured friendly ally.',
      }
    }
    const heal =
      effectName === 'Rebuild Protocol' ? 3 : 2
    const nextTough = Math.min(ally.toughness, ally.toughnessCurrent + heal)
    return {
      ok: true,
      state: {
        ...state,
        units: state.units.map((u) =>
          u.id === ally.id ? { ...u, toughnessCurrent: nextTough } : u,
        ),
      },
      note: `${effectName === 'Repair' || effectName === 'Rebuild Protocol' ? 'Repaired' : 'Healed'} ${ally.cardName} to ${nextTough}/${ally.toughness}.`,
    }
  }

  if (effectName === 'Tribal Convergence') {
    const hit = friends.filter((u) => isBeastfolkUnit(state, u))
    return {
      ok: true,
      state: {
        ...state,
        units: state.units.map((u) => {
          const f = hit.find((h) => h.id === u.id)
          return f
            ? { ...u, tempDamage: (u.tempDamage || 0) + 1 }
            : u
        }),
      },
      note: `Tribal Convergence: ${hit.length} Beastfolk ally/allies gain +1 Damage, Pack, and a free attack (resolve attacks manually).`,
    }
  }

  if (effectName === 'Prime Protocol') {
    const hit = friends.filter((u) => isConstructUnit(state, u))
    return {
      ok: true,
      state: {
        ...state,
        units: state.units.map((u) => {
          const f = hit.find((h) => h.id === u.id)
          return f
            ? { ...u, tempDamage: (u.tempDamage || 0) + 2 }
            : u
        }),
      },
      note: `Prime Protocol: ${hit.length} Construct ally/allies gain +2 Damage and a free attack (resolve manually).`,
    }
  }

  if (effectName === 'Void Torment') {
    const hit = foes.filter(
      (u) => u.toughnessCurrent != null && u.kind !== 'commander',
    )
    let next = applyDamageToUnits(state, hit, 2)
    const survivorIds = new Set(
      hit
        .filter((u) => {
          const live = next.units.find((x) => x.id === u.id)
          return live && (live.toughnessCurrent ?? 0) > 0
        })
        .map((u) => u.id),
    )
    next = {
      ...next,
      units: next.units.map((u) => {
        if (!survivorIds.has(u.id)) return u
        return { ...u, ...patchFear(u), ...patchSlow() }
      }),
    }
    return {
      ok: true,
      state: next,
      note: `Void Torment: ${hit.length} enemy/enemies in CR take 2 damage; ${survivorIds.size} survivor(s) gain Fear and Slow.`,
    }
  }

  if (effectName === "Tyrant's Command") {
    const hit = friends.filter((u) => isDragonUnit(state, u))
    return {
      ok: true,
      state: {
        ...state,
        units: state.units.map((u) => {
          const f = hit.find((h) => h.id === u.id)
          return f
            ? {
                ...u,
                tempDamage: (u.tempDamage || 0) + 2,
                harden: Math.max(u.harden || 0, 1),
              }
            : u
        }),
      },
      note: `Tyrant's Command: ${hit.length} Dragon ally/allies gain +2 Damage and Harden 1.`,
    }
  }

  if (effectName === "Korrik's Stand") {
    const { units, count } = bumpFriends(
      () => true,
      (u) => ({
        harden: Math.max(u.harden || 0, 2),
        tempDamage: (u.tempDamage || 0) + 1,
        ...patchUnyielding(),
      }),
    )
    return {
      ok: true,
      state: { ...state, units },
      note: `Korrik's Stand: Harden 2, +1 Damage, and Unyielding on ${count} ally/allies in CR.`,
    }
  }

  if (effectName === 'Rootweave Surge') {
    const hit = friends.filter((u) => isNatureUnit(state, u))
    return {
      ok: true,
      state: {
        ...state,
        units: state.units.map((u) => {
          const f = hit.find((h) => h.id === u.id)
          if (!f || f.toughness == null || f.toughnessCurrent == null) return u
          return {
            ...u,
            toughnessCurrent: Math.min(f.toughness, f.toughnessCurrent + 2),
            tempMove: (u.tempMove || 0) + 1,
          }
        }),
      },
      note: `Rootweave Surge: ${hit.length} Nature ally/allies restore 2 Toughness, +1 Move, and may Reposition (resolve manually).`,
    }
  }

  if (effectName === 'Realmward Unity') {
    const { units, count } = bumpFriends(
      () => true,
      (u) => ({
        tempMove: (u.tempMove || 0) + 1,
        harden: Math.max(u.harden || 0, 1),
      }),
    )
    return {
      ok: true,
      state: { ...state, units },
      note: `Realmward Unity: ${count} ally/allies gain +1 Move, Harden 1, and +1 Damage vs objectives (objective bonus resolve manually).`,
    }
  }

  if (effectName === 'Iron Covenant Charge') {
    const hit = friends.filter((u) => isInfantryUnit(state, u))
    return {
      ok: true,
      state: {
        ...state,
        units: state.units.map((u) => {
          const f = hit.find((h) => h.id === u.id)
          return f
            ? { ...u, tempDamage: (u.tempDamage || 0) + 2 }
            : u
        }),
      },
      note: `Iron Covenant Charge: ${hit.length} Infantry ally/allies gain Charge, +2 Damage, move 1 toward nearest enemy, and a free attack (resolve movement/attacks manually).`,
    }
  }

  if (effectName === 'Fenbrood Drum') {
    const hit = friends.filter((u) => isLizardmanUnit(state, u))
    return {
      ok: true,
      state: {
        ...state,
        units: state.units.map((u) => {
          const f = hit.find((h) => h.id === u.id)
          return f ? { ...u, tempMove: (u.tempMove || 0) + 1 } : u
        }),
      },
      note: `Fenbrood Drum: ${hit.length} Lizardman ally/allies gain +1 Move, Regen 1, and a free attack (Regen/attack resolve manually).`,
    }
  }

  if (effectName === 'Still Host Rise') {
    const hit = friends.filter((u) => isUndeadUnit(state, u))
    return {
      ok: true,
      state: {
        ...state,
        units: state.units.map((u) => {
          const f = hit.find((h) => h.id === u.id)
          return f
            ? {
                ...u,
                tempDamage: (u.tempDamage || 0) + 1,
                ...patchTempFearless(),
              }
            : u
        }),
      },
      note: `Still Host Rise: ${hit.length} Undead ally/allies gain Fearless, +1 Damage, and a free attack (resolve manually).`,
    }
  }

  if (effectName === 'Crypt Discipline') {
    const hit = friends.filter(
      (u) =>
        isUndeadUnit(state, u) &&
        (catalogCard(state, u.cardId)?.uv ?? 0) >= 14,
    )
    return {
      ok: true,
      state: patchUnitsById(
        state,
        new Set(hit.map((u) => u.id)),
        patchTempFearless(),
      ),
      note: `Crypt Discipline: ${hit.length} high-UV Undead ally/allies gain Fearless this round.`,
    }
  }

  if (effectName === 'Directive Tempo') {
    const hit = friends.filter((u) => isConstructUnit(state, u))
    return {
      ok: true,
      state: {
        ...state,
        units: state.units.map((u) => {
          const f = hit.find((h) => h.id === u.id)
          return f ? { ...u, tempMove: (u.tempMove || 0) + 1 } : u
        }),
      },
      note: `Directive Tempo: ${hit.length} Construct ally/allies gain +1 Move this activation.`,
    }
  }

  if (effectName === 'Summit Currents') {
    const hit = friends.filter((u) => hasUnitKeyword(state, u, 'Amphibious'))
    return {
      ok: true,
      state: {
        ...state,
        units: state.units.map((u) => {
          const f = hit.find((h) => h.id === u.id)
          return f ? { ...u, tempMove: (u.tempMove || 0) + 1 } : u
        }),
      },
      note: `Summit Currents: ${hit.length} Amphibious ally/allies gain +1 Move this activation.`,
    }
  }

  if (
    effectName === 'Arc Discharge' ||
    effectName === 'Hellspark' ||
    effectName === "Marshal's Shot"
  ) {
    const range = effectName === 'Arc Discharge' || effectName === "Marshal's Shot" ? 6 : foeRad
    const foe =
      target && hexDistOddR(caster, target) <= range
        ? target
        : foesInRange(state, caster, range).sort(
            (a, b) => (a.toughnessCurrent ?? 0) - (b.toughnessCurrent ?? 0),
          )[0]
    if (!foe) {
      return { ok: true, state, note: `${effectName}: no enemy in range.` }
    }
    let next = applyDamageToUnits(state, [foe], 2)
    const survivor = next.units.find((u) => u.id === foe.id)
    if (
      effectName === 'Hellspark' &&
      survivor &&
      (survivor.toughnessCurrent ?? 0) > 0 &&
      canGainFear(survivor)
    ) {
      next = patchUnitsById(next, new Set([foe.id]), patchFear(survivor))
    }
    return {
      ok: true,
      state: next,
      note: `${foe.cardName} takes 2 damage${effectName === 'Hellspark' && survivor && (survivor.toughnessCurrent ?? 0) > 0 ? ' and gains Fear' : ''}.`,
    }
  }

  if (effectName === 'Wyrm Lash' || effectName === 'Anvil Strike') {
    const foe =
      target && hexDistOddR(caster, target) <= (effectName === 'Wyrm Lash' ? 4 : foeRad)
        ? target
        : foesInRange(state, caster, effectName === 'Wyrm Lash' ? 4 : foeRad).sort(
            (a, b) => (a.toughnessCurrent ?? 0) - (b.toughnessCurrent ?? 0),
          )[0]
    if (!foe) {
      return { ok: true, state, note: `${effectName}: no enemy in range.` }
    }
    const next = applyDamageToUnits(state, [foe], 2)
    return {
      ok: true,
      state: next,
      note: `${foe.cardName} takes 2 damage.`,
    }
  }

  if (effectName === 'Alpha Rush') {
    const foe =
      target && hexDistOddR(caster, target) <= 3
        ? target
        : foesInRange(state, caster, 3).sort(
            (a, b) => (a.toughnessCurrent ?? 0) - (b.toughnessCurrent ?? 0),
          )[0]
    if (!foe) {
      return { ok: true, state, note: 'Alpha Rush: no enemy in range.' }
    }
    let next = applyDamageToUnits(state, [foe], 2)
    const survivor = next.units.find((u) => u.id === foe.id)
    const beastAdjacent = friends.some(
      (u) =>
        (hasUnitKeyword(state, u, 'beast') || isBeastfolkUnit(state, u)) &&
        hexDistOddR(u, foe) === 1,
    )
    if (
      survivor &&
      (survivor.toughnessCurrent ?? 0) > 0 &&
      beastAdjacent &&
      canGainFear(survivor)
    ) {
      next = patchUnitsById(next, new Set([foe.id]), patchFear(survivor))
    }
    return {
      ok: true,
      state: next,
      note: `${foe.cardName} takes 2 damage${beastAdjacent && survivor && (survivor.toughnessCurrent ?? 0) > 0 ? ' and gains Fear' : ''}.`,
    }
  }

  if (effectName === 'Spear Thrust') {
    const foe =
      target && hexDistOddR(caster, target) <= 3
        ? target
        : foesInRange(state, caster, 3).sort(
            (a, b) => (a.toughnessCurrent ?? 0) - (b.toughnessCurrent ?? 0),
          )[0]
    if (!foe) {
      return { ok: true, state, note: 'Spear Thrust: no enemy in range.' }
    }
    let next = applyDamageToUnits(state, [foe], 2)
    return {
      ok: true,
      state: next,
      note: `${foe.cardName} takes 2 damage.`,
    }
  }

  if (effectName === 'Siege Barrage') {
    const victims = foesInRange(state, caster, foeRad)
      .sort((a, b) => (a.toughnessCurrent ?? 0) - (b.toughnessCurrent ?? 0))
      .slice(0, 2)
    if (!victims.length) {
      return { ok: true, state, note: 'Siege Barrage: no enemies in range.' }
    }
    const next = applyDamageToUnits(state, victims, 1)
    return {
      ok: true,
      state: next,
      note: `Siege Barrage: ${victims.length} enemy/enemies take 1 damage.`,
    }
  }

  if (
    effectName === 'Basilisk Glare' ||
    effectName === 'Grave Bind'
  ) {
    const foe =
      target && hexDistOddR(caster, target) <= 3
        ? target
        : foesInRange(state, caster, 3).sort(
            (a, b) => (a.toughnessCurrent ?? 0) - (b.toughnessCurrent ?? 0),
          )[0]
    if (!foe) {
      return { ok: true, state, note: `${effectName}: no enemy in range.` }
    }
    return {
      ok: true,
      state: patchUnitsById(state, new Set([foe.id]), patchRoot()),
      note: `${foe.cardName} is Rooted until round refresh.`,
    }
  }

  if (effectName === 'Moonbind') {
    const foe =
      target && hexDistOddR(caster, target) <= 4
        ? target
        : foesInRange(state, caster, 4).sort(
            (a, b) => (a.toughnessCurrent ?? 0) - (b.toughnessCurrent ?? 0),
          )[0]
    if (!foe) {
      return { ok: true, state, note: 'Moonbind: no enemy in range.' }
    }
    return {
      ok: true,
      state: patchUnitsById(state, new Set([foe.id]), {
        ...patchSlow(),
        tempDamage: (foe.tempDamage || 0) - 1,
      }),
      note: `${foe.cardName} gains Slow and −1 Damage until round refresh.`,
    }
  }

  if (effectName === 'Forge Mend') {
    const candidates = friends
      .filter(
        (u) =>
          u.toughness != null &&
          u.toughnessCurrent != null &&
          u.toughnessCurrent < u.toughness &&
          (unitRace(state, u) === 'dwarf' || hasUnitKeyword(state, u, 'siege')),
      )
      .sort(
        (a, b) =>
          (a.toughnessCurrent ?? 0) / (a.toughness || 1) -
          (b.toughnessCurrent ?? 0) / (b.toughness || 1),
      )
    const ally = candidates[0]
    if (!ally || ally.toughness == null || ally.toughnessCurrent == null) {
      return { ok: true, state, note: 'Forge Mend: no injured Siege or Dwarf ally.' }
    }
    const nextTough = Math.min(ally.toughness, ally.toughnessCurrent + 2)
    return {
      ok: true,
      state: {
        ...state,
        units: state.units.map((u) =>
          u.id === ally.id ? { ...u, toughnessCurrent: nextTough } : u,
        ),
      },
      note: `Forge Mend: ${ally.cardName} restored to ${nextTough}/${ally.toughness}.`,
    }
  }

  if (effectName === 'Kindred Roar') {
    const hit = friends.filter((u) => isDragonUnit(state, u))
    return {
      ok: true,
      state: {
        ...state,
        units: state.units.map((u) => {
          const f = hit.find((h) => h.id === u.id)
          return f
            ? { ...u, tempDamage: (u.tempDamage || 0) + 1, harden: Math.max(u.harden || 0, 1) }
            : u
        }),
      },
      note: `Kindred Roar: ${hit.length} Dragon ally/allies gain +1 Damage and Harden 1.`,
    }
  }

  if (effectName === 'Pack Reform') {
    const packCount = (u: UnitToken) =>
      friends.filter(
        (m) =>
          m.id !== u.id &&
          hasUnitAbility(m, 'Pack') &&
          hexDistOddR(u, m) === 1,
      ).length
    const movers = friends
      .filter((u) => hasUnitAbility(u, 'Pack') && !u.rooted)
      .sort((a, b) => packCount(a) - packCount(b) || (a.toughnessCurrent ?? 0) - (b.toughnessCurrent ?? 0))
      .slice(0, 2)
    let next = state
    let moved = 0
    for (const u of movers) {
      if (packCount(u) >= 1) continue
      const buddy = friends
        .filter((m) => m.id !== u.id && hasUnitAbility(m, 'Pack'))
        .sort((a, b) => hexDistOddR(u, a) - hexDistOddR(u, b))[0]
      if (!buddy) continue
      const occ = occupiedKeys(next)
      occ.delete(`${u.col},${u.row}`)
      const reach = reachableMoveHexes({
        origin: { col: u.col, row: u.row },
        budget: 1,
        boardSize: next.boardSize,
        terrain: next.terrain ?? {},
        occupied: occ,
        friendlyOccupied: friendlyOccupiedKeys(next, caster.seat, u.id),
        traveler: { ...travelerFromUnit(u), ignoreTerrainCosts: true },
        maxSteps: 1,
      })
      let best: OddR | null = null
      let bestDist = hexDistOddR(u, buddy)
      for (const cell of reach.values()) {
        if (cell.spent <= 0) continue
        const d = hexDistOddR(cell, buddy)
        if (d < bestDist) {
          bestDist = d
          best = { col: cell.col, row: cell.row }
        }
      }
      if (!best) continue
      next = {
        ...next,
        units: next.units.map((x) =>
          x.id === u.id ? { ...x, col: best!.col, row: best!.row } : x,
        ),
      }
      moved += 1
    }
    return {
      ok: true,
      state: next,
      note:
        moved > 0
          ? `Pack Reform: repositioned ${moved} Pack unit(s) toward Pack adjacency.`
          : 'Pack Reform: Pack units already adjacent or no legal reposition.',
    }
  }

  if (effectName === 'Repair Rites') {
    const candidates = friends
      .filter(
        (u) =>
          u.toughness != null &&
          u.toughnessCurrent != null &&
          u.toughnessCurrent < u.toughness &&
          (isConstructUnit(state, u) || hasUnitKeyword(state, u, 'siege')),
      )
      .sort(
        (a, b) =>
          (a.toughnessCurrent ?? 0) / (a.toughness || 1) -
          (b.toughnessCurrent ?? 0) / (b.toughness || 1),
      )
    const ally = candidates[0]
    if (!ally || ally.toughness == null || ally.toughnessCurrent == null) {
      return { ok: true, state, note: 'Repair Rites: no injured Construct or Siege ally.' }
    }
    const nextTough = Math.min(ally.toughness, ally.toughnessCurrent + 3)
    return {
      ok: true,
      state: {
        ...state,
        units: state.units.map((u) =>
          u.id === ally.id ? { ...u, toughnessCurrent: nextTough } : u,
        ),
      },
      note: `Repair Rites: ${ally.cardName} restored to ${nextTough}/${ally.toughness}.`,
    }
  }

  if (effectName === 'Focused Assault') {
    const foe =
      target && target.seat !== caster.seat
        ? target
        : foes.sort((a, b) => (a.toughnessCurrent ?? 0) - (b.toughnessCurrent ?? 0))[0]
    if (!foe) {
      return { ok: true, state, note: 'Focused Assault: no enemy in range.' }
    }
    return {
      ok: true,
      state: patchUnitsById(state, new Set([foe.id]), { assaultMarked: true }),
      note: `${foe.cardName} is marked for Focused Assault (+1 Damage vs it).`,
    }
  }

  if (effectName === 'Null Pulse') {
    const foe =
      target && target.seat !== caster.seat
        ? target
        : foes.sort((a, b) => (a.toughnessCurrent ?? 0) - (b.toughnessCurrent ?? 0))[0]
    if (!foe) {
      return { ok: true, state, note: 'Null Pulse: no enemy in range.' }
    }
    return {
      ok: true,
      state: patchUnitsById(state, new Set([foe.id]), { nullPulsed: true }),
      note: `${foe.cardName} cannot cast actives until round refresh.`,
    }
  }

  if (effectName === 'Counterattack') {
    const ally = resolveFriendlyTarget(friends, target, caster.seat)
    if (!ally) {
      return {
        ok: false,
        error:
          caster.kind === 'officer'
            ? 'Choose a Combat Unit of this company.'
            : 'Choose a friendly ally.',
      }
    }
    return {
      ok: true,
      state: patchUnitsById(state, new Set([ally.id]), { counterattack: true }),
      note: `${ally.cardName} may Counterattack when struck.`,
    }
  }

  if (effectName === 'Poison Tide') {
    const cmd =
      caster.kind === 'commander'
        ? caster
        : state.units.find((u) => u.seat === caster.seat && u.kind === 'commander')
    const rad = cmd?.commandRadius ?? foeRad
    const victims = state.units
      .filter(
        (u) =>
          u.seat !== caster.seat &&
          cmd &&
          hexDistOddR(cmd, u) <= rad,
      )
      .sort((a, b) => (a.toughnessCurrent ?? 0) - (b.toughnessCurrent ?? 0))
      .slice(0, 3)
    if (!victims.length) {
      return { ok: true, state, note: 'Poison Tide: no enemies in Command Radius.' }
    }
    return {
      ok: true,
      state: {
        ...state,
        units: state.units.map((u) => {
          const v = victims.find((x) => x.id === u.id)
          return v ? { ...u, poisonTokens: Math.min(1, (u.poisonTokens ?? 0) + 1) } : u
        }),
      },
      note: `Poison Tide: ${victims.length} enemy/enemies gain Poison.`,
    }
  }

  if (effectName === 'Regenerative Surge') {
    const injured = friends
      .filter(
        (u) =>
          u.toughness != null &&
          u.toughnessCurrent != null &&
          u.toughnessCurrent < u.toughness,
      )
      .sort(
        (a, b) =>
          (a.toughnessCurrent ?? 0) / (a.toughness || 1) -
          (b.toughnessCurrent ?? 0) / (b.toughness || 1),
      )
      .slice(0, 3)
    if (!injured.length) {
      return { ok: true, state, note: 'Regenerative Surge: no injured allies.' }
    }
    let left = 3
    const healedIds = new Set<string>()
    const units = state.units.map((u) => {
      const inj = injured.find((x) => x.id === u.id)
      if (!inj || left <= 0 || inj.toughness == null || inj.toughnessCurrent == null) {
        return u
      }
      const gain = Math.min(left, inj.toughness - inj.toughnessCurrent, 1)
      if (gain <= 0) return u
      left -= gain
      healedIds.add(u.id)
      return { ...u, toughnessCurrent: inj.toughnessCurrent + gain }
    })
    while (left > 0) {
      let gave = false
      for (const id of healedIds) {
        if (left <= 0) break
        const idx = units.findIndex((u) => u.id === id)
        if (idx < 0) continue
        const u = units[idx]
        if (u.toughness == null || u.toughnessCurrent == null) continue
        if (u.toughnessCurrent >= u.toughness) continue
        units[idx] = { ...u, toughnessCurrent: u.toughnessCurrent + 1 }
        left -= 1
        gave = true
      }
      if (!gave) break
    }
    return {
      ok: true,
      state: { ...state, units },
      note: `Regenerative Surge: restored up to 3 Toughness among ${injured.length} injured ally/allies.`,
    }
  }

  if (effectName === 'Tactical Withdrawal') {
    const cmd = state.units.find((u) => u.seat === caster.seat && u.kind === 'commander')
    const ally = resolveFriendlyTarget(friends, target, caster.seat) ?? friends.sort(
      (a, b) => (a.toughnessCurrent ?? 0) - (b.toughnessCurrent ?? 0),
    )[0]
    if (!ally || !cmd || ally.rooted) {
      return { ok: true, state, note: 'Tactical Withdrawal: no valid ally to reposition.' }
    }
    const budget = Math.max(1, (ally.move ?? 0) + (ally.tempMove || 0))
    const occ = occupiedKeys(state)
    occ.delete(`${ally.col},${ally.row}`)
    const reach = reachableMoveHexes({
      origin: { col: ally.col, row: ally.row },
      budget,
      boardSize: state.boardSize,
      terrain: state.terrain ?? {},
      occupied: occ,
      friendlyOccupied: friendlyOccupiedKeys(state, caster.seat, ally.id),
      traveler: { ...travelerFromUnit(ally), ignoreTerrainCosts: true },
    })
    let best: OddR | null = null
    let bestDist = hexDistOddR(ally, cmd)
    for (const cell of reach.values()) {
      if (cell.spent <= 0) continue
      const d = hexDistOddR(cell, cmd)
      if (d < bestDist) {
        bestDist = d
        best = { col: cell.col, row: cell.row }
      }
    }
    if (!best) {
      return { ok: true, state, note: 'Tactical Withdrawal: no retreat path toward commander.' }
    }
    return {
      ok: true,
      state: {
        ...state,
        units: state.units.map((u) =>
          u.id === ally.id ? { ...u, col: best!.col, row: best!.row } : u,
        ),
      },
      note: `Tactical Withdrawal: ${ally.cardName} repositioned toward ${cmd.cardName}.`,
    }
  }

  if (effectName === 'Spectral Strike') {
    const undead = friends
      .filter((u) => isUndeadUnit(state, u))
      .sort(
        (a, b) =>
          (b.damage ?? 0) + (b.tempDamage || 0) - ((a.damage ?? 0) + (a.tempDamage || 0)) ||
          (b.toughnessCurrent ?? 0) - (a.toughnessCurrent ?? 0),
      )
    const chosen = resolveFriendlyTarget(undead, target, caster.seat) ?? undead[0]
    if (!chosen) {
      return { ok: true, state, note: 'Spectral Strike: no Undead ally in range.' }
    }
    return {
      ok: true,
      state: patchUnitsById(state, new Set([chosen.id]), {
        tempDamage: (chosen.tempDamage || 0) + 1,
        spectralStrike: true,
      }),
      note: `${chosen.cardName} gains +1 Damage and ignores Defender on its next attack.`,
    }
  }

  // Default: spend succeeded; resolve remainder at the table from card text.
  return {
    ok: true,
    state,
    note: `Resolve “${opts.abilityName}” from card text (${effectName}).`,
  }
}

export function reduceAction(
  state: GameState,
  seat: SeatId | null,
  action: ClientAction,
  /** Optional server-side card enrichment merge */
  serverCards?: CardLookup,
  /** Optional ability defs keyed by name */
  serverAbilities?: Record<string, AbilityDef>,
): ReduceResult {
  if (action.type === 'ping') return { ok: true, state }

  if (action.type === 'submitArmy') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (state.phase !== 'ArmyBuild' && state.phase !== 'Lobby') {
      return { ok: false, error: 'Cannot change army now.' }
    }
    const player = state.players.find((p) => p.seat === seat)
    if (!player) return { ok: false, error: 'Unknown player.' }
    if (player.armyReady) return { ok: false, error: 'Army already locked.' }

    const lookup = lookupFromSnapshots(action.cards)
    if (serverCards) {
      for (const [id, c] of serverCards) lookup.set(id, c)
    }
    const resolved = resolveArmy(action.army, lookup, {
      enforceCommanderRace: state.enforceCommanderRace !== false,
    })
    if (!resolved.ok) return { ok: false, error: resolved.error }
    const uvCheck = validateArmyUv(resolved.army, ARMY_UV_MAX)
    if (!uvCheck.ok) return { ok: false, error: uvCheck.error }

    roomArmies(state.roomCode).set(seat, resolved.army)
    const summary = armySummary(resolved.army)
    const cardCatalog = { ...state.cardCatalog }
    for (const c of action.cards) cardCatalog[c.id] = c
    for (const [id, c] of lookup) cardCatalog[id] = c
    const abilityCatalog = { ...state.abilityCatalog, ...(serverAbilities ?? {}) }
    let next: GameState = {
      ...state,
      phase: 'ArmyBuild',
      cardCatalog,
      abilityCatalog,
      players: state.players.map((p) =>
        p.seat === seat
          ? {
              ...p,
              army: action.army,
              armyReady: true,
              armySummary: summary,
              armyUv: resolved.army.totalUv,
            }
          : p,
      ),
    }
    next = pushLog(next, `${seat} locked army: ${summary}`)
    if (allArmiesReady(next)) {
      next = pushLog(
        { ...next, phase: 'Commanders' },
        'All armies ready — confirm commanders.',
      )
    }
    return { ok: true, state: next }
  }

  if (action.type === 'readyCommander') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    const player = state.players.find((p) => p.seat === seat)
    if (!player?.armyReady) {
      return { ok: false, error: 'Lock an army before confirming commander.' }
    }
    if (state.phase !== 'Commanders' && state.phase !== 'ArmyBuild') {
      return { ok: false, error: 'Cannot ready now.' }
    }
    const army = roomArmies(state.roomCode).get(seat)
    const cr = army?.commander.commandRadius
    let next: GameState = {
      ...state,
      phase: 'Commanders',
      players: state.players.map((p) =>
        p.seat === seat ? { ...p, commanderReady: true } : p,
      ),
      commanders: {
        ...state.commanders,
        [seat]: edgeCommanderHex(seat, state.boardSize),
      },
      commanderRadii: {
        ...state.commanderRadii,
        [seat]: cr && cr > 0 ? cr : 5,
      },
    }
    next = pushLog(next, `${seat} confirmed commander on the field.`)
    if (allCommandersReady(next) && allArmiesReady(next)) {
      next = beginObjectives(next)
    }
    return { ok: true, state: next }
  }

  if (action.type === 'confirmForceSelect') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (state.phase !== 'ForceSelect') {
      return { ok: false, error: 'Not force selection phase.' }
    }
    const player = state.players.find((p) => p.seat === seat)
    if (!player?.armyReady || !player.army) {
      return { ok: false, error: 'Lock an army first.' }
    }
    if (player.forceSelectReady) {
      return { ok: false, error: 'Force selection already confirmed.' }
    }

    const army = roomArmies(state.roomCode).get(seat)
    if (!army) return { ok: false, error: 'Army not found.' }

    const loadoutCheck = validateBattleLoadout(army, action.battleLoadout)
    if (!loadoutCheck.ok) return { ok: false, error: loadoutCheck.error }

    roomLoadouts(state.roomCode).set(seat, action.battleLoadout)
    let next: GameState = {
      ...state,
      players: state.players.map((p) =>
        p.seat === seat ? { ...p, forceSelectReady: true } : p,
      ),
    }
    next = pushLog(next, `${seat} confirmed force selection.`)
    if (allForceSelectReady(next)) {
      next = beginTerrain(next)
    }
    return { ok: true, state: next }
  }

  if (action.type === 'startGame') {
    if (state.phase !== 'Lobby' && state.phase !== 'ArmyBuild') {
      return { ok: false, error: 'Already started.' }
    }
    if (state.players.length < 2) {
      return { ok: false, error: 'Need at least 2 players.' }
    }
    return {
      ok: true,
      state: pushLog(
        {
          ...state,
          phase: 'ArmyBuild',
          maxPlayers: state.players.length as 2 | 4,
          boardSize: boardSizeForPlayers(state.players.length as 2 | 4),
        },
        'Host locked player count — finish army builds.',
      ),
    }
  }

  if (action.type === 'forceStart') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    const gate = canForceStart(state, seat)
    if (!gate.ok) return gate
    if (gate.next === 'Commanders') {
      return {
        ok: true,
        state: pushLog(
          { ...state, phase: 'Commanders' },
          `Host force-started with ${state.players.length}/${state.maxPlayers} players — confirm commanders.`,
        ),
      }
    }
    if (gate.next === 'ForceSelect') {
      return {
        ok: true,
        state: pushLog(
          beginObjectives(state),
          `Host force-started with ${state.players.length}/${state.maxPlayers} players — force selection.`,
        ),
      }
    }
    return {
      ok: true,
      state: pushLog(
        beginTerrain(state),
        `Host force-started with ${state.players.length}/${state.maxPlayers} players — terrain placement.`,
      ),
    }
  }

  if (action.type === 'chooseCommandZoneMode') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (state.phase !== 'Terrain' || state.terrainStage !== 'commandZone') {
      return { ok: false, error: 'Not command-zone terrain.' }
    }
    const player = state.players.find((p) => p.seat === seat)
    if (!player || player.terrainReady) {
      return { ok: false, error: 'Terrain already finished.' }
    }
    const hand = state.terrainHands[seat] ?? []
    if (commandZoneHasProgress(hand)) {
      return { ok: false, error: 'Cannot change mode after placing terrain.' }
    }
    if (state.commandZoneModes[seat]) {
      return { ok: false, error: 'Mode already chosen.' }
    }
    const commandZoneModes = {
      ...state.commandZoneModes,
      [seat]: action.mode,
    }
    const label =
      action.mode === 'flood'
        ? 'flood-fill their CR with one terrain type'
        : `place pieces (${terrainQuotaLabel(state)})`
    return {
      ok: true,
      state: pushLog(
        { ...state, commandZoneModes },
        `${seat} chose to ${label}.`,
      ),
    }
  }

  if (action.type === 'floodCommandZone') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (state.phase !== 'Terrain' || state.terrainStage !== 'commandZone') {
      return { ok: false, error: 'Not command-zone terrain.' }
    }
    const player = state.players.find((p) => p.seat === seat)
    if (!player || player.terrainReady) {
      return { ok: false, error: 'Terrain already finished.' }
    }
    if (commandZoneMode(state, seat) !== 'flood') {
      return { ok: false, error: 'Choose flood mode first.' }
    }
    const hand = state.terrainHands[seat] ?? []
    if (hand.some((q) => q.flooded)) {
      return { ok: false, error: 'CR already flood-filled.' }
    }
    const commander = state.commanders[seat]
    if (!commander) return { ok: false, error: 'Commander not placed.' }
    const ownCr = ownCommandRadiusKeys(state, seat)
    const kind = action.kind
    if (!FLOOD_TERRAIN_KINDS.includes(kind)) {
      return { ok: false, error: 'That terrain type cannot flood a CR.' }
    }
    const commanderKey = hexKey(commander.col, commander.row)
    const terrain = { ...state.terrain }
    for (const key of ownCr) {
      if (key === commanderKey && !terrainMayCoverCommander(kind)) {
        continue
      }
      const [colStr, rowStr] = key.split(',')
      const col = Number(colStr)
      const row = Number(rowStr)
      if (objectiveHexKeySet(state.objectives).has(key)) continue
      const existing = terrain[key]
      if (existing && existing !== kind) {
        return {
          ok: false,
          error: 'Cannot flood over different terrain already in your CR.',
        }
      }
      terrain[key] = kind
    }
    const waterWallCheck = validateWaterWallTerrain(
      state,
      terrain,
      commander,
      ownCr,
      kind,
    )
    if (!waterWallCheck.ok) return waterWallCheck

    const floodItem: TerrainQueueItem = {
      instanceId: `${seat}-flood-${kind}`,
      pieceId: `__flood__-${kind}`,
      name: `${kind} flood`,
      kind,
      sizeClass: 'small',
      shape: [],
      placed: true,
      flooded: true,
    }
    let next: GameState = {
      ...state,
      terrain,
      terrainHands: { ...state.terrainHands, [seat]: [floodItem] },
    }
    next = pushLog(next, `${seat} flood-filled their CR with ${kind}.`)
    next = finishCommandZoneIfReady(next, seat)
    return { ok: true, state: next }
  }

  if (action.type === 'pickTerrain') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (state.phase !== 'Terrain' || state.terrainStage !== 'commandZone') {
      return { ok: false, error: 'Not command-zone terrain.' }
    }
    const player = state.players.find((p) => p.seat === seat)
    if (!player || player.terrainReady) {
      return { ok: false, error: 'Terrain already finished.' }
    }
    if (commandZoneMode(state, seat) !== 'pieces') {
      return { ok: false, error: 'Choose piece placement mode first.' }
    }
    const hand = [...(state.terrainHands[seat] ?? [])]
    const quota = commandZoneQuota(state)
    const def = terrainPieceById(action.pieceId)
    if (!def) return { ok: false, error: 'Unknown terrain piece.' }
    if (
      !commandZonePieceCatalog(state.maxPlayers).some((p) => p.id === def.id)
    ) {
      return { ok: false, error: 'That piece is not available in your CR quota.' }
    }
    if (commandZoneSizeUsed(hand, def.sizeClass) >= quota[def.sizeClass]) {
      return {
        ok: false,
        error: `No ${def.sizeClass} piece slots left (${quota[def.sizeClass]} max).`,
      }
    }
    if (def.kind === 'water' && def.sizeClass !== 'small') {
      return { ok: false, error: 'Water is only available as small pieces.' }
    }

    const unplacedIndex = hand.findIndex((q) => !q.placed && !q.skipped)
    let nextHand: typeof hand
    let logMsg: string
    if (unplacedIndex >= 0) {
      const prev = hand[unplacedIndex]!
      const item = makeTerrainHandItem(def, seat, unplacedIndex)
      nextHand = hand.map((q, i) => (i === unplacedIndex ? item : q))
      logMsg =
        prev.pieceId === def.id
          ? `${seat} kept ${def.name}.`
          : `${seat} swapped ${prev.name} for ${def.name}.`
    } else {
      const item = makeTerrainHandItem(def, seat, hand.length)
      nextHand = [...hand, item]
      logMsg = `${seat} chose ${def.name} (${def.sizeClass}).`
    }
    return {
      ok: true,
      state: pushLog(
        { ...state, terrainHands: { ...state.terrainHands, [seat]: nextHand } },
        logMsg,
      ),
    }
  }

  if (action.type === 'unpickTerrain') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (state.phase !== 'Terrain' || state.terrainStage !== 'commandZone') {
      return { ok: false, error: 'Not command-zone terrain.' }
    }
    const player = state.players.find((p) => p.seat === seat)
    if (!player || player.terrainReady) {
      return { ok: false, error: 'Terrain already finished.' }
    }
    if (commandZoneMode(state, seat) !== 'pieces') {
      return { ok: false, error: 'Not in piece placement mode.' }
    }
    const hand = [...(state.terrainHands[seat] ?? [])]
    const item = hand[action.handIndex]
    if (!item) return { ok: false, error: 'Invalid hand slot.' }
    if (item.placed || item.skipped || item.flooded) {
      return { ok: false, error: 'That pick slot is already resolved.' }
    }
    hand.splice(action.handIndex, 1)
    return {
      ok: true,
      state: pushLog(
        { ...state, terrainHands: { ...state.terrainHands, [seat]: hand } },
        `${seat} put ${item.name} back (not locked — pick another).`,
      ),
    }
  }

  if (action.type === 'placeTerrain') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (state.phase !== 'Terrain') {
      return { ok: false, error: 'Not terrain phase.' }
    }

    // —— Command zone (personal CR pieces) ——
    if (state.terrainStage === 'commandZone') {
      const player = state.players.find((p) => p.seat === seat)
      if (!player || player.terrainReady) {
        return { ok: false, error: 'Terrain already finished.' }
      }
      if (commandZoneMode(state, seat) !== 'pieces') {
        return { ok: false, error: 'Not in piece placement mode.' }
      }

      const hand = state.terrainHands[seat] ?? []
      const handIndex = action.handIndex
      if (handIndex == null) return { ok: false, error: 'Missing hand index.' }
      const item = hand[handIndex]
      if (!item || item.placed || item.skipped || item.flooded) {
        return {
          ok: false,
          error: item?.placed
            ? 'Already placed that piece.'
            : item?.skipped
              ? 'That pick was skipped.'
              : 'Pick a terrain piece before placing.',
        }
      }

      const commander = state.commanders[seat]
      if (!commander) return { ok: false, error: 'Commander not placed.' }
      const ownCr = ownCommandRadiusKeys(state, seat)
      const rotation = normalizeRotation(action.rotation)
      const cells = expandTerrainPiece(
        { col: action.col, row: action.row },
        item.shape,
        rotation,
      )
      const commanderKey = hexKey(commander.col, commander.row)
      const coversCommander = cells.some(
        (cell) => hexKey(cell.col, cell.row) === commanderKey,
      )
      if (coversCommander && !terrainMayCoverCommander(item.kind)) {
        return {
          ok: false,
          error:
            'Only soft land may cover your commander hex (not Water/Wall).',
        }
      }
      const isSmallBridge =
        item.sizeClass === 'small' &&
        item.kind !== 'water' &&
        item.kind !== 'wall'
      const check = validateTerrainPlacement(cells, {
        boardSize: state.boardSize,
        terrain: state.terrain,
        objectives: flattenObjectiveHexes(state.objectives),
        kind: item.kind,
        requiredKeys: ownCr,
        allowOverwriteWater: isSmallBridge,
      })
      if (!check.ok) return check

      const terrain = { ...state.terrain }
      for (const cell of cells) {
        terrain[hexKey(cell.col, cell.row)] = item.kind
      }
      const waterWallCheck = validateWaterWallTerrain(
        state,
        terrain,
        commander,
        ownCr,
        item.kind,
      )
      if (!waterWallCheck.ok) return waterWallCheck

      const nextHand = hand.map((q, i) =>
        i === handIndex ? { ...q, placed: true } : q,
      )
      let next: GameState = {
        ...state,
        terrain,
        terrainHands: { ...state.terrainHands, [seat]: nextHand },
      }
      next = pushLog(
        next,
        `${seat} placed ${item.name} (rot ${rotation}) at (${action.col},${action.row}).`,
      )
      if (commandZonePiecesComplete(nextHand, commandZoneQuota(state))) {
        next = finishCommandZoneIfReady(next, seat)
      }
      return { ok: true, state: next }
    }

    // —— Battlefield land drops (middle of board) ——
    if (!isLandTerrainStage(state.terrainStage)) {
      return { ok: false, error: 'Not a land placement stage.' }
    }
    if (state.activeSeat !== seat) {
      return {
        ok: false,
        error: state.activeSeat
          ? `Wait — ${state.activeSeat} places this piece.`
          : 'Not your turn to place terrain.',
      }
    }
    if ((state.landDropsUsed[seat] ?? 0) >= TERRAIN_LAND_DROPS_PER_SIZE) {
      return { ok: false, error: 'No land drops left this tier.' }
    }
    if (!action.pieceId) {
      return { ok: false, error: 'Choose a land piece first.' }
    }
    const size = landSizeForStage(state.terrainStage)
    const def = landPiecesForSize(size).find((p) => p.id === action.pieceId)
    if (!def) {
      return {
        ok: false,
        error: `That piece is not a ${size} land option.`,
      }
    }

    const rotation = normalizeRotation(action.rotation)
    const cells = expandTerrainPiece(
      { col: action.col, row: action.row },
      def.shape,
      rotation,
    )
    const isSmallBridge =
      def.sizeClass === 'small' &&
      def.kind !== 'water' &&
      def.kind !== 'wall'
    const check = validateTerrainPlacement(cells, {
      boardSize: state.boardSize,
      terrain: state.terrain,
      objectives: flattenObjectiveHexes(state.objectives),
      kind: def.kind,
      blockedKeys: foreignCommandRadiusKeys(state, seat),
      allowOverwriteWater: isSmallBridge,
    })
    if (!check.ok) return check

    if (def.kind === 'water' || def.kind === 'wall') {
      const tentative = { ...state.terrain }
      for (const cell of cells) {
        tentative[hexKey(cell.col, cell.row)] = def.kind
      }
      const connectivity = validateImpassableTerrainConnectivity(state, tentative)
      if (!connectivity.ok) return connectivity
    }

    const terrain = { ...state.terrain }
    for (const cell of cells) {
      terrain[hexKey(cell.col, cell.row)] = def.kind
    }
    let next: GameState = { ...state, terrain }
    next = pushLog(
      next,
      `${seat} placed ${size} ${def.name} (rot ${rotation}) at (${action.col},${action.row}).`,
    )
    next = advanceAfterLandDrop(next, seat)
    return { ok: true, state: next }
  }

  if (action.type === 'skipTerrain') {
    if (!seat) return { ok: false, error: 'Not seated.' }

    if (
      state.phase === 'Terrain' &&
      isLandTerrainStage(state.terrainStage)
    ) {
      if (state.activeSeat !== seat) {
        return {
          ok: false,
          error: state.activeSeat
            ? `Wait — ${state.activeSeat}'s turn.`
            : 'Not your turn.',
        }
      }
      if ((state.landDropsUsed[seat] ?? 0) >= TERRAIN_LAND_DROPS_PER_SIZE) {
        return { ok: false, error: 'No land drops left this tier.' }
      }
      const size = landSizeForStage(state.terrainStage)
      let next = pushLog(state, `${seat} skipped a ${size} land drop.`)
      next = advanceAfterLandDrop(next, seat)
      return { ok: true, state: next }
    }

    if (state.phase !== 'Terrain' || state.terrainStage !== 'commandZone') {
      return { ok: false, error: 'Not command-zone terrain.' }
    }
    const player = state.players.find((p) => p.seat === seat)
    if (!player || player.terrainReady) {
      return { ok: false, error: 'Terrain already finished.' }
    }
    if (commandZoneMode(state, seat) !== 'pieces') {
      return { ok: false, error: 'Not in piece placement mode.' }
    }
    const hand = [...(state.terrainHands[seat] ?? [])]
    const heldIndex = hand.findIndex((q) => !q.placed && !q.skipped && !q.flooded)
    if (heldIndex < 0) {
      return { ok: false, error: 'Pick a piece first, then skip it.' }
    }
    const held = hand[heldIndex]!
    const nextHand = hand.map((q, i) =>
      i === heldIndex
        ? makeSkippedCommandZoneSlot(seat, i, held.sizeClass)
        : q,
    )
    let next: GameState = {
      ...state,
      terrainHands: { ...state.terrainHands, [seat]: nextHand },
    }
    next = pushLog(next, `${seat} skipped ${held.sizeClass} piece (${held.name}).`)
    if (commandZonePiecesComplete(nextHand, commandZoneQuota(state))) {
      next = finishCommandZoneIfReady(next, seat)
    }
    return { ok: true, state: next }
  }

  if (action.type === 'confirmTerrain') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (state.phase !== 'Terrain') return { ok: false, error: 'Not terrain phase.' }
    if (state.terrainStage !== 'commandZone') {
      return {
        ok: false,
        error: 'Land drops place or skip on your turn — no confirm needed.',
      }
    }
    if (!commandZoneComplete(state, seat)) {
      return { ok: false, error: 'Finish your CR terrain first.' }
    }
    const hand = state.terrainHands[seat] ?? []
    if (hand.some((q) => !q.placed && !q.skipped && !q.flooded)) {
      return { ok: false, error: 'Place or skip your held piece first.' }
    }
    let next: GameState = {
      ...state,
      players: state.players.map((p) =>
        p.seat === seat ? { ...p, terrainReady: true } : p,
      ),
    }
    next = pushLog(next, `${seat} confirmed command-zone terrain.`)
    if (next.players.every((p) => p.terrainReady)) {
      next = beginLandStage(next, 'landLarge')
    }
    return { ok: true, state: next }
  }

  if (action.type === 'deploy') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (state.phase !== 'Deploy') return { ok: false, error: 'Not deploy phase.' }
    const player = state.players.find((p) => p.seat === seat)
    if (!player || player.deployDone) return { ok: false, error: 'Deploy finished.' }

    const queue = state.deployQueues[seat]
    if (!queue) return { ok: false, error: 'No deploy queue.' }
    const item = queue[action.queueIndex]
    if (!item || item.placed) return { ok: false, error: 'Invalid deploy item.' }

    const cell = { col: action.col, row: action.row }
    if (!inBounds(cell, state.boardSize)) return { ok: false, error: 'Out of bounds.' }

    if (item.kind === 'officer') {
      const cr = ownCommandRadiusKeys(state, seat)
      if (!cr.has(hexKey(cell.col, cell.row))) {
        return {
          ok: false,
          error: 'Officers must deploy inside your Command Radius.',
        }
      }
    } else {
      // Units deploy in their officer's CR only — not the commander CR.
      const officer = findDeployedOfficer(state, seat, item.officerCardId)
      if (!officer) {
        return {
          ok: false,
          error: 'Deploy that unit’s officer before placing the unit.',
        }
      }
      const radius = officerDeployRadius(state, officer)
      const unitSnap = state.cardCatalog[item.cardId]
      const pendingUnit =
        unitSnap != null
          ? {
              id: 'pending',
              seat,
              kind: 'unit' as const,
              cardId: item.cardId,
              cardName: item.cardName,
              officerCardId: item.officerCardId,
              col: cell.col,
              row: cell.row,
              move: item.move,
              moveRemaining: 0,
              activationCol: null,
              activationRow: null,
              claimsThisActivation: [],
              movedBeyondLimit: false,
              damage: unitSnap.damage,
              range: unitSnap.range,
              toughness: unitSnap.toughness,
              toughnessCurrent: unitSnap.toughness,
              commandRadius: null,
              keywords: [...(unitSnap.keywords ?? [])],
              abilities: [...(unitSnap.abilities ?? [])],
              ultimate: unitSnap.ultimate ?? null,
              rooted: false,
              ...DEFAULT_UNIT_STATUSES,
              tempDamage: 0,
              tempMove: 0,
              harden: 0,
              abilityReadyRound: {},
              raiseOnceUsed: false,
              ultimateUsed: false,
              evadeActive: false,
              poisonTokens: 0,
              trampleLeftoverDamage: 0,
              assaultMarked: false,
              nullPulsed: false,
              counterattack: false,
              spectralStrike: false,
            }
          : null
      if (
        !unitInOfficerRadius(
          cell,
          { col: officer.col, row: officer.row },
          radius,
          pendingUnit,
        )
      ) {
        return {
          ok: false,
          error: `Units must deploy within their officer’s Command Radius (${radius}${pendingUnit && hasScoutAbility(pendingUnit) ? `, +${SCOUT_CR_EXTENSION} Scout` : ''}).`,
        }
      }
    }

    if (tooCloseToObjective(cell, state)) {
      return {
        ok: false,
        error: `Must be ≥${MIN_OBJECTIVE_DISTANCE} hexes from objective zones.`,
      }
    }
    if (occupiedKeys(state).has(`${cell.col},${cell.row}`)) {
      return { ok: false, error: 'Hex occupied.' }
    }
    if ((state.terrain ?? {})[`${cell.col},${cell.row}`] === 'wall') {
      return { ok: false, error: 'Cannot deploy on a Wall hex.' }
    }

    const snap =
      state.cardCatalog[item.cardId] ??
      ({
        id: item.cardId,
        name: item.cardName,
        cardType: item.kind === 'officer' ? 'Officer' : 'Unit',
        rarity: null,
        unique: false,
        race: null,
        uv: null,
        move: item.move,
        damage: null,
        range: null,
        toughness: null,
        companyCapacity: null,
        commandRadius: null,
        companyAp: null,
        apGeneration: null,
        ccGeneration: null,
        abilities: [],
        ultimate: null,
      } satisfies CardSnapshot)

    const unit = makeUnitToken({
      seat,
      kind: item.kind,
      card: snap,
      officerCardId: item.officerCardId,
      col: cell.col,
      row: cell.row,
    })
    // Prefer deploy-queue move if snapshot lacks it.
    if (item.move > 0) {
      unit.move = item.move
    }
    const deployQueues = {
      ...state.deployQueues,
      [seat]: queue.map((q, i) =>
        i === action.queueIndex ? { ...q, placed: true } : q,
      ),
    }
    return {
      ok: true,
      state: pushLog(
        { ...state, units: [...state.units, unit], deployQueues },
        `${seat} deployed ${item.cardName} at (${cell.col},${cell.row}).`,
      ),
    }
  }

  if (action.type === 'confirmDeploy') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (state.phase !== 'Deploy') return { ok: false, error: 'Not deploy phase.' }
    const queue = state.deployQueues[seat] ?? []
    if (queue.some((q) => !q.placed)) {
      return { ok: false, error: 'Place all army pieces first.' }
    }
    let next: GameState = {
      ...state,
      players: state.players.map((p) =>
        p.seat === seat ? { ...p, deployDone: true } : p,
      ),
    }
    next = pushLog(next, `${seat} finished deploy.`)
    if (next.players.every((p) => p.deployDone)) {
      next = beginPlay(next)
    }
    return { ok: true, state: next }
  }

  if (action.type === 'activateCompany') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (state.phase !== 'Play') return { ok: false, error: 'Not play phase.' }
    if (state.activeSeat !== seat) return { ok: false, error: 'Not your turn.' }

    const officer = state.units.find((u) => u.id === action.officerUnitId)
    if (!officer || officer.seat !== seat || officer.kind !== 'officer') {
      return { ok: false, error: 'Select one of your officers.' }
    }
    const companyCardId = officer.cardId
    let baseState = endPreviousCompanyActivation(state, seat)
    const units = baseState.units.map((u) => {
      const inCompany =
        u.id === officer.id ||
        (u.seat === seat && u.officerCardId === companyCardId)
      if (!inCompany) return u
      let nextTough = u.toughnessCurrent
      let poisonTokens = u.poisonTokens ?? 0
      if (poisonTokens > 0 && nextTough != null) {
        nextTough = Math.max(0, nextTough - 1)
        poisonTokens -= 1
      }
      return markSlowForActivation({
        ...u,
        moveRemaining: u.move,
        activationCol: u.col,
        activationRow: u.row,
        claimsThisActivation: [],
        movedBeyondLimit: false,
        tempDamage: 0,
        tempMove: 0,
        harden: 0,
        evadeActive: false,
        trampleLeftoverDamage: 0,
        poisonTokens,
        toughnessCurrent: nextTough,
      })
    })
    let next: GameState = {
      ...baseState,
      units,
      activeCompanyOfficerId: officer.id,
    }
    next = removeDestroyedUnits(next)
    next = refreshCompanyPool(next, officer)
    const pool = next.companyPools[officer.id]
    return {
      ok: true,
      state: pushLog(
        next,
        `${seat} activated ${officer.cardName}'s company (Company AP ${pool?.ap ?? 0}/${pool?.apMax ?? 0}).`,
      ),
    }
  }

  if (action.type === 'activateCommander') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (state.phase !== 'Play') return { ok: false, error: 'Not play phase.' }
    if (state.activeSeat !== seat) return { ok: false, error: 'Not your turn.' }
    if (state.commanderActivatedThisRound[seat]) {
      return { ok: false, error: 'Commander already activated this round.' }
    }

    const commander = state.units.find(
      (u) => u.seat === seat && u.kind === 'commander',
    )
    if (!commander) {
      return { ok: false, error: 'Commander not found.' }
    }

    const units = state.units.map((u) =>
      u.id === commander.id
        ? {
            ...u,
            moveRemaining: u.move,
            activationCol: u.col,
            activationRow: u.row,
            claimsThisActivation: [],
            movedBeyondLimit: false,
            tempDamage: 0,
            tempMove: 0,
            harden: 0,
          }
        : u,
    )

    return {
      ok: true,
      state: pushLog(
        {
          ...state,
          units,
          commanderActivatedThisRound: {
            ...state.commanderActivatedThisRound,
            [seat]: true,
          },
        },
        `${seat} activated ${commander.cardName} (Move ${commander.move}).`,
      ),
    }
  }

  if (action.type === 'spendPool') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (state.phase !== 'Play') return { ok: false, error: 'Not play phase.' }
    if (state.activeSeat !== seat) return { ok: false, error: 'Not your turn.' }
    const amount = Math.floor(action.amount)
    if (!Number.isFinite(amount) || amount < 1) {
      return { ok: false, error: 'Spend at least 1.' }
    }

    if (action.pool === 'commanderAp' || action.pool === 'commanderCc') {
      const pool = state.commanderPools[seat]
      if (!pool) return { ok: false, error: 'No commander pool.' }
      if (action.pool === 'commanderAp') {
        if (pool.ap < amount) return { ok: false, error: 'Not enough AP.' }
        const commanderPools = {
          ...state.commanderPools,
          [seat]: { ...pool, ap: pool.ap - amount },
        }
        return {
          ok: true,
          state: pushLog(
            { ...state, commanderPools },
            `${seat} spent ${amount} AP (${pool.ap - amount}/${pool.apMax} left).`,
          ),
        }
      }
      if (pool.cc < amount) return { ok: false, error: 'Not enough CC.' }
      const commanderPools = {
        ...state.commanderPools,
        [seat]: { ...pool, cc: pool.cc - amount },
      }
      return {
        ok: true,
        state: pushLog(
          { ...state, commanderPools },
          `${seat} spent ${amount} CC (${pool.cc - amount}/${pool.ccMax} left).`,
        ),
      }
    }

    const officerId =
      action.officerUnitId || state.activeCompanyOfficerId || null
    if (!officerId) {
      return { ok: false, error: 'Activate or select an officer for Company AP.' }
    }
    const officer = state.units.find((u) => u.id === officerId)
    if (!officer || officer.seat !== seat || officer.kind !== 'officer') {
      return { ok: false, error: 'Invalid officer for Company AP.' }
    }
    const pool = state.companyPools[officerId] ?? { ap: 0, apMax: 0 }
    if (pool.ap < amount) return { ok: false, error: 'Not enough Company AP.' }
    const companyPools = {
      ...state.companyPools,
      [officerId]: { ...pool, ap: pool.ap - amount },
    }
    return {
      ok: true,
      state: pushLog(
        { ...state, companyPools },
        `${seat} spent ${amount} Company AP from ${officer.cardName} (${pool.ap - amount}/${pool.apMax} left).`,
      ),
    }
  }

  if (action.type === 'rollDice') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (state.phase !== 'Play') return { ok: false, error: 'Not play phase.' }
    const count = Math.min(12, Math.max(1, Math.floor(action.count) || 1))
    const sides = Math.min(20, Math.max(2, Math.floor(action.sides ?? 6) || 6))
    const results: number[] = []
    for (let i = 0; i < count; i++) {
      results.push(1 + Math.floor(Math.random() * sides))
    }
    const total = results.reduce((a, b) => a + b, 0)
    const note = action.note?.trim() || null
    const lastDiceRoll = { seat, count, sides, results, total, note }
    const detail = `${count}d${sides}: [${results.join(', ')}]${
      count > 1 ? ` = ${total}` : ''
    }`
    return {
      ok: true,
      state: pushLog(
        { ...state, lastDiceRoll },
        `${seat} rolled ${detail}${note ? ` (${note})` : ''}.`,
      ),
    }
  }

  if (action.type === 'applyDamage') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (state.phase !== 'Play') return { ok: false, error: 'Not play phase.' }
    const amount = Math.floor(action.amount)
    if (!Number.isFinite(amount) || amount < 1) {
      return { ok: false, error: 'Damage must be at least 1.' }
    }
    const target = state.units.find((u) => u.id === action.unitId)
    if (!target) return { ok: false, error: 'Target not found.' }
    if (target.kind === 'commander') {
      return { ok: false, error: 'Commander toughness is not tracked yet.' }
    }
    if (target.toughnessCurrent == null) {
      return { ok: false, error: 'Target has no Toughness.' }
    }
    const nextTough = Math.max(0, target.toughnessCurrent - amount)
    let next: GameState = {
      ...state,
      units: state.units.map((u) =>
        u.id === target.id ? { ...u, toughnessCurrent: nextTough } : u,
      ),
    }
    next = pushLog(
      next,
      `${seat} applies ${amount} damage to ${target.cardName} (${target.seat}) → Toughness ${nextTough}/${target.toughness ?? '—'}.`,
    )
    next = removeDestroyedUnits(next)
    return { ok: true, state: next }
  }

  if (action.type === 'applyHeal') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (state.phase !== 'Play') return { ok: false, error: 'Not play phase.' }
    const amount = Math.floor(action.amount)
    if (!Number.isFinite(amount) || amount < 1) {
      return { ok: false, error: 'Heal must be at least 1.' }
    }
    const target = state.units.find((u) => u.id === action.unitId)
    if (!target) return { ok: false, error: 'Target not found.' }
    if (target.toughnessCurrent == null || target.toughness == null) {
      return { ok: false, error: 'Target has no Toughness.' }
    }
    const nextTough = Math.min(
      target.toughness,
      target.toughnessCurrent + amount,
    )
    return {
      ok: true,
      state: pushLog(
        {
          ...state,
          units: state.units.map((u) =>
            u.id === target.id ? { ...u, toughnessCurrent: nextTough } : u,
          ),
        },
        `${seat} heals ${target.cardName} for ${amount} → Toughness ${nextTough}/${target.toughness}.`,
      ),
    }
  }

  if (action.type === 'resolveAttack') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (state.phase !== 'Play') return { ok: false, error: 'Not play phase.' }

    const attacker = state.units.find((u) => u.id === action.attackerUnitId)
    const defender = state.units.find((u) => u.id === action.defenderUnitId)
    if (!attacker) return { ok: false, error: 'Attacker not found.' }
    if (!defender) return { ok: false, error: 'Defender not found.' }

    const strikeOverride =
      attacker.trampleLeftoverDamage > 0 ? attacker.trampleLeftoverDamage : undefined

    let result
    try {
      result = resolveCombatAttack({
        state,
        attacker,
        defender,
        strikeDamageOverride: strikeOverride,
      })
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : 'Illegal attack.',
      }
    }

    let next: GameState = {
      ...state,
      pendingTrample: null,
      units: state.units.map((u) =>
        u.id === attacker.id ? { ...u, trampleLeftoverDamage: 0 } : u,
      ),
    }
    if (result.hit) {
      next = applyAttackResultToState(next, defender.id, attacker.id, result)
      next = removeDestroyedUnits(next)
      const defAfter = next.units.find((u) => u.id === defender.id)
      const atkAfter = next.units.find((u) => u.id === attacker.id)
      if (
        defAfter &&
        atkAfter &&
        defAfter.counterattack &&
        (defAfter.toughnessCurrent ?? 0) > 0 &&
        (atkAfter.toughnessCurrent ?? 0) > 0 &&
        result.dealt > 0 &&
        !result.unyieldingBlocked
      ) {
        const backDmg = Math.max(1, effectiveDamage(defAfter))
        next = applyDamageToUnits(next, [atkAfter], backDmg)
        next = removeDestroyedUnits(next)
        next = {
          ...next,
          units: next.units.map((u) =>
            u.id === defAfter.id ? { ...u, counterattack: false } : u,
          ),
        }
      }
    }

    const bonusBits = [
      result.fearPenalty ? 'Fear +1 to hit need' : null,
      result.favoredTerrainHit ? 'favored terrain +1 Hit' : null,
      result.flanking ? 'Flanking +1 Hit' : null,
      result.evadeActive ? 'Evade +1 to hit need' : null,
      result.unyieldingBlocked ? 'Unyielding (ignored hit)' : null,
      result.fortifiedHex && !result.piercing ? 'Fortified Harden 1' : null,
      result.piercing && (result.fortifiedHex || result.mitigated > 0)
        ? 'Piercing (ignores Harden)'
        : null,
      result.mitigated > 0 && !result.piercing && !result.unyieldingBlocked
        ? `mitigation −${result.mitigated}`
        : null,
      result.poisonApplied ? 'Poison +1 token' : null,
      result.fearApplied ? 'Fear applied' : null,
      result.slowApplied ? 'Slow applied' : null,
      result.trampleStrike ? 'Trample leftover dmg' : null,
    ].filter(Boolean)

    const outcome = result.hit
      ? result.unyieldingBlocked
        ? 'HIT — Unyielding ignored damage'
        : result.dealt > 0
          ? `HIT — ${result.dealt} damage${result.killed ? ' (destroyed)' : ''}`
          : 'HIT — 0 damage (fully mitigated)'
      : 'MISS'

    const lastCombatResult = {
      seat,
      attackerId: attacker.id,
      attackerName: attacker.cardName,
      defenderId: defender.id,
      defenderName: defender.cardName,
      distance: result.distance,
      hitNeed: result.hitNeed,
      dice: result.dice,
      roll: result.roll,
      hit: result.hit,
      rawDamage: result.rawDamage,
      dealt: result.dealt,
      mitigated: result.mitigated,
      favoredTerrainHit: result.favoredTerrainHit,
      flanking: result.flanking,
      killed: result.killed,
      evadeActive: result.evadeActive,
      fearPenalty: result.fearPenalty,
      fortifiedHex: result.fortifiedHex,
      piercing: result.piercing,
      poisonApplied: result.poisonApplied,
      fearApplied: result.fearApplied,
      slowApplied: result.slowApplied,
      unyieldingBlocked: result.unyieldingBlocked,
      trampleOffer: result.trampleEligible,
      trampleLeftover: result.trampleLeftover,
    }
    const lastDiceRoll = {
      seat,
      count: 2,
      sides: 6,
      results: [...result.dice],
      total: result.roll,
      note: `${attacker.cardName} → ${defender.cardName}`,
    }

    if (result.trampleEligible) {
      next = {
        ...next,
        pendingTrample: {
          attackerId: attacker.id,
          destCol: defender.col,
          destRow: defender.row,
          leftoverDamage: result.trampleLeftover,
        },
      }
    }

    next = pushLog(
      {
        ...next,
        lastCombatResult,
        lastDiceRoll,
      },
      `${seat} resolves attack: ${attacker.cardName} → ${defender.cardName} @ ${result.distance} hex · need ${result.hitNeed}+ · rolled 2d6=[${result.dice.join('+')}]=${result.roll} · ${outcome}${bonusBits.length ? ` (${bonusBits.join(', ')})` : ''}${result.trampleEligible ? ' · Trample available' : ''}.`,
    )
    return { ok: true, state: next }
  }

  if (action.type === 'continueTrample') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (state.phase !== 'Play') return { ok: false, error: 'Not play phase.' }
    const pending = state.pendingTrample
    if (!pending) return { ok: false, error: 'No Trample continuation pending.' }

    const attacker = state.units.find((u) => u.id === pending.attackerId)
    if (!attacker || attacker.seat !== seat) {
      return { ok: false, error: 'Trample attacker not found or not yours.' }
    }
    const occ = occupiedKeys(state)
    occ.delete(`${attacker.col},${attacker.row}`)
    const destKey = `${pending.destCol},${pending.destRow}`
    if (occ.has(destKey)) {
      return { ok: false, error: 'Trample destination is occupied.' }
    }
    if (!inBounds({ col: pending.destCol, row: pending.destRow }, state.boardSize)) {
      return { ok: false, error: 'Trample destination out of bounds.' }
    }

    const units = state.units.map((u) =>
      u.id === attacker.id
        ? {
            ...u,
            col: pending.destCol,
            row: pending.destRow,
            trampleLeftoverDamage: pending.leftoverDamage,
          }
        : u,
    )
    return {
      ok: true,
      state: pushLog(
        {
          ...state,
          units,
          pendingTrample: null,
        },
        `${seat} Trample: ${attacker.cardName} moves into (${pending.destCol},${pending.destRow}) — no Move cost${pending.leftoverDamage > 0 ? ` · ${pending.leftoverDamage} leftover dmg vs next adjacent target` : ''}. Pick a new target and Resolve attack.`,
      ),
    }
  }

  if (action.type === 'declineTrample') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (!state.pendingTrample) return { ok: false, error: 'No Trample pending.' }
    return {
      ok: true,
      state: pushLog({ ...state, pendingTrample: null }, `${seat} declines Trample.`),
    }
  }

  if (action.type === 'activateEvade') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (state.phase !== 'Play') return { ok: false, error: 'Not play phase.' }

    const unit = state.units.find((u) => u.id === action.unitId)
    if (!unit || unit.seat !== seat) {
      return { ok: false, error: 'Invalid unit.' }
    }
    if (unit.evadeActive) {
      return { ok: false, error: 'Evade already active on this unit.' }
    }
    if (unit.kind === 'commander') {
      return { ok: false, error: 'Commanders cannot Evade.' }
    }

    const officer =
      unit.kind === 'officer'
        ? unit
        : state.units.find(
            (u) =>
              u.seat === seat &&
              u.kind === 'officer' &&
              u.cardId === unit.officerCardId,
          )
    if (!officer) return { ok: false, error: 'Company officer not found.' }

    const pool = state.companyPools[officer.id] ?? { ap: 0, apMax: 0 }
    if (pool.ap < 1) return { ok: false, error: 'Not enough Company AP for Evade.' }

    const companyPools = {
      ...state.companyPools,
      [officer.id]: { ...pool, ap: pool.ap - 1 },
    }
    const units = state.units.map((u) =>
      u.id === unit.id ? { ...u, evadeActive: true } : u,
    )
    return {
      ok: true,
      state: pushLog(
        { ...state, units, companyPools },
        `${seat} spends 1 Company AP — ${unit.cardName} activates Evade (+1 to hit need vs this unit until its next activation).`,
      ),
    }
  }

  if (action.type === 'toggleFortifyHex') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (state.phase !== 'Play') return { ok: false, error: 'Not play phase.' }
    const key = hexKey(action.col, action.row)
    const fortifiedHexes = { ...(state.fortifiedHexes ?? {}) }
    if (fortifiedHexes[key]) {
      delete fortifiedHexes[key]
      return {
        ok: true,
        state: pushLog(
          { ...state, fortifiedHexes },
          `${seat} removes Fortification at (${action.col},${action.row}).`,
        ),
      }
    }
    fortifiedHexes[key] = true
    return {
      ok: true,
      state: pushLog(
        { ...state, fortifiedHexes },
        `${seat} fortifies hex (${action.col},${action.row}) — occupants gain Harden 1 (Piercing ignores).`,
      ),
    }
  }

  if (action.type === 'castAbility') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (state.phase !== 'Play') return { ok: false, error: 'Not play phase.' }
    if (state.activeSeat !== seat) return { ok: false, error: 'Not your turn.' }

    const caster = state.units.find((u) => u.id === action.casterUnitId)
    if (!caster || caster.seat !== seat) {
      return { ok: false, error: 'Invalid caster.' }
    }
    if (caster.kind === 'unit') {
      // Combat units may cast Used By: Unit / Both actives (e.g. Heal).
    } else if (caster.kind !== 'officer' && caster.kind !== 'commander') {
      return { ok: false, error: 'Invalid caster.' }
    }

    const abilityName = action.abilityName.trim()
    const onCard =
      (caster.abilities || []).includes(abilityName) ||
      caster.ultimate === abilityName
    if (!onCard) {
      return { ok: false, error: `${caster.cardName} does not have ${abilityName}.` }
    }

    const def = state.abilityCatalog[abilityName]
    if (!def) {
      return {
        ok: false,
        error: `Unknown ability '${abilityName}' (not in catalog). Re-lock army after server restart.`,
      }
    }
    if (isPassiveAbility(def)) {
      return { ok: false, error: 'Passives are always on — do not cast them.' }
    }
    if (!casterMayUseAbility(def, caster.kind)) {
      return {
        ok: false,
        error: `${abilityName} is not legal for a ${caster.kind} (Used By: ${def.usedBy || '—'}).`,
      }
    }
    if (isUltimateAbility(def) && caster.ultimateUsed) {
      return { ok: false, error: 'Ultimate already used this battle.' }
    }
    if (
      (abilityName === 'Raise Thrall' || abilityName === 'Raise Host') &&
      caster.raiseOnceUsed
    ) {
      return { ok: false, error: 'Raise already used this battle.' }
    }
    const readyAt = caster.abilityReadyRound?.[abilityName] ?? 0
    if (state.round < readyAt) {
      return {
        ok: false,
        error: `${abilityName} is on cooldown until round ${readyAt}.`,
      }
    }
    if (caster.nullPulsed) {
      return { ok: false, error: 'Null Pulse — cannot cast actives until round refresh.' }
    }

    const spend = abilitySpendForCaster(def, caster.kind)
    if ('error' in spend) return { ok: false, error: spend.error }

    let commanderPools = state.commanderPools
    let companyPools = state.companyPools
    if (spend.pool === 'commanderAp' || spend.pool === 'commanderCc') {
      const pool = state.commanderPools[seat]
      if (!pool) return { ok: false, error: 'No commander pool.' }
      if (spend.pool === 'commanderAp') {
        if (pool.ap < spend.amount) {
          return { ok: false, error: 'Not enough Commander AP.' }
        }
        commanderPools = {
          ...state.commanderPools,
          [seat]: { ...pool, ap: pool.ap - spend.amount },
        }
      } else {
        if (pool.cc < spend.amount) return { ok: false, error: 'Not enough CC.' }
        commanderPools = {
          ...state.commanderPools,
          [seat]: { ...pool, cc: pool.cc - spend.amount },
        }
      }
    } else if (spend.pool === 'companyAp') {
      const officerId =
        caster.kind === 'officer'
          ? caster.id
          : caster.kind === 'unit'
            ? (state.units.find(
                (u) =>
                  u.seat === seat &&
                  u.kind === 'officer' &&
                  u.cardId === caster.officerCardId,
              )?.id ?? state.activeCompanyOfficerId)
            : state.activeCompanyOfficerId
      if (!officerId) {
        return { ok: false, error: 'Activate a company to spend Company AP.' }
      }
      if (
        caster.kind === 'unit' &&
        state.activeCompanyOfficerId &&
        state.activeCompanyOfficerId !== officerId
      ) {
        return {
          ok: false,
          error: 'Activate this unit’s company before casting.',
        }
      }
      const pool = state.companyPools[officerId] ?? { ap: 0, apMax: 0 }
      if (pool.ap < spend.amount) {
        return { ok: false, error: 'Not enough Company AP.' }
      }
      companyPools = {
        ...state.companyPools,
        [officerId]: { ...pool, ap: pool.ap - spend.amount },
      }
    }

    const effectName = resolveEffectAbilityName(abilityName)
    const target = action.targetUnitId
      ? (state.units.find((u) => u.id === action.targetUnitId) ?? null)
      : null

    const applied = applyCastEffect({
      state: { ...state, commanderPools, companyPools },
      caster,
      abilityName,
      effectName,
      def,
      target,
    })
    if (!applied.ok) return applied

    let next = applied.state
    const cd = def.cooldown != null && def.cooldown > 0 ? Number(def.cooldown) : 0
    next = {
      ...next,
      units: next.units.map((u) => {
        if (u.id !== caster.id) return u
        const abilityReadyRound = { ...(u.abilityReadyRound || {}) }
        if (cd > 0 && !isUltimateAbility(def)) {
          abilityReadyRound[abilityName] = state.round + cd
        }
        return {
          ...u,
          abilityReadyRound,
          ultimateUsed: isUltimateAbility(def) ? true : u.ultimateUsed,
          raiseOnceUsed:
            abilityName === 'Raise Thrall' || abilityName === 'Raise Host'
              ? true
              : u.raiseOnceUsed,
        }
      }),
    }

    const costLabel =
      spend.pool === 'none'
        ? 'Ultimate'
        : spend.pool === 'commanderCc'
          ? `${spend.amount} CC`
          : spend.pool === 'commanderAp'
            ? `${spend.amount} AP`
            : `${spend.amount} Company AP`
    return {
      ok: true,
      state: pushLog(
        next,
        `${seat} casts ${abilityName} (${costLabel}) with ${caster.cardName}${
          target ? ` → ${target.cardName}` : ''
        }.${applied.note ? ` ${applied.note}` : ''}`,
      ),
    }
  }

  if (action.type === 'move') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (state.phase !== 'Play') return { ok: false, error: 'Not play phase.' }
    if (state.activeSeat !== seat) return { ok: false, error: 'Not your turn.' }

    const unit = state.units.find((u) => u.id === action.unitId)
    if (!unit || unit.seat !== seat) return { ok: false, error: 'Invalid unit.' }

    // Commanders move after activateCommander; officers/units move during company activation
    if (unit.kind === 'commander') {
      if (unit.moveRemaining <= 0) {
        return { ok: false, error: 'Commander has no move remaining. Activate first.' }
      }
    } else {
      if (!state.activeCompanyOfficerId) {
        return { ok: false, error: 'Activate a company first.' }
      }
      const officer = state.units.find((u) => u.id === state.activeCompanyOfficerId)
      if (!officer) return { ok: false, error: 'No active company.' }
      const inCompany =
        unit.id === officer.id || unit.officerCardId === officer.cardId
      if (!inCompany) {
        return { ok: false, error: 'That unit is not in the active company.' }
      }
    }

    if (unit.rooted) {
      return { ok: false, error: 'Rooted units cannot move.' }
    }

    const dest = { col: action.col, row: action.row }
    if (!inBounds(dest, state.boardSize)) return { ok: false, error: 'Out of bounds.' }
    const occ = occupiedKeys(state)
    occ.delete(`${unit.col},${unit.row}`)
    if (occ.has(`${dest.col},${dest.row}`)) {
      return { ok: false, error: 'Hex occupied.' }
    }

    const moveCheck = validateTerrainMove({
      origin: { col: unit.col, row: unit.row },
      dest,
      budget: unit.moveRemaining,
      boardSize: state.boardSize,
      terrain: state.terrain ?? {},
      occupied: occ,
      friendlyOccupied: friendlyOccupiedKeys(state, seat, unit.id),
      traveler: travelerFromUnit(unit),
      allowOverspend: true,
    })
    if (!moveCheck.ok) return moveCheck

    const beyond = moveCheck.overspend || unit.movedBeyondLimit
    const units = state.units.map((u) =>
      u.id === unit.id
        ? {
            ...u,
            col: dest.col,
            row: dest.row,
            moveRemaining: moveCheck.remaining,
            movedBeyondLimit: beyond,
          }
        : u,
    )
    const warn = moveCheck.overspend
      ? ` ⚠ beyond printed Move (spent ${moveCheck.spent}, had ${unit.moveRemaining}) — OK for Harass/Trample/free steps.`
      : ''
    let next = pushLog(
      { ...state, units },
      `${seat} moved ${unit.cardName} → (${dest.col},${dest.row}) · spent ${moveCheck.spent} Move · ${moveCheck.remaining}/${unit.move} left.${warn}`,
    )
    const claimed = recalculateObjectiveControl(next)
    next = claimed.state
    if (claimed.changedIds.length) {
      next = {
        ...next,
        units: next.units.map((u) =>
          u.id === unit.id
            ? {
                ...u,
                claimsThisActivation: [
                  ...(u.claimsThisActivation ?? []),
                  ...claimed.changedIds,
                ],
              }
            : u,
        ),
      }
    }
    return { ok: true, state: next }
  }

  if (action.type === 'undoMove') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (state.phase !== 'Play') return { ok: false, error: 'Not play phase.' }
    if (state.activeSeat !== seat) return { ok: false, error: 'Not your turn.' }

    const unit = state.units.find((u) => u.id === action.unitId)
    if (!unit || unit.seat !== seat) return { ok: false, error: 'Invalid unit.' }
    if (unit.activationCol == null || unit.activationRow == null) {
      return { ok: false, error: 'Activate this unit/commander before undoing movement.' }
    }
    if (
      unit.col === unit.activationCol &&
      unit.row === unit.activationRow &&
      unit.moveRemaining === unit.move
    ) {
      return { ok: false, error: 'Nothing to undo — unit is still at its start hex.' }
    }

    const units = state.units.map((u) =>
      u.id === unit.id
        ? {
            ...u,
            col: unit.activationCol!,
            row: unit.activationRow!,
            moveRemaining: u.move,
            claimsThisActivation: [],
            movedBeyondLimit: false,
          }
        : u,
    )
    const recalc = recalculateObjectiveControl({
      ...state,
      units,
      winner: null,
      phase: 'Play',
    })
    return {
      ok: true,
      state: pushLog(
        recalc.state,
        `${seat} reset ${unit.cardName} to (${unit.activationCol},${unit.activationRow}) — Move restored.`,
      ),
    }
  }

  if (action.type === 'endTurn') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (state.phase !== 'Play') return { ok: false, error: 'Not play phase.' }
    if (state.activeSeat !== seat) return { ok: false, error: 'Not your turn.' }
    return { ok: true, state: advanceTurn(state, seat) }
  }

  if (action.type === 'reviveFromGrave') {
    if (!seat) return { ok: false, error: 'Not seated.' }
    if (state.phase !== 'Play') return { ok: false, error: 'Not play phase.' }
    if (state.activeSeat !== seat) return { ok: false, error: 'Not your turn.' }

    const death = (state.deaths ?? []).find((d) => d.id === action.deathId)
    if (!death) return { ok: false, error: 'Grave not found.' }
    if (death.seat !== seat) {
      return { ok: false, error: 'Only the owner can revive their units.' }
    }

    const col = action.col ?? death.col
    const row = action.row ?? death.row
    if (!inBounds({ col, row }, state.boardSize)) {
      return { ok: false, error: 'Out of bounds.' }
    }
    if (state.units.some((u) => u.col === col && u.row === row)) {
      return { ok: false, error: 'Hex is occupied.' }
    }

    const revived = buildRevivedUnit(
      state,
      death,
      col,
      row,
      action.toughness ?? 1,
    )
    let next: GameState = {
      ...state,
      units: [...state.units, revived],
      deaths: (state.deaths ?? []).filter((d) => d.id !== death.id),
    }
    if (revived.kind === 'officer') {
      next = refreshCompanyPool(next, revived)
    }
    next = recalculateObjectiveControl(next).state
    return {
      ok: true,
      state: pushLog(
        next,
        `${seat} revives ${revived.cardName} at (${col},${row}) — Toughness ${revived.toughnessCurrent}/${revived.toughness ?? '—'}.`,
      ),
    }
  }

  return { ok: false, error: 'Unhandled action.' }
}

export function publicCenter(boardSize = BOARD_SIZE): OddR {
  const mid = boardMid(boardSize)
  return { col: mid, row: mid }
}

export type { ArmyList, CardSnapshot, DeployItem }
