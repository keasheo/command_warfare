import type {
  ArmyList,
  BattleLoadout,
  CardSnapshot,
  LoadoutPools,
} from './army'
import type { AbilityDef } from './abilityCast'
import type { OddR } from './hex'
import type { TerrainKind, TerrainMap, TerrainQueueItem } from './terrainPieces'

export type SeatId = 'N' | 'W' | 'S' | 'E'

/** Lobby opponent mode for 1v1 rooms. */
export type OpponentMode = 'human' | 'ai'

export type AiDifficulty = 'easy' | 'medium' | 'hard'

export type Phase =
  | 'Lobby'
  | 'ArmyBuild'
  | 'Commanders'
  | 'Objectives'
  | 'ForceSelect'
  | 'Terrain'
  | 'Deploy'
  | 'Play'
  | 'Ended'

export type UnitKind = 'commander' | 'officer' | 'unit'

export type UnitToken = {
  id: string
  seat: SeatId
  kind: UnitKind
  cardId: string
  cardName: string
  /** Officer card this unit belongs to (officers point at themselves). */
  officerCardId: string | null
  col: number
  row: number
  /** Printed Move. */
  move: number
  /** Remaining Move this company activation. */
  moveRemaining: number
  /**
   * Hex where this unit started the current company activation.
   * Used to undo / reset movement.
   */
  activationCol: number | null
  activationRow: number | null
  /** Objective ids claimed by this unit during the current activation (reverted on undo). */
  claimsThisActivation: string[]
  /** True if this unit moved past printed Move this activation (Harass/Trample etc.). */
  movedBeyondLimit: boolean
  damage: number | null
  range: number | null
  toughness: number | null
  toughnessCurrent: number | null
  /** Printed Command Radius (officers / commanders). */
  commandRadius: number | null
  /** Keywords that affect movement (Flying, Amphibious, …). */
  keywords: string[]
  /** Ability names on this model (from card). */
  abilities: string[]
  /** Ultimate name (commanders). */
  ultimate: string | null
  /** Cannot move (including the minimum-1 terrain override). Cleared at round refresh. */
  rooted: boolean
  /** Harder to hit (+1 to hit need). Cleared at round refresh. Fearless blocks application. */
  fear: boolean
  /** −1 Move this activation; cleared at end of company activation. */
  slow: boolean
  /** Temporary Fearless (Still Host Rise, Crypt Discipline). Cleared at round refresh. */
  tempFearless: boolean
  /** Ignore the next incoming hit once. Cleared when consumed or at round refresh. */
  unyielding: boolean
  /** Rooted + cannot attack until round refresh (Bone Prison). */
  bonePrisoned: boolean
  /** Terror on-hit Fear marker (cleared at round refresh). */
  terrorFear: boolean
  /** Slow will clear when this company activation ends. */
  slowPendingClear: boolean
  /** Temporary combat buffs from cast abilities (cleared on company/commander refresh). */
  tempDamage: number
  tempMove: number
  harden: number
  /** Ability name → earliest round it may be cast again. */
  abilityReadyRound: Record<string, number>
  /** Once-per-battle raise (Raise Thrall / Raise Host). */
  raiseOnceUsed: boolean
  /** Ultimate already used this battle. */
  ultimateUsed: boolean
  /** Lasting Evade reaction stance (+1 to hit need until next activation / round). */
  evadeActive: boolean
  /** Poison tokens (max 1); tick 1 damage at company activation start. */
  poisonTokens: number
  /** Trample continuation damage queued on attacker after moving into a kill hex. */
  trampleLeftoverDamage: number
  /** Focused Assault mark — attackers deal +1 Damage vs this unit until round refresh. */
  assaultMarked: boolean
  /** Null Pulse — cannot cast actives until round refresh. */
  nullPulsed: boolean
  /** Counterattack — may strike back once when hit (Counterattack ability). */
  counterattack: boolean
  /** Spectral Strike — ignores Defender on the next attack this round. */
  spectralStrike: boolean
}

export type ObjectiveMarker = {
  id: string
  /** Anchor hex (zone center / label position). */
  col: number
  row: number
  /** All hexes in this objective zone (includes anchor). */
  hexes: OddR[]
  controller: SeatId | null
}

export type DeployItem = {
  kind: 'officer' | 'unit'
  cardId: string
  cardName: string
  officerCardId: string
  move: number
  placed: boolean
}

export type DeathRecord = {
  id: string
  unitId: string
  seat: SeatId
  kind: UnitKind
  cardId: string
  cardName: string
  officerCardId: string | null
  col: number
  row: number
  round: number
  move: number
  damage: number | null
  range: number | null
  toughness: number | null
  commandRadius: number | null
  keywords: string[]
  abilities: string[]
  ultimate: string | null
}

