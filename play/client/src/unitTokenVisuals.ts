/**
 * Shared board-token visuals: role shapes + stable company accent colors.
 * Seat color = owner; silhouette = role; pip = company.
 */
import type { SeatId, UnitKind, UnitToken } from '../../shared/index'

export const SEAT_TOKEN_FILL: Record<SeatId, string> = {
  N: '#468cdc',
  W: '#c85a46',
  S: '#3ca06e',
  E: '#b48228',
}

export const SEAT_OUTLINE: Record<SeatId, string> = {
  N: '#5aa0f0',
  W: '#e07055',
  S: '#45c888',
  E: '#e0b020',
}

/** Distinct accents for companies (hashed from officer card id). */
export const COMPANY_ACCENTS = [
  '#f5d76e', // gold
  '#e8a0bf', // pink
  '#7ed6df', // cyan
  '#c9a0ff', // violet
  '#ffa46b', // orange
  '#9adbc7', // mint
  '#f8c291', // peach
  '#dfe6e9', // silver
  '#ff6b81', // rose
  '#a29bfe', // periwinkle
] as const

export function hashString(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Company key used for accent (officer's card id). */
export function companyKeyForUnit(unit: UnitToken): string | null {
  if (unit.kind === 'commander') return null
  if (unit.kind === 'officer') return unit.cardId
  return unit.officerCardId
}

export function companyAccentColor(unit: UnitToken): string | null {
  const key = companyKeyForUnit(unit)
  if (!key) return null
  return COMPANY_ACCENTS[hashString(key) % COMPANY_ACCENTS.length]!
}

export function unitTokenLabel(unit: UnitToken): string {
  if (unit.kind === 'commander') return `C${unit.seat}`
  if (unit.kind === 'officer') return 'O'
  return 'U'
}

/** SVG polygon points for a regular hexagon centered at (cx,cy). */
export function hexTokenPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30)
    pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`)
  }
  return pts.join(' ')
}

/** SVG polygon points for a diamond (officer). */
export function diamondTokenPoints(cx: number, cy: number, r: number): string {
  return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`
}

export function tokenRadiusForKind(baseR: number, kind: UnitKind): number {
  if (kind === 'commander') return baseR * 0.98
  if (kind === 'officer') return baseR * 0.88
  return baseR * 0.78
}

/**
 * Draw a role-shaped token onto a 2D canvas (for 3D billboards).
 * Commander = hexagon, officer = diamond, unit = circle.
 */
export function drawUnitTokenCanvas(
  ctx: CanvasRenderingContext2D,
  size: number,
  opts: {
    label: string
    seatFill: string
    kind: UnitKind
    companyAccent?: string | null
  },
): void {
  const cx = size / 2
  const cy = size / 2
  const r = size * 0.42

  ctx.clearRect(0, 0, size, size)

  ctx.beginPath()
  if (opts.kind === 'commander') {
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 30)
      const x = cx + r * Math.cos(a)
      const y = cy + r * Math.sin(a)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
  } else if (opts.kind === 'officer') {
    ctx.moveTo(cx, cy - r)
    ctx.lineTo(cx + r, cy)
    ctx.lineTo(cx, cy + r)
    ctx.lineTo(cx - r, cy)
    ctx.closePath()
  } else {
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
  }
  ctx.fillStyle = opts.seatFill
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'
  ctx.lineWidth = Math.max(3, size * 0.035)
  ctx.stroke()

  // Kind edge highlight
  ctx.strokeStyle =
    opts.kind === 'commander'
      ? 'rgba(255, 224, 102, 0.95)'
      : opts.kind === 'officer'
        ? 'rgba(255,255,255,0.95)'
        : 'rgba(240,236,224,0.75)'
  ctx.lineWidth = Math.max(2, size * 0.025)
  ctx.stroke()

  // Company pip (bottom) — shared by officer + its units
  if (opts.companyAccent) {
    const pipR =
      opts.kind === 'officer' ? size * 0.155 : size * 0.125
    const pipY = cy + r * 0.58
    ctx.beginPath()
    ctx.arc(cx, pipY, pipR, 0, Math.PI * 2)
    ctx.fillStyle = opts.companyAccent
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'
    ctx.lineWidth = Math.max(1.5, size * 0.015)
    ctx.stroke()
    if (opts.kind === 'officer') {
      // Officer: ring around pip so leadership reads clearly
      ctx.beginPath()
      ctx.arc(cx, pipY, pipR + size * 0.045, 0, Math.PI * 2)
      ctx.strokeStyle = opts.companyAccent
      ctx.lineWidth = Math.max(1.5, size * 0.018)
      ctx.stroke()
    }
  }

  ctx.fillStyle = '#0c0e12'
  const labelSize =
    opts.label.length > 1 ? Math.floor(size * 0.28) : Math.floor(size * 0.36)
  ctx.font = `800 ${labelSize}px Segoe UI, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const labelY = opts.companyAccent ? cy - size * 0.04 : cy + 2
  ctx.fillText(opts.label, cx, labelY)
}
