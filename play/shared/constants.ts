import type { SeatId } from './types'
import { commandZoneSlotsTotal } from './terrainPieces'

/** 1v1 (N/S) board. */
export const BOARD_SIZE_2P = 31
/** 4-player board. */
export const BOARD_SIZE_4P = 35
/** Default / legacy alias (4P size). */
export const BOARD_SIZE = BOARD_SIZE_4P

export function boardSizeForPlayers(maxPlayers: 2 | 4): number {
  return maxPlayers === 2 ? BOARD_SIZE_2P : BOARD_SIZE_4P
}

export function boardMid(boardSize: number = BOARD_SIZE): number {
  return Math.floor((boardSize - 1) / 2)
}

/** Mid hex on the default (4P) board — prefer `boardMid(state.boardSize)`. */
export const BOARD_MID = boardMid(BOARD_SIZE)
export const MIN_OBJECTIVE_DISTANCE = 5
/** Fallback move if card has no move printed. */
export const DEFAULT_UNIT_MOVE = 3
/** How far from the edge a simplified deploy wedge extends (prototype). */
export const DEPLOY_DEPTH = 6

/** Personal CR piece quotas — see terrainPieces.ts */
export type { CommandZonePieceQuota } from './terrainPieces'
export {
  commandZonePieceQuota,
  commandZoneSlotsTotal,
} from './terrainPieces'

/** @deprecated use commandZoneSlotsTotal(2) */
export const TERRAIN_PICKS_PER_PLAYER = 5

/** Place-or-skip land drops each player gets per size tier (large / medium / small). */
export const TERRAIN_LAND_DROPS_PER_SIZE = 3

/** Personal CR setup + middle-battlefield land large/medium/small drops. */
export const TERRAIN_PLACEMENTS_PER_PLAYER =
  commandZoneSlotsTotal(2) + TERRAIN_LAND_DROPS_PER_SIZE * 3

/** Total army list UV (commander + all companies). */
export const ARMY_UV_MAX = 250
/** Max UV on the battlefield at battle start. */
export const DEPLOY_UV_MAX = 155
/** Max UV in the off-board reinforcement pool. */
export const RESERVE_UV_MAX = 45
/** List UV not deployed or in reserve — room to swap officers/units before battle. */
export const ARMY_UNUSED_UV_MAX = 50
/** Deploy + reserve when locking for battle (unused is the remainder up to ARMY_UV_MAX). */
export const ARMY_BATTLE_UV_MAX = DEPLOY_UV_MAX + RESERVE_UV_MAX

/**
 * Max copies of a single card name/id in one army list (by rarity).
 * Unique cards are always capped at 1 regardless of rarity.
 */
export const ARMY_COPY_LIMITS = {
  Common: 4,
  Uncommon: 3,
  Rare: 2,
  Epic: 1,
  Legendary: 1,
} as const

export type ArmyRarity = keyof typeof ARMY_COPY_LIMITS

export function maxArmyCopiesForRarity(
  rarity: string | null | undefined,
  unique = false,
): number {
  if (unique) return 1
  const key = String(rarity || 'Common').trim()
  if (key in ARMY_COPY_LIMITS) {
    return ARMY_COPY_LIMITS[key as ArmyRarity]
  }
  const lower = key.toLowerCase()
  if (lower === 'legendary' || lower === 'epic') return 1
  if (lower === 'rare') return 2
  if (lower === 'uncommon') return 3
  return 4
}

export const SEATS_2P: SeatId[] = ['N', 'S']
export const SEATS_4P: SeatId[] = ['N', 'W', 'S', 'E']

export const PLAY_WS_PORT = 8788
export const PLAY_WS_PATH = '/ws'

/** Scout units treat officer/commander CR as extended by this many hexes. */
export const SCOUT_CR_EXTENSION = 3

/** Room codes are always six characters (random or custom). */
export const ROOM_CODE_LENGTH = 6
const ROOM_CODE_RE = /^[A-Z0-9]{6}$/

export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase()
}

/** Returns an error message, or null if valid. */
export function validateRoomCode(code: string): string | null {
  if (code.length !== ROOM_CODE_LENGTH) {
    return `Room code must be exactly ${ROOM_CODE_LENGTH} characters.`
  }
  if (!ROOM_CODE_RE.test(code)) {
    return 'Room code must use letters A–Z and digits 0–9 only.'
  }
  return null
}

/** Local readable timestamp: `2026-08-03 10:26:45` */
export function formatLogTimestamp(at: number | Date = Date.now()): string {
  const d = at instanceof Date ? at : new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Prefix a game-log message with a timestamp for the in-game Log drawer. */
export function formatGameLogLine(message: string, at: number | Date = Date.now()): string {
  return `[${formatLogTimestamp(at)}] ${message}`
}
