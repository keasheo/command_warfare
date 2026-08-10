/**
 * 3D hex terrain blocks — CC0 photo textures, shared detail props.
 */
import * as THREE from 'three'
import { oddRToPixel, type TerrainKind } from '../../shared/index'

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Deterministic variant (0–4) and 60° rotation steps (0–5) per hex. */
export function hexTerrainVariant(
  roomCode: string,
  col: number,
  row: number,
): { variant: number; rotation: number } {
  const h = hashString(`${roomCode}:terrain3d:${col},${row}`)
  return { variant: h % 5, rotation: (h >>> 8) % 6 }
}

/** Block height above ground (Y-up). Taller prisms so sides read clearly. */
export const TERRAIN_BLOCK_HEIGHT: Record<TerrainKind, number> = {
  plains: 0.72,
  forest: 0.88,
  swamp: 0.58,
  desert: 0.68,
  water: 0.38,
  wall: 2.1,
  volcanic: 0.92,
  mountains: 1.85,
}

const TERRAIN_PALETTE: Record<TerrainKind, readonly number[]> = {
  plains: [0x9cb058, 0xa8bc60, 0x90a850, 0xb4c868, 0x88a048],
  forest: [0x488858, 0x529060, 0x408050, 0x5a9868, 0x38784c],
  swamp: [0x2a4838, 0x1e3828, 0x243c30, 0x324840, 0x182e22],
  desert: [0xe8b868, 0xf0c070, 0xe0b060, 0xf8c878, 0xd8a858],
  water: [0x4898d8, 0x50a0e0, 0x4090d0, 0x58a8e8, 0x3888c8],
  wall: [0x989ca8, 0xa0a4b0, 0x909498, 0xa8acb8, 0x888c98],
  volcanic: [0x685850, 0x706058, 0x605048, 0x786860, 0x584840],
  mountains: [0x6a6870, 0x747278, 0x605e68, 0x7a7880, 0x58565e],
}

const VARIANT_COLOR_TINT: Record<TerrainKind, readonly number[]> = {
  plains: [0xffffff, 0xf4f8ec, 0xeef4e4, 0xf8fcf0, 0xe8f0dc],
  forest: [0xffffff, 0xf0f4f0, 0xe8f0e8, 0xf4f8f4, 0xe4ece4],
  swamp: [0x687868, 0x607060, 0x586858, 0x708070, 0x506050],
  desert: [0xffffff, 0xfff8f0, 0xfff4e8, 0xfffaf4, 0xfff0e0],
  water: [0xd0e8ff, 0xc8e4ff, 0xd8ecff, 0xc0e0ff, 0xe0f0ff],
  wall: [0xffffff, 0xf4f4f6, 0xeeeef2, 0xf8f8fa, 0xe8e8ec],
  volcanic: [0xffffff, 0xfff0ec, 0xffe8e4, 0xfff4f0, 0xffe0dc],
  mountains: [0xffffff, 0xf2f2f4, 0xeaecef, 0xf6f6f8, 0xe4e6ea],
}

/** Micro-overlap hides seam lines between grid-aligned neighbors. */
const HEX_BODY_RADIUS_SCALE = 1.001

const textureLoader = new THREE.TextureLoader()
const imageTextureCache = new Map<TerrainKind, THREE.Texture>()
const prismGeometryCache = new Map<string, THREE.ExtrudeGeometry>()

function seededRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/** Point inside pointy-top hex (XZ plane). */
function randomInHex(rng: () => number, radius: number, margin = 0.2): { x: number; z: number } {
  const r = radius * (1 - margin)
  for (let i = 0; i < 24; i++) {
    const x = (rng() * 2 - 1) * r
    const z = (rng() * 2 - 1) * r
    if (Math.hypot(x, z) < r * 0.88) return { x, z }
  }
  return { x: 0, z: 0 }
}

