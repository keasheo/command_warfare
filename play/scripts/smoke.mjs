import Database from 'better-sqlite3'
import WebSocket from 'ws'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.resolve(__dirname, '../../data/command-warfare.sqlite')

function loadDemoArmy() {
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true })
  const commanders = db
    .prepare(
      `SELECT id, name, card_type, rarity, unique_flag, race, uv, move, damage, range_value, toughness,
              company_capacity, company_unit_cap, command_radius
       FROM cards WHERE card_type = 'Commander' AND race IS NOT NULL AND uv IS NOT NULL
       ORDER BY uv ASC`,
    )
    .all()

  for (const cmd of commanders) {
    const officer = db
      .prepare(
        `SELECT id, name, card_type, rarity, unique_flag, race, uv, move, damage, range_value, toughness,
                company_capacity, company_unit_cap, command_radius
         FROM cards WHERE card_type = 'Officer' AND race = ? AND company_capacity > 0
         ORDER BY company_capacity DESC LIMIT 1`,
      )
      .get(cmd.race)
    const unit = db
      .prepare(
        `SELECT id, name, card_type, rarity, unique_flag, race, uv, move, damage, range_value, toughness,
                company_capacity, company_unit_cap, command_radius
         FROM cards WHERE card_type = 'Unit' AND race = ? AND uv > 0
         ORDER BY uv ASC LIMIT 1`,
      )
      .get(cmd.race)
    if (!officer || !unit) continue
    const count = Math.max(
      1,
      Math.min(
        3,
        officer.company_unit_cap || 10,
        Math.floor(officer.company_capacity / unit.uv),
      ),
    )
    const snap = (row) => ({
      id: row.id,
      name: row.name,
      cardType: row.card_type,
      rarity: row.rarity ?? 'Common',
      unique: Boolean(row.unique_flag),
      race: row.race,
      uv: row.uv,
      move: row.move,
      damage: row.damage,
      range: row.range_value,
      toughness: row.toughness,
      companyCapacity: row.company_capacity,
      companyUnitCap: row.company_unit_cap ?? null,
      commandRadius: row.command_radius,
    })
    db.close()
    return {
      army: {
        commanderCardId: cmd.id,
        companies: [
          {
            officerCardId: officer.id,
            units: [{ cardId: unit.id, count }],
          },
        ],
      },
      cards: [snap(cmd), snap(officer), snap(unit)],
      placeCount: 1 + count,
    }
  }
  db.close()
  throw new Error('No valid demo army in SQLite')
}

function client() {
  const ws = new WebSocket('ws://127.0.0.1:8788/ws')
  const queue = []
  let waiter = null
  ws.on('message', (d) => {
    const m = JSON.parse(String(d))
    if (waiter) {
      const { pred, resolve } = waiter
      if (!pred || pred(m)) {
        waiter = null
        resolve(m)
        return
      }
    }
    queue.push(m)
  })
  async function open() {
    await new Promise((r) => ws.on('open', r))
  }
  function send(obj) {
    ws.send(JSON.stringify(obj))
  }
  function next(pred, ms = 8000) {
    return new Promise((resolve, reject) => {
      const idx = queue.findIndex((m) => !pred || pred(m))
      if (idx >= 0) {
        const [m] = queue.splice(idx, 1)
        resolve(m)
        return
      }
      const t = setTimeout(() => reject(new Error('timeout')), ms)
      waiter = {
        pred,
        resolve: (m) => {
          clearTimeout(t)
          resolve(m)
        },
      }
    })
  }
  function close() {
    ws.close()
  }
  return { open, send, next, close }
}

