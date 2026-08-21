import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
/**
 * SVG hex board — terrain, overlays, and unit tokens share one coordinate space.
 * See terrainVisuals.tsx for terrain art scope notes.
 */
import {
  BOARD_SIZE,
  boardMid,
  commandRadiusKeys,
  foreignCommandRadiusKeys,
  hexKey,
  hexPolygonPoints,
  neighborsOddR,
  objectiveZoneHexes,
  oddRToPixel,
  DEFAULT_COMMANDER_COMMAND_RADIUS,
  type GameState,
  type DeathRecord,
  type OddR,
  type SeatId,
  type TerrainKind,
  type UnitToken,
} from '../../shared/index'
import {
  hexDepthFilterUrl,
  terrainElevation,
  terrainPatternFill,
  terrainStroke,
  TerrainPatternDefs,
} from './terrainVisuals'
const OBJECTIVE_NEUTRAL_FILL = 'rgba(220, 180, 80, 0.42)'
const OBJECTIVE_STROKE = '#e8c040'

const SEAT_CR_FILL: Record<SeatId, string> = {
  N: 'rgba(70, 140, 220, 0.22)',
  W: 'rgba(200, 90, 70, 0.22)',
  S: 'rgba(60, 160, 110, 0.22)',
  E: 'rgba(180, 130, 50, 0.22)',
}

const FOREIGN_CR_FILL = 'rgba(160, 50, 50, 0.28)'

const SEAT_FILL: Record<SeatId, string> = {
  N: 'rgba(70, 140, 220, 0.35)',
  W: 'rgba(200, 90, 70, 0.35)',
  S: 'rgba(60, 160, 110, 0.35)',
  E: 'rgba(180, 130, 50, 0.35)',
}

const SEAT_UNIT: Record<SeatId, string> = {
  N: 'rgba(70, 140, 220, 0.85)',
  W: 'rgba(200, 90, 70, 0.85)',
  S: 'rgba(60, 160, 110, 0.85)',
  E: 'rgba(180, 130, 50, 0.85)',
}

import {
  SEAT_OUTLINE,
  SEAT_TOKEN_FILL,
  companyAccentColor,
  diamondTokenPoints,
  hexTokenPoints,
  tokenRadiusForKind,
  unitTokenLabel,
} from './unitTokenVisuals'
import { COMBAT_FX_MS, combatFloats, combatResultKey } from './combatFx'