/** Shared geometries & materials — never disposed per hex rebuild. */
const SHARED = (() => {
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.16, 1, 5)
  const foliageGeo = new THREE.ConeGeometry(0.55, 1, 6)
  const grassBladeGeo = new THREE.ConeGeometry(0.06, 0.45, 3)
  // Sharp mountain peaks (full cones) — not rolling mounds.
  const peakGeo = new THREE.ConeGeometry(0.5, 1, 5)
  const snowCapGeo = new THREE.ConeGeometry(0.22, 0.28, 5)
  const rockGeo = new THREE.DodecahedronGeometry(0.5, 0)
  const waveGeo = new THREE.TorusGeometry(0.5, 0.04, 6, 16)
  const reedGeo = new THREE.CylinderGeometry(0.025, 0.035, 1, 4)
  const puddleGeo = new THREE.CircleGeometry(0.5, 12)
  const shardGeo = new THREE.ConeGeometry(0.35, 0.8, 4)
  const crenelGeo = new THREE.BoxGeometry(1, 1, 1)
  const duneGeo = new THREE.SphereGeometry(0.5, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2)

  const markShared = (...geos: THREE.BufferGeometry[]) => {
    for (const g of geos) g.userData.sharedResource = true
  }
  markShared(
    trunkGeo,
    foliageGeo,
    grassBladeGeo,
    peakGeo,
    snowCapGeo,
    rockGeo,
    waveGeo,
    reedGeo,
    puddleGeo,
    shardGeo,
    crenelGeo,
    duneGeo,
  )

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4020, roughness: 0.85, metalness: 0.02 })
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0x388840, roughness: 0.78, metalness: 0.02 })
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x7cb848, roughness: 0.82, metalness: 0.02 })
  const mountainMat = new THREE.MeshStandardMaterial({ color: 0x6a6870, roughness: 0.92, metalness: 0.05 })
  const snowMat = new THREE.MeshStandardMaterial({ color: 0xf0eeea, roughness: 0.78, metalness: 0.02 })
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x888078, roughness: 0.92, metalness: 0.04 })
  const waterWaveMat = new THREE.MeshStandardMaterial({
    color: 0x88d8f8,
    roughness: 0.15,
    metalness: 0.45,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  })
  const reedMat = new THREE.MeshStandardMaterial({ color: 0x324838, roughness: 0.88, metalness: 0.02 })
  const puddleMat = new THREE.MeshStandardMaterial({
    color: 0x1a2820,
    roughness: 0.35,
    metalness: 0.12,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  })
  const duneMat = new THREE.MeshStandardMaterial({ color: 0xe0b868, roughness: 0.9, metalness: 0.02 })
  const lavaCrackMat = new THREE.MeshStandardMaterial({
    color: 0xe84830,
    emissive: 0x882018,
    emissiveIntensity: 0.55,
    roughness: 0.5,
    metalness: 0.08,
  })
  const shardMat = new THREE.MeshStandardMaterial({ color: 0x484038, roughness: 0.88, metalness: 0.06 })
  const wallDetailMat = new THREE.MeshStandardMaterial({ color: 0x909498, roughness: 0.82, metalness: 0.04 })

  const markSharedMat = (...mats: THREE.Material[]) => {
    for (const m of mats) m.userData.sharedResource = true
  }
  markSharedMat(
    trunkMat,
    foliageMat,
    grassMat,
    mountainMat,
    snowMat,
    rockMat,
    waterWaveMat,
    reedMat,
    puddleMat,
    duneMat,
    lavaCrackMat,
    shardMat,
    wallDetailMat,
  )

  return {
    trunkGeo,
    foliageGeo,
    grassBladeGeo,
    peakGeo,
    snowCapGeo,
    rockGeo,
    waveGeo,
    reedGeo,
    puddleGeo,
    shardGeo,
    crenelGeo,
    duneGeo,
    trunkMat,
    foliageMat,
    grassMat,
    mountainMat,
    snowMat,
    rockMat,
    waterWaveMat,
    reedMat,
    puddleMat,
    duneMat,
    lavaCrackMat,
    shardMat,
    wallDetailMat,
  }
})()

