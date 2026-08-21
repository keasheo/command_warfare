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
  DEFAULT_COMMANDER_COMMAND_RADIUS,
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
import { DEFAULT_HEX_SIZE } from './HexBoard'
import { COMBAT_FX_MS, combatFloats, combatResultKey } from './combatFx'
import {
  companyAccentColor,
  drawUnitTokenCanvas,
  SEAT_TOKEN_FILL,
  unitTokenLabel,
} from './unitTokenVisuals'

export type { TerrainGhost }

const SEAT_CR_TINT: Record<SeatId, number> = {
  N: 0x468cdc,
  W: 0xc85a46,
  S: 0x3ca06e,
  E: 0xb48228,
}

const OBJECTIVE_GOLD = 0xdcb450
const MOVE_PREVIEW = 0x38be5c
const ATTACK_PREVIEW = 0xdc4040
const OFFICER_CR_BLUE = 0x4084e6
const FLASH_GOLD = 0xffd65a
const FOREIGN_CR = 0xa03232
const DEPLOY_HINT = 0x5080c0
const GHOST_VALID = 0x64b4ff
const GHOST_INVALID = 0xdc5050
const HOVER_FILL = 0xb8f4ff
const HOVER_RING = 0xffffff
const DRAG_THRESHOLD_SQ = 36

function makeTokenTexture(unit: UnitToken): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  drawUnitTokenCanvas(ctx, size, {
    label: unitTokenLabel(unit),
    seatFill: SEAT_TOKEN_FILL[unit.seat],
    kind: unit.kind,
    companyAccent: companyAccentColor(unit),
  })
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Simple disc for non-unit markers (objectives, graves). */
function makeCombatTextTexture(text: string, fill: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 96
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, 256, 96)
  ctx.font = '800 42px Segoe UI, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.strokeStyle = '#0c0e12'
  ctx.lineWidth = 8
  ctx.strokeText(text, 128, 48)
  ctx.fillStyle = fill
  ctx.fillText(text, 128, 48)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
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

function addUnitBillboard(
  cell: THREE.Group,
  unit: UnitToken,
  topY: number,
  hexSize: number,
  opacity = 1,
): void {
  const floatY = topY + hexSize * 0.65
  const spriteScale =
    hexSize *
    (unit.kind === 'commander' ? 1.25 : unit.kind === 'officer' ? 1.12 : 1.0)
  const tex = makeTokenTexture(unit)
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      opacity,
    }),
  )
  sprite.renderOrder = 10
  sprite.scale.set(spriteScale, spriteScale, 1)
  sprite.position.y = floatY
  cell.add(sprite)
}

function blockTopY(kind: TerrainKind): number {
  return TERRAIN_BLOCK_HEIGHT[kind]
}

/** Pull the camera back far enough to see the whole map (isometric-ish). */
function frameBoardOverview(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  span: number,
): void {
  const dist = Math.max(span * 2.0, 200)
  camera.position.set(dist * 0.25, dist * 0.70, dist * 0.25)
  controls.target.set(0, 0, 0)
  controls.maxDistance = Math.max(controls.maxDistance, dist * 1.4)
  camera.far = Math.max(camera.far, dist * 6)
  camera.updateProjectionMatrix()
  controls.update()
}

type SceneCtx = {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  boardGroup: THREE.Group
  fxGroup: THREE.Group
  hexPickables: THREE.Object3D[]
  raycaster: THREE.Raycaster
  pointer: THREE.Vector2
  animId: number
  disposed: boolean
  combatKey: string | null
  combatLive: {
    start: number
    from: THREE.Vector3
    to: THREE.Vector3
    bolt: THREE.Mesh
    floats: THREE.Sprite[]
    hexSize: number
  } | null
  camTween: {
    start: number
    duration: number
    fromPos: THREE.Vector3
    fromTarget: THREE.Vector3
    toPos: THREE.Vector3
    toTarget: THREE.Vector3
  } | null
}