export type PlayerSlot = {
  seat: SeatId
  name: string
  connected: boolean
  token: string
  /** Server-side CPU seat (vs AI). Never has a WebSocket client. */
  isAi?: boolean
  army: ArmyList | null
  armyReady: boolean
  commanderReady: boolean
  /** Battle loadout (deploy / reserve / unused) confirmed. */
  forceSelectReady: boolean
  terrainReady: boolean
  deployDone: boolean
  /** Human-readable summary once army locked */
  armySummary: string | null
  armyUv: number | null
}

export type GameState = {
  roomCode: string
  maxPlayers: 2 | 4
  /** When true, officers and units must match the commander's race. */
  enforceCommanderRace: boolean
  /** Human opponent (default) or server CPU. */
  opponent: OpponentMode
  /** Set when opponent is AI; null for human matches. */
  aiDifficulty: AiDifficulty | null
  /**
   * Force-select UV caps for this room (host-configurable).
   * Unused has no hard cap; under-filling deploy/reserve is allowed.
   */
  loadoutPools: LoadoutPools
  boardSize: number
  phase: Phase
  players: PlayerSlot[]
  commanders: Partial<Record<SeatId, OddR>>
  /** Printed Command Radius per seat (from locked commander). */
  commanderRadii: Partial<Record<SeatId, number>>
  objectives: ObjectiveMarker[]
  objectiveCardId: string | null
  /** Non-plains terrain by hex key "col,row". */
  terrain: TerrainMap
  /** Fortified hex keys (Harden 1 while occupying; Piercing ignores). */
  fortifiedHexes: Record<string, boolean>
  /** Offer Trample continuation after a melee kill. */
  pendingTrample: {
    attackerId: string
    destCol: number
    destRow: number
    leftoverDamage: number
  } | null
  /** Each seat's command-zone hand (placed pieces + at most one held unplaced). */
  terrainHands: Partial<Record<SeatId, TerrainQueueItem[]>>
  /** Legacy / unused after choose-your-own land drops (kept empty). */
  terrainQueue: TerrainQueueItem[]
  /** Seat that created the room (host / force-start). */
  hostSeat: SeatId
  /**
   * commandZone = personal CR: flood-fill one kind OR place quota pieces.
   * landLarge / landMedium / landSmall = alternating battlefield land drops.
   */
  terrainStage: 'commandZone' | 'landLarge' | 'landMedium' | 'landSmall'
  /** Per-seat CR setup mode (pieces vs flood). */
  commandZoneModes: Partial<Record<SeatId, 'pieces' | 'flood'>>
  /** Place-or-skip actions used in the current land size tier (0–3). */
  landDropsUsed: Partial<Record<SeatId, number>>
  units: UnitToken[]
  /** Units destroyed during play (for grave markers and undead revive). */
  deaths: DeathRecord[]
  activeSeat: SeatId | null
  turnOrder: SeatId[]
  /** Play-phase round counter (1-based). */
  round: number
  /** Unit id of the officer whose company is currently activated (Play). */
  activeCompanyOfficerId: string | null
  /**
   * Officers (by unit id) that have already activated this round.
   * Each officer may activate at most once per round.
   */
  companiesActivatedThisRound: Record<string, boolean>
  /**
   * Officer unit id activated on the current player turn, if any.
   * At most one company activation per turn (players alternate officers).
   */
  companyActivatedThisTurn: Partial<Record<SeatId, string>>
  /** Track which commanders have activated this round (once per round). */
  commanderActivatedThisRound: Partial<Record<SeatId, boolean>>
  /** Commander AP/CC pools per seat. */
  commanderPools: Partial<
    Record<SeatId, { ap: number; cc: number; apMax: number; ccMax: number }>
  >
  /** Company AP pools keyed by officer unit id. */
  companyPools: Record<string, { ap: number; apMax: number }>
  /** Last shared dice roll (manual resolution). */
  lastDiceRoll: {
    seat: SeatId
    count: number
    sides: number
    results: number[]
    total: number
    note: string | null
  } | null
  /** Last auto-resolved attack (Resolve attack). */
  lastCombatResult: {
    seat: SeatId
    attackerId: string
    attackerName: string
    defenderId: string
    defenderName: string
    distance: number
    hitNeed: number
    dice: [number, number]
    roll: number
    hit: boolean
    rawDamage: number
    dealt: number
    mitigated: number
    favoredTerrainHit: boolean
    flanking: boolean
    killed: boolean
    evadeActive: boolean
    fearPenalty: boolean
    fortifiedHex: boolean
    piercing: boolean
    poisonApplied: boolean
    fearApplied: boolean
    slowApplied: boolean
    unyieldingBlocked: boolean
    trampleOffer: boolean
    trampleLeftover: number
  } | null
  /** Victory points scored by holding objectives (awarded end of each round). */
  scores: Partial<Record<SeatId, number>>
  /** Seat that won, or null if draw / still playing. */
  winner: SeatId | null
  /** True when the game ended in a VP tie. */
  draw?: boolean
  /** Remaining deploy items per seat (from army). */
  deployQueues: Partial<Record<SeatId, DeployItem[]>>
  /** Card snapshots keyed by id (for UI during play). */
  cardCatalog: Record<string, CardSnapshot>
  /** Ability definitions keyed by name (for casting). */
  abilityCatalog: Record<string, AbilityDef>
  log: string[]
}

