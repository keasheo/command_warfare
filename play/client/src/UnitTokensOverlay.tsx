/**
 * WebGL unit tokens overlaid on the SVG hex board.
 * SVG keeps click/hover fidelity; this layer is pointer-events:none.
 *
 * Prototype: low-poly meshes by unit kind + seat color. Not per-card glTF.
 */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { oddRToPixel, type SeatId, type UnitKind, type UnitToken } from '../../shared/index'

const SEAT_COLOR: Record<SeatId, number> = {
  N: 0x468cdc,
  W: 0xc85a46,
  S: 0x3ca06e,
  E: 0xb48228,
}

const KIND_HEIGHT: Record<UnitKind, number> = {
  commander: 2.4,
  officer: 1.65,
  unit: 1.05,
}

const KIND_RADIUS: Record<UnitKind, number> = {
  commander: 0.55,
  officer: 0.42,
  unit: 0.34,
}

export type ViewBox = {
  x: number
  y: number
  width: number
  height: number
}

type Props = {
  units: UnitToken[]
  hexSize: number
  viewBox: ViewBox
  selectedUnitId: string | null
  targetUnitId: string | null
  companyUnitIds?: Set<string>
}

function makeLabelTexture(text: string, color: string): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, size, size)
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = color
  ctx.font = `bold ${Math.floor(size * 0.42)}px Segoe UI, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, size / 2, size / 2 + 2)
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

function unitLabel(unit: UnitToken): string {
  if (unit.kind === 'commander') return `C${unit.seat}`
  if (unit.kind === 'officer') return 'O'
  return 'U'
}

function hpRatio(unit: UnitToken): number {
  if (unit.toughness == null || unit.toughness <= 0) return 1
  const cur = unit.toughnessCurrent ?? unit.toughness
  return Math.max(0, Math.min(1, cur / unit.toughness))
}

export function UnitTokensOverlay({
  units,
  hexSize,
  viewBox,
  selectedUnitId,
  targetUnitId,
  companyUnitIds,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.OrthographicCamera
    meshes: Map<string, THREE.Group>
    animId: number
  } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(0, 1, 0, 1, 0.1, 200)
    camera.position.set(0, 0, 50)

    const ambient = new THREE.AmbientLight(0xffffff, 0.55)
    const dir = new THREE.DirectionalLight(0xfff0d8, 0.85)
    dir.position.set(1, -1.2, 2)
    scene.add(ambient, dir)

    sceneRef.current = {
      renderer,
      scene,
      camera,
      meshes: new Map(),
      animId: 0,
    }

    return () => {
      cancelAnimationFrame(sceneRef.current?.animId ?? 0)
      for (const g of sceneRef.current?.meshes.values() ?? []) {
        scene.remove(g)
        g.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose()
            if (Array.isArray(obj.material)) {
              obj.material.forEach((m) => m.dispose())
            } else {
              obj.material.dispose()
            }
          }
          if (obj instanceof THREE.Sprite) {
            const mat = obj.material as THREE.SpriteMaterial
            mat.map?.dispose()
            mat.dispose()
          }
        })
      }
      renderer.dispose()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = sceneRef.current
    if (!canvas || !ctx) return

    const resize = () => {
      const parent = canvas.parentElement
      if (!parent) return
      ctx.renderer.setSize(parent.clientWidth, parent.clientHeight, false)
      ctx.renderer.render(ctx.scene, ctx.camera)
    }

    const ro = new ResizeObserver(resize)
    if (canvas.parentElement) ro.observe(canvas.parentElement)

    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const ctx = sceneRef.current
    if (!ctx) return

    const { renderer, scene, camera, meshes } = ctx
    const parent = canvasRef.current?.parentElement
    if (parent) {
      const w = parent.clientWidth
      const h = parent.clientHeight
      renderer.setSize(w, h, false)
    }

    camera.left = viewBox.x
    camera.right = viewBox.x + viewBox.width
    camera.top = viewBox.y
    camera.bottom = viewBox.y + viewBox.height
    camera.updateProjectionMatrix()

    const activeIds = new Set(units.map((u) => u.id))

    for (const [id, group] of meshes) {
      if (!activeIds.has(id)) {
        scene.remove(group)
        meshes.delete(id)
      }
    }

    for (const unit of units) {
      const { x, y } = oddRToPixel(unit.col, unit.row, hexSize)
      let group = meshes.get(unit.id)

      if (!group) {
        group = new THREE.Group()
        meshes.set(unit.id, group)
        scene.add(group)

        const seatColor = SEAT_COLOR[unit.seat]
        const h = KIND_HEIGHT[unit.kind]
        const r = KIND_RADIUS[unit.kind]

        let body: THREE.Mesh
        if (unit.kind === 'commander') {
          const geo = new THREE.CylinderGeometry(r * 0.85, r, h, 6)
          geo.rotateX(Math.PI / 2)
          body = new THREE.Mesh(
            geo,
            new THREE.MeshLambertMaterial({ color: seatColor }),
          )
        } else if (unit.kind === 'officer') {
          const geo = new THREE.BoxGeometry(r * 1.6, r * 1.6, h)
          body = new THREE.Mesh(
            geo,
            new THREE.MeshLambertMaterial({ color: seatColor }),
          )
        } else {
          const geo = new THREE.ConeGeometry(r, h, 4)
          geo.rotateX(Math.PI / 2)
          body = new THREE.Mesh(
            geo,
            new THREE.MeshLambertMaterial({ color: seatColor }),
          )
        }
        body.position.z = h / 2
        group.add(body)

        const capGeo = new THREE.CylinderGeometry(r * 0.35, r * 0.35, 0.12, 6)
        capGeo.rotateX(Math.PI / 2)
        const cap = new THREE.Mesh(
          capGeo,
          new THREE.MeshLambertMaterial({ color: 0x1a1f28 }),
        )
        cap.position.z = h + 0.06
        group.add(cap)

        const labelTex = makeLabelTexture(unitLabel(unit), '#f0f0ec')
        const spriteMat = new THREE.SpriteMaterial({
          map: labelTex,
          transparent: true,
          depthTest: false,
        })
        const sprite = new THREE.Sprite(spriteMat)
        const labelScale = hexSize * 0.9
        sprite.scale.set(labelScale, labelScale, 1)
        sprite.position.z = h + hexSize * 0.35
        sprite.renderOrder = 10
        group.add(sprite)

        const barW = r * 1.4
        const barGeo = new THREE.PlaneGeometry(barW, 0.14)
        const barBg = new THREE.Mesh(
          barGeo,
          new THREE.MeshBasicMaterial({ color: 0x1a1f28, transparent: true, opacity: 0.8 }),
        )
        barBg.position.set(0, r * 0.9, 0.05)
        barBg.name = 'hp-bg'
        group.add(barBg)

        const barFill = new THREE.Mesh(
          new THREE.PlaneGeometry(barW, 0.12),
          new THREE.MeshBasicMaterial({ color: 0x6bcf8e }),
        )
        barFill.position.set(0, r * 0.9, 0.08)
        barFill.name = 'hp-fill'
        group.add(barFill)
      }

      group.position.set(x, y, 0)

      const isSelected = selectedUnitId === unit.id
      const isTarget = targetUnitId === unit.id
      const inCompany = companyUnitIds?.has(unit.id)

      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.name !== 'hp-bg' && obj.name !== 'hp-fill') {
          const mat = obj.material as THREE.MeshLambertMaterial
          if (isSelected) {
            mat.emissive = new THREE.Color(0x224466)
          } else if (isTarget) {
            mat.emissive = new THREE.Color(0x662222)
          } else if (inCompany) {
            mat.emissive = new THREE.Color(0x443300)
          } else {
            mat.emissive = new THREE.Color(0x000000)
          }
        }
        if (obj.name === 'hp-fill' && obj instanceof THREE.Mesh) {
          const ratio = hpRatio(unit)
          obj.scale.x = ratio
          obj.position.x = -(KIND_RADIUS[unit.kind] * 1.4 * (1 - ratio)) / 2
          const mat = obj.material as THREE.MeshBasicMaterial
          mat.color.set(ratio > 0.35 ? 0x6bcf8e : 0xe06c75)
        }
      })

      let ring = group.getObjectByName('sel-ring') as THREE.Mesh | undefined
      if (isSelected || isTarget || inCompany) {
        if (!ring) {
          const ringGeo = new THREE.RingGeometry(
            KIND_RADIUS[unit.kind] + 0.15,
            KIND_RADIUS[unit.kind] + 0.35,
            6,
          )
          ring = new THREE.Mesh(
            ringGeo,
            new THREE.MeshBasicMaterial({
              color: isTarget ? 0xe07070 : isSelected ? 0x7ec8ff : 0xf0d060,
              transparent: true,
              opacity: 0.85,
              side: THREE.DoubleSide,
            }),
          )
          ring.name = 'sel-ring'
          ring.position.z = 0.02
          group.add(ring)
        } else {
          const mat = ring.material as THREE.MeshBasicMaterial
          mat.color.set(isTarget ? 0xe07070 : isSelected ? 0x7ec8ff : 0xf0d060)
        }
      } else if (ring) {
        group.remove(ring)
        ring.geometry.dispose()
        ;(ring.material as THREE.Material).dispose()
      }
    }

    renderer.render(scene, camera)
  }, [
    units,
    hexSize,
    viewBox,
    selectedUnitId,
    targetUnitId,
    companyUnitIds,
  ])

  return (
    <canvas
      ref={canvasRef}
      className="board-units-canvas"
      aria-hidden
    />
  )
}
