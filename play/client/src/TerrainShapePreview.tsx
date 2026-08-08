import { useMemo } from 'react'
import {
  expandTerrainPiece,
  hexPolygonPoints,
  oddRToPixel,
  type TerrainKind,
} from '../../shared/index'
import {
  terrainPatternFill,
  terrainStroke,
  TerrainPatternDefs,
} from './terrainVisuals'

type Props = {
  shape: Array<{ q: number; r: number }>
  kind: TerrainKind
  /** Current placement rotation (0–5). */
  rotation?: number
  size?: number
}

/** Mini SVG silhouette of a multi-hex terrain piece. */
export function TerrainShapePreview({
  shape,
  kind,
  rotation = 0,
  size = 36,
}: Props) {
  const { points, viewBox, fill, stroke } = useMemo(() => {
    const cells = expandTerrainPiece({ col: 0, row: 0 }, shape, rotation)
    const hexSize = 4
    const pixels = cells.map((c) => oddRToPixel(c.col, c.row, hexSize))
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of pixels) {
      minX = Math.min(minX, p.x - hexSize)
      minY = Math.min(minY, p.y - hexSize)
      maxX = Math.max(maxX, p.x + hexSize)
      maxY = Math.max(maxY, p.y + hexSize)
    }
    if (!Number.isFinite(minX)) {
      minX = 0
      minY = 0
      maxX = hexSize * 2
      maxY = hexSize * 2
    }
    const pad = 1.5
    return {
      points: pixels.map((p) =>
        hexPolygonPoints(p.x, p.y, hexSize * 0.92),
      ),
      viewBox: `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`,
      fill: terrainPatternFill(kind),
      stroke: terrainStroke(kind),
    }
  }, [shape, kind, rotation])

  return (
    <svg
      className="terrain-shape-preview"
      width={size}
      height={size}
      viewBox={viewBox}
      aria-hidden
    >
      <defs>
        <TerrainPatternDefs />
      </defs>
      {points.map((pts, i) => (
        <polygon
          key={i}
          points={pts}
          fill={fill}
          stroke={stroke}
          strokeWidth={0.35}
        />
      ))}
    </svg>
  )
}