/** Primary ring — unit kind. */
const KIND_OUTLINE: Record<'commander' | 'officer' | 'unit', string> = {
  commander: '#ffe066',
  officer: '#ffffff',
  unit: '#f0ece0',
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 2.5
const ZOOM_STEP = 0.25

/** Cursor hex — distinct from terrain ghost (blue/red) and selection (unit ring). */
const HOVER_FILL = 'rgba(255, 255, 255, 0.34)'
const HOVER_STROKE = '#c8f8ff'
const HOVER_STROKE_W = 2.5
const MOVE_PREVIEW_FILL = 'rgba(56, 190, 92, 0.42)'
const ATTACK_PREVIEW_FILL = 'rgba(220, 64, 64, 0.38)'
const ATTACK_PREVIEW_STROKE = '#e05050'
const OFFICER_CR_FILL = 'rgba(64, 132, 230, 0.32)'
const OFFICER_CR_STROKE = '#5aa0f0'
const FLASH_FILL = 'rgba(255, 214, 90, 0.42)'
const FLASH_STROKE = '#ffe08a'

function clampZoom(zoom: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

function clampPan(
  pan: { x: number; y: number },
  zoom: number,
  baseWidth: number,
  baseHeight: number,
) {
  const viewW = baseWidth / zoom
  const viewH = baseHeight / zoom
  const panLimitX = Math.abs(baseWidth - viewW) / 2
  const panLimitY = Math.abs(baseHeight - viewH) / 2
  return {
    x: Math.min(panLimitX, Math.max(-panLimitX, pan.x)),
    y: Math.min(panLimitY, Math.max(-panLimitY, pan.y)),
  }
}

function isPanButton(button: number) {
  return button === 1 || button === 2
}

function hpRatio(unit: UnitToken): number | null {
  if (unit.toughness == null || unit.toughness <= 0) return null
  const cur = unit.toughnessCurrent ?? unit.toughness
  return Math.max(0, Math.min(1, cur / unit.toughness))
}

export type TerrainGhost = {
  cells: OddR[]
  kind: TerrainKind
  valid: boolean
}

export type HexBoardProps = {
  state: GameState
  mySeat: SeatId | null
  selectedUnitId: string | null
  onHexClick: (col: number, row: number) => void
  onHexHover?: (col: number, row: number) => void
  /** Fired when the pointer leaves the board (or no hex is under the cursor). */
  onHoverEnd?: () => void
  terrainGhost?: TerrainGhost | null
  /** Officer command radius to tint while inspecting an officer/unit. */
  officerCrKeys?: Set<string>
  /** Reachable move hexes for the selected unit. */
  movePreviewKeys?: Set<string>
  /** Attack range hexes for the selected unit. */
  attackPreviewKeys?: Set<string>
  /** Hexes to pulse (combat, objective flip, activation). */
  flashHexKeys?: Set<string>
  /** Units in the currently activated company (Play). */
  activeCompanyIds?: Set<string>
  /** 3D camera nudge toward a hex (combat / claim / activation). */
  cameraFocus?: { col: number; row: number; nonce: number } | null
  /** Deploy-phase legal hexes (officer wedge or unit officer-CR). */
  deployHintKeys?: Set<string>
  /** Company unit ids to highlight with the selected officer. */
  companyUnitIds?: Set<string>
  /** Aimed target for manual resolution. */
  targetUnitId?: string | null
  /** Card art URLs keyed by card id (reserved — 3D tokens used on board). */
  artByCardId?: Record<string, string>
  /** Selected grave for board highlight. */
  selectedDeathId?: string | null
  /** Show grave markers on empty hexes (Play). */
  showGraves?: boolean
  hexSize?: number
}

export const DEFAULT_HEX_SIZE = 10

export function HexBoard({
  state,
  mySeat,
  selectedUnitId,
  onHexClick,
  onHexHover,
  onHoverEnd,
  terrainGhost = null,
  officerCrKeys,
  movePreviewKeys,
  attackPreviewKeys,
  flashHexKeys,
  activeCompanyIds,
  deployHintKeys,
  companyUnitIds,
  targetUnitId = null,
  artByCardId: _artByCardId = {},
  selectedDeathId = null,
  showGraves = true,
  hexSize = DEFAULT_HEX_SIZE,
}: HexBoardProps) {
  const [hover, setHover] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [combatNow, setCombatNow] = useState(0)
  const combatStartedAt = useRef(0)
  const combatKeyRef = useRef<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const panSession = useRef<{
    startX: number
    startY: number
    startPanX: number
    startPanY: number
    viewWidth: number
    viewHeight: number
  } | null>(null)

  const combat = state.lastCombatResult
  const combatKey = combat ? combatResultKey(combat) : null
  useEffect(() => {
    if (!combatKey) return
    combatKeyRef.current = combatKey
    combatStartedAt.current = performance.now()
    setCombatNow(performance.now())
    let frame = 0
    const tick = (t: number) => {
      setCombatNow(t)
      if (t - combatStartedAt.current < COMBAT_FX_MS) {
        frame = requestAnimationFrame(tick)
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [combatKey])

  const unitAt = useMemo(() => {
    const m = new Map<string, (typeof state.units)[0]>()
    for (const u of state.units) m.set(hexKey(u.col, u.row), u)
    return m
  }, [state.units])

  const objAt = useMemo(() => {
    const m = new Map<
      string,
      { objective: (typeof state.objectives)[0]; isAnchor: boolean }
    >()
    for (const o of state.objectives) {
      for (const h of objectiveZoneHexes(o)) {
        m.set(hexKey(h.col, h.row), {
          objective: o,
          isAnchor: h.col === o.col && h.row === o.row,
        })
      }
    }
    return m
  }, [state.objectives])

  const objectiveZoneEdges = useMemo(() => {
    const edges: Array<{ cx: number; cy: number; controller: SeatId | null }> =
      []
    for (const obj of state.objectives) {
      const zoneKeys = new Set(
        objectiveZoneHexes(obj).map((h) => hexKey(h.col, h.row)),
      )
      for (const h of objectiveZoneHexes(obj)) {
        const isEdge = neighborsOddR(h).some(
          (n) => !zoneKeys.has(hexKey(n.col, n.row)),
        )
        if (!isEdge) continue
        const { x, y } = oddRToPixel(h.col, h.row, hexSize)
        edges.push({ cx: x, cy: y, controller: obj.controller })
      }
    }
    return edges
  }, [state.objectives, hexSize])

  const gravesByHex = useMemo(() => {
    const m = new Map<string, DeathRecord[]>()
    if (!showGraves) return m
    for (const d of state.deaths ?? []) {
      const key = hexKey(d.col, d.row)
      const list = m.get(key) ?? []
      list.push(d)
      m.set(key, list)
    }
    return m
  }, [state.deaths, showGraves])

  const selectedDeath = useMemo(() => {
    if (!selectedDeathId) return null
    return state.deaths?.find((d) => d.id === selectedDeathId) ?? null
  }, [state.deaths, selectedDeathId])

  const ghostKeys = useMemo(() => {
    const m = new Map<string, boolean>()
    if (!terrainGhost) return m
    for (const c of terrainGhost.cells) m.set(hexKey(c.col, c.row), true)
    return m
  }, [terrainGhost])

  const crByHex = useMemo(() => {
    const m = new Map<string, SeatId>()
    const n = state.boardSize || BOARD_SIZE
    for (const seat of Object.keys(state.commanders) as SeatId[]) {
      const origin = state.commanders[seat]
      if (!origin) continue
      const radius = state.commanderRadii?.[seat] ?? DEFAULT_COMMANDER_COMMAND_RADIUS
      for (const key of commandRadiusKeys(origin, radius, n)) {
        if (!m.has(key)) m.set(key, seat)
      }
    }
    return m
  }, [state.commanders, state.commanderRadii, state.boardSize])

  const ownCrKeys = useMemo(() => {
    if (
      !mySeat ||
      state.phase !== 'Terrain' ||
      state.terrainStage !== 'commandZone'
    ) {
      return new Set<string>()
    }
    const origin = state.commanders[mySeat]
    if (!origin) return new Set<string>()
    const radius = state.commanderRadii?.[mySeat] ?? DEFAULT_COMMANDER_COMMAND_RADIUS
    return commandRadiusKeys(origin, radius, state.boardSize || BOARD_SIZE)
  }, [state, mySeat])

  const foreignCrKeys = useMemo(() => {
    if (
      !mySeat ||
      state.phase !== 'Terrain' ||
      (state.terrainStage !== 'landLarge' &&
        state.terrainStage !== 'landMedium' &&
        state.terrainStage !== 'landSmall')
    ) {
      return new Set<string>()
    }
    return foreignCommandRadiusKeys(state, mySeat)
  }, [state, mySeat])

  const cells = useMemo(() => {
    const list: Array<{
      col: number
      row: number
      cx: number
      cy: number
      baseTerrain: TerrainKind
      overlayFill?: string
      overlayRing?: string
      flash?: boolean
      label?: string
      strokeW: number
      stroke: string
      graveLabel?: boolean
      graveTitle?: string
      hasUnit: boolean
    }> = []
    const n = state.boardSize || BOARD_SIZE
    const mid = boardMid(n)
    const terrain = state.terrain ?? {}
    const showCr =
      Object.keys(state.commanders).length > 0 &&
      (state.phase === 'Commanders' ||
        state.phase === 'Objectives' ||
        state.phase === 'Terrain')

    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const { x, y } = oddRToPixel(col, row, hexSize)
        const key = hexKey(col, row)
        const kind = terrain[key] ?? 'plains'
        let overlayFill: string | undefined
        let overlayRing: string | undefined
        let strokeW = 0.35
        let stroke = terrainStroke(kind)
        let label: string | undefined

        if (showCr) {
          const crSeat = crByHex.get(key)
          if (crSeat) overlayFill = SEAT_CR_FILL[crSeat]
        }

        if (ownCrKeys.has(key) && state.terrainStage === 'commandZone') {
          overlayFill = mySeat ? SEAT_CR_FILL[mySeat] : overlayFill
          stroke = '#7ec8ff'
          strokeW = Math.max(strokeW, 0.7)
        }

        if (
          foreignCrKeys.has(key) &&
          (state.terrainStage === 'landLarge' ||
            state.terrainStage === 'landMedium' ||
            state.terrainStage === 'landSmall')
        ) {
          overlayFill = FOREIGN_CR_FILL
        }

        if (state.fortifiedHexes?.[key]) {
          stroke = '#c9a227'
          strokeW = Math.max(strokeW, 1.2)
          label = '⛊'
        }

        if (
          state.phase === 'Deploy' &&
          deployHintKeys &&
          deployHintKeys.has(key)
        ) {
          overlayFill = 'rgba(80, 100, 140, 0.35)'
          stroke = '#8eb4e8'
          strokeW = Math.max(strokeW, 0.6)
        } else if (
          mySeat &&
          state.phase === 'Deploy' &&
          !deployHintKeys?.size &&
          crByHex.get(key) === mySeat &&
          !terrain[key]
        ) {
          overlayFill = 'rgba(80, 100, 140, 0.35)'
        }

        if (col === mid && row === mid && !terrain[key]) {
          overlayFill = 'rgba(200, 170, 60, 0.45)'
          strokeW = 1
        }

        const objCell = objAt.get(key)
        if (objCell) {
          const obj = objCell.objective
          overlayFill = obj.controller
            ? SEAT_FILL[obj.controller]
            : OBJECTIVE_NEUTRAL_FILL
          if (objCell.isAnchor) label = '★'
          stroke = OBJECTIVE_STROKE
          strokeW = 1.25
        }

        for (const seat of Object.keys(state.commanders) as SeatId[]) {
          const c = state.commanders[seat]
          if (c && c.col === col && c.row === row && !unitAt.has(key)) {
            overlayFill = SEAT_UNIT[seat]
            label = seat
          }
        }

        const unit = unitAt.get(key)
        const graves = gravesByHex.get(key)
        if (graves?.length && showGraves && !unit) {
          overlayFill = 'rgba(58, 52, 68, 0.55)'
          label = '†'
          stroke = '#6a6278'
          strokeW = Math.max(strokeW, 0.65)
        }
        if (unit) {
          strokeW = selectedUnitId === unit.id ? 1.8 : 0.9
          if (companyUnitIds?.has(unit.id)) {
            stroke = '#f0d060'
            strokeW = Math.max(strokeW, 1.5)
          }
          if (targetUnitId === unit.id) {
            stroke = '#e07070'
            strokeW = Math.max(strokeW, 2)
          }
          if (selectedUnitId === unit.id) {
            stroke = '#7ec8ff'
            strokeW = Math.max(strokeW, 1.8)
          }
        }
        if (graves?.length && showGraves) {
          const isSelectedGrave =
            selectedDeath &&
            selectedDeath.col === col &&
            selectedDeath.row === row &&
            graves.some((g) => g.id === selectedDeathId)
          if (isSelectedGrave) {
            stroke = '#e8dfc8'
            strokeW = Math.max(strokeW, 2.2)
          }
        }

        if (officerCrKeys?.has(key)) {
          overlayFill = OFFICER_CR_FILL
          stroke = OFFICER_CR_STROKE
          strokeW = Math.max(strokeW, 0.7)
        }
        const inMove = Boolean(movePreviewKeys?.has(key))
        const inAttack = Boolean(attackPreviewKeys?.has(key))
        if (inMove) {
          overlayFill = MOVE_PREVIEW_FILL
        }
        if (inAttack && !inMove) {
          overlayFill = ATTACK_PREVIEW_FILL
        }
        if (inAttack) {
          overlayRing = ATTACK_PREVIEW_STROKE
          stroke = ATTACK_PREVIEW_STROKE
          strokeW = Math.max(strokeW, inMove ? 1.15 : 0.9)
        }
        const flash = Boolean(flashHexKeys?.has(key))
        if (flash) {
          overlayFill = FLASH_FILL
          stroke = FLASH_STROKE
          strokeW = Math.max(strokeW, 1.4)
        }

        if (ghostKeys.has(key) && terrainGhost) {
          stroke = terrainGhost.valid ? '#7ec8ff' : '#e07070'
          strokeW = Math.max(strokeW, 1.5)
          overlayFill = terrainGhost.valid
            ? 'rgba(100, 180, 255, 0.45)'
            : 'rgba(220, 80, 80, 0.4)'
        }

        const graveTitle = graves?.length
          ? `Grave: ${graves.map((g) => `${g.cardName} (${g.seat})`).join(', ')}`
          : undefined

        list.push({
          col,
          row,
          cx: x,
          cy: y,
          baseTerrain: kind,
          overlayFill,
          overlayRing,
          flash,
          label,
          strokeW,
          stroke,
          graveLabel: Boolean(graves?.length && unit),
          graveTitle,
          hasUnit: Boolean(unit),
        })
      }
    }
    return list
  }, [
    state,
    mySeat,
    unitAt,
    objAt,
    hexSize,
    hover,
    selectedUnitId,
    ghostKeys,
    terrainGhost,
    crByHex,
    ownCrKeys,
    foreignCrKeys,
    officerCrKeys,
    movePreviewKeys,
    attackPreviewKeys,
    flashHexKeys,
    deployHintKeys,
    companyUnitIds,
    targetUnitId,
    gravesByHex,
    selectedDeath,
    selectedDeathId,
    showGraves,
  ])

  const hoverCell = useMemo(
    () => (hover ? cells.find((c) => hexKey(c.col, c.row) === hover) ?? null : null),
    [cells, hover],
  )

  const xs = cells.map((c) => c.cx)
  const ys = cells.map((c) => c.cy)
  const pad = hexSize + 6
  const minX = Math.min(...xs) - pad
  const maxX = Math.max(...xs) + pad
  const minY = Math.min(...ys) - pad
  const maxY = Math.max(...ys) + pad
  const baseWidth = maxX - minX
  const baseHeight = maxY - minY
  const baseCenterX = (minX + maxX) / 2
  const baseCenterY = (minY + maxY) / 2
  const viewWidth = baseWidth / zoom
  const viewHeight = baseHeight / zoom
  const viewX = baseCenterX + pan.x - viewWidth / 2
  const viewY = baseCenterY + pan.y - viewHeight / 2

  const applyZoom = useCallback(
    (nextZoom: number, anchor?: { x: number; y: number }) => {
      const clamped = clampZoom(nextZoom)
      if (clamped === zoom && !anchor) {
        setPan((current) =>
          clampPan(current, clamped, baseWidth, baseHeight),
        )
        return
      }

      if (!anchor) {
        setZoom(clamped)
        setPan((current) =>
          clampPan(current, clamped, baseWidth, baseHeight),
        )
        return
      }

      const fx = (anchor.x - viewX) / viewWidth
      const fy = (anchor.y - viewY) / viewHeight
      const nextViewWidth = baseWidth / clamped
      const nextViewHeight = baseHeight / clamped
      const nextViewX = anchor.x - fx * nextViewWidth
      const nextViewY = anchor.y - fy * nextViewHeight
      const nextPan = clampPan(
        {
          x: nextViewX + nextViewWidth / 2 - baseCenterX,
          y: nextViewY + nextViewHeight / 2 - baseCenterY,
        },
        clamped,
        baseWidth,
        baseHeight,
      )

      setZoom(clamped)
      setPan(nextPan)
    },
    [
      baseCenterX,
      baseCenterY,
      baseHeight,
      baseWidth,
      viewHeight,
      viewWidth,
      viewX,
      viewY,
      zoom,
    ],
  )

  const zoomBy = useCallback(
    (delta: number) => {
      applyZoom(zoom + delta)
    },
    [applyZoom, zoom],
  )

  const resetView = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  const handleWheel = useCallback(
    (event: React.WheelEvent<SVGSVGElement>) => {
      if (!event.shiftKey) return
      event.preventDefault()
      const svg = svgRef.current
      if (!svg) return

      const ctm = svg.getScreenCTM()
      if (!ctm) return

      const point = svg.createSVGPoint()
      point.x = event.clientX
      point.y = event.clientY
      const anchor = point.matrixTransform(ctm.inverse())
      const delta = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP
      applyZoom(zoom + delta, anchor)
    },
    [applyZoom, zoom],
  )

  const endPan = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!panSession.current) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    panSession.current = null
    setIsPanning(false)
  }, [])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!isPanButton(event.button)) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      panSession.current = {
        startX: event.clientX,
        startY: event.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
        viewWidth,
        viewHeight,
      }
      setIsPanning(true)
    },
    [pan.x, pan.y, viewHeight, viewWidth],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const session = panSession.current
      const svg = svgRef.current
      if (!session || !svg) return

      const scaleX = session.viewWidth / svg.clientWidth
      const scaleY = session.viewHeight / svg.clientHeight
      const dx = (event.clientX - session.startX) * scaleX
      const dy = (event.clientY - session.startY) * scaleY
      setPan(
        clampPan(
          {
            x: session.startPanX - dx,
            y: session.startPanY - dy,
          },
          zoom,
          baseWidth,
          baseHeight,
        ),
      )
    },
    [baseHeight, baseWidth, zoom],
  )

  const combatAge = combatNow - combatStartedAt.current
  const combatActive =
    !!combat &&
    combatKeyRef.current === combatKey &&
    combatAge >= 0 &&
    combatAge < COMBAT_FX_MS
  const combatAtkPx =
    combat &&
    oddRToPixel(combat.attackerCol, combat.attackerRow, hexSize)
  const combatDefPx =
    combat &&
    oddRToPixel(combat.defenderCol, combat.defenderRow, hexSize)
  const pierceEnd = combat?.pierceHits?.length
    ? combat.pierceHits[combat.pierceHits.length - 1]
    : null
  const combatEndPx =
    combat && pierceEnd
      ? oddRToPixel(pierceEnd.col, pierceEnd.row, hexSize)
      : combatDefPx
  const combatLunge = (() => {
    if (!combatActive || !combatAtkPx || !combatDefPx) return { x: 0, y: 0 }
    const dx = combatDefPx.x - combatAtkPx.x
    const dy = combatDefPx.y - combatAtkPx.y
    const len = Math.hypot(dx, dy) || 1
    const pulse = Math.sin(Math.min(1, combatAge / 420) * Math.PI)
    const dist = hexSize * 0.55 * pulse
    return { x: (dx / len) * dist, y: (dy / len) * dist }
  })()
  const combatBolt =
    combatActive && combatAtkPx && combatEndPx
      ? {
          x:
            combatAtkPx.x +
            (combatEndPx.x - combatAtkPx.x) *
              Math.min(1, combatAge / 380),
          y:
            combatAtkPx.y +
            (combatEndPx.y - combatAtkPx.y) *
              Math.min(1, combatAge / 380),
        }
      : null

  return (
    <div
      className={`board-wrap${isPanning ? ' board-panning' : ''}`}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="board-zoom-controls">
        <button
          type="button"
          onClick={() => zoomBy(ZOOM_STEP)}
          disabled={zoom >= MAX_ZOOM}
          title="Zoom in (Shift+scroll)"
          aria-label="Zoom in"
        >
          +
        </button>
        <span className="board-zoom-label">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          onClick={() => zoomBy(-ZOOM_STEP)}
          disabled={zoom <= MIN_ZOOM}
          title="Zoom out (Shift+scroll)"
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          className="ghost"
          onClick={resetView}
          disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
          title="Reset zoom and pan"
        >
          Reset
        </button>
      </div>
      <div className="board-viewport">
      <svg
        ref={svgRef}
        className="board-hex-svg"
        viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onMouseLeave={() => {
          setHover(null)
          onHoverEnd?.()
        }}
      >
        <defs>
          <TerrainPatternDefs />
        </defs>
        <rect
          x={minX}
          y={minY}
          width={maxX - minX}
          height={maxY - minY}
          fill="#0c0e12"
        />
        {cells.map((c) => {
          const key = hexKey(c.col, c.row)
          const unit = unitAt.get(key)
          const elev = terrainElevation(c.baseTerrain)
          const r = hexSize - 0.25 + elev
          const cy = c.cy - elev * 0.35
          const tooltip =
            c.graveTitle && unit
              ? `${unit.cardName} · ${c.graveTitle}`
              : c.graveTitle
                ? c.graveTitle
                : unit
                  ? unit.cardName
                  : null
          return (
            <g key={key} pointerEvents="none">
              {tooltip ? <title>{tooltip}</title> : null}
              <polygon
                points={hexPolygonPoints(c.cx, cy, r)}
                fill={terrainPatternFill(c.baseTerrain)}
                stroke={c.stroke}
                strokeWidth={c.strokeW}
                filter={elev > 0 ? hexDepthFilterUrl() : undefined}
              />
              {c.overlayFill ? (
                <polygon
                  className={c.flash ? 'hex-flash' : undefined}
                  points={hexPolygonPoints(c.cx, cy, r - 0.05)}
                  fill={c.overlayFill}
                  stroke="none"
                />
              ) : null}
              {c.overlayRing ? (
                <polygon
                  points={hexPolygonPoints(c.cx, cy, r - 0.12)}
                  fill="none"
                  stroke={c.overlayRing}
                  strokeWidth={Math.max(0.7, hexSize * 0.12)}
                  opacity={0.95}
                />
              ) : null}
              {c.label && !c.hasUnit ? (
                <text
                  x={c.cx}
                  y={cy + hexSize * 0.12}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#f0ece0"
                  fontSize={Math.max(5, hexSize * 0.65)}
                  fontWeight={700}
                  style={{ textShadow: '0 0 3px rgba(0,0,0,0.8)' }}
                >
                  {c.label}
                </text>
              ) : null}
              {c.graveLabel ? (
                <text
                  x={c.cx + hexSize * 0.55}
                  y={cy + hexSize * 0.55}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#b8b0a0"
                  fontSize={Math.max(4, hexSize * 0.45)}
                  fontWeight={600}
                  opacity={0.85}
                >
                  †
                </text>
              ) : null}
            </g>
          )
        })}
        {hoverCell ? (() => {
          const elev = terrainElevation(hoverCell.baseTerrain)
          const r = hexSize - 0.25 + elev
          const cy = hoverCell.cy - elev * 0.35
          return (
            <g className="board-hex-hover" pointerEvents="none">
              <polygon
                points={hexPolygonPoints(hoverCell.cx, cy, r - 0.02)}
                fill={HOVER_FILL}
                stroke={HOVER_STROKE}
                strokeWidth={HOVER_STROKE_W}
              />
            </g>
          )
        })() : null}
        {cells.map((c) => {
          const key = hexKey(c.col, c.row)
          const unit = unitAt.get(key)
          const elev = terrainElevation(c.baseTerrain)
          const r = hexSize - 0.25 + elev
          const cy = c.cy - elev * 0.35
          const tooltip =
            !unit && c.graveTitle
              ? c.graveTitle
              : null
          return (
            <polygon
              key={`hit-${key}`}
              className="board-hex-hit"
              points={hexPolygonPoints(c.cx, cy, r)}
              fill="transparent"
              stroke="none"
              onMouseEnter={() => {
                setHover(key)
                onHexHover?.(c.col, c.row)
              }}
              onMouseLeave={() => setHover(null)}
              onClick={() => {
                onHexClick(c.col, c.row)
              }}
              style={{ cursor: 'pointer' }}
            >
              {tooltip ? <title>{tooltip}</title> : null}
            </polygon>
          )
        })}
        <g className="board-units" pointerEvents="none">
          {state.units.map((unit) => {
            const { x: hx, y } = oddRToPixel(unit.col, unit.row, hexSize)
            const isAttacker = combatActive && combat?.attackerId === unit.id
            const isDefender = combatActive && combat?.defenderId === unit.id
            const x = hx + (isAttacker ? combatLunge.x : 0)
            const kind =
              state.terrain?.[hexKey(unit.col, unit.row)] ?? 'plains'
            const elev = terrainElevation(kind)
            const cy = y - elev * 0.35
            const baseR = hexSize * 0.38
            const tokenR = tokenRadiusForKind(baseR, unit.kind)
            const isSelected = selectedUnitId === unit.id
            const isTarget = targetUnitId === unit.id
            const inCompany = companyUnitIds?.has(unit.id)
            const inActiveCompany = Boolean(activeCompanyIds?.has(unit.id))
            const activeSeat = (() => {
              if (!activeCompanyIds?.size) return null
              const lead = state.units.find((u) => activeCompanyIds.has(u.id))
              return lead?.seat ?? null
            })()
            const dimmed =
              Boolean(activeSeat) &&
              unit.seat === activeSeat &&
              !inActiveCompany
            const companyAccent = companyAccentColor(unit)
            const hp = hpRatio(unit)
            const barW = hexSize * 0.72
            const barH = Math.max(0.35, hexSize * 0.1)
            const barY = cy + baseR + hexSize * 0.12
            let ringStroke = SEAT_OUTLINE[unit.seat]
            let ringW = Math.max(0.5, hexSize * 0.1)
            if (isTarget) {
              ringStroke = '#e07070'
              ringW = Math.max(0.7, hexSize * 0.14)
            } else if (isSelected) {
              ringStroke = '#7ec8ff'
              ringW = Math.max(0.7, hexSize * 0.14)
            } else if (inCompany) {
              ringStroke = '#f0d060'
              ringW = Math.max(0.6, hexSize * 0.12)
            }
            const strokeW = Math.max(0.45, hexSize * 0.08)
            const kindStrokeW = Math.max(0.35, hexSize * 0.06)
            const labelY = companyAccent ? cy - hexSize * 0.06 : cy + hexSize * 0.04
            const pipR =
              unit.kind === 'officer' ? hexSize * 0.15 : hexSize * 0.12
            const pipY = cy + tokenR * 0.58
            const shapeProps = {
              fill: SEAT_TOKEN_FILL[unit.seat],
              stroke: SEAT_OUTLINE[unit.seat],
              strokeWidth: strokeW,
              pointerEvents: 'none' as const,
            }
            const kindRingProps = {
              fill: 'none' as const,
              stroke: KIND_OUTLINE[unit.kind],
              strokeWidth: kindStrokeW,
              opacity: 0.9,
              pointerEvents: 'none' as const,
            }
            return (
              <g
                key={`unit-${unit.id}`}
                opacity={dimmed ? 0.38 : 1}
                className={[
                  isDefender && combat && combatAge > 380
                    ? combat.hit
                      ? 'unit-combat-impact'
                      : 'unit-combat-whiff'
                    : '',
                  inActiveCompany ? 'unit-company-active' : '',
                ]
                  .filter(Boolean)
                  .join(' ') || undefined}
              >
                {(isSelected || isTarget || inCompany) && (
                  <circle
                    cx={x}
                    cy={cy}
                    r={baseR + hexSize * 0.14}
                    fill="none"
                    stroke={ringStroke}
                    strokeWidth={ringW}
                    opacity={0.95}
                    pointerEvents="none"
                  />
                )}
                {unit.kind === 'commander' ? (
                  <>
                    <polygon
                      points={hexTokenPoints(x, cy, tokenR)}
                      {...shapeProps}
                    />
                    <polygon
                      points={hexTokenPoints(x, cy, tokenR * 0.88)}
                      {...kindRingProps}
                    />
                  </>
                ) : unit.kind === 'officer' ? (
                  <>
                    <polygon
                      points={diamondTokenPoints(x, cy, tokenR)}
                      {...shapeProps}
                    />
                    <polygon
                      points={diamondTokenPoints(x, cy, tokenR * 0.86)}
                      {...kindRingProps}
                    />
                  </>
                ) : (
                  <>
                    <circle cx={x} cy={cy} r={tokenR} {...shapeProps} />
                    <circle
                      cx={x}
                      cy={cy}
                      r={tokenR * 0.86}
                      {...kindRingProps}
                    />
                  </>
                )}
                <text
                  x={x}
                  y={labelY}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#0c0e12"
                  fontSize={Math.max(
                    5,
                    hexSize * (unitTokenLabel(unit).length > 1 ? 0.38 : 0.5),
                  )}
                  fontWeight={800}
                  pointerEvents="none"
                >
                  {unitTokenLabel(unit)}
                </text>
                {companyAccent && (
                  <g pointerEvents="none">
                    <circle
                      cx={x}
                      cy={pipY}
                      r={pipR}
                      fill={companyAccent}
                      stroke="rgba(0,0,0,0.55)"
                      strokeWidth={Math.max(0.3, hexSize * 0.035)}
                    />
                    {unit.kind === 'officer' && (
                      <circle
                        cx={x}
                        cy={pipY}
                        r={pipR + hexSize * 0.05}
                        fill="none"
                        stroke={companyAccent}
                        strokeWidth={Math.max(0.35, hexSize * 0.045)}
                      />
                    )}
                  </g>
                )}
                {hp != null && (
                  <g pointerEvents="none">
                    <rect
                      x={x - barW / 2}
                      y={barY}
                      width={barW}
                      height={barH}
                      rx={barH / 2}
                      fill="#1a1f28"
                      opacity={0.85}
                    />
                    <rect
                      x={x - barW / 2}
                      y={barY}
                      width={barW * hp}
                      height={barH}
                      rx={barH / 2}
                      fill={hp > 0.35 ? '#6bcf8e' : '#e06c75'}
                    />
                  </g>
                )}
              </g>
            )
          })}
        </g>
        {combatActive && combat && combatAtkPx && combatDefPx ? (
          <g className="combat-fx" pointerEvents="none">
            <line
              x1={combatAtkPx.x}
              y1={combatAtkPx.y}
              x2={combatEndPx?.x ?? combatDefPx.x}
              y2={combatEndPx?.y ?? combatDefPx.y}
              stroke={combat.hit ? '#ffd36a' : '#9aa8c0'}
              strokeWidth={Math.max(0.7, hexSize * 0.12)}
              strokeLinecap="round"
              opacity={0.85 - combatAge / COMBAT_FX_MS * 0.5}
            />
            {combatBolt ? (
              <circle
                cx={combatBolt.x}
                cy={combatBolt.y}
                r={Math.max(1.2, hexSize * 0.18)}
                fill={combat.hit ? '#ffe08a' : '#c8d4e8'}
                opacity={0.95}
              />
            ) : null}
            <circle
              cx={combatAtkPx.x}
              cy={combatAtkPx.y}
              r={hexSize * (0.55 + 0.25 * Math.sin(Math.min(1, combatAge / 400) * Math.PI))}
              fill="none"
              stroke="#ffe08a"
              strokeWidth={Math.max(0.5, hexSize * 0.08)}
              opacity={0.7}
            />
            {combatAge > 360
              ? combatFloats(combat).map((line, i) => {
                  const fade = Math.max(0, 1 - (combatAge - 360) / 1400)
                  const rise = ((combatAge - 360) / COMBAT_FX_MS) * hexSize * 1.8
                  const fill =
                    line.tone === 'miss'
                      ? '#9ec8ff'
                      : line.tone === 'kill'
                        ? '#ffb347'
                        : line.tone === 'hit'
                          ? '#ff6b6b'
                          : '#f4f0e4'
                  return (
                    <text
                      key={`cfloat-${i}`}
                      x={combatDefPx.x}
                      y={combatDefPx.y - hexSize * 0.4 - rise - i * hexSize * 0.55}
                      textAnchor="middle"
                      fill={fill}
                      stroke="#0c0e12"
                      strokeWidth={Math.max(0.35, hexSize * 0.04)}
                      paintOrder="stroke"
                      fontSize={Math.max(5.5, hexSize * (i === 0 ? 0.42 : 0.5))}
                      fontWeight={800}
                      opacity={fade}
                    >
                      {line.text}
                    </text>
                  )
                })
              : null}
          </g>
        ) : null}
        <g className="objective-zones" pointerEvents="none">
          {objectiveZoneEdges.map((edge, i) => (
            <polygon
              key={`obj-edge-${i}`}
              points={hexPolygonPoints(edge.cx, edge.cy, hexSize - 0.15)}
              fill="none"
              stroke={edge.controller ? SEAT_OUTLINE[edge.controller] : OBJECTIVE_STROKE}
              strokeWidth={Math.max(1.4, hexSize * 0.22)}
              strokeDasharray={`${hexSize * 0.35} ${hexSize * 0.25}`}
              opacity={0.95}
            />
          ))}
        </g>
      </svg>
      </div>
    </div>
  )
}
