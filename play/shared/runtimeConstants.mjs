/** Runtime constants for node scripts (sim). Keep in sync with constants.ts. */

/** Scout units treat officer/commander CR as extended by this many hexes. */
export const SCOUT_CR_EXTENSION = 3

/** Total army list UV (commander + all companies). */
export const ARMY_UV_MAX = 250
/** Max UV on the battlefield at battle start. */
export const DEPLOY_UV_MAX = 155
/** Max UV in the off-board reinforcement pool. */
export const RESERVE_UV_MAX = 45
/** List UV not deployed or in reserve — room to swap officers/units before battle. */
export const ARMY_UNUSED_UV_MAX = 50
/** Deploy + reserve when locking for battle. */
export const ARMY_BATTLE_UV_MAX = DEPLOY_UV_MAX + RESERVE_UV_MAX
