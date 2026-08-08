import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Ability, Card } from '../../../src/api'
import { api } from '../../../src/api'
import { CardFace } from '../../../src/components/cards/CardFace'
import {
  commandZonePieceQuota,
  commandZoneSizeUsed,
  commandZoneSlotsTotal,
  canForceStart,
  FLOOD_TERRAIN_KINDS,
  TERRAIN_LAND_DROPS_PER_SIZE,
  WATER_HEX_CAP,
  abilitySpendForCaster,
  boardStateFileBasename,
  buildBoardStateFile,
  buildTerrainPiece,
  casterMayUseAbility,
  commandRadiusKeys,
  commanderHasEscapePath,
  countWaterHexes,
  expandTerrainPiece,
  findDeployedOfficer,
  flattenObjectiveHexes,
  foreignCommandRadiusKeys,
  hexKey,
  isImpassableTerrain,
  isPassiveAbility,
  isUltimateAbility,
  kindsForShapeSize,
  normalizeRotation,
  officerDeployRadius,
  ownCommandRadiusKeys,
  parseBoardStateFile,
  smallTerrainPieceCatalog,
  terrainMayCoverCommander,
  terrainSetupStayConnected,
  terrainShapeSilhouettes,
  validateTerrainPlacement,
  waterPlacementAllowed,
  previewAttack,
  hitNeedBreakdownFromFlags,
  effectiveDamage,
  unitStatusPills,
  SCOUT_CR_EXTENSION,
  DEPLOY_UV_MAX,
  RESERVE_UV_MAX,
  MAX_ROUNDS,
  VP_PER_OBJECTIVE,
  normalizeLoadoutPools,
  type AbilityDef,
  type ArmyList,
  type BattleLoadout,
  type CardSnapshot,
  type GameState,
  type HitNeedBreakdown,
  type SeatId,
  type TerrainKind,
  type TerrainSizeClass,
  type UnitToken,
  type DeathRecord,
} from '../../shared/index'

type ArmyRosterEntry = {
  key: string
  seat: SeatId
  cardId: string
  label: string
  kind: 'commander' | 'officer' | 'unit'
  count: number
}

function snapshotToCard(s: CardSnapshot): Card {
  return {
    id: s.id,
    name: s.name,
    cardType: s.cardType,
    rarity: s.rarity,
    unique: s.unique,
    race: s.race,
    primaryType: null,
    secondaryType: null,
    uv: s.uv,
    move: s.move,
    damage: s.damage,
    range: s.range,
    toughness: s.toughness,
    companyAp: s.companyAp,
    companyCapacity: s.companyCapacity,
    commandRadius: s.commandRadius,
    apGeneration: s.apGeneration,
    ccGeneration: s.ccGeneration,
    abilities: [...(s.abilities ?? [])],
    keywords: [...(s.keywords ?? [])],
    ultimate: s.ultimate ?? null,
    flavorText: null,
    complexity: null,
    role: null,
    tags: [],
    supportedRaces: [],
    supportedTypes: [],
    supportedKeywords: [],
    hasArt: false,
    artUrl: null,
  }
}

function buildArmyRoster(
  army: ArmyList,
  catalog: Record<string, CardSnapshot>,
  seat: SeatId,
): ArmyRosterEntry[] {
  const out: ArmyRosterEntry[] = []
  const commander = catalog[army.commanderCardId]
  out.push({
    key: `${seat}-cmd`,
    seat,
    cardId: army.commanderCardId,
    label: commander?.name ?? army.commanderCardId,
    kind: 'commander',
    count: 1,
  })
  army.companies.forEach((co, ci) => {
    const officer = catalog[co.officerCardId]
    out.push({
      key: `${seat}-off-${ci}`,
      seat,
      cardId: co.officerCardId,
      label: officer?.name ?? co.officerCardId,
      kind: 'officer',
      count: 1,
    })
    for (const u of co.units) {
      const card = catalog[u.cardId]
      out.push({
        key: `${seat}-unit-${co.officerCardId}-${u.cardId}`,
        seat,
        cardId: u.cardId,
        label: card?.name ?? u.cardId,
        kind: 'unit',
        count: u.count,
      })
    }
  })
  return out
}

function findBoardUnitForRosterEntry(
  units: UnitToken[],
  entry: ArmyRosterEntry,
): UnitToken | null {
  if (entry.kind === 'commander') {
    return units.find((u) => u.seat === entry.seat && u.kind === 'commander') ?? null
  }
  if (entry.kind === 'officer') {
    return (
      units.find(
        (u) =>
          u.seat === entry.seat &&
          u.kind === 'officer' &&
          u.cardId === entry.cardId,
      ) ?? null
    )
  }
  return (
    units.find(
      (u) =>
        u.seat === entry.seat && u.kind === 'unit' && u.cardId === entry.cardId,
    ) ?? null
  )
}

function rosterKindLabel(kind: ArmyRosterEntry['kind']): string {
  return kind === 'commander' ? 'C' : kind === 'officer' ? 'O' : 'U'
}
import { ArmyBuilder } from './ArmyBuilder'
import { ForceSelectPanel } from './ForceSelectPanel'
import { HexBoard } from './HexBoard'
import { HexBoard3D } from './HexBoard3D'
import { TerrainShapePreview } from './TerrainShapePreview'
import { usePlaySocket } from './usePlaySocket'

function useLanUrls() {
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    // Same origin the guest should open — Vite advertises Network URLs when host:true
    const port = location.port || (location.protocol === 'https:' ? '443' : '80')
    const local = `${location.protocol}//${location.hostname}:${port}`
    setUrls([local])
  }, [])
  return urls
}

type LastCombatResult = NonNullable<GameState['lastCombatResult']>

const DIE_PIPS: Record<number, number[]> = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
}

function DieFace({
  value,
  tumbling = false,
}: {
  value: number
  tumbling?: boolean
}) {
  const face = Math.max(1, Math.min(6, value))
  const pips = DIE_PIPS[face]
  return (
    <div className={`die-face ${tumbling ? 'die-face-tumbling' : ''}`} aria-hidden>
      {Array.from({ length: 9 }, (_, i) => {
        const pip = i + 1
        return (
          <span
            key={pip}
            className={`die-pip ${pips.includes(pip) ? 'die-pip-on' : ''}`}
          />
        )
      })}
    </div>
  )
}

function combatResultKey(result: LastCombatResult): string {
  return `${result.attackerId}:${result.defenderId}:${result.dice[0]}:${result.dice[1]}:${result.roll}`
}

function CombatRollOverlay({
  result,
  onDismiss,
}: {
  result: LastCombatResult
  onDismiss: () => void
}) {
  const [phase, setPhase] = useState<'tumble' | 'reveal'>('tumble')
  const [tumbleFaces, setTumbleFaces] = useState<[number, number]>([1, 1])

  useEffect(() => {
    setPhase('tumble')
    setTumbleFaces([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)])
    const interval = window.setInterval(() => {
      setTumbleFaces([
        1 + Math.floor(Math.random() * 6),
        1 + Math.floor(Math.random() * 6),
      ])
    }, 90)
    const revealTimer = window.setTimeout(() => {
      window.clearInterval(interval)
      setPhase('reveal')
    }, 1300)
    return () => {
      window.clearInterval(interval)
      window.clearTimeout(revealTimer)
    }
  }, [result])

  useEffect(() => {
    if (phase !== 'reveal') return
    const dismissTimer = window.setTimeout(onDismiss, 2700)
    return () => window.clearTimeout(dismissTimer)
  }, [phase, onDismiss])

  const outcomeLabel = result.hit ? 'HIT' : 'MISS'
  const showReal = phase === 'reveal'
  const faces: [number, number] = showReal ? result.dice : tumbleFaces

  return (
    <div
      className="combat-roll-overlay"
      role="dialog"
      aria-live="polite"
      aria-label="Attack roll result"
      onClick={showReal ? onDismiss : undefined}
    >
      <div
        className={`combat-roll-panel ${showReal ? 'combat-roll-panel-revealed' : ''} ${result.hit ? 'combat-roll-hit' : 'combat-roll-miss'}`}
        onClick={showReal ? onDismiss : (e) => e.stopPropagation()}
      >
        <p className="combat-roll-attacker muted">
          {result.attackerName} → {result.defenderName}
        </p>
        <div className="combat-roll-dice-row">
          <DieFace value={faces[0]} tumbling={!showReal} />
          <span className="combat-roll-plus">+</span>
          <DieFace value={faces[1]} tumbling={!showReal} />
        </div>
        {showReal ? (
          <>
            <p className="combat-roll-sum">
              <span className="combat-roll-sum-value">{result.roll}</span>
              <span className="combat-roll-need muted"> vs {result.hitNeed}+</span>
            </p>
            <p className={`combat-roll-outcome ${result.hit ? 'outcome-hit' : 'outcome-miss'}`}>
              {outcomeLabel}
            </p>
            <p className="combat-roll-dismiss muted">Click to dismiss</p>
          </>
        ) : (
          <p className="combat-roll-rolling muted">Rolling…</p>
        )}
      </div>
    </div>
  )
}

function useCombatRollOverlay(lastCombatResult: GameState['lastCombatResult']) {
  const [overlayResult, setOverlayResult] = useState<LastCombatResult | null>(null)
  const seenKeyRef = useRef<string | null>(null)
  const skipInitialRef = useRef(true)

  useEffect(() => {
    if (!lastCombatResult) return
    const key = combatResultKey(lastCombatResult)
    if (seenKeyRef.current === key) return
    seenKeyRef.current = key
    if (skipInitialRef.current) {
      skipInitialRef.current = false
      return
    }
    setOverlayResult(lastCombatResult)
  }, [lastCombatResult])

  const dismissOverlay = useCallback(() => setOverlayResult(null), [])

  return { overlayResult, dismissOverlay }
}

function formatHitModDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta)
}

function HitNeedBreakdownLine({ breakdown }: { breakdown: HitNeedBreakdown }) {
  if (!breakdown.modifiers.length) {
    return (
      <p className="hit-need-breakdown muted">
        {breakdown.baseNeed}+ base (no modifiers)
      </p>
    )
  }
  return (
    <p className="hit-need-breakdown muted">
      <span>{breakdown.baseNeed}+ base</span>
      {breakdown.modifiers.map((m) => (
        <span key={m.label} className="hit-mod">
          {m.label} {formatHitModDelta(m.delta)}
        </span>
      ))}
    </p>
  )
}

function HitNeedPreview({
  breakdown,
  distance,
  rawDamage,
  trampleStrike,
  fortifiedHex,
  piercing,
  targetUnit,
  selectedUnit,
}: {
  breakdown: HitNeedBreakdown
  distance: number
  rawDamage: number
  trampleStrike: boolean
  fortifiedHex: boolean
  piercing: boolean
  targetUnit: UnitToken | null
  selectedUnit: UnitToken | null
}) {
  return (
    <div className="hit-need-box">
      <div className="hit-need-head">
        <span className="hit-need-label">Hit on (2d6)</span>
        <span className="hit-need-value">{breakdown.finalNeed}+</span>
      </div>
      <HitNeedBreakdownLine breakdown={breakdown} />
      <p className="attack-preview-details muted">
        {distance} hex · Dmg <strong>{rawDamage}</strong>
        {trampleStrike ? ' · Trample leftover' : ''}
        {fortifiedHex && !piercing ? ' · Fortified Harden 1' : ''}
        {piercing ? ' · Piercing ignores Harden' : ''}
        {targetUnit && (targetUnit.poisonTokens ?? 0) > 0
          ? ` · Poison token (${targetUnit.poisonTokens})`
          : ''}
        {selectedUnit &&
        effectiveDamage(selectedUnit) !== (selectedUnit.damage ?? 0)
          ? ` (${selectedUnit.damage ?? 0} + temp)`
          : ''}
      </p>
    </div>
  )
}