async function deploySeat(player, other, placeCount, preferredRow, boardSize) {
  let lastOfficer = null
  const mid = Math.floor((boardSize - 1) / 2)
  for (let qi = 0; qi < placeCount; qi++) {
    let placed = false
    const tryAround = (originCol, originRow) => {
      const spots = []
      for (let d = 0; d < 10; d++) {
        for (let dc = -d; dc <= d; dc++) {
          for (let dr = -d; dr <= d; dr++) {
            if (Math.max(Math.abs(dc), Math.abs(dr)) !== d) continue
            spots.push([originCol + dc, originRow + dr])
          }
        }
      }
      return spots
    }
    const origins = lastOfficer
      ? tryAround(lastOfficer.col, lastOfficer.row)
      : tryAround(mid, preferredRow)
    for (const [col, row] of origins) {
      if (placed) break
      if (col < 0 || row < 0 || col >= boardSize || row >= boardSize) continue
      player.send({ type: 'deploy', queueIndex: qi, col, row })
      const m = await player.next((x) => x.type === 'state' || x.type === 'error')
      if (m.type === 'error') continue
      placed = true
      const unit = m.state.units[m.state.units.length - 1]
      if (unit?.kind === 'officer') lastOfficer = unit
      await other.next((x) => x.type === 'state')
    }
    if (!placed) throw new Error(`Failed to place queue item ${qi}`)
  }
}

const demo = loadDemoArmy()
console.log(
  'Demo army',
  demo.cards.map((c) => c.name).join(' / '),
  `place=${demo.placeCount}`,
)

const a = client()
const b = client()
await a.open()
await b.open()

a.send({ type: 'create', name: 'Alice', maxPlayers: 2 })
const w1 = await a.next((m) => m.type === 'welcome')
console.log('Alice', w1.seat, w1.state.roomCode, w1.state.phase)

b.send({ type: 'join', roomCode: w1.state.roomCode, name: 'Bob' })
const w2 = await b.next((m) => m.type === 'welcome')
console.log('Bob', w2.seat, w2.state.phase)
await a.next((m) => m.type === 'state')

a.send({ type: 'submitArmy', army: demo.army, cards: demo.cards })
await a.next((m) => m.type === 'state' && m.state.players.find((p) => p.seat === w1.seat)?.armyReady)
await b.next((m) => m.type === 'state')

b.send({ type: 'submitArmy', army: demo.army, cards: demo.cards })
const forceA = await a.next((m) => m.type === 'state' && m.state.phase === 'ForceSelect')
await b.next((m) => m.type === 'state' && m.state.phase === 'ForceSelect')
console.log('Armies locked → ForceSelect (commanders auto-placed)')

const drawnObjectives = forceA.state.objectives ?? []
if (!drawnObjectives.length) {
  throw new Error('Expected objective zones after card draw')
}
const zoneCount = drawnObjectives.length
const expectedHexCount =
  zoneCount === 1 ? 5 : zoneCount === 2 ? 4 : 3
for (const o of drawnObjectives) {
  const hexCount = o.hexes?.length ?? 0
  if (hexCount !== expectedHexCount) {
    throw new Error(
      `Objective ${o.id}: card has ${zoneCount} zone(s), expected ${expectedHexCount} hexes each, got ${hexCount}`,
    )
  }
  const anchorInZone = o.hexes.some((h) => h.col === o.col && h.row === o.row)
  if (!anchorInZone) {
    throw new Error(`Objective ${o.id}: ★ anchor (${o.col},${o.row}) not in zone hexes`)
  }
}
if (zoneCount === 2) {
  const rel = (o) =>
    o.hexes
      .map((h) => `${h.col - o.col},${h.row - o.row}`)
      .sort()
      .join('|')
  if (rel(drawnObjectives[0]) === rel(drawnObjectives[1])) {
    throw new Error('Two-zone objective card should not produce identical footprints')
  }
}
console.log(
  'Objective zones',
  forceA.state.objectiveCardId,
  drawnObjectives.length,
  '×',
  expectedHexCount,
  'hexes',
)

function defaultLoadout(army) {
  const loadout = {}
  for (const co of army.companies) loadout[co.officerCardId] = 'deploy'
  return loadout
}

const loadout = defaultLoadout(demo.army)
a.send({ type: 'confirmForceSelect', battleLoadout: loadout })
await a.next((m) => m.type === 'state' && m.state.players.find((p) => p.seat === w1.seat)?.forceSelectReady)
await b.next((m) => m.type === 'state')

