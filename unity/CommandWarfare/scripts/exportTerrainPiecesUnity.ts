/**
 * Export land terrain piece catalog for Unity (shapes + typed pieces).
 * Usage: tsx unity/CommandWarfare/scripts/exportTerrainPiecesUnity.ts [outPath]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LAND_TERRAIN_DECK,
  landPiecesForSize,
  terrainShapeSilhouettes,
  type TerrainPieceDef,
} from '../../../play/shared/terrainPieces.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outPath = path.resolve(
  process.argv[2] ??
    path.join(__dirname, '../Assets/Data/terrain-pieces-unity.json'),
)

function serialize(p: TerrainPieceDef) {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    sizeClass: p.sizeClass,
    shape: p.shape.map((c) => ({ q: c.q, r: c.r })),
  }
}

const payload = {
  landDropsPerSize: 3,
  pieces: LAND_TERRAIN_DECK.map(serialize),
  bySize: {
    large: landPiecesForSize('large').map(serialize),
    medium: landPiecesForSize('medium').map(serialize),
    small: landPiecesForSize('small').map(serialize),
  },
  silhouettes: {
    large: terrainShapeSilhouettes('large').map((s) => ({
      key: s.key,
      title: s.title,
      sizeClass: s.sizeClass,
      shape: s.shape.map((c) => ({ q: c.q, r: c.r })),
    })),
    medium: terrainShapeSilhouettes('medium').map((s) => ({
      key: s.key,
      title: s.title,
      sizeClass: s.sizeClass,
      shape: s.shape.map((c) => ({ q: c.q, r: c.r })),
    })),
  },
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(payload))
console.log(
  `Wrote ${payload.pieces.length} pieces ` +
    `(L${payload.bySize.large.length}/M${payload.bySize.medium.length}/S${payload.bySize.small.length}) → ${outPath}`,
)
