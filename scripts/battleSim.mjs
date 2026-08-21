/**
 * Command Warfare hex VP battle sim v2
 * - CC / Company AP / Commander AP economy
 * - Alternate Officer activations (1 CC, once each); Commander once/round on an independent track
 * - Officer activation moves whole company (free in radius; AP if outside)
 * - Ability effects (passives always on; actives/ultimates with cooldowns)
 * - Objectives (Objective Cards), terrain (plains → pieces), reinforcements, VP scoring
 * - Defensive reactions: Brace / Evade / Retaliate (1 Company AP each)
 * - Balance dials: printable only (see simBalanceDials.mjs) — no naked race combat hacks
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import { fileURLToPath } from 'node:url'
import {
  abilityCostOverrides,
  activeDials,
  buildProposalsReport,
  compactBonusForRace,
  dialEffects,
  lintDialRegistry,
  proposalsMarkdown,
  setDialActive,
} from './simBalanceDials.mjs'
import {
  ARMY_UV_MAX,
  ARMY_UNUSED_UV_MAX,
  BOARD_SIZE_2P,
  DEPLOY_UV_MAX,
  DEPLOY_ZONE_DEPTH,
  MAX_DEPLOY_SIEGE,
  MAX_ROUNDS as PLAY_MAX_ROUNDS,
  RESERVE_UV_MAX,
  SCOUT_CR_EXTENSION,
  SIEGE_DEPLOY_DEPTH,
  VP_PER_OBJECTIVE,
} from '../play/shared/runtimeConstants.mjs'

const API = process.env.CW_API || 'http://127.0.0.1:8787'
/** Starting force UV on the board (~25 models including commander + officers). */
const DEPLOY_UV = DEPLOY_UV_MAX
/** Reinforcement pool UV (whole companies waiting off-board). */
const REINFORCE_UV = RESERVE_UV_MAX
/** Total army list UV (aligned with play ARMY_UV_MAX). */
const ARMY_UV = ARMY_UV_MAX
const WAVE_ROUNDS = [4, 8]
const MAX_ROUNDS = PLAY_MAX_ROUNDS
/** Match play 1v1 board (odd-r). */
const BOARD_SIZE = BOARD_SIZE_2P
const BOARD_MID = Math.floor((BOARD_SIZE - 1) / 2)
const DEPLOY_DEPTH = DEPLOY_ZONE_DEPTH
const MIN_OBJECTIVE_DISTANCE = 5
const RUNS = Number(process.env.SIM_RUNS || 0) // optional floor/multiplier; 0 = commander-coverage mode
/** Each commander must appear in at least this many games per matchup. */
const MIN_RUNS_PER_COMMANDER = Number(process.env.SIM_CMD_RUNS || 5)

/** Mixed coalition lists off by default. Enable: CW_SIM_MIXED_ARMIES=1 or --mixed-armies */
function parseMixedArmiesEnabled() {
  const argv = process.argv.slice(2)
  if (argv.includes('--mixed-armies')) return true
  if (argv.includes('--no-mixed-armies')) return false
  const env = process.env.CW_SIM_MIXED_ARMIES ?? process.env.SIM_MIXED_ARMIES
  if (env != null && env !== '') {
    const v = String(env).toLowerCase()
    return v === '1' || v === 'true' || v === 'yes'
  }
  return false
}
const MIXED_ARMIES_ENABLED = parseMixedArmiesEnabled()
const OFFICER_ACTIVATE_CC = 1
const ATTACK_AP = 1
const OUT_OF_RADIUS_MOVE_AP = 1
const DEFENSE_REACTION_AP = 1
/** Soft water cap — matches play WATER_HEX_CAP. */
const WATER_HEX_CAP = 50
/** Command-zone picks + land drops per size — matches play constants. */
const TERRAIN_PICKS_PER_PLAYER = 3
const TERRAIN_LAND_DROPS_PER_SIZE = 3

/**
 * Movement cost per terrain type.
 * Non-water terrain has no movement penalties (cost 1).
 * Combat bonuses for favored terrain are handled separately.
 */
const TERRAIN_COST = {
  plains: 1,
  forest: 1,
  desert: 1,
  swamp: 1,
  volcanic: 1,
  mountains: 1,
  water: Infinity,
  wall: Infinity,
}

/**
 * Favored terrain by race — bonuses are terrain-specific (see TERRAIN EFFECTS).
 * Plains/Desert: +1 Hit. Forest: ignore ranged Forest penalty. Swamp: Guard.
 * Volcanic: +1 Damage. Mountains: +1 Harden. Water: +1 Move.
 */
const RACE_FAVORED_TERRAIN = {
  Human: 'plains',
  Construct: 'plains',
  Beastfolk: 'forest',
  Elf: 'forest',
  Dragon: 'volcanic',
  Demon: 'volcanic',
  Undead: 'swamp',
  Lizardman: 'swamp',
  Dwarf: 'mountains',
}

const TERRAIN_KEYWORD_TO_KIND = {
  'Open Ground': 'plains',
  Woodwalker: 'forest',
  Bogstrider: 'swamp',
  Duneborn: 'desert',
  Ashborn: 'volcanic',
  Mountainborn: 'mountains',
  Deepwalker: 'water',
}

/** Combat +1 Hit for Plains/Desert Favored. */
const FAVORED_TERRAIN_HIT_BONUS = 1
const FAVORED_TERRAIN_DAMAGE_BONUS = 1

function unitFavoredTerrain(unit) {
  return unit.favoredTerrain || (unit.race && RACE_FAVORED_TERRAIN[unit.race]) || null
}

function unitHasTerrainFavored(unit, terrain) {
  if (!unit || !terrain) return false
  if (unit._grantedFavored === terrain) return true
  if (unitFavoredTerrain(unit) === terrain) return true
  const kws = unit.keywords || []
  return kws.some((k) => TERRAIN_KEYWORD_TO_KIND[String(k)] === terrain)
}

function unitHasMountainsFavored(unit) {
  return unitHasTerrainFavored(unit, 'mountains')
}

/**
 * Get terrain type at a hex, treating objectives as plains (neutral land).
 */
function getTerrainAt(map, hex) {
  if (!map || !hex) return 'plains'
  const key = hexKey(hex.q, hex.r)
  // Objectives are always neutral land
  if (map.objectives?.some((o) => o.q === hex.q && o.r === hex.r)) return 'plains'
  const cell = map.cells?.get(key)
  return cell?.terrain ?? 'plains'
}
/** To-hit by hex distance (2d6 sum): adjacent 7+, +1 per hex out (cap 10+). */
const HIT_NEED = { 1: 7, 2: 8, 3: 9, 4: 10 }
/** Lowest hit requirement after bonuses (2d6 min is 2). */
const HIT_NEED_MIN = 5
const HIT_NEED_MAX = 11

function rollHitSum(rng) {
  return 1 + Math.floor(rng() * 6) + 1 + Math.floor(rng() * 6)
}

function oddRToAxial(col, row) {
  return { q: col - (row - (row & 1)) / 2, r: row }
}
function axialToOddR(q, r) {
  return { col: q + (r - (r & 1)) / 2, row: r }
}
const BOARD_CENTER = oddRToAxial(BOARD_MID, BOARD_MID)

/** Play / rulebook Objective Card deck (absolute odd-r on 35×35). */
const OBJECTIVE_DECK = [
  { id: 'single-center', name: 'Single Center', markers: [{ col: BOARD_MID, row: BOARD_MID }] },
  {
    id: 'mirror-ns',
    name: 'North–South Pair',
    markers: [
      { col: BOARD_MID, row: BOARD_MID - 4 },
      { col: BOARD_MID, row: BOARD_MID + 4 },
    ],
  },
  {
    id: 'mirror-we',
    name: 'West–East Pair',
    markers: [
      { col: BOARD_MID - 4, row: BOARD_MID },
      { col: BOARD_MID + 4, row: BOARD_MID },
    ],
  },
  {
    id: 'triangle',
    name: 'Triad',
    markers: [
      { col: BOARD_MID, row: BOARD_MID },
      { col: BOARD_MID - 5, row: BOARD_MID - 4 },
      { col: BOARD_MID + 5, row: BOARD_MID + 4 },
    ],
  },
  {
    id: 'wide-three',
    name: 'Wide Three',
    markers: [
      { col: BOARD_MID - 5, row: BOARD_MID },
      { col: BOARD_MID, row: BOARD_MID },
      { col: BOARD_MID + 5, row: BOARD_MID },
    ],
  },
  {
    id: 'diagonal-pair',
    name: 'Diagonal Pair',
    markers: [
      { col: BOARD_MID - 4, row: BOARD_MID - 4 },
      { col: BOARD_MID + 4, row: BOARD_MID + 4 },
    ],
  },
]

function drawObjectiveCard(rng) {
  return OBJECTIVE_DECK[Math.floor(rng() * OBJECTIVE_DECK.length)]
}

function rotateOddR180(markers) {
  return markers.map((m) => ({
    col: 2 * BOARD_MID - m.col,
    row: 2 * BOARD_MID - m.row,
  }))
}

function* allBoardHexes() {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const a = oddRToAxial(col, row)
      yield { q: a.q, r: a.r, col, row }
    }
  }
}

function edgeRowHexes(side) {
  const row = side === 'A' ? 0 : BOARD_SIZE - 1
  const out = []
  for (let col = 0; col < BOARD_SIZE; col++) {
    const a = oddRToAxial(col, row)
    out.push({ q: a.q, r: a.r })
  }
  return out
}

function inDeployZone(side, h) {
  const { row } = axialToOddR(h.q, h.r)
  if (side === 'A') return row >= 0 && row < DEPLOY_DEPTH
  return row > BOARD_SIZE - 1 - DEPLOY_DEPTH && row < BOARD_SIZE
}

function inSiegeDeployBand(side, h) {
  const { row } = axialToOddR(h.q, h.r)
  if (side === 'A') return row >= 0 && row < SIEGE_DEPLOY_DEPTH
  return row > BOARD_SIZE - 1 - SIEGE_DEPLOY_DEPTH && row < BOARD_SIZE
}

function isSiegeCard(c) {
  if (!c) return false
  if (
    (c.keywords || []).some(
      (k) => String(k) === 'Siege' || String(k).startsWith('Siege '),
    )
  ) {
    return true
  }
  const p = String(c.primaryType || '').toLowerCase()
  const s = String(c.secondaryType || '').toLowerCase()
  return p === 'siege' || s === 'siege' || String(c.race || '') === 'Siege'
}

function tooCloseToObjective(h, objectives) {
  return objectives.some((o) => hexDist(h, o) < MIN_OBJECTIVE_DISTANCE)
}

function isObjectiveHex(h, objectives) {
  return objectives.some((o) => o.q === h.q && o.r === h.r)
}

function primaryObjective(map) {
  if (!map.objectives?.length) return { ...BOARD_CENTER }
  return [...map.objectives].sort(
    (a, b) => hexDist(a, BOARD_CENTER) - hexDist(b, BOARD_CENTER),
  )[0]
}

/**
 * +1 Hit bonuses (lower the roll needed). Flanking, favored terrain, and temporary hit buffs.
 * `dist` is attack distance (1 = melee).
 * `map` optional for favored terrain bonus.
 */
function hitBonus(attacker, defender, models, dist = 1, map = null) {
  let bonus = attacker.tempHitBonus || 0
  // Favored terrain: +1 Hit only for Plains / Desert (other terrains use different Favored effects).
  if (map && attacker.hex) {
    const terrain = getTerrainAt(map, attacker.hex)
    if (
      (terrain === 'plains' || terrain === 'desert') &&
      unitHasTerrainFavored(attacker, terrain)
    ) {
      bonus += FAVORED_TERRAIN_HIT_BONUS
    }
  }
  const flanking =
    hasAbility(attacker, 'Flanking') || attacker._tempFlanking
  if (flanking && defender?.hex && models?.length) {
    // Swamp Base: Flanking does not apply unless attacker is also in Swamp.
    let swampBlocked = false
    if (map) {
      const defT = getTerrainAt(map, defender.hex)
      const atkT = attacker.hex ? getTerrainAt(map, attacker.hex) : 'plains'
      swampBlocked = defT === 'swamp' && atkT !== 'swamp'
    }
    if (!swampBlocked) {
      const flanked = models.some(
        (m) =>
          m.alive &&
          m.side === attacker.side &&
          m.id !== attacker.id &&
          m.hex &&
          hexDist(m.hex, defender.hex) === 1,
      )
      if (flanked) bonus += 1
    }
  }
  // Pack: +1 Hit on melee while adjacent to at least two other Pack units.
  if (dist === 1 && hasAbility(attacker, 'Pack') && models?.length && attacker.hex) {
    const needAdj = dialEffects().packAdjacentRequired || 2
    const packBuddies = models.filter(
      (m) =>
        m.alive &&
        m.side === attacker.side &&
        m.id !== attacker.id &&
        m.hex &&
        hexDist(m.hex, attacker.hex) === 1 &&
        hasAbility(m, 'Pack'),
    ).length
    if (packBuddies >= needAdj) bonus += 1
  }
  // Alpha Mark / Alpha Howl still buff Pack melee attacks.
  if (dist === 1 && hasAbility(attacker, 'Pack')) {
    if (defender?._alphaMarked || attacker._packHitAura) bonus += 1
  }
  if (
    isCheapUnit(attacker) &&
    hasAdjacentFormationProvider(attacker, models, 'Formation Drill')
  ) {
    bonus += 1
  }
  // Diversified officer/commander passives
  if (attacker._vanguardPush && (attacker.movedThisAct || 0) > 0) bonus += 1
  if (attacker._lineCadence) {
    const allAttacks = dialEffects().lineCadenceAllAttacks
    if (allAttacks || !attacker._attackedThisAct) bonus += 1
  }
  if (
    attacker._bloodScent &&
    defender &&
    defender.hp < defender.toughness &&
    defender.hex &&
    attacker.hex &&
    hexDist(attacker.hex, defender.hex) === 1
  ) {
    bonus += 1
  }
  // Hellfire Press: +1 Hit vs damaged enemies (floor buff).
  if (attacker._hellfirePress && defender && defender.hp < defender.toughness) {
    bonus += 1
  }
  if (attacker._packCadence) bonus += 1
  if (attacker._hexPressureOn) bonus += 1
  if (attacker._volleyDiscipline && defender?._shotThisRoundBySide?.[attacker.side]) bonus += 1
  if (attacker._spottingLine) bonus += 1
  if (attacker._siegeSync) bonus += 1
  // Marsh Stride no longer grants +1 Hit on water (Deepwalker is +1 Move).
  if (attacker._scarLedger) bonus += 1
  if (attacker._namedFangs && defender?._hurtBeastThisRound) bonus += 1
  if (attacker._spearpointAdvance) bonus += 1
  if (
    attacker._tormentLattice &&
    defender &&
    (hasAbility(defender, 'Fear') || defender.tags?.has?.('fear'))
  ) {
    bonus += 1
  }
  if (attacker.hex && models?.length) {
    for (const cmd of models) {
      if (!cmd.alive || cmd.role !== 'commander' || cmd.side === attacker.side) continue
      if (!hasAbility(cmd, 'Basilisk Ward') || !cmd.hex) continue
      const lizardAdj = models.filter(
        (m) =>
          m.alive &&
          m.side === cmd.side &&
          String(m.race) === 'Lizardman' &&
          m.hex &&
          hexDist(m.hex, attacker.hex) === 1 &&
          hexDist(m.hex, cmd.hex) <= (cmd.radius || 6),
      )
      if (lizardAdj.length >= 2) {
        bonus -= 1
        break
      }
    }
  }
  return bonus
}

const FORMATION_UV_CAP = 3

function isCheapUnit(m) {
  return (m?.uv ?? 99) <= FORMATION_UV_CAP
}

/** Adjacent same-company unit with a Formation keyword (cheap-unit support aura). */
function hasAdjacentFormationProvider(model, models, keyword) {
  if (!model?.hex || !models?.length || model.companyId == null) return false
  return models.some(
    (m) =>
      m.alive &&
      m.id !== model.id &&
      m.side === model.side &&
      m.companyId === model.companyId &&
      m.hex &&
      hexDist(m.hex, model.hex) === 1 &&
      hasAbility(m, keyword),
  )
}

/** Final 2d6 hit requirement after distance, defender penalties, and hit buffs. */
function hitRequirement(attacker, defender, dist, models, map = null) {
  let need = HIT_NEED[dist] ?? HIT_NEED_MAX
  // Harder to hit — Fearless ignores Fear penalty
  if (attacker.fear && !hasAbility(attacker, 'Fearless') && !attacker._tempFearless) need += 1
  // Desert Base: cannot Evade — ignore active Evade while in Desert.
  if (defender._evade) {
    const defTerrain =
      map && defender.hex ? getTerrainAt(map, defender.hex) : null
    if (defTerrain !== 'desert') need += 1
  }
  // Mountains Base: +1 Hit Requirement unless attacker is also in Mountains.
  if (map && defender.hex) {
    const defTerrain = getTerrainAt(map, defender.hex)
    if (defTerrain === 'mountains') {
      const atkTerrain = attacker.hex ? getTerrainAt(map, attacker.hex) : 'plains'
      if (atkTerrain !== 'mountains') need += 1
    }
    // Forest Base: ranged (dist ≥ 2) into Forest +1 Hit Requirement;
    // Favored (Woodwalker): ignore when attacking from Forest.
    if (dist >= 2 && defTerrain === 'forest') {
      const atkTerrain = attacker.hex ? getTerrainAt(map, attacker.hex) : 'plains'
      const ignore =
        unitHasTerrainFavored(attacker, 'forest') && atkTerrain === 'forest'
      if (!ignore) need += 1
    }
  }
  // Easier to hit (+1 Hit ⇒ −1 need) — from keywords, Compact dials, Flanking, favored terrain, etc.
  need -= hitBonus(attacker, defender, models, dist, map)
  return Math.max(HIT_NEED_MIN, Math.min(HIT_NEED_MAX, need))
}

/**
 * Apply damage reductions with a floor of 1 unless `allowZero` (explicit ignore-attack rules).
 */
function reduceDamageFloor(dmg, amount, allowZero = false) {
  const next = dmg - amount
  if (allowZero) return Math.max(0, next)
  if (dmg <= 0) return 0
  return Math.max(1, next)
}

function isBeastType(m) {
  if (!m) return false
  const p = String(m.primaryType || '').toLowerCase()
  const s = String(m.secondaryType || '').toLowerCase()
  return p === 'beast' || s === 'beast' || m.tags?.has?.('beast')
}

function isBeastfolkLike(m) {
  if (!m) return false
  return (
    String(m.race || '').toLowerCase() === 'beastfolk' ||
    m.tags?.has?.('beastfolk') ||
    isBeastType(m)
  )
}

function isSiegeLike(m) {
  if (!m) return false
  if (hasAbility(m, 'Siege')) return true
  const p = String(m.primaryType || '').toLowerCase()
  const s = String(m.secondaryType || '').toLowerCase()
  return p === 'siege' || s === 'siege' || m.tags?.has?.('siege') || String(m.race || '') === 'Siege'
}

function isDragonLike(m) {
  return String(m.race || '').toLowerCase() === 'dragon' || m.tags?.has?.('dragon')
}

function isConstructLike(m) {
  if (!m) return false
  if (String(m.race || '').toLowerCase() === 'construct') return true
  const p = String(m.primaryType || '').toLowerCase()
  return p === 'construct' || m.tags?.has?.('construct')
}

function isUndeadLike(m) {
  return String(m.race || '').toLowerCase() === 'undead' || m.tags?.has?.('undead')
}

function placeRaisedUnit(dead, models, map, preferHex = null, hp = 2) {
  if (!dead) return false
  dead.alive = true
  dead.hp = Math.min(Math.max(1, hp), dead.toughness || hp)
  dead._revenantUsed = true
  const occ = new Set(
    models.filter((m) => m.alive && m.hex && m.id !== dead.id).map((m) => hexKey(m.hex.q, m.hex.r)),
  )
  const tryPlace = (h) => {
    if (!h || !inBounds(h) || occ.has(hexKey(h.q, h.r))) return false
    if (!canOccupyHex(map, h, dead)) return false
    dead.hex = { q: h.q, r: h.r }
    occ.add(hexKey(h.q, h.r))
    return true
  }
  if (preferHex) {
    if (tryPlace(preferHex)) return true
    for (const h of neighbors(preferHex)) {
      if (tryPlace(h)) return true
    }
  }
  for (const h of edgeRowHexes(dead.side)) {
    if (tryPlace(h)) return true
  }
  dead.alive = false
  dead.hp = 0
  return false
}

function isHexFortified(map, hex) {
  if (!map || !hex) return false
  return !!map.cells.get(hexKey(hex.q, hex.r))?.fortified
}

function fortifyHex(map, hex) {
  if (!map || !hex || !inBounds(hex)) return false
  const cell = map.cells.get(hexKey(hex.q, hex.r))
  if (!cell || cell.fortified) return false
  cell.fortified = true
  return true
}

/** Fortify hex; occupant gains +1 Harden (stacks). Fortified hex also adds +1 Harden at damage time. */
function fortifyHexWithOccupantHarden(map, hex, models, side) {
  if (!fortifyHex(map, hex)) return false
  if (!models?.length || !hex) return true
  const occ = models.find(
    (m) => m.alive && m.side === side && m.hex && m.hex.q === hex.q && m.hex.r === hex.r,
  )
  if (occ) occ.harden = (occ.harden || 0) + 1
  return true
}

function demolishFortification(map, hex, ctx = null) {
  if (!map || !hex) return false
  const cell = map.cells.get(hexKey(hex.q, hex.r))
  if (!cell?.fortified) return false
  cell.fortified = false
  if (ctx?.models && ctx?.sideState) applyRuinTithe(hex, ctx.models, ctx.sideState)
  return true
}

/** Ruin Tithe: once/round, demolishing a fort in CR grants 1 Company AP. */
function applyRuinTithe(hex, models, sideState) {
  if (!hex || !models || !sideState) return
  const cmd = models.find(
    (m) =>
      m.alive &&
      m.side === sideState.side &&
      m.role === 'commander' &&
      hasAbility(m, 'Ruin Tithe'),
  )
  if (!cmd?.hex || cmd._ruinTitheUsed) return
  if (hexDist(cmd.hex, hex) > (cmd.radius || 6)) return
  cmd._ruinTitheUsed = true
  const co = sideState.companies.find((c) => c.officerModel?.alive)
  if (co) co.ap += 1
}

/** Siege bonus vs units on Fortified hexes (+1, or +2 for heavy Slow siege). */
function siegeBonusVsFortified(attacker, map, defenderHex) {
  const fortified = isHexFortified(map, defenderHex)
  if (!fortified) return 0
  if (attacker._scorchSiege) return 1
  if (!hasAbility(attacker, 'Siege')) return 0
  if (hasAbility(attacker, 'Slow') && (attacker.range || 1) >= 3) return 2
  const n = String(attacker.name || '')
  if (/Trebuchet|Ironhead|Ironbreaker Cannon|Crypt Ram/i.test(n)) return 2
  return 1
}

function blastRadiusOf(attacker) {
  // Printed Blast and temporary Blast grants are always radius 1 (no scaling).
  if (attacker._blastRadius) return 1
  if (hasAbility(attacker, 'Blast')) return 1
  return 0
}

function planBlastAssignments(attacker, primary, models, dmg, radius) {
  if (!primary?.hex || dmg <= 0) return []
  const out = [{ target: primary, dmg }]
  for (const m of models) {
    if (!m.alive || m.id === primary.id || m.side === attacker.side || !m.hex) continue
    if (hexDist(primary.hex, m.hex) <= radius) out.push({ target: m, dmg })
  }
  return out
}

function tryRevenantReturn(defender, models, map) {
  if (!hasAbility(defender, 'Revenant') || defender._revenantUsed) return false
  const deathHex = defender.hex ? { q: defender.hex.q, r: defender.hex.r } : null
  const returnHp = Math.max(1, Math.floor((defender.toughness || 2) / 2))
  defender._revenantUsed = true
  defender.hp = returnHp
  defender.alive = true

  const occ = new Set(
    models.filter((m) => m.alive && m.hex && m.id !== defender.id).map((m) => hexKey(m.hex.q, m.hex.r)),
  )
  const tryPlace = (h) => {
    if (!h || !inBounds(h) || occ.has(hexKey(h.q, h.r))) return false
    if (!canOccupyHex(map, h, defender)) return false
    defender.hex = { q: h.q, r: h.r }
    return true
  }

  // Prefer death hex, then nearest unoccupied hex by hex distance (BFS rings).
  if (deathHex) {
    if (tryPlace(deathHex)) {
      if (map) syncOccupants(map, models)
      return true
    }
    const seen = new Set([hexKey(deathHex.q, deathHex.r)])
    let frontier = [deathHex]
    while (frontier.length) {
      const next = []
      for (const h of frontier) {
        for (const n of neighbors(h)) {
          const k = hexKey(n.q, n.r)
          if (seen.has(k)) continue
          seen.add(k)
          if (tryPlace(n)) {
            if (map) syncOccupants(map, models)
            return true
          }
          next.push(n)
        }
      }
      frontier = next
    }
  }

  defender.alive = false
  defender.hp = 0
  return false
}

const AXIAL_DIRS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
]

function hexKey(q, r) {
  return `${q},${r}`
}
function hexDist(a, b) {
  return (
    (Math.abs(a.q - b.q) +
      Math.abs(a.q + a.r - b.q - b.r) +
      Math.abs(a.r - b.r)) /
    2
  )
}
function neighbors(h) {
  return AXIAL_DIRS.map(([dq, dr]) => ({ q: h.q + dq, r: h.r + dr }))
}

/** Hex on the far side of `target` from `origin`. */
function hexBehind(origin, target) {
  const vq = target.q - origin.q
  const vr = target.r - origin.r
  if (vq === 0 && vr === 0) return null
  const originDist = hexDist(origin, target)
  let best = null
  let bestDot = -Infinity
  for (const n of neighbors(target)) {
    if (hexDist(origin, n) <= originDist) continue
    const dot = (n.q - target.q) * vq + (n.r - target.r) * vr
    if (dot > bestDot) {
      bestDot = dot
      best = n
    }
  }
  return best
}
function inBounds(h) {
  const { col, row } = axialToOddR(h.q, h.r)
  return (
    Number.isInteger(col) &&
    Number.isInteger(row) &&
    col >= 0 &&
    row >= 0 &&
    col < BOARD_SIZE &&
    row < BOARD_SIZE
  )
}
function mulberry32(seed) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function countWaterOnMap(cells) {
  let n = 0
  for (const c of cells.values()) if (c.terrain === 'water') n++
  return n
}

/** Approx command-radius rows for seat A (north) / B (south) during setup. */
function commandZoneRows(side) {
  if (side === 'A') return { lo: 0, hi: DEPLOY_DEPTH + 2 }
  return { lo: BOARD_SIZE - 1 - (DEPLOY_DEPTH + 2), hi: BOARD_SIZE - 1 }
}

function foreignCommandZoneFilter(side) {
  const foreign = commandZoneRows(side === 'A' ? 'B' : 'A')
  return (cell) => cell.row < foreign.lo || cell.row > foreign.hi
}

/**
 * Place a contiguous terrain piece (bot stand-in for play piece decks).
 * Honors objectives, optional zone filter, and soft water cap.
 */
function placeTerrainPiece(
  cells,
  rng,
  objectives,
  terrain,
  targetSize,
  { allowed = null, allowOverwrite = false } = {},
) {
  if (terrain === 'water' && countWaterOnMap(cells) >= WATER_HEX_CAP) return 0
  const candidates = [...cells.values()].filter((c) => {
    if (isObjectiveHex(c, objectives)) return false
    if (allowed && !allowed(c)) return false
    if (!allowOverwrite && c.terrain !== 'plains') return false
    if (terrain === 'water' || terrain === 'wall') {
      /* ok */
    }
    return true
  })
  if (!candidates.length) return 0
  const seed = candidates[Math.floor(rng() * candidates.length)]
  let placed = 0
  const queue = [seed]
  const seen = new Set()
  while (queue.length && placed < targetSize) {
    const cur = queue.shift()
    const key = hexKey(cur.q, cur.r)
    if (seen.has(key)) continue
    seen.add(key)
    const cell = cells.get(key)
    if (!cell || isObjectiveHex(cell, objectives)) continue
    if (allowed && !allowed(cell)) continue
    if (!allowOverwrite && cell.terrain !== 'plains') continue
    if (terrain === 'water' && countWaterOnMap(cells) >= WATER_HEX_CAP && placed === 0) {
      return 0
    }
    cell.terrain = terrain
    cell.bridge = false
    placed++
    for (const n of neighbors(cur)) {
      if (!inBounds(n)) continue
      const nk = hexKey(n.q, n.r)
      if (!seen.has(nk)) queue.push(cells.get(nk) || n)
    }
  }
  if (placed === 0 && targetSize > 1) {
    return placeTerrainPiece(cells, rng, objectives, terrain, Math.max(1, Math.floor(targetSize / 2)), {
      allowed,
      allowOverwrite,
    })
  }
  return placed
}

const LAND_KINDS = ['forest', 'swamp', 'desert', 'volcanic', 'mountains', 'water', 'plains']
const COMMAND_ZONE_KINDS = ['plains', 'forest', 'swamp', 'desert', 'volcanic', 'mountains', 'water']

function pickLandKind(rng, sizeClass) {
  // Small pieces may include walls; large/medium stay land/water.
  if (sizeClass === 'small' && rng() < 0.15) return 'wall'
  const roll = rng()
  if (roll < 0.18) return 'forest'
  if (roll < 0.32) return 'swamp'
  if (roll < 0.46) return 'desert'
  if (roll < 0.56) return 'volcanic'
  if (roll < 0.66) return 'mountains'
  if (roll < 0.82) return 'water'
  return 'plains'
}

/**
 * Play-aligned setup: plains board → objectives → command-zone pieces →
 * landLarge → landMedium → landSmall → remaining hexes stay plains.
 */
function createMap(rng) {
  const cells = new Map()
  for (const h of allBoardHexes()) {
    cells.set(hexKey(h.q, h.r), {
      q: h.q,
      r: h.r,
      col: h.col,
      row: h.row,
      terrain: 'plains',
      occupant: null,
      bridge: false,
      fortified: false,
    })
  }

  const card = drawObjectiveCard(rng)
  let markers = card.markers
  const rotated = rng() < 0.5
  if (rotated) markers = rotateOddR180(markers)
  const objectives = markers.map((m, i) => {
    const a = oddRToAxial(m.col, m.row)
    return {
      id: `${card.id}-${i}`,
      cardId: card.id,
      q: a.q,
      r: a.r,
      col: m.col,
      row: m.row,
      controller: null,
    }
  })

  const stagePlaced = { commandZone: 0, landLarge: 0, landMedium: 0, landSmall: 0 }

  // Stage 1: command zone — 3 picks per seat inside own CR rows.
  for (const side of ['A', 'B']) {
    const zone = commandZoneRows(side)
    const inZone = (c) => c.row >= zone.lo && c.row <= zone.hi
    for (let i = 0; i < TERRAIN_PICKS_PER_PLAYER; i++) {
      const kind = COMMAND_ZONE_KINDS[Math.floor(rng() * COMMAND_ZONE_KINDS.length)]
      const size = 4 + Math.floor(rng() * 6) // medium-ish CR pieces
      stagePlaced.commandZone += placeTerrainPiece(cells, rng, objectives, kind, size, {
        allowed: inZone,
      })
    }
  }

  // Stages 2–4: alternating land drops (bot places for both seats).
  const landStages = [
    { key: 'landLarge', size: () => 10 + Math.floor(rng() * 8) },
    { key: 'landMedium', size: () => 5 + Math.floor(rng() * 5) },
    { key: 'landSmall', size: () => 1 + Math.floor(rng() * 3) },
  ]
  for (const stage of landStages) {
    for (let drop = 0; drop < TERRAIN_LAND_DROPS_PER_SIZE * 2; drop++) {
      const side = drop % 2 === 0 ? 'A' : 'B'
      // ~20% skip (place-or-skip).
      if (rng() < 0.2) continue
      const kind = pickLandKind(rng, stage.key.replace('land', '').toLowerCase())
      const sizeClass =
        stage.key === 'landLarge' ? 'large' : stage.key === 'landMedium' ? 'medium' : 'small'
      const kindFinal = sizeClass === 'small' && rng() < 0.18 ? 'wall' : kind
      const n = placeTerrainPiece(cells, rng, objectives, kindFinal, stage.size(), {
        allowed: foreignCommandZoneFilter(side),
      })
      stagePlaced[stage.key] += n
    }
  }

  // Objectives never stay water/wall.
  for (const o of objectives) {
    const cell = cells.get(hexKey(o.q, o.r))
    if (!cell) continue
    if (cell.terrain === 'water' || cell.terrain === 'wall') {
      cell.terrain = 'plains'
      cell.bridge = false
    }
  }

  const counts = { plains: 0, forest: 0, desert: 0, swamp: 0, water: 0, wall: 0 }
  for (const c of cells.values()) counts[c.terrain] = (counts[c.terrain] || 0) + 1
  return {
    cells,
    objectives,
    counts,
    hasRiver: false,
    bridges: [],
    bridgeCount: 0,
    waterCap: WATER_HEX_CAP,
    stagePlaced,
    objectiveCardId: card.id,
    objectiveCardName: card.name,
    objectiveRotated: rotated,
  }
}

function hasAbility(entity, name) {
  if (name === 'Shieldwall' && entity._tempShieldwall) return true
  if (name === 'Reach' && entity._tempReach) return true
  if ((entity.abilities || []).includes(name)) return true
  const kws = entity.keywords || []
  if (kws.includes(name)) return true
  // Parameterized keywords: "Harden" matches "Harden 1" / "Harden 2"
  if (name === 'Harden') {
    return kws.some((k) => /^Harden \d+$/.test(String(k)))
  }
  if (name === 'Blast') {
    // Blast is fixed radius 1 — accept legacy "Blast 2" prints as Blast.
    return kws.some((k) => k === 'Blast' || /^Blast \d+$/.test(String(k)))
  }
  if (name === 'MultiStrike') {
    return kws.some((k) => k === 'MultiStrike' || /^MultiStrike \d+$/.test(String(k)))
  }
  return false
}

/** Printed/granted Harden X value (0 if none). */
function hardenRankFromKeywords(entity) {
  let best = 0
  for (const k of entity.keywords || []) {
    const m = /^Harden (\d+)$/.exec(String(k))
    if (m) best = Math.max(best, Number(m[1]))
  }
  return best
}

function tagsOf(card) {
  return new Set((card.tags || []).map((t) => String(t).toLowerCase()))
}

function combatScore(c) {
  return (
    (c.damage || 0) * 2 +
    (c.toughness || 0) * 1.4 +
    (c.move || 0) * 0.4 +
    ((c.range || 1) > 1 ? 1.2 : 0) -
    (c.uv || 0) * 0.1
  )
}

function typeTokens(card) {
  const out = new Set()
  for (const t of [card.primaryType, card.secondaryType, ...(card.tags || [])]) {
    if (!t) continue
    out.add(String(t).toLowerCase())
  }
  return out
}

