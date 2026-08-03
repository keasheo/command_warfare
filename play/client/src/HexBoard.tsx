import { useCallback, useMemo, useRef, useState } from 'react'
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
  TERRAIN_FILL,
  type GameState,
  type DeathRecord,
  type OddR,
  type SeatId,
  type TerrainKind,
} from '../../shared/index'
import {
  volcanicFill,
  VOLCANIC_STROKE,
  VolcanicMagmaPattern,
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

/** Primary ring — unit type. */
const KIND_OUTLINE: Record<'commander' | 'officer' | 'unit', string> = {
  commander: '#d64545',
  officer: '#3b7dd8',
  unit: '#e8e0c8',
}

/** Secondary (outer) ring — player seat. */
const SEAT_OUTLINE: Record<SeatId, string> = {
  N: '#5aa0f0',
  W: '#e07055',
  S: '#45c888',
  E: '#e0b020',
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 2.5
const ZOOM_STEP = 0.25

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

export type TerrainGhost = {
  cells: OddR[]
  kind: TerrainKind
  valid: boolean
}

type Props = {
  state: GameState
  mySeat: SeatId | null
  selectedUnitId: string | null
  onHexClick: (col: number, row: number) => void
  onHexHover?: (col: number, row: number) => void
  terrainGhost?: TerrainGhost | null
  /** Officer command radius to tint while inspecting an officer. */
  officerCrKeys?: Set<string>
  /** Deploy-phase legal hexes (officer wedge or unit officer-CR). */
  deployHintKeys?: Set<string>
  /** Company unit ids to highlight with the selected officer. */
  companyUnitIds?: Set<string>
  /** Aimed target for manual resolution. */
  targetUnitId?: string | null
  /** Card art URLs keyed by card id. */
  artByCardId?: Record<string, string>
  /** Selected grave for board highlight. */
  selectedDeathId?: string | null
  /** Show grave markers on empty hexes (Play). */
  showGraves?: boolean
  hexSize?: number
}

export function HexBoard({
  state,
  mySeat,
  selectedUnitId,
  onHexClick,
  onHexHover,
  terrainGhost = null,
  officerCrKeys,
  deployHintKeys,
  companyUnitIds,
  targetUnitId = null,
  artByCardId = {},
  selectedDeathId = null,
  showGraves = true,
  hexSize = 6,
}: Props) {
  const [hover, setHover] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const panSession = useRef<{
    startX: number
    startY: number
    startPanX: number
    startPanY: number
    viewWidth: number
    viewHeight: number
  } | null>(null)

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
      const radius = state.commanderRadii?.[seat] ?? 5
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
    const radius = state.commanderRadii?.[mySeat] ?? 5
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
      fill: string
      label?: string
      strokeW: number
      stroke: string
      graveLabel?: boolean
      graveTitle?: string
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
        let fill = TERRAIN_FILL.plains
        let strokeW = 0.35
        let stroke = '#3a4250'
        let label: string | undefined

        if (showCr) {
          const crSeat = crByHex.get(key)
          if (crSeat) {
            fill = SEAT_CR_FILL[crSeat]
          }
        }

        if (ownCrKeys.has(key) && state.terrainStage === 'commandZone') {
          fill = mySeat ? SEAT_CR_FILL[mySeat] : fill
          stroke = '#7ec8ff'
          strokeW = Math.max(strokeW, 0.7)
        }

        if (
          foreignCrKeys.has(key) &&
          (state.terrainStage === 'landLarge' ||
            state.terrainStage === 'landMedium' ||
            state.terrainStage === 'landSmall')
        ) {
          fill = FOREIGN_CR_FILL
        }

        const kind = terrain[key]
        if (kind) {
          if (kind === 'volcanic') {
            fill = volcanicFill()
            stroke = VOLCANIC_STROKE
          } else {
            fill = TERRAIN_FILL[kind]
          }
          if (kind === 'wall') label = '▮'
          else if (kind === 'water') label = '~'
          else if (kind === 'forest') label = '♣'
          else if (kind === 'desert') label = '▴'
          else if (kind === 'swamp') label = '※'
          else if (kind === 'hills') label = '⛰'
          else if (kind === 'plains') label = '·'
        }

        if (state.fortifiedHexes?.[key]) {
          stroke = '#c9a227'
          strokeW = Math.max(strokeW, 1.2)
          if (!label || label === '·') label = '⛊'
        }

        if (
          state.phase === 'Deploy' &&
          deployHintKeys &&
          deployHintKeys.has(key)
        ) {
          fill = 'rgba(80, 100, 140, 0.35)'
          stroke = '#8eb4e8'
          strokeW = Math.max(strokeW, 0.6)
        } else if (
          mySeat &&
          state.phase === 'Deploy' &&
          !deployHintKeys?.size &&
          crByHex.get(key) === mySeat &&
          !kind
        ) {
          fill = 'rgba(80, 100, 140, 0.35)'
        }

        if (col === mid && row === mid && !kind) {
          fill = 'rgba(200, 170, 60, 0.45)'
          label = '·'
          strokeW = 1
        }

        const objCell = objAt.get(key)
        if (objCell) {
          const obj = objCell.objective
          fill = obj.controller
            ? SEAT_FILL[obj.controller]
            : OBJECTIVE_NEUTRAL_FILL
          if (objCell.isAnchor) label = '★'
          stroke = OBJECTIVE_STROKE
          strokeW = 1.25
        }

        for (const seat of Object.keys(state.commanders) as SeatId[]) {
          const c = state.commanders[seat]
          if (c && c.col === col && c.row === row && !unitAt.has(key)) {
            fill = SEAT_UNIT[seat]
            label = seat
          }
        }

        const unit = unitAt.get(key)
        const graves = gravesByHex.get(key)
        if (graves?.length && showGraves && !unit) {
          fill = 'rgba(58, 52, 68, 0.55)'
          label = '†'
          stroke = '#6a6278'
          strokeW = Math.max(strokeW, 0.65)
        }
        if (unit) {
          const hasArt = Boolean(artByCardId[unit.cardId])
          fill = hasArt ? '#1a1f28' : SEAT_UNIT[unit.seat]
          label = hasArt
            ? undefined
            : unit.kind === 'commander'
              ? unit.seat
              : unit.kind === 'officer'
                ? 'O'
                : 'U'
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

        if (officerCrKeys?.has(key) && !kind && !unit) {
          fill = 'rgba(240, 208, 96, 0.2)'
        } else if (officerCrKeys?.has(key) && kind && !unit) {
          stroke = '#c4a83a'
          strokeW = Math.max(strokeW, 0.9)
        }

        if (ghostKeys.has(key) && terrainGhost) {
          stroke = terrainGhost.valid ? '#7ec8ff' : '#e07070'
          strokeW = Math.max(strokeW, 1.5)
          fill = terrainGhost.valid
            ? 'rgba(100, 180, 255, 0.45)'
            : 'rgba(220, 80, 80, 0.4)'
        }

        if (hover === key) strokeW = Math.max(strokeW, 1.2)

        const graveTitle = graves?.length
          ? `Grave: ${graves.map((g) => `${g.cardName} (${g.seat})`).join(', ')}`
          : undefined

        list.push({
          col,
          row,
          cx: x,
          cy: y,
          fill,
          label,
          strokeW,
          stroke,
          graveLabel: Boolean(graves?.length && unit),
          graveTitle,
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
    deployHintKeys,
    companyUnitIds,
    targetUnitId,
    artByCardId,
    gravesByHex,
    selectedDeath,
    selectedDeathId,
    showGraves,
  ])

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
          title="Zoom in"
          aria-label="Zoom in"
        >
          +
        </button>
        <span className="board-zoom-label">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          onClick={() => zoomBy(-ZOOM_STEP)}
          disabled={zoom <= MIN_ZOOM}
          title="Zoom out"
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
      <svg
        ref={svgRef}
        viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <defs>
          <VolcanicMagmaPattern />
          {state.units.map((u) => {
            const { x, y } = oddRToPixel(u.col, u.row, hexSize)
            return (
              <clipPath key={`clip-${u.id}`} id={`unit-clip-${u.id}`}>
                <polygon
                  points={hexPolygonPoints(x, y, hexSize - 0.45)}
                />
              </clipPath>
            )
          })}
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
          const artUrl = unit ? artByCardId[unit.cardId] : undefined
          const r = hexSize - 0.25
          const kindStroke = unit ? KIND_OUTLINE[unit.kind] : null
          const seatStroke = unit ? SEAT_OUTLINE[unit.seat] : null
          const tooltip =
            c.graveTitle && unit
              ? `${unit.cardName} · ${c.graveTitle}`
              : c.graveTitle
                ? c.graveTitle
                : unit
                  ? unit.cardName
                  : null
          return (
            <g
              key={key}
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
              <polygon
                points={hexPolygonPoints(c.cx, c.cy, r)}
                fill={c.fill}
                stroke={unit ? 'none' : c.stroke}
                strokeWidth={unit ? 0 : c.strokeW}
              />
              {unit && artUrl ? (
                <image
                  href={artUrl}
                  x={c.cx - hexSize * 0.95}
                  y={c.cy - hexSize * 0.95}
                  width={hexSize * 1.9}
                  height={hexSize * 1.9}
                  preserveAspectRatio="xMidYMid slice"
                  clipPath={`url(#unit-clip-${unit.id})`}
                />
              ) : null}
              {unit && seatStroke ? (
                <polygon
                  points={hexPolygonPoints(c.cx, c.cy, r)}
                  fill="none"
                  stroke={seatStroke}
                  strokeWidth={Math.max(1.6, hexSize * 0.28)}
                />
              ) : null}
              {unit && kindStroke ? (
                <polygon
                  points={hexPolygonPoints(c.cx, c.cy, r - 0.55)}
                  fill="none"
                  stroke={kindStroke}
                  strokeWidth={Math.max(1.1, hexSize * 0.18)}
                />
              ) : null}
              {unit &&
              (selectedUnitId === unit.id ||
                targetUnitId === unit.id ||
                companyUnitIds?.has(unit.id)) ? (
                <polygon
                  points={hexPolygonPoints(c.cx, c.cy, r + 0.35)}
                  fill="none"
                  stroke={c.stroke}
                  strokeWidth={Math.max(0.8, c.strokeW * 0.7)}
                  strokeOpacity={0.95}
                />
              ) : null}
              {c.label ? (
                <text
                  x={c.cx}
                  y={c.cy + hexSize * 0.12}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#0c0e12"
                  fontSize={Math.max(5, hexSize * 0.7)}
                  fontWeight={700}
                >
                  {c.label}
                </text>
              ) : null}
              {c.graveLabel ? (
                <text
                  x={c.cx + hexSize * 0.55}
                  y={c.cy + hexSize * 0.55}
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
  )
}
