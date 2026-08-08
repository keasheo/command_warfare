/**
 * Three.js hex board — interlocking terrain blocks, billboard units, raycast clicks.
 */
import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  BOARD_SIZE,
  boardMid,
  commandRadiusKeys,
  foreignCommandRadiusKeys,
  hexKey,
  objectiveZoneHexes,
  parseHexKey,
  type DeathRecord,
  type SeatId,
  type TerrainKind,
  type UnitToken,
} from '../../shared/index'
import {
  animateTerrainDetails,
  createHexOverlayMesh,
  createTerrainBlockGroup,
  disposeTerrainObject,
  hashString,
  hexTerrainVariant,
  oddRToWorld3D,
  TERRAIN_BLOCK_HEIGHT,
} from './hexTerrainMesh'
import type { HexBoardProps, TerrainGhost } from './HexBoard'

export type { TerrainGhost }

const SEAT_COLOR: Record<SeatId, number> = {
  N: 0x468cdc,
  W: 0xc85a46,
  S: 0x3ca06e,
  E: 0xb48228,
}

const SEAT_CR_TINT: Record<SeatId, number> = {
  N: 0x468cdc,
  W: 0xc85a46,
  S: 0x3ca06e,
  E: 0xb48228,
}

const OBJECTIVE_GOLD = 0xdcb450
const FOREIGN_CR = 0xa03232
const DEPLOY_HINT = 0x5080c0
const GHOST_VALID = 0x64b4ff
const GHOST_INVALID = 0xdc5050
const HOVER_FILL = 0xb8f4ff
const HOVER_RING = 0xffffff
const DRAG_THRESHOLD_SQ = 36

function unitLabel(unit: UnitToken): string {
  if (unit.kind === 'commander') return unit.seat
  if (unit.kind === 'officer') return 'O'
  return 'U'
}

function makeDiscTexture(label: string, fill: string): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, size, size)
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size * 0.44, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.lineWidth = 4
  ctx.stroke()
  ctx.fillStyle = '#0c0e12'
  ctx.font = `800 ${Math.floor(size * 0.38)}px Segoe UI, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, size / 2, size / 2 + 2)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function ensureHoverOverlayMeshes(
  hexRadius: number,
  hoverOverlayRef: MutableRefObject<{ fill: THREE.Mesh; ring: THREE.Mesh } | null>,
): { fill: THREE.Mesh; ring: THREE.Mesh } {
  if (!hoverOverlayRef.current) {
    const fill = createHexOverlayMesh(hexRadius, HOVER_FILL, 0.48, 0)
    fill.renderOrder = 20
    fill.visible = false
    const ring = createHexOverlayMesh(hexRadius * 1.012, HOVER_RING, 0.55, 0)
    ring.renderOrder = 21
    ring.scale.y = 0.1
    ring.visible = false
    hoverOverlayRef.current = { fill, ring }
  }
  return hoverOverlayRef.current
}

function isPointerDragging(
  start: { x: number; y: number } | null,
  clientX: number,
  clientY: number,
): boolean {
  if (!start) return false
  const dx = clientX - start.x
  const dy = clientY - start.y
  return dx * dx + dy * dy > DRAG_THRESHOLD_SQ
}

function loadCardTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader()
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        resolve(tex)
      },
      undefined,
      reject,
    )
  })
}

function addUnitBillboard(
  cell: THREE.Group,
  unit: UnitToken,
  topY: number,
  hexSize: number,
  artByCardId: Record<string, string>,
  sceneGen: number,
  isSceneCurrent: () => boolean,
): void {
  const floatY = topY + hexSize * 0.65
  const spriteScale = hexSize * (unit.kind === 'commander' ? 1.2 : 1.05)
  const seatHex = `#${SEAT_COLOR[unit.seat].toString(16).padStart(6, '0')}`

  const mountSprite = (tex: THREE.Texture, aspect = 1) => {
    if (!isSceneCurrent()) {
      tex.dispose()
      return
    }
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    )
    sprite.renderOrder = 10
    sprite.scale.set(spriteScale, spriteScale * aspect, 1)
    sprite.position.y = floatY
    cell.add(sprite)
  }

  const artUrl = artByCardId[unit.cardId]
  if (artUrl) {
    const gen = sceneGen
    loadCardTexture(artUrl)
      .then((tex) => {
        if (!isSceneCurrent() || gen !== sceneGen) {
          tex.dispose()
          return
        }
        mountSprite(tex, 1.35)
      })
      .catch(() => {
        if (!isSceneCurrent() || gen !== sceneGen) return
        mountSprite(makeDiscTexture(unitLabel(unit), seatHex))
      })
  } else {
    mountSprite(makeDiscTexture(unitLabel(unit), seatHex))
  }
}