/** Ability names + tags that act as soft keywords (Charge, Frenzy, Ranged, …). */
function keywordTokens(card) {
  const out = new Set()
  for (const a of card.abilities || []) {
    if (a) out.add(String(a).toLowerCase())
  }
  for (const k of card.keywords || []) {
    if (k) out.add(String(k).toLowerCase())
  }
  if (card.ultimate) out.add(String(card.ultimate).toLowerCase())
  for (const t of card.tags || []) {
    if (t) out.add(String(t).toLowerCase())
  }
  for (const t of [card.primaryType, card.secondaryType]) {
    if (t) out.add(String(t).toLowerCase())
  }
  if ((card.range || 1) >= 2) out.add('ranged')
  return out
}

function supportLists(officer) {
  const races = (officer.supportedRaces || []).map((x) => String(x).toLowerCase())
  const types = (officer.supportedTypes || []).map((x) => String(x).toLowerCase())
  const keywords = (officer.supportedKeywords || []).map((x) => String(x).toLowerCase())
  // Defaults when YAML omitted: prefer own race + primary/secondary types
  if (!races.length && officer.race) races.push(String(officer.race).toLowerCase())
  if (!types.length) {
    for (const t of [officer.primaryType, officer.secondaryType]) {
      if (t) types.push(String(t).toLowerCase())
    }
  }
  return { races, types, keywords }
}

/**
 * Affinity score for open-ally company fill.
 * Same race / supported race / type / keyword → strong; cross-race filler stays > 0.
 */
function officerSupportsUnit(officer, unit) {
  const { races, types, keywords } = supportLists(officer)
  const uRace = String(unit.race || '').toLowerCase()
  const uTypes = typeTokens(unit)
  const uKeys = keywordTokens(unit)
  let score = 0.35 // always recruitable under rarity caps

  if (uRace && races.includes(uRace)) score += 5
  else if (uRace && String(officer.race || '').toLowerCase() === uRace) score += 4

  for (const t of types) {
    if (uTypes.has(t) || uKeys.has(t)) score += 3.5
  }
  const oPrim = String(officer.primaryType || '').toLowerCase()
  const uPrim = String(unit.primaryType || '').toLowerCase()
  if (oPrim && oPrim === uPrim) score += 3
  const oSec = String(officer.secondaryType || '').toLowerCase()
  if (oSec && (oSec === uPrim || uTypes.has(oSec))) score += 1.5

  for (const k of keywords) {
    if (uKeys.has(k) || uTypes.has(k)) score += 2.5
  }
  if (
    keywords.some((k) => k === 'ranged' || k.includes('volley') || k.includes('arrow')) &&
    (unit.range || 1) >= 2
  ) {
    score += 2
  }
  if (
    keywords.some((k) => k === 'charge' || k === 'frenzy') &&
    (uKeys.has('charge') || uKeys.has('frenzy'))
  ) {
    score += 1.5
  }

  return score
}

function synergyScore(officer, unit) {
  return combatScore(unit) + officerSupportsUnit(officer, unit) * 1.2
}

function pickWeighted(rng, items, weightFn) {
  if (!items.length) return null
  const weights = items.map((item) => Math.max(0.01, weightFn(item)))
  const total = weights.reduce((s, w) => s + w, 0)
  let roll = rng() * total
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return items[i]
  }
  return items[items.length - 1]
}