b.send({ type: 'confirmForceSelect', battleLoadout: loadout })
const terrainA = await a.next((m) => m.type === 'state' && m.state.phase === 'Terrain')
await b.next((m) => m.type === 'state' && m.state.phase === 'Terrain')
console.log('Terrain phase — personal CR placement')

async function choosePiecesMode(player, other) {
  player.send({ type: 'chooseCommandZoneMode', mode: 'pieces' })
  await player.next((x) => x.type === 'state' || x.type === 'error')
  await other.next((x) => x.type === 'state')
}

async function seatPlaceTerrain(player, other, seat, pieces, skipIndices = []) {
  await choosePiecesMode(player, other)
  let st = null
  for (let pieceNum = 0; pieceNum < pieces.length; pieceNum++) {
    const pieceId = pieces[pieceNum]
    player.send({ type: 'pickTerrain', pieceId })
    const pickMsg = await player.next((m) => m.type === 'state' || m.type === 'error')
    if (pickMsg.type === 'error') {
      throw new Error(
        `Failed pick for ${seat} #${pieceNum}: ${pickMsg.message ?? pickMsg.error ?? 'unknown'}`,
      )
    }
    st = pickMsg.state
    await other.next((m) => m.type === 'state')
    const handIndex =
      st.terrainHands?.[seat]?.findIndex(
        (q) => !q.placed && !q.skipped && !q.flooded,
      ) ?? -1
    if (handIndex < 0) {
      throw new Error(`No held piece after pick for ${seat} #${pieceNum}`)
    }

    if (skipIndices.includes(pieceNum)) {
      player.send({ type: 'skipTerrain' })
      const m = await player.next(
        (x) => x.type === 'state' || x.type === 'error',
      )
      if (m.type === 'error') {
        throw new Error(`Failed command-zone skip for ${seat} #${pieceNum}: ${m.error}`)
      }
      st = m.state
      await other.next((x) => x.type === 'state')
      continue
    }

    let placed = false
    const boardSize = st.boardSize || 35
    const deployDepth = 8
    for (let row = 0; row < deployDepth + 2 && !placed; row++) {
      for (let col = 0; col < boardSize && !placed; col++) {
        const tryRows =
          seat === 'N'
            ? [row, row + 1, row + 2]
            : [boardSize - 1 - row, boardSize - 2 - row, boardSize - 3 - row]
        for (const r of tryRows) {
          if (r < 0 || r >= boardSize) continue
          if (placed) break
          for (let rot = 0; rot < 6 && !placed; rot++) {
            player.send({
              type: 'placeTerrain',
              handIndex,
              col,
              row: r,
              rotation: rot,
            })
            const m = await player.next(
              (x) => x.type === 'state' || x.type === 'error',
            )
            if (m.type === 'error') continue
            placed = true
            st = m.state
            await other.next((x) => x.type === 'state')
          }
        }
      }
    }
    if (!placed) throw new Error(`Failed terrain place for ${seat} #${pieceNum}`)
  }
  return st
}

// 2P quota: 1 large + 2 medium + 2 small (shape-then-type piece ids)
const picksN = [
  'forest-peninsula',
  'plains-thicket',
  'forest-thicket',
  'plains-dot',
  'forest-pair',
]
const picksS = [
  'plains-peninsula',
  'forest-thicket',
  'swamp-thicket',
  'forest-dot',
  'swamp-dot',
]
await seatPlaceTerrain(a, b, w1.seat, picksN, [1])
const afterCmd = await seatPlaceTerrain(b, a, w2.seat, picksS, [4])
if (afterCmd.phase !== 'Terrain' || afterCmd.terrainStage !== 'landLarge') {
  throw new Error(
    `Expected landLarge after CR terrain, got ${afterCmd.phase}/${afterCmd.terrainStage}`,
  )
}
console.log('Land drops start — large')

const LAND_PIECES = {
  landLarge: ['forest-peninsula', 'plains-spur', 'swamp-jagged'],
  landMedium: ['forest-thicket', 'plains-hook', 'desert-blob'],
  landSmall: ['forest-pair', 'plains-dot', 'swamp-dot'],
}