export function HexBoard3D({
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
  cameraFocus = null,
  deployHintKeys,
  companyUnitIds,
  targetUnitId = null,
  selectedDeathId = null,
  showGraves = true,
  hexSize = DEFAULT_HEX_SIZE,
}: HexBoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctxRef = useRef<SceneCtx | null>(null)
  const hoverHexRef = useRef<string | null>(null)
  const hoverOverlayRef = useRef<{ fill: THREE.Mesh; ring: THREE.Mesh } | null>(null)
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

    const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 2000)
    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI / 2.15
    controls.minDistance = 20
    controls.maxDistance = 720
    controls.screenSpacePanning = true
    controls.enableZoom = false

    const boardGroup = new THREE.Group()
    scene.add(boardGroup)
    const fxGroup = new THREE.Group()
    scene.add(fxGroup)

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
      fxGroup,
      hexPickables: [],
      raycaster: new THREE.Raycaster(),
      pointer: new THREE.Vector2(),
      animId: 0,
      disposed: false,
      combatKey: null,
      combatLive: null,
      camTween: null,
    }
    ctxRef.current = ctx

    frameBoardOverview(
      camera,
      controls,
      DEFAULT_HEX_SIZE * Math.sqrt(3) * BOARD_SIZE,
    )

    const tick = () => {
      if (ctx.disposed) return
      ctx.animId = requestAnimationFrame(tick)
      const cam = ctx.camTween
      if (cam) {
        const u = Math.min(1, (performance.now() - cam.start) / cam.duration)
        const e = u * u * (3 - 2 * u)
        camera.position.lerpVectors(cam.fromPos, cam.toPos, e)
        controls.target.lerpVectors(cam.fromTarget, cam.toTarget, e)
        if (u >= 1) ctx.camTween = null
      }
      controls.update()
      ctx.fxGroup.position.copy(ctx.boardGroup.position)
      const live = ctx.combatLive
      if (live) {
        const age = performance.now() - live.start
        const t = age / COMBAT_FX_MS
        if (t >= 1) {
          while (ctx.fxGroup.children.length) {
            const child = ctx.fxGroup.children[0]!
            ctx.fxGroup.remove(child)
            disposeTerrainObject(child)
          }
          ctx.combatLive = null
        } else {
          const boltT = Math.min(1, age / 380)
          live.bolt.position.lerpVectors(live.from, live.to, boltT)
          live.bolt.visible = age < 900
          const rise = (Math.max(0, age - 360) / COMBAT_FX_MS) * live.hexSize * 1.6
          const fade = Math.max(0, 1 - Math.max(0, age - 360) / 1400)
          live.floats.forEach((sprite, i) => {
            sprite.position.y = live.to.y + live.hexSize * 0.4 + rise + i * live.hexSize * 0.35
            const mat = sprite.material as THREE.SpriteMaterial
            mat.opacity = fade
            sprite.visible = age > 360
          })
        }
      }
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

    const onShiftZoom = (event: WheelEvent) => {
      if (!event.shiftKey) return
      event.preventDefault()
      const offset = camera.position.clone().sub(controls.target)
      const factor = event.deltaY > 0 ? 1.12 : 0.9
      const next = THREE.MathUtils.clamp(
        offset.length() * factor,
        controls.minDistance,
        controls.maxDistance,
      )
      offset.setLength(next)
      camera.position.copy(controls.target).add(offset)
    }
    canvas.addEventListener('wheel', onShiftZoom, { passive: false })

    return () => {
      ctx.disposed = true
      cancelAnimationFrame(ctx.animId)
      canvas.removeEventListener('wheel', onShiftZoom)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      ctxRef.current = null
    }
  }, [])

  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return

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
          overlays.push(
            createHexOverlayMesh(hexRadius, OFFICER_CR_BLUE, 0.28, topY + 0.05),
          )
        }
        if (movePreviewKeys?.has(key)) {
          overlays.push(
            createHexOverlayMesh(hexRadius, MOVE_PREVIEW, 0.38, topY + 0.07),
          )
        }
        if (attackPreviewKeys?.has(key)) {
          overlays.push(
            createHexOverlayMesh(
              hexRadius * (movePreviewKeys?.has(key) ? 0.78 : 1),
              ATTACK_PREVIEW,
              movePreviewKeys?.has(key) ? 0.55 : 0.34,
              topY + 0.09,
            ),
          )
        }
        if (flashHexKeys?.has(key)) {
          overlays.push(
            createHexOverlayMesh(hexRadius, FLASH_GOLD, 0.5, topY + 0.12),
          )
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
          addUnitBillboard(cell, unit, topY, hexSize, dimmed ? 0.38 : 1)

          const isSelected = selectedUnitId === unit.id
          const isTarget = targetUnitId === unit.id
          const inCompany = companyUnitIds?.has(unit.id) || inActiveCompany
          if (isSelected || isTarget || inCompany) {
            const ringColor = isTarget
              ? 0xe07070
              : isSelected
                ? 0x7ec8ff
                : inActiveCompany
                  ? 0x6ee0a8
                  : 0xf0d060
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
      frameBoardOverview(camera, controls, span)
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
    movePreviewKeys,
    attackPreviewKeys,
    flashHexKeys,
    activeCompanyIds,
    selectedUnitId,
    targetUnitId,
    companyUnitIds,
    gravesByHex,
    showGraves,
    hexSize,
    boardBounds,
  ])

  useEffect(() => {
    const ctx = ctxRef.current
    const combat = state.lastCombatResult
    if (!ctx || !combat) return
    const key = combatResultKey(combat)
    if (ctx.combatKey === key) return
    ctx.combatKey = key

    while (ctx.fxGroup.children.length) {
      const child = ctx.fxGroup.children[0]!
      ctx.fxGroup.remove(child)
      disposeTerrainObject(child)
    }

    const atkKind =
      state.terrain?.[hexKey(combat.attackerCol, combat.attackerRow)] ?? 'plains'
    const defKind =
      state.terrain?.[hexKey(combat.defenderCol, combat.defenderRow)] ?? 'plains'
    const fromXZ = oddRToWorld3D(combat.attackerCol, combat.attackerRow, hexSize)
    const pierceEnd = combat.pierceHits?.length
      ? combat.pierceHits[combat.pierceHits.length - 1]
      : null
    const toXZ = oddRToWorld3D(
      pierceEnd?.col ?? combat.defenderCol,
      pierceEnd?.row ?? combat.defenderRow,
      hexSize,
    )
    const from = new THREE.Vector3(
      fromXZ.x,
      blockTopY(atkKind) + hexSize * 0.7,
      fromXZ.z,
    )
    const to = new THREE.Vector3(
      toXZ.x,
      blockTopY(defKind) + hexSize * 0.7,
      toXZ.z,
    )

    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([from, to]),
      new THREE.LineBasicMaterial({
        color: combat.hit ? 0xffd36a : 0x9aa8c0,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      }),
    )
    line.renderOrder = 30
    ctx.fxGroup.add(line)

    const bolt = new THREE.Mesh(
      new THREE.SphereGeometry(hexSize * 0.12, 10, 10),
      new THREE.MeshBasicMaterial({
        color: combat.hit ? 0xffe08a : 0xc8d4e8,
        depthTest: false,
      }),
    )
    bolt.position.copy(from)
    bolt.renderOrder = 31
    ctx.fxGroup.add(bolt)

    const floats: THREE.Sprite[] = []
    for (const lineText of combatFloats(combat)) {
      const fill =
        lineText.tone === 'miss'
          ? '#9ec8ff'
          : lineText.tone === 'kill'
            ? '#ffb347'
            : lineText.tone === 'hit'
              ? '#ff6b6b'
              : '#f4f0e4'
      const tex = makeCombatTextTexture(lineText.text, fill)
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: tex,
          transparent: true,
          depthTest: false,
          opacity: 0,
        }),
      )
      sprite.scale.set(hexSize * 2.2, hexSize * 0.85, 1)
      sprite.position.copy(to)
      sprite.visible = false
      sprite.renderOrder = 32
      ctx.fxGroup.add(sprite)
      floats.push(sprite)
    }

    ctx.combatLive = {
      start: performance.now(),
      from,
      to,
      bolt,
      floats,
      hexSize,
    }
  }, [state.lastCombatResult, state.terrain, hexSize])

  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx || !cameraFocus) return
    const { x, z } = oddRToWorld3D(cameraFocus.col, cameraFocus.row, hexSize)
    const key = hexKey(cameraFocus.col, cameraFocus.row)
    const kind = state.terrain?.[key] ?? 'plains'
    const y = blockTopY(kind)
    const look = new THREE.Vector3(x, y, z).add(ctx.boardGroup.position)
    const fromTarget = ctx.controls.target.clone()
    const fromPos = ctx.camera.position.clone()
    const delta = look.clone().sub(fromTarget)
    delta.y = 0
    if (delta.length() < 0.4) return
    delta.multiplyScalar(0.55)
    ctx.camTween = {
      start: performance.now(),
      duration: 420,
      fromPos,
      fromTarget,
      toPos: fromPos.clone().add(delta),
      toTarget: fromTarget.clone().add(delta),
    }
  }, [cameraFocus?.nonce, cameraFocus?.col, cameraFocus?.row, hexSize, state.terrain])

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
          onHoverEnd?.()
        }
        return
      }
      const hex = pickHex(clientX, clientY)
      const key = hex ? hexKey(hex.col, hex.row) : null
      if (key !== hoverHexRef.current) {
        hoverHexRef.current = key
        if (hex) onHexHover?.(hex.col, hex.row)
        else onHoverEnd?.()
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
      onHoverEnd?.()
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
  }, [onHexClick, onHexHover, onHoverEnd, pickHex, setHoverVisual])

  return (
    <div className="board-wrap board-wrap-3d">
      <div className="board-viewport board-viewport-3d">
        <canvas ref={canvasRef} className="board-3d-canvas" />
      </div>
      <p className="board-3d-hint">Drag to orbit · Shift+scroll to zoom · right-drag to pan</p>
    </div>
  )
}