function shuffleInPlace(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/** Army-wide copy limits by rarity (Legendary/Epic unique). */
function maxCopiesForCard(card) {
  if (card?.unique) return 1
  const r = String(card?.rarity || 'Common').toLowerCase()
  if (r === 'legendary' || r === 'epic') return 1
  if (r === 'rare') return 2
  if (r === 'uncommon') return 3
  return 4 // Common (and anything else)
}

function armyRemaining(armyCounts, card) {
  const have = armyCounts.get(card.name) || 0
  return Math.max(0, maxCopiesForCard(card) - have)
}

function armyTake(armyCounts, card, n = 1) {
  armyCounts.set(card.name, (armyCounts.get(card.name) || 0) + n)
}

/** Playable faction identities (Siege is a shared kit, not a list race). */
const PLAYABLE_RACES = [
  'Human',
  'Elf',
  'Demon',
  'Lizardman',
  'Dwarf',
  'Dragon',
  'Beastfolk',
  'Undead',
  'Construct',
]

/**
 * Commanders to cover for a list identity.
 * Mono: every commander of that race.
 * Mixed: one commander per playable race (keeps coverage tractable).
 */
function commandersForList(race, allCards) {
  if (race === 'Mixed') {
    const byRace = new Map()
    for (const c of allCards) {
      if (c.cardType !== 'Commander') continue
      if (!PLAYABLE_RACES.includes(c.race)) continue
      if (!byRace.has(c.race)) byRace.set(c.race, [])
      byRace.get(c.race).push(c)
    }
    return PLAYABLE_RACES.map((r) => {
      const list = byRace.get(r) || []
      if (!list.length) return null
      // Prefer Compact kinship when present so Mixed still exercises race auras.
      return (
        list.find((c) =>
          (c.abilities || []).some((a) => String(a).endsWith(' Compact')),
        ) || list[0]
      )
    }).filter(Boolean)
  }
  return allCards.filter((c) => c.cardType === 'Commander' && c.race === race)
}

/**
 * Build games so each commander on either side appears ≥ minPerCmd times.
 * Uses a full A×B grid with enough repetitions.
 */
function matchupCommanderGames(cmdsA, cmdsB, minPerCmd = MIN_RUNS_PER_COMMANDER) {
  const a = cmdsA.length ? cmdsA : [null]
  const b = cmdsB.length ? cmdsB : [null]
  const k = Math.max(
    1,
    Math.ceil(minPerCmd / Math.max(1, b.length)),
    Math.ceil(minPerCmd / Math.max(1, a.length)),
  )
  const games = []
  for (const ca of a) {
    for (const cb of b) {
      for (let rep = 0; rep < k; rep++) {
        games.push({ cmdA: ca, cmdB: cb, rep })
      }
    }
  }
  return games
}

/**
 * Build an army list.
 * - Named race: mono-race — commander, officers, and units all match (play enforceCommanderRace).
 * - 'Mixed': coalition list — commander from any playable race; officers from several races.
 * - opts.commanderCard: force a specific commander (coverage mode).
 */
function buildForce(race, allCards, rng = Math.random, opts = {}) {
  const mixed = race === 'Mixed'
  const commanders = allCards.filter(
    (c) =>
      c.cardType === 'Commander' &&
      (mixed ? PLAYABLE_RACES.includes(c.race) : c.race === race),
  )
  const officers = allCards.filter(
    (c) =>
      c.cardType === 'Officer' &&
      (mixed ? PLAYABLE_RACES.includes(c.race) : c.race === race),
  )
  // Units: mono lists stay on-race; Mixed keeps open-ally pool.
  const units = allCards.filter((c) => {
    if (c.cardType !== 'Unit' || c.damage == null || c.toughness == null || c.move == null) {
      return false
    }
    if (mixed) return true
    return c.race === race
  })

  const armyCounts = new Map()

  let commander = opts.commanderCard || null
  if (commander) {
    commander = commanders.find((c) => c.name === commander.name) || null
  }
  if (!commander) {
    const commanderPool = [...commanders]
      .filter((c) => armyRemaining(armyCounts, c) > 0)
      .sort((a, b) => {
        const score = (c) =>
          (c.ccGeneration || 0) * 3 +
          (c.damage != null && c.toughness != null ? 1 : 0) +
          (c.apGeneration || 0) * 0.4 -
          (c.uv || 0) * 0.6
        return score(b) - score(a)
      })
    const poolSize = mixed
      ? Math.min(8, commanderPool.length)
      : commanderPool.length
    commander =
      pickWeighted(rng, commanderPool.slice(0, Math.max(1, poolSize)), (c) => {
        const score =
          2 +
          (c.ccGeneration || 0) * 1.5 +
          (c.apGeneration || 0) * 0.4 -
          (c.uv || 0) * 0.25
        return Math.max(0.75, score)
      }) || commanders[0]
  }
  if (commander) armyTake(armyCounts, commander, 1)

  const officerScore = (o) =>
    (o.companyCapacity || 0) * 1.1 +
    (o.companyUnitCap || 8) * 0.35 +
    (o.companyAp || 0) * 4 +
    (o.commandRadius || 0) -
    (o.uv || 0) * 0.8

  const rankedOfficers = [...officers].sort((a, b) => officerScore(b) - officerScore(a))
  const officerCandidates = mixed
    ? rankedOfficers.slice(0, Math.min(40, rankedOfficers.length))
    : rankedOfficers.slice(0, Math.min(16, rankedOfficers.length))

  const fillCompanyRoster = (officer, armyUvRoom = Infinity) => {
    const cap = Math.min(officer.companyCapacity || 18, armyUvRoom)
    const unitCap = officer.companyUnitCap || 10
    if (cap < 1) return null
    const roster = []
    let usedUv = 0
    const modelCount = () => roster.reduce((s, r) => s + r.copies, 0)
    // ~30%: lean elite company (few high-UV models) — players min/max officers this way.
    // Beastfolk mono: lean slightly more often so Pack spam is less automatic.
    const leanElite = rng() < (!mixed && race === 'Beastfolk' ? 0.38 : 0.3)
    const targetUv = leanElite ? Math.min(cap, 10 + Math.floor(rng() * 10)) : cap

    const addCopies = (unit, want) => {
      const roomUv = Math.floor((targetUv - usedUv) / (unit.uv || 1))
      const roomArmy = armyRemaining(armyCounts, unit)
      const roomModels = unitCap - modelCount()
      const n = Math.min(want, roomUv, roomArmy, roomModels)
      if (n <= 0) return 0
      const existing = roster.find((r) => r.unit.name === unit.name)
      if (existing) existing.copies += n
      else roster.push({ unit, copies: n })
      armyTake(armyCounts, unit, n)
      usedUv += n * (unit.uv || 0)
      return n
    }

    let guard = 40
    while (usedUv + 1 <= targetUv && modelCount() < unitCap && guard-- > 0) {
      const options = []
      for (const unit of units) {
        if (!unit.uv) continue
        if (unit.uv > targetUv - usedUv) continue
        if (armyRemaining(armyCounts, unit) <= 0) continue
        const support = officerSupportsUnit(officer, unit)
        let spice = 0
        if (mixed && unit.race && unit.race !== officer.race) {
          const role =
            (unit.range || 1) >= 2 ||
            String(unit.primaryType || '').toLowerCase() === 'siege' ||
            (unit.keywords || []).some((k) =>
              [
                'Harden',
                'Amphibious',
                'Pack',
                'Flying',
                'Revenant',
                'Fearless',
                'Siege',
                'Formation Drill',
                'Formation Guard',
                'Formation March',
              ].includes(k.replace(/ \d+$/, '')),
            )
          // Mixed still gets open allies, but less free cherry-picking.
          if (role) spice += 0.45
        }
        const leftover = targetUv - usedUv
        const slotsLeft = unitCap - modelCount()
        const uv = unit.uv || 0
        const band = uv <= 2 ? 'small' : uv <= 5 ? 'medium' : 'large'
        let score =
          support * 3.6 +
          spice +
          combatScore(unit) * 0.2 +
          (4 - Math.min(4, armyCounts.get(unit.name) || 0)) * 0.25 +
          uv * 0.12
        // Mixed: soft penalty for off-race fillers so companies stay more coherent.
        if (mixed && unit.race && unit.race !== officer.race) score -= 1.25
        // Cheap Formation bodies are leftover filler, not the main spend.
        if ((unit.keywords || []).some((k) => String(k).startsWith('Formation'))) {
          score += leftover <= 3 ? 1.6 : -0.7
        }
        if (slotsLeft > 0) {
          const largeCount = roster.filter((r) => (r.unit.uv || 0) >= 6).reduce((s, r) => s + r.copies, 0)
          const mediumCount = roster.filter((r) => {
            const u = r.unit.uv || 0
            return u >= 3 && u <= 5
          }).reduce((s, r) => s + r.copies, 0)
          if (leftover <= 3 || slotsLeft === 1) {
            score += band === 'small' ? 2.2 : band === 'medium' ? 0.4 : -2
          } else if (largeCount < (unitCap >= 8 ? 2 : 1) && leftover >= 6) {
            score += band === 'large' ? 2.4 : band === 'small' ? -1.8 : 0.2
          } else if (mediumCount < Math.ceil(unitCap * 0.35)) {
            score += band === 'medium' ? 1.8 : band === 'large' ? 0.6 : -1.2
          } else if (band === 'small' && leftover > 5) {
            score -= 1.5
          }
        }
        // Beastfolk mono: soft-penalize cheap Pack bodies (list-build dial).
        if (
          !mixed &&
          race === 'Beastfolk' &&
          (unit.keywords || []).some((k) => String(k).startsWith('Pack'))
        ) {
          score -= 0.9
          if ((unit.uv || 0) <= 4) score -= 0.6
        }
        // Lean companies prefer quality over bodies.
        if (leanElite) score += unit.uv * 0.35 + combatScore(unit) * 0.15
        options.push({ unit, score, support })
      }
      if (!options.length) break
      options.sort((a, b) => b.score - a.score)
      const strong = options.filter((o) => o.support >= 3)
      const roomRatio = (targetUv - usedUv) / targetUv
      const pool =
        strong.length && roomRatio > 0.2 ? [...strong, ...options.slice(0, 6)] : options
      const pick = pickWeighted(rng, pool.slice(0, Math.min(14, pool.length)), (o) =>
        Math.max(0.15, o.score),
      )
      if (!pick) break
      const leftoverUv = targetUv - usedUv
      const slotsLeft = unitCap - modelCount()
      const pickUv = pick.unit.uv || 1
      const small = pickUv <= 2
      const copyWant = leanElite
        ? 1
        : small && leftoverUv > 5
          ? 1
          : pick.support >= 3
            ? 2
            : 1
      const want = Math.min(
        armyRemaining(armyCounts, pick.unit),
        Math.floor(leftoverUv / pickUv),
        maxCopiesForCard(pick.unit),
        slotsLeft,
        copyWant,
      )
      if (addCopies(pick.unit, Math.max(1, want)) <= 0) break
    }

    if (!roster.length) return null
    return {
      roster,
      copies: roster.reduce((s, r) => s + r.copies, 0),
      companyUv: usedUv,
    }
  }

  const maxArmyOfficers = 10
  const pickedOfficers = []
  const companies = []

  const armyUvSoFar = () =>
    (commander?.uv || 0) +
    pickedOfficers.reduce((s, o) => s + (o.uv || 0), 0) +
    companies.reduce((s, c) => s + (c.companyUv || 0), 0)

  const officerRaceCounts = () => {
    const m = new Map()
    for (const o of pickedOfficers) m.set(o.race, (m.get(o.race) || 0) + 1)
    return m
  }

  const tryAddOfficer = (officer) => {
    if (pickedOfficers.length >= maxArmyOfficers) return false
    if (armyRemaining(armyCounts, officer) <= 0) return false
    if (pickedOfficers.some((o) => o.name === officer.name)) return false
    if (armyUvSoFar() + (officer.uv || 0) > ARMY_UV) return false
    if (armyUvSoFar() + (officer.uv || 0) + 4 > ARMY_UV) return false
    const co = fillCompanyRoster(officer, ARMY_UV - armyUvSoFar() - (officer.uv || 0))
    if (!co) return false
    armyTake(armyCounts, officer, 1)
    pickedOfficers.push(officer)
    companies.push({
      officer,
      roster: co.roster,
      copies: co.copies,
      companyUv: co.companyUv,
    })
    return true
  }

  // Mixed: greedily pick high-value officers from under-represented races first.
  if (mixed) {
    const targetDistinct = 3
    let guard = 80
    while (pickedOfficers.length < maxArmyOfficers && armyUvSoFar() < ARMY_UV - 8 && guard-- > 0) {
      const counts = officerRaceCounts()
      const distinct = counts.size
      const ranked = [...officerCandidates]
        .filter(
          (o) => !pickedOfficers.some((p) => p.name === o.name) && armyRemaining(armyCounts, o) > 0,
        )
        .map((o) => {
          const have = counts.get(o.race) || 0
          const diversity =
            distinct < targetDistinct && have === 0 ? 5 : have === 0 ? 1.5 : have === 1 ? 0 : -4
          return { o, score: officerScore(o) + diversity }
        })
        .sort((a, b) => b.score - a.score)
      if (!ranked.length) break
      const top = ranked.slice(0, Math.min(10, ranked.length))
      const pick = pickWeighted(rng, top, (x) => Math.max(0.2, x.score))
      if (!pick || !tryAddOfficer(pick.o)) {
        let added = false
        for (const x of ranked.slice(0, 15)) {
          if (tryAddOfficer(x.o)) {
            added = true
            break
          }
        }
        if (!added) break
      }
    }
  }

  const drawOrder = shuffleInPlace(rng, [...officerCandidates])
  for (const officer of drawOrder) {
    if (pickedOfficers.length >= maxArmyOfficers) break
    if (armyUvSoFar() >= ARMY_UV - 8) break
    tryAddOfficer(officer)
  }
  while (pickedOfficers.length < 3) {
    const officer = rankedOfficers.find(
      (o) =>
        !pickedOfficers.some((p) => p.name === o.name) && armyRemaining(armyCounts, o) > 0,
    )
    if (!officer || !tryAddOfficer(officer)) break
  }
  for (const officer of rankedOfficers) {
    if (pickedOfficers.length >= maxArmyOfficers) break
    if (armyUvSoFar() >= ARMY_UV - 8) break
    tryAddOfficer(officer)
  }

  const packages = companies.map((c, companyId) => {
    const entries = [{ card: c.officer, role: 'officer', companyId, uv: c.officer.uv || 0 }]
    for (const { unit, copies } of c.roster) {
      for (let i = 0; i < copies; i++) {
        entries.push({ card: unit, role: 'unit', companyId, uv: unit.uv || 0 })
      }
    }
    const uv = entries.reduce((s, e) => s + e.uv, 0)
    return { companyId, officer: c.officer, entries, uv, companyUv: c.companyUv }
  })

  const deployed = []
  const reserve = []
  const reservePackages = []
  let deployUv = 0
  let reserveUv = 0

  const pushDeploy = (entry) => {
    deployed.push(entry)
    deployUv += entry.uv
  }
  const pushReservePackage = (pkg) => {
    for (const e of pkg.entries) reserve.push(e)
    reservePackages.push(pkg)
    reserveUv += pkg.uv
  }

  pushDeploy({
    card: commander,
    role: 'commander',
    companyId: null,
    uv: commander.uv || 0,
  })

  // Opening wave: 4–5 companies (some may be lean elite 3–4 units). No cheap-unit bias.
  const startOfficerTarget = Math.min(packages.length, 4 + Math.floor(rng() * 2))
  const shuffledPkgs = shuffleInPlace(rng, [...packages])
  const startPkgs = []
  const leftoverPkgs = []
  let deploySiege = 0
  const pkgSiegeCount = (pkg) =>
    pkg.entries.filter((e) => e.role === 'unit' && isSiegeCard(e.card)).length

  for (const pkg of shuffledPkgs) {
    const extraSiege = pkgSiegeCount(pkg)
    if (
      startPkgs.length < startOfficerTarget &&
      deployUv + pkg.uv <= DEPLOY_UV &&
      deploySiege + extraSiege <= MAX_DEPLOY_SIEGE
    ) {
      startPkgs.push(pkg)
      for (const e of pkg.entries) pushDeploy(e)
      deploySiege += extraSiege
    } else {
      leftoverPkgs.push(pkg)
    }
  }
  // Spend remaining deploy UV on any leftover company that fits.
  leftoverPkgs.sort((a, b) => a.uv - b.uv)
  for (let i = 0; i < leftoverPkgs.length; ) {
    const pkg = leftoverPkgs[i]
    const extraSiege = pkgSiegeCount(pkg)
    if (
      deployUv + pkg.uv <= DEPLOY_UV &&
      deploySiege + extraSiege <= MAX_DEPLOY_SIEGE
    ) {
      startPkgs.push(pkg)
      for (const e of pkg.entries) pushDeploy(e)
      deploySiege += extraSiege
      leftoverPkgs.splice(i, 1)
    } else {
      i++
    }
  }

  for (const pkg of leftoverPkgs) {
    if (reserveUv + pkg.uv <= REINFORCE_UV) pushReservePackage(pkg)
  }

  const unused = []
  const unusedPackages = []
  let unusedUv = 0
  for (const pkg of leftoverPkgs) {
    if (reservePackages.includes(pkg)) continue
    if (unusedUv + pkg.uv <= ARMY_UNUSED_UV_MAX) {
      for (const e of pkg.entries) unused.push(e)
      unusedPackages.push(pkg)
      unusedUv += pkg.uv
    }
  }

  const deployUnits = deployed.filter((e) => e.role === 'unit').length
  const deployOfficers = deployed.filter((e) => e.role === 'officer').length
  const deployCommanders = deployed.filter((e) => e.role === 'commander').length
  const deployModels = deployUnits + deployOfficers + deployCommanders
  const deployFormationUnits = deployed.filter(
    (e) =>
      e.role === 'unit' &&
      (e.card.keywords || []).some((k) => String(k).startsWith('Formation')),
  ).length

  const unitRaceCounts = {}
  for (const e of [...deployed, ...reserve]) {
    if (e.role !== 'unit') continue
    const r = e.card.race || 'Unknown'
    unitRaceCounts[r] = (unitRaceCounts[r] || 0) + 1
  }
  const officerRaces = [...new Set(pickedOfficers.map((o) => o.race).filter(Boolean))]
  const allRacesPresent = [
    ...new Set(
      [commander?.race, ...officerRaces, ...Object.keys(unitRaceCounts)].filter(Boolean),
    ),
  ]

  return {
    race,
    mixed,
    composition: {
      commanderRace: commander?.race || null,
      officerRaces,
      officerRaceCounts: Object.fromEntries(officerRaceCounts()),
      unitRaceCounts,
      distinctRaces: allRacesPresent.length,
      races: allRacesPresent,
    },
    commander,
    officers: pickedOfficers,
    targetOfficers: startOfficerTarget,
    startOfficerTarget,
    armyOfficerCount: pickedOfficers.length,
    companies: companies.map((c) => ({
      officer: c.officer.name,
      officerRace: c.officer.race,
      officerTypes: [c.officer.primaryType, c.officer.secondaryType].filter(Boolean),
      unit: c.roster.map((r) => `${r.unit.name}×${r.copies}`).join(', '),
      unitRaces: [...new Set(c.roster.map((r) => r.unit.race).filter(Boolean))],
      mixedRace: c.roster.some((r) => r.unit.race && r.unit.race !== c.officer.race),
      roster: c.roster.map((r) => ({
        unit: r.unit.name,
        race: r.unit.race,
        rarity: r.unit.rarity || 'Common',
        copies: r.copies,
        max: maxCopiesForCard(r.unit),
        uv: r.unit.uv,
        types: [r.unit.primaryType, r.unit.secondaryType].filter(Boolean),
      })),
      copies: c.copies,
      companyUv: c.companyUv,
      cap: c.officer.companyCapacity,
      companyAp: c.officer.companyAp,
      radius: c.officer.commandRadius,
      abilities: c.officer.abilities || [],
      keywords: c.officer.keywords || [],
    })),
    armyLimits: {
      Common: 4,
      Uncommon: 3,
      Rare: 2,
      Epic: 1,
      Legendary: 1,
    },
    caps: {
      deploy: DEPLOY_UV,
      reserve: REINFORCE_UV,
      unused: ARMY_UNUSED_UV_MAX,
      army: ARMY_UV,
    },
    armyUv: armyUvSoFar(),
    deployed,
    reserve,
    unused,
    reservePackages,
    unusedPackages,
    deployUv,
    reserveUv,
    unusedUv,
    deployUnits,
    deployOfficers,
    deployCommanders,
    deployModels,
    deployFormationUnits,
  }
}

function makeModel(entry, side, id, opts = {}) {
  const c = entry.card
  return {
    id,
    side,
    name: c.name,
    role: entry.role,
    companyId: entry.companyId,
    race: c.race || null,
    fromMixedList: !!opts.fromMixedList,
    primaryType: c.primaryType || null,
    secondaryType: c.secondaryType || null,
    uv: c.uv || 0,
    baseDamage: c.damage || 0,
    toughness: c.toughness || 1,
    hp: c.toughness || 1,
    range: c.range || 1,
    baseMove: c.move || 1,
    radius: c.commandRadius || 0,
    companyApGen: c.companyAp || 0,
    ccGen: c.ccGeneration || 0,
    apGen: c.apGeneration || 0,
    abilities: [...(c.abilities || [])],
    keywords: [...(c.keywords || [])],
    ultimate: c.ultimate || null,
    tags: tagsOf(c),
    alive: true,
    hex: null,
    // per-activation / per-round status
    movedThisAct: 0,
    attackedThisRound: false,
    harden: hardenRankFromKeywords({ keywords: [...(c.keywords || [])] }),
    tempDamage: 0,
    tempMove: 0,
    hasCharge: false,
    hasFrenzy: false,
    hasHarass: false,
    hasStealth: false,
    hasPoisonAtk: false,
    poisonTokens: 0,
    fear: false,
    slow: false,
    tempHitBonus: 0,
    _tempFlanking: false,
    _evade: false,
    _reactionBrace: false,
    _retaliateUsedThisRound: false,
    _ignoreFirstHit: false,
    _ironCovenantUsed: false,
    _revenantUsed: false,
    _blastRadius: 0,
    _tempRangeBonus: 0,
    _raiseThrallUsed: false,
    damageTakenMod: 0, // e.g. suppress on attacker handled in effectiveDamage
    suppressUntilEor: 0,
    rootedUntilEor: false,
    regenEor: 0,
    // abilityName -> earliest round the Active can be used again
    abilityReadyRound: {},
    isolated: false,
  }
}

function resetRoundFlags(m) {
  m.attackedThisRound = false
  m._attackedThisAct = false
  m._allowExtraAttack = false
  m._bonusAttack = false
  m._freeAttack = false
  m._extraFreeAttack = false
  m.tempDamage = 0
  m.tempMove = 0
  m.hasCharge = hasAbility(m, 'Charge')
  m.hasFrenzy = hasAbility(m, 'Frenzy')
  m.hasHarass = hasAbility(m, 'Harass')
  m.hasStealth = hasAbility(m, 'Stealth')
  m.hasPoisonAtk = hasAbility(m, 'Poison')
  m.fear = false
  m.tempHitBonus = 0
  m._tempFlanking = false
  m._evade = false
  m._ignoreFirstHit = false
  m._ironCovenantUsed = false
  m._tempShieldwall = false
  m._tempReach = false
  m._manyHeadedUsed = false
  m._multiStrike = 0
  m._reactionBrace = false
  m._retaliateUsedThisRound = false
  m._blastRadius = 0
  m._tempRangeBonus = 0
  m._noMove = false
  m._noAttack = false
  m._scorchSiege = false
  m._terrorFear = false
  m._alphaMarked = false
  m._assaultMarked = false
  m._packHitAura = false
  m._wildRush = false
  m._flankPierce = false
  m._tempPiercing = false
  m._tempTrample = false
  m._mammothThunder = false
  m._lastStand = false
  m._lockstepAp = false
  m._tempFearless = false
  m._unyielding = false
  m._nullPulsed = false
  m._racialCompactApplied = false
  // _nullField (ultimate) persists until next commander refresh — clear each round
  m._nullField = false
  m._ruinTitheUsed = false
  m._bonePrisoned = false
  m._decayDebuff = false
  m._spectralStrike = false
  m._ignoreZoc = false
  m._sturdyBonesApplied = false
  m._cryptCommanderApplied = false
  m.suppressUntilEor = 0
  m.rootedUntilEor = false
  m.regenEor = 0
  m.harden = (m.harden || 0) + hardenRankFromKeywords(m)
  m._atkBuffs = null
  m._defBuffs = null
}

function inRadius(unit, officer) {
  if (!unit.hex || !officer?.hex || !officer.alive) return false
  const dist = hexDist(unit.hex, officer.hex)
  const radius = officer.radius || 0
  if (dist <= radius) return true
  // Scout: still counts as in-radius for bonuses up to SCOUT_CR_EXTENSION beyond.
  if (hasAbility(unit, 'Scout') && dist <= radius + SCOUT_CR_EXTENSION) return true
  return false
}

function companyMembers(models, side, companyId) {
  return models.filter(
    (m) => m.alive && m.side === side && m.companyId === companyId && m.role === 'unit',
  )
}

function officerOf(models, side, companyId) {
  return models.find(
    (m) => m.alive && m.side === side && m.role === 'officer' && m.companyId === companyId,
  )
}

/**
 * Same-side allies within the caster's printed Range (includes self at dist 0).
 * Combat Unit heals/buffs may land on any friendly creature in Range.
 */
function armyAlliesInRange(models, caster) {
  if (!caster?.alive || !caster.hex) return []
  const range = Math.max(0, caster.range || 1)
  return models.filter(
    (m) =>
      m.alive &&
      m.side === caster.side &&
      m.hex &&
      hexDist(caster.hex, m.hex) <= range,
  )
}

/** Combat units only within printed Range (officer company heals if needed). */
function armyUnitsInRange(models, caster) {
  return armyAlliesInRange(models, caster).filter((m) => m.role === 'unit')
}

function syncOccupants(map, models) {
  for (const c of map.cells.values()) c.occupant = null
  for (const m of models) {
    if (m.alive && m.hex) map.cells.get(hexKey(m.hex.q, m.hex.r)).occupant = m.id
  }
}

function moveModelToward(map, model, target, models, budget, opts = {}) {
  if (!model.hex || budget <= 0) return 0
  if (model._rooted) return 0
  const ignoreTerrainCosts = !!opts.ignoreTerrainCosts
  let remaining = budget
  let pos = { ...model.hex }
  const startHex = { ...model.hex }
  let steps = 0
  const occupied = new Set(
    models.filter((m) => m.alive && m.id !== model.id && m.hex).map((m) => hexKey(m.hex.q, m.hex.r)),
  )
  // If water blocks the straight approach, funnel non-Amphibious units through a bridge.
  let aim = target
  if (
    !ignoreTerrainCosts &&
    map.hasRiver &&
    map.bridges?.length &&
    !hasAbility(model, 'Amphibious') &&
    !hasAbility(model, 'Flying') &&
    !model._swampKinship
  ) {
    const goalCell = map.cells.get(hexKey(target.q, target.r))
    const onBridge = map.cells.get(hexKey(pos.q, pos.r))?.bridge
    if (!onBridge && goalCell) {
      const bestBridge = [...map.bridges].sort(
        (a, b) =>
          hexDist(pos, a) + hexDist(a, target) - (hexDist(pos, b) + hexDist(b, target)),
      )[0]
      // Aim at bridge until we're on/adjacent to it, then resume original target.
      if (bestBridge && hexDist(pos, bestBridge) > 0) {
        const viaBridge = hexDist(pos, bestBridge) + hexDist(bestBridge, target)
        const direct = hexDist(pos, target)
        // Prefer bridge when it isn't much longer — or when any water neighbor sits toward the goal.
        const waterBlocks = neighbors(pos).some((n) => {
          if (!inBounds(n)) return false
          const c = map.cells.get(hexKey(n.q, n.r))
          return c?.terrain === 'water' && hexDist(n, target) < hexDist(pos, target)
        })
        if (waterBlocks || viaBridge <= direct + 3) aim = bestBridge
      }
    }
  }
  while (remaining > 0) {
    const optsList = neighbors(pos)
      .filter(inBounds)
      .filter((n) => {
        const key = hexKey(n.q, n.r)
        if (occupied.has(key)) {
          return isFlyingTraverseHex(map, n, model, models, occupied)
        }
        return true
      })
      .map((n) => ({
        n,
        cost: moveCost(map, n, model, { ignoreTerrainCosts }),
        dist: hexDist(n, aim),
        bridgeBonus: map.cells.get(hexKey(n.q, n.r))?.bridge ? -0.5 : 0,
        traverseOnly: isFlyingTraverseHex(map, n, model, models, occupied),
      }))
      .filter((o) => {
        if (!(o.cost < Infinity)) return false
        if (o.cost <= remaining) return true
        // Minimum-1: with any Move left (and not rooted), may enter even if cost > remaining.
        // Free moves never use this — they already treat terrain as cost 1.
        if (ignoreTerrainCosts) return false
        return !model._rooted
      })
      .sort((a, b) => a.dist + a.bridgeBonus - (b.dist + b.bridgeBonus) || a.cost - b.cost)
    if (!optsList.length) break
    const best = optsList[0]
    if (
      best.dist >= hexDist(pos, aim) &&
      steps > 0 &&
      !best.traverseOnly
    ) {
      break
    }
    remaining = Math.max(0, remaining - best.cost)
    pos = best.n
    steps += 1
    model.movedThisAct += 1
    if (best.traverseOnly) {
      if (remaining <= 0) break
      continue
    }
    if (hexDist(pos, aim) === 0) {
      // Reached bridge (or target) — if that was a waypoint, continue toward original goal.
      if (aim !== target && hexDist(pos, target) > 0) {
        aim = target
        continue
      }
      break
    }
  }
  if (!canEndFlyingMoveOnHex(map, pos, model, models, occupied)) {
    model.hex = startHex
    return 0
  }
  model.hex = pos
  return budget - remaining
}

function effectiveMove(model, models = null, map = null) {
  if (model.rootedUntilEor) return 0
  let mv = model.baseMove + (model.tempMove || 0)
  if (model.slow) mv -= 1
  if (
    models &&
    isCheapUnit(model) &&
    hasAdjacentFormationProvider(model, models, 'Formation March')
  ) {
    mv += 1
  }
  // Water Favored (Deepwalker): +1 Move while in Water.
  if (map && model.hex && unitHasTerrainFavored(model, 'water')) {
    if (getTerrainAt(map, model.hex) === 'water') mv += 1
  }
  return Math.max(0, mv)
}

function effectiveRange(model) {
  let r = model.range || 1
  // Reach does not extend range — it allows attacking Flying units in melee.
  if (model._tempRangeBonus) r += model._tempRangeBonus
  return r
}

/** Melee cannot target Flying unless attacker has Reach or is Flying. */
function canTarget(attacker, defender, dist) {
  if (!defender?.alive) return false
  if (hasAbility(defender, 'Flying') && dist <= 1) {
    return hasAbility(attacker, 'Reach') || hasAbility(attacker, 'Flying')
  }
  return true
}

function vpForKill(victim) {
  if (victim.role === 'commander') return 6
  if (victim.role === 'officer') return 3
  return 1
}

function isInfantryLike(m) {
  const prim = String(m.primaryType || '').toLowerCase()
  return (
    prim === 'infantry' ||
    m.tags.has('infantry') ||
    ((m.range || 1) <= 1 && !m.tags.has('beast') && !m.tags.has('cavalry') && prim !== 'ranged')
  )
}

function isHeavyLike(m) {
  const prim = String(m.primaryType || '').toLowerCase()
  const sec = String(m.secondaryType || '').toLowerCase()
  return prim === 'heavy' || sec === 'heavy' || m.tags.has('heavy')
}

function isBeastLike(m) {
  return (
    String(m.primaryType || '').toLowerCase() === 'beast' ||
    m.tags.has('beast') ||
    String(m.name || '').toLowerCase().includes('hydra')
  )
}

function tryManyHeadedSave(defender, models) {
  if (!models?.length || !defender.hex || !isBeastLike(defender)) return false
  const cmd = models.find(
    (m) =>
      m.alive &&
      m.side === defender.side &&
      m.role === 'commander' &&
      hasAbility(m, 'Many-Headed Resilience') &&
      !m._manyHeadedUsed &&
      m.hex &&
      hexDist(m.hex, defender.hex) <= (m.radius || 6),
  )
  if (!cmd) return false
  cmd._manyHeadedUsed = true
  return true
}

function isFireLike(m) {
  return m.tags.has('fire') || m.tags.has('demon') || String(m.race || '').toLowerCase() === 'demon'
}

function isRanged(m) {
  return (m.range || 1) >= 2 || String(m.primaryType || '').toLowerCase() === 'ranged'
}

function isAmphibiousLike(m) {
  return (
    hasAbility(m, 'Amphibious') ||
    m.tags.has('amphibious') ||
    m.tags.has('nature') ||
    String(m.race || '').toLowerCase() === 'lizardman'
  )
}

function isMounted(m) {
  return hasAbility(m, 'Mounted') || m.tags?.has?.('mounted')
}

function isChargeLike(m) {
  return (
    m.hasCharge ||
    m.hasFrenzy ||
    hasAbility(m, 'Charge') ||
    hasAbility(m, 'Frenzy') ||
    m.tags.has('cavalry') ||
    m.tags.has('beast') ||
    m.tags.has('mounted') ||
    String(m.primaryType || '').toLowerCase() === 'beast' ||
    String(m.primaryType || '').toLowerCase() === 'cavalry'
  )
}

function isNatureLike(m) {
  return (
    m.tags.has('nature') ||
    m.tags.has('elf') ||
    String(m.race || '').toLowerCase() === 'elf' ||
    isAmphibiousLike(m)
  )
}

/**
 * Whether an aura/active from `source` should buff `unit`.
 * Preference filters — generic auras still apply broadly.
 * Company vs army pool is decided by the caller (officer inRad vs commander army).
 */
function buffApplies(abilityName, source, unit) {
  if (!unit?.alive) return false
  const name = String(abilityName || '')
  const uRace = String(unit.race || '').toLowerCase()

  if (name === 'Repair') return isSiegeLike(unit)
  if (name === 'Rebuild Protocol' || name === 'Full Rebuild') {
    return isSiegeLike(unit) || isConstructLike(unit)
  }

  // Generic radius buffs
  if (
    name === 'Inspire' ||
    name === 'Inspiring Presence' ||
    name === 'Battle Orders' ||
    name === 'Battle Cry' ||
    name === 'Rally' ||
    name === 'Medic' ||
    name === 'Heal' ||
    name === 'Blood Offering' ||
    name === 'Soul Offering' ||
    name === 'Flesh Tithe' ||
    name === 'Fortify Position' ||
    name === 'Brace Order' ||
    name === 'Harden Order' ||
    name === 'Fortify Works' ||
    name === 'Entrench' ||
    name === 'Hold the Gate' ||
    name === 'Press Forward' ||
    name === 'Pack Reform' ||
    name === 'Forced March' ||
    name === 'Tactical Withdrawal' ||
    name === 'Rapid Redeployment' ||
    name === 'Counterattack' ||
    name === 'Unbroken Hearth' ||
    name === 'Hearthbound Stand'
  ) {
    return true
  }

  if (
    name === 'Hearthfort Aegis' ||
    name === 'Shield Column' ||
    name === 'Hold the Line' ||
    name === 'Line Decree'
  ) {
    return isInfantryLike(unit)
  }

  if (name === 'Hellfire Press' || name === 'Cinder March') {
    return isFireLike(unit) || uRace === 'demon'
  }

  if (name === 'Living Grove' || name === 'Fen Unity') {
    return isNatureLike(unit) || isAmphibiousLike(unit) || uRace === 'lizardman'
  }

  if (
    name === 'Arrowstorm Command' ||
    name === 'Coordinated Volley' ||
    name === 'Moonlit Volley'
  ) {
    return isRanged(unit)
  }

  if (name === 'Horn of Advance') {
    return isChargeLike(unit)
  }
  if (name === 'Infernal Rush') {
    return (
      unit.hasFrenzy ||
      hasAbility(unit, 'Frenzy') ||
      unit.hasCharge ||
      hasAbility(unit, 'Charge') ||
      isChargeLike(unit)
    )
  }

  if (name === 'Swamp Kinship') {
    return isAmphibiousLike(unit) || unit.tags?.has?.('nature')
  }

  // Unknown abilities: apply (don't break casting side effects)
  return true
}

/** Inspire: units of the same company within 2 spaces (commanders buff army within 2). */
function hasInspireBonus(model, models) {
  if (!model?.alive || !model.hex) return false
  for (const ally of models) {
    if (!ally.alive || ally.side !== model.side) continue
    if (!hasAbility(ally, 'Inspire') || !ally.hex) continue
    if (hexDist(model.hex, ally.hex) > 2) continue
    if (ally.role === 'commander') return true
    if (ally.companyId != null && ally.companyId === model.companyId) return true
  }
  return false
}

/** Destroy a friendly unit without awarding the enemy VP (sacrifice effects). */
function sacrificeUnit(unit, models, map) {
  if (!unit?.alive) return false
  unit.alive = false
  unit.hp = 0
  if (unit.hex) {
    const cell = map.cells.get(hexKey(unit.hex.q, unit.hex.r))
    if (cell?.occupant === unit.id) cell.occupant = null
    unit.hex = null
  }
  return true
}

/**
 * Aura strength multiplier. Type/keyword filters live in buffApplies;
 * open allies get full strength (no race half-penalties).
 */
function buffStrength(abilityName, source, unit) {
  return buffApplies(abilityName, source, unit) ? 1 : 0
}

function friendsInCommanderRadius(models, cmd) {
  if (!cmd?.alive || !cmd.hex) return []
  const rad = cmd.radius || 6
  return models.filter(
    (m) => m.alive && m.side === cmd.side && m.hex && hexDist(m.hex, cmd.hex) <= rad,
  )
}

/** Same-race commander auras (Human Compact, Dwarf Compact, …). */
const RACIAL_COMPACTS = [
  ['Human Compact', 'Human'],
  ['Elf Compact', 'Elf'],
  ['Demon Compact', 'Demon'],
  ['Lizardman Compact', 'Lizardman'],
  ['Dwarf Compact', 'Dwarf'],
  ['Dragon Compact', 'Dragon'],
  ['Beastfolk Compact', 'Beastfolk'],
  ['Undead Compact', 'Undead'],
  ['Construct Compact', 'Construct'],
]

function applyRacialCompactAura(unit, models) {
  if (!unit?.alive || !unit.hex) return
  // Once per round — commander act and company act both call this; do not stack.
  if (unit._racialCompactApplied) return
  const cmd = models.find((m) => m.alive && m.side === unit.side && m.role === 'commander')
  if (!cmd?.hex) return
  if (hexDist(cmd.hex, unit.hex) > (cmd.radius || 6)) return
  const uRace = String(unit.race || '')
  for (const [ability, race] of RACIAL_COMPACTS) {
    if (!hasAbility(cmd, ability)) continue
    if (uRace !== race) continue
    // Printed Compact (+ optional printable dials from simBalanceDials.mjs).
    const bonus = compactBonusForRace(race)
    if (bonus.damage > 0) unit.tempDamage += bonus.damage
    if (bonus.harden > 0) {
      unit.harden = (unit.harden || 0) + bonus.harden
    }
    if (bonus.hit > 0) {
      unit.tempHitBonus = (unit.tempHitBonus || 0) + bonus.hit
    }
    unit._racialCompactApplied = true
    return
  }
}

function gatherKeywords(model, officer, models, map = null) {
  const buffs = {
    inspireAura: false,
    inspiringPresence: false,
    livingGrove: false,
    disciplinedAdvance: false,
    hearthfort: false,
    swampKinship: false,
    hellfirePress: false,
  }
  // Clear per-refresh passive flags
  model._vanguardPush = false
  model._lineCadence = false
  model._bloodScent = false
  model._packCadence = false
  model._hexPressureOn = false
  model._killRhythm = false
  model._volleyDiscipline = false
  model._spottingLine = false
  model._siegeSync = false
  model._marshStrideHit = false
  model._grantedFavored = null
  model._scarLedger = false
  model._namedFangs = false
  model._spearpointAdvance = false
  model._emberElevation = false
  model._infernalHeat = false
  model._dustDeclaration = false
  model._mountedPressure = false
  model._winglash = false
  model._graveInterest = false
  model._closeOrder = false
  model._lockstepBrace = false
  model._stoneblood = false
  model._clutchBond = false
  model._oathBrace = false
  model._rootLatch = false
  model._eyesOnSky = false
  model._unyieldingPost = false
  model._supplyCache = false
  model._bulwarkAura = false
  model._tormentLattice = false
  model._oathAnvil = false
  model._groveLattice = false

  const auras = []
  if (officer && inRadius(model, officer) && !model.isolated) auras.push(officer)
  const cmd = models.find((m) => m.alive && m.side === model.side && m.role === 'commander')
  if (cmd && model.hex && cmd.hex && hexDist(model.hex, cmd.hex) <= (cmd.radius || 6)) {
    auras.push(cmd)
  }
  // Inspire is company-scoped within 2 spaces (not Command Radius).
  buffs.inspireAura = hasInspireBonus(model, models)

  const CMD_MOVE = new Set([
    "Matriarch's Pace",
    'Kindred Flightpaths',
    'Court Paths',
    'Starlit Stride',
    'Canopy Lanes',
    'Hearth Roads',
    'Realmward March',
    'Fen Drift',
    'Gear Grease',
  ])
  const CMD_PATH = new Set([
    'Vector March',
    'Hoard Routes',
    'Stone Highways',
    'Rootways',
    'Open Ground',
    'Regen Paths',
    'Still Paths',
  ])

  for (const src of auras) {
    if (hasAbility(src, 'Inspiring Presence') && buffApplies('Inspiring Presence', src, model)) {
      buffs.inspiringPresence = true
    }
    if (hasAbility(src, 'Living Grove') && buffApplies('Living Grove', src, model)) {
      buffs.livingGrove = true
    }
    if (hasAbility(src, 'Disciplined Advance')) buffs.disciplinedAdvance = true
    if (
      hasAbility(src, 'Hearthfort Aegis') &&
      buffStrength('Hearthfort Aegis', src, model) > 0
    ) {
      buffs.hearthfort = true
    }
    if (hasAbility(src, 'Swamp Kinship') && buffApplies('Swamp Kinship', src, model)) {
      buffs.swampKinship = true
    }
    if (hasAbility(src, 'Hellfire Press') && buffApplies('Hellfire Press', src, model)) {
      buffs.hellfirePress = true
    }
    if (hasAbility(src, 'Infernal Heat') && String(model.race) === 'Demon') {
      const nearDamaged = models.some(
        (m) =>
          m.alive &&
          m.hex &&
          model.hex &&
          hexDist(m.hex, model.hex) === 1 &&
          m.hp < m.toughness,
      )
      if (nearDamaged) model._infernalHeat = true
    }
    if (hasAbility(src, 'Forge Dominion') && isFireLike(model)) {
      model.tempDamage = (model.tempDamage || 0) + 1
    }
    if (hasAbility(src, 'Torment Lattice') && String(model.race) === 'Demon') {
      model._tormentLattice = true
    }
    if (
      hasAbility(src, 'Holdfast Doctrine') &&
      String(model.race) === 'Dwarf' &&
      model.tags?.has?.('heavy') &&
      map &&
      model.hex
    ) {
      const cell = map.cells.get(hexKey(model.hex.q, model.hex.r))
      if (cell?.terrain === 'mountains') model.harden = (model.harden || 0) + 1
    }
    if (
      hasAbility(src, 'Oath Anvil') &&
      String(model.race) === 'Dwarf' &&
      model.tags?.has?.('heavy')
    ) {
      model.harden = (model.harden || 0) + 1
    }
    if (
      hasAbility(src, 'Grove Lattice') &&
      isNatureLike(model) &&
      map &&
      model.hex
    ) {
      const cell = map.cells.get(hexKey(model.hex.q, model.hex.r))
      if (cell?.terrain === 'forest') model._groveLattice = true
    }
    if (hasAbility(src, 'Siege Sync') && isSiegeLike(model) && src.role === 'commander') {
      const adj = models.some(
        (m) =>
          m.alive &&
          m.side === model.side &&
          m.hex &&
          model.hex &&
          !isSiegeLike(m) &&
          hexDist(m.hex, model.hex) === 1,
      )
      if (adj) model._siegeSync = true
    }
    for (const name of CMD_MOVE) {
      if (!hasAbility(src, name)) continue
      if (name === "Matriarch's Pace" && hasAbility(model, 'Pack')) {
        buffs.inspiringPresence = true
      } else if (
        name === 'Kindred Flightpaths' &&
        (String(model.race) === 'Dragon' || hasAbility(model, 'Flying'))
      ) {
        buffs.inspiringPresence = true
      } else if (name === 'Court Paths' && String(model.race) === 'Elf') {
        buffs.inspiringPresence = true
      } else if (
        name === 'Starlit Stride' &&
        (hasAbility(model, 'Flying') || model.tags?.has?.('scout') || hasAbility(model, 'Scout'))
      ) {
        buffs.inspiringPresence = true
      } else if (
        name === 'Canopy Lanes' &&
        (model.tags?.has?.('scout') || hasAbility(model, 'Scout') || hasAbility(model, 'Stealth'))
      ) {
        buffs.inspiringPresence = true
      } else if (name === 'Hearth Roads' && isInfantryLike(model)) {
        buffs.inspiringPresence = true
      } else if (name === 'Realmward March' && String(model.race) === 'Human') {
        buffs.inspiringPresence = true
        buffs.pathMoveBonus = dialEffects().realmwardMoveBonus || 1
      } else if (name === 'Fen Drift' && String(model.race) === 'Lizardman') {
        buffs.inspiringPresence = true
      } else if (name === 'Gear Grease' && isConstructLike(model)) {
        buffs.inspiringPresence = true
      }
    }
    for (const name of CMD_PATH) {
      if (!hasAbility(src, name)) continue
      let ok = false
      let grantTerrain = null
      if (name === 'Vector March') {
        ok = isConstructLike(model)
        grantTerrain = 'plains'
      } else if (name === 'Hoard Routes') {
        ok = String(model.race) === 'Dragon'
        grantTerrain = 'volcanic'
      } else if (name === 'Stone Highways') {
        ok = String(model.race) === 'Dwarf'
        if (ok) {
          buffs.inspiringPresence = true
          buffs.pathMoveBonus = 1
          grantTerrain = 'mountains'
        }
      } else if (name === 'Rootways') {
        ok = isNatureLike(model)
        grantTerrain = 'forest'
      } else if (name === 'Open Ground') {
        ok = isMounted(model) || isBeastType(model)
        grantTerrain = 'plains'
        if (ok) {
          buffs.inspiringPresence = true
          buffs.pathMoveBonus = 1
        }
      } else if (name === 'Regen Paths') {
        ok = isBeastType(model)
        grantTerrain = 'forest'
        if (ok) {
          buffs.inspiringPresence = true
          buffs.pathMoveBonus = 1
        }
      } else if (name === 'Still Paths') {
        ok = String(model.race) === 'Undead'
        grantTerrain = 'swamp'
        if (ok) {
          buffs.inspiringPresence = true
          buffs.pathMoveBonus = 1
        }
      }
      if (ok) {
        buffs.disciplinedAdvance = true
        if (grantTerrain) model._grantedFavored = grantTerrain
      }
    }
    if (hasAbility(src, 'Disciplined Advance')) {
      model._grantedFavored = model._grantedFavored || 'plains'
    }
    if (hasAbility(src, 'Court Paths') && String(model.race) === 'Elf') {
      model._grantedFavored = model._grantedFavored || 'forest'
    }
    if (hasAbility(src, 'Fen Drift') && String(model.race) === 'Lizardman') {
      model._grantedFavored = model._grantedFavored || 'swamp'
    }
    if (hasAbility(src, 'Spearpoint Advance') && isInfantryLike(model)) {
      model._spearpointAdvance = true
    }
  }

  // Company officer passives (and self if officer)
  const companySources = []
  if (officer) companySources.push(officer)
  if (model.role === 'officer') companySources.push(model)
  for (const src of companySources) {
    const sameCo =
      src.companyId != null && model.companyId != null && src.companyId === model.companyId
    const inCr = inRadius(model, src)
    if (!sameCo && src !== model) continue
    if (!inCr && src !== model) continue

    if (hasAbility(src, 'Vanguard Push')) model._vanguardPush = true
    if (hasAbility(src, 'Kill Rhythm')) model._killRhythm = true
    if (hasAbility(src, 'Volley Discipline') && isRanged(model)) model._volleyDiscipline = true
    if (hasAbility(src, 'Ember Elevation') && (isFireLike(model) || model.tags?.has?.('fire'))) {
      model._emberElevation = true
    }
    if (hasAbility(src, 'Dust Declaration') && isMounted(model)) model._dustDeclaration = true
    if (hasAbility(src, 'Mounted Pressure') && isMounted(model)) model._mountedPressure = true
    if (hasAbility(src, 'Winglash') && hasAbility(model, 'Flying')) model._winglash = true
    if (hasAbility(src, 'Scar Ledger') && model.hp < model.toughness) model._scarLedger = true
    if (
      hasAbility(src, 'Named Fangs') &&
      (isBeastType(model) || String(model.race) === 'Beastfolk')
    ) {
      model._namedFangs = true
    }
    if (hasAbility(src, 'Line Cadence') && String(model.race) === 'Human') model._lineCadence = true
    if (
      hasAbility(src, 'Blood Scent') &&
      (isBeastType(model) || String(model.race) === 'Beastfolk')
    ) {
      model._bloodScent = true
    }
    if (hasAbility(src, 'Pack Cadence') && hasAbility(model, 'Pack')) {
      const packBuddy = models.some(
        (m) =>
          m.alive &&
          m.id !== model.id &&
          m.side === model.side &&
          m.companyId === model.companyId &&
          m.hex &&
          model.hex &&
          hasAbility(m, 'Pack') &&
          hexDist(m.hex, model.hex) === 1,
      )
      if (packBuddy) model._packCadence = true
    }
    if (hasAbility(src, 'Hex Pressure') && (model.tags?.has?.('magic') || isNatureLike(model))) {
      // Mark; resolved when attacking using defender terrain via map on model
      model._hexPressure = true
    }
    if (hasAbility(src, 'Infernal Heat') && String(model.race) === 'Demon') {
      const nearDamaged = models.some(
        (m) =>
          m.alive &&
          m.hex &&
          model.hex &&
          hexDist(m.hex, model.hex) === 1 &&
          m.hp < m.toughness,
      )
      if (nearDamaged) model._infernalHeat = true
    }
    if (
      hasAbility(src, 'Grave Interest') &&
      String(model.race) === 'Undead' &&
      model._companyUnderstrength
    ) {
      model._graveInterest = true
    }
    if (hasAbility(src, 'Close Order') && isInfantryLike(model)) {
      const adj = models.some(
        (m) =>
          m.alive &&
          m.id !== model.id &&
          m.side === model.side &&
          m.companyId === model.companyId &&
          m.hex &&
          model.hex &&
          hexDist(m.hex, model.hex) === 1,
      )
      if (adj) {
        model._closeOrder = true
        model.harden = (model.harden || 0) + 1
      }
    }
    if (hasAbility(src, 'Lockstep Brace') && model.tags?.has?.('heavy')) {
      if (!(model._attackedThisAct)) {
        model._lockstepBrace = true
      }
    }
    if (
      hasAbility(src, 'Stoneblood Plates') &&
      model.tags?.has?.('heavy') &&
      !(model.movedThisAct > 0)
    ) {
      model.harden = (model.harden || 0) + 1
      model._stoneblood = true
    }
    if (hasAbility(src, 'Clutch Bond') && String(model.race) === 'Dragon') {
      const buddy = models.some(
        (m) =>
          m.alive &&
          m.id !== model.id &&
          m.side === model.side &&
          m.companyId === model.companyId &&
          String(m.race) === 'Dragon' &&
          m.hex &&
          model.hex &&
          hexDist(m.hex, model.hex) === 1,
      )
      if (buddy) {
        model.harden = (model.harden || 0) + 1
        model._clutchBond = true
      }
    }
    if (
      hasAbility(src, 'Oath Brace') &&
      String(model.race) === 'Dwarf' &&
      officer?.hex &&
      model.hex &&
      hexDist(model.hex, officer.hex) === 1
    ) {
      model._oathBrace = true
    }
    if (hasAbility(src, 'Eyes on Sky')) {
      const flyer = models.some(
        (m) =>
          m.alive &&
          m.side === model.side &&
          m.hex &&
          hasAbility(m, 'Flying') &&
          hexDist(m.hex, src.hex) <= (src.radius || 4),
      )
      if (flyer && isInfantryLike(model)) {
        model.harden = (model.harden || 0) + 1
        model._eyesOnSky = true
      }
    }
    if (hasAbility(src, 'Unyielding Post') && model.hex && map) {
      const cell = map.cells.get(hexKey(model.hex.q, model.hex.r))
      const onObj = map.objectives?.some((o) => o.q === model.hex.q && o.r === model.hex.r)
      if (onObj || cell?.fortified) {
        model.harden = (model.harden || 0) + 1
        model._unyieldingPost = true
      }
    }
    if (hasAbility(src, 'Supply Cache')) model._supplyCache = true
    if (hasAbility(src, 'Banner Lift') && officer?.hex && model.hex) {
      if (hexDist(model.hex, officer.hex) <= 2) model.tempMove = (model.tempMove || 0) + 1
    }
    if (hasAbility(src, 'Ozone Liturgy') && model.tags?.has?.('spellcaster')) {
      model._tempRangeBonus = (model._tempRangeBonus || 0) + 1
    }
    if (hasAbility(src, 'Marsh Stride') && (hasAbility(model, 'Amphibious') || model.tags?.has?.('amphibious'))) {
      model._marshStride = true
      // Deepwalker-style: water is passable; Move bonus applied in effectiveMove via Deepwalker/favored.
      if (map && model.hex) {
        const cell = map.cells.get(hexKey(model.hex.q, model.hex.r))
        if (cell?.terrain === 'water') model._grantedFavored = model._grantedFavored || 'water'
      }
    }
    if (hasAbility(src, 'Root Latch') && isNatureLike(model) && map && model.hex) {
      const cell = map.cells.get(hexKey(model.hex.q, model.hex.r))
      if (cell && (cell.terrain === 'forest' || cell.terrain === 'swamp' || cell.terrain === 'desert')) {
        model._rootLatch = true
      }
    }
    if (hasAbility(src, 'Siege Sync') && isSiegeLike(model)) {
      const adj = models.some(
        (m) =>
          m.alive &&
          m.side === model.side &&
          m.companyId === model.companyId &&
          m.hex &&
          model.hex &&
          !isSiegeLike(m) &&
          hexDist(m.hex, model.hex) === 1,
      )
      if (adj) model._siegeSync = true
    }
    if (hasAbility(src, 'Spotting Line') && isRanged(model)) {
      const scout = models.some(
        (m) =>
          m.alive &&
          m.side === model.side &&
          m.companyId === model.companyId &&
          m.hex &&
          model.hex &&
          (hasAbility(m, 'Scout') || m.tags?.has?.('scout')) &&
          hexDist(m.hex, model.hex) === 1,
      )
      if (scout) {
        model._spottingLine = true
        model._tempRangeBonus = (model._tempRangeBonus || 0) + 1
      }
    }
    if (
      hasAbility(src, 'Mammoth Thunder') &&
      (isBeastType(model) || isMounted(model) || model.tags?.has?.('cavalry') || model.tags?.has?.('beast'))
    ) {
      model._mammothThunder = true
      model._tempTrample = true
    }
    if (hasAbility(src, 'Dread Aura') && src.role === 'commander') {
      // Mark for round-start Fear application on adjacent enemies.
      src._dreadAura = true
    }
    if (hasAbility(src, 'Reload Drill') && (isSiegeLike(model) || isRanged(model))) {
      if (!(model.movedThisAct > 0)) model.tempDamage = (model.tempDamage || 0) + 1
    }
  }

  model._inspireAura = buffs.inspireAura
  model._disciplinedAdvance = buffs.disciplinedAdvance
  model._hearthfort = buffs.hearthfort
  model._swampKinship = buffs.swampKinship
  model._hellfirePress = buffs.hellfirePress
  if (buffs.livingGrove) {
    model.regenEor = Math.max(model.regenEor || 0, 1)
  }
  if (
    buffs.swampKinship &&
    (hasAbility(model, 'Amphibious') || model.tags.has('amphibious')) &&
    !model._swampToughnessApplied
  ) {
    model.toughness += 1
    model.hp += 1
    model._swampToughnessApplied = true
  }
  return buffs
}

function spendAp(companyState, amount) {
  if (!companyState || companyState.ap < amount) return false
  companyState.ap -= amount
  return true
}

function actionApCost(base, model) {
  let cost = base + (model.isolated ? 1 : 0)
  if (model._lockstepAp && (isSiegeLike(model) || isConstructLike(model)) && cost > 1) cost -= 1
  return Math.max(1, cost)
}

/** Company that pays AP for this model (units/officers only). */
function companyOf(sides, model) {
  if (!sides || !model || model.companyId == null) return null
  const st = sides[model.side]
  if (!st) return null
  return st.companies.find((c) => c.id === model.companyId) || null
}

/**
 * AI pick for Brace / Evade / Retaliate (each costs 1 Company AP).
 * Brace/Evade persist until next activation or round (mutually exclusive); Retaliate is once/round.
 * Returns null to conserve AP.
 */
function pickDefenseReaction(defender, attacker, models, rng, map = null) {
  if (!defender?.hex || !attacker?.hex) return null
  const dist = Math.max(1, Math.round(hexDist(defender.hex, attacker.hex)))
  const threat = effectiveDamage(attacker, models, defender, map)
  const myDmg = effectiveDamage(defender, models, attacker, map)
  const canRetaliate =
    !defender._retaliateUsedThisRound &&
    (defender.baseDamage || 0) > 0 &&
    dist <= effectiveRange(defender) &&
    canTarget(defender, attacker, dist)
  const defTerrain = map ? getTerrainAt(map, defender.hex) : null
  // Desert Base: cannot Evade. Volcanic Base: cannot Brace.
  const canBrace = defTerrain !== 'volcanic'
  const canEvade = defTerrain !== 'desert'
  // Brace and Evade are mutually exclusive lasting stances.
  // Brace grants Harden 1 and stacks — skip only if Brace already active.
  const needBrace = canBrace && !defender._reactionBrace && !defender._evade
  const needEvade = canEvade && !defender._evade && !defender._reactionBrace

  // Already protected and can't/won't retaliate
  if (!needBrace && !needEvade && !canRetaliate) return null

  // Often save AP (~40%)
  if (rng() < 0.4) return null

  // Lethal threat → Evade or Brace (if not already up)
  if (threat >= defender.hp) {
    if (needEvade && rng() < 0.55) return 'evade'
    if (needBrace) return 'brace'
    if (canRetaliate) return 'retaliate'
    return null
  }
  // Can finish the attacker → Retaliate
  if (canRetaliate && myDmg >= attacker.hp && rng() < 0.7) return 'retaliate'
  // Solid chip → Brace
  if (needBrace && threat >= 2 && rng() < 0.5) return 'brace'
  // Trade → Retaliate
  if (canRetaliate && rng() < 0.35) return 'retaliate'
  if (needEvade && rng() < 0.45) return 'evade'
  if (needBrace && rng() < 0.5) return 'brace'
  return null
}

/**
 * Spend Company AP for a defensive reaction when attacked.
 * Brace/Evade last until the unit's next activation or the next round (whichever first);
 * a unit may not have Brace and Evade at the same time.
 * Retaliate fires immediately and may only be used once per round.
 */
function declareDefenseReaction(defender, attacker, models, sides, rng, map = null) {
  if (!sides || defender.role === 'commander') return null
  const co = companyOf(sides, defender)
  if (!co?.officerModel?.alive) return null
  const cost = actionApCost(DEFENSE_REACTION_AP, defender)
  if (co.ap < cost) return null
  const choice = pickDefenseReaction(defender, attacker, models, rng, map)
  if (!choice) return null
  if (choice === 'brace' && (defender._reactionBrace || defender._evade)) return null
  if (choice === 'evade' && (defender._evade || defender._reactionBrace)) return null
  if (choice === 'retaliate' && defender._retaliateUsedThisRound) return null
  // Terrain Base blocks (also checked in pick, but re-check after AP spend path).
  if (map && defender.hex) {
    const t = getTerrainAt(map, defender.hex)
    if (choice === 'brace' && t === 'volcanic') return null
    if (choice === 'evade' && t === 'desert') return null
  }
  if (!spendAp(co, cost)) return null
  if (choice === 'brace') {
    defender._reactionBrace = true
    defender._evade = false
  } else if (choice === 'evade') {
    defender._evade = true
    defender._reactionBrace = false
  } else if (choice === 'retaliate') defender._retaliateUsedThisRound = true
  const defCombat = sides[defender.side]?.combat
  if (defCombat?.reactions && defCombat.reactions[choice] != null) {
    defCombat.reactions[choice] += 1
  }
  return choice
}

/** Clear lasting Brace/Evade (on activation or new round). */
function clearLastingDefense(model) {
  if (!model) return
  model._evade = false
  model._reactionBrace = false
}

/**
 * Retaliate: immediate normal counterattack (hit roll + damage). Simultaneous with the
 * triggering attack — may fire even if that blow destroys the defender.
 */
function resolveRetaliate(defender, attacker, models, map, sideState, kills, vp, rng, sides = null) {
  if (!attacker?.alive || !defender?.hex || !attacker?.hex) return
  if ((defender.baseDamage || 0) <= 0) return
  const dist = Math.max(1, Math.round(hexDist(defender.hex, attacker.hex)))
  if (dist > effectiveRange(defender)) return
  if (!canTarget(defender, attacker, dist)) return
  const need = hitRequirement(defender, attacker, dist, models, map)
  const roll = rollHitSum(rng)
  const atkCombat = sides?.[defender.side]?.combat || null
  const defCombat = sides?.[attacker.side]?.combat || null
  const tel = sideState?.telemetry || sides?.[defender.side]?.telemetry || null
  if (roll < need) {
    recordStrikeCombat(
      atkCombat,
      defCombat,
      {
        hit: false,
        need,
        roll,
        dmg: 0,
        killed: false,
        role: attacker.role,
        isRetaliate: true,
      },
      tel,
      defender,
      attacker,
    )
    return
  }
  const dmg = effectiveDamage(defender, models, attacker, map)
  applyIncomingDamage(attacker, dmg, defender, models, map)
  const killed = !attacker.alive
  if (killed) {
    const pts = vpForKill(attacker)
    const side = defender.side
    vp[side] += pts
    kills[side].push({ name: attacker.name, role: attacker.role, vp: pts })
    if (atkCombat) atkCombat.killVp += pts
    if (attacker.hex) {
      const cell = map.cells.get(hexKey(attacker.hex.q, attacker.hex.r))
      if (cell?.occupant === attacker.id) cell.occupant = null
    }
  }
  recordStrikeCombat(
    atkCombat,
    defCombat,
    {
      hit: true,
      need,
      roll,
      dmg,
      killed,
      role: attacker.role,
      isRetaliate: true,
    },
    tel,
    defender,
    attacker,
  )
  applyOnHitEffects(defender, attacker)
}

function moveCost(map, to, model, opts = {}) {
  const cell = map.cells.get(hexKey(to.q, to.r))
  if (!cell) return Infinity
  const ignoreCosts = !!opts.ignoreTerrainCosts
  // Flying ignores terrain costs (treat as 1); may traverse walls but not stop on them.
  if (hasAbility(model, 'Flying')) {
    if (cell.terrain === 'wall' && opts.forEndMove) return Infinity
    if (cell.terrain === 'wall') return 1
    return 1
  }
  // Free Move 1: passable hexes cost 1; impassable stays impassable.
  if (ignoreCosts) {
    if (cell.terrain === 'wall') return Infinity
    if (cell.terrain === 'water') {
      if (hasAbility(model, 'Amphibious') || model._swampKinship || model._marshStride) return 1
      return Infinity
    }
    return 1
  }
  // Water is impassable unless Amphibious (or Swamp Kinship aura) / Flying.
  if (cell.terrain === 'water') {
    if (hasAbility(model, 'Amphibious') || model._swampKinship || model._marshStride) return 1
    return Infinity
  }
  if (cell.terrain === 'wall') return Infinity
  // Amphibious / kinship: swamp counts as normal terrain (cost 1).
  if (cell.terrain === 'swamp' && (hasAbility(model, 'Amphibious') || model._swampKinship)) {
    return 1
  }
  if (
    model._disciplinedAdvance &&
    (cell.terrain === 'forest' || cell.terrain === 'swamp' || cell.terrain === 'desert')
  ) {
    return 1
  }
  return TERRAIN_COST[cell.terrain] || 1
}

/** True if this model may stand on / enter the hex (deploy, reinforce, move). */
function canOccupyHex(map, hex, model, opts = {}) {
  return moveCost(map, hex, model, { ...opts, forEndMove: true }) < Infinity
}

function isFlyingTraverseHex(map, hex, model, models, occupied) {
  if (!hasAbility(model, 'Flying')) return false
  const key = hexKey(hex.q, hex.r)
  const cell = map.cells.get(key)
  if (cell?.terrain === 'wall') return true
  if (occupied.has(key)) {
    const blocker = models.find(
      (m) => m.alive && m.id !== model.id && m.hex && hexKey(m.hex.q, m.hex.r) === key,
    )
    return blocker && blocker.side === model.side
  }
  return false
}

function canEndFlyingMoveOnHex(map, hex, model, models, occupied) {
  const key = hexKey(hex.q, hex.r)
  if (occupied.has(key)) return false
  if (hasAbility(model, 'Flying') && map.cells.get(key)?.terrain === 'wall') return false
  return moveCost(map, hex, model, { forEndMove: true }) < Infinity
}

function effectiveDamage(model, models, defender = null, map = null) {
  let dmg = model.baseDamage + (model.tempDamage || 0)
  if (hasAbility(model, 'Adaptive Attack')) dmg = model.hp
  // Defender cannot initiate Charge.
  if (
    model.hasCharge &&
    model.movedThisAct >= (model._wildRush ? 1 : 2) &&
    !hasAbility(model, 'Defender')
  ) {
    dmg += 1
  }
  if (hasInspireBonus(model, models)) dmg += 1
  // Hellfire Press: +1 vs damaged enemies (printed).
  if (model._hellfirePress && defender && defender.hp < defender.toughness) dmg += 1
  if (model._mammothThunder) dmg += 1
  if (defender?._assaultMarked) dmg += 1
  if (model._killRhythm && defender && defender.hp < defender.toughness) dmg += 1
  if (model._emberElevation && !model._emberElevationUsed) dmg += 1
  if (model._infernalHeat) dmg += 1
  if (model._frenzyContagionBuff) dmg += 1
  if (model._soulDraftBuff) dmg += 1
  if (model._graveInterest) dmg += 1
  if (model._dustDeclaration && (model.movedThisAct || 0) >= 2 && !model._attackedThisAct) dmg += 1
  if (model._mountedPressure && model._endedMoveAdjacentEnemy && !model._attackedThisAct) dmg += 1
  if (model._winglash && (model.movedThisAct || 0) > 0 && !model._attackedThisAct) dmg += 1
  if (
    !model.attackedThisRound &&
    (hasAbility(model, 'Flying') || String(model.primaryType || '').toLowerCase() === 'flying') &&
    models?.some?.(
      (m) =>
        m.alive &&
        m.side === model.side &&
        m.role === 'commander' &&
        hasAbility(m, 'Starfall Pact') &&
        m.hex &&
        model.hex &&
        hexDist(m.hex, model.hex) <= (m.radius || 6),
    )
  ) {
    dmg += 1
  }
  // Volcanic Favored (Ashborn): +1 Damage when attacking from Volcanic.
  if (map && model.hex && unitHasTerrainFavored(model, 'volcanic')) {
    if (getTerrainAt(map, model.hex) === 'volcanic') dmg += FAVORED_TERRAIN_DAMAGE_BONUS
  }
  if (model.suppressUntilEor) dmg = Math.max(1, dmg - 1)
  if (model._tempRangeBonus) {
    /* range handled elsewhere */
  }
  return Math.max(0, dmg)
}

function applyIncomingDamage(defender, raw, attacker, models = null, map = null) {
  const tel = models?.telemetry || null
  let dmg = Math.max(0, raw)
  const sources = {
    harden: 0,
    brace: 0,
    shieldwall: 0,
    fortified: 0,
    defender: 0,
    ignoreHit: 0,
    other: 0,
  }
  // Explicit ignore-attack rules (e.g. Cinder March) — only path that may deal 0 via "ignore"
  if (defender._ignoreFirstHit) {
    defender._ignoreFirstHit = false
    if (tel?.defense) {
      tel.defense.hitsTaken += 1
      tel.defense.rawDamage += raw
      tel.defense.mitigated += raw
      tel.defense.bySource.ignoreHit += raw
    }
    return 0
  }
  if (defender._unyielding) {
    defender._unyielding = false
    if (tel?.defense) {
      tel.defense.hitsTaken += 1
      tel.defense.rawDamage += raw
      tel.defense.mitigated += raw
      tel.defense.bySource.ignoreHit += raw
    }
    return 0
  }
  // Harden sources stack: unit track (printed + grants) + Fortified hex + reaction Brace + Mountains Favored.
  const fortified = isHexFortified(map, defender.hex)
  const unitHarden = Math.max(defender.harden || 0, hardenRankFromKeywords(defender))
  const braceHarden = !!defender._reactionBrace
  const mountainsFavored =
    map &&
    defender.hex &&
    getTerrainAt(map, defender.hex) === 'mountains' &&
    unitHasMountainsFavored(defender)
  const harden = unitHarden + (fortified ? 1 : 0) + (braceHarden ? 1 : 0) + (mountainsFavored ? 1 : 0)

  let before = dmg
  // Defender: +1 Toughness while defending ≈ −1 damage (floor 1).
  if (hasAbility(defender, 'Defender')) {
    dmg = reduceDamageFloor(dmg, 1)
    sources.defender += Math.max(0, before - dmg)
    before = dmg
  }
  // Shieldwall: while adjacent to another Shieldwall unit, +1 Toughness.
  if (hasAbility(defender, 'Shieldwall') && models?.length && defender.hex) {
    const wallBuddy = models.some(
      (m) =>
        m.alive &&
        m.id !== defender.id &&
        m.side === defender.side &&
        m.hex &&
        hasAbility(m, 'Shieldwall') &&
        hexDist(m.hex, defender.hex) === 1,
    )
    if (wallBuddy) {
      dmg = reduceDamageFloor(dmg, 1)
      sources.shieldwall += Math.max(0, before - dmg)
      before = dmg
    }
  }
  if (
    isCheapUnit(defender) &&
    models?.length &&
    defender.hex &&
    hasAdjacentFormationProvider(defender, models, 'Formation Guard')
  ) {
    dmg = reduceDamageFloor(dmg, 1)
    sources.other += Math.max(0, before - dmg)
    before = dmg
  }
  if (defender._hearthfort && isInfantryLike(defender)) {
    dmg = reduceDamageFloor(dmg, dialEffects().hearthfortReduce || 1)
    sources.other += Math.max(0, before - dmg)
    before = dmg
  }
  if (
    defender._rootLatch ||
    defender._oathBrace ||
    defender._lockstepBrace ||
    defender._oathAnvil ||
    defender._groveLattice
  ) {
    dmg = reduceDamageFloor(dmg, 1)
    sources.other += Math.max(0, before - dmg)
    before = dmg
  }
  if (defender._supplyCache && !defender._supplyCacheUsed && dmg > 0) {
    defender._supplyCacheUsed = true
    dmg = reduceDamageFloor(dmg, 1)
    sources.other += Math.max(0, before - dmg)
    before = dmg
  }
  const meleeSiege =
    attacker && isSiegeLike(attacker) && (attacker.range || 1) <= 1
  if (
    harden &&
    !(
      attacker &&
      (hasAbility(attacker, 'Piercing') ||
        attacker._flankPierce ||
        attacker._tempPiercing ||
        meleeSiege)
    )
  ) {
    dmg = reduceDamageFloor(dmg, harden)
    const cut = Math.max(0, before - dmg)
    let remaining = cut
    if (braceHarden && remaining > 0) {
      const part = Math.min(1, remaining)
      sources.brace += part
      remaining -= part
    }
    if (fortified && remaining > 0) {
      const part = Math.min(1, remaining)
      sources.fortified += part
      remaining -= part
    }
    if (remaining > 0) sources.harden += remaining
    before = dmg
  }
  // Iron Covenant: once/round, first damage to a friendly in radius −1 (floor 1)
  if (models?.length && dmg > 0) {
    const cmd = models.find(
      (m) =>
        m.alive &&
        m.side === defender.side &&
        m.role === 'commander' &&
        hasAbility(m, 'Iron Covenant') &&
        !m._ironCovenantUsed &&
        m.hex &&
        defender.hex &&
        hexDist(m.hex, defender.hex) <= (m.radius || 6),
    )
    if (cmd) {
      cmd._ironCovenantUsed = true
      dmg = reduceDamageFloor(dmg, 1)
      sources.other += Math.max(0, before - dmg)
      tagDefBuff(defender, 'Iron Covenant')
      before = dmg
    }
  }
  // Final safety: reductions never zero-out damage unless ignore-attack above
  if (raw > 0) dmg = Math.max(1, dmg)

  const mitigatedTotal = Math.max(0, raw - dmg)
  if (tel?.defense) {
    tel.defense.hitsTaken += 1
    tel.defense.rawDamage += raw
    tel.defense.dealtDamage += dmg
    tel.defense.mitigated += mitigatedTotal
    for (const [k, v] of Object.entries(sources)) {
      tel.defense.bySource[k] = (tel.defense.bySource[k] || 0) + v
    }
  }
  noteAbilityMitigated(tel, defender, mitigatedTotal)
  defender._lastMitigated = mitigatedTotal
  defender._lastRaw = raw

  defender.hp -= dmg
  if (defender.hp <= 0) {
    // Last Stand: army cannot be reduced below 1 Toughness until EOR.
    if (defender._lastStand) {
      defender.hp = 1
      defender.alive = true
    } else if (tryManyHeadedSave(defender, models)) {
      defender.hp = 1
      defender.alive = true
    } else if (tryRevenantReturn(defender, models, map)) {
      // returned at half Toughness (floor) near death hex
    } else {
      defender.alive = false
      defender.hp = 0
    }
  }
  if (defender._counterattack && attacker?.alive && defender.alive === false) {
    // counter after being attacked — if still alive; handled in resolveAttack
  }
  return dmg
}

function placeInitial(force, side, map, rng, telemetry = null) {
  const models = []
  let nextId = 0
  const home = side === 'A' ? oddRToAxial(BOARD_MID, 0) : oddRToAxial(BOARD_MID, BOARD_SIZE - 1)

  const occupied = () =>
    new Set(models.filter((m) => m.alive && m.hex).map((m) => hexKey(m.hex.q, m.hex.r)))

  const place = (model, preferFn) => {
    const occ = occupied()
    const candidates = []
    for (const h of allBoardHexes()) {
      if (occ.has(hexKey(h.q, h.r))) continue
      if (!canOccupyHex(map, h, model)) continue
      if (model.role !== 'commander' && tooCloseToObjective(h, map.objectives)) continue
      if (model.role !== 'commander' && !inDeployZone(side, h)) continue
      if (model.role === 'unit' && isSiegeLike(model) && !inSiegeDeployBand(side, h)) continue
      const score = preferFn(h)
      if (score == null) continue
      candidates.push({ h: { q: h.q, r: h.r }, score })
    }
    candidates.sort((a, b) => a.score - b.score)
    if (!candidates.length) return false
    model.hex = candidates[0].h
    models.push(model)
    noteDeploy(telemetry, model)
    return true
  }

  for (const entry of force.deployed) {
    const model = makeModel(entry, side, `${side}-${nextId++}`, { fromMixedList: !!force.mixed })
    resetRoundFlags(model)
    if (entry.role === 'commander') {
      place(model, (h) => {
        // Edge seat: prefer board mid of home edge (commanders exempt from obj distance).
        if (!inDeployZone(side, h) && hexDist(h, home) > 1) return null
        const { row } = axialToOddR(h.q, h.r)
        if (side === 'A' && row > 1) return null
        if (side === 'B' && row < BOARD_SIZE - 2) return null
        return hexDist(h, home)
      })
    } else if (entry.role === 'officer') {
      place(model, (h) => {
        const { row, col } = axialToOddR(h.q, h.r)
        return Math.abs(col - BOARD_MID) + row * (side === 'A' ? 0.15 : -0.15)
      })
    } else {
      const siege = isSiegeLike(model)
      place(model, (h) => {
        const { row, col } = axialToOddR(h.q, h.r)
        const rear =
          side === 'A' ? row : BOARD_SIZE - 1 - row
        return (
          Math.abs(col - BOARD_MID) * 0.25 +
          (siege ? rear * 0.4 : side === 'A' ? -row : row)
        )
      })
    }
  }

  const reservePackages = (force.reservePackages || []).map((pkg, pi) => {
    const modelsInPkg = pkg.entries.map((e, i) => {
      const m = makeModel(e, side, `${side}-R${pi}-${i}`, { fromMixedList: !!force.mixed })
      resetRoundFlags(m)
      return m
    })
    return {
      companyId: pkg.companyId,
      uv: pkg.uv,
      models: modelsInPkg,
      names: modelsInPkg.map((m) => m.name),
    }
  })
  syncOccupants(map, models)
  return { models, reservePackages }
}

function objectiveController(map, models, obj) {
  const nearby = models.filter((m) => m.alive && m.hex && hexDist(m.hex, obj) <= 1)
  if (!nearby.length) return null
  const a = nearby.filter((m) => m.side === 'A').length
  const b = nearby.filter((m) => m.side === 'B').length
  if (a !== b) return a > b ? 'A' : 'B'
  const on = nearby.find((m) => m.hex.q === obj.q && m.hex.r === obj.r)
  return on ? on.side : null
}

/** Objectives with a living model of `side` standing on the hex. */
function countOccupiedObjectives(map, models, side) {
  let n = 0
  for (const obj of map.objectives || []) {
    if (
      models.some(
        (m) =>
          m.alive &&
          m.side === side &&
          m.hex &&
          m.hex.q === obj.q &&
          m.hex.r === obj.r,
      )
    ) {
      n += 1
    }
  }
  return n
}

function pickMoveTarget(model, side, map, models, officer, rng = Math.random) {
  const foes = models.filter((m) => m.alive && m.side !== side && m.hex)
  const hq = models.find((m) => m.alive && m.side === side && m.role === 'commander')
  const objs = map.objectives || []
  if (model.role === 'commander') {
    return side === 'A' ? oddRToAxial(BOARD_MID, 1) : oddRToAxial(BOARD_MID, BOARD_SIZE - 2)
  }
  if (model.role === 'officer') {
    const lane = objs[model.companyId % Math.max(1, objs.length)] || primaryObjective(map)
    const hold = {
      q: lane.q,
      r: side === 'A' ? lane.r - 2 : lane.r + 2,
    }
    if (!inBounds(hold)) {
      hold.r = lane.r
    }
    if (hq && hexDist(model.hex, hq.hex) > 6) return hq.hex
    return hold
  }
  // units: contest or screen
  const sorted = [...objs].sort((a, b) => hexDist(model.hex, a) - hexDist(model.hex, b))
  if (sorted.length && rng() < 0.6) return sorted[0]
  if (hq && foes.length) {
    const near = [...foes].sort((a, b) => hexDist(hq.hex, a.hex) - hexDist(hq.hex, b.hex))[0]
    return {
      q: Math.round((hq.hex.q * 2 + near.hex.q) / 3),
      r: Math.round((hq.hex.r * 2 + near.hex.r) / 3),
    }
  }
  return foes[0]?.hex || sorted[0] || BOARD_CENTER
}

function abilityCooldownRounds(def) {
  if (!def) return 0
  if (def.type === 'Passive') return 0
  if (def.type === 'Ultimate') return 0 // once/battle handled separately
  // Only honor explicit YAML/API cooldown — cost is the primary gate
  if (def.cooldown != null && def.cooldown > 0) return Number(def.cooldown)
  return 0
}

function abilityOnCooldown(caster, abilityName, round) {
  const ready = caster.abilityReadyRound?.[abilityName]
  return ready != null && round < ready
}

function markAbilityCooldown(caster, abilityName, def, round) {
  const cd = abilityCooldownRounds(def)
  if (cd <= 0) return
  if (!caster.abilityReadyRound) caster.abilityReadyRound = {}
  caster.abilityReadyRound[abilityName] = round + cd
}

/**
 * Commander-native abilities that reuse officer effect implementations.
 * Shared with play via play/shared/commanderEffectAliases.json.
 */
const COMMANDER_EFFECT_ALIASES = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../play/shared/commanderEffectAliases.json',
    ),
    'utf8',
  ),
)

