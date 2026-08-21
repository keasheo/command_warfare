/** Odd-r offset hex helpers for the play prototype. */

export type OddR = { col: number; row: number }
export type Axial = { q: number; r: number }

export function oddRToAxial(col: number, row: number): Axial {
  return { q: col - (row - (row & 1)) / 2, r: row }
}

export function axialToOddR(q: number, r: number): OddR {
  return { col: q + (r - (r & 1)) / 2, row: r }
}

export function hexDistOddR(a: OddR, b: OddR): number {
  const aa = oddRToAxial(a.col, a.row)
  const bb = oddRToAxial(b.col, b.row)
  const dq = aa.q - bb.q
  const dr = aa.r - bb.r
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2
}

export function hexKey(col: number, row: number): string {
  return `${col},${row}`
}

export function parseHexKey(key: string): OddR {
  const [col, row] = key.split(',').map(Number)
  return { col, row }
}

/** Pointy-top pixel position for SVG rendering. */
export function oddRToPixel(col: number, row: number, hexSize: number): { x: number; y: number } {
  return {
    x: hexSize * Math.sqrt(3) * (col + 0.5 * (row & 1)),
    y: hexSize * 1.5 * row,
  }
}

export function hexPolygonPoints(cx: number, cy: number, hexSize: number): string {
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30)
    pts.push(`${cx + hexSize * Math.cos(angle)},${cy + hexSize * Math.sin(angle)}`)
  }
  return pts.join(' ')
}

const AXIAL_DIRS: Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

/** Rotate axial hex `steps` × 60° clockwise around origin (0–5). */
export function rotateAxial(q: number, r: number, steps: number): Axial {
  let x = q
  let z = r
  let y = -x - z
  const n = ((steps % 6) + 6) % 6
  for (let i = 0; i < n; i++) {
    // Cube 60° clockwise: (x,y,z) → (−z, −x, −y)
    const nx = -z
    const ny = -x
    const nz = -y
    x = nx
    y = ny
    z = nz
  }
  return { q: x, r: z }
}

export function neighborsOddR(cell: OddR): OddR[] {
  const a = oddRToAxial(cell.col, cell.row)
  return AXIAL_DIRS.map((d) => axialToOddR(a.q + d.q, a.r + d.r))
}

/** Hex on the far side of `target` from `origin` (straight-line continuation). */
export function hexBehind(origin: OddR, target: OddR): OddR | null {
  const a = oddRToAxial(origin.col, origin.row)
  const t = oddRToAxial(target.col, target.row)
  const vq = t.q - a.q
  const vr = t.r - a.r
  if (vq === 0 && vr === 0) return null
  let best: OddR | null = null
  let bestDot = -Infinity
  for (const n of neighborsOddR(target)) {
    if (hexDistOddR(origin, n) <= hexDistOddR(origin, target)) continue
    const nn = oddRToAxial(n.col, n.row)
    const dot = (nn.q - t.q) * vq + (nn.r - t.r) * vr
    if (dot > bestDot) {
      bestDot = dot
      best = n
    }
  }
  return best
}

export function inBounds(cell: OddR, boardSize: number): boolean {
  return cell.col >= 0 && cell.row >= 0 && cell.col < boardSize && cell.row < boardSize
}