async function expectObjectiveTerrainBlocked(state0, player) {
  const objHexes = drawnObjectives.flatMap((o) => o.hexes ?? [])
  if (!objHexes.length) throw new Error('No objective hex to test terrain block')
  const stage = state0.terrainStage
  const pieceId = LAND_PIECES[stage]?.[0]
  if (!pieceId) return
  let rejected = false
  for (const hex of objHexes) {
    for (let rot = 0; rot < 6 && !rejected; rot++) {
      player.send({
        type: 'placeTerrain',
        col: hex.col,
        row: hex.row,
        rotation: rot,
        pieceId,
      })
      const m = await player.next((x) => x.type === 'state' || x.type === 'error')
      const msg = m.message ?? m.error ?? ''
      if (m.type === 'error' && /objective/i.test(msg)) rejected = true
    }
  }
  if (!rejected) {
    throw new Error('Terrain placement on objective hex should be rejected')
  }
  console.log('Objective terrain block OK')
}

await expectObjectiveTerrainBlocked(
  afterCmd,
  afterCmd.activeSeat === w1.seat ? a : b,
)

async function runLandStage(state0, stage) {
  let st = state0
  while (st.phase === 'Terrain' && st.terrainStage === stage) {
    const active = st.activeSeat
    if (!active) throw new Error(`No active seat in ${stage}`)
    const player = active === w1.seat ? a : b
    const other = active === w1.seat ? b : a
    const idx = st.landDropsUsed?.[active] ?? 0
    if (idx >= 3) break
    const pieceId = LAND_PIECES[stage][idx % LAND_PIECES[stage].length]
    let placed = false
    for (let row = 8; row < 24 && !placed; row++) {
      for (let col = 8; col < 24 && !placed; col++) {
        for (let rot = 0; rot < 6 && !placed; rot++) {
          player.send({
            type: 'placeTerrain',
            col,
            row,
            rotation: rot,
            pieceId,
          })
          const m = await player.next(
            (x) => x.type === 'state' || x.type === 'error',
          )
          if (m.type === 'error') continue
          placed = true
          st = m.state
          await other.next((x) => x.type === 'state')
        }
      }
    }
    if (!placed) {
      player.send({ type: 'skipTerrain' })
      const m = await player.next((x) => x.type === 'state' || x.type === 'error')
      if (m.type === 'error') {
        throw new Error(`Land skip failed ${stage} ${active}: ${m.error}`)
      }
      st = m.state
      await other.next((x) => x.type === 'state')
    }
  }
  return st
}

let deployState = afterCmd
for (const stage of ['landLarge', 'landMedium', 'landSmall']) {
  deployState = await runLandStage(deployState, stage)
}
if (deployState.phase !== 'Deploy') {
  throw new Error(
    `Expected Deploy after land drops, got ${deployState.phase}/${deployState.terrainStage}`,
  )
}
console.log('CR + battlefield land done — deploy')
console.log(
  'Deploy',
  deployState.objectiveCardId,
  'queue',
  deployState.deployQueues[w1.seat]?.length,
  'terrain hexes',
  Object.keys(deployState.terrain || {}).length,
)

await deploySeat(a, b, deployState.deployQueues[w1.seat]?.length ?? demo.placeCount, 1, deployState.boardSize)
await deploySeat(b, a, deployState.deployQueues[w2.seat]?.length ?? demo.placeCount, deployState.boardSize - 2, deployState.boardSize)

if (deployState.boardSize !== 35) {
  throw new Error(`Expected 2P board 35×35, got ${deployState.boardSize}`)
}

a.send({ type: 'confirmDeploy' })
await a.next((m) => m.type === 'state')
await b.next((m) => m.type === 'state')
b.send({ type: 'confirmDeploy' })
const play = await a.next((m) => m.type === 'state' && m.state.phase === 'Play')
await b.next((m) => m.type === 'state' && m.state.phase === 'Play')
console.log(
  'Play active',
  play.state.activeSeat,
  'units',
  play.state.units.length,
  'sample',
  play.state.units.map((u) => u.cardName).slice(0, 4).join(', '),
)

console.log('SMOKE_OK')
a.close()
b.close()
process.exit(0)