/**
 * Beast Banner: pick the friendly company with the most Beasts in Command Radius.
 */
function beastBannerCompanyPool(sideState, models, caster) {
  if (!caster?.hex) return []
  const cr = caster.radius || 6
  let best = []
  for (const co of sideState.companies || []) {
    const members = companyMembers(models, sideState.side, co.id).filter(
      (u) =>
        u.alive &&
        u.hex &&
        isBeastType(u) &&
        hexDist(u.hex, caster.hex) <= cr,
    )
    if (members.length > best.length) best = members
  }
  return best
}

function tryCastAbility({
  caster,
  abilityName,
  sideState,
  company,
  models,
  map,
  abilityMap,
  inRad,
  rng,
  kills,
  vp,
  round = 1,
}) {
  const def = abilityMap.get(abilityName)
  if (!def) return false
  if (!hasAbility(caster, abilityName) && caster.ultimate !== abilityName) return false
  if (def.type === 'Passive') return false // passives are always-on; never cast
  if (abilityOnCooldown(caster, abilityName, round)) return false
  if (
    (abilityName === 'Raise Thrall' ||
      abilityName === 'Raise Host' ||
      abilityName === 'Gravespan Call') &&
    caster._raiseThrallUsed
  ) {
    return false
  }
  // Null Field / Null Pulse: suppress actives in radius
  if (def.type !== 'Passive') {
    const blocked = models.some(
      (m) =>
        m.alive &&
        m.side !== caster.side &&
        m._nullField &&
        m.hex &&
        caster.hex &&
        hexDist(m.hex, caster.hex) <= (m.radius || 6),
    )
    if (blocked || caster._nullPulsed) return false
  }
  const costOverride = abilityCostOverrides()[abilityName]
  const costAmt = costOverride?.costAmount ?? def.costAmount ?? 0
  const res = (
    costOverride?.costResource ||
    def.costResource ||
    ''
  ).toUpperCase()

  const cmd = models.find((m) => m.alive && m.side === sideState.side && m.role === 'commander')
  const cmdRad = cmd ? friendsInCommanderRadius(models, cmd) : []
  // Officers pass company-in-radius (may be empty). Never fall back to army CR for officers.
  // Commanders pass army-in-radius. Unit-range abilities rebuild the pool below.
  let friendPool =
    inRad != null ? inRad : caster.role === 'commander' ? cmdRad : []
  if (
    abilityName === 'Heal' ||
    abilityName === 'Soul Offering' ||
    abilityName === 'Flesh Tithe'
  ) {
    // Unit abilities: any friendly creature in printed Range.
    friendPool = armyAlliesInRange(models, caster)
  }
  // Beast Banner / Matriarch's Protection: one company only (not whole army in CR).
  if (
    (abilityName === 'Beast Banner' || abilityName === "Matriarch's Protection") &&
    caster.role === 'commander'
  ) {
    friendPool = beastBannerCompanyPool(sideState, models, caster)
  }
  const radiusFriends = friendPool.filter((u) => buffApplies(abilityName, caster, u))

  // Fail before spending when heal/sacrifice has no legal targets.
  if (abilityName === 'Medic' || abilityName === 'Heal') {
    if (!radiusFriends.some((u) => u.hp < u.toughness)) return false
  } else if (abilityName === 'Repair') {
    if (!radiusFriends.some((u) => u.hp < u.toughness)) return false
  } else if (abilityName === 'Blood Offering') {
    const injured = radiusFriends.filter((u) => u.hp < u.toughness)
    const canSacrifice = injured.some((inj) =>
      radiusFriends.some((u) => u.role === 'unit' && u.id !== inj.id),
    )
    if (!injured.length || !canSacrifice) return false
  } else if (abilityName === 'Blood Lottery') {
    const fodder = radiusFriends.some(
      (u) => u.role === 'unit' && u.hp < u.toughness,
    )
    if (!fodder) return false
  } else if (
    abilityName === 'Soul Offering' ||
    abilityName === 'Flesh Tithe'
  ) {
    const injured = radiusFriends.filter((u) => u.hp < u.toughness)
    // Heal may land on any ally; fodder must be a distinct combat unit.
    const canSacrifice = injured.some((inj) =>
      radiusFriends.some((u) => u.role === 'unit' && u.id !== inj.id),
    )
    if (!injured.length || !canSacrifice) return false
  } else if (abilityName === 'Snare') {
    const hasFoe =
      caster.hex &&
      models.some(
        (m) =>
          m.alive &&
          m.side !== caster.side &&
          m.hex &&
          hexDist(caster.hex, m.hex) <= 3,
      )
    if (!hasFoe) return false
  }

  if (def.type === 'Ultimate') {
    if (sideState.ultimateUsed) return false
  } else if (res === 'CC') {
    // CC abilities are commander-only (matches play / card DB rules).
    if (caster.role !== 'commander') return false
    let cost = costAmt
    if (sideState.strategistAvailable && cost > 0) {
      cost -= 1
      sideState.strategistAvailable = false
    }
    if (sideState.cc < cost) return false
    sideState.cc -= cost
  } else if (res === 'AP') {
    if (caster.role === 'commander') {
      if (sideState.commanderAp < costAmt) return false
      sideState.commanderAp -= costAmt
    } else if (!spendAp(company, costAmt)) return false
  } else if (def.type === 'Active') {
    return false
  }

  if (def.type === 'Ultimate') sideState.ultimateUsed = true
  else markAbilityCooldown(caster, abilityName, def, round)

  // Resolve commander variants onto shared officer effect handlers.
  abilityName = COMMANDER_EFFECT_ALIASES[abilityName] || abilityName

  if (abilityName === 'Battle Orders') {
    const u = radiusFriends[0]
    if (u) u.tempMove += 1
  } else if (abilityName === 'Hold the Line' || abilityName === 'Line Decree') {
    const hardenFloor = dialEffects().holdTheLineHarden || 1
    for (const u of radiusFriends) {
      if (buffStrength(abilityName, caster, u) <= 0) continue
      u.harden = (u.harden || 0) + hardenFloor
    }
  } else if (abilityName === 'Shield Column') {
    for (const u of radiusFriends) {
      if (buffStrength(abilityName, caster, u) <= 0) continue
      u.harden = (u.harden || 0) + 2
      u._tempShieldwall = true
    }
  } else if (
    abilityName === 'Fortify Position' ||
    abilityName === 'Brace Order' ||
    abilityName === 'Harden Order'
  ) {
    const u = [...radiusFriends].sort((a, b) => a.hp - b.hp)[0]
    if (u) {
      u.harden = (u.harden || 0) + 2
    }
  } else if (abilityName === 'Fortify Works' || abilityName === 'Stoneworks') {
    const origin = caster.hex
    if (origin) {
      if (!fortifyHexWithOccupantHarden(map, origin, models, sideState.side)) {
        const adj = neighbors(origin).find((h) => {
          const cell = map.cells.get(hexKey(h.q, h.r))
          return cell && !cell.fortified && canOccupyHex(map, h, caster)
        })
        if (adj) fortifyHexWithOccupantHarden(map, adj, models, sideState.side)
      }
    }
  } else if (abilityName === 'Entrench') {
    if (caster.hex) fortifyHexWithOccupantHarden(map, caster.hex, models, sideState.side)
  } else if (abilityName === 'Hold the Gate' || abilityName === 'Holdfast Gate') {
    const objs = (map.objectives || [])
      .filter((o) => caster.hex && hexDist(caster.hex, o) <= (caster.radius || 6))
      .sort((a, b) => hexDist(caster.hex, a) - hexDist(caster.hex, b))
    for (const o of objs) {
      if (fortifyHexWithOccupantHarden(map, o, models, sideState.side)) break
    }
  } else if (abilityName === 'Raise Mantlets') {
    if (caster.hex) fortifyHexWithOccupantHarden(map, caster.hex, models, sideState.side)
  } else if (abilityName === 'Sappers') {
    if (caster.hex) fortifyHexWithOccupantHarden(map, caster.hex, models, sideState.side)
    const foeFort = [...(map.cells?.values?.() || [])]
      .filter((c) => c.fortified && caster.hex && hexDist(caster.hex, c) <= 2)
      .sort((a, b) => hexDist(caster.hex, a) - hexDist(caster.hex, b))[0]
    if (foeFort) demolishFortification(map, foeFort, { models, sideState })
  } else if (abilityName === 'Ember Burst' || abilityName === 'Inferno Cone') {
    const dragon = [...radiusFriends]
      .filter(isDragonLike)
      .sort((a, b) => (b.baseDamage || 0) - (a.baseDamage || 0))[0]
    if (dragon) {
      dragon._blastRadius = 1
      dragon.tempDamage += 1
      tagAtkBuff(dragon, abilityName)
    }
  } else if (abilityName === 'Spanned Shot') {
    const u =
      [...radiusFriends].filter(isRanged).sort((a, b) => (b.range || 1) - (a.range || 1))[0] ||
      radiusFriends[0]
    if (u) {
      u._tempRangeBonus = (u._tempRangeBonus || 0) + 1
      u._noMove = true
    }
  } else if (abilityName === 'Siege Elevation') {
    const u = [...radiusFriends]
      .filter(isSiegeLike)
      .sort((a, b) => (b.range || 1) - (a.range || 1))[0]
    if (u) {
      u._tempRangeBonus = (u._tempRangeBonus || 0) + 1
      u._noMove = true
    }
  } else if (abilityName === 'Haul Lines') {
    const siege = [...radiusFriends].filter(isSiegeLike)
    const u = siege.find((s) =>
      models.some(
        (m) =>
          m.alive &&
          m.side === s.side &&
          m.id !== s.id &&
          !isSiegeLike(m) &&
          m.hex &&
          s.hex &&
          hexDist(m.hex, s.hex) === 1,
      ),
    )
    if (u) u.tempMove += 1
  } else if (abilityName === 'Limber Up') {
    const u = [...radiusFriends].filter(isSiegeLike)[0]
    if (u) {
      u.tempMove += 1
      u._noAttack = true
    }
  } else if (abilityName === 'Pack Reform') {
    // Reposition Pack bodies to form Pack–Pack adjacency — no combat buff.
    const needAdj = dialEffects().packAdjacentRequired || 1
    const packCount = (u) => {
      if (!u?.hex) return 0
      return models.filter(
        (m) =>
          m.alive &&
          m.side === u.side &&
          m.id !== u.id &&
          m.hex &&
          hexDist(u.hex, m.hex) === 1 &&
          hasAbility(m, 'Pack'),
      ).length
    }
    const pool = radiusFriends.filter((u) => hasAbility(u, 'Pack'))
    const ranked = [...pool].sort((a, b) => packCount(a) - packCount(b) || (a.hp || 0) - (b.hp || 0))
    for (const u of ranked.slice(0, 2)) {
      if (u.rootedUntilEor) continue
      if (packCount(u) >= needAdj) continue
      const buddy = models
        .filter(
          (m) =>
            m.alive &&
            m.side === u.side &&
            m.id !== u.id &&
            m.hex &&
            hasAbility(m, 'Pack'),
        )
        .sort((a, b) => hexDist(u.hex, a.hex) - hexDist(u.hex, b.hex))[0]
      if (buddy) moveModelToward(map, u, buddy.hex, models, 1, { ignoreTerrainCosts: true })
    }
    syncOccupants(map, models)
  } else if (abilityName === 'Pack Hunt' || abilityName === 'Tribal Hunt') {
    // Deprecated — kept for orphan casts; printed kits use Pack Reform.
    for (const u of radiusFriends) {
      if (hasAbility(u, 'Pack') || isBeastType(u)) {
        u.tempDamage = (u.tempDamage || 0) + 1
      }
    }
  } else if (abilityName === 'Raise Thrall' || abilityName === 'Gravespan Call') {
    caster._raiseThrallUsed = true
    const dead = models
      .filter((m) => !m.alive && m.side === sideState.side && m.role !== 'commander')
      .sort((a, b) => (b.uv || 0) - (a.uv || 0))[0]
    if (dead && placeRaisedUnit(dead, models, map, caster.hex, 2)) {
      syncOccupants(map, models)
    }
  } else if (abilityName === 'Brood Call') {
    for (const u of radiusFriends.filter(isDragonLike)) {
      u.tempMove += 1
    }
  } else if (abilityName === 'Scale Ward') {
    for (const u of radiusFriends.filter(isDragonLike)) {
      u.harden = (u.harden || 0) + 2
    }
  } else if (abilityName === 'Scorch Mark') {
    const u = [...radiusFriends]
      .filter((x) => isDragonLike(x) && (hasAbility(x, 'Blast') || blastRadiusOf(x) > 0 || (x.range || 1) >= 2))
      .sort((a, b) => (b.baseDamage || 0) - (a.baseDamage || 0))[0]
    if (u) u._scorchSiege = true
  } else if (abilityName === 'Terror Dive') {
    const u = [...radiusFriends]
      .filter((x) => isDragonLike(x) && (x.movedThisAct >= 2 || (x.tempMove || 0) >= 1))
      .sort((a, b) => (b.baseDamage || 0) - (a.baseDamage || 0))[0]
    if (u) u._terrorFear = true
  } else if (abilityName === 'Wing Buffet') {
    const foe = models
      .filter(
        (m) =>
          m.alive &&
          m.side !== sideState.side &&
          m.hex &&
          caster.hex &&
          hexDist(caster.hex, m.hex) === 1,
      )
      .sort((a, b) => a.hp - b.hp)[0]
    if (foe && caster.hex) {
      const away = neighbors(foe.hex)
        .filter((h) => canOccupyHex(map, h, foe) && hexDist(caster.hex, h) > hexDist(caster.hex, foe.hex))
        .sort((a, b) => hexDist(caster.hex, b) - hexDist(caster.hex, a))[0]
      if (away) {
        foe.hex = { ...away }
        syncOccupants(map, models)
      }
    }
  } else if (abilityName === 'Sky Tyrant') {
    for (const u of radiusFriends.filter((x) => isDragonLike(x) && hasAbility(x, 'Flying'))) {
      u.tempMove += 1
      u._terrorFear = true
    }
  } else if (abilityName === "Tyrant's Command") {
    for (const u of radiusFriends.filter(isDragonLike)) {
      u.tempDamage += 2
      u.harden = (u.harden || 0) + 1
    }
  } else if (abilityName === 'Cataclysm Breath') {
    const foe = models
      .filter((m) => m.alive && m.side !== sideState.side && m.hex && caster.hex)
      .filter((m) => hexDist(caster.hex, m.hex) <= Math.max(3, effectiveRange(caster)))
      .sort((a, b) => a.hp - b.hp)[0]
    if (foe) {
      const dmg = Math.max(1, effectiveDamage(caster, models, foe))
      for (const { target, dmg: splash } of planBlastAssignments(caster, foe, models, dmg, 1)) {
        applyIncomingDamage(target, splash, caster, models, map)
        if (!target.alive) {
          const pts = vpForKill(target)
          vp[sideState.side] += pts
          kills[sideState.side].push({ name: target.name, role: target.role, vp: pts })
        }
      }
    }
  } else if (abilityName === 'Hoard Claim' || abilityName === 'Hoard Reckoning') {
    // Spoils spike — no flat VP. Board control feeds Harden; Dragons get damage + free attack.
    const held = Math.min(3, countOccupiedObjectives(map, models, sideState.side))
    const dragons = radiusFriends.filter(isDragonLike)
    for (const u of dragons) {
      u.tempDamage += 2
      if (held > 0) u.harden = (u.harden || 0) + held
      u._freeAttack = true
      tagAtkBuff(u, abilityName)
    }
  } else if (abilityName === 'Anvil Advance') {
    for (const u of radiusFriends) {
      u.harden = (u.harden || 0) + 1
      const obj = map.objectives?.[0]
      if (obj) moveModelToward(map, u, obj, models, 1, { ignoreTerrainCosts: true })
    }
    syncOccupants(map, models)
  } else if (abilityName === 'Holdfast') {
    for (const u of radiusFriends.slice(0, 2)) u._unyielding = true
  } else if (abilityName === 'Stone Line') {
    for (const u of models.filter(
      (m) =>
        m.alive &&
        m.side === sideState.side &&
        m.hex &&
        caster.hex &&
        hexDist(m.hex, caster.hex) === 1 &&
        String(m.race || '') === 'Dwarf',
    )) {
      u.harden = (u.harden || 0) + 1
    }
  } else if (abilityName === 'Refresh Works') {
    const hexes = (map.objectives || []).concat(
      radiusFriends.filter((u) => u.hex).map((u) => u.hex),
    )
    for (const h of hexes) {
      if (fortifyHexWithOccupantHarden(map, h, models, sideState.side)) break
    }
  } else if (abilityName === 'Shield Brotherhood') {
    for (const u of radiusFriends.filter(isInfantryLike)) {
      u._tempShieldwall = true
    }
  } else if (abilityName === 'Unbreakable Hold') {
    let n = 0
    for (const h of (map.objectives || []).concat(radiusFriends.map((u) => u.hex).filter(Boolean))) {
      if (n >= 3) break
      if (fortifyHexWithOccupantHarden(map, h, models, sideState.side)) n++
    }
    for (const u of radiusFriends) {
      u.harden = (u.harden || 0) + 2
      u.tempDamage += 1
    }
  } else if (abilityName === 'Depth Charge') {
    let demolished = 0
    for (const cell of map.cells.values()) {
      if (!cell.fortified || !caster.hex || hexDist(caster.hex, cell) > (caster.radius || 6)) continue
      demolishFortification(map, cell, { models, sideState })
      demolished++
      const occ = models.find((m) => m.alive && m.hex && m.hex.q === cell.q && m.hex.r === cell.r)
      if (occ && occ.side !== sideState.side) applyIncomingDamage(occ, 2, caster, models, map)
    }
    // Siege ultimate still pressures when few forts exist.
    if (demolished < 2) {
      for (const u of radiusFriends) u.tempDamage += 1
      for (const foe of models.filter(
        (m) =>
          m.alive &&
          m.side !== sideState.side &&
          m.hex &&
          caster.hex &&
          hexDist(caster.hex, m.hex) <= (caster.radius || 6),
      )) {
        applyIncomingDamage(foe, 1, caster, models, map)
      }
    }
  } else if (abilityName === 'Anvil Decree') {
    for (const u of radiusFriends) {
      u.harden = (u.harden || 0) + 2
      u.tempDamage += 1
    }
  } else if (abilityName === "Korrik's Stand") {
    for (const u of radiusFriends) {
      u.harden = (u.harden || 0) + 2
      u.tempDamage += 1
      u._unyielding = true
    }
  } else if (abilityName === 'Cannon Drill' || abilityName === 'Cannon Order' || abilityName === 'Totem Pulse') {
    for (const u of radiusFriends.filter(
      (x) =>
        isSiegeLike(x) ||
        isBeastType(x) ||
        ((abilityName === 'Cannon Drill' || abilityName === 'Cannon Order') &&
          String(x.race || '') === 'Dwarf'),
    )) {
      u.tempDamage += 1
    }
  } else if (abilityName === 'Death March' || abilityName === 'Still March') {
    for (const u of radiusFriends.filter(isUndeadLike)) {
      u.slow = false
      u.tempMove += 1
    }
  } else if (abilityName === 'Soul Tithe' || abilityName === 'Host Tithe') {
    // Triggers when a friendly unit is destroyed in Command Radius this round.
    if (company?.id != null) sideState._soulTitheCompanyId = company.id
    else sideState._soulTitheArmy = true
  } else if (abilityName === 'Mass Fear' || abilityName === 'Dread Wave') {
    for (const foe of models.filter((m) => m.alive && m.side !== sideState.side && m.hex)) {
      const near = radiusFriends.some((u) => u.hex && hexDist(u.hex, foe.hex) === 1)
      if (near && !hasAbility(foe, 'Fearless') && !foe._tempFearless) foe.fear = true
    }
  } else if (abilityName === 'Withering Gaze' || abilityName === 'Howl') {
    const foes = models
      .filter((m) => m.alive && m.side !== sideState.side && m.hex && caster.hex)
      .filter((m) => hexDist(caster.hex, m.hex) <= (abilityName === 'Howl' ? 1 : 3))
    for (const f of foes) {
      if (!hasAbility(f, 'Fearless') && !f._tempFearless) f.fear = true
    }
  } else if (abilityName === 'Snare') {
    // Root until start of next round. Prefer mobile Pack threats.
    const foes = models
      .filter(
        (m) =>
          m.alive &&
          m.side !== sideState.side &&
          m.hex &&
          caster.hex &&
          hexDist(caster.hex, m.hex) <= 3,
      )
      .sort((a, b) => {
        const packBias = (x) => (hasAbility(x, 'Pack') ? 0 : 1)
        const moveBias = (x) => -(x.move || 0)
        return (
          packBias(a) - packBias(b) ||
          moveBias(a) - moveBias(b) ||
          hexDist(caster.hex, a.hex) - hexDist(caster.hex, b.hex) ||
          a.hp - b.hp
        )
      })
    if (foes[0]) foes[0].rootedUntilEor = true
  } else if (abilityName === 'Crypt Demolish') {
    const cell = [...map.cells.values()]
      .filter((c) => c.fortified && caster.hex && hexDist(caster.hex, c) <= (caster.radius || 6))
      .sort((a, b) => hexDist(caster.hex, a) - hexDist(caster.hex, b))[0]
    if (cell && demolishFortification(map, cell, { models, sideState })) {
      const dead = models
        .filter((m) => !m.alive && m.side === sideState.side && m.role === 'unit')
        .sort((a, b) => (b.uv || 0) - (a.uv || 0))[0]
      if (dead && placeRaisedUnit(dead, models, map, cell)) syncOccupants(map, models)
    }
  } else if (abilityName === 'Bone Harvest') {
    let raised = 0
    for (const cell of map.cells.values()) {
      if (!cell.fortified || !caster.hex || hexDist(caster.hex, cell) > (caster.radius || 6)) continue
      if (!demolishFortification(map, cell, { models, sideState })) continue
      const dead = models
        .filter((m) => !m.alive && m.side === sideState.side && m.role === 'unit')
        .sort((a, b) => (b.uv || 0) - (a.uv || 0))[0]
      if (dead && placeRaisedUnit(dead, models, map, cell)) raised++
    }
    // If few forts, still recycle corpses in CR.
    if (raised < 2) {
      const dead = models
        .filter((m) => !m.alive && m.side === sideState.side && m.role === 'unit')
        .sort((a, b) => (b.uv || 0) - (a.uv || 0))
      for (const d of dead.slice(0, 3 - raised)) {
        if (placeRaisedUnit(d, models, map, caster.hex, 1)) raised++
      }
    }
    if (raised) syncOccupants(map, models)
  } else if (abilityName === 'Gravemind') {
    let budget = 18
    const dead = models
      .filter((m) => !m.alive && m.side === sideState.side && m.role !== 'commander')
      .sort((a, b) => (a.uv || 0) - (b.uv || 0))
    for (const d of dead) {
      if (budget <= 0) break
      const cost = Math.max(1, d.uv || 1)
      if (cost > budget) continue
      if (placeRaisedUnit(d, models, map, caster.hex, 2)) budget -= cost
    }
    syncOccupants(map, models)
  } else if (abilityName === 'Eclipse of Fear' || abilityName === 'Alpha Howl') {
    for (const foe of models.filter(
      (m) =>
        m.alive &&
        m.side !== sideState.side &&
        m.hex &&
        (cmd?.hex || caster.hex) &&
        hexDist((cmd?.hex || caster.hex), m.hex) <= (cmd?.radius || caster.radius || 6),
    )) {
      foe.fear = true
      foe.tempDamage = Math.max((foe.tempDamage || 0) - 1, -1)
    }
  } else if (abilityName === 'Still Host Rise') {
    for (const u of radiusFriends.filter((x) => String(x.race || '').toLowerCase() === 'undead')) {
      u._tempFearless = true
      u.tempDamage += 1
      u._freeAttack = true
      tagAtkBuff(u, abilityName)
    }
  } else if (abilityName === 'Crypt Discipline') {
    for (const u of radiusFriends.filter(isUndeadLike)) {
      if ((u.uv || 0) >= 14) u._tempFearless = true
    }
  } else if (abilityName === 'Bone Prison') {
    // Root + prevent attack until next round (stronger Snare)
    const foes = models
      .filter(
        (m) =>
          m.alive &&
          m.side !== sideState.side &&
          m.hex &&
          caster.hex &&
          hexDist(caster.hex, m.hex) <= 3,
      )
      .sort((a, b) => {
        const moveBias = (x) => -(x.move || 0)
        const dmgBias = (x) => -(x.baseDamage || 0)
        return (
          moveBias(a) - moveBias(b) ||
          dmgBias(a) - dmgBias(b) ||
          hexDist(caster.hex, a.hex) - hexDist(caster.hex, b.hex) ||
          a.hp - b.hp
        )
      })
    if (foes[0]) {
      foes[0].rootedUntilEor = true
      foes[0]._bonePrisoned = true // Cannot attack until next round
    }
  } else if (abilityName === 'Shadow Orb') {
    // Deal 2 damage to enemy within 6 hexes, apply Slow
    const foes = models
      .filter(
        (m) =>
          m.alive &&
          m.side !== sideState.side &&
          m.hex &&
          caster.hex &&
          hexDist(caster.hex, m.hex) <= 6,
      )
      .sort((a, b) => a.hp - b.hp)
    const target = foes[0]
    if (target) {
      applyIncomingDamage(target, 2, caster, models, map)
      if (target.alive) target.slow = true
      if (!target.alive) {
        const pts = vpForKill(target)
        vp[sideState.side] += pts
        kills[sideState.side].push({ name: target.name, role: target.role, vp: pts })
      }
    }
  } else if (abilityName === 'Decay') {
    // −1 Toughness and −1 Damage debuff to enemy in radius
    const rad = caster.radius || caster.commandRadius || 6
    const foes = models
      .filter(
        (m) =>
          m.alive &&
          m.side !== sideState.side &&
          m.hex &&
          caster.hex &&
          hexDist(caster.hex, m.hex) <= rad,
      )
      .sort((a, b) => b.hp - a.hp || (b.baseDamage || 0) - (a.baseDamage || 0))
    const target = foes[0]
    if (target) {
      target._decayDebuff = true
      target.tempDamage = (target.tempDamage || 0) - 1
      if (target.toughness > 1) {
        target.toughness -= 1
        target.hp = Math.min(target.hp, target.toughness)
      }
    }
  } else if (abilityName === 'Spectral Strike') {
    // Chosen Undead attacks with +1 Damage, ignores Guard
    const undead = [...radiusFriends]
      .filter(isUndeadLike)
      .sort((a, b) => (b.baseDamage || 0) - (a.baseDamage || 0) || b.hp - a.hp)
    const chosen = undead[0]
    if (chosen) {
      chosen.tempDamage = (chosen.tempDamage || 0) + 1
      chosen._spectralStrike = true // Ignores Guard
      chosen._freeAttack = true
      tagAtkBuff(chosen, abilityName)
    }
  } else if (abilityName === 'Soul Harvest') {
    // When a unit dies in radius this round, gain CC or heal
    sideState._soulHarvestActive = true
  } else if (abilityName === 'Phantom Rally') {
    // Undead in army +2 Move, ignore ZoC
    for (const u of radiusFriends.filter(isUndeadLike)) {
      u.tempMove = (u.tempMove || 0) + 2
      u._ignoreZoc = true
    }
  } else if (abilityName === "Reaper's Touch") {
    // Officer attacks adjacent enemy; if killed, heal 1 to company unit
    const foes = models
      .filter(
        (m) =>
          m.alive &&
          m.side !== sideState.side &&
          m.hex &&
          caster.hex &&
          hexDist(caster.hex, m.hex) === 1,
      )
      .sort((a, b) => a.hp - b.hp)
    const target = foes[0]
    if (target) {
      const dmg = Math.max(1, effectiveDamage(caster, models, target))
      const beforeAlive = target.alive
      applyIncomingDamage(target, dmg, caster, models, map)
      if (beforeAlive && !target.alive) {
        const pts = vpForKill(target)
        vp[sideState.side] += pts
        kills[sideState.side].push({ name: target.name, role: target.role, vp: pts })
        // Heal 1 to a company unit
        const injured = radiusFriends
          .filter((u) => u.role === 'unit' && u.hp < u.toughness)
          .sort((a, b) => a.hp / a.toughness - b.hp / b.toughness)[0]
        if (injured) injured.hp = Math.min(injured.toughness, injured.hp + 1)
      }
    }
  } else if (abilityName === 'Barrow Ward') {
    // Company units in CR gain Harden 3
    for (const u of radiusFriends) {
      u.harden = (u.harden || 0) + 3
      tagDefBuff(u, abilityName)
    }
  } else if (abilityName === 'Grave Fortify') {
    // Fortify hex in CR; if friendly moves onto it, +1 Toughness
    const origin = caster.hex
    if (origin && map) {
      const candidates = neighbors(origin)
        .filter((h) => {
          if (!inBounds(h)) return false
          const cell = map.cells.get(hexKey(h.q, h.r))
          if (!cell || cell.terrain === 'water' || cell.terrain === 'wall') return false
          return true
        })
        .filter((h) => !models.some((m) => m.alive && m.hex && m.hex.q === h.q && m.hex.r === h.r))
      const hex = candidates[0] || origin
      if (fortifyHex(map, hex)) {
        // Mark hex for conditional toughness boost
        const cell = map.cells.get(hexKey(hex.q, hex.r))
        if (cell) cell._graveFortifyBonus = sideState.side
      }
    }
  } else if (abilityName === 'Necrotic Bolt') {
    // Deal officer's Damage to enemy in range; +1 vs Fear
    const range = Math.max(2, caster.range || 3)
    const foes = models
      .filter(
        (m) =>
          m.alive &&
          m.side !== sideState.side &&
          m.hex &&
          caster.hex &&
          hexDist(caster.hex, m.hex) <= range,
      )
      .sort((a, b) => {
        const fearBias = (x) => (x.fear ? 0 : 1)
        return fearBias(a) - fearBias(b) || a.hp - b.hp
      })
    const target = foes[0]
    if (target) {
      let dmg = Math.max(1, caster.baseDamage || caster.damage || 2)
      if (target.fear) dmg += 1
      applyIncomingDamage(target, dmg, caster, models, map)
      if (!target.alive) {
        const pts = vpForKill(target)
        vp[sideState.side] += pts
        kills[sideState.side].push({ name: target.name, role: target.role, vp: pts })
      }
    }
  } else if (abilityName === 'Alpha Mark') {
    const foe = models
      .filter((m) => m.alive && m.side !== sideState.side && m.hex)
      .sort((a, b) => a.hp - b.hp)[0]
    if (foe) foe._alphaMarked = true
  } else if (abilityName === 'Wild Rush') {
    // Threshold only — does not grant Charge to units that lack it.
    for (const u of radiusFriends.filter((x) => isBeastType(x) || isMounted(x) || isChargeLike(x))) {
      if (u.hasCharge || hasAbility(u, 'Charge')) u._wildRush = true
    }
  } else if (abilityName === 'Spur Order') {
    for (const u of radiusFriends.filter(isMounted)) {
      u.hasCharge = true
      u.tempMove += 1
    }
  } else if (abilityName === "Beastmaster's Call") {
    for (const u of radiusFriends.filter(isBeastType)) u.tempMove += 1
  } else if (abilityName === "Matriarch's Protection") {
    for (const u of radiusFriends.filter(isBeastType)) {
      u.harden = (u.harden || 0) + 1
      tagDefBuff(u, abilityName)
    }
  } else if (abilityName === 'Tribal Cadence') {
    for (const u of radiusFriends.filter((x) => String(x.race) === 'Beastfolk')) {
      u.tempMove += 1
    }
  } else if (abilityName === 'Draft Beasts') {
    for (const u of radiusFriends.filter(isSiegeLike)) {
      const nearBeast = models.some(
        (m) =>
          m.alive &&
          m.side === u.side &&
          m.hex &&
          u.hex &&
          hexDist(m.hex, u.hex) === 1 &&
          isBeastType(m),
      )
      if (nearBeast) u.tempMove += 1
    }
  } else if (abilityName === 'Blood Frenzy' || abilityName === 'Blood Moon') {
    for (const u of radiusFriends.filter(isBeastType)) {
      u.hasFrenzy = true
    }
  } else if (abilityName === 'Tribal Convergence') {
    for (const u of radiusFriends.filter((x) => isBeastfolkLike(x))) {
      u.tempDamage += 1
      u.hasPack = true
      u._freeAttack = true
      tagAtkBuff(u, abilityName)
    }
  } else if (abilityName === 'Flank Sweep') {
    for (const u of radiusFriends) {
      if (hasAbility(u, 'Flanking') || u._tempFlanking) u._flankPierce = true
      u._tempFlanking = true
      u._flankPierce = true
    }
  } else if (abilityName === 'Wild Hunt') {
    // Cap at 3 Beasts (printed) — prefer those already near enemies / higher damage.
    const pack = [...radiusFriends]
      .filter(isBeastType)
      .sort((a, b) => {
        const near = (u) => {
          const foe = models
            .filter((m) => m.alive && m.side !== sideState.side && m.hex && u.hex)
            .sort((x, y) => hexDist(u.hex, x.hex) - hexDist(u.hex, y.hex))[0]
          return foe ? hexDist(u.hex, foe.hex) : 99
        }
        return near(a) - near(b) || (b.baseDamage || 0) - (a.baseDamage || 0)
      })
      .slice(0, 3)
    for (const u of pack) {
      const foe = models
        .filter((m) => m.alive && m.side !== sideState.side && m.hex)
        .sort((a, b) => hexDist(u.hex, a.hex) - hexDist(u.hex, b.hex))[0]
      if (foe) moveModelToward(map, u, foe.hex, models, effectiveMove(u, models, map))
      u._freeAttack = true
      tagAtkBuff(u, abilityName)
    }
    syncOccupants(map, models)
  } else if (abilityName === 'Battery Link' || abilityName === 'Siege Cadence' || abilityName === 'Lockstep Barrage') {
    const pool =
      abilityName === 'Lockstep Barrage'
        ? radiusFriends.filter(isSiegeLike)
        : radiusFriends.filter((x) => isSiegeLike(x) || (isConstructLike(x) && (x.baseDamage || 0) > 0))
    for (const u of pool) {
      u._freeAttack = true
      tagAtkBuff(u, abilityName)
    }
  } else if (abilityName === 'Lockstep') {
    for (const u of radiusFriends.filter((x) => isSiegeLike(x) || isConstructLike(x))) {
      u._lockstepAp = true
    }
  } else if (abilityName === 'Motive Overdrive') {
    const u = [...radiusFriends]
      .filter((x) => isSiegeLike(x) || isConstructLike(x))
      .sort((a, b) => (b.baseDamage || 0) - (a.baseDamage || 0))[0]
    if (u) u.tempMove += 2
  } else if (abilityName === 'Full Rebuild') {
    for (const u of radiusFriends.filter((x) => isConstructLike(x) || isSiegeLike(x))) {
      u.hp = Math.min(u.toughness, u.hp + 3)
    }
  } else if (abilityName === 'Prime Protocol') {
    for (const u of radiusFriends.filter(isConstructLike)) {
      u.tempDamage += 2
      u._freeAttack = true
      tagAtkBuff(u, abilityName)
    }
  } else if (abilityName === 'Rebuild Protocol' || abilityName === 'Repair Rites') {
    const u = [...radiusFriends]
      .filter((x) => isConstructLike(x) || isSiegeLike(x))
      .sort((a, b) => a.hp / a.toughness - b.hp / b.toughness)[0]
    if (u) u.hp = Math.min(u.toughness, u.hp + 3)
  } else if (abilityName === 'Null Field') {
    caster._nullField = true
  } else if (abilityName === 'Null Pulse') {
    const foe = models
      .filter(
        (m) =>
          m.alive &&
          m.side !== sideState.side &&
          m.hex &&
          caster.hex &&
          hexDist(caster.hex, m.hex) <= (caster.radius || 6),
      )
      .sort((a, b) => a.hp - b.hp)[0]
    if (foe) foe._nullPulsed = true
  } else if (abilityName === 'Overdrive') {
    const u = [...radiusFriends].filter(isConstructLike).sort((a, b) => b.hp - a.hp)[0]
    if (u) u.tempDamage += 1
  } else if (abilityName === 'Sealant Coat') {
    for (const u of radiusFriends.filter(isConstructLike)) {
      u._tempFearless = true
      u.poisonTokens = 0
      u.harden = (u.harden || 0) + 1
    }
  } else if (abilityName === 'Magnetic Line') {
    const u =
      [...radiusFriends].filter(isConstructLike)[0] ||
      (isConstructLike(caster) || caster.role === 'commander' ? caster : null)
    const obj = map.objectives?.[0]
    if (u && obj) {
      moveModelToward(map, u, obj, models, 1, { ignoreTerrainCosts: true })
      syncOccupants(map, models)
    }
  } else if (abilityName === 'Battle Cry') {
    for (const u of radiusFriends) {
      u.tempDamage += 1
      u.hasCharge = true
    }
  } else if (abilityName === 'Abyssal Onslaught') {
    for (const u of radiusFriends) {
      u.hasCharge = true
      u.hasFrenzy = true
      u._freeAttack = true
      tagAtkBuff(u, abilityName)
    }
  } else if (abilityName === 'Void Torment') {
    const rad = cmd?.radius || caster.radius || 6
    const origin = cmd?.hex || caster.hex
    for (const foe of models.filter((m) => m.alive && m.side !== sideState.side && m.hex)) {
      if (!origin || hexDist(origin, foe.hex) > rad) continue
      applyIncomingDamage(foe, 2, caster, models, map)
      if (foe.alive) {
        foe.fear = true
        foe.slow = true
      }
    }
  } else if (abilityName === 'Overwhelming Offensive') {
    for (const u of radiusFriends) {
      u._freeAttack = true
      tagAtkBuff(u, abilityName)
    }
  } else if (abilityName === 'Blood Lottery') {
    const fodder = [...radiusFriends]
      .filter((x) => x.role === 'unit' && x.hp < x.toughness)
      .sort((a, b) => (a.uv || 0) - (b.uv || 0) || a.hp - b.hp)[0]
    if (fodder && sacrificeUnit(fodder, models, map)) {
      for (const u of radiusFriends) {
        if (u.id === fodder.id) continue
        u.hasFrenzy = true
        u.hasCharge = true
        tagAtkBuff(u, abilityName)
      }
      syncOccupants(map, models)
    }
  } else if (abilityName === 'Apocalypse Cry') {
    const rad = cmd?.radius || caster.radius || 6
    const origin = cmd?.hex || caster.hex
    for (const foe of models.filter((m) => m.alive && m.side !== sideState.side && m.hex)) {
      if (!origin || hexDist(origin, foe.hex) > rad) continue
      applyIncomingDamage(foe, 4, caster, models, map)
      if (foe.alive) foe.fear = true
    }
  } else if (abilityName === 'Coordinated Volley') {
    // One free shot (nerfed from two — was top ability-linked kill engine)
    const ranged = radiusFriends.filter(isRanged).slice(0, 1)
    for (const u of ranged) {
      u._freeAttack = true
      tagAtkBuff(u, abilityName)
    }
  } else if (abilityName === 'Arrowstorm Command') {
    // One free shot for one shooter (dialed from two); still grants printed +1 range.
    const ranged = radiusFriends.filter(isRanged).slice(0, 1)
    for (const u of ranged) {
      u._tempRangeBonus = (u._tempRangeBonus || 0) + 1
      u._freeAttack = true
      tagAtkBuff(u, abilityName)
    }
  } else if (abilityName === 'Suppressive Fire') {
    const origin = caster.hex
    const foe = models
      .filter((m) => m.alive && m.side !== sideState.side && m.hex)
      .sort((a, b) => hexDist(origin, a.hex) - hexDist(origin, b.hex))[0]
    if (foe) foe.suppressUntilEor = 1
  } else if (abilityName === 'Rapid Redeployment' && radiusFriends.length >= 2) {
    const a = radiusFriends[0]
    const b = radiusFriends[1]
    const tmp = a.hex
    a.hex = b.hex
    b.hex = tmp
    syncOccupants(map, models)
  } else if (abilityName === 'Repair') {
    const u = [...radiusFriends]
      .filter((x) => x.hp < x.toughness)
      .sort((a, b) => a.hp / a.toughness - b.hp / b.toughness)[0]
    if (u) u.hp = Math.min(u.toughness, u.hp + 2)
  } else if (abilityName === 'Medic' || abilityName === 'Heal') {
    const u = [...radiusFriends]
      .filter((x) => x.hp < x.toughness)
      .sort((a, b) => a.hp / a.toughness - b.hp / b.toughness)[0]
    if (u) u.hp = Math.min(u.toughness, u.hp + 2)
  } else if (abilityName === 'Blood Offering') {
    // Sacrifice one company unit → Restore 2 Toughness to up to three injured allies.
    const injured = [...radiusFriends]
      .filter((x) => x.hp < x.toughness)
      .sort((a, b) => a.hp / a.toughness - b.hp / b.toughness)
    const fodder = [...radiusFriends]
      .filter((x) => x.role === 'unit' && injured.some((inj) => inj.id !== x.id))
      .sort((a, b) => (a.uv || 0) - (b.uv || 0) || a.hp - b.hp)[0]
    if (fodder && sacrificeUnit(fodder, models, map)) {
      let healed = 0
      for (const u of injured) {
        if (healed >= 3) break
        if (u.id === fodder.id || !u.alive) continue
        u.hp = Math.min(u.toughness, u.hp + 2)
        healed++
      }
      syncOccupants(map, models)
    }
  } else if (
    abilityName === 'Soul Offering' ||
    abilityName === 'Flesh Tithe'
  ) {
    const injured = [...radiusFriends]
      .filter((x) => x.hp < x.toughness)
      .sort((a, b) => a.hp / a.toughness - b.hp / b.toughness)
    const healTarget = injured[0]
    // Never sacrifice officers/commanders — only combat units as fodder.
    const fodder = [...radiusFriends]
      .filter((x) => x.id !== healTarget.id && x.role === 'unit')
      .sort((a, b) => (a.uv || 0) - (b.uv || 0) || a.hp - b.hp)[0]
    if (healTarget && fodder && sacrificeUnit(fodder, models, map)) {
      healTarget.hp = Math.min(healTarget.toughness, healTarget.hp + 3)
      syncOccupants(map, models)
    }
  } else if (abilityName === 'Horn of Advance') {
    let n = 0
    for (const u of radiusFriends) {
      if (n >= 3) break
      // Move only — Charge grant removed (was stacking with Wild Hunt free attacks).
      u.tempMove += 1
      n++
    }
  } else if (abilityName === 'Press Forward') {
    for (const u of radiusFriends.slice(0, 2)) {
      if (u.rootedUntilEor) continue
      const foe = models
        .filter((m) => m.alive && m.side !== sideState.side && m.hex)
        .sort((a, b) => hexDist(u.hex, a.hex) - hexDist(u.hex, b.hex))[0]
      if (foe) moveModelToward(map, u, foe.hex, models, 1, { ignoreTerrainCosts: true })
    }
    syncOccupants(map, models)
  } else if (abilityName === 'Forced March') {
    const u = radiusFriends[0]
    if (u) {
      u.tempMove += effectiveMove(u, models, map)
      u._noAttack = true
    }
  } else if (abilityName === 'Rally') {
    const co = sideState.companies.find((c) => c.officerModel?.alive)
    if (co) co.ap += 1
  } else if (abilityName === 'Tactical Withdrawal') {
    const u = radiusFriends.sort((a, b) => a.hp - b.hp)[0]
    if (u && cmd) moveModelToward(map, u, cmd.hex, models, effectiveMove(u, models, map))
    syncOccupants(map, models)
  } else if (abilityName === 'Cinder March') {
    // YAML: +1 move and ignore first AoO — AoO not modeled, so move only (was wrongly ignoring first hit).
    for (const u of radiusFriends) {
      u.tempMove += 1
    }
  } else if (abilityName === 'Directive Tempo') {
    for (const u of radiusFriends.filter(isConstructLike)) {
      u.tempMove += 1
    }
  } else if (abilityName === 'Summit Currents') {
    for (const u of radiusFriends.filter(
      (x) => hasAbility(x, 'Amphibious') || x.tags?.has?.('amphibious'),
    )) {
      u.tempMove += 1
    }
  } else if (abilityName === 'Counterattack') {
    const u = radiusFriends[0]
    if (u) u._counterattack = true
  } else if (abilityName === 'Poison Tide') {
    const foes = models
      .filter((m) => m.alive && m.side !== sideState.side && m.hex && cmd && hexDist(m.hex, cmd.hex) <= (cmd.radius || 6))
      .sort((a, b) => a.hp - b.hp)
      .slice(0, 3)
    for (const f of foes) f.poisonTokens += 2
  } else if (abilityName === 'Unbroken Hearth') {
    for (const u of radiusFriends) {
      u.harden = (u.harden || 0) + 1
      u.tempDamage += 1
      u.regenEor = Math.max(u.regenEor, 1)
      u._tempShieldwall = true
    }
  } else if (abilityName === 'Realmward Unity') {
    for (const u of radiusFriends) {
      u.tempMove += 1
      u.harden = (u.harden || 0) + 1
      u._objDamageBonus = 1
    }
  } else if (abilityName === 'Iron Covenant Charge') {
    for (const u of radiusFriends.filter(isInfantryLike)) {
      u.hasCharge = true
      u.tempDamage += 2
      const foe = models
        .filter((m) => m.alive && m.side !== sideState.side && m.hex)
        .sort((a, b) => hexDist(u.hex, a.hex) - hexDist(u.hex, b.hex))[0]
      if (foe && u.hex) {
        moveModelToward(map, u, foe.hex, models, 1)
        u._freeAttack = true
        tagAtkBuff(u, abilityName)
      }
    }
    syncOccupants(map, models)
  } else if (abilityName === 'Hearthbound Stand') {
    for (const u of cmdRad) {
      u.harden = (u.harden || 0) + 2
      u._rooted = true
      u._tempShieldwall = true
      u.tempDamage += 1
      u.regenEor = Math.max(u.regenEor || 0, 1)
    }
  } else if (abilityName === 'Fen Unity') {
    // Regen for fen line; poison on Amphibious only (no blanket army poison)
    for (const u of radiusFriends.filter(
      (x) => isAmphibiousLike(x) || x.tags.has('lizardman') || String(x.race || '') === 'Lizardman',
    )) {
      u.regenEor = Math.max(u.regenEor, 2)
      u.tempDamage += 1
      u.hasPoisonAtk = true
    }
  } else if (abilityName === 'Fenbrood Drum') {
    for (const u of radiusFriends.filter((x) => x.tags.has('lizardman') || String(x.race || '') === 'Lizardman')) {
      u.tempMove += 1
      u.regenEor = Math.max(u.regenEor, 1)
      u._freeAttack = true
      tagAtkBuff(u, abilityName)
    }
  } else if (abilityName === 'Moonlit Volley') {
    // Printed: all Ranged in CR immediately perform two attacks each.
    for (const u of radiusFriends.filter(isRanged)) {
      u._freeAttack = true
      u._extraFreeAttack = true
      tagAtkBuff(u, abilityName)
    }
  } else if (abilityName === 'Infernal Rush') {
    // Printed: all Frenzy or Charge in CR move 1 and attack (no 2-unit cap).
    for (const u of radiusFriends) {
      const foe = models
        .filter((m) => m.alive && m.side !== sideState.side && m.hex)
        .sort((a, b) => hexDist(u.hex, a.hex) - hexDist(u.hex, b.hex))[0]
      if (!foe) continue
      moveModelToward(map, u, foe.hex, models, 1, { ignoreTerrainCosts: true })
      u._freeAttack = true
      tagAtkBuff(u, abilityName)
    }
    syncOccupants(map, models)
  } else if (abilityName === 'Thunder Stampede') {
    const herd = radiusFriends.filter(
      (u) =>
        u.hasCharge ||
        hasAbility(u, 'Charge') ||
        isBeastType(u) ||
        isMounted(u) ||
        u.tags?.has?.('cavalry') ||
        u.tags?.has?.('beast') ||
        String(u.primaryType || '').toLowerCase() === 'cavalry' ||
        String(u.primaryType || '').toLowerCase() === 'beast',
    )
    for (const u of herd) {
      const foe = models
        .filter((m) => m.alive && m.side !== sideState.side && m.hex)
        .sort((a, b) => hexDist(u.hex, a.hex) - hexDist(u.hex, b.hex))[0]
      if (foe) {
        const before = u.hex ? { ...u.hex } : null
        moveModelToward(map, u, foe.hex, models, 2, { ignoreTerrainCosts: true })
        if (before && u.hex && hexDist(before, u.hex) >= 1) {
          u.movedThisAct = Math.max(u.movedThisAct || 0, 2)
        }
      }
      u.hasCharge = true
      u._freeAttack = true
      tagAtkBuff(u, abilityName)
    }
    syncOccupants(map, models)
  } else if (abilityName === 'Covenant Drill') {
    for (const co of sideState.companies || []) {
      const off = co.officerModel
      if (off?.alive && cmd && inRadius(off, cmd)) co.ap += 1
    }
  } else if (abilityName === 'Focused Assault') {
    const foe = models
      .filter((m) => m.alive && m.side !== sideState.side && m.hex)
      .sort((a, b) => a.hp - b.hp)[0]
    if (foe) foe._assaultMarked = true
  } else if (abilityName === 'Last Stand') {
    for (const u of radiusFriends) u._lastStand = true
  } else if (abilityName === 'Overwhelming Inferno') {
    for (const u of radiusFriends.filter(
      (x) => isFireLike(x) || String(x.race || '').toLowerCase() === 'demon',
    )) {
      u._tempPiercing = true
      u._scorchSiege = true
      tagAtkBuff(u, abilityName)
    }
  } else if (abilityName === 'Call Reinforcements') {
    const dead = models
      .filter(
        (m) =>
          !m.alive &&
          m.side === sideState.side &&
          m.role === 'unit' &&
          (m.uv || 0) <= 5,
      )
      .sort((a, b) => (a.uv || 0) - (b.uv || 0))[0]
    const anchor =
      models.find(
        (m) => m.alive && m.side === sideState.side && m.role === 'officer' && m.hex,
      ) || cmd
    if (dead && anchor?.hex && placeRaisedUnit(dead, models, map, anchor.hex, dead.toughness || 2)) {
      syncOccupants(map, models)
    }
  } else if (abilityName === 'Hydra Wrath') {
    const beasts = [...radiusFriends]
      .filter(isBeastLike)
      .sort((a, b) => b.hp - a.hp || b.baseDamage - a.baseDamage)
    const primary = beasts[0]
    if (primary) {
      primary._multiStrike = 3
      primary.regenEor = Math.max(primary.regenEor || 0, 2)
      primary._freeAttack = true
      tagAtkBuff(primary, abilityName)
    }
    for (const u of beasts.slice(0, 3)) {
      u.tempDamage += 1
      u.regenEor = Math.max(u.regenEor || 0, 1)
      u._freeAttack = true
      tagAtkBuff(u, abilityName)
    }
  } else if (abilityName === 'Regenerative Surge') {
    const injured = [...radiusFriends]
      .filter((x) => x.hp < x.toughness)
      .sort((a, b) => a.hp / a.toughness - b.hp / b.toughness)
      .slice(0, 3)
    let left = 3
    for (const u of injured) {
      if (left <= 0) break
      u.hp = Math.min(u.toughness, u.hp + 1)
      left--
    }
    while (left > 0) {
      let gave = false
      for (const u of injured) {
        if (left <= 0) break
        if (u.hp < u.toughness) {
          u.hp += 1
          left--
          gave = true
        }
      }
      if (!gave) break
    }
  } else if (abilityName === 'Reposition') {
    const off = models
      .filter((m) => m.alive && m.side === sideState.side && m.role === 'officer' && m.hex)
      .sort((a, b) => a.hp - b.hp)[0]
    const obj = map.objectives?.[0]
    if (off && !off.rootedUntilEor && obj) {
      moveModelToward(map, off, obj, models, 2, { ignoreTerrainCosts: true })
      syncOccupants(map, models)
    }
  } else if (abilityName === 'Serpent Coil') {
    const foe = models
      .filter(
        (m) =>
          m.alive &&
          m.side !== sideState.side &&
          m.hex &&
          caster.hex &&
          hexDist(caster.hex, m.hex) <= 3,
      )
      .sort((a, b) => a.hp - b.hp)[0]
    if (foe) {
      foe.rootedUntilEor = true
      foe.suppressUntilEor = 1
    }
  } else if (abilityName === 'Stone Serpent Stand') {
    for (const u of radiusFriends) {
      u.harden = (u.harden || 0) + 2
      u._tempReach = true
      u.hasPoisonAtk = true
    }
  } else if (abilityName === 'Entangling Roots') {
    const foe = models
      .filter(
        (m) =>
          m.alive &&
          m.side !== sideState.side &&
          m.hex &&
          caster.hex &&
          hexDist(caster.hex, m.hex) <= 4,
      )
      .sort((a, b) => a.hp - b.hp)[0]
    if (foe) {
      foe.rootedUntilEor = true
      foe.tempMove = Math.min(foe.tempMove || 0, -1)
      foe._noFly = true
    }
  } else if (abilityName === 'Gale Reposition') {
    const movers = [...radiusFriends]
      .filter((u) => u.hex && !u.rootedUntilEor)
      .sort((a, b) => a.hp - b.hp)
      .slice(0, 3)
    const obj = map.objectives?.[0]
    for (const u of movers) {
      if (obj) moveModelToward(map, u, obj, models, 2, { ignoreTerrainCosts: true })
    }
    syncOccupants(map, models)
  } else if (abilityName === 'Ancient Canopy Stand') {
    for (const u of radiusFriends.filter(
      (x) => isNatureLike(x) || isRanged(x) || String(x.race || '') === 'Elf',
    )) {
      u.hasStealth = true
      u.hasHarass = true
    }
  } else if (abilityName === 'Rootweave Surge') {
    for (const u of radiusFriends.filter(isNatureLike)) {
      u.hp = Math.min(u.toughness, u.hp + 2)
      u.tempMove += 1
      u._canReposition = true
    }
  } else if (abilityName === 'Forest Unbound') {
    for (const u of radiusFriends.filter(
      (x) =>
        x.tags?.has?.('scout') ||
        hasAbility(x, 'Scout') ||
        x.hasStealth ||
        hasAbility(x, 'Stealth'),
    )) {
      const foe = models
        .filter((m) => m.alive && m.side !== sideState.side && m.hex)
        .sort((a, b) => hexDist(u.hex, a.hex) - hexDist(u.hex, b.hex))[0]
      if (foe) moveModelToward(map, u, foe.hex, models, 3, { ignoreTerrainCosts: true })
      u.hasFrenzy = true
      u._freeAttack = true
      tagAtkBuff(u, abilityName)
    }
    syncOccupants(map, models)
  } else if (abilityName === 'Arc Discharge' || abilityName === "Marshal's Shot") {
    const range = 6
    const foes = models
      .filter(
        (m) =>
          m.alive &&
          m.side !== sideState.side &&
          m.hex &&
          caster.hex &&
          hexDist(caster.hex, m.hex) <= range,
      )
      .sort((a, b) => a.hp - b.hp)
    const target = foes[0]
    if (target) {
      applyIncomingDamage(target, 2, caster, models, map)
      if (!target.alive) {
        const pts = vpForKill(target)
        vp[sideState.side] += pts
        kills[sideState.side].push({ name: target.name, role: target.role, vp: pts })
      }
    }
  } else if (abilityName === 'Hellspark') {
    const rad = cmd?.radius || caster.radius || 6
    const origin = cmd?.hex || caster.hex
    const foes = models
      .filter(
        (m) =>
          m.alive &&
          m.side !== sideState.side &&
          m.hex &&
          origin &&
          hexDist(origin, m.hex) <= rad,
      )
      .sort((a, b) => a.hp - b.hp)
    const target = foes[0]
    if (target) {
      applyIncomingDamage(target, 2, caster, models, map)
      if (target.alive && !hasAbility(target, 'Fearless') && !target._tempFearless) {
        target.fear = true
      }
      if (!target.alive) {
        const pts = vpForKill(target)
        vp[sideState.side] += pts
        kills[sideState.side].push({ name: target.name, role: target.role, vp: pts })
      }
    }
  } else if (abilityName === 'Wyrm Lash') {
    const foes = models
      .filter(
        (m) =>
          m.alive &&
          m.side !== sideState.side &&
          m.hex &&
          caster.hex &&
          hexDist(caster.hex, m.hex) <= 4,
      )
      .sort((a, b) => a.hp - b.hp)
    const target = foes[0]
    if (target) {
      applyIncomingDamage(target, 2, caster, models, map)
      if (!target.alive) {
        const pts = vpForKill(target)
        vp[sideState.side] += pts
        kills[sideState.side].push({ name: target.name, role: target.role, vp: pts })
      }
    }
  } else if (abilityName === 'Anvil Strike') {
    const rad = cmd?.radius || caster.radius || 6
    const origin = cmd?.hex || caster.hex
    const foes = models
      .filter(
        (m) =>
          m.alive &&
          m.side !== sideState.side &&
          m.hex &&
          origin &&
          hexDist(origin, m.hex) <= rad,
      )
      .sort((a, b) => a.hp - b.hp)
    const target = foes[0]
    if (target) {
      applyIncomingDamage(target, 2, caster, models, map)
      if (!target.alive) {
        const pts = vpForKill(target)
        vp[sideState.side] += pts
        kills[sideState.side].push({ name: target.name, role: target.role, vp: pts })
      }
    }
  } else if (abilityName === 'Alpha Rush') {
    const foes = models
      .filter(
        (m) =>
          m.alive &&
          m.side !== sideState.side &&
          m.hex &&
          caster.hex &&
          hexDist(caster.hex, m.hex) <= 3,
      )
      .sort((a, b) => a.hp - b.hp)
    const target = foes[0]
    if (target) {
      applyIncomingDamage(target, 2, caster, models, map)
      const beastAdjacent = radiusFriends.some(
        (u) =>
          u.hex &&
          target.hex &&
          hexDist(u.hex, target.hex) === 1 &&
          (isBeastType(u) || isBeastLike(u) || String(u.race || '') === 'Beastfolk'),
      )
      if (target.alive && beastAdjacent && !hasAbility(target, 'Fearless') && !target._tempFearless) {
        target.fear = true
      }
      if (!target.alive) {
        const pts = vpForKill(target)
        vp[sideState.side] += pts
        kills[sideState.side].push({ name: target.name, role: target.role, vp: pts })
      }
    }
  } else if (abilityName === 'Spear Thrust') {
    const foes = models
      .filter(
        (m) =>
          m.alive &&
          m.side !== sideState.side &&
          m.hex &&
          caster.hex &&
          hexDist(caster.hex, m.hex) <= 3,
      )
      .sort((a, b) => a.hp - b.hp)
    const target = foes[0]
    if (target?.hex) {
      applyIncomingDamage(target, 2, caster, models, map)
      if (!target.alive) {
        const pts = vpForKill(target)
        vp[sideState.side] += pts
        kills[sideState.side].push({ name: target.name, role: target.role, vp: pts })
      }
    }
  } else if (abilityName === 'Siege Barrage') {
    const rad = cmd?.radius || caster.radius || 6
    const origin = cmd?.hex || caster.hex
    const foes = models
      .filter(
        (m) =>
          m.alive &&
          m.side !== sideState.side &&
          m.hex &&
          origin &&
          hexDist(origin, m.hex) <= rad,
      )
      .sort((a, b) => a.hp - b.hp)
      .slice(0, 2)
    for (const target of foes) {
      applyIncomingDamage(target, 1, caster, models, map)
      if (!target.alive) {
        const pts = vpForKill(target)
        vp[sideState.side] += pts
        kills[sideState.side].push({ name: target.name, role: target.role, vp: pts })
      }
    }
  } else if (abilityName === 'Basilisk Glare' || abilityName === 'Grave Bind') {
    const foes = models
      .filter(
        (m) =>
          m.alive &&
          m.side !== sideState.side &&
          m.hex &&
          caster.hex &&
          hexDist(caster.hex, m.hex) <= 3,
      )
      .sort((a, b) => a.hp - b.hp)
    if (foes[0]) foes[0].rootedUntilEor = true
  } else if (abilityName === 'Moonbind') {
    const foes = models
      .filter(
        (m) =>
          m.alive &&
          m.side !== sideState.side &&
          m.hex &&
          caster.hex &&
          hexDist(caster.hex, m.hex) <= 4,
      )
      .sort((a, b) => a.hp - b.hp)
    const target = foes[0]
    if (target) {
      target.slow = true
      target.tempDamage = Math.max((target.tempDamage || 0) - 1, -1)
    }
  } else if (abilityName === 'Forge Mend') {
    const injured = [...radiusFriends]
      .filter(
        (x) =>
          x.hp < x.toughness &&
          (isSiegeLike(x) || String(x.race || '') === 'Dwarf'),
      )
      .sort((a, b) => a.hp / a.toughness - b.hp / b.toughness)
    const u = injured[0]
    if (u) {
      u.hp = Math.min(u.toughness, u.hp + 1)
    }
  } else if (abilityName === 'Kindred Roar') {
    for (const u of radiusFriends.filter(isDragonLike)) {
      u.tempDamage += 1
      u.harden = (u.harden || 0) + 1
    }
  }

  // Attribute later kills / mitigation to cast buffs still on the model.
  const DEF_BUFF_CASTS = new Set([
    'Hold the Line',
    'Line Decree',
    'Harden Order',
    'Harden Decree',
    'Brace Order',
    'Fortify Position',
    'Shield Column',
    'Shield Brotherhood',
    'Shield Host',
    'Scale Ward',
    'Scale Aegis',
    'Sealant Coat',
    'Sealant Field',
    'Anvil Advance',
    'Anvil Push',
    'Stone Line',
    'Stone Host',
    'Holdfast Gate',
    'Hold the Gate',
    'Unbroken Hearth',
    'Hearthbound Stand',
    "Matriarch's Protection",
    'Hoard Claim',
    'Hoard Reckoning',
    'Barrow Ward',
  ])
  const ATK_BUFF_CASTS = new Set([
    'Tribal Hunt',
    'Brood Call',
    'Brood Banner',
    'Kindred Roar',
    'Cannon Drill',
    'Cannon Order',
    'Siege Drill',
    'Overdrive',
    'Overdrive Pulse',
    'Motive Overdrive',
    'Wild Rush',
    'Wild Mandate',
    'Death March',
    'Still March',
    'Still Host March',
    'Cinder March',
    'Blood Frenzy',
    'Ember Mandate',
    'Inferno Mandate',
    'Horn of Advance',
    'Siege Cadence',
    'Hoard Claim',
    'Hoard Reckoning',
    'Spectral Strike',
    'Phantom Rally',
  ])
  // Ember Burst / Inferno Cone tag only the chosen Dragon (see branch above).
  // Free-attack grants (Volley / Arrowstorm / Battery Link / Hydra Wrath) tag only
  // the units that received _freeAttack — see those branches above.
  if (DEF_BUFF_CASTS.has(abilityName)) {
    for (const u of radiusFriends) tagDefBuff(u, abilityName)
  }
  if (ATK_BUFF_CASTS.has(abilityName)) {
    for (const u of radiusFriends) tagAtkBuff(u, abilityName)
  }

  noteAbilityCast(sideState.telemetry, abilityName, caster)
  return true
}

