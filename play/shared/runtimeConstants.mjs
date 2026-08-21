/** Runtime constants for node scripts (sim). Keep in sync with constants.ts. */

/** Scout units treat officer/commander CR as extended by this many hexes. */
export const SCOUT_CR_EXTENSION = 3

/** Total army list UV (commander + all companies). */
export const ARMY_UV_MAX = 220
/** Max UV on the battlefield at battle start (≈30 unit models per army at typical lists). */
export const DEPLOY_UV_MAX = 110
/** Max UV in the off-board reinforcement pool. */
export const RESERVE_UV_MAX = 60
/** Soft guidance only — unused UV is not hard-capped in play validation. */
export const ARMY_UNUSED_UV_GUIDE = 50
/** @deprecated Alias of ARMY_UNUSED_UV_GUIDE. */
export const ARMY_UNUSED_UV_MAX = ARMY_UNUSED_UV_GUIDE
/** Deploy + reserve when locking for battle. */
export const ARMY_BATTLE_UV_MAX = DEPLOY_UV_MAX + RESERVE_UV_MAX
/** Play length — score VP each round; highest VP after this many rounds wins. */
export const MAX_ROUNDS = 15
/** VP awarded at end of round for each controlled objective zone. */
export const VP_PER_OBJECTIVE = 2

/** 1v1 (N/S) board size — keep in sync with constants.ts. */
export const BOARD_SIZE_2P = 35
/** Shared deployment zone depth from the board edge. */
export const DEPLOY_ZONE_DEPTH = 8
/** Siege models may only deploy in the rear-most this many hexes of the zone. */
export const SIEGE_DEPLOY_DEPTH = 4
/** Max Siege models allowed in the Deploy battle bucket. */
export const MAX_DEPLOY_SIEGE = 5