export type ClientAction =
  | {
      type: 'create'
      name: string
      maxPlayers?: 2 | 4
      enforceCommanderRace?: boolean
      /** vs Human (default) or server CPU. AI rooms are always 2P. */
      opponent?: OpponentMode
      /** Required when opponent is AI; defaults to medium on the server. */
      aiDifficulty?: AiDifficulty
      /** Optional custom code; random if omitted or blank. */
      roomCode?: string
      /** Optional force-select pool caps (defaults: deploy 110, reserve 60). */
      loadoutPools?: Partial<LoadoutPools>
    }
  | { type: 'join'; roomCode: string; name: string; token?: string }
  | {
      /** Host-only: update deploy/reserve caps while still in Lobby/ArmyBuild. */
      type: 'setLoadoutPools'
      loadoutPools: Partial<LoadoutPools>
    }
  | {
      type: 'submitArmy'
      army: ArmyList
      /** Optional card snapshots so server can validate without DB miss */
      cards: CardSnapshot[]
    }
  | { type: 'readyCommander' }
  | {
      type: 'confirmForceSelect'
      /** Officer id → deploy / reserve / unused */
      battleLoadout: BattleLoadout
    }
  | { type: 'startGame' }
  | { type: 'forceStart' }
  | { type: 'chooseCommandZoneMode'; mode: 'pieces' | 'flood' }
  | { type: 'floodCommandZone'; kind: TerrainKind }
  | { type: 'pickTerrain'; pieceId: string }
  | { type: 'unpickTerrain'; handIndex: number }
  | {
      type: 'placeTerrain'
      col: number
      row: number
      /** 0–5 × 60° clockwise around the anchor hex. */
      rotation: number
      /** Command-zone hand index. */
      handIndex?: number
      /** Land-drop piece id (large / medium / small stage). */
      pieceId?: string
    }
  | { type: 'skipTerrain' }
  | { type: 'confirmTerrain' }
  | { type: 'deploy'; queueIndex: number; col: number; row: number }
  | { type: 'confirmDeploy' }
  | { type: 'activateCompany'; officerUnitId: string }
  | { type: 'activateCommander' }
  | { type: 'move'; unitId: string; col: number; row: number }
  | { type: 'undoMove'; unitId: string }
  | {
      type: 'spendPool'
      pool: 'commanderAp' | 'commanderCc' | 'companyAp'
      amount: number
      /** Required for companyAp when no active company. */
      officerUnitId?: string
    }
  | {
      type: 'rollDice'
      count: number
      sides?: number
      note?: string
    }
  | {
      type: 'applyDamage'
      unitId: string
      amount: number
    }
  | {
      type: 'applyHeal'
      unitId: string
      amount: number
    }
  | {
      type: 'resolveAttack'
      attackerUnitId: string
      defenderUnitId: string
    }
  | { type: 'continueTrample' }
  | { type: 'declineTrample' }
  | { type: 'activateEvade'; unitId: string }
  | { type: 'toggleFortifyHex'; col: number; row: number }
  | {
      type: 'castAbility'
      casterUnitId: string
      abilityName: string
      /** Optional target unit (enemy or ally depending on ability). */
      targetUnitId?: string
    }
  | { type: 'endTurn' }
  | {
      type: 'reviveFromGrave'
      deathId: string
      /** Place hex; defaults to death col/row if omitted. */
      col?: number
      row?: number
      /** Starting toughness when revived (default 1). */
      toughness?: number
    }
  | { type: 'loadBoardState'; state: GameState }
  | { type: 'leave' }
  | { type: 'ping' }

export type ServerMessage =
  | {
      type: 'welcome'
      token: string
      seat: SeatId
      state: GameState
      /** This connection's IP as seen by the server. */
      yourIp: string
    }
  | { type: 'state'; state: GameState }
  /** Host-only: connected player seat → IP (LAN/debug). Never in public game log. */
  | { type: 'hostRoster'; playerIps: Partial<Record<SeatId, string>> }
  | { type: 'error'; message: string }
  | { type: 'pong' }

export type { TerrainKind, TerrainMap, TerrainQueueItem }