function loadTerrainImageTexture(kind: TerrainKind): THREE.Texture {
  let tex = imageTextureCache.get(kind)
  if (tex) return tex

  tex = textureLoader.load(`/terrain/3d/${kind}.jpg`)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(1.15, 1.15)
  tex.anisotropy = 4
  imageTextureCache.set(kind, tex)
  return tex
}

/** Cached CC0 terrain top texture (shared per kind, tinted per variant). */
export function getTerrainTexture(kind: TerrainKind, _variant: number): THREE.Texture {
  return loadTerrainImageTexture(kind)
}

export function terrainBlockColor(kind: TerrainKind, variant: number): number {
  const palette = TERRAIN_PALETTE[kind]
  return palette[variant % palette.length]!
}

export function oddRToWorld3D(
  col: number,
  row: number,
  hexSize: number,
): { x: number; z: number } {
  const { x, y } = oddRToPixel(col, row, hexSize)
  return { x, z: y }
}

function buildHexShape(radius: number): THREE.Shape {
  const shape = new THREE.Shape()
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30)
    const px = radius * Math.cos(angle)
    const py = radius * Math.sin(angle)
    if (i === 0) shape.moveTo(px, py)
    else shape.lineTo(px, py)
  }
  shape.closePath()
  return shape
}

/** Planar UV projection for extruded hex top cap. */
function applyHexTopPlanarUV(geo: THREE.BufferGeometry, radius: number): void {
  geo.computeBoundingBox()
  const bb = geo.boundingBox!
  const topY = bb.max.y - 0.02
  const pos = geo.attributes.position!
  const uv = geo.attributes.uv!
  const scale = radius * 2.05

  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) >= topY) {
      uv.setXY(i, pos.getX(i) / scale + 0.5, pos.getZ(i) / scale + 0.5)
    }
  }
  uv.needsUpdate = true
}

function createHexPrism(radius: number, height: number): THREE.ExtrudeGeometry {
  const cacheKey = `${radius.toFixed(4)}:${height.toFixed(4)}`
  const cached = prismGeometryCache.get(cacheKey)
  if (cached) return cached

  const geo = new THREE.ExtrudeGeometry(buildHexShape(radius), {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1,
  })
  geo.rotateX(Math.PI / 2)
  applyHexTopPlanarUV(geo, radius)
  geo.computeVertexNormals()
  geo.userData.sharedResource = true
  prismGeometryCache.set(cacheKey, geo)
  return geo
}

function terrainMaterial(kind: TerrainKind, variant: number): THREE.MeshStandardMaterial {
  const tex = getTerrainTexture(kind, variant)
  const tint = VARIANT_COLOR_TINT[kind][variant % 5]!
  return new THREE.MeshStandardMaterial({
    map: tex,
    color: tint,
    roughness:
      kind === 'water' ? 0.22 : kind === 'wall' ? 0.78 : kind === 'swamp' ? 0.84 : 0.68,
    metalness:
      kind === 'water' ? 0.42 : kind === 'volcanic' ? 0.1 : kind === 'swamp' ? 0.02 : 0.04,
    emissive: kind === 'volcanic' ? 0x180804 : kind === 'swamp' ? 0x081008 : 0x000000,
    emissiveIntensity: kind === 'volcanic' ? 0.12 : kind === 'swamp' ? 0.04 : 0,
  })
}

function markDetailMesh(mesh: THREE.Mesh, matIsShared = true): void {
  mesh.userData.sharedResource = true
  if (matIsShared) mesh.userData.sharedMaterial = true
}

function addTree(
  group: THREE.Group,
  x: number,
  z: number,
  topY: number,
  radius: number,
  scale: number,
  foliageHue: number,
): void {
  const h = radius * 0.52 * scale
  const trunk = new THREE.Mesh(SHARED.trunkGeo, SHARED.trunkMat)
  trunk.position.set(x, topY + h * 0.22, z)
  trunk.scale.set(scale * 1.2, h * 0.52, scale * 1.2)
  markDetailMesh(trunk)
  group.add(trunk)

  const foliage = new THREE.Mesh(SHARED.foliageGeo, SHARED.foliageMat)
  foliage.material = SHARED.foliageMat.clone()
  ;(foliage.material as THREE.MeshStandardMaterial).color.setHex(foliageHue)
  foliage.position.set(x, topY + h * 0.72, z)
  foliage.scale.set(scale * 1.5, h * 0.62, scale * 1.5)
  markDetailMesh(foliage, false)
  group.add(foliage)
}

