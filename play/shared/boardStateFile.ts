import { normalizeUnitStatuses } from './statusEffects'
import type { GameState } from './types'

export const BOARD_STATE_FILE_FORMAT = 'command-warfare-board-state'
export const BOARD_STATE_FILE_VERSION = 1

export type BoardStateFile = {
  format: typeof BOARD_STATE_FILE_FORMAT
  version: number
  savedAt: string
  roomCode: string
  round: number
  state: GameState
}

export function buildBoardStateFile(state: GameState): BoardStateFile {
  return {
    format: BOARD_STATE_FILE_FORMAT,
    version: BOARD_STATE_FILE_VERSION,
    savedAt: new Date().toISOString(),
    roomCode: state.roomCode,
    round: state.round,
    state,
  }
}

export function parseBoardStateFile(
  raw: unknown,
): { ok: true; file: BoardStateFile } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Invalid board state file.' }
  }
  const obj = raw as Record<string, unknown>

  if (obj.format !== BOARD_STATE_FILE_FORMAT) {
    return { ok: false, error: 'Not a Command Warfare board state file.' }
  }
  if (typeof obj.version !== 'number' || obj.version > BOARD_STATE_FILE_VERSION) {
    return {
      ok: false,
      error: `Unsupported board state file version (${String(obj.version)}).`,
    }
  }

  if (!obj.state || typeof obj.state !== 'object') {
    return { ok: false, error: 'Board state file has no state.' }
  }

  const state = normalizeLoadedState(obj.state as GameState)
  
  // Basic validation
  if (!state.roomCode || typeof state.roomCode !== 'string') {
    return { ok: false, error: 'Board state has no room code.' }
  }
  if (!state.phase || typeof state.phase !== 'string') {
    return { ok: false, error: 'Board state has no phase.' }
  }
  if (!Array.isArray(state.players)) {
    return { ok: false, error: 'Board state has no players array.' }
  }

  const savedAt =
    typeof obj.savedAt === 'string' ? obj.savedAt : new Date().toISOString()
  const roomCode =
    typeof obj.roomCode === 'string' ? obj.roomCode : state.roomCode
  const round = typeof obj.round === 'number' ? obj.round : state.round

  return {
    ok: true,
    file: {
      format: BOARD_STATE_FILE_FORMAT,
      version: obj.version as number,
      savedAt,
      roomCode,
      round,
      state,
    },
  }
}

export function boardStateFileBasename(roomCode: string, round: number): string {
  return `cw-board-${roomCode.toLowerCase()}-r${round}.json`
}

/** Back-fill new combat fields when loading older saves. */
export function normalizeLoadedState(state: GameState): GameState {
  return {
    ...state,
    hostSeat: state.hostSeat ?? 'N',
    commandZoneModes: state.commandZoneModes ?? {},
    fortifiedHexes: state.fortifiedHexes ?? {},
    pendingTrample: state.pendingTrample ?? null,
    units: (state.units ?? []).map((u) =>
      normalizeUnitStatuses({
        ...u,
        evadeActive: u.evadeActive ?? false,
        poisonTokens: u.poisonTokens ?? 0,
        trampleLeftoverDamage: u.trampleLeftoverDamage ?? 0,
      }),
    ),
  }
}