function blockTopY(kind: TerrainKind): number {
  return TERRAIN_BLOCK_HEIGHT[kind]
}

type SceneCtx = {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  boardGroup: THREE.Group
  hexPickables: THREE.Object3D[]
  raycaster: THREE.Raycaster
  pointer: THREE.Vector2
  animId: number
  disposed: boolean
}

export function HexBoard3D({
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
}: HexBoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctxRef = useRef<SceneCtx | null>(null)
  const hoverHexRef = useRef<string | null>(null)
  const hoverOverlayRef = useRef<{ fill: THREE.Mesh; ring: THREE.Mesh } | null>(null)
  const sceneGenRef = useRef(0)
  const pointerDragRef = useRef<{ x: number; y: number } | null>(null)
  const cameraInitializedRef = useRef(false)

  const unitAt = useMemo(() => {
    const m = new Map<string, UnitToken>()
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

  const ghostKeys = useMemo(() => {
    const s = new Set<string>()
    if (!terrainGhost) return s
    for (const c of terrainGhost.cells) s.add(hexKey(c.col, c.row))
    return s
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

  const boardBounds = useMemo(() => {
    const n = state.boardSize || BOARD_SIZE
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const { x, z } = oddRToWorld3D(col, row, hexSize)
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minZ = Math.min(minZ, z)
        maxZ = Math.max(maxZ, z)
      }
    }
    const pad = hexSize * 2
    return {
      minX: minX - pad,
      maxX: maxX + pad,
      minZ: minZ - pad,
      maxZ: maxZ + pad,
      centerX: (minX + maxX) / 2,
      centerZ: (minZ + maxZ) / 2,
      span: Math.max(maxX - minX, maxZ - minZ) + pad * 2,
    }
  }, [state.boardSize, hexSize])

  const pickHex = useCallback(
    (clientX: number, clientY: number): { col: number; row: number } | null => {
      const ctx = ctxRef.current
      const canvas = canvasRef.current
      if (!ctx || !canvas) return null
      const rect = canvas.getBoundingClientRect()
      ctx.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
      ctx.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
      ctx.raycaster.setFromCamera(ctx.pointer, ctx.camera)
      const hits = ctx.raycaster.intersectObjects(ctx.hexPickables, false)
      if (!hits.length) return null
      const ud = hits[0]!.object.userData as { col?: number; row?: number }
      if (ud.col == null || ud.row == null) return null
      return { col: ud.col, row: ud.row }
    },
    [],
  )

  const setHoverVisual = useCallback(
    (col: number | null, row: number | null) => {
      const ctx = ctxRef.current
      const overlays = hoverOverlayRef.current
      if (!ctx || !overlays) return
      const { fill, ring } = overlays
      if (col == null || row == null) {
        fill.visible = false
        ring.visible = false
        return
      }
      const key = hexKey(col, row)
      const kind = state.terrain?.[key] ?? 'plains'
      const topY = blockTopY(kind)
      const { x, z } = oddRToWorld3D(col, row, hexSize)
      fill.position.set(x, topY + 0.14, z)
      ring.position.set(x, topY + 0.18, z)
      fill.visible = true
      ring.visible = true
    },
    [state.terrain, hexSize],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = false
    const skyColor = 0xb0bcc8
    renderer.setClearColor(skyColor, 1)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.45

    const scene = new THREE.Scene()

    const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 400)
    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI / 2.15
    controls.minDistance = 20
    controls.maxDistance = 180
    controls.screenSpacePanning = true

    const boardGroup = new THREE.Group()
    scene.add(boardGroup)

    const hemi = new THREE.HemisphereLight(0xe8f0ff, 0x889880, 1.15)
    const ambient = new THREE.AmbientLight(0xffffff, 1.05)
    const sun = new THREE.DirectionalLight(0xfff4e8, 2.4)
    sun.position.set(40, 80, 35)
    sun.castShadow = false
    scene.add(hemi, ambient, sun)

    const fill = new THREE.DirectionalLight(0xc0d8f8, 1.1)
    fill.position.set(-35, 40, -45)
    scene.add(fill)

    const rim = new THREE.DirectionalLight(0xffecd8, 0.65)
    rim.position.set(-10, 50, 60)
    scene.add(rim)

    const ctx: SceneCtx = {
      renderer,
      scene,
      camera,
      controls,
      boardGroup,
      hexPickables: [],
      raycaster: new THREE.Raycaster(),
      pointer: new THREE.Vector2(),
      animId: 0,
      disposed: false,
    }
    ctxRef.current = ctx

    const tick = () => {
      if (ctx.disposed) return
      ctx.animId = requestAnimationFrame(tick)
      controls.update()
      animateTerrainDetails(ctx.boardGroup, performance.now() * 0.001)
      renderer.render(scene, camera)
    }
    tick()

    const resize = () => {
      const parent = canvas.parentElement
      if (!parent) return
      const w = parent.clientWidth
      const h = parent.clientHeight
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    if (canvas.parentElement) ro.observe(canvas.parentElement)
    resize()

    return () => {
      ctx.disposed = true
      cancelAnimationFrame(ctx.animId)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      ctxRef.current = null
    }
  }, [])

  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return

    sceneGenRef.current += 1
    const sceneGen = sceneGenRef.current
    const isSceneCurrent = () => ctxRef.current === ctx && sceneGenRef.current === sceneGen

    const { boardGroup, camera, controls, hexPickables } = ctx
    while (boardGroup.children.length) {
      const child = boardGroup.children[0]!
      const hoverOverlays = hoverOverlayRef.current
      if (hoverOverlays && (child === hoverOverlays.fill || child === hoverOverlays.ring)) {
        boardGroup.remove(child)
        continue
      }
      boardGroup.remove(child)
      disposeTerrainObject(child)
    }
    hexPickables.length = 0

    const n = state.boardSize || BOARD_SIZE
    const mid = boardMid(n)
    const terrain = state.terrain ?? {}
    const hexRadius = hexSize
    const hoverOverlays = ensureHoverOverlayMeshes(hexRadius, hoverOverlayRef)
    const showCr =
      Object.keys(state.commanders).length > 0 &&
      (state.phase === 'Commanders' ||
        state.phase === 'Objectives' ||
        state.phase === 'Terrain')

    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const key = hexKey(col, row)
        const kind = terrain[key] ?? 'plains'
        const { variant, rotation } = hexTerrainVariant(state.roomCode, col, row)
        const { x, z } = oddRToWorld3D(col, row, hexSize)
        const topY = blockTopY(kind)

        const cell = new THREE.Group()
        cell.position.set(x, 0, z)
        boardGroup.add(cell)

        const detailSeed = hashString(`${state.roomCode}:detail:${col},${row}`)
        const block = createTerrainBlockGroup(
          kind,
          variant,
          rotation,
          hexRadius,
          detailSeed,
        )
        cell.add(block)

        const pickMesh = block.children[0] as THREE.Mesh
        pickMesh.userData = { col, row }
        hexPickables.push(pickMesh)

        const overlays: THREE.Mesh[] = []

        if (showCr) {
          const crSeat = crByHex.get(key)
          if (crSeat) {
            overlays.push(
              createHexOverlayMesh(hexRadius, SEAT_CR_TINT[crSeat], 0.22, topY + 0.03),
            )
          }
        }

        if (ownCrKeys.has(key) && state.terrainStage === 'commandZone') {
          if (mySeat) {
            overlays.push(
              createHexOverlayMesh(hexRadius, SEAT_CR_TINT[mySeat], 0.28, topY + 0.04),
            )
          }
        }

        if (
          foreignCrKeys.has(key) &&
          (state.terrainStage === 'landLarge' ||
            state.terrainStage === 'landMedium' ||
            state.terrainStage === 'landSmall')
        ) {
          overlays.push(createHexOverlayMesh(hexRadius, FOREIGN_CR, 0.3, topY + 0.04))
        }

        if (state.phase === 'Deploy' && deployHintKeys?.has(key)) {
          overlays.push(createHexOverlayMesh(hexRadius, DEPLOY_HINT, 0.35, topY + 0.05))
        }

        const objCell = objAt.get(key)
        if (objCell) {
          const tint = objCell.objective.controller
            ? SEAT_CR_TINT[objCell.objective.controller]
            : OBJECTIVE_GOLD
          overlays.push(createHexOverlayMesh(hexRadius, tint, 0.42, topY + 0.06))
          if (objCell.isAnchor) {
            const starTex = makeDiscTexture('★', '#e8c040')
            const star = new THREE.Sprite(
              new THREE.SpriteMaterial({ map: starTex, transparent: true, depthTest: false }),
            )
            star.scale.set(hexSize * 0.55, hexSize * 0.55, 1)
            star.position.y = topY + hexSize * 0.45
            star.renderOrder = 5
            cell.add(star)
          }
        }

        if (col === mid && row === mid && !terrain[key]) {
          overlays.push(createHexOverlayMesh(hexRadius, OBJECTIVE_GOLD, 0.35, topY + 0.05))
        }

        if (officerCrKeys?.has(key)) {
          overlays.push(createHexOverlayMesh(hexRadius, 0xf0d060, 0.2, topY + 0.05))
        }

        if (ghostKeys.has(key) && terrainGhost) {
          overlays.push(
            createHexOverlayMesh(
              hexRadius,
              terrainGhost.valid ? GHOST_VALID : GHOST_INVALID,
              0.45,
              topY + 0.08,
            ),
          )
        }

        if (state.fortifiedHexes?.[key]) {
          overlays.push(createHexOverlayMesh(hexRadius, 0xc9a227, 0.35, topY + 0.05))
        }

        for (const o of overlays) cell.add(o)

        const unit = unitAt.get(key)
        if (unit) {
          addUnitBillboard(
            cell,
            unit,
            topY,
            hexSize,
            artByCardId,
            sceneGen,
            isSceneCurrent,
          )

          const isSelected = selectedUnitId === unit.id
          const isTarget = targetUnitId === unit.id
          const inCompany = companyUnitIds?.has(unit.id)
          if (isSelected || isTarget || inCompany) {
            const ringColor = isTarget ? 0xe07070 : isSelected ? 0x7ec8ff : 0xf0d060
            const floatY = topY + hexSize * 0.65
            const ring = createHexOverlayMesh(hexRadius * 0.55, ringColor, 0.75, floatY - 0.05)
            ring.scale.y = 0.15
            cell.add(ring)
          }
        }

        const graves = gravesByHex.get(key)
        if (graves?.length && showGraves && !unit) {
          const graveTex = makeDiscTexture('†', '#3a3444')
          const grave = new THREE.Sprite(
            new THREE.SpriteMaterial({ map: graveTex, transparent: true, opacity: 0.85 }),
          )
          grave.scale.set(hexSize * 0.4, hexSize * 0.4, 1)
          grave.position.y = topY + hexSize * 0.25
          cell.add(grave)
        }
      }
    }

    boardGroup.add(hoverOverlays.fill)
    boardGroup.add(hoverOverlays.ring)
    if (hoverHexRef.current) {
      const { col, row } = parseHexKey(hoverHexRef.current)
      const key = hexKey(col, row)
      const kind = terrain[key] ?? 'plains'
      const topY = blockTopY(kind)
      const { x, z } = oddRToWorld3D(col, row, hexSize)
      hoverOverlays.fill.position.set(x, topY + 0.14, z)
      hoverOverlays.ring.position.set(x, topY + 0.18, z)
      hoverOverlays.fill.visible = true
      hoverOverlays.ring.visible = true
    } else {
      hoverOverlays.fill.visible = false
      hoverOverlays.ring.visible = false
    }

    const { centerX, centerZ, span } = boardBounds
    boardGroup.position.set(-centerX, 0, -centerZ)

    if (!cameraInitializedRef.current) {
      const dist = span * 0.85
      camera.position.set(dist * 0.55, dist * 0.65, dist * 0.55)
      controls.target.set(0, 0, 0)
      controls.update()
      cameraInitializedRef.current = true
    }
  }, [
    state,
    mySeat,
    unitAt,
    objAt,
    ghostKeys,
    terrainGhost,
    crByHex,
    ownCrKeys,
    foreignCrKeys,
    deployHintKeys,
    officerCrKeys,
    selectedUnitId,
    targetUnitId,
    companyUnitIds,
    artByCardId,
    gravesByHex,
    showGraves,
    hexSize,
    boardBounds,
  ])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      pointerDragRef.current = { x: e.clientX, y: e.clientY }
    }

    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return
      const start = pointerDragRef.current
      pointerDragRef.current = null
      if (!start) return
      if (isPointerDragging(start, e.clientX, e.clientY)) return
      const hex = pickHex(e.clientX, e.clientY)
      if (hex) onHexClick(hex.col, hex.row)
    }

    const applyHover = (clientX: number, clientY: number) => {
      if (isPointerDragging(pointerDragRef.current, clientX, clientY)) {
        if (hoverHexRef.current !== null) {
          hoverHexRef.current = null
          setHoverVisual(null, null)
        }
        return
      }
      const hex = pickHex(clientX, clientY)
      const key = hex ? hexKey(hex.col, hex.row) : null
      if (key !== hoverHexRef.current) {
        hoverHexRef.current = key
        if (hex) onHexHover?.(hex.col, hex.row)
      }
      if (hex) {
        setHoverVisual(hex.col, hex.row)
      } else {
        setHoverVisual(null, null)
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      applyHover(e.clientX, e.clientY)
    }

    const onPointerLeave = () => {
      hoverHexRef.current = null
      setHoverVisual(null, null)
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerleave', onPointerLeave)
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerleave', onPointerLeave)
    }
  }, [onHexClick, onHexHover, pickHex, setHoverVisual])

  return (
    <div className="board-wrap board-wrap-3d">
      <div className="board-viewport board-viewport-3d">
        <canvas ref={canvasRef} className="board-3d-canvas" />
      </div>
      <p className="board-3d-hint">Drag to orbit · scroll to zoom · right-drag to pan</p>
    </div>
  )
}