function addGrassClump(
  group: THREE.Group,
  x: number,
  z: number,
  topY: number,
  radius: number,
  rng: () => number,
): void {
  const bladeCount = 3 + Math.floor(rng() * 3)
  for (let i = 0; i < bladeCount; i++) {
    const blade = new THREE.Mesh(SHARED.grassBladeGeo, SHARED.grassMat)
    const angle = rng() * Math.PI * 2
    const dist = rng() * radius * 0.07
    blade.position.set(x + Math.cos(angle) * dist, topY + radius * 0.04, z + Math.sin(angle) * dist)
    blade.rotation.y = rng() * Math.PI
    blade.scale.set(0.8 + rng() * 0.5, 0.6 + rng() * 0.9, 0.8 + rng() * 0.5)
    markDetailMesh(blade)
    group.add(blade)
  }
}

function addMountainPeak(
  group: THREE.Group,
  x: number,
  z: number,
  topY: number,
  radius: number,
  scaleW: number,
  scaleH: number,
  withSnow: boolean,
): void {
  const peak = new THREE.Mesh(SHARED.peakGeo, SHARED.mountainMat)
  const h = radius * scaleH
  const w = radius * scaleW
  peak.position.set(x, topY + h * 0.5, z)
  peak.scale.set(w, h, w)
  markDetailMesh(peak)
  group.add(peak)

  if (withSnow) {
    const snow = new THREE.Mesh(SHARED.snowCapGeo, SHARED.snowMat)
    const snowH = h * 0.22
    snow.position.set(x, topY + h - snowH * 0.35, z)
    snow.scale.set(w * 0.55, snowH, w * 0.55)
    markDetailMesh(snow)
    group.add(snow)
  }
}

function addRock(
  group: THREE.Group,
  x: number,
  z: number,
  topY: number,
  radius: number,
  rng: () => number,
): void {
  const rock = new THREE.Mesh(SHARED.rockGeo, SHARED.rockMat)
  const s = radius * (0.12 + rng() * 0.095)
  rock.position.set(x, topY + s * 0.4, z)
  rock.scale.set(s, s * (0.7 + rng() * 0.5), s)
  rock.rotation.set(rng() * 0.5, rng() * Math.PI, rng() * 0.4)
  markDetailMesh(rock)
  group.add(rock)
}

function addWaterWave(
  group: THREE.Group,
  x: number,
  z: number,
  topY: number,
  radius: number,
  scale: number,
  phase: number,
): void {
  const wave = new THREE.Mesh(SHARED.waveGeo, SHARED.waterWaveMat)
  wave.rotation.x = Math.PI / 2
  wave.position.set(x, topY + 0.03, z)
  wave.scale.set(radius * scale, radius * scale, 1)
  wave.userData.terrainAnim = { type: 'wave' as const, phase, baseY: topY + 0.03 }
  markDetailMesh(wave)
  group.add(wave)
}