function tryOfficerActives(sideState, company, models, map, rng, abilityMap, kills, vp, round) {
  const officer = company.officerModel
  if (!officer?.alive) return
  // Officers only buff/affect Combat Units of their own company (in CR).
  const members = companyMembers(models, sideState.side, company.id)
  const inRad = members.filter((u) => inRadius(u, officer) && u.alive)

  const cast = (name, chance = 0.75) => {
    if (!hasAbility(officer, name) && officer.ultimate !== name) return false
    if (abilityOnCooldown(officer, name, round)) return false
    if (rng() > chance) return false
    return tryCastAbility({
      caster: officer,
      abilityName: name,
      sideState,
      company,
      models,
      map,
      abilityMap,
      inRad,
      rng,
      kills,
      vp,
      round,
    })
  }

  // Prefer identity actives first so expansion kits actually fire.
  const apPrefs = [
    'Fortify Works',
    'Hold Works',
    'Entrench',
    'Hold the Gate',
    'Gate Decree',
    'Stoneworks',
    'Refresh Works',
    'Anvil Advance',
    'Anvil Push',
    'Holdfast',
    'Stone Line',
    'Stone Host',
    'Shield Brotherhood',
    'Shield Host',
    'Harden Order',
    'Harden Decree',
    'Brace Order',
    'Fortify Position',
    'Battery Link',
    'Battery Volley',
    'Lockstep',
    'Lockstep Doctrine',
    'Motive Overdrive',
    'Overdrive',
    'Overdrive Pulse',
    'Sealant Coat',
    'Sealant Field',
    'Rebuild Protocol',
    'Rebuild Signal',
    'Repair Rites',
    'Cannon Drill',
    'Siege Drill',
    'Raise Thrall',
    'Raise Host',
    'Death March',
    'Still Host March',
    'Soul Tithe',
    'Soul Levy',
    'Mass Fear',
    'Dread Wave',
    'Pack Reform',
    'Pack Hunt',
    'Tribal Hunt',
    'Alpha Mark',
    'Pack Mark',
    'Wild Rush',
    'Wild Mandate',
    'Spur Order',
    'Blood Offering',
    'Blood Frenzy',
    'Ember Burst',
    'Ember Mandate',
    'Brood Call',
    'Brood Banner',
    'Scale Ward',
    'Scale Aegis',
    'Battle Orders',
    'Press Forward',
    'Hold the Line',
    'Line Decree',
    'Haul Lines',
    'Haul Order',
    'Limber Up',
    'Siege Elevation',
    'Elevation Order',
    'Spanned Shot',
    'Inferno Cone',
    'Inferno Mandate',
    'Howl',
    'Alpha Howl Call',
    "Beastmaster's Call",
    'Beast Banner',
    'Draft Beasts',
    'Beast Haul',
    'Flank Sweep',
    'Totem Pulse',
    'Withering Gaze',
    'Wither Gaze',
    'Snare',
    'Bone Prison',
    'Decay',
    "Reaper's Touch",
    'Barrow Ward',
    'Necrotic Bolt',
    'Crypt Demolish',
    'Crypt Claim',
    'Crypt Discipline',
    'Scorch Mark',
    'Scorch Decree',
    'Terror Dive',
    'Terror Mandate',
    'Wing Buffet',
    'Wing Gust',
    'Moonbind',
    'Basilisk Glare',
    'Grave Bind',
    'Arc Discharge',
    'Hellspark',
    "Marshal's Shot",
    'Wyrm Lash',
    'Anvil Strike',
    'Alpha Rush',
    'Spear Thrust',
    'Siege Barrage',
    'Forge Mend',
    'Magnetic Line',
    'Null Pulse',
    'Null Suppress',
    'Sappers',
    'Breach Order',
    'Medic',
    'Repair',
    'Siege Repair',
    'Blood Offering',
    'Suppressive Fire',
    'Coordinated Volley',
    'Rapid Redeployment',
  ]
  for (const name of apPrefs) {
    // Normalized cast AI — preference lists only, not race power dials.
    const chance = /Fortify|Entrench|Hold the Gate|Gate Decree|Stoneworks|Battery|Rebuild|Raise Thrall|Raise Host|Sealant|Anvil|Stone Line|Stone Host|Hold Works/.test(
      name,
    )
      ? 0.75
      : 0.7
    cast(name, chance)
  }
  cast('Forced March', 0.65)

  const ccPrefs = [
    'Battle Cry',
    'Horn of Advance',
    'Shield Column',
    'Cinder March',
    'Directive Tempo',
    'Summit Currents',
    'Poison Tide',
    'Rally',
  ]
  for (const name of ccPrefs) {
    if (sideState.cc >= 2 || name === 'Rally') {
      cast(name, 0.7)
    }
  }
  if (officer.ultimate) cast(officer.ultimate, 0.5)
}