function CombatResultBanner({ result }: { result: LastCombatResult }) {
  const breakdown = hitNeedBreakdownFromFlags(result)
  const outcomeClass = result.hit ? 'combat-hit' : 'combat-miss'
  const outcomeLabel = result.hit
    ? result.unyieldingBlocked
      ? 'HIT — Unyielding'
      : result.dealt > 0
        ? result.killed
          ? `HIT — ${result.dealt} dmg (destroyed)`
          : `HIT — ${result.dealt} dmg`
        : 'HIT — 0 dmg (mitigated)'
    : 'MISS'

  return (
    <div className={`combat-result-box ${outcomeClass}`}>
      <div className="combat-result-head">
        <span className="combat-result-outcome">{outcomeLabel}</span>
        <span className="combat-roll-vs">
          Rolled <strong>{result.dice.join(' + ')}</strong> ={' '}
          <strong>{result.roll}</strong> (2d6) vs need{' '}
          <strong>{result.hitNeed}+</strong>
        </span>
      </div>
      <p className="combat-result-meta muted">
        {result.attackerName} → {result.defenderName} · {result.distance} hex
      </p>
      <HitNeedBreakdownLine breakdown={breakdown} />
      {result.mitigated > 0 ? (
        <p className="combat-result-extra muted">
          {result.mitigated} mitigated
          {result.fortifiedHex ? ' · Fortified' : ''}
          {result.piercing ? ' · Piercing' : ''}
        </p>
      ) : null}
      {result.poisonApplied ||
      result.fearApplied ||
      result.slowApplied ||
      result.trampleOffer ? (
        <p className="combat-result-extra muted">
          {[
            result.poisonApplied ? 'Poison applied' : null,
            result.fearApplied ? 'Fear applied' : null,
            result.slowApplied ? 'Slow applied' : null,
            result.trampleOffer ? 'Trample offered' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : null}
    </div>
  )
}

export default function App() {
  const { state, seat, token, connected, error, yourIp, playerIps, setError, send, leaveRoom, abandonSavedSession, savedRoom, savedSeat, savedName } =
    usePlaySocket()
  const { overlayResult, dismissOverlay } = useCombatRollOverlay(state?.lastCombatResult ?? null)
  const [name, setName] = useState(() => savedName || '')
  const [joinCode, setJoinCode] = useState(savedRoom || '')
  const [createRoomCode, setCreateRoomCode] = useState('')
  const [maxPlayers, setMaxPlayers] = useState<2 | 4>(2)
  const [opponentMode, setOpponentMode] = useState<'human' | 'ai'>('human')
  const [aiDifficulty, setAiDifficulty] = useState<'easy' | 'medium' | 'hard'>(
    'medium',
  )
  const [enforceCommanderRace, setEnforceCommanderRace] = useState(() => {
    const raw = localStorage.getItem('cw-play-enforce-commander-race')
    return raw !== '0'
  })
  const [createDeployMax, setCreateDeployMax] = useState(DEPLOY_UV_MAX)
  const [createReserveMax, setCreateReserveMax] = useState(RESERVE_UV_MAX)
  const [boardMode, setBoardMode] = useState<'2d' | '3d'>(() => {
    return localStorage.getItem('cw-play-board-mode') === '3d' ? '3d' : '2d'
  })
  const setBoardModePersist = (mode: '2d' | '3d') => {
    setBoardMode(mode)
    localStorage.setItem('cw-play-board-mode', mode)
  }
  const [lobbyView, setLobbyView] = useState<'lobby' | 'armyWorkshop'>('lobby')
  const [workshopNotice, setWorkshopNotice] = useState<string | null>(null)
  const [queueIndex, setQueueIndex] = useState(0)
  const [terrainRotation, setTerrainRotation] = useState(0)
  const [floodKind, setFloodKind] = useState<TerrainKind>('plains')
  const [terrainPickShapeKey, setTerrainPickShapeKey] = useState<string | null>(
    null,
  )
  const [terrainPickKind, setTerrainPickKind] = useState<TerrainKind | null>(
    null,
  )
  const [terrainPickStep, setTerrainPickStep] = useState<'shape' | 'kind'>(
    'shape',
  )
  const [hoverHex, setHoverHex] = useState<{ col: number; row: number } | null>(
    null,
  )
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)
  const [selectedArmyCardId, setSelectedArmyCardId] = useState<string | null>(
    null,
  )
  const [selectedDeathId, setSelectedDeathId] = useState<string | null>(null)
  const [reviveAtClickMode, setReviveAtClickMode] = useState(false)
  const [targetUnitId, setTargetUnitId] = useState<string | null>(null)
  const [aimMode, setAimMode] = useState(false)
  const [diceCount, setDiceCount] = useState(2)
  const [damageAmount, setDamageAmount] = useState(1)
  const [healAmount, setHealAmount] = useState(1)
  const [logOpen, setLogOpen] = useState(false)
  const [roomPopoutOpen, setRoomPopoutOpen] = useState(false)
  const [cardsById, setCardsById] = useState<Map<string, Card>>(() => new Map())
  const [abilityByName, setAbilityByName] = useState<Map<string, Ability>>(
    () => new Map(),
  )
  const [showLoadConfirm, setShowLoadConfirm] = useState(false)
  const [pendingLoadState, setPendingLoadState] = useState<any>(null)
  const lanUrls = useLanUrls()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [{ cards }, { abilities }] = await Promise.all([
          api.cards({ limit: '2000' }),
          api.abilities(),
        ])
        if (cancelled) return
        setCardsById(new Map(cards.map((c) => [c.id, c])))
        setAbilityByName(new Map(abilities.map((a) => [a.name, a])))
      } catch {
        /* card preview optional if API down */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const me = useMemo(
    () => state?.players.find((p) => p.seat === seat) ?? null,
    [state, seat],
  )

  const buildingArmy =
    !!state &&
    !!seat &&
    (state.phase === 'Lobby' || state.phase === 'ArmyBuild') &&
    !me?.armyReady

  const inForceSelect =
    !!state && !!seat && state.phase === 'ForceSelect' && !!me?.army

  const forceSelectOpponents = useMemo(() => {
    if (!state || !seat) return []
    return state.players
      .filter((p) => p.seat !== seat && p.armyReady && p.army)
      .map((p) => ({
        seat: p.seat,
        name: p.name,
        army: p.army!,
        armyUv: p.armyUv,
      }))
  }, [state, seat])

  const forceSelectOpponentStatus = useMemo(() => {
    if (!state || !seat) return []
    return state.players
      .filter((p) => p.seat !== seat)
      .map((p) => ({
        seat: p.seat,
        name: p.name,
        forceSelectReady: p.forceSelectReady,
      }))
  }, [state, seat])

  const myQueue = seat && state?.deployQueues[seat] ? state.deployQueues[seat]! : []
  const nextUnplaced = myQueue.findIndex((q) => !q.placed)
  const activeIndex =
    nextUnplaced >= 0 && myQueue[queueIndex]?.placed ? nextUnplaced : queueIndex
  const activeDeployItem = myQueue[activeIndex] ?? null

  const deployHintKeys = useMemo(() => {
    if (!state || !seat || state.phase !== 'Deploy' || !activeDeployItem) {
      return new Set<string>()
    }
    if (activeDeployItem.kind === 'officer') {
      return ownCommandRadiusKeys(state, seat)
    }
    const officer = findDeployedOfficer(
      state,
      seat,
      activeDeployItem.officerCardId,
    )
    if (!officer) return new Set<string>()
    return commandRadiusKeys(
      { col: officer.col, row: officer.row },
      officerDeployRadius(state, officer),
      state.boardSize,
    )
  }, [state, seat, activeDeployItem])

  const terrainStage = state?.terrainStage ?? 'commandZone'
  const isLandStage =
    terrainStage === 'landLarge' ||
    terrainStage === 'landMedium' ||
    terrainStage === 'landSmall'
  const landSize: TerrainSizeClass | null =
    terrainStage === 'landLarge'
      ? 'large'
      : terrainStage === 'landMedium'
        ? 'medium'
        : terrainStage === 'landSmall'
          ? 'small'
          : null
  const crQuota = commandZonePieceQuota(state?.maxPlayers ?? 2)
  const crSlotsTotal = commandZoneSlotsTotal(state?.maxPlayers ?? 2)
  const myCommandZoneMode = seat ? state?.commandZoneModes?.[seat] : undefined
  const myTerrainHand =
    seat && state?.terrainHands?.[seat] ? state.terrainHands[seat]! : []
  const placedTerrainCount = myTerrainHand.filter((q) => q.placed).length
  const heldTerrainIndex = myTerrainHand.findIndex(
    (q) => !q.placed && !q.skipped && !q.flooded,
  )
  const heldTerrain =
    heldTerrainIndex >= 0 ? myTerrainHand[heldTerrainIndex]! : null
  const nextCrSize = useMemo((): TerrainSizeClass | null => {
    for (const size of ['large', 'medium', 'small'] as const) {
      if (commandZoneSizeUsed(myTerrainHand, size) < crQuota[size]) {
        return size
      }
    }
    return null
  }, [myTerrainHand, crQuota])
  const shapeCatalog = useMemo(() => {
    if (!nextCrSize || nextCrSize === 'small') return []
    return terrainShapeSilhouettes(nextCrSize)
  }, [nextCrSize])
  const landShapeCatalog = useMemo(
    () =>
      landSize && landSize !== 'small'
        ? terrainShapeSilhouettes(landSize)
        : [],
    [landSize],
  )
  const myLandDropsUsed = seat ? (state?.landDropsUsed?.[seat] ?? 0) : 0
  const selectedLandPiece = useMemo(() => {
    if (!landSize || !terrainPickShapeKey) return null
    if (landSize === 'small') {
      return (
        smallTerrainPieceCatalog().find((p) => p.id === terrainPickShapeKey) ??
        null
      )
    }
    if (!terrainPickKind) return null
    return buildTerrainPiece(terrainPickShapeKey, terrainPickKind, landSize)
  }, [landSize, terrainPickShapeKey, terrainPickKind])
  const myCrProgress = useMemo(() => {
    const used = {
      large: commandZoneSizeUsed(myTerrainHand, 'large'),
      medium: commandZoneSizeUsed(myTerrainHand, 'medium'),
      small: commandZoneSizeUsed(myTerrainHand, 'small'),
    }
    const done = {
      large: myTerrainHand.filter(
        (q) => q.sizeClass === 'large' && (q.placed || q.skipped),
      ).length,
      medium: myTerrainHand.filter(
        (q) => q.sizeClass === 'medium' && (q.placed || q.skipped),
      ).length,
      small: myTerrainHand.filter(
        (q) => q.sizeClass === 'small' && (q.placed || q.skipped),
      ).length,
    }
    return { used, done, quota: crQuota }
  }, [myTerrainHand, crQuota])
  const waterHexes = countWaterHexes(state?.terrain ?? {})
  const waterOk = waterPlacementAllowed(state?.terrain ?? {})
  const activeBlockedByWaterCap =
    !!heldTerrain &&
    heldTerrain.kind === 'water' &&
    !heldTerrain.placed &&
    !waterOk
  const canPlaceCommandZone =
    state?.phase === 'Terrain' &&
    terrainStage === 'commandZone' &&
    myCommandZoneMode === 'pieces' &&
    !!seat &&
    !me?.terrainReady &&
    heldTerrainIndex >= 0 &&
    !!heldTerrain &&
    !heldTerrain.placed &&
    !heldTerrain.skipped &&
    !activeBlockedByWaterCap
  const landBlockedByWaterCap =
    !!selectedLandPiece &&
    selectedLandPiece.kind === 'water' &&
    !waterOk
  const canPlaceLand =
    state?.phase === 'Terrain' &&
    isLandStage &&
    !!seat &&
    state.activeSeat === seat &&
    myLandDropsUsed < TERRAIN_LAND_DROPS_PER_SIZE &&
    !!selectedLandPiece &&
    !landBlockedByWaterCap
  const canSkipCommandZone = canPlaceCommandZone && !!heldTerrain
  const canSkipLand =
    state?.phase === 'Terrain' &&
    isLandStage &&
    !!seat &&
    state.activeSeat === seat &&
    myLandDropsUsed < TERRAIN_LAND_DROPS_PER_SIZE
  const canPlaceTerrain = canPlaceCommandZone || canPlaceLand
  const activeTerrain = canPlaceLand ? selectedLandPiece : heldTerrain
  const forceStartGate =
    seat && state ? canForceStart(state, seat) : { ok: false as const, error: '' }
  const showForceStart =
    !!state &&
    !!seat &&
    seat === state.hostSeat &&
    state.players.length >= 2 &&
    state.players.length < state.maxPlayers &&
    (state.phase === 'ArmyBuild' ||
      state.phase === 'Commanders' ||
      state.phase === 'ForceSelect')
  const isHost = !!state && !!seat && seat === state.hostSeat
  const roomPools = useMemo(
    () => normalizeLoadoutPools(state?.loadoutPools),
    [state?.loadoutPools],
  )
  const canEditLoadoutPools =
    isHost &&
    !!state &&
    (state.phase === 'Lobby' || state.phase === 'ArmyBuild')

  const selectedUnit: UnitToken | null = useMemo(() => {
    if (!state || !selectedUnitId) return null
    return state.units.find((u) => u.id === selectedUnitId) ?? null
  }, [state, selectedUnitId])

  const selectedDeath: DeathRecord | null = useMemo(() => {
    if (!state || !selectedDeathId) return null
    return state.deaths?.find((d) => d.id === selectedDeathId) ?? null
  }, [state, selectedDeathId])

  useEffect(() => {
    if (state?.phase !== 'Terrain') {
      setTerrainPickShapeKey(null)
      setTerrainPickKind(null)
      setTerrainPickStep('shape')
      return
    }
    if (isLandStage) {
      setTerrainPickShapeKey(null)
      setTerrainPickKind(null)
      setTerrainPickStep('shape')
    }
  }, [state?.phase, state?.activeSeat, state?.terrainStage, isLandStage])

  useEffect(() => {
    if (heldTerrain) {
      setTerrainPickShapeKey(null)
      setTerrainPickKind(null)
      setTerrainPickStep('shape')
    }
  }, [heldTerrain?.instanceId])

  useEffect(() => {
    if (
      selectedDeathId &&
      state &&
      !state.deaths?.some((d) => d.id === selectedDeathId)
    ) {
      setSelectedDeathId(null)
      setReviveAtClickMode(false)
    }
  }, [state?.deaths, selectedDeathId, state])

  const targetUnit: UnitToken | null = useMemo(() => {
    if (!state || !targetUnitId) return null
    return state.units.find((u) => u.id === targetUnitId) ?? null
  }, [state, targetUnitId])

  const selectedStatusPills = useMemo(() => {
    if (!selectedUnit) return []
    return unitStatusPills(selectedUnit)
  }, [selectedUnit])

  const attackPreview = useMemo(() => {
    if (!state || !selectedUnit || !targetUnit) return null
    const strikeDamageOverride =
      selectedUnit.trampleLeftoverDamage > 0
        ? selectedUnit.trampleLeftoverDamage
        : undefined
    return previewAttack({
      state,
      attacker: selectedUnit,
      defender: targetUnit,
      strikeDamageOverride,
    })
  }, [state, selectedUnit, targetUnit])

  const evadeCandidate: UnitToken | null = useMemo(() => {
    if (targetUnit?.seat === seat) return targetUnit
    if (selectedUnit?.seat === seat && selectedUnit.kind !== 'commander') {
      return selectedUnit
    }
    return null
  }, [targetUnit, selectedUnit, seat])

  const evadeCompanyPool = useMemo(() => {
    if (!state || !evadeCandidate || evadeCandidate.kind === 'commander') return null
    const officer =
      evadeCandidate.kind === 'officer'
        ? evadeCandidate
        : state.units.find(
            (u) =>
              u.seat === evadeCandidate.seat &&
              u.kind === 'officer' &&
              u.cardId === evadeCandidate.officerCardId,
          )
    return officer ? (state.companyPools[officer.id] ?? null) : null
  }, [state, evadeCandidate])

  const pendingTrample = state?.pendingTrample ?? null
  const trampleAttacker =
    pendingTrample && state
      ? (state.units.find((u) => u.id === pendingTrample.attackerId) ?? null)
      : null

  const myCommanderPool = seat ? state?.commanderPools?.[seat] : null
  const selectedOfficerId =
    selectedUnit?.kind === 'officer'
      ? selectedUnit.id
      : state?.activeCompanyOfficerId ?? null
  const companyPool = selectedOfficerId
    ? state?.companyPools?.[selectedOfficerId] ?? null
    : null

  useEffect(() => {
    if (selectedUnit?.damage != null && selectedUnit.damage > 0) {
      setDamageAmount(selectedUnit.damage)
    }
  }, [selectedUnit?.id, selectedUnit?.damage])

  const companyUnitIds = useMemo(() => {
    const ids = new Set<string>()
    if (!selectedUnit || selectedUnit.kind !== 'officer') return ids
    ids.add(selectedUnit.id)
    if (!state) return ids
    for (const u of state.units) {
      if (
        u.seat === selectedUnit.seat &&
        u.officerCardId === selectedUnit.cardId
      ) {
        ids.add(u.id)
      }
    }
    return ids
  }, [selectedUnit, state])

  const officerCrKeys = useMemo(() => {
    if (!state || !selectedUnit || selectedUnit.kind !== 'officer') {
      return new Set<string>()
    }
    const radius =
      selectedUnit.commandRadius ??
      state.cardCatalog?.[selectedUnit.cardId]?.commandRadius ??
      2
    return commandRadiusKeys(
      { col: selectedUnit.col, row: selectedUnit.row },
      radius && radius > 0 ? radius : 2,
      state.boardSize,
    )
  }, [state, selectedUnit])

  const focusCard = useMemo(() => {
    const cardId =
      selectedUnit?.cardId ??
      selectedArmyCardId ??
      selectedDeath?.cardId ??
      null
    if (!cardId) return null
    const fromApi = cardsById.get(cardId)
    if (fromApi) return fromApi
    const snap = state?.cardCatalog[cardId]
    return snap ? snapshotToCard(snap) : null
  }, [
    selectedUnit?.cardId,
    selectedArmyCardId,
    selectedDeath?.cardId,
    cardsById,
    state?.cardCatalog,
  ])

  const myArmyRoster = useMemo(() => {
    if (!me?.army || !state) return []
    return buildArmyRoster(me.army, state.cardCatalog, me.seat)
  }, [me?.army, me?.seat, state?.cardCatalog, state])

  const opponentRosters = useMemo(() => {
    if (!state || !seat) return []
    return state.players
      .filter((p) => p.seat !== seat && p.armyReady && p.army)
      .map((p) => ({
        seat: p.seat,
        name: p.name,
        roster: buildArmyRoster(p.army!, state.cardCatalog, p.seat),
      }))
  }, [state, seat])

  const showRightInspectPanel =
    !buildingArmy &&
    !inForceSelect &&
    (state?.phase === 'Play' ||
      state?.phase === 'Deploy' ||
      (!!me?.armyReady &&
        (state?.phase === 'Commanders' || state?.phase === 'Terrain')))

  function selectArmyEntry(entry: ArmyRosterEntry) {
    const turningOff = selectedArmyCardId === entry.cardId
    setSelectedArmyCardId(turningOff ? null : entry.cardId)
    setSelectedDeathId(null)
    setReviveAtClickMode(false)
    if (turningOff) {
      setSelectedUnitId(null)
      return
    }
    if (!state) return
    const onBoard = findBoardUnitForRosterEntry(state.units, entry)
    setSelectedUnitId(onBoard?.id ?? null)
  }

  useEffect(() => {
    if (state?.phase !== 'Deploy' || !activeDeployItem) return
    setSelectedArmyCardId(activeDeployItem.cardId)
  }, [state?.phase, activeDeployItem?.cardId])

  const artByCardId = useMemo(() => {
    const m: Record<string, string> = {}
    for (const [id, card] of cardsById) {
      if (card.hasArt && card.artUrl) m[id] = card.artUrl
    }
    return m
  }, [cardsById])

  useEffect(() => {
    if (state?.phase !== 'Terrain') return
    function onKey(e: KeyboardEvent) {
      if (!canPlaceTerrain) return
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        setTerrainRotation((r) => normalizeRotation(r + 1))
      } else if (e.key === 'q' || e.key === 'Q') {
        e.preventDefault()
        setTerrainRotation((r) => normalizeRotation(r - 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state?.phase, canPlaceTerrain])

  const myTerrainTurn = !!canPlaceTerrain

  const myPlayTurn =
    state?.phase === 'Play' && !!seat && state.activeSeat === seat

  const castableAbilities = useMemo(() => {
    if (!selectedUnit) return []
    const names = [
      ...(selectedUnit.abilities ?? []),
      ...(selectedUnit.ultimate ? [selectedUnit.ultimate] : []),
    ]
    const out: Array<{
      name: string
      def: AbilityDef
      spendLabel: string
      disabled: boolean
      reason?: string
    }> = []
    for (const name of names) {
      const fromCatalog = state?.abilityCatalog?.[name]
      const fromApi = abilityByName.get(name)
      const def: AbilityDef | null = fromCatalog
        ? fromCatalog
        : fromApi
          ? {
              name: fromApi.name,
              type: fromApi.type,
              cost: fromApi.cost,
              costAmount: fromApi.costAmount,
              costResource: fromApi.costResource,
              description: fromApi.description,
              usedBy: fromApi.usedBy,
              cooldown: fromApi.cooldown,
            }
          : null
      if (!def) {
        out.push({
          name,
          def: {
            name,
            type: null,
            cost: null,
            costAmount: null,
            costResource: null,
            description: null,
            usedBy: null,
            cooldown: null,
          },
          spendLabel: '?',
          disabled: true,
          reason: 'Unknown ability',
        })
        continue
      }
      if (isPassiveAbility(def)) continue
      if (!casterMayUseAbility(def, selectedUnit.kind)) continue

      const spend = abilitySpendForCaster(def, selectedUnit.kind)
      let spendLabel = ''
      let disabled = !myPlayTurn || selectedUnit.seat !== seat
      let reason: string | undefined
      if ('error' in spend) {
        disabled = true
        reason = spend.error
        spendLabel = '—'
      } else if (spend.pool === 'none') {
        spendLabel = 'Ultimate'
        if (selectedUnit.ultimateUsed) {
          disabled = true
          reason = 'Ultimate already used'
        }
      } else if (spend.pool === 'commanderAp') {
        spendLabel = `${spend.amount} AP`
        if (!myCommanderPool || myCommanderPool.ap < spend.amount) {
          disabled = true
          reason = 'Not enough AP'
        }
      } else if (spend.pool === 'commanderCc') {
        spendLabel = `${spend.amount} CC`
        if (!myCommanderPool || myCommanderPool.cc < spend.amount) {
          disabled = true
          reason = 'Not enough CC'
        }
      } else {
        spendLabel = `${spend.amount} Co. AP`
        const officerId =
          selectedUnit.kind === 'officer'
            ? selectedUnit.id
            : selectedUnit.kind === 'unit'
              ? (state?.units.find(
                  (u) =>
                    u.seat === selectedUnit.seat &&
                    u.kind === 'officer' &&
                    u.cardId === selectedUnit.officerCardId,
                )?.id ?? state?.activeCompanyOfficerId)
              : state?.activeCompanyOfficerId
        const pool = officerId ? state?.companyPools?.[officerId] : null
        if (!officerId || !pool || pool.ap < spend.amount) {
          disabled = true
          reason = 'Not enough Company AP'
        } else if (
          selectedUnit.kind === 'unit' &&
          state?.activeCompanyOfficerId &&
          state.activeCompanyOfficerId !== officerId
        ) {
          disabled = true
          reason = 'Activate this company'
        }
      }

      const readyAt = selectedUnit.abilityReadyRound?.[name] ?? 0
      if (state && state.round < readyAt) {
        disabled = true
        reason = `Cooldown until R${readyAt}`
      }
      if (
        (name === 'Raise Thrall' || name === 'Raise Host') &&
        selectedUnit.raiseOnceUsed
      ) {
        disabled = true
        reason = 'Already used'
      }
      if (isUltimateAbility(def) && selectedUnit.ultimateUsed) {
        disabled = true
        reason = 'Ultimate already used'
      }

      out.push({ name, def, spendLabel, disabled, reason })
    }
    return out
  }, [
    selectedUnit,
    state,
    abilityByName,
    myPlayTurn,
    seat,
    myCommanderPool,
  ])

  const terrainGhost = useMemo(() => {
    if (
      !state ||
      !seat ||
      state.phase !== 'Terrain' ||
      !canPlaceTerrain ||
      !activeTerrain ||
      !hoverHex
    ) {
      return null
    }
    const shape =
      'shape' in activeTerrain ? activeTerrain.shape : null
    if (!shape) return null
    const kind = activeTerrain.kind
    const cells = expandTerrainPiece(hoverHex, shape, terrainRotation)
    if (isLandStage) {
      const isSmallBridge =
        activeTerrain.sizeClass === 'small' &&
        kind !== 'water' &&
        kind !== 'wall'
      const check = validateTerrainPlacement(cells, {
        boardSize: state.boardSize,
        terrain: state.terrain ?? {},
        objectives: flattenObjectiveHexes(state.objectives),
        kind,
        blockedKeys: foreignCommandRadiusKeys(state, seat),
        allowOverwriteWater: isSmallBridge,
      })
      let valid = check.ok
      if (valid && isImpassableTerrain(kind)) {
        const tentative = { ...(state.terrain ?? {}) }
        for (const c of cells) tentative[hexKey(c.col, c.row)] = kind
        const commanders = Object.values(state.commanders).filter(
          (c): c is { col: number; row: number } => !!c,
        )
        const objectiveHexes = flattenObjectiveHexes(state.objectives)
        if (
          !terrainSetupStayConnected(
            commanders,
            objectiveHexes,
            tentative,
            state.boardSize,
          )
        ) {
          valid = false
        }
      }
      return { cells, kind, valid }
    }
    const ownCr = ownCommandRadiusKeys(state, seat)
    const commander = state.commanders[seat]
    const isSmallBridge =
      activeTerrain.sizeClass === 'small' &&
      kind !== 'water' &&
      kind !== 'wall'
    const check = validateTerrainPlacement(cells, {
      boardSize: state.boardSize,
      terrain: state.terrain ?? {},
      objectives: flattenObjectiveHexes(state.objectives),
      kind,
      requiredKeys: ownCr,
      allowOverwriteWater: isSmallBridge,
    })
    let valid = check.ok
    if (valid && commander) {
      const cmdKey = hexKey(commander.col, commander.row)
      const coversCommander = cells.some(
        (c) => hexKey(c.col, c.row) === cmdKey,
      )
      if (coversCommander && !terrainMayCoverCommander(kind)) {
        valid = false
      } else if (kind === 'water' || kind === 'wall') {
        const tentative = { ...(state.terrain ?? {}) }
        for (const c of cells) tentative[hexKey(c.col, c.row)] = kind
        if (
          !commanderHasEscapePath(commander, tentative, state.boardSize, ownCr)
        ) {
          valid = false
        } else {
          const commanders = Object.values(state.commanders).filter(
            (c): c is { col: number; row: number } => !!c,
          )
          const objectiveHexes = flattenObjectiveHexes(state.objectives)
          if (
            !terrainSetupStayConnected(
              commanders,
              objectiveHexes,
              tentative,
              state.boardSize,
            )
          ) {
            valid = false
          }
        }
      }
    }
    return { cells, kind, valid }
  }, [
    state,
    seat,
    canPlaceTerrain,
    activeTerrain,
    hoverHex,
    terrainRotation,
    isLandStage,
  ])

  const turnBannerText = useMemo(() => {
    if (!state) return null
    if (state.phase === 'Terrain') {
      if (isLandStage && landSize) {
        const name =
          state.players.find((p) => p.seat === state.activeSeat)?.name ??
          state.activeSeat
        const dropsLeft = Math.max(
          0,
          TERRAIN_LAND_DROPS_PER_SIZE - myLandDropsUsed,
        )
        if (state.activeSeat === seat) {
          return `Your turn — ${landSize} land in the middle (${dropsLeft} left; shape → type → place or skip)`
        }
        return `${name}'s turn — ${landSize} battlefield land`
      }
      if (me?.terrainReady) return 'Command zone done — waiting on other players'
      if (myCommandZoneMode === 'flood') {
        return `Flood your CR with one terrain type (${crSlotsTotal} slots via flood)`
      }
      if (heldTerrain) {
        return `Place ${heldTerrain.name} in your CR — or swap or skip`
      }
      const q = myCrProgress.quota
      return `Command zone: ${myCrProgress.done.large}/${q.large} large · ${myCrProgress.done.medium}/${q.medium} medium · ${myCrProgress.done.small}/${q.small} small — pick shape, then type`
    }
    if (state.phase === 'Play') {
      const name =
        state.players.find((p) => p.seat === state.activeSeat)?.name ??
        state.activeSeat
      return state.activeSeat === seat
        ? `Your turn — Round ${state.round}/${MAX_ROUNDS}`
        : `${name}'s turn — Round ${state.round}/${MAX_ROUNDS}`
    }
    return null
  }, [
    state,
    seat,
    me?.terrainReady,
    heldTerrain,
    myCommandZoneMode,
    myCrProgress,
    crSlotsTotal,
    isLandStage,
    landSize,
    myLandDropsUsed,
  ])

  function saveName(v: string) {
    setName(v)
    localStorage.setItem('cw-play-name', v)
  }

  function handleAbandonSavedSession() {
    abandonSavedSession()
    setJoinCode('')
  }

  function handleSaveBoard() {
    if (!state) return
    const file = buildBoardStateFile(state)
    const json = JSON.stringify(file, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = boardStateFileBasename(state.roomCode, state.round)
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function handleLoadBoardClick() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const parsed = JSON.parse(text)
        const result = parseBoardStateFile(parsed)
        if (!result.ok) {
          setError(result.error)
          return
        }
        // Show confirmation dialog
        setPendingLoadState(result.file.state)
        setShowLoadConfirm(true)
      } catch (err) {
        setError(`Failed to load file: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    input.click()
  }

  function confirmLoadBoard() {
    if (!pendingLoadState) return
    setError(null)
    send({ type: 'loadBoardState', state: pendingLoadState })
    setShowLoadConfirm(false)
    setPendingLoadState(null)
  }

  function cancelLoadBoard() {
    setShowLoadConfirm(false)
    setPendingLoadState(null)
  }

  function copyLanUrl(url: string) {
    navigator.clipboard.writeText(url).catch(() => {})
  }

  function renderArmyRosterList(
    roster: ArmyRosterEntry[],
    keyPrefix: string,
  ) {
    return (
      <ul className="deploy-queue army-roster">
        {roster.map((entry) => (
          <li key={`${keyPrefix}-${entry.key}`}>
            <button
              type="button"
              className={
                selectedArmyCardId === entry.cardId ? 'primary' : undefined
              }
              onClick={() => selectArmyEntry(entry)}
            >
              {rosterKindLabel(entry.kind)} {entry.label}
              {entry.count > 1 ? ` ×${entry.count}` : ''}
            </button>
          </li>
        ))}
      </ul>
    )
  }

  function renderPhaseSidebarContent() {
    if (!state) return null
    return (
      <>
        {renderPhaseControls()}

        {myArmyRoster.length > 0 && !buildingArmy ? (
          <>
            <h2>Your army</h2>
            <p className="muted">Click a card to inspect it in the Card panel.</p>
            {renderArmyRosterList(myArmyRoster, 'you')}
          </>
        ) : null}

        {!buildingArmy ? (
          <>
            <h2>Objectives</h2>
            {state.objectiveCardId ? (
              <p className="muted">Card: {state.objectiveCardId}</p>
            ) : (
              <p className="muted">Not drawn yet</p>
            )}
            {state.objectives.map((o) => (
              <div key={o.id} className="muted">
                ({o.col},{o.row}) · {o.hexes?.length ?? 1} hex
                {o.hexes?.length === 1 ? '' : 'es'} — {o.controller ?? 'contested'}
              </div>
            ))}
          </>
        ) : null}

        {error ? <p className="error">{error}</p> : null}
      </>
    )
  }

  function renderRoomPopoutContent() {
    return (
      <>
        {!connected && savedRoom && token ? (
          <div className="disconnect-banner">
            <p className="error" style={{ margin: '0.5rem 0' }}>
              <strong>Connection lost</strong> — Your seat is reserved.
            </p>
            <button
              className="primary"
              onClick={() => {
                setError(null)
                send({
                  type: 'join',
                  roomCode: savedRoom,
                  name: name || savedName || 'Guest',
                  token: token,
                })
              }}
            >
              Rejoin room
            </button>
          </div>
        ) : null}

        {isHost && state.players.length > 0 ? (
          <>
            <h2>Connected players</h2>
            <ul className="player-ip-list">
              {state.players.map((p) => (
                <li key={p.seat}>
                  <span className="player-tooltip-seat">{p.seat}</span>{' '}
                  <span className="player-tooltip-name">{p.name}</span>{' '}
                  <span className="player-tooltip-ip">
                    {playerIps[p.seat] ?? (p.connected ? '…' : 'away')}
                  </span>
                </li>
              ))}
            </ul>
            {yourIp ? (
              <p className="muted player-ip-note">Your connection: {yourIp}</p>
            ) : null}
          </>
        ) : null}

        {(state.phase === 'Lobby' || state.phase === 'ArmyBuild') ? (
          <div className="lobby-pool-panel">
            <h2>Loadout pools</h2>
            <p className="muted">
              {canEditLoadoutPools
                ? 'Host can change deploy/reserve caps until armies leave Lobby/Army Build.'
                : 'Room force-select budgets (set by host).'}
            </p>
            <div className="lobby-pool-fields">
              <div className="field">
                <label htmlFor="room-deploy-max">Deploy UV max</label>
                <input
                  id="room-deploy-max"
                  type="number"
                  min={1}
                  max={999}
                  value={roomPools.deployMax}
                  disabled={!canEditLoadoutPools || !connected}
                  onChange={(e) => {
                    if (!canEditLoadoutPools) return
                    const n = Math.max(1, Number(e.target.value) || 1)
                    send({
                      type: 'setLoadoutPools',
                      loadoutPools: { deployMax: n },
                    })
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="room-reserve-max">Reserve UV max</label>
                <input
                  id="room-reserve-max"
                  type="number"
                  min={0}
                  max={999}
                  value={roomPools.reserveMax}
                  disabled={!canEditLoadoutPools || !connected}
                  onChange={(e) => {
                    if (!canEditLoadoutPools) return
                    const n = Math.max(0, Number(e.target.value) || 0)
                    send({
                      type: 'setLoadoutPools',
                      loadoutPools: { reserveMax: n },
                    })
                  }}
                />
              </div>
            </div>
            <p className="muted lobby-mode-hint">
              Unused has no hard cap. Under-filling deploy/reserve is allowed.
            </p>
          </div>
        ) : null}

        {(state.phase === 'Lobby' || state.phase === 'ArmyBuild') && me?.armyReady && (
          <>
            {showForceStart ? (
              <div className="row" style={{ marginBottom: '0.75rem' }}>
                <button
                  type="button"
                  className="primary"
                  disabled={!forceStartGate.ok}
                  title={forceStartGate.ok ? undefined : forceStartGate.error}
                  onClick={() => send({ type: 'forceStart' })}
                >
                  Force start ({state.players.length}/{state.maxPlayers} players)
                </button>
                {!forceStartGate.ok ? (
                  <span className="muted">{forceStartGate.error}</span>
                ) : null}
              </div>
            ) : null}
            <h2>Army locked</h2>
            <p className="muted">
              {me.armySummary} ({me.armyUv} UV). Waiting for other players…
            </p>
          </>
        )}

        {showRightInspectPanel ? (
          <p className="muted">
            Phase controls and your army list are in the left sidebar.
          </p>
        ) : (
          renderPhaseSidebarContent()
        )}

        {opponentRosters.length > 0 ? (
          <>
            <h2>Opponent armies</h2>
            {opponentRosters.map(({ seat: oppSeat, name, roster }) => (
              <div key={oppSeat} className="opponent-roster">
                <p className="muted">
                  {oppSeat} — {name}
                </p>
                {renderArmyRosterList(roster, oppSeat)}
              </div>
            ))}
          </>
        ) : null}
      </>
    )
  }

  function renderPhaseControls() {
    const forceStartBtn = showForceStart ? (
      <div className="row" style={{ marginBottom: '0.75rem' }}>
        <button
          type="button"
          className="primary"
          disabled={!forceStartGate.ok}
          title={forceStartGate.ok ? undefined : forceStartGate.error}
          onClick={() => send({ type: 'forceStart' })}
        >
          Force start ({state.players.length}/{state.maxPlayers} players)
        </button>
        {!forceStartGate.ok ? (
          <span className="muted">{forceStartGate.error}</span>
        ) : null}
      </div>
    ) : null

    if (state.phase === 'Commanders') {
      return (
        <>
          {forceStartBtn}
          <h2>Commanders</h2>
          <button
            className="primary"
            disabled={me?.commanderReady || !me?.armyReady}
            onClick={() => send({ type: 'readyCommander' })}
          >
            {me?.commanderReady ? 'Commander ready' : 'Confirm commander'}
          </button>
          <p className="muted">
            Places you on the edge mid-hex. When everyone is ready, objectives
            draw and force selection begins.
          </p>
        </>
      )
    }

    if (state.phase === 'ForceSelect') {
      return (
        <>
          {forceStartBtn}
          <h2>Force selection</h2>
          {me?.forceSelectReady ? (
            <p className="muted">
              You confirmed your loadout. Opponent bucket choices stay hidden.
            </p>
          ) : (
            <p className="muted">
              Assign companies to deploy / reserve / flex in the main panel.
            </p>
          )}
          <ul className="force-status-list compact">
            {state.players.map((p) => (
              <li key={p.seat}>
                {p.seat === seat ? 'You' : `${p.seat} — ${p.name}`}:{' '}
                {p.forceSelectReady ? 'Confirmed' : 'Choosing…'}
              </li>
            ))}
          </ul>
        </>
      )
    }

    if (state.phase === 'Terrain' && state.terrainStage === 'commandZone') {
      const quota = myCrProgress.quota
      const quotaLabel = [
        quota.large > 0 ? `${quota.large} large` : null,
        quota.medium > 0 ? `${quota.medium} medium` : null,
        `${quota.small} small`,
      ]
        .filter(Boolean)
        .join(' + ')
      const modeLocked = myTerrainHand.some(
        (q) => q.placed || q.skipped || q.flooded,
      )
      return (
        <>
          <h2>Command zone terrain</h2>
          {me?.terrainReady ? (
            <p className="muted">Waiting for other players…</p>
          ) : (
            <>
              <p className="muted">
                Flood your entire CR with one terrain type, or place{' '}
                {quotaLabel} inside your CR ({state.maxPlayers}P quota).
                Same-kind overlap OK · different kinds block · small land may
                bridge water. Water is small-only. Water/Wall may not seal you
                in or cut anyone off from objectives. Water cap: {waterHexes}/
                {WATER_HEX_CAP}.
              </p>
              {!myCommandZoneMode && !modeLocked ? (
                <>
                  <h3>Choose setup</h3>
                  <div className="row">
                    <button
                      type="button"
                      className="primary"
                      onClick={() =>
                        send({ type: 'chooseCommandZoneMode', mode: 'flood' })
                      }
                    >
                      Flood CR (one terrain type)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        send({ type: 'chooseCommandZoneMode', mode: 'pieces' })
                      }
                    >
                      Place pieces ({quotaLabel})
                    </button>
                  </div>
                </>
              ) : null}
              {myCommandZoneMode === 'flood' && !myTerrainHand.some((q) => q.flooded) ? (
                <>
                  <h3>Flood terrain type</h3>
                  <div className="row wrap">
                    {FLOOD_TERRAIN_KINDS.map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        className={floodKind === kind ? 'primary' : undefined}
                        onClick={() => setFloodKind(kind)}
                      >
                        {kind}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="primary"
                    onClick={() =>
                      send({ type: 'floodCommandZone', kind: floodKind })
                    }
                  >
                    Flood my CR with {floodKind}
                  </button>
                </>
              ) : null}
              {myCommandZoneMode === 'pieces' ? (
                <>
                  <p className="pill">
                    Large {myCrProgress.done.large}/{quota.large} · Medium{' '}
                    {myCrProgress.done.medium}/{quota.medium} · Small{' '}
                    {myCrProgress.done.small}/{quota.small}
                  </p>
                  <div className="row">
                    <button
                      type="button"
                      disabled={!canSkipCommandZone}
                      onClick={() => send({ type: 'skipTerrain' })}
                    >
                      Skip held piece
                    </button>
                  </div>
                  {!heldTerrain ? (
                    <>
                      {nextCrSize === 'small' ? (
                        <>
                          <h3>Pick a small piece</h3>
                          <ul className="deploy-queue terrain-shape-grid">
                            {smallTerrainPieceCatalog().map((def) => {
                              const waterDisabled =
                                def.kind === 'water' && !waterOk
                              const sizeFull =
                                myCrProgress.used.small >= quota.small
                              return (
                                <li key={def.id}>
                                  <button
                                    type="button"
                                    className="terrain-pick"
                                    disabled={waterDisabled || sizeFull}
                                    onClick={() =>
                                      send({
                                        type: 'pickTerrain',
                                        pieceId: def.id,
                                      })
                                    }
                                  >
                                    <TerrainShapePreview
                                      shape={def.shape}
                                      kind={def.kind}
                                    />
                                    <span className="terrain-pick-label">
                                      {def.name} · {def.shape.length} hex
                                      {sizeFull ? ' · quota full' : ''}
                                      {waterDisabled ? ' · water cap' : ''}
                                    </span>
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        </>
                      ) : terrainPickStep === 'shape' ? (
                        <>
                          <h3>
                            1. Pick a {nextCrSize} shape ({nextCrSize} slot)
                          </h3>
                          <ul className="deploy-queue terrain-shape-grid">
                            {shapeCatalog.map((sil) => (
                              <li key={sil.key}>
                                <button
                                  type="button"
                                  className="terrain-pick"
                                  onClick={() => {
                                    setTerrainPickShapeKey(sil.key)
                                    setTerrainPickKind(null)
                                    setTerrainPickStep('kind')
                                  }}
                                >
                                  <TerrainShapePreview
                                    shape={sil.shape}
                                    kind="plains"
                                  />
                                  <span className="terrain-pick-label">
                                    {sil.title} · {sil.shape.length} hex
                                  </span>
                                </button>
                              </li>
                            ))}
                            {nextCrSize === 'medium'
                              ? smallTerrainPieceCatalog()
                                  .filter((p) => p.sizeClass === 'medium')
                                  .map((def) => {
                                    const sizeFull =
                                      myCrProgress.used.medium >= quota.medium
                                    return (
                                      <li key={def.id}>
                                        <button
                                          type="button"
                                          className="terrain-pick"
                                          disabled={sizeFull}
                                          onClick={() =>
                                            send({
                                              type: 'pickTerrain',
                                              pieceId: def.id,
                                            })
                                          }
                                        >
                                          <TerrainShapePreview
                                            shape={def.shape}
                                            kind={def.kind}
                                          />
                                          <span className="terrain-pick-label">
                                            {def.name}
                                            {sizeFull ? ' · quota full' : ''}
                                          </span>
                                        </button>
                                      </li>
                                    )
                                  })
                              : null}
                          </ul>
                        </>
                      ) : (
                        <>
                          <h3>2. Pick terrain type</h3>
                          <button
                            type="button"
                            className="linkish"
                            onClick={() => {
                              setTerrainPickStep('shape')
                              setTerrainPickKind(null)
                            }}
                          >
                            ← Back to shapes
                          </button>
                          <div className="row wrap terrain-kind-row">
                            {kindsForShapeSize(nextCrSize ?? 'medium').map(
                              (kind) => {
                                const def = buildTerrainPiece(
                                  terrainPickShapeKey!,
                                  kind,
                                  nextCrSize!,
                                )
                                if (!def) return null
                                const waterDisabled =
                                  kind === 'water' && !waterOk
                                const sizeFull =
                                  myCrProgress.used[def.sizeClass] >=
                                  quota[def.sizeClass]
                                return (
                                  <button
                                    key={kind}
                                    type="button"
                                    className={
                                      terrainPickKind === kind
                                        ? 'primary'
                                        : undefined
                                    }
                                    disabled={waterDisabled || sizeFull}
                                    onClick={() => {
                                      setTerrainPickKind(kind)
                                      send({
                                        type: 'pickTerrain',
                                        pieceId: def.id,
                                      })
                                      setTerrainPickShapeKey(null)
                                      setTerrainPickKind(null)
                                      setTerrainPickStep('shape')
                                    }}
                                  >
                                    {kind}
                                    {waterDisabled ? ' (cap)' : ''}
                                    {sizeFull ? ' (full)' : ''}
                                  </button>
                                )
                              },
                            )}
                          </div>
                        </>
                      )}
                    </>
                  ) : null}
                  {heldTerrain && heldTerrainIndex >= 0 ? (
                    <>
                      <div className="row">
                        <button
                          type="button"
                          disabled={!canPlaceCommandZone}
                          onClick={() =>
                            setTerrainRotation((r) => normalizeRotation(r - 1))
                          }
                        >
                          ↺ Q
                        </button>
                        <span className="pill">Rot {terrainRotation} / 6</span>
                        <button
                          type="button"
                          disabled={!canPlaceCommandZone}
                          onClick={() =>
                            setTerrainRotation((r) => normalizeRotation(r + 1))
                          }
                        >
                          R ↻
                        </button>
                      </div>
                      {activeBlockedByWaterCap ? (
                        <p className="error">
                          Water cap reached — put this piece back or skip it.
                        </p>
                      ) : null}
                      <ul className="deploy-queue">
                        <li key={heldTerrain.instanceId}>
                          <button
                            type="button"
                            className="terrain-pick primary"
                            onClick={() =>
                              send({
                                type: 'unpickTerrain',
                                handIndex: heldTerrainIndex,
                              })
                            }
                          >
                            <TerrainShapePreview
                              shape={heldTerrain.shape}
                              kind={heldTerrain.kind}
                              rotation={terrainRotation}
                            />
                            <span className="terrain-pick-label">
                              → {heldTerrain.name} — click to put back
                            </span>
                          </button>
                        </li>
                      </ul>
                      <p className="muted">
                        Hover your CR and click to place. Small land may bridge
                        water. Ghost turns red on invalid placement.
                      </p>
                    </>
                  ) : null}
                  {(placedTerrainCount > 0 ||
                    myTerrainHand.some((item) => item.skipped)) && (
                    <ul className="deploy-queue">
                      {myTerrainHand
                        .filter((item) => item.placed || item.skipped)
                        .map((item) => (
                          <li key={item.instanceId}>
                            <span className="terrain-pick-label">
                              {item.skipped
                                ? `⊘ Skipped ${item.sizeClass}`
                                : `✓ ${item.name}`}
                            </span>
                          </li>
                        ))}
                    </ul>
                  )}
                </>
              ) : null}
              {myTerrainHand.some((q) => q.flooded) ? (
                <p className="muted">✓ CR flood-filled — waiting on others…</p>
              ) : null}
            </>
          )}
        </>
      )
    }

    if (state.phase === 'Terrain' && isLandStage && landSize) {
      const activeName =
        state.players.find((p) => p.seat === state.activeSeat)?.name ??
        state.activeSeat
      const dropsLeft = Math.max(
        0,
        TERRAIN_LAND_DROPS_PER_SIZE - myLandDropsUsed,
      )
      const myTurn = state.activeSeat === seat
      return (
        <>
          <h2>Battlefield land — {landSize}</h2>
          <p className="muted">
            Place {landSize} terrain in the middle of the board (outside all
            command radii). Each player gets {TERRAIN_LAND_DROPS_PER_SIZE}{' '}
            place-or-skip turns per size tier. Pick shape, then type, then click
            the board. Water cap: {waterHexes}/{WATER_HEX_CAP} (new water only
            while under cap; a piece may exceed it). Water must not disconnect
            commanders or objectives.
          </p>
          <p className="pill">
            Active: {activeName} · {dropsLeft} drop{dropsLeft === 1 ? '' : 's'}{' '}
            left this tier
          </p>
          {!myTurn ? (
            <p className="muted">Waiting for {activeName}…</p>
          ) : (
            <>
              <div className="row">
                <button
                  type="button"
                  disabled={!canSkipLand}
                  onClick={() => send({ type: 'skipTerrain' })}
                >
                  Skip this land drop
                </button>
              </div>
              {landSize === 'small' ? (
                <>
                  <h3>Pick a small piece</h3>
                  <ul className="deploy-queue terrain-shape-grid">
                    {smallTerrainPieceCatalog().map((def) => (
                      <li key={def.id}>
                        <button
                          type="button"
                          className={
                            selectedLandPiece?.id === def.id
                              ? 'terrain-pick primary'
                              : 'terrain-pick'
                          }
                          disabled={def.kind === 'water' && !waterOk}
                          onClick={() => {
                            setTerrainPickShapeKey(def.id)
                            setTerrainPickKind(def.kind)
                          }}
                        >
                          <TerrainShapePreview
                            shape={def.shape}
                            kind={def.kind}
                          />
                          <span className="terrain-pick-label">{def.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : terrainPickStep === 'shape' ? (
                <>
                  <h3>1. Pick a {landSize} shape</h3>
                  <ul className="deploy-queue terrain-shape-grid">
                    {landShapeCatalog.map((sil) => (
                      <li key={sil.key}>
                        <button
                          type="button"
                          className="terrain-pick"
                          onClick={() => {
                            setTerrainPickShapeKey(sil.key)
                            setTerrainPickKind(null)
                            setTerrainPickStep('kind')
                          }}
                        >
                          <TerrainShapePreview
                            shape={sil.shape}
                            kind="plains"
                          />
                          <span className="terrain-pick-label">
                            {sil.title} · {sil.shape.length} hex
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <h3>2. Pick terrain type</h3>
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => {
                      setTerrainPickStep('shape')
                      setTerrainPickKind(null)
                    }}
                  >
                    ← Back to shapes
                  </button>
                  <div className="row wrap terrain-kind-row">
                    {kindsForShapeSize(landSize, { battlefield: true }).map(
                      (kind) => {
                        const waterDisabled = kind === 'water' && !waterOk
                        return (
                          <button
                            key={kind}
                            type="button"
                            className={
                              terrainPickKind === kind ? 'primary' : undefined
                            }
                            disabled={waterDisabled}
                            onClick={() => setTerrainPickKind(kind)}
                          >
                            {kind}
                            {waterDisabled ? ' (cap)' : ''}
                          </button>
                        )
                      },
                    )}
                  </div>
                </>
              )}
              {landBlockedByWaterCap ? (
                <p className="error">
                  Water cap reached — pick a different type or skip this drop.
                </p>
              ) : null}
              {selectedLandPiece ? (
                <>
                  <div className="row">
                    <button
                      type="button"
                      disabled={!canPlaceLand}
                      onClick={() =>
                        setTerrainRotation((r) => normalizeRotation(r - 1))
                      }
                    >
                      ↺ Q
                    </button>
                    <span className="pill">Rot {terrainRotation} / 6</span>
                    <button
                      type="button"
                      disabled={!canPlaceLand}
                      onClick={() =>
                        setTerrainRotation((r) => normalizeRotation(r + 1))
                      }
                    >
                      R ↻
                    </button>
                  </div>
                  <p className="muted">
                    Placing: {selectedLandPiece.name} — click the battlefield
                    (ghost shows valid placement).
                  </p>
                </>
              ) : null}
            </>
          )}
        </>
      )
    }

    if (state.phase === 'Deploy') {
      return (
        <>
          <h2>Deploy army</h2>
          <p className="muted">
            Officers: inside your Command Radius. Units: inside that officer's
            Command Radius. Remaining:{' '}
            {myQueue.filter((q) => !q.placed).length}
          </p>
          <ul className="deploy-queue">
            {myQueue.map((item, i) => {
              const card = cardsById.get(item.cardId)
              const isActive = i === activeIndex && !item.placed
              return (
                <li key={`${item.cardId}-${i}`}>
                  <button
                    type="button"
                    className={isActive ? 'primary deploy-item-active' : undefined}
                    disabled={item.placed || !!me?.deployDone}
                    onClick={() => {
                      setQueueIndex(i)
                      setSelectedArmyCardId(item.cardId)
                    }}
                  >
                    <span className="deploy-item-name">
                      {item.placed ? '✓' : i === activeIndex ? '→' : '·'}{' '}
                      {item.kind === 'officer' ? 'O' : 'U'} {item.cardName}
                    </span>
                    {card && isActive && (
                      <span className="deploy-item-stats">
                        M{card.move ?? '—'} D{card.damage ?? '—'} R{card.range ?? '—'} T{card.toughness ?? '—'}
                        {item.kind === 'officer' && card.commandRadius ? ` CR${card.commandRadius}` : ''}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
          {activeDeployItem && cardsById.get(activeDeployItem.cardId) && (
            <div className="deploy-selected-stats">
              <h3>Deploying: {activeDeployItem.cardName}</h3>
              {(() => {
                const card = cardsById.get(activeDeployItem.cardId)
                if (!card) return null
                return (
                  <div className="stat-tracker">
                    <div className="stat-row"><span>Move</span><strong>{card.move ?? '—'}</strong></div>
                    <div className="stat-row"><span>Damage</span><strong>{card.damage ?? '—'}</strong></div>
                    <div className="stat-row"><span>Range</span><strong>{card.range ?? '—'}</strong></div>
                    <div className="stat-row"><span>Toughness</span><strong>{card.toughness ?? '—'}</strong></div>
                    {activeDeployItem.kind === 'officer' && (
                      <>
                        <div className="stat-row"><span>Cmd Radius</span><strong>{card.commandRadius ?? '—'}</strong></div>
                        <div className="stat-row"><span>Company AP</span><strong>{card.companyAp ?? '—'}</strong></div>
                      </>
                    )}
                    {card.keywords?.length ? (
                      <div className="stat-row keywords-row"><span>Keywords</span><strong>{card.keywords.join(', ')}</strong></div>
                    ) : null}
                  </div>
                )
              })()}
            </div>
          )}
          <button
            className="primary"
            disabled={
              !!me?.deployDone ||
              myQueue.some((q) => !q.placed) ||
              !myQueue.length
            }
            onClick={() => send({ type: 'confirmDeploy' })}
          >
            Confirm deploy
          </button>
          <p className="muted">
            Highlighted hexes are legal for the selected piece. Stay ≥5 hexes
            from objective zones.
          </p>
        </>
      )
    }

    if (state.phase === 'Play') {
      return (
        <>
          <h2>
            Play · Round {state.round}/{MAX_ROUNDS}
          </h2>
          <p>
            Active: <strong>{state.activeSeat}</strong>
            {myPlayTurn ? ' (you)' : ''}
          </p>
          <div className="stat-tracker">
            <div className="stat-tracker-name">Victory points</div>
            {state.players.map((p) => (
              <div key={p.seat} className="stat-row">
                <span>
                  {p.seat}
                  {p.seat === seat ? ' (you)' : ''}
                  {p.isAi ? ' · AI' : ''}
                </span>
                <strong>{state.scores?.[p.seat] ?? 0}</strong>
              </div>
            ))}
            <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.35rem' }}>
              +{VP_PER_OBJECTIVE} VP per held objective at end of each round.
              Highest VP after {MAX_ROUNDS} rounds wins.
            </p>
          </div>
          <div className="stat-tracker">
            <div className="stat-tracker-name">Your pools</div>
            <div className="stat-row">
              <span>Commander AP</span>
              <strong>
                {myCommanderPool
                  ? `${myCommanderPool.ap}/${myCommanderPool.apMax}`
                  : '—'}
              </strong>
            </div>
            <div className="stat-row">
              <span>Commander CC</span>
              <strong>
                {myCommanderPool
                  ? `${myCommanderPool.cc}/${myCommanderPool.ccMax}`
                  : '—'}
              </strong>
            </div>
            <div className="stat-row">
              <span>Company AP</span>
              <strong>
                {companyPool
                  ? `${companyPool.ap}/${companyPool.apMax}`
                  : '—'}
              </strong>
            </div>
          </div>
          {state.activeCompanyOfficerId ? (
          <p className="muted">
            Company active:{' '}
            {state.units.find((u) => u.id === state.activeCompanyOfficerId)
              ?.cardName ?? '—'}
          </p>
        ) : (
          <p className="muted">
            Activate one company per turn to move its units (each officer once
            per round), or activate your commander (once per round). Spend AP/CC
            to move them. Spend AP/CC, then <strong>Resolve attack</strong>{' '}
            (auto) or use manual roll/damage below. Scout units count as in CR up to
            +{SCOUT_CR_EXTENSION} hexes beyond their officer. You may move past printed
            Move for Harass/Trample — a warning appears when you do.
          </p>
        )}
          {state.lastCombatResult ? (
            <CombatResultBanner result={state.lastCombatResult} />
          ) : null}
          {state.lastDiceRoll ? (
            <p className="dice-result">
              Last roll ({state.lastDiceRoll.seat}):{' '}
              <strong>
                {state.lastDiceRoll.count}d{state.lastDiceRoll.sides} [
                {state.lastDiceRoll.results.join(', ')}]
                {state.lastDiceRoll.count > 1
                  ? ` = ${state.lastDiceRoll.total}`
                  : ''}
              </strong>
              {state.lastDiceRoll.note
                ? ` — ${state.lastDiceRoll.note}`
                : ''}
            </p>
          ) : null}
          <div className="row">
            <button
              className="primary"
              disabled={!myPlayTurn}
              onClick={() => send({ type: 'endTurn' })}
            >
              End turn
            </button>
          </div>

          <div className="graves-panel">
            <h2>Graves ({state.deaths?.length ?? 0})</h2>
            {!state.deaths?.length ? (
              <p className="muted">No fallen units yet.</p>
            ) : (
              <ul className="grave-list">
                {[...(state.deaths ?? [])].reverse().map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      className={[
                        'grave-row',
                        selectedDeathId === d.id ? 'grave-row-selected' : '',
                        `grave-seat-${d.seat}`,
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => {
                        setSelectedUnitId(null)
                        setSelectedArmyCardId(d.cardId)
                        setSelectedDeathId((prev) =>
                          prev === d.id ? null : d.id,
                        )
                        setReviveAtClickMode(false)
                      }}
                    >
                      <span className="grave-name">{d.cardName}</span>
                      <span className="grave-meta">
                        {d.seat} @ {d.col},{d.row} · R{d.round}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {selectedDeath ? (
              <div className="grave-actions">
                <p className="muted">
                  Selected: {selectedDeath.cardName} ({selectedDeath.seat}) @{' '}
                  {selectedDeath.col},{selectedDeath.row}
                </p>
                <div className="row wrap">
                  <button
                    type="button"
                    disabled={
                      !myPlayTurn ||
                      selectedDeath.seat !== seat ||
                      state.units.some(
                        (u) =>
                          u.col === selectedDeath.col &&
                          u.row === selectedDeath.row,
                      )
                    }
                    onClick={() => {
                      send({
                        type: 'reviveFromGrave',
                        deathId: selectedDeath.id,
                        col: selectedDeath.col,
                        row: selectedDeath.row,
                        toughness: 1,
                      })
                      setSelectedDeathId(null)
                      setReviveAtClickMode(false)
                    }}
                  >
                    Revive here
                  </button>
                  <button
                    type="button"
                    className={reviveAtClickMode ? 'primary' : undefined}
                    disabled={!myPlayTurn || selectedDeath.seat !== seat}
                    onClick={() => setReviveAtClickMode((v) => !v)}
                  >
                    {reviveAtClickMode
                      ? 'Click empty hex…'
                      : 'Revive at click'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </>
      )
    }

    if (state.phase === 'Ended') {
      const scoreLine = state.players
        .map((p) => `${p.seat} ${state.scores?.[p.seat] ?? 0}`)
        .join(' · ')
      return (
        <>
          <h2>Game over</h2>
          {state.draw ? (
            <p>
              <strong>Draw</strong> after {MAX_ROUNDS} rounds.
            </p>
          ) : (
            <p>
              Winner: <strong>{state.winner}</strong>
            </p>
          )}
          <p className="muted">Final VP: {scoreLine || '—'}</p>
        </>
      )
    }

    return null
  }

  if ((!state || !seat) && lobbyView === 'armyWorkshop') {
    return (
      <div className="army-workshop-page">
        <header className="army-workshop-bar">
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setLobbyView('lobby')
              setWorkshopNotice(null)
            }}
          >
            ← Back to lobby
          </button>
          <span className="army-workshop-title">Army workshop</span>
          {workshopNotice ? (
            <span className="status-ok army-workshop-notice">{workshopNotice}</span>
          ) : (
            <span className="muted army-workshop-hint">
              Export JSON or save here — no room required
            </span>
          )}
        </header>
        <ArmyBuilder
          workshopMode
          submitLabel="Save army"
          enforceCommanderRace={enforceCommanderRace}
          onSubmit={() =>
            setWorkshopNotice('Army saved in this browser. Export JSON anytime.')
          }
        />
      </div>
    )
  }

  if (!state || !seat) {
    return (
      <div className="lobby-page">
        <aside className="lobby-info-panel">
          <h2>Play on same Wi‑Fi</h2>
          <ol className="muted lobby-info-steps">
            <li>Run <code>npm run dev:play</code> on this PC.</li>
            <li>
              Friend opens your LAN URL (terminal shows{' '}
              <code>Network: http://192.168.x.x:5175</code>), not localhost.
            </li>
            <li>Create a room, share the code; they join with it.</li>
          </ol>
          {lanUrls[0] &&
          !lanUrls[0].includes('127.0.0.1') &&
          !lanUrls[0].includes('localhost') ? (
            <div className="lobby-url-row">
              <code className="lobby-url">{lanUrls[0]}</code>
              <button
                type="button"
                className="lobby-copy-btn"
                onClick={() => copyLanUrl(lanUrls[0]!)}
                title="Copy URL"
              >
                Copy
              </button>
            </div>
          ) : (
            <p className="muted">
              On localhost? Check the Vite terminal for the{' '}
              <code>Network</code> address to share.
            </p>
          )}
          <p className="muted lobby-info-meta">
            2 players · N vs S · 31×31 board
            <br />
            4 players · N/W/S/E · 35×35 board
          </p>
          <p className={connected ? 'status-ok' : 'status-bad'}>
            {connected ? 'Play server connected' : 'Connecting to play server…'}
          </p>
        </aside>

        <main className="lobby-card">
          <h1>Command Warfare — Play</h1>
          <p className="muted lobby-tagline">
            Build an army · create or join a room
          </p>

          {savedRoom && savedSeat && token ? (
            <div className="rejoin-prompt">
              <h2>Resume previous session</h2>
              <p>
                You were playing as <strong>{savedSeat}</strong> in room{' '}
                <strong>{savedRoom}</strong>.
              </p>
              <div className="row">
                <button
                  className="primary"
                  disabled={!connected}
                  onClick={() => {
                    setError(null)
                    send({
                      type: 'join',
                      roomCode: savedRoom,
                      name: name || savedName || 'Guest',
                      token: token,
                    })
                  }}
                >
                  Rejoin {savedRoom}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleAbandonSavedSession()
                    setError(null)
                  }}
                >
                  Start fresh
                </button>
              </div>
              <hr className="lobby-divider" />
              <p className="muted">Or start a new game below:</p>
            </div>
          ) : null}

          <section className="lobby-section">
            <div className="field">
              <label>Display name</label>
              <input
                value={name}
                onChange={(e) => saveName(e.target.value)}
                placeholder="Commander"
              />
            </div>
            <div className="field">
              <label>Game mode</label>
              <select
                value={opponentMode}
                onChange={(e) => {
                  const mode = e.target.value as 'human' | 'ai'
                  setOpponentMode(mode)
                  if (mode === 'ai') setMaxPlayers(2)
                }}
              >
                <option value="human">vs Human</option>
                <option value="ai">vs AI</option>
              </select>
            </div>
            {opponentMode === 'ai' ? (
              <div className="field">
                <label>AI difficulty</label>
                <select
                  value={aiDifficulty}
                  onChange={(e) =>
                    setAiDifficulty(
                      e.target.value as 'easy' | 'medium' | 'hard',
                    )
                  }
                >
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
                <p className="muted lobby-mode-hint">
                  Creates a 2-player room and fills the second seat with a CPU.
                </p>
              </div>
            ) : (
              <div className="field">
                <label>Max players</label>
                <select
                  value={maxPlayers}
                  onChange={(e) =>
                    setMaxPlayers(Number(e.target.value) as 2 | 4)
                  }
                >
                  <option value={2}>2</option>
                  <option value={4}>4</option>
                </select>
              </div>
            )}
            <label className="check-field">
              <input
                type="checkbox"
                checked={enforceCommanderRace}
                onChange={(e) => {
                  const on = e.target.checked
                  setEnforceCommanderRace(on)
                  localStorage.setItem('cw-play-enforce-commander-race', on ? '1' : '0')
                }}
              />
              <span>
                Enforce mono-race armies (officers &amp; units must match the
                commander&apos;s race)
              </span>
            </label>
            <div className="lobby-pool-fields">
              <div className="field">
                <label htmlFor="lobby-deploy-max">Deploy UV max</label>
                <input
                  id="lobby-deploy-max"
                  type="number"
                  min={1}
                  max={999}
                  value={createDeployMax}
                  onChange={(e) =>
                    setCreateDeployMax(Math.max(1, Number(e.target.value) || 1))
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="lobby-reserve-max">Reserve UV max</label>
                <input
                  id="lobby-reserve-max"
                  type="number"
                  min={0}
                  max={999}
                  value={createReserveMax}
                  onChange={(e) =>
                    setCreateReserveMax(Math.max(0, Number(e.target.value) || 0))
                  }
                />
              </div>
            </div>
            <p className="muted lobby-mode-hint">
              Force-select budgets for this room (defaults {DEPLOY_UV_MAX}/{RESERVE_UV_MAX}).
              Unused has no hard cap — under-filling is allowed.
            </p>
          </section>

          <section className="lobby-section">
            <div className="lobby-room-row">
              <div className="lobby-room-group">
                <label htmlFor="lobby-create-code">Create room</label>
                <div className="lobby-room-controls">
                  <input
                    id="lobby-create-code"
                    className="lobby-room-code"
                    value={createRoomCode}
                    onChange={(e) => setCreateRoomCode(e.target.value.toUpperCase())}
                    placeholder="Random"
                    title="Leave blank for a random code"
                    maxLength={6}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="primary"
                    disabled={!connected}
                    onClick={() => {
                      setError(null)
                      handleAbandonSavedSession()
                      const custom = createRoomCode.trim()
                      send({
                        type: 'create',
                        name: name || 'Host',
                        maxPlayers: opponentMode === 'ai' ? 2 : maxPlayers,
                        enforceCommanderRace,
                        opponent: opponentMode,
                        loadoutPools: {
                          deployMax: createDeployMax,
                          reserveMax: createReserveMax,
                        },
                        ...(opponentMode === 'ai'
                          ? { aiDifficulty }
                          : {}),
                        ...(custom ? { roomCode: custom } : {}),
                      })
                    }}
                  >
                    Create
                  </button>
                </div>
              </div>
              <div className="lobby-room-group">
                <label htmlFor="lobby-join-code">Join room</label>
                <div className="lobby-room-controls">
                  <input
                    id="lobby-join-code"
                    className="lobby-room-code"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="ABC123"
                    maxLength={6}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    disabled={!connected || joinCode.trim().length < 4}
                    onClick={() => {
                      setError(null)
                      send({
                        type: 'join',
                        roomCode: joinCode.trim(),
                        name: name || 'Guest',
                        token: token ?? undefined,
                      })
                    }}
                  >
                    Join
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="lobby-section">
            <button
              type="button"
              className="lobby-action-btn"
              onClick={() => {
                setWorkshopNotice(null)
                setLobbyView('armyWorkshop')
              }}
            >
              Create/Edit Army
            </button>
          </section>

          {error ? <p className="error">{error}</p> : null}
        </main>
      </div>
    )
  }

  function onHexClick(col: number, row: number) {
    if (!state) return
    setError(null)
    if (state.phase === 'Terrain') {
      if (canPlaceLand && selectedLandPiece) {
        send({
          type: 'placeTerrain',
          col,
          row,
          rotation: terrainRotation,
          pieceId: selectedLandPiece.id,
        })
        setTerrainPickShapeKey(null)
        setTerrainPickKind(null)
        setTerrainPickStep('shape')
        return
      }
      if (!canPlaceCommandZone || !heldTerrain || heldTerrainIndex < 0) return
      send({
        type: 'placeTerrain',
        col,
        row,
        rotation: terrainRotation,
        handIndex: heldTerrainIndex,
      })
      return
    }
    if (state.phase === 'Deploy') {
      const idx =
        myQueue[activeIndex] && !myQueue[activeIndex]!.placed
          ? activeIndex
          : nextUnplaced
      if (idx < 0) return
      send({ type: 'deploy', queueIndex: idx, col, row })
      return
    }
    if (state.phase === 'Play') {
      const here = state.units.find((u) => u.col === col && u.row === row)
      const deathsHere = (state.deaths ?? []).filter(
        (d) => d.col === col && d.row === row,
      )
      if (aimMode) {
        if (here) {
          setTargetUnitId(here.id)
          setAimMode(false)
        }
        return
      }
      if (
        reviveAtClickMode &&
        selectedDeathId &&
        !here &&
        myPlayTurn &&
        selectedDeath?.seat === seat
      ) {
        send({
          type: 'reviveFromGrave',
          deathId: selectedDeathId,
          col,
          row,
          toughness: 1,
        })
        setReviveAtClickMode(false)
        setSelectedDeathId(null)
        return
      }
      if (here) {
        setSelectedDeathId(null)
        setReviveAtClickMode(false)
        setSelectedUnitId((prev) => {
          const next = prev === here.id ? null : here.id
          if (next) setSelectedArmyCardId(here.cardId)
          return next
        })
        return
      }
      if (deathsHere.length) {
        const mostRecent = deathsHere[deathsHere.length - 1]!
        setSelectedUnitId(null)
        setSelectedDeathId((prev) =>
          prev === mostRecent.id ? null : mostRecent.id,
        )
        return
      }
      if (selectedUnitId && myPlayTurn) {
        send({ type: 'move', unitId: selectedUnitId, col, row })
      }
    }
  }

  function submitArmy(army: ArmyList, cards: CardSnapshot[]) {
    setError(null)
    send({ type: 'submitArmy', army, cards })
  }

  function confirmForceSelect(loadout: BattleLoadout) {
    setError(null)
    send({ type: 'confirmForceSelect', battleLoadout: loadout })
  }

  return (
    <div
      className={`app${buildingArmy ? ' army-mode' : ''}${
        inForceSelect ? ' force-select-mode' : ''
      }${showRightInspectPanel ? ' play-mode' : ''}`}
    >
      {/* Top room bar */}
      <div className="room-top-bar">
        <div className="room-top-left">
          <span className="room-code-badge">Room {state.roomCode}</span>
          {state.opponent === 'ai' ? (
            <span className="pill">
              vs AI
              {state.aiDifficulty
                ? ` · ${state.aiDifficulty[0]!.toUpperCase()}${state.aiDifficulty.slice(1)}`
                : ''}
            </span>
          ) : null}
          <button
            type="button"
            className="ghost"
            onClick={() => {
              leaveRoom()
              setJoinCode('')
            }}
            title="Leave this room and return to the lobby"
          >
            Back to lobby
          </button>
        </div>
        <div className="room-top-center">
          <span className="pill">You: {seat}</span>
          <span className="pill">{state.phase}</span>
          <span className="pill">
            {state.enforceCommanderRace !== false ? 'Mono-race' : 'Mixed race OK'}
          </span>
          <span className="pill">
            Deploy ≤{roomPools.deployMax} · Reserve ≤{roomPools.reserveMax}
          </span>
          <span className={connected ? 'status-ok' : 'status-bad'}>
            {connected ? 'Live' : 'Disconnected'}
          </span>
          <div className="players-badge" tabIndex={0}>
            <span className="players-badge-label">Players</span>
            <span className="players-badge-count">
              {state.players.filter((p) => p.connected).length}/{state.players.length}
            </span>
            <div className="players-tooltip">
              <div className="players-tooltip-title">Players</div>
              {state.players.map((p) => (
                <div
                  key={p.seat}
                  className={`player-tooltip-item${!p.connected ? ' player-away' : ''}`}
                >
                  <span className="player-tooltip-seat">{p.seat}</span>
                  <span className="player-tooltip-name">
                    {p.name}
                    {p.isAi ? ' (AI)' : ''}
                  </span>
                  {!p.connected && !p.isAi ? (
                    <span className="player-tooltip-status">away</span>
                  ) : p.armyReady ? (
                    <span className="player-tooltip-status">{p.armyUv ?? '?'} UV</span>
                  ) : (
                    <span className="player-tooltip-status">building</span>
                  )}
                  {isHost && playerIps[p.seat] ? (
                    <span className="player-tooltip-ip">{playerIps[p.seat]}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="room-top-right">
          {!buildingArmy && (
            <button
              type="button"
              className={roomPopoutOpen ? 'primary' : ''}
              onClick={() => setRoomPopoutOpen((v) => !v)}
              title="View armies, objectives, and phase controls"
            >
              Room
            </button>
          )}
          <button
            type="button"
            onClick={handleSaveBoard}
            disabled={!connected}
            title="Download current board state as JSON file"
          >
            Save board
          </button>
          <button
            type="button"
            onClick={handleLoadBoardClick}
            disabled={!connected}
            title="Load board state from JSON file"
          >
            Load board
          </button>
          <button
            type="button"
            className={logOpen ? 'primary' : ''}
            onClick={() => setLogOpen((v) => !v)}
            title="Toggle game log"
          >
            Log
          </button>
        </div>
      </div>

      {/* Log drawer */}
      {logOpen && (
        <div className="log-drawer-overlay" onClick={() => setLogOpen(false)}>
          <div className="log-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="log-drawer-header">
              <h2>Game Log</h2>
              <button
                type="button"
                className="ghost"
                onClick={() => setLogOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="log">
              {[...state.log].reverse().map((line, i) => (
                <div key={`${i}-${line}`}>{line}</div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Room popout for armies, objectives, and phase controls */}
      {roomPopoutOpen && !buildingArmy && (
        <div className="room-popout-overlay" onClick={() => setRoomPopoutOpen(false)}>
          <div className="room-popout" onClick={(e) => e.stopPropagation()}>
            <div className="room-popout-header">
              <h2>Room / Armies</h2>
              <button
                type="button"
                className="ghost"
                onClick={() => setRoomPopoutOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="room-popout-content">{renderRoomPopoutContent()}</div>
          </div>
        </div>
      )}

      {buildingArmy ? (
        <ArmyBuilder
          onSubmit={submitArmy}
          disabled={!connected}
          enforceCommanderRace={state.enforceCommanderRace !== false}
          loadoutPools={roomPools}
        />
      ) : inForceSelect && me?.army ? (
        <ForceSelectPanel
          key={`fs-${roomPools.deployMax}-${roomPools.reserveMax}`}
          army={me.army}
          catalog={state.cardCatalog}
          opponents={forceSelectOpponents}
          opponentStatus={forceSelectOpponentStatus}
          onConfirm={confirmForceSelect}
          disabled={!connected}
          waiting={me.forceSelectReady}
          loadoutPools={roomPools}
        />
      ) : (
        <>
          {showRightInspectPanel ? (
            <aside className="panel panel-left">
              {renderPhaseSidebarContent()}
            </aside>
          ) : null}
          <div className="board-stage">
          {turnBannerText ? (
            <div
              className={`turn-banner${
                (state.phase === 'Play' && myPlayTurn) || myTerrainTurn
                  ? ' turn-banner-you'
                  : ''
              }`}
            >
              {turnBannerText}
            </div>
          ) : null}
          <div className="board-mode-controls">
            <button
              type="button"
              className={boardMode === '2d' ? 'active' : 'ghost'}
              onClick={() => setBoardModePersist('2d')}
              title="Flat SVG board"
            >
              2D board
            </button>
            <button
              type="button"
              className={boardMode === '3d' ? 'active' : 'ghost'}
              onClick={() => setBoardModePersist('3d')}
              title="3D terrain blocks"
            >
              3D board
            </button>
          </div>
          {boardMode === '3d' ? (
            <HexBoard3D
              state={state}
              mySeat={seat}
              selectedUnitId={selectedUnitId}
              selectedDeathId={selectedDeathId}
              showGraves={state.phase === 'Play'}
              onHexClick={onHexClick}
              onHexHover={(col, row) => setHoverHex({ col, row })}
              terrainGhost={terrainGhost}
              officerCrKeys={officerCrKeys}
              deployHintKeys={deployHintKeys}
              companyUnitIds={companyUnitIds}
              targetUnitId={targetUnitId}
              artByCardId={artByCardId}
            />
          ) : (
            <HexBoard
              state={state}
              mySeat={seat}
              selectedUnitId={selectedUnitId}
              selectedDeathId={selectedDeathId}
              showGraves={state.phase === 'Play'}
              onHexClick={onHexClick}
              onHexHover={(col, row) => setHoverHex({ col, row })}
              terrainGhost={terrainGhost}
              officerCrKeys={officerCrKeys}
              deployHintKeys={deployHintKeys}
              companyUnitIds={companyUnitIds}
              targetUnitId={targetUnitId}
              artByCardId={artByCardId}
            />
          )}
        </div>
        </>
      )}

      {showRightInspectPanel ? (
        <aside className="panel panel-right">
          {state.phase === 'Play' && selectedUnit ? (
            <>
              <h2>Selected</h2>
              <div className="stat-tracker">
                <div className="stat-tracker-name">{selectedUnit.cardName}</div>
                <div className="stat-row">
                  <span>Move</span>
                  <strong>
                    {selectedUnit.moveRemaining}/{selectedUnit.move}
                  </strong>
                </div>
                {selectedUnit.movedBeyondLimit ? (
                  <p className="error" style={{ margin: '0.4rem 0 0' }}>
                    Warning: moved beyond printed Move (Harass / Trample / free
                    steps). Use Undo movement to reset.
                  </p>
                ) : null}
                <div className="stat-row">
                  <span>Damage</span>
                  <strong>{selectedUnit.damage ?? '—'}</strong>
                </div>
                <div className="stat-row">
                  <span>Range</span>
                  <strong>{selectedUnit.range ?? '—'}</strong>
                </div>
                <div className="stat-row">
                  <span>Toughness</span>
                  <strong>
                    {selectedUnit.toughnessCurrent ?? '—'}/
                    {selectedUnit.toughness ?? '—'}
                  </strong>
                </div>
                {selectedUnit.kind === 'commander' || selectedUnit.kind === 'officer' ? (
                  <div className="stat-row">
                    <span>Cmd Radius</span>
                    <strong>{selectedUnit.commandRadius ?? '—'}</strong>
                  </div>
                ) : null}
                {/* Company AP display for officer or unit in a company */}
                {(() => {
                  const officerId = selectedUnit.kind === 'officer'
                    ? selectedUnit.id
                    : state.units.find(
                        (u) => u.kind === 'officer' && u.seat === selectedUnit.seat && u.cardId === selectedUnit.officerCardId
                      )?.id
                  const pool = officerId ? state.companyPools?.[officerId] : null
                  if (!pool) return null
                  return (
                    <div className="stat-row company-ap-banner">
                      <span>Company AP</span>
                      <strong className="company-ap-value">{pool.ap}/{pool.apMax}</strong>
                    </div>
                  )
                })()}
                {selectedStatusPills.length ? (
                  <div className="status-pills">
                    {selectedStatusPills.map((pill) => (
                      <span key={pill.key} className={`pill status-pill status-${pill.key}`}>
                        {pill.label}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              {selectedUnit.kind === 'commander' &&
              selectedUnit.seat === seat &&
              myPlayTurn ? (
                <button
                  className="primary"
                  disabled={!!state.commanderActivatedThisRound[seat]}
                  onClick={() => send({ type: 'activateCommander' })}
                >
                  {state.commanderActivatedThisRound[seat]
                    ? 'Commander activated'
                    : 'Activate commander'}
                </button>
              ) : null}
              {selectedUnit.kind === 'officer' &&
              selectedUnit.seat === seat &&
              myPlayTurn ? (
                <button
                  className="primary"
                  disabled={
                    state.activeCompanyOfficerId === selectedUnit.id ||
                    !!state.companiesActivatedThisRound?.[selectedUnit.id] ||
                    (!!state.companyActivatedThisTurn?.[seat] &&
                      state.companyActivatedThisTurn[seat] !== selectedUnit.id)
                  }
                  onClick={() =>
                    send({
                      type: 'activateCompany',
                      officerUnitId: selectedUnit.id,
                    })
                  }
                >
                  {state.activeCompanyOfficerId === selectedUnit.id
                    ? 'Company active'
                    : state.companiesActivatedThisRound?.[selectedUnit.id]
                      ? 'Already activated this round'
                      : state.companyActivatedThisTurn?.[seat] &&
                          state.companyActivatedThisTurn[seat] !== selectedUnit.id
                        ? 'One company per turn'
                        : 'Activate company'}
                </button>
              ) : null}
              {selectedUnit.seat === seat &&
              myPlayTurn &&
              selectedUnit.activationCol != null &&
              selectedUnit.activationRow != null &&
              (selectedUnit.col !== selectedUnit.activationCol ||
                selectedUnit.row !== selectedUnit.activationRow ||
                selectedUnit.moveRemaining !== selectedUnit.move) ? (
                <button
                  type="button"
                  className="ghost"
                  onClick={() =>
                    send({ type: 'undoMove', unitId: selectedUnit.id })
                  }
                >
                  Undo movement
                </button>
              ) : null}

              {castableAbilities.length > 0 ? (
                <div className="cast-panel">
                  <h2>Cast</h2>
                  <p className="muted">
                    Spends the printed cost. Aim a target first when the ability
                    needs one.
                  </p>
                  <div className="cast-list">
                    {castableAbilities.map((a) => (
                      <button
                        key={a.name}
                        type="button"
                        className={
                          isUltimateAbility(a.def) ? 'cast-ult' : undefined
                        }
                        disabled={a.disabled}
                        title={
                          a.reason ||
                          a.def.description ||
                          `${a.name} (${a.spendLabel})`
                        }
                        onClick={() =>
                          send({
                            type: 'castAbility',
                            casterUnitId: selectedUnit.id,
                            abilityName: a.name,
                            targetUnitId: targetUnitId ?? undefined,
                          })
                        }
                      >
                        <span className="cast-name">{a.name}</span>
                        <span className="cast-cost">{a.spendLabel}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="resolve-panel">
                <h2>Resolve</h2>
                <p className="muted">
                  Auto-resolve attacks (buffs, Harden, Fortification, Evade,
                  Piercing, Poison, Trample) or use manual override below.
                </p>
                {pendingTrample && trampleAttacker ? (
                  <div className="trample-offer">
                    <p>
                      <strong>Trample:</strong> {trampleAttacker.cardName} may move
                      into ({pendingTrample.destCol},{pendingTrample.destRow})
                      {pendingTrample.leftoverDamage > 0
                        ? ` with ${pendingTrample.leftoverDamage} leftover dmg`
                        : ''}
                      . No Move cost — select {trampleAttacker.cardName}, Continue
                      Trample, then pick an adjacent enemy and Resolve attack.
                    </p>
                    <div className="row wrap">
                      <button
                        type="button"
                        className="primary"
                        disabled={selectedUnitId !== trampleAttacker.id}
                        onClick={() => send({ type: 'continueTrample' })}
                      >
                        Continue Trample
                      </button>
                      <button
                        type="button"
                        onClick={() => send({ type: 'declineTrample' })}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ) : null}
                {attackPreview ? (
                  attackPreview.legal ? (
                    <HitNeedPreview
                      breakdown={hitNeedBreakdownFromFlags(attackPreview)}
                      distance={attackPreview.distance}
                      rawDamage={attackPreview.rawDamage}
                      trampleStrike={attackPreview.trampleStrike}
                      fortifiedHex={attackPreview.fortifiedHex}
                      piercing={attackPreview.piercing}
                      targetUnit={targetUnit}
                      selectedUnit={selectedUnit}
                    />
                  ) : (
                    <p className="muted">{attackPreview.reason}</p>
                  )
                ) : (
                  <p className="muted">Select attacker + aim target for preview.</p>
                )}
                {state.lastCombatResult ? (
                  <div className="combat-result-recent">
                    <p className="combat-result-recent-label muted">Last resolved attack</p>
                    <CombatResultBanner result={state.lastCombatResult} />
                  </div>
                ) : null}
                <div className="row wrap">
                  <button
                    type="button"
                    className="primary"
                    disabled={
                      !selectedUnitId ||
                      !targetUnitId ||
                      !attackPreview?.legal
                    }
                    onClick={() =>
                      selectedUnitId &&
                      targetUnitId &&
                      send({
                        type: 'resolveAttack',
                        attackerUnitId: selectedUnitId,
                        defenderUnitId: targetUnitId,
                      })
                    }
                  >
                    Resolve attack
                  </button>
                </div>
                <p className="muted resolve-manual-label">Manual override</p>
                <div className="row wrap">
                  <button
                    type="button"
                    disabled={
                      !evadeCandidate ||
                      evadeCandidate.evadeActive ||
                      !evadeCompanyPool ||
                      evadeCompanyPool.ap < 1
                    }
                    title="Spend 1 Company AP — defender gains +1 to hit need until next activation"
                    onClick={() =>
                      evadeCandidate &&
                      send({ type: 'activateEvade', unitId: evadeCandidate.id })
                    }
                  >
                    Evade (1 Co AP)
                  </button>
                  <button
                    type="button"
                    disabled={!myPlayTurn || !hoverHex}
                    title="Toggle Fortification on hovered hex (Harden 1 for occupants; Piercing ignores)"
                    onClick={() =>
                      hoverHex &&
                      send({
                        type: 'toggleFortifyHex',
                        col: hoverHex.col,
                        row: hoverHex.row,
                      })
                    }
                  >
                    Toggle Fortify hex
                  </button>
                </div>
                <div className="row wrap">
                  <button
                    disabled={
                      !myPlayTurn || !myCommanderPool || myCommanderPool.ap < 1
                    }
                    onClick={() =>
                      send({
                        type: 'spendPool',
                        pool: 'commanderAp',
                        amount: 1,
                      })
                    }
                  >
                    Spend 1 AP
                  </button>
                  <button
                    disabled={
                      !myPlayTurn || !myCommanderPool || myCommanderPool.cc < 1
                    }
                    onClick={() =>
                      send({
                        type: 'spendPool',
                        pool: 'commanderCc',
                        amount: 1,
                      })
                    }
                  >
                    Spend 1 CC
                  </button>
                  <button
                    disabled={
                      !myPlayTurn ||
                      !companyPool ||
                      companyPool.ap < 1 ||
                      !selectedOfficerId
                    }
                    onClick={() =>
                      send({
                        type: 'spendPool',
                        pool: 'companyAp',
                        amount: 1,
                        officerUnitId: selectedOfficerId ?? undefined,
                      })
                    }
                  >
                    Spend 1 Co. AP
                  </button>
                </div>

                <div className="row wrap">
                  <button
                    type="button"
                    className={aimMode ? 'primary' : undefined}
                    onClick={() => setAimMode((v) => !v)}
                  >
                    {aimMode ? 'Click a unit…' : 'Aim target'}
                  </button>
                  {targetUnit ? (
                    <span className="pill">
                      Target: {targetUnit.cardName} ({targetUnit.seat}) T
                      {targetUnit.toughnessCurrent ?? '—'}/
                      {targetUnit.toughness ?? '—'}
                    </span>
                  ) : (
                    <span className="muted">No target</span>
                  )}
                  {targetUnitId ? (
                    <button type="button" onClick={() => setTargetUnitId(null)}>
                      Clear
                    </button>
                  ) : null}
                </div>

                <div className="row wrap">
                  <label className="inline-field">
                    Dice
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={diceCount}
                      onChange={(e) =>
                        setDiceCount(
                          Math.max(
                            1,
                            Math.min(12, Number(e.target.value) || 1),
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    onClick={() =>
                      send({
                        type: 'rollDice',
                        count: diceCount,
                        sides: 6,
                        note: selectedUnit
                          ? `${selectedUnit.cardName}${
                              targetUnit ? ` → ${targetUnit.cardName}` : ''
                            }`
                          : undefined,
                      })
                    }
                  >
                    Roll {diceCount}d6
                  </button>
                </div>

                <div className="row wrap">
                  <label className="inline-field">
                    Dmg
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={damageAmount}
                      onChange={(e) =>
                        setDamageAmount(
                          Math.max(
                            1,
                            Math.min(20, Number(e.target.value) || 1),
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    disabled={!targetUnitId}
                    onClick={() =>
                      targetUnitId &&
                      send({
                        type: 'applyDamage',
                        unitId: targetUnitId,
                        amount: damageAmount,
                      })
                    }
                  >
                    Damage target
                  </button>
                  <button
                    disabled={!targetUnitId || !selectedUnit?.damage}
                    onClick={() =>
                      targetUnitId &&
                      selectedUnit?.damage &&
                      send({
                        type: 'applyDamage',
                        unitId: targetUnitId,
                        amount: selectedUnit.damage,
                      })
                    }
                  >
                    Use printed Dmg
                  </button>
                </div>

                <div className="row wrap">
                  <label className="inline-field">
                    Heal
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={healAmount}
                      onChange={(e) =>
                        setHealAmount(
                          Math.max(
                            1,
                            Math.min(20, Number(e.target.value) || 1),
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    disabled={!targetUnitId}
                    onClick={() =>
                      targetUnitId &&
                      send({
                        type: 'applyHeal',
                        unitId: targetUnitId,
                        amount: healAmount,
                      })
                    }
                  >
                    Heal target
                  </button>
                  <button
                    disabled={!selectedUnitId}
                    onClick={() =>
                      selectedUnitId &&
                      send({
                        type: 'applyHeal',
                        unitId: selectedUnitId,
                        amount: healAmount,
                      })
                    }
                  >
                    Heal selected
                  </button>
                </div>
              </div>

              {focusCard ? (
                <div className="inspect-card">
                  <CardFace card={focusCard} abilityByName={abilityByName} />
                </div>
              ) : (
                <p className="muted">Card art loading…</p>
              )}
            </>
          ) : focusCard ? (
            <>
              <h2>Inspect</h2>
              {selectedUnit ? (
                <div className="stat-tracker">
                  <div className="stat-tracker-name">{selectedUnit.cardName}</div>
                  <div className="stat-row">
                    <span>Position</span>
                    <strong>
                      {selectedUnit.col},{selectedUnit.row}
                    </strong>
                  </div>
                  {state.phase === 'Deploy' ? (
                    <div className="stat-row">
                      <span>Status</span>
                      <strong>Deployed</strong>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="muted">{focusCard.name}</p>
              )}
              <div className="inspect-card">
                <CardFace card={focusCard} abilityByName={abilityByName} />
              </div>
            </>
          ) : (
            <>
              <h2>Card</h2>
              <p className="muted">
                Select a card from your army list (left) or the board.
              </p>
            </>
          )}
        </aside>
      ) : null}

      {showLoadConfirm && pendingLoadState && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Load board state?</h2>
            <p>
              <strong>Warning:</strong> Loading will replace the current room state
              with the saved state.
            </p>
            <p>
              The loaded state will restore the game to{' '}
              <strong>{pendingLoadState.phase}</strong> phase, round{' '}
              <strong>{pendingLoadState.round}</strong>.
            </p>
            <p className="muted">
              All current progress will be lost. This action cannot be undone.
            </p>
            <div className="row">
              <button
                type="button"
                className="primary"
                onClick={confirmLoadBoard}
              >
                Confirm load
              </button>
              <button type="button" onClick={cancelLoadBoard}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {overlayResult ? (
        <CombatRollOverlay result={overlayResult} onDismiss={dismissOverlay} />
      ) : null}
    </div>
  )
}