function addVariantDetail(
  group: THREE.Group,
  kind: TerrainKind,
  variant: number,
  radius: number,
  blockHeight: number,
  rotationSteps: number,
  detailSeed: number,
): void {
  const detailGroup = new THREE.Group()
  detailGroup.rotation.y = (rotationSteps * Math.PI) / 3
  const topY = blockHeight
  const rng = seededRng(detailSeed)
  const foliageColors = [0x388840, 0x408848, 0x307838, 0x489050, 0x286830]

  switch (kind) {
    case 'forest': {
      const treeCount = 2 + (variant % 3)
      for (let i = 0; i < treeCount; i++) {
        const { x, z } = randomInHex(rng, radius, 0.22)
        const scale = 0.75 + rng() * 0.55
        addTree(detailGroup, x, z, topY, radius, scale, foliageColors[i % foliageColors.length]!)
      }
      break
    }
    case 'plains': {
      const clumpCount = 4 + (variant % 3)
      for (let i = 0; i < clumpCount; i++) {
        const { x, z } = randomInHex(rng, radius, 0.15)
        addGrassClump(detailGroup, x, z, topY, radius, rng)
      }
      break
    }
    case 'mountains': {
      // 2–3 sharp peaks with optional snow; rocky rubble at the base.
      const peakCount = 2 + (variant % 2)
      for (let i = 0; i < peakCount; i++) {
        const { x, z } = randomInHex(rng, radius, 0.12 + rng() * 0.06)
        const isPrimary = i === 0
        const sw = isPrimary ? 0.28 + rng() * 0.1 : 0.16 + rng() * 0.1
        const sh = isPrimary ? 0.72 + rng() * 0.28 : 0.42 + rng() * 0.22
        addMountainPeak(detailGroup, x, z, topY, radius, sw, sh, isPrimary || variant >= 3)
      }
      const rockCount = 1 + (variant % 3)
      for (let i = 0; i < rockCount; i++) {
        const { x, z } = randomInHex(rng, radius, 0.18)
        addRock(detailGroup, x, z, topY, radius, rng)
      }
      break
    }
    case 'water': {
      const waveCount = 2 + (variant % 2)
      for (let i = 0; i < waveCount; i++) {
        const { x, z } = randomInHex(rng, radius, 0.25)
        const scale = 0.35 + i * 0.18 + rng() * 0.12
        addWaterWave(detailGroup, x, z, topY, radius, scale, rng() * Math.PI * 2)
      }
      break
    }
    case 'swamp': {
      const reedCount = 3 + (variant % 3)
      for (let i = 0; i < reedCount; i++) {
        const { x, z } = randomInHex(rng, radius, 0.15)
        const reed = new THREE.Mesh(SHARED.reedGeo, SHARED.reedMat)
        const h = radius * (0.12 + rng() * 0.1)
        reed.position.set(x, topY + h * 0.5, z)
        reed.scale.set(1, h, 1)
        reed.rotation.z = (rng() - 0.5) * 0.25
        markDetailMesh(reed)
        detailGroup.add(reed)
      }
      const puddleCount = 1 + (variant % 2)
      for (let i = 0; i < puddleCount; i++) {
        const { x, z } = randomInHex(rng, radius, 0.2)
        const puddle = new THREE.Mesh(SHARED.puddleGeo, SHARED.puddleMat)
        puddle.rotation.x = -Math.PI / 2
        puddle.position.set(x, topY + 0.02, z)
        puddle.scale.set(radius * (0.15 + rng() * 0.1), radius * (0.15 + rng() * 0.1), 1)
        markDetailMesh(puddle)
        detailGroup.add(puddle)
      }
      break
    }
    case 'desert': {
      const duneCount = 1 + (variant % 2)
      for (let i = 0; i < duneCount; i++) {
        const { x, z } = randomInHex(rng, radius, 0.2)
        const dune = new THREE.Mesh(SHARED.duneGeo, SHARED.duneMat)
        const sw = 0.2 + rng() * 0.15
        const sh = 0.1 + rng() * 0.08
        dune.position.set(x, topY, z)
        dune.scale.set(radius * sw, radius * sh, radius * sw * 1.2)
        dune.rotation.y = rng() * Math.PI
        markDetailMesh(dune)
        detailGroup.add(dune)
      }
      break
    }
    case 'volcanic': {
      const shardCount = 2 + (variant % 3)
      for (let i = 0; i < shardCount; i++) {
        const { x, z } = randomInHex(rng, radius, 0.15)
        const shard = new THREE.Mesh(SHARED.shardGeo, SHARED.shardMat)
        const h = radius * (0.1 + rng() * 0.08)
        shard.position.set(x, topY + h * 0.35, z)
        shard.scale.set(radius * 0.06, h, radius * 0.06)
        shard.rotation.set(rng() * 0.4, rng() * Math.PI, rng() * 0.3)
        markDetailMesh(shard)
        detailGroup.add(shard)
      }
      const crackCount = 1 + (variant % 2)
      for (let i = 0; i < crackCount; i++) {
        const { x, z } = randomInHex(rng, radius, 0.1)
        const crack = new THREE.Mesh(SHARED.grassBladeGeo, SHARED.lavaCrackMat)
        crack.position.set(x, topY + 0.02, z)
        crack.scale.set(radius * 0.04, 0.04, radius * 0.35)
        crack.rotation.y = rng() * Math.PI
        markDetailMesh(crack)
        detailGroup.add(crack)
      }
      break
    }
    case 'wall': {
      if (variant >= 1) {
        const crenCount = 3 + (variant % 2)
        for (let i = 0; i < crenCount; i++) {
          const a = (i / crenCount) * Math.PI * 2 + rng() * 0.3
          const cren = new THREE.Mesh(SHARED.crenelGeo, SHARED.wallDetailMat)
          cren.position.set(
            Math.cos(a) * radius * 0.52,
            topY + radius * 0.07,
            Math.sin(a) * radius * 0.52,
          )
          cren.scale.set(radius * 0.14, radius * 0.1, radius * 0.14)
          markDetailMesh(cren)
          detailGroup.add(cren)
        }
      }
      break
    }
    default:
      break
  }

  group.add(detailGroup)
}