function tryUnitActives(sideState, company, models, map, rng, abilityMap, kills, vp, round) {
  const members = companyMembers(models, sideState.side, company.id).filter((u) => u.alive && u.hex)
  if (!members.length) return

  const cast = (unit, name, chance = 0.55) => {
    if (!hasAbility(unit, name)) return false
    if (abilityOnCooldown(unit, name, round)) return false
    if (rng() > chance) return false
    // Unit-range abilities build their own pool inside tryCastAbility; inRad unused.
    return tryCastAbility({
      caster: unit,
      abilityName: name,
      sideState,
      company,
      models,
      map,
      abilityMap,
      inRad: [],
      rng,
      kills,
      vp,
      round,
    })
  }

  for (const u of members) {
    // Prefer heal when wounded allies are nearby; sacrifice only when company is hurt.
    cast(u, 'Heal', 0.7)
    cast(u, 'Soul Offering', 0.45)
    cast(u, 'Flesh Tithe', 0.45)
  }
}

/** Targets in range that this attacker may legally strike right now. */
function validAttackTargets(attacker, models, preferred = null) {
  const range = effectiveRange(attacker)
  const isRanged = (attacker.range || 1) >= 2
  return models
    .filter((m) => {
      if (!m.alive || m.side === attacker.side || !m.hex || !attacker.hex) return false
      const dist = hexDist(attacker.hex, m.hex)
      if (dist > range) return false
      if (!canTarget(attacker, m, dist)) return false
      if (m.hasStealth && !m.attackedThisRound && isRanged && dist >= 2) return false
      return true
    })
    .sort((a, b) => {
      // Keep preferred primary first, then weakest / nearest.
      if (preferred) {
        if (a.id === preferred.id) return -1
        if (b.id === preferred.id) return 1
      }
      return a.hp - b.hp || hexDist(attacker.hex, a.hex) - hexDist(attacker.hex, b.hex)
    })
}

/**
 * Cleave: split Damage among up to Damage targets (≥1 each).
 * e.g. Damage 3 → [3], [2,1], or [1,1,1]. Assignments declared before Hit rolls.
 * AI packs kills greedily (weakest first), then dumps remainder on the focus target.
 */
function planCleaveAssignments(attacker, preferred, models, totalDmg) {
  if (totalDmg <= 0) return []
  const foes = validAttackTargets(attacker, models, preferred)
  if (!foes.length) return []

  const maxTargets = Math.min(totalDmg, foes.length)
  const chosen = foes.slice(0, maxTargets)
  const alloc = new Map(chosen.map((t) => [t.id, 0]))
  let remaining = totalDmg

  // Seed 1 damage on each chosen target (required minimum).
  for (const t of chosen) {
    alloc.set(t.id, 1)
    remaining -= 1
  }

  // Spend remaining to finish kills (weakest / preferred first).
  const order = [...chosen].sort((a, b) => {
    if (preferred) {
      if (a.id === preferred.id) return -1
      if (b.id === preferred.id) return 1
    }
    return a.hp - b.hp
  })
  for (const t of order) {
    if (remaining <= 0) break
    const have = alloc.get(t.id)
    const need = Math.max(0, t.hp - have)
    if (need <= 0) continue
    const add = Math.min(need, remaining)
    alloc.set(t.id, have + add)
    remaining -= add
  }

  // Dump any leftover on preferred (or first chosen).
  if (remaining > 0) {
    const dump = preferred && alloc.has(preferred.id) ? preferred : chosen[0]
    alloc.set(dump.id, alloc.get(dump.id) + remaining)
  }

  return chosen
    .map((t) => ({ target: t, dmg: alloc.get(t.id) }))
    .filter((a) => a.dmg > 0)
}

function applyOnHitEffects(attacker, defender) {
  if (attacker.hasPoisonAtk || hasAbility(attacker, 'Poison')) {
    if (defender.alive && defender.poisonTokens < 1) defender.poisonTokens += 1
  }
  if (
    (hasAbility(attacker, 'Fear') || attacker._terrorFear) &&
    defender.alive &&
    !hasAbility(defender, 'Fearless') &&
    !defender._tempFearless
  ) {
    defender.fear = true
  }
  // Slow status: only enemy Combat Units with Slow apply it on a successful attack.
  if (
    attacker.role === 'unit' &&
    hasAbility(attacker, 'Slow') &&
    defender.alive &&
    defender.side !== attacker.side
  ) {
    defender.slow = true
  }
}

function resolveStrike(
  attacker,
  defender,
  dmg,
  models,
  map,
  sideState,
  kills,
  vp,
  rng,
  sides = null,
  opts = {},
) {
  const { declare = true, allowRetaliate = true } = opts
  if (!defender.alive || dmg <= 0) return { hit: false, dmg: 0, killed: false }

  // May spend AP for Brace/Evade (lasting) or Retaliate (immediate, once/round).
  let willRetaliate = false
  if (declare) {
    const choice = declareDefenseReaction(defender, attacker, models, sides, rng, map)
    willRetaliate = allowRetaliate && choice === 'retaliate'
  }

  const dist = Math.max(1, Math.round(hexDist(attacker.hex, defender.hex)))
  const need = hitRequirement(attacker, defender, dist, models, map)
  const roll = rollHitSum(rng)
  const atkCombat = sideState?.combat || null
  const defCombat = sides?.[defender.side]?.combat || null
  const tel = sideState?.telemetry || sides?.A?.telemetry || null
  if (roll < need) {
    // Retaliate is simultaneous with being attacked — still fires on a miss.
    if (willRetaliate) {
      resolveRetaliate(defender, attacker, models, map, sideState, kills, vp, rng, sides)
    }
    recordStrikeCombat(
      atkCombat,
      defCombat,
      {
        hit: false,
        need,
        roll,
        dmg: 0,
        killed: false,
        role: defender.role,
        isRetaliate: false,
      },
      tel,
      attacker,
      defender,
    )
    return { hit: false, dmg: 0, killed: false }
  }

  const hpBefore = defender.hp
  let strikeDmg = dmg + siegeBonusVsFortified(attacker, map, defender.hex)
  const dealt = applyIncomingDamage(defender, strikeDmg, attacker, models, map)
  const rawHit = defender._lastRaw ?? strikeDmg
  const mitHit = defender._lastMitigated ?? Math.max(0, strikeDmg - dealt)

  if (dealt > 0 && hasAbility(attacker, 'Siege') && isHexFortified(map, defender.hex)) {
    demolishFortification(map, defender.hex, { models, sideState })
  }

  // Commander ability Counterattack: free rebound if still alive (not AP Retaliate).
  if (defender._counterattack && attacker.alive && defender.alive) {
    const back = Math.max(1, effectiveDamage(defender, models, attacker, map))
    applyIncomingDamage(attacker, back, defender, models, map)
  }

  // AP Retaliate: immediate / simultaneous with this attack.
  if (willRetaliate) {
    resolveRetaliate(defender, attacker, models, map, sideState, kills, vp, rng, sides)
  }

  let killed = false
  if (!defender.alive) {
    killed = true
    const pts = vpForKill(defender)
    vp[sideState.side] += pts
    kills[sideState.side].push({ name: defender.name, role: defender.role, vp: pts })
    if (atkCombat) atkCombat.killVp += pts
    if (defender.hex) {
      const cell = map.cells.get(hexKey(defender.hex.q, defender.hex.r))
      if (cell?.occupant === defender.id) cell.occupant = null
    }
    if (attacker.hasFrenzy || hasAbility(attacker, 'Frenzy')) attacker._bonusAttack = true
    // Tyrant Tithe: each kill in CR → +1 CC (no per-round cap).
    if (sides) {
      const cmd = models.find(
        (m) => m.alive && m.side === sideState.side && m.role === 'commander',
      )
      if (
        cmd &&
        hasAbility(cmd, 'Tyrant Tithe') &&
        defender.hex &&
        cmd.hex &&
        hexDist(cmd.hex, defender.hex) <= (cmd.radius || 6)
      ) {
        sideState.cc += 1
      }
    }
    // Soul Tithe: friendly unit death in CR → that company gains 1 AP.
    if (sides && defender.role === 'unit' && defender.companyId != null) {
      const victimSide = sides[defender.side]
      const tithed =
        victimSide &&
        (victimSide._soulTitheArmy || victimSide._soulTitheCompanyId === defender.companyId)
      if (tithed) {
        const cmd = models.find(
          (m) => m.alive && m.side === defender.side && m.role === 'commander' && m.hex,
        )
        const officer = officerOf(models, defender.side, defender.companyId)
        const inCr =
          (cmd && inRadius(defender, cmd)) || (officer && inRadius(defender, officer))
        if (inCr) {
          const co = victimSide.companies?.find((c) => c.id === defender.companyId)
          if (co) co.ap += 1
        }
      }
    }
    // Soul Harvest: any death in CR → attacker side gains CC or heals
    if (sides && sideState._soulHarvestActive && defender.hex) {
      const harvesterCmd = models.find(
        (m) => m.alive && m.side === sideState.side && m.role === 'commander' && m.hex,
      )
      if (harvesterCmd && hexDist(harvesterCmd.hex, defender.hex) <= (harvesterCmd.radius || 6)) {
        // Prefer CC gain if CC is low, otherwise heal
        if (sideState.cc < 3) {
          sideState.cc += 1
        } else {
          const injured = models
            .filter(
              (u) =>
                u.alive &&
                u.side === sideState.side &&
                u.hp < u.toughness &&
                u.hex &&
                hexDist(harvesterCmd.hex, u.hex) <= (harvesterCmd.radius || 6),
            )
            .sort((a, b) => a.hp / a.toughness - b.hp / b.toughness)[0]
          if (injured) {
            injured.hp = Math.min(injured.toughness, injured.hp + 1)
          } else {
            sideState.cc += 1
          }
        }
      }
    }
    if (
      killed &&
      hasAbility(attacker, 'Overpenetrate') &&
      !hasAbility(attacker, 'Blast') &&
      attacker.hex &&
      defender.hex
    ) {
      let leftover = Math.max(0, strikeDmg - hpBefore)
      let through = { ...defender.hex }
      const origin = attacker.hex
      while (leftover > 0) {
        const behind = hexBehind(origin, through)
        if (!behind || !inBounds(behind)) break
        const occ = models.find(
          (m) => m.alive && m.hex && m.hex.q === behind.q && m.hex.r === behind.r,
        )
        if (!occ) {
          through = behind
          continue
        }
        if (occ.side === attacker.side || occ.role === 'commander') break
        const pierceDist = Math.max(1, Math.round(hexDist(origin, occ.hex)))
        const pierceNeed = hitRequirement(attacker, occ, pierceDist, models, map)
        const pierceRoll = rollHitSum(rng)
        if (pierceRoll < pierceNeed) {
          recordStrikeCombat(
            atkCombat,
            sides?.[occ.side]?.combat || null,
            {
              hit: false,
              need: pierceNeed,
              roll: pierceRoll,
              dmg: 0,
              killed: false,
              role: occ.role,
              isRetaliate: false,
            },
            tel,
            attacker,
            occ,
          )
          break
        }
        const pierceHp = occ.hp
        applyIncomingDamage(occ, leftover, attacker, models, map)
        const pierceKill = !occ.alive
        if (pierceKill) {
          const nPts = vpForKill(occ)
          vp[sideState.side] += nPts
          kills[sideState.side].push({ name: occ.name, role: occ.role, vp: nPts })
          if (atkCombat) atkCombat.killVp += nPts
        }
        recordStrikeCombat(
          atkCombat,
          sides?.[occ.side]?.combat || null,
          {
            hit: true,
            need: pierceNeed,
            roll: pierceRoll,
            dmg: leftover,
            killed: pierceKill,
            role: occ.role,
            isRetaliate: false,
          },
          tel,
          attacker,
          occ,
        )
        if (!pierceKill) break
        leftover = Math.max(0, leftover - pierceHp)
        through = { ...occ.hex }
      }
    }
    if ((hasAbility(attacker, 'Trample') || attacker._tempTrample) && dist === 1 && defender.hex) {
      const dest = defender.hex
      const blocked = models.some(
        (m) => m.alive && m.hex && m.hex.q === dest.q && m.hex.r === dest.r,
      )
      if (!blocked) {
        attacker.hex = { ...dest }
        syncOccupants(map, models)
      }
      const leftover = Math.max(0, dmg - hpBefore)
      if (leftover > 0 && attacker.hex) {
        const next = models
          .filter(
            (m) =>
              m.alive &&
              m.side !== attacker.side &&
              m.hex &&
              hexDist(attacker.hex, m.hex) === 1,
          )
          .sort((a, b) => a.hp - b.hp)[0]
        if (next) {
          const splashNeed = hitRequirement(attacker, next, 1, models, map)
          const splashRoll = rollHitSum(rng)
          if (splashRoll >= splashNeed) {
            const splashDmg = leftover
            applyIncomingDamage(next, splashDmg, attacker, models, map)
            const splashKill = !next.alive
            if (splashKill) {
              const nPts = vpForKill(next)
              vp[sideState.side] += nPts
              kills[sideState.side].push({ name: next.name, role: next.role, vp: nPts })
              if (atkCombat) atkCombat.killVp += nPts
            }
            recordStrikeCombat(
              atkCombat,
              sides?.[next.side]?.combat || null,
              {
                hit: true,
                need: splashNeed,
                roll: splashRoll,
                dmg: splashDmg,
                killed: splashKill,
                role: next.role,
                isRetaliate: false,
              },
              tel,
              attacker,
              next,
            )
          } else {
            recordStrikeCombat(
              atkCombat,
              sides?.[next.side]?.combat || null,
              {
                hit: false,
                need: splashNeed,
                roll: splashRoll,
                dmg: 0,
                killed: false,
                role: next.role,
                isRetaliate: false,
              },
              tel,
              attacker,
              next,
            )
          }
        }
      }
    }
  }

  recordStrikeCombat(
    atkCombat,
    defCombat,
    {
      hit: true,
      need,
      roll,
      dmg: dealt,
      killed,
      role: defender.role,
      isRetaliate: false,
      raw: rawHit,
      mitigated: mitHit,
    },
    tel,
    attacker,
    defender,
  )
  applyOnHitEffects(attacker, defender)
  // Brace/Evade persist — do not clear here (cleared on activation or new round).
  return { hit: true, dmg: dealt, killed }
}

function resolveAttack(attacker, defender, models, map, sideState, company, kills, vp, rng, sides = null) {
  if (attacker._noAttack || attacker._bonePrisoned || !attacker.hex || !defender?.hex) return null

  // One declared attack per activation/turn unless an explicit extra is granted
  // (Frenzy bonus, ability free attack, Trample continuation).
  const isExtra = !!attacker._allowExtraAttack
  if (attacker._allowExtraAttack) attacker._allowExtraAttack = false
  if (attacker._attackedThisAct && !isExtra) return null
  if (attacker.role === 'commander' && attacker.attackedThisRound && !isExtra) return null

  const dist = Math.max(1, Math.round(hexDist(attacker.hex, defender.hex)))
  const range = effectiveRange(attacker)
  if (dist > range) return null
  if (!canTarget(attacker, defender, dist)) return null
  if (defender.hasStealth && !defender.attackedThisRound && (attacker.range || 1) >= 2 && dist >= 2) {
    return null
  }

  let pool = effectiveDamage(attacker, models, defender, map)
  if (pool <= 0) return null

  // Hex Pressure: magic/nature get +1 Hit vs enemies in difficult terrain.
  if (attacker._hexPressure && map && defender.hex) {
    const cell = map.cells.get(hexKey(defender.hex.q, defender.hex.r))
    if (cell && (cell.terrain === 'forest' || cell.terrain === 'swamp' || cell.terrain === 'desert' || cell.terrain === 'water')) {
      attacker._hexPressureOn = true
    }
  }

  const blastR = blastRadiusOf(attacker)
  let assignments
  if (hasAbility(attacker, 'Cleave')) {
    assignments = planCleaveAssignments(attacker, defender, models, pool)
  } else if (blastR > 0) {
    assignments = planBlastAssignments(attacker, defender, models, pool, blastR)
  } else {
    assignments = [{ target: defender, dmg: pool }]
  }
  if (!assignments.length) return null

  const strikes = (() => {
    if (hasAbility(attacker, 'Cleave') || blastR > 0) return 1
    if (attacker._multiStrike > 0) return attacker._multiStrike
    if (hasAbility(attacker, 'MultiStrike')) return 2
    return 1
  })()
  let total = 0
  let anyHit = false
  let anyKill = false

  for (let s = 0; s < strikes; s++) {
    for (const { target, dmg } of assignments) {
      if (!target.alive) continue
      const result = resolveStrike(
        attacker,
        target,
        dmg,
        models,
        map,
        sideState,
        kills,
        vp,
        rng,
        sides,
        {
          // Declare once per attack declaration; Brace/Evade then cover later MultiStrike hits.
          // Blast splash: only primary declares reactions; splash does not Retaliate.
          declare: s === 0 && target.id === defender.id,
          allowRetaliate: s === 0 && target.id === defender.id,
        },
      )
      if (result.hit) {
        anyHit = true
        total += result.dmg
      }
      if (result.killed) anyKill = true
    }
  }

  attacker._attackedThisAct = true
  attacker.attackedThisRound = true
  if (blastR > 0) attacker._blastRadius = 0
  // Harass: after attacking (hit or miss), may Move 1 (ignores Disengagement/Guard).
  tryHarassStep(attacker, defender, models, map)
  if (!anyHit) return { hit: false }
  return { hit: true, dmg: total, killed: anyKill }
}

/**
 * Post-attack skirmish step: Move 1 into an empty hex, preferring greater distance from the target.
 */
function tryHarassStep(attacker, primaryTarget, models, map) {
  if (!attacker?.alive || !attacker.hex) return false
  if (!(attacker.hasHarass || hasAbility(attacker, 'Harass'))) return false
  const occ = new Set(
    models.filter((m) => m.alive && m.hex && m.id !== attacker.id).map((m) => hexKey(m.hex.q, m.hex.r)),
  )
  const from = attacker.hex
  const aim = primaryTarget?.hex || from
  const candidates = neighbors(from)
    .filter((h) => inBounds(h) && !occ.has(hexKey(h.q, h.r)) && canOccupyHex(map, h, attacker, { ignoreTerrainCosts: true }))
    .map((h) => ({ h, dist: hexDist(h, aim) }))
    .sort((a, b) => b.dist - a.dist || rngLex(a.h, b.h))
  if (!candidates.length) return false
  // Prefer stepping away; accept any legal step if all are equal/closer.
  const best = candidates[0]
  if (best.dist < hexDist(from, aim) && candidates.every((c) => c.dist <= hexDist(from, aim))) {
    // all options closer or equal — still take the least-worse (max dist)
  }
  // Free Move 1: ignores printed terrain costs (Harass).
  attacker.hex = { q: best.h.q, r: best.h.r }
  attacker.movedThisAct = (attacker.movedThisAct || 0) + 1
  if (map) syncOccupants(map, models)
  return true
}

function rngLex(a, b) {
  return a.q - b.q || a.r - b.r
}

function activateCompany(sideState, company, models, map, rng, abilityMap, kills, vp, round, sides = null) {
  const officer = company.officerModel
  if (!officer?.alive) return { moved: 0, attacks: 0 }
  if (company.activatedThisRound) return { moved: 0, attacks: 0 }
  if (sideState.cc < OFFICER_ACTIVATE_CC) return { moved: 0, attacks: 0 }
  sideState.cc -= OFFICER_ACTIVATE_CC
  company.activatedThisRound = true

  const members = companyMembers(models, sideState.side, company.id)
  for (const u of members) {
    // Brace/Evade end when the unit activates (or at round refresh — whichever first).
    clearLastingDefense(u)
    u.movedThisAct = 0
    u._attackedThisAct = false
    u._allowExtraAttack = false
    u._bonusAttack = false
    u.isolated = !inRadius(u, officer)
    u._consumeSlow = !!u.slow
    u._noAttack = false
    u._noMove = false
    u._blastRadius = 0
    u._tempRangeBonus = 0
    if (u.poisonTokens > 0) {
      u.hp -= 1
      u.poisonTokens -= 1
      if (u.hp <= 0) {
        u.alive = false
        u.hp = 0
      }
    }
    const buffs = gatherKeywords(u, officer, models, map)
    applyRacialCompactAura(u, models)
    if (buffs.inspiringPresence) {
      // Path/March passives: printed +1 Move (Realmward dial may raise).
      u.tempMove += buffs.pathMoveBonus || 1
    }
  }
  clearLastingDefense(officer)
  officer.movedThisAct = 0
  officer._attackedThisAct = false
  officer._allowExtraAttack = false
  officer._bonusAttack = false

  tryOfficerActives(sideState, company, models, map, rng, abilityMap, kills, vp, round)

  // Company movement (user rule): free in radius; AP if outside radius
  let moved = 0
  for (const u of members.filter((m) => m.alive)) {
    if (u._noMove || u.rootedUntilEor) continue
    const target = pickMoveTarget(u, sideState.side, map, models, officer, rng)
    const inside = inRadius(u, officer)
    if (!inside) {
      const cost = actionApCost(OUT_OF_RADIUS_MOVE_AP, u)
      if (!spendAp(company, cost)) continue
    }
    moveModelToward(map, u, target, models, effectiveMove(u, models, map))
    moved++
    // update isolation after move
    u.isolated = !inRadius(u, officer)
  }
  // Officer also repositions (free with company)
  if (!officer._noMove && !officer.rootedUntilEor) {
    moveModelToward(
      map,
      officer,
      pickMoveTarget(officer, sideState.side, map, models, officer, rng),
      models,
      effectiveMove(officer, models, map),
    )
  }
  syncOccupants(map, models)

  // Officer/ability free attacks (Battery Link, Coordinated Volley, …) fire after move,
  // as extras — they must not replace the company's normal paid attack below.
  resolveSideFreeAttacks(sideState, models, map, kills, vp, rng, sides)

  // Combat: each unit may attack once for Company AP (Frenzy extras excepted)
  let attacks = 0
  const foes = () => models.filter((m) => m.alive && m.side !== sideState.side && m.hex)
  const attackWith = (atk) => {
    if (!atk.alive || !atk.hex) return
    if (atk._attackedThisAct && !atk._bonusAttack) return
    // Frenzy leftover from an earlier free attack: free, no Company AP.
    const frenzyOnly = atk._attackedThisAct && atk._bonusAttack
    if (frenzyOnly) {
      atk._bonusAttack = false
      atk._allowExtraAttack = true
    } else {
      const cost = actionApCost(ATTACK_AP, atk)
      if (!spendAp(company, cost)) return
    }
    const enemies = foes()
    if (!enemies.length) return
    enemies.sort((a, b) => {
      const roleBias = (x) => (x.role === 'unit' ? 0 : x.role === 'officer' ? 1 : 2)
      return (
        hexDist(atk.hex, a.hex) - hexDist(atk.hex, b.hex) ||
        roleBias(a) - roleBias(b) ||
        a.hp - b.hp
      )
    })
    let target = enemies.find(
      (e) => hexDist(atk.hex, e.hex) <= effectiveRange(atk) && canTarget(atk, e, hexDist(atk.hex, e.hex)),
    )
    if (!target) return
    if (atk.role === 'unit' && target.role !== 'unit') {
      const unitTarget = enemies.find(
        (e) =>
          e.role === 'unit' &&
          hexDist(atk.hex, e.hex) <= effectiveRange(atk) &&
          canTarget(atk, e, hexDist(atk.hex, e.hex)),
      )
      if (unitTarget && rng() < 0.7) target = unitTarget
    }
    resolveAttack(atk, target, models, map, sideState, company, kills, vp, rng, sides)
    attacks++
    // Frenzy: free bonus attack after a destroy (matches play / keyword).
    if (atk._bonusAttack) {
      atk._bonusAttack = false
      const more = foes().filter(
        (e) =>
          hexDist(atk.hex, e.hex) <= effectiveRange(atk) &&
          canTarget(atk, e, hexDist(atk.hex, e.hex)),
      )
      if (more.length) {
        more.sort((a, b) => a.hp - b.hp)
        atk._allowExtraAttack = true
        resolveAttack(atk, more[0], models, map, sideState, company, kills, vp, rng, sides)
        attacks++
      }
    }
  }

  for (const u of members.filter((m) => m.alive)) attackWith(u)
  // Officer may attack if has damage
  if (officer.baseDamage > 0) attackWith(officer)

  // Unit actives (Heal / sacrifice) after combat so wounded allies can be restored.
  tryUnitActives(sideState, company, models, map, rng, abilityMap, kills, vp, round)

  for (const u of members) {
    if (u._consumeSlow) u.slow = false
  }

  return { moved, attacks }
}