/** Animate water ripples and subtle grass sway. Call each frame from the render loop. */
export function animateTerrainDetails(root: THREE.Object3D, timeSec: number): void {
  root.traverse((obj) => {
    const anim = obj.userData.terrainAnim as
      | { type: 'wave'; phase: number; baseY: number }
      | undefined
    if (!anim) return
    if (anim.type === 'wave') {
      obj.position.y = anim.baseY + Math.sin(timeSec * 2.2 + anim.phase) * 0.025
      const mesh = obj as THREE.Mesh
      mesh.rotation.z = Math.sin(timeSec * 1.5 + anim.phase) * 0.06
    }
  })
}

/** One interlocking terrain block with deterministic variant detail. */
export function createTerrainBlockGroup(
  kind: TerrainKind,
  variant: number,
  rotationSteps: number,
  hexRadius: number,
  detailSeed?: number,
): THREE.Group {
  const group = new THREE.Group()
  const height = TERRAIN_BLOCK_HEIGHT[kind]
  const bodyRadius = hexRadius * HEX_BODY_RADIUS_SCALE
  const seed = detailSeed ?? hashString(`detail:${kind}:${variant}:${rotationSteps}`)

  const body = new THREE.Mesh(createHexPrism(bodyRadius, height), terrainMaterial(kind, variant))
  body.position.y = height / 2
  group.add(body)

  addVariantDetail(group, kind, variant, hexRadius, height, rotationSteps, seed)
  return group
}

/** Flat hex overlay for CR / ghost / objective tints. */
export function createHexOverlayMesh(
  hexRadius: number,
  color: number,
  opacity: number,
  y: number,
): THREE.Mesh {
  const geo = createHexPrism(hexRadius * 0.995, 0.04)
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    }),
  )
  mesh.position.y = y
  mesh.renderOrder = 2
  return mesh
}

/** Safe dispose — skips shared geometries/materials used by detail props. */
export function disposeTerrainObject(obj: THREE.Object3D): void {
  obj.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      const geo = node.geometry
      if (!geo.userData.sharedResource && !node.userData.sharedResource) {
        geo.dispose()
      }
      const mat = node.material
      if (!node.userData.sharedMaterial && !(mat as THREE.Material).userData?.sharedResource) {
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else mat.dispose()
      }
    }
    if (node instanceof THREE.Sprite) {
      const sm = node.material as THREE.SpriteMaterial
      if (sm.map && !sm.map.userData.sharedResource) sm.map.dispose()
      sm.dispose()
    }
  })
}