function resolveSideFreeAttacks(sideState, models, map, kills, vp, rng, sides = null) {
  for (const u of models.filter((m) => m.alive && m.side === sideState.side && m.hex)) {
    while (u._freeAttack || u._extraFreeAttack) {
      // Attack-locked (Bone Prison, Suppress attack lock, etc.) cannot take free strikes.
      if (u._noAttack || u._bonePrisoned) {
        u._freeAttack = false
        u._extraFreeAttack = false
        break
      }
      const foes = models.filter((m) => m.alive && m.side !== sideState.side && m.hex)
      const t = foes
        .filter(
          (f) =>
            hexDist(u.hex, f.hex) <= effectiveRange(u) &&
            canTarget(u, f, hexDist(u.hex, f.hex)),
        )
        .sort((a, b) => a.hp - b.hp)[0]
      if (u._freeAttack) u._freeAttack = false
      else u._extraFreeAttack = false
      if (!t) break
      // Ability free attacks are bonus declarations (Wild Hunt, Tribal Convergence, …).
      u._allowExtraAttack = true
      resolveAttack(u, t, models, map, sideState, null, kills, vp, rng, sides)
      // Do not consume the unit's later company/commander act attack.
      u._attackedThisAct = false
      // Frenzy from a free-attack kill: take the bonus strike now, still leave act attack free.
      if (u._bonusAttack) {
        u._bonusAttack = false
        const more = foes.filter(
          (f) =>
            f.alive &&
            f.hex &&
            hexDist(u.hex, f.hex) <= effectiveRange(u) &&
            canTarget(u, f, hexDist(u.hex, f.hex)),
        )
        if (more.length) {
          more.sort((a, b) => a.hp - b.hp)
          u._allowExtraAttack = true
          resolveAttack(u, more[0], models, map, sideState, null, kills, vp, rng, sides)
          u._attackedThisAct = false
        }
      }
    }
  }
}

/**
 * Commander active/ultimate casts (AP/CC). Used on activation normally, or anytime when
 * dial commander-cast-anytime is on.
 */
function tryCommanderCasts(sideState, models, map, rng, kills, vp, abilityMap, round, sides = null) {
  const cmd = models.find((m) => m.alive && m.side === sideState.side && m.role === 'commander')
  if (!cmd?.hex) return false
  const inRad = friendsInCommanderRadius(models, cmd)
  for (const u of inRad) applyRacialCompactAura(u, models)
  applyRacialCompactAura(cmd, models)

  const cast = (name, chance = 0.8) => {
    if (!hasAbility(cmd, name) && cmd.ultimate !== name) return false
    if (abilityOnCooldown(cmd, name, round)) return false
    if (rng() > chance) return false
    return tryCastAbility({
      caster: cmd,
      abilityName: name,
      sideState,
      company: null,
      models,
      map,
      abilityMap,
      inRad,
      rng,
      kills,
      vp,
      round,
    })
  }

  // Signature kits (~0.7) — cast AI preference only, not printable power dials.
  cast('Rally', 0.7)
  cast('Shield Column', 0.7)
  cast('Hearthbound Stand', 0.7)
  cast('Unbroken Hearth', 0.7)
  cast('Realmward Unity', 0.7)
  cast('Iron Covenant Charge', 0.6)
  cast('Line Decree', 0.7)
  cast('Battle Cry', 0.7)
  cast('Horn of Advance', 0.7)
  cast('Covenant Drill', 0.75)
  cast('Focused Assault', 0.7)
  cast('Last Stand', 0.55)
  cast('Thunder Stampede', 0.6)
  cast('Tactical Withdrawal', 0.7)
  cast('Arrowstorm Command', 0.7)
  cast('Moonlit Volley', 0.7)
  cast('Cinder March', 0.7)
  cast('Directive Tempo', 0.7)
  cast('Summit Currents', 0.7)
  cast('Repair Rites', 0.75)
  cast('Alpha Rush', 0.65)
  cast('Arc Discharge', 0.7)
  cast('Hellspark', 0.7)
  cast('Wyrm Lash', 0.7)
  cast('Kindred Roar', 0.7)
  cast('Anvil Strike', 0.7)
  cast("Marshal's Shot", 0.7)
  cast('Moonbind', 0.65)
  cast('Basilisk Glare', 0.65)
  cast('Grave Bind', 0.65)
  cast('Siege Barrage', 0.7)
  cast('Spear Thrust', 0.65)
  cast('Forge Mend', 0.7)
  cast('Blood Lottery', 0.65)
  cast('Abyssal Onslaught', 0.55)
  cast('Void Torment', 0.55)
  cast('Overwhelming Offensive', 0.55)
  cast('Overwhelming Inferno', 0.55)
  cast('Call Reinforcements', 0.45)
  cast('Apocalypse Cry', 0.8)
  cast('Counterattack', 0.7)
  cast('Infernal Rush', 0.7)
  cast('Hellfire Press', 0.7)
  cast('Poison Tide', 0.7)
  cast('Fen Unity', 0.5)
  cast('Fenbrood Drum', 0.5)
  cast('Hydra Wrath', 0.5)
  cast('Regenerative Surge', 0.7)
  cast('Reposition', 0.65)
  cast('Serpent Coil', 0.7)
  cast('Stone Serpent Stand', 0.5)
  cast('Entangling Roots', 0.7)
  cast('Gale Reposition', 0.65)
  cast('Ancient Canopy Stand', 0.5)
  cast('Rootweave Surge', 0.5)
  cast('Forest Unbound', 0.5)
  cast('Fortify Works', 0.75)
  cast('Hold the Gate', 0.75)
  cast('Holdfast Gate', 0.75)
  cast('Anvil Advance', 0.7)
  cast('Cannon Drill', 0.7)
  cast('Cannon Order', 0.7)
  cast('Raise Thrall', 0.75)
  cast('Gravespan Call', 0.75)
  cast('Soul Tithe', 0.8)
  cast('Host Tithe', 0.8)
  cast('Death March', 0.7)
  cast('Still March', 0.7)
  cast('Mass Fear', 0.55)
  cast('Dread Wave', 0.55)
  cast('Withering Gaze', 0.65)
  cast('Crypt Demolish', 0.65)
  cast('Shadow Orb', 0.7)
  cast('Spectral Strike', 0.7)
  cast('Soul Harvest', 0.75)
  cast('Phantom Rally', 0.7)
  cast('Grave Fortify', 0.65)
  cast('Siege Cadence', 0.7)
  cast('Unbreakable Hold', 0.7)
  cast('Depth Charge', 0.7)
  cast('Anvil Decree', 0.7)
  cast("Korrik's Stand", 0.7)
  cast('Full Rebuild', 0.7)
  cast('Prime Protocol', 0.7)
  cast('Lockstep Barrage', 0.7)
  cast('Null Field', 0.7)
  cast('Sky Tyrant', 0.7)
  cast("Tyrant's Command", 0.7)
  cast('Cataclysm Breath', 0.5)
  {
    const held = countOccupiedObjectives(map, models, sideState.side)
    if (held >= 2) cast('Hoard Claim', 0.7)
    else if (held >= 1 && round >= 5) cast('Hoard Claim', 0.5)
  }
  cast('Gravemind', 0.5)
  cast('Eclipse of Fear', 0.5)
  cast('Still Host Rise', 0.5)
  cast('Bone Harvest', 0.5)
  cast('Blood Moon', 0.5)
  cast('Tribal Convergence', 0.5)
  cast('Wild Hunt', 0.5)
  cast('Alpha Howl', 0.5)
  cast('Tribal Cadence', 0.7)
  cast("Matriarch's Protection", 0.7)
  if (cmd.ultimate && cmd.ultimate !== 'Hoard Claim') cast(cmd.ultimate, 0.5)

  // Cast remaining commander AP/CC kit abilities (army-in-CR variants).
  for (const name of cmd.abilities || []) {
    if (!name || name === cmd.ultimate) continue
    const def = abilityMap.get(name)
    if (!def || def.type === 'Passive' || def.type === 'Ultimate') continue
    cast(name, 0.7)
  }

  // Instant free attacks from casts (Wild Hunt, Arrowstorm, …) resolve immediately.
  resolveSideFreeAttacks(sideState, models, map, kills, vp, rng, sides)
  return true
}

function activateCommander(sideState, models, map, rng, kills, vp, abilityMap, round, sides = null) {
  if (sideState.commanderActivatedThisRound) return false
  const cmd = models.find((m) => m.alive && m.side === sideState.side && m.role === 'commander')
  if (!cmd) return false
  sideState.commanderActivatedThisRound = true
  clearLastingDefense(cmd)
  cmd.movedThisAct = 0
  cmd._attackedThisAct = false
  cmd._allowExtraAttack = false
  cmd._bonusAttack = false
  const consumeSlow = !!cmd.slow
  const inRad = friendsInCommanderRadius(models, cmd)
  for (const u of inRad) {
    applyRacialCompactAura(u, models)
  }
  applyRacialCompactAura(cmd, models)

  // Default: casts only on activation. Dial: casts already spent anytime during officer phase.
  if (!dialEffects().commanderCastAnytime) {
    tryCommanderCasts(sideState, models, map, rng, kills, vp, abilityMap, round, sides)
  }

  // Canopy Veil: Passive — always on while commander lives
  if (hasAbility(cmd, 'Canopy Veil')) {
    for (const u of inRad) {
      if (u.tags.has('scout') || u.hasStealth || hasAbility(u, 'Stealth')) u.tempMove += 1
    }
  }

  // Petrifying Gaze Field: enemies in radius risk Fear (morale approx; not Slow)
  if (hasAbility(cmd, 'Petrifying Gaze Field')) {
    for (const e of models.filter(
      (m) =>
        m.alive &&
        m.side !== sideState.side &&
        m.hex &&
        hexDist(cmd.hex, m.hex) <= (cmd.radius || 6),
    )) {
      if (hasAbility(e, 'Fearless') || e._tempFearless) continue
      if (rng() < 0.55) e.fear = true
    }
  }

  // Sturdy Bones: Passive — Undead in CR gain +1 Toughness
  if (hasAbility(cmd, 'Sturdy Bones')) {
    for (const u of inRad.filter(isUndeadLike)) {
      if (!u._sturdyBonesApplied) {
        u.toughness = (u.toughness || 1) + 1
        u.hp = Math.min(u.hp + 1, u.toughness)
        u._sturdyBonesApplied = true
      }
    }
  }

  // Crypt Commander: Passive — Infantry/Heavy in CR gain +1 Damage
  if (hasAbility(cmd, 'Crypt Commander')) {
    for (const u of inRad) {
      if ((isInfantryLike(u) || isHeavyLike(u)) && !u._cryptCommanderApplied) {
        u.tempDamage = (u.tempDamage || 0) + 1
        u._cryptCommanderApplied = true
      }
    }
  }

  const target = pickMoveTarget(cmd, sideState.side, map, models, null, rng)
  moveModelToward(map, cmd, target, models, effectiveMove(cmd, models, map))
  if (consumeSlow) cmd.slow = false
  syncOccupants(map, models)

  resolveSideFreeAttacks(sideState, models, map, kills, vp, rng, sides)

  if (cmd.baseDamage > 0 && sideState.commanderAp >= 1 && !cmd.attackedThisRound) {
    const foes = models.filter((m) => m.alive && m.side !== sideState.side && m.hex)
    const t = foes
      .filter(
        (f) =>
          hexDist(cmd.hex, f.hex) <= effectiveRange(cmd) &&
          canTarget(cmd, f, hexDist(cmd.hex, f.hex)),
      )
      .sort((a, b) => a.hp - b.hp)[0]
    if (t) {
      sideState.commanderAp -= 1
      resolveAttack(cmd, t, models, map, sideState, null, kills, vp, rng, sides)
    }
  }
  return true
}

/** Arrive with exactly one reserved officer + their company (if primary objective allows). */
function reinforceCompany(sideState, map, models, reservePackages, rng) {
  if (!reservePackages?.length) return { spent: 0, arrived: [], companyId: null }
  const center = primaryObjective(map)
  const ctrl = objectiveController(map, models, center)
  if (ctrl && ctrl !== sideState.side) return { spent: 0, arrived: [], companyId: null }

  const pkg = reservePackages.shift()
  const arrived = []
  let spent = 0
  const spots = [center, ...neighbors(center).filter(inBounds)]
  const occ = new Set(models.filter((m) => m.alive && m.hex).map((m) => hexKey(m.hex.q, m.hex.r)))

  const placeOne = (model) => {
    for (const spot of shuffleInPlace(rng, [...spots])) {
      const k = hexKey(spot.q, spot.r)
      if (occ.has(k)) continue
      if (!canOccupyHex(map, spot, model)) continue
      model.hex = { q: spot.q, r: spot.r }
      model.alive = true
      resetRoundFlags(model)
      models.push(model)
      occ.add(k)
      spent += model.uv
      arrived.push(model.name)
      noteDeploy(sideState.telemetry, model)
      return true
    }
    return false
  }

  // Officer first, then company models
  const ordered = [...pkg.models].sort((a, b) => {
    if (a.role === 'officer') return -1
    if (b.role === 'officer') return 1
    return 0
  })
  for (const m of ordered) {
    if (!placeOne(m)) {
      // Put unplaced models back into a residual package at front
      const leftover = ordered.filter((x) => !x.hex)
      if (leftover.length) {
        reservePackages.unshift({
          companyId: pkg.companyId,
          uv: leftover.reduce((s, x) => s + x.uv, 0),
          models: leftover,
          names: leftover.map((x) => x.name),
        })
      }
      break
    }
  }
  syncOccupants(map, models)
  return { spent, arrived, companyId: pkg.companyId }
}

function endRound(models, map, vp) {
  for (const m of models) {
    if (!m.alive) continue
    if (m.regenEor || hasAbility(m, 'Regenerate')) {
      const amt = Math.max(m.regenEor || 0, hasAbility(m, 'Regenerate') ? 1 : 0)
      m.hp = Math.min(m.toughness, m.hp + amt)
    }
    // Living Grove handled via regenEor set by aura check each activation; also apply here for nature in radius
  }
  const gained = { A: 0, B: 0 }
  for (const obj of map.objectives) {
    const ctrl = objectiveController(map, models, obj)
    obj.controller = ctrl
    if (ctrl) {
      vp[ctrl] += VP_PER_OBJECTIVE
      gained[ctrl] += VP_PER_OBJECTIVE
    }
  }
  return gained
}

function buildSideState(force, side, models) {
  const companies = []
  for (let i = 0; i < force.officers.length; i++) {
    const officerModel = models.find(
      (m) => m.side === side && m.role === 'officer' && m.companyId === i,
    )
    const oCard = force.officers[i]
    companies.push({
      id: i,
      officerModel,
      ap: 0,
      apMax: oCard.companyAp || 1,
      radius: oCard.commandRadius || 4,
      activatedThisRound: false,
    })
  }
  return {
    side,
    race: force.race,
    cc: 0,
    commanderAp: 0,
    companies,
    ultimateUsed: false,
    strategistAvailable: false,
    commanderActivatedThisRound: false,
    reinforceLeft: REINFORCE_UV,
    reserveCompaniesLeft: 0,
    /** Per-game combat telemetry (attacks, hits, damage, kills, reactions). */
    combat: emptyCombatBucket(),
  }
}

/** Fresh combat counters for one side in one game. */
function emptyCombatBucket() {
  return {
    attacks: 0,
    hits: 0,
    misses: 0,
    damageDealt: 0,
    damageTaken: 0,
    killVp: 0,
    killsByRole: { unit: 0, officer: 0, commander: 0 },
    hitNeedSum: 0,
    hitRollSum: 0,
    reactions: { brace: 0, evade: 0, retaliate: 0 },
    retaliateAttacks: 0,
    retaliateHits: 0,
  }
}

/** Offense-relevant keywords for kill attribution (printed or soft flags). */
const OFFENSE_KEYWORDS = new Set([
  'Charge',
  'Frenzy',
  'Pack',
  'Piercing',
  'Trample',
  'Blast',
  'Cleave',
  'Harass',
  'Poison',
  'MultiStrike',
  'Siege',
  'Flanking',
  'Adaptive Attack',
  'Fear',
  'Slow',
  'Reach',
  'Overpenetrate',
])

function normalizeKeywordName(k) {
  const s = String(k || '')
  const m = /^(.+?) (\d+)$/.exec(s)
  return m ? m[1] : s
}

function emptyMatchTelemetry() {
  return {
    units: new Map(), // name -> combat row
    abilities: new Map(), // name -> { casts, byRole, kills, mitigated }
    keywords: new Map(), // name -> { kills }
    defense: {
      hitsTaken: 0,
      rawDamage: 0,
      dealtDamage: 0,
      mitigated: 0,
      bySource: {
        harden: 0,
        brace: 0,
        evadeDodge: 0,
        shieldwall: 0,
        fortified: 0,
        defender: 0,
        ignoreHit: 0,
        other: 0,
      },
    },
  }
}

function unitTelemetryRow(tel, model) {
  if (!tel || !model?.name) return null
  let row = tel.units.get(model.name)
  if (!row) {
    row = {
      name: model.name,
      race: model.race || '?',
      role: model.role || 'unit',
      deploys: 0,
      deaths: 0,
      kills: 0,
      dmgOut: 0,
      dmgIn: 0,
      attacks: 0,
      hits: 0,
      timesHit: 0,
      timesTargeted: 0,
      rawTaken: 0,
      mitigated: 0,
    }
    tel.units.set(model.name, row)
  }
  return row
}

function abilityImpactRow(tel, abilityName) {
  if (!tel || !abilityName) return null
  let row = tel.abilities.get(abilityName)
  if (!row) {
    row = {
      name: abilityName,
      casts: 0,
      byRole: { commander: 0, officer: 0, unit: 0 },
      kills: 0,
      mitigated: 0,
    }
    tel.abilities.set(abilityName, row)
  }
  return row
}

function noteDeploy(tel, model) {
  const row = unitTelemetryRow(tel, model)
  if (row) row.deploys += 1
}

function noteAbilityCast(tel, abilityName, caster) {
  const row = abilityImpactRow(tel, abilityName)
  if (!row) return
  row.casts += 1
  const role = caster?.role || 'unit'
  if (row.byRole[role] != null) row.byRole[role] += 1
  else row.byRole.unit += 1
}

function tagAtkBuff(unit, abilityName) {
  if (!unit || !abilityName) return
  if (!unit._atkBuffs) unit._atkBuffs = new Set()
  unit._atkBuffs.add(abilityName)
}

function tagDefBuff(unit, abilityName) {
  if (!unit || !abilityName) return
  if (!unit._defBuffs) unit._defBuffs = new Set()
  unit._defBuffs.add(abilityName)
}

function noteAbilityKill(tel, attacker) {
  if (!tel || !attacker?._atkBuffs) return
  for (const name of attacker._atkBuffs) {
    const row = abilityImpactRow(tel, name)
    if (row) row.kills += 1
  }
}

function keywordImpactRow(tel, keywordName) {
  if (!tel || !keywordName) return null
  let row = tel.keywords.get(keywordName)
  if (!row) {
    row = { name: keywordName, kills: 0 }
    tel.keywords.set(keywordName, row)
  }
  return row
}

/** Attribute a kill to offense keywords present on the attacker (printed + soft flags). */
function noteKeywordKill(tel, attacker) {
  if (!tel || !attacker) return
  const seen = new Set()
  for (const k of attacker.keywords || []) {
    const base = normalizeKeywordName(k)
    if (OFFENSE_KEYWORDS.has(base)) seen.add(base)
  }
  const soft = [
    ['Charge', attacker.hasCharge || hasAbility(attacker, 'Charge')],
    ['Frenzy', attacker.hasFrenzy || hasAbility(attacker, 'Frenzy')],
    ['Harass', attacker.hasHarass || hasAbility(attacker, 'Harass')],
    ['Poison', attacker.hasPoisonAtk || hasAbility(attacker, 'Poison')],
    ['Pack', hasAbility(attacker, 'Pack')],
    [
      'Piercing',
      hasAbility(attacker, 'Piercing') ||
        attacker._flankPierce ||
        attacker._tempPiercing ||
        (isSiegeLike(attacker) && (attacker.range || 1) <= 1),
    ],
    ['Trample', hasAbility(attacker, 'Trample') || attacker._tempTrample],
    ['Blast', hasAbility(attacker, 'Blast') || (attacker._blastRadius || 0) > 0],
    ['Cleave', hasAbility(attacker, 'Cleave')],
    ['MultiStrike', hasAbility(attacker, 'MultiStrike') || (attacker._multiStrike || 0) > 0],
    ['Siege', hasAbility(attacker, 'Siege') || attacker._scorchSiege],
    ['Flanking', hasAbility(attacker, 'Flanking') || attacker._tempFlanking],
    ['Adaptive Attack', hasAbility(attacker, 'Adaptive Attack')],
    ['Fear', hasAbility(attacker, 'Fear') || attacker._terrorFear],
    ['Slow', hasAbility(attacker, 'Slow')],
    ['Reach', hasAbility(attacker, 'Reach')],
    ['Overpenetrate', hasAbility(attacker, 'Overpenetrate')],
  ]
  for (const [name, on] of soft) {
    if (on) seen.add(name)
  }
  for (const name of seen) {
    const row = keywordImpactRow(tel, name)
    if (row) row.kills += 1
  }
}

function noteAbilityMitigated(tel, defender, amount) {
  if (!tel || !defender?._defBuffs || !(amount > 0)) return
  const names = [...defender._defBuffs]
  if (!names.length) return
  const share = amount / names.length
  for (const name of names) {
    const row = abilityImpactRow(tel, name)
    if (row) row.mitigated += share
  }
}

function mergeUnitTelemetry(intoMap, fromMap) {
  if (!fromMap) return
  for (const [name, src] of fromMap) {
    let row = intoMap.get(name)
    if (!row) {
      intoMap.set(name, { ...src })
      continue
    }
    row.deploys += src.deploys || 0
    row.deaths += src.deaths || 0
    row.kills += src.kills || 0
    row.dmgOut += src.dmgOut || 0
    row.dmgIn += src.dmgIn || 0
    row.attacks += src.attacks || 0
    row.hits += src.hits || 0
    row.timesHit += src.timesHit || 0
    row.timesTargeted += src.timesTargeted || 0
    row.rawTaken += src.rawTaken || 0
    row.mitigated += src.mitigated || 0
  }
}

function mergeAbilityTelemetry(intoMap, fromMap) {
  if (!fromMap) return
  for (const [name, src] of fromMap) {
    let row = intoMap.get(name)
    if (!row) {
      intoMap.set(name, {
        name: src.name,
        casts: src.casts || 0,
        byRole: { ...(src.byRole || { commander: 0, officer: 0, unit: 0 }) },
        kills: src.kills || 0,
        mitigated: src.mitigated || 0,
      })
      continue
    }
    row.casts += src.casts || 0
    row.kills += src.kills || 0
    row.mitigated += src.mitigated || 0
    for (const k of ['commander', 'officer', 'unit']) {
      row.byRole[k] = (row.byRole[k] || 0) + (src.byRole?.[k] || 0)
    }
  }
}

function mergeKeywordTelemetry(intoMap, fromMap) {
  if (!fromMap) return
  for (const [name, src] of fromMap) {
    let row = intoMap.get(name)
    if (!row) {
      intoMap.set(name, { name: src.name, kills: src.kills || 0 })
      continue
    }
    row.kills += src.kills || 0
  }
}

function mergeDefenseTelemetry(into, from) {
  if (!from) return
  into.hitsTaken += from.hitsTaken || 0
  into.rawDamage += from.rawDamage || 0
  into.dealtDamage += from.dealtDamage || 0
  into.mitigated += from.mitigated || 0
  for (const k of Object.keys(into.bySource)) {
    into.bySource[k] = (into.bySource[k] || 0) + (from.bySource?.[k] || 0)
  }
}

function mergeCombatBucket(into, from) {
  if (!from) return into
  into.attacks += from.attacks || 0
  into.hits += from.hits || 0
  into.misses += from.misses || 0
  into.damageDealt += from.damageDealt || 0
  into.damageTaken += from.damageTaken || 0
  into.killVp += from.killVp || 0
  into.hitNeedSum += from.hitNeedSum || 0
  into.hitRollSum += from.hitRollSum || 0
  into.retaliateAttacks += from.retaliateAttacks || 0
  into.retaliateHits += from.retaliateHits || 0
  for (const role of ['unit', 'officer', 'commander']) {
    into.killsByRole[role] = (into.killsByRole[role] || 0) + (from.killsByRole?.[role] || 0)
  }
  for (const k of ['brace', 'evade', 'retaliate']) {
    into.reactions[k] = (into.reactions[k] || 0) + (from.reactions?.[k] || 0)
  }
  into.games = (into.games || 0) + (from.games || 0)
  return into
}

function finalizeCombatBucket(b, gamesOverride) {
  const games = gamesOverride ?? b.games ?? 0
  const attacks = b.attacks || 0
  const hits = b.hits || 0
  const kills =
    (b.killsByRole?.unit || 0) +
    (b.killsByRole?.officer || 0) +
    (b.killsByRole?.commander || 0)
  return {
    games,
    attacks,
    hits,
    misses: b.misses || 0,
    hitRate: attacks ? +((100 * hits) / attacks).toFixed(1) : 0,
    damageDealt: b.damageDealt || 0,
    damageTaken: b.damageTaken || 0,
    avgDamageDealt: games ? +((b.damageDealt || 0) / games).toFixed(1) : 0,
    avgDamageTaken: games ? +((b.damageTaken || 0) / games).toFixed(1) : 0,
    avgAttacks: games ? +((attacks || 0) / games).toFixed(1) : 0,
    killVp: b.killVp || 0,
    avgKillVp: games ? +((b.killVp || 0) / games).toFixed(1) : 0,
    kills,
    avgKills: games ? +(kills / games).toFixed(2) : 0,
    killsByRole: { ...(b.killsByRole || { unit: 0, officer: 0, commander: 0 }) },
    avgHitNeed: attacks ? +((b.hitNeedSum || 0) / attacks).toFixed(2) : 0,
    avgHitRoll: attacks ? +((b.hitRollSum || 0) / attacks).toFixed(2) : 0,
    reactions: { ...(b.reactions || { brace: 0, evade: 0, retaliate: 0 }) },
    retaliateAttacks: b.retaliateAttacks || 0,
    retaliateHits: b.retaliateHits || 0,
    retaliateHitRate:
      b.retaliateAttacks > 0
        ? +((100 * (b.retaliateHits || 0)) / b.retaliateAttacks).toFixed(1)
        : 0,
  }
}

function recordStrikeCombat(atkCombat, defCombat, opts, tel = null, attacker = null, defender = null) {
  const { hit, need, roll, dmg, killed, role, isRetaliate, raw = dmg, mitigated = 0 } = opts
  if (!atkCombat) return
  if (isRetaliate) {
    atkCombat.retaliateAttacks += 1
    atkCombat.hitNeedSum += need
    atkCombat.hitRollSum += roll
    if (hit) {
      atkCombat.retaliateHits += 1
      atkCombat.hits += 1
      atkCombat.attacks += 1
      atkCombat.damageDealt += dmg || 0
    } else {
      atkCombat.misses += 1
      atkCombat.attacks += 1
    }
  } else {
    atkCombat.attacks += 1
    atkCombat.hitNeedSum += need
    atkCombat.hitRollSum += roll
    if (hit) {
      atkCombat.hits += 1
      atkCombat.damageDealt += dmg || 0
    } else {
      atkCombat.misses += 1
    }
  }
  if (hit && killed && role) {
    const key = role === 'officer' || role === 'commander' ? role : 'unit'
    atkCombat.killsByRole[key] = (atkCombat.killsByRole[key] || 0) + 1
  }
  if (defCombat && hit && dmg > 0) defCombat.damageTaken += dmg

  if (tel && defender) {
    const dRow = unitTelemetryRow(tel, defender)
    if (dRow) {
      dRow.timesTargeted += 1
      if (!hit && defender._evade) {
        tel.defense.bySource.evadeDodge += 1
      }
    }
  }

  if (tel && attacker) {
    const aRow = unitTelemetryRow(tel, attacker)
    if (aRow) {
      aRow.attacks += 1
      if (hit) {
        aRow.hits += 1
        aRow.dmgOut += dmg || 0
      }
      if (hit && killed) {
        aRow.kills += 1
        noteAbilityKill(tel, attacker)
        noteKeywordKill(tel, attacker)
      }
    }
  }
  if (tel && defender && hit) {
    const dRow = unitTelemetryRow(tel, defender)
    if (dRow) {
      dRow.timesHit += 1
      dRow.dmgIn += dmg || 0
      dRow.rawTaken += raw || dmg || 0
      dRow.mitigated += mitigated || 0
      if (killed) dRow.deaths += 1
    }
  }
}

function refreshSide(sideState, models, force) {
  const cmd = models.find((m) => m.alive && m.side === sideState.side && m.role === 'commander')
  sideState.cc = cmd?.ccGen || force.commander.ccGeneration || 0
  sideState.commanderAp = cmd?.apGen || force.commander.apGeneration || 0
  sideState.strategistAvailable = !!(cmd && hasAbility(cmd, 'Master Strategist'))
  sideState.commanderActivatedThisRound = false
  sideState._soulTitheCompanyId = null
  sideState._soulTitheArmy = false
  sideState._soulHarvestActive = false
  sideState._tyrantTitheUsed = 0
  // Dread Aura: enemies adjacent to army units in CR gain Fear this round.
  if (cmd?.alive && hasAbility(cmd, 'Dread Aura') && cmd.hex) {
    const friends = friendsInCommanderRadius(models, cmd)
    for (const foe of models.filter((m) => m.alive && m.side !== sideState.side && m.hex)) {
      const near = friends.some(
        (u) => u.hex && hexDist(u.hex, foe.hex) === 1,
      )
      if (near && !hasAbility(foe, 'Fearless') && !foe._tempFearless) foe.fear = true
    }
  }
  for (const co of sideState.companies) {
    const off = models.find(
      (m) => m.alive && m.side === sideState.side && m.role === 'officer' && m.companyId === co.id,
    )
    co.officerModel = off || null
    co.ap = off ? co.apMax : 0
    co.activatedThisRound = false
  }
  for (const m of models.filter((x) => x.side === sideState.side && x.alive)) {
    resetRoundFlags(m)
    m.movedThisAct = 0
  }
}

function companiesReadyToActivate(sideState) {
  return sideState.companies.filter(
    (c) =>
      c.officerModel?.alive &&
      !c.activatedThisRound &&
      sideState.cc >= OFFICER_ACTIVATE_CC,
  )
}

function canActivateCommander(sideState, models) {
  if (sideState.commanderActivatedThisRound) return false
  return models.some((m) => m.alive && m.side === sideState.side && m.role === 'commander')
}

/** Pick nearest-to-objective officer company. */
function pickOfficerCompany(available, map) {
  const sorted = [...available].sort((a, b) => {
    const score = (off) => Math.min(...map.objectives.map((o) => hexDist(off.hex, o)))
    return score(a.officerModel) - score(b.officerModel)
  })
  return sorted[0]
}

/** When on the independent commander track to activate this round (does not consume an officer slot). */
function pickCommanderInsertSlot(rng) {
  const r = rng()
  if (r < 0.4) return 'before'
  if (r < 0.55) return 'afterFirst'
  if (r < 0.75) return 'beforeLast'
  return 'after'
}

function maybeActivateCommander(sideState, models, map, rng, kills, vp, abilityMap, round, slot, phase, sides = null) {
  if (!canActivateCommander(sideState, models)) return false
  const done = sideState.companies.filter((c) => c.activatedThisRound).length
  const left = companiesReadyToActivate(sideState).length
  let fire = false
  if (phase === 'preOfficer') {
    if (slot === 'before' && done === 0) fire = true
    if (slot === 'beforeLast' && left === 1 && done >= 1) fire = true
  } else if (phase === 'postOfficer') {
    if (slot === 'afterFirst' && done === 1) fire = true
  } else if (phase === 'end') {
    // Always resolve any unused commander by end of officer phase
    fire = true
  }
  if (!fire) return false
  return activateCommander(sideState, models, map, rng, kills, vp, abilityMap, round, sides)
}

function summarize(models, side, race) {
  const mine = models.filter((m) => m.side === side)
  const alive = mine.filter((m) => m.alive)
  return {
    race,
    alive: alive.length,
    dead: mine.length - alive.length,
    uvAlive: alive.reduce((s, m) => s + m.uv, 0),
    commanderAlive: alive.some((m) => m.role === 'commander'),
    officersAlive: alive.filter((m) => m.role === 'officer').length,
    unitsAlive: alive.filter((m) => m.role === 'unit').length,
  }
}

function simulateMatch(raceA, raceB, allCards, abilityMap, seed, opts = {}) {
  const rng = mulberry32(seed)
  const map = createMap(rng)
  const forceA = buildForce(raceA, allCards, rng, {
    commanderCard: opts.commanderA || null,
  })
  const forceB = buildForce(raceB, allCards, rng, {
    commanderCard: opts.commanderB || null,
  })
  const telemetry = emptyMatchTelemetry()
  const placeA = placeInitial(forceA, 'A', map, rng, telemetry)
  const placeB = placeInitial(forceB, 'B', map, rng, telemetry)
  const models = [...placeA.models, ...placeB.models]
  models.telemetry = telemetry
  const reservePackages = { A: placeA.reservePackages, B: placeB.reservePackages }
  const sideA = buildSideState(forceA, 'A', models)
  const sideB = buildSideState(forceB, 'B', models)
  sideA.telemetry = telemetry
  sideB.telemetry = telemetry
  sideA.reserveCompaniesLeft = reservePackages.A.length
  sideB.reserveCompaniesLeft = reservePackages.B.length
  const sides = { A: sideA, B: sideB }
  const forces = { A: forceA, B: forceB }
  const vp = { A: 0, B: 0 }
  const kills = { A: [], B: [] }
  const log = []

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if (
      !models.some((m) => m.alive && m.side === 'A') ||
      !models.some((m) => m.alive && m.side === 'B')
    ) {
      log.push({ round, note: 'force eliminated' })
      break
    }

    refreshSide(sideA, models, forceA)
    refreshSide(sideB, models, forceB)

    const order = round % 2 === 1 ? ['A', 'B'] : ['B', 'A']
    // Officer alternation (1 CC each, once per officer). Commander is an independent once/round track.
    const cmdSlot = { A: pickCommanderInsertSlot(rng), B: pickCommanderInsertSlot(rng) }
    let pass = { A: false, B: false }
    let safety = 40
    while (safety-- > 0) {
      let acted = false
      for (const side of order) {
        const st = sides[side]
        // Rules A/B: cast commander actives anytime (before this side's officer acts).
        if (dialEffects().commanderCastAnytime) {
          tryCommanderCasts(st, models, map, rng, kills, vp, abilityMap, round, sides)
        }
        maybeActivateCommander(
          st,
          models,
          map,
          rng,
          kills,
          vp,
          abilityMap,
          round,
          cmdSlot[side],
          'preOfficer',
          sides,
        )
        const available = companiesReadyToActivate(st)
        if (!available.length) {
          pass[side] = true
          continue
        }
        pass[side] = false
        const pick = pickOfficerCompany(available, map)
        activateCompany(st, pick, models, map, rng, abilityMap, kills, vp, round, sides)
        maybeActivateCommander(
          st,
          models,
          map,
          rng,
          kills,
          vp,
          abilityMap,
          round,
          cmdSlot[side],
          'postOfficer',
          sides,
        )
        acted = true
      }
      if (pass.A && pass.B) break
      if (!acted) break
    }
    for (const side of order) {
      maybeActivateCommander(
        sides[side],
        models,
        map,
        rng,
        kills,
        vp,
        abilityMap,
        round,
        cmdSlot[side],
        'end',
        sides,
      )
    }

    // One officer + company per reinforcement wave (if center held/contested)
    if (WAVE_ROUNDS.includes(round)) {
      for (const side of order) {
        const st = sides[side]
        const res = reinforceCompany(st, map, models, reservePackages[side], rng)
        st.reserveCompaniesLeft = reservePackages[side].length
        if (res.arrived.length) {
          log.push({
            round,
            side,
            reinforceCompany: res.companyId,
            reinforce: res.arrived,
            spent: res.spent,
          })
        }
      }
    }

    const objGain = endRound(models, map, vp)
    // Unused CC lost
    sideA.cc = 0
    sideB.cc = 0

    log.push({
      round,
      vp: { ...vp },
      obj: map.objectives.map((o) => ({ id: o.id, ctrl: o.controller })),
      objGain,
      alive: {
        A: models.filter((m) => m.alive && m.side === 'A').length,
        B: models.filter((m) => m.alive && m.side === 'B').length,
      },
      economy: {
        A: { ccGen: forceA.commander.ccGeneration, companies: sideA.companies.map((c) => c.apMax) },
        B: { ccGen: forceB.commander.ccGeneration, companies: sideB.companies.map((c) => c.apMax) },
      },
    })
  }

  const endA = summarize(models, 'A', raceA)
  const endB = summarize(models, 'B', raceB)
  let winner = 'Draw'
  if (vp.A !== vp.B) winner = vp.A > vp.B ? raceA : raceB
  else if (endA.uvAlive !== endB.uvAlive) winner = endA.uvAlive > endB.uvAlive ? raceA : raceB

  return {
    seed,
    matchup: `${raceA} vs ${raceB}`,
    winner,
    vp: { [raceA]: vp.A, [raceB]: vp.B },
    forces: {
      [raceA]: {
        armyUv: forceA.armyUv,
        deployUv: forceA.deployUv,
        reserveUv: forceA.reserveUv,
        unusedUv: forceA.unusedUv ?? 0,
        caps: forceA.caps,
        deployUnits: forceA.deployUnits,
        deployOfficers: forceA.deployOfficers,
        deployCommanders: forceA.deployCommanders,
        deployModels: forceA.deployModels,
        deployFormationUnits: forceA.deployFormationUnits,
        targetOfficers: forceA.targetOfficers,
        startOfficerTarget: forceA.startOfficerTarget,
        armyOfficerCount: forceA.armyOfficerCount,
        reserveCompanies: (forceA.reservePackages || []).length,
        commander: forceA.commander.name,
        ccGeneration: forceA.commander.ccGeneration,
        composition: forceA.composition || null,
        companies: forceA.companies,
      },
      [raceB]: {
        armyUv: forceB.armyUv,
        deployUv: forceB.deployUv,
        reserveUv: forceB.reserveUv,
        unusedUv: forceB.unusedUv ?? 0,
        caps: forceB.caps,
        deployUnits: forceB.deployUnits,
        deployOfficers: forceB.deployOfficers,
        deployCommanders: forceB.deployCommanders,
        deployModels: forceB.deployModels,
        deployFormationUnits: forceB.deployFormationUnits,
        targetOfficers: forceB.targetOfficers,
        startOfficerTarget: forceB.startOfficerTarget,
        armyOfficerCount: forceB.armyOfficerCount,
        reserveCompanies: (forceB.reservePackages || []).length,
        commander: forceB.commander.name,
        ccGeneration: forceB.commander.ccGeneration,
        composition: forceB.composition || null,
        companies: forceB.companies,
      },
    },
    end: { [raceA]: endA, [raceB]: endB },
    killVp: {
      [raceA]: kills.A.reduce((s, k) => s + k.vp, 0),
      [raceB]: kills.B.reduce((s, k) => s + k.vp, 0),
    },
    kills: {
      [raceA]: kills.A,
      [raceB]: kills.B,
    },
    combat: {
      [raceA]: { ...sideA.combat, games: 1 },
      [raceB]: { ...sideB.combat, games: 1 },
    },
    telemetry: {
      units: [...telemetry.units.values()],
      abilities: [...telemetry.abilities.values()],
      keywords: [...telemetry.keywords.values()],
      defense: telemetry.defense,
    },
    log,
    terrain: map.counts,
    hasRiver: !!map.hasRiver,
    bridgeCount: map.bridgeCount || 0,
    bridges: map.bridges || [],
    objectiveCardId: map.objectiveCardId || null,
    objectiveCardName: map.objectiveCardName || null,
    objectiveRotated: !!map.objectiveRotated,
    objectiveCount: map.objectives?.length || 0,
    roundsPlayed: log.filter((l) => l.vp).length,
    sampleRound: log.find((l) => l.vp) || null,
    lastRound: log.filter((l) => l.vp).at(-1) || null,
  }
}

function walkYamlFiles(dir) {
  const out = []
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const ent of entries) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) out.push(...walkYamlFiles(p))
    else if (/\.ya?ml$/i.test(ent.name)) out.push(p)
  }
  return out
}

function yamlCardToSim(c) {
  return {
    id: c.id,
    name: c.name,
    cardType: c.card_type,
    rarity: c.rarity,
    unique: !!c.unique,
    race: c.race,
    primaryType: c.primary_type,
    secondaryType: c.secondary_type,
    uv: c.uv,
    move: c.move,
    damage: c.damage,
    range: c.range,
    toughness: c.toughness,
    companyAp: c.company_ap,
    companyCapacity: c.company_capacity,
    companyUnitCap: c.company_unit_cap ?? null,
    commandRadius: c.command_radius,
    apGeneration: c.ap_generation,
    ccGeneration: c.cc_generation,
    favoredTerrain: c.favored_terrain,
    abilities: c.abilities || [],
    keywords: c.keywords || [],
    ultimate: c.ultimate,
    flavorText: c.flavor_text,
    complexity: c.complexity,
    role: c.role,
    tags: c.tags || [],
    supportedRaces: c.supported_races || [],
    supportedTypes: c.supported_types || [],
    supportedKeywords: c.supported_keywords || [],
  }
}

function loadCatalogFromYaml() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const cards = []
  for (const file of walkYamlFiles(join(root, 'data', 'cards'))) {
    const raw = loadYaml(readFileSync(file, 'utf8'))
    const list = raw?.cards
    if (!Array.isArray(list)) continue
    for (const c of list) {
      if (c?.id && c?.name) cards.push(yamlCardToSim(c))
    }
  }
  const abRaw = loadYaml(readFileSync(join(root, 'data', 'abilities.yaml'), 'utf8'))
  const abilities = Object.entries(abRaw || {}).map(([name, a]) => ({
    name,
    type: a?.type,
    cost: a?.cost,
    costAmount: a?.cost_amount,
    costResource: a?.cost_resource,
    description: a?.description,
    affects: a?.affects,
    affectCount: a?.affect_count,
    radiusFrom: a?.radius_from,
    radiusSize: a?.radius_size,
    usedBy: a?.used_by,
    cooldown: a?.cooldown ?? null,
    tags: a?.tags || [],
  }))
  return { cards, abilities }
}

async function loadCatalog() {
  try {
    const cardsRes = await fetch(`${API}/api/cards`)
    const abilRes = await fetch(`${API}/api/abilities`)
    if (cardsRes.ok && abilRes.ok) {
      const cards = (await cardsRes.json()).cards
      const abilities = (await abilRes.json()).abilities
      if (cards?.length && abilities?.length) {
        console.error(`Sim catalog: API (${cards.length} cards)`)
        return { cards, abilities }
      }
    }
  } catch {
    /* YAML fallback */
  }
  const fromYaml = loadCatalogFromYaml()
  console.error(
    `Sim catalog: YAML (${fromYaml.cards.length} cards) — API ${API} unavailable`,
  )
  return fromYaml
}

async function main() {
  // Enable printable dials via SIM_DIALS=id1,id2 (comma-separated).
  for (const id of String(process.env.SIM_DIALS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    setDialActive(id, true)
  }
  const lint = lintDialRegistry()
  if (lint.length) {
    console.error('Dial registry lint:', lint.join('; '))
    process.exit(1)
  }

  const { cards, abilities } = await loadCatalog()
  if (!cards?.length) {
    console.error('Sim catalog empty — import YAML or start the card API.')
    process.exit(1)
  }
  const abilityMap = new Map(abilities.map((a) => [a.name, a]))
  const races = [
    'Human',
    'Elf',
    'Demon',
    'Lizardman',
    'Dwarf',
    'Dragon',
    'Beastfolk',
    'Undead',
    'Construct',
    ...(MIXED_ARMIES_ENABLED ? ['Mixed'] : []),
  ]
  if (!MIXED_ARMIES_ENABLED) {
    console.error('Mixed coalition lists disabled (default). Re-enable: CW_SIM_MIXED_ARMIES=1 or --mixed-armies')
  }
  const matchups = []
  for (let i = 0; i < races.length; i++) {
    for (let j = i + 1; j < races.length; j++) {
      matchups.push([races[i], races[j]])
    }
  }
  const report = []
  /** name → rarity from card DB */
  const commanderRarityByName = new Map(
    cards
      .filter((c) => c.cardType === 'Commander')
      .map((c) => [c.name, c.rarity || 'Common']),
  )
  const rarityOf = (name, card) =>
    card?.rarity || commanderRarityByName.get(name) || 'Common'

  /** Suite-wide commander performance: name → { race, rarity, games, wins, losses, draws, vpFor, vpAgainst } */
  const commanderStats = new Map()
  const bumpCommander = (name, race, rarity, patch) => {
    if (!name) return
    let row = commanderStats.get(name)
    if (!row) {
      row = {
        name,
        race,
        rarity: rarity || 'Common',
        games: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        vpFor: 0,
        vpAgainst: 0,
        combat: emptyCombatBucket(),
      }
      commanderStats.set(name, row)
    }
    row.games += 1
    row.wins += patch.win || 0
    row.losses += patch.loss || 0
    row.draws += patch.draw || 0
    row.vpFor += patch.vpFor || 0
    row.vpAgainst += patch.vpAgainst || 0
    if (patch.combat) {
      mergeCombatBucket(row.combat, { ...patch.combat, games: 1 })
    }
  }
  /** Suite + per-race combat totals */
  const suiteCombat = emptyCombatBucket()
  const combatByRace = Object.fromEntries(races.map((r) => [r, emptyCombatBucket()]))
  const suiteUnits = new Map()
  const suiteAbilities = new Map()
  const suiteKeywords = new Map()
  const suiteDefense = {
    hitsTaken: 0,
    rawDamage: 0,
    dealtDamage: 0,
    mitigated: 0,
    bySource: {
      harden: 0,
      brace: 0,
      evadeDodge: 0,
      shieldwall: 0,
      fortified: 0,
      defender: 0,
      ignoreHit: 0,
      other: 0,
    },
  }
  const deployStats = {
    units: [],
    officers: [],
    commanders: [],
    models: [],
    formationUnits: [],
    deployUv: [],
    reserveUv: [],
    armyUv: [],
    targetOfficers: [],
    armyOfficers: [],
    reserveCompanies: [],
    unusedUv: [],
    rivers: 0,
    waterHexes: [],
    desertHexes: [],
    forestHexes: [],
    swampHexes: [],
    wallHexes: [],
    bridgeCounts: [],
  }
  for (const [a, b] of matchups) {
    const cmdsA = commandersForList(a, cards)
    const cmdsB = commandersForList(b, cards)
    let games = matchupCommanderGames(cmdsA, cmdsB, MIN_RUNS_PER_COMMANDER)
    // Optional SIM_RUNS floor: repeat the coverage grid until ≥ SIM_RUNS games.
    if (RUNS > 0 && games.length < RUNS) {
      const base = [...games]
      let i = 0
      while (games.length < RUNS) {
        const g = base[i % base.length]
        games.push({ ...g, rep: (g.rep || 0) + 1000 + Math.floor(i / base.length) })
        i++
      }
    }
    const wins = { [a]: 0, [b]: 0, Draw: 0 }
    const vpSum = { [a]: 0, [b]: 0 }
    const commanderAppearances = { [a]: {}, [b]: {} }
    /** Per-matchup commander records */
    const matchupCommanderStats = {}
    const bumpMatchupCmd = (name, listRace, rarity, patch) => {
      if (!name) return
      if (!matchupCommanderStats[name]) {
        matchupCommanderStats[name] = {
          name,
          race: listRace,
          rarity: rarity || 'Common',
          games: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          vpFor: 0,
          vpAgainst: 0,
        }
      }
      const row = matchupCommanderStats[name]
      row.games += 1
      row.wins += patch.win || 0
      row.losses += patch.loss || 0
      row.draws += patch.draw || 0
      row.vpFor += patch.vpFor || 0
      row.vpAgainst += patch.vpAgainst || 0
    }
    let sample = null
    for (let i = 0; i < games.length; i++) {
      const g = games[i]
      const seed =
        5000 +
        i * 31 +
        a.length * 17 +
        b.length * 13 +
        (g.cmdA?.name || '').length * 7 +
        (g.cmdB?.name || '').length * 11 +
        (g.rep || 0) * 101
      const result = simulateMatch(a, b, cards, abilityMap, seed, {
        commanderA: g.cmdA,
        commanderB: g.cmdB,
      })
      wins[result.winner] = (wins[result.winner] || 0) + 1
      vpSum[a] += result.vp[a]
      vpSum[b] += result.vp[b]
      const ca = result.forces[a]?.commander || g.cmdA?.name || '?'
      const cb = result.forces[b]?.commander || g.cmdB?.name || '?'
      commanderAppearances[a][ca] = (commanderAppearances[a][ca] || 0) + 1
      commanderAppearances[b][cb] = (commanderAppearances[b][cb] || 0) + 1

      const aWin = result.winner === a ? 1 : 0
      const bWin = result.winner === b ? 1 : 0
      const draw = result.winner === 'Draw' ? 1 : 0
      const rarA = rarityOf(ca, g.cmdA)
      const rarB = rarityOf(cb, g.cmdB)
      const combatA = result.combat?.[a] || null
      const combatB = result.combat?.[b] || null
      if (combatA) {
        mergeCombatBucket(suiteCombat, { ...combatA, games: 1 })
        mergeCombatBucket(combatByRace[a], { ...combatA, games: 1 })
      }
      if (combatB) {
        mergeCombatBucket(suiteCombat, { ...combatB, games: 1 })
        mergeCombatBucket(combatByRace[b], { ...combatB, games: 1 })
      }
      if (result.telemetry?.units?.length) {
        mergeUnitTelemetry(
          suiteUnits,
          new Map(result.telemetry.units.map((u) => [u.name, u])),
        )
      }
      if (result.telemetry?.abilities?.length) {
        mergeAbilityTelemetry(
          suiteAbilities,
          new Map(result.telemetry.abilities.map((a) => [a.name, a])),
        )
      }
      if (result.telemetry?.keywords?.length) {
        mergeKeywordTelemetry(
          suiteKeywords,
          new Map(result.telemetry.keywords.map((k) => [k.name, k])),
        )
      }
      if (result.telemetry?.defense) {
        mergeDefenseTelemetry(suiteDefense, result.telemetry.defense)
      }
      bumpCommander(ca, result.forces[a]?.composition?.commanderRace || a, rarA, {
        win: aWin,
        loss: bWin,
        draw,
        vpFor: result.vp[a],
        vpAgainst: result.vp[b],
        combat: combatA,
      })
      bumpCommander(cb, result.forces[b]?.composition?.commanderRace || b, rarB, {
        win: bWin,
        loss: aWin,
        draw,
        vpFor: result.vp[b],
        vpAgainst: result.vp[a],
        combat: combatB,
      })
      bumpMatchupCmd(ca, a, rarA, {
        win: aWin,
        loss: bWin,
        draw,
        vpFor: result.vp[a],
        vpAgainst: result.vp[b],
      })
      bumpMatchupCmd(cb, b, rarB, {
        win: bWin,
        loss: aWin,
        draw,
        vpFor: result.vp[b],
        vpAgainst: result.vp[a],
      })

      if (result.hasRiver) deployStats.rivers += 1
      deployStats.waterHexes.push(result.terrain?.water || 0)
      deployStats.desertHexes.push(result.terrain?.desert || 0)
      deployStats.forestHexes.push(result.terrain?.forest || 0)
      deployStats.swampHexes.push(result.terrain?.swamp || 0)
      deployStats.wallHexes.push(result.terrain?.wall || 0)
      deployStats.bridgeCounts.push(result.bridgeCount || 0)
      for (const side of [a, b]) {
        const f = result.forces[side]
        deployStats.units.push(f.deployUnits)
        deployStats.officers.push(f.deployOfficers)
        deployStats.commanders.push(f.deployCommanders)
        deployStats.models.push(f.deployModels)
        deployStats.formationUnits.push(f.deployFormationUnits || 0)
        deployStats.deployUv.push(f.deployUv)
        deployStats.reserveUv.push(f.reserveUv)
        deployStats.unusedUv.push(f.unusedUv ?? 0)
        deployStats.armyUv.push(f.armyUv)
        deployStats.targetOfficers.push(f.targetOfficers)
        deployStats.armyOfficers.push(f.armyOfficerCount)
        deployStats.reserveCompanies.push(f.reserveCompanies)
      }
      if (!sample) sample = result
    }
    const n = games.length || 1
    const finalizeCmdRows = (obj) =>
      Object.values(obj)
        .map((row) => {
          const decisive = row.wins + row.losses || 1
          return {
            ...row,
            winPct: +((100 * row.wins) / decisive).toFixed(1),
            avgVpFor: +(row.vpFor / row.games).toFixed(1),
            avgVpAgainst: +(row.vpAgainst / row.games).toFixed(1),
          }
        })
        .sort((x, y) => y.winPct - x.winPct || y.wins - x.wins)
    report.push({
      matchup: `${a} vs ${b}`,
      runs: games.length,
      commandersA: cmdsA.map((c) => c.name),
      commandersB: cmdsB.map((c) => c.name),
      commanderAppearances,
      commanderPerformance: finalizeCmdRows(matchupCommanderStats),
      minRunsPerCommander: MIN_RUNS_PER_COMMANDER,
      wins,
      avgVp: { [a]: +(vpSum[a] / n).toFixed(1), [b]: +(vpSum[b] / n).toFixed(1) },
      sample,
    })
  }
  const avg = (arr) => +(arr.reduce((s, n) => s + n, 0) / arr.length).toFixed(2)
  const totalGames = report.reduce((s, row) => s + (row.runs || 0), 0)

  // Full NxN win% matrix (row vs column). Diagonal null. Each unordered pair filled once.
  const matrix = {}
  for (const r of races) {
    matrix[r] = Object.fromEntries(races.map((c) => [c, null]))
  }
  for (const row of report) {
    const [a, b] = row.matchup.split(' vs ')
    const wa = row.wins[a] || 0
    const wb = row.wins[b] || 0
    const dr = row.wins.Draw || 0
    const tot = wa + wb + dr || 1
    matrix[a][b] = +((100 * wa) / tot).toFixed(1)
    matrix[b][a] = +((100 * wb) / tot).toFixed(1)
  }

  const raceWins = Object.fromEntries(races.map((r) => [r, 0]))
  for (const row of report) {
    for (const r of races) {
      if (row.wins[r]) raceWins[r] += row.wins[r]
    }
  }
  const decisive = Object.values(raceWins).reduce((s, n) => s + n, 0) || 1
  const raceWinShare = Object.fromEntries(
    races.map((r) => [r, +((100 * raceWins[r]) / decisive).toFixed(1)]),
  )

  const commanderPerformance = [...commanderStats.values()]
    .map((row) => {
      const dec = row.wins + row.losses || 1
      return {
        name: row.name,
        race: row.race,
        rarity: row.rarity || commanderRarityByName.get(row.name) || 'Common',
        games: row.games,
        wins: row.wins,
        losses: row.losses,
        draws: row.draws,
        winPct: +((100 * row.wins) / dec).toFixed(1),
        avgVpFor: +(row.vpFor / row.games).toFixed(1),
        avgVpAgainst: +(row.vpAgainst / row.games).toFixed(1),
        avgVpDiff: +((row.vpFor - row.vpAgainst) / row.games).toFixed(1),
        combat: finalizeCombatBucket(row.combat || emptyCombatBucket(), row.games),
      }
    })
    .sort((a, b) => b.winPct - a.winPct || b.wins - a.wins)

  const commanderPerformanceByRace = {}
  for (const row of commanderPerformance) {
    if (!commanderPerformanceByRace[row.race]) commanderPerformanceByRace[row.race] = []
    commanderPerformanceByRace[row.race].push(row)
  }

  const summary = {
    races,
    matchupCount: matchups.length,
    expectedMatchups: (races.length * (races.length - 1)) / 2,
    allPairs: matchups.length === (races.length * (races.length - 1)) / 2,
    caps: { army: ARMY_UV, deploy: DEPLOY_UV, reserve: REINFORCE_UV, unused: ARMY_UNUSED_UV_MAX },
    samples: deployStats.models.length,
    /** Opening board models: combat units + officers + commander. */
    avgDeployModels: avg(deployStats.models),
    avgDeployUnits: avg(deployStats.units),
    avgDeployOfficers: avg(deployStats.officers),
    avgDeployCommanders: avg(deployStats.commanders),
    avgDeployFormationUnits: avg(deployStats.formationUnits),
    avgDeployUv: avg(deployStats.deployUv),
    avgReserveUv: avg(deployStats.reserveUv),
    avgUnusedUv: avg(deployStats.unusedUv),
    avgArmyUv: avg(deployStats.armyUv),
    avgTargetOfficers: avg(deployStats.targetOfficers),
    avgArmyOfficers: avg(deployStats.armyOfficers),
    avgReserveCompanies: avg(deployStats.reserveCompanies),
    minDeployModels: Math.min(...deployStats.models),
    maxDeployModels: Math.max(...deployStats.models),
    minDeployUnits: Math.min(...deployStats.units),
    maxDeployUnits: Math.max(...deployStats.units),
    riverChance: 0,
    riverRate: 0,
    waterCap: WATER_HEX_CAP,
    avgWaterHexes: avg(deployStats.waterHexes),
    avgDesertHexes: avg(deployStats.desertHexes || []),
    avgForestHexes: avg(deployStats.forestHexes || []),
    avgSwampHexes: avg(deployStats.swampHexes || []),
    avgWallHexes: avg(deployStats.wallHexes || []),
    avgBridges: 0,
    boardSize: BOARD_SIZE,
    monoRace: true,
    mixedArmiesEnabled: MIXED_ARMIES_ENABLED,
    raceWinShare,
    activeBalanceDials: activeDials().map((d) => d.id),
    printedBaseline: true,
    minRunsPerCommander: MIN_RUNS_PER_COMMANDER,
    totalGames,
    commanderCoverage: true,
  }

  const combatSuite = finalizeCombatBucket(
    suiteCombat,
    suiteCombat.games || totalGames * 2,
  )
  const combatByRaceFinal = Object.fromEntries(
    races.map((r) => [r, finalizeCombatBucket(combatByRace[r], combatByRace[r].games || 0)]),
  )
  const combatByCommander = commanderPerformance.map((row) => ({
    name: row.name,
    race: row.race,
    rarity: row.rarity,
    winPct: row.winPct,
    ...row.combat,
  }))

  const unitPerformance = [...suiteUnits.values()]
    .filter((u) => u.role === 'unit' && u.deploys >= 20)
    .map((u) => {
      const deploys = u.deploys || 1
      const attacks = u.attacks || 0
      return {
        name: u.name,
        race: u.race,
        deploys: u.deploys,
        deaths: u.deaths,
        kills: u.kills,
        deathRate: +((100 * u.deaths) / deploys).toFixed(1),
        killsPerDeploy: +(u.kills / deploys).toFixed(2),
        kd: u.deaths ? +(u.kills / u.deaths).toFixed(2) : u.kills,
        avgDmgOut: +(u.dmgOut / deploys).toFixed(2),
        avgDmgIn: +(u.dmgIn / deploys).toFixed(2),
        avgTimesHit: +(u.timesHit / deploys).toFixed(2),
        avgTimesTargeted: +(u.timesTargeted / deploys).toFixed(2),
        avgMitigated: +(u.mitigated / deploys).toFixed(2),
        hitRate: attacks ? +((100 * u.hits) / attacks).toFixed(1) : 0,
        avgAttacks: +(attacks / deploys).toFixed(2),
      }
    })
    .sort((a, b) => b.deathRate - a.deathRate || a.kd - b.kd)

  const abilityPerformance = [...suiteAbilities.values()]
    .filter((a) => a.casts >= 10 || a.kills >= 5 || a.mitigated >= 20)
    .map((a) => ({
      name: a.name,
      casts: a.casts,
      castsPerGame: +(a.casts / totalGames).toFixed(2),
      kills: Math.round(a.kills || 0),
      killsPerGame: +((a.kills || 0) / totalGames).toFixed(2),
      mitigated: +((a.mitigated || 0)).toFixed(1),
      mitigatedPerGame: +((a.mitigated || 0) / totalGames).toFixed(2),
      byRole: a.byRole,
    }))
    .sort((a, b) => b.casts - a.casts)

  const keywordPerformance = [...suiteKeywords.values()]
    .filter((k) => (k.kills || 0) >= 5)
    .map((k) => ({
      name: k.name,
      kills: Math.round(k.kills || 0),
      killsPerGame: +((k.kills || 0) / totalGames).toFixed(2),
    }))
    .sort((a, b) => b.kills - a.kills)

  const defenseSummary = {
    ...suiteDefense,
    mitRate: suiteDefense.rawDamage
      ? +((100 * suiteDefense.mitigated) / suiteDefense.rawDamage).toFixed(1)
      : 0,
  }

  const payload = {
    version: 8,
    economy: true,
    abilities: true,
    keywords: true,
    printableDials: true,
    combatStats: true,
    summary,
    matrix,
    commanderPerformance,
    commanderPerformanceByRace,
    combat: {
      suite: combatSuite,
      byRace: combatByRaceFinal,
      byCommander: combatByCommander,
      defense: defenseSummary,
    },
    unitPerformance,
    abilityPerformance,
    keywordPerformance,
    report,
  }

  // Human-readable commander performance table
  const cmdLines = [
    '# Commander performance',
    '',
    `Suite: SIM_CMD_RUNS=${MIN_RUNS_PER_COMMANDER} · ${totalGames} games · decisive win % (draws excluded from win%)`,
    '',
    '| Commander | Race | Rarity | G | W–L–D | Win% | Avg VP | VP diff |',
    '|---|---|---|---:|---|---:|---:|---:|',
  ]
  for (const row of commanderPerformance) {
    cmdLines.push(
      `| ${row.name} | ${row.race} | ${row.rarity} | ${row.games} | ${row.wins}–${row.losses}–${row.draws} | ${row.winPct}% | ${row.avgVpFor} | ${row.avgVpDiff >= 0 ? '+' : ''}${row.avgVpDiff} |`,
    )
  }
  cmdLines.push('')
  cmdLines.push('## By race (best → worst)')
  cmdLines.push('')
  for (const race of races) {
    const rows = commanderPerformanceByRace[race]
    if (!rows?.length) continue
    cmdLines.push(`### ${race}`)
    cmdLines.push('')
    for (const row of rows) {
      cmdLines.push(
        `- **${row.name}** (${row.rarity}): ${row.winPct}% (${row.wins}–${row.losses}–${row.draws}, n=${row.games}, VP ${row.avgVpFor}/${row.avgVpAgainst})`,
      )
    }
    cmdLines.push('')
  }

  const proposals = buildProposalsReport({
    raceWinShare,
    label: `SIM_CMD_RUNS=${MIN_RUNS_PER_COMMANDER} multi-commander-coverage+kit-dials`,
    observations: [
      `Each commander appears ≥${MIN_RUNS_PER_COMMANDER} times per matchup (A×B commander grid).`,
      MIXED_ARMIES_ENABLED
        ? 'Mono lists cover every same-race commander; Mixed covers one commander per playable race.'
        : 'Mono-race lists only (Mixed coalition disabled; CW_SIM_MIXED_ARMIES=1 or --mixed-armies to re-enable).',
      'See sim/sim-commander-performance.md for per-commander win% and VP.',
      'Dials target race-specific commander/officer abilities — not flat Compact stats.',
    ],
  })
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'sim')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(
    join(outDir, 'sim-dial-proposals.json'),
    JSON.stringify(proposals, null, 2),
  )
  writeFileSync(join(outDir, 'sim-dial-proposals.md'), proposalsMarkdown(proposals))
  writeFileSync(
    join(outDir, 'sim-commander-performance.json'),
    JSON.stringify({ commanderPerformance, commanderPerformanceByRace }, null, 2),
  )
  writeFileSync(join(outDir, 'sim-commander-performance.md'), cmdLines.join('\n'))

  const combatPayload = {
    suite: combatSuite,
    byRace: combatByRaceFinal,
    byCommander: combatByCommander,
    defense: defenseSummary,
    units: unitPerformance,
    abilities: abilityPerformance,
    keywords: keywordPerformance,
  }
  writeFileSync(join(outDir, 'sim-combat-stats.json'), JSON.stringify(combatPayload, null, 2))

  const attackers = [...unitPerformance]
    .filter((u) => u.avgAttacks > 0)
    .sort((a, b) => b.avgAttacks - a.avgAttacks || b.avgDmgOut - a.avgDmgOut)
  const targets = [...unitPerformance]
    .filter((u) => u.avgTimesTargeted > 0)
    .sort((a, b) => b.avgTimesHit - a.avgTimesHit || b.avgDmgIn - a.avgDmgIn)
  const lethalAbilities = [...abilityPerformance]
    .filter((a) => a.kills > 0)
    .sort((a, b) => b.kills - a.kills)
  const saveAbilities = [...abilityPerformance]
    .filter((a) => a.mitigated > 0)
    .sort((a, b) => b.mitigated - a.mitigated)
  const lethalKeywords = [...keywordPerformance].sort((a, b) => b.kills - a.kills)

  const combatLines = [
    '# Combat statistics',
    '',
    `Suite: ${totalGames} games - averages are per side unless noted - hit rate = hits/attacks`,
    '',
    '## Suite (per side)',
    '',
    `| Metric | Value |`,
    `|---|---:|`,
    `| Hit rate | ${combatSuite.hitRate}% |`,
    `| Avg attacks | ${combatSuite.avgAttacks} |`,
    `| Avg damage dealt | ${combatSuite.avgDamageDealt} |`,
    `| Avg damage taken | ${combatSuite.avgDamageTaken} |`,
    `| Avg kills | ${combatSuite.avgKills} |`,
    `| Avg kill VP | ${combatSuite.avgKillVp} |`,
    `| Avg hit need | ${combatSuite.avgHitNeed} |`,
    `| Reactions (Brace/Evade/Retaliate) | ${combatSuite.reactions.brace}/${combatSuite.reactions.evade}/${combatSuite.reactions.retaliate} |`,
    `| Retaliate hit rate | ${combatSuite.retaliateHitRate}% |`,
    '',
    '## Defense mitigation',
    '',
    `| Metric | Value |`,
    `|---|---:|`,
    `| Hits taken | ${defenseSummary.hitsTaken} |`,
    `| Raw damage | ${defenseSummary.rawDamage} |`,
    `| Dealt after reduces | ${defenseSummary.dealtDamage} |`,
    `| Mitigated | ${defenseSummary.mitigated} (${defenseSummary.mitRate}%) |`,
    `| Harden | ${defenseSummary.bySource.harden} |`,
    `| Brace | ${defenseSummary.bySource.brace} |`,
    `| Evade dodges | ${defenseSummary.bySource.evadeDodge} |`,
    `| Shieldwall | ${defenseSummary.bySource.shieldwall} |`,
    `| Fortified | ${defenseSummary.bySource.fortified} |`,
    `| Defender keyword | ${defenseSummary.bySource.defender} |`,
    `| Ignore-hit | ${defenseSummary.bySource.ignoreHit} |`,
    `| Other | ${defenseSummary.bySource.other} |`,
    '',
    '## Units attacking most (avg attacks / deploy, n≥20)',
    '',
    '| Unit | Race | Atk/dep | Dmg out | Hit% | Kills/dep |',
    '|---|---|---:|---:|---:|---:|',
  ]
  for (const u of attackers.slice(0, 25)) {
    combatLines.push(
      `| ${u.name} | ${u.race} | ${u.avgAttacks} | ${u.avgDmgOut} | ${u.hitRate}% | ${u.killsPerDeploy} |`,
    )
  }
  combatLines.push('')
  combatLines.push('## Units getting hit most (avg times hit / deploy, n≥20)')
  combatLines.push('')
  combatLines.push('| Unit | Race | Hit/dep | Targeted/dep | Dmg in | Mitigated | Death% |')
  combatLines.push('|---|---|---:|---:|---:|---:|---:|')
  for (const u of targets.slice(0, 25)) {
    combatLines.push(
      `| ${u.name} | ${u.race} | ${u.avgTimesHit} | ${u.avgTimesTargeted} | ${u.avgDmgIn} | ${u.avgMitigated} | ${u.deathRate}% |`,
    )
  }
  combatLines.push('')
  combatLines.push('## Defensive abilities (damage mitigated while buff active)')
  combatLines.push('')
  combatLines.push('| Ability | Casts | Mitigated | Mit/game |')
  combatLines.push('|---|---:|---:|---:|')
  for (const a of saveAbilities.slice(0, 20)) {
    combatLines.push(`| ${a.name} | ${a.casts} | ${a.mitigated} | ${a.mitigatedPerGame} |`)
  }
  combatLines.push('')
  combatLines.push('## Abilities linked to kills (attacker had this buff when killing)')
  combatLines.push('')
  combatLines.push('| Ability | Casts | Kills | Kills/game |')
  combatLines.push('|---|---:|---:|---:|')
  for (const a of lethalAbilities.slice(0, 20)) {
    combatLines.push(`| ${a.name} | ${a.casts} | ${a.kills} | ${a.killsPerGame} |`)
  }
  combatLines.push('')
  combatLines.push('## Keywords linked to kills (attacker had keyword / soft flag when killing)')
  combatLines.push('')
  combatLines.push('| Keyword | Kills | Kills/game |')
  combatLines.push('|---|---:|---:|')
  for (const k of lethalKeywords.slice(0, 25)) {
    combatLines.push(`| ${k.name} | ${k.kills} | ${k.killsPerGame} |`)
  }
  combatLines.push('')
  combatLines.push('## By race')
  combatLines.push('')
  combatLines.push('| Race | Hit% | Avg atk | Avg dmg out | Avg dmg in | Avg kills | Avg kill VP |')
  combatLines.push('|---|---:|---:|---:|---:|---:|---:|')
  for (const race of races) {
    const c = combatByRaceFinal[race]
    if (!c?.games) continue
    combatLines.push(
      `| ${race} | ${c.hitRate}% | ${c.avgAttacks} | ${c.avgDamageDealt} | ${c.avgDamageTaken} | ${c.avgKills} | ${c.avgKillVp} |`,
    )
  }
  combatLines.push('')
  combatLines.push('## Most-cast abilities (n≥10)')
  combatLines.push('')
  combatLines.push('| Ability | Casts | /game | Kills | Mitigated |')
  combatLines.push('|---|---:|---:|---:|---:|')
  for (const a of abilityPerformance.slice(0, 30)) {
    combatLines.push(
      `| ${a.name} | ${a.casts} | ${a.castsPerGame} | ${a.kills} | ${a.mitigated} |`,
    )
  }
  combatLines.push('')
  writeFileSync(join(outDir, 'sim-combat-stats.md'), combatLines.join('\n'))

  process.stdout.write(JSON.stringify(payload, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})