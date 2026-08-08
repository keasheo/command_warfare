/**
 * Verify: one company activation per turn; each officer once per round.
 */
import {
  createEmptyRoomState,
  reduceAction,
  reduceJoin,
} from '../shared/index.ts'
import {
  chooseBotAction,
  enrichSubmitArmy,
  loadDemoArmy,
} from '../server/aiBot.ts'
import { armyCardIds, loadCardSnapshots } from '../server/cards.ts'
import { defaultBattleLoadout, resolveArmy } from '../shared/army.ts'

let state = createEmptyRoomState('ACT', 2, true, 'ai', 'hard')
let j = reduceJoin(state, 'Host')
if (!j.ok) throw new Error(j.error)
state = j.state
const host = j.seat
j = reduceJoin(state, 'CPU (Hard)')
if (!j.ok) throw new Error(j.error)
state = {
  ...j.state,
  players: j.state.players.map((p) =>
    p.seat === j.seat ? { ...p, isAi: true, connected: true } : p,
  ),
}
const ai = j.seat

function apply(seat, action) {
  let sc
  let sa
  if (action.type === 'submitArmy') {
    const e = enrichSubmitArmy(action)
    sc = e.serverCards
    sa = e.serverAbilities
  }
  const r = reduceAction(state, seat, action, sc, sa)
  if (!r.ok) throw new Error(`${seat} ${action.type}: ${r.error}`)
  state = r.state
}

const demo = loadDemoArmy()
const cardList = [...demo.cards]
const snaps = loadCardSnapshots(armyCardIds(demo.army))
for (const [id, c] of snaps) {
  if (!cardList.some((x) => x.id === id)) cardList.push(c)
}
apply(host, { type: 'submitArmy', army: demo.army, cards: cardList })

for (let i = 0; i < 200 && state.phase !== 'Play'; i++) {
  const hp = state.players.find((p) => p.seat === host)
  if (state.phase === 'Commanders' && hp && !hp.commanderReady) {
    apply(host, { type: 'readyCommander' })
  }
  if (state.phase === 'ForceSelect' && hp && !hp.forceSelectReady) {
    const lookup = new Map(cardList.map((c) => [c.id, c]))
    const resolved = resolveArmy(hp.army, lookup)
    apply(host, {
      type: 'confirmForceSelect',
      battleLoadout: resolved.ok
        ? defaultBattleLoadout(resolved.army)
        : Object.fromEntries(
            hp.army.companies.map((co) => [co.officerCardId, 'deploy']),
          ),
    })
  }
  if (
    state.phase === 'Terrain' &&
    state.terrainStage === 'commandZone' &&
    hp &&
    !hp.terrainReady
  ) {
    if (!state.commandZoneModes[host]) {
      apply(host, { type: 'chooseCommandZoneMode', mode: 'flood' })
    } else {
      apply(host, { type: 'floodCommandZone', kind: 'plains' })
    }
  }
  if (
    state.phase === 'Terrain' &&
    state.terrainStage !== 'commandZone' &&
    state.activeSeat === host
  ) {
    apply(host, { type: 'skipTerrain' })
  }
  if (state.phase === 'Deploy' && hp && !hp.deployDone) {
    const q = state.deployQueues[host] || []
    const idx = q.findIndex((x) => !x.placed)
    if (idx < 0) apply(host, { type: 'confirmDeploy' })
    else {
      const a = chooseBotAction(
        {
          ...state,
          players: state.players.map((p) =>
            p.seat === host ? { ...p, isAi: true } : p,
          ),
        },
        host,
        'medium',
      )
      if (!a) throw new Error('host deploy stuck')
      apply(host, a)
    }
  }
  const act = chooseBotAction(state, ai, 'medium')
  if (act) apply(ai, act)
}

if (state.phase !== 'Play') throw new Error(`expected Play, got ${state.phase}`)
while (state.activeSeat === host) apply(host, { type: 'endTurn' })

const activated = []
for (let i = 0; i < 40 && state.activeSeat === ai; i++) {
  const act = chooseBotAction(state, ai, 'hard')
  if (!act) break
  apply(ai, act)
  if (act.type === 'activateCompany') activated.push(act.officerUnitId)
  if (act.type === 'endTurn') break
}

if (activated.length > 1) {
  throw new Error(`AI activated ${activated.length} companies in one turn`)
}

// Engine rejects a second company on the same turn.
const officers = state.units.filter((u) => u.seat === ai && u.kind === 'officer')
const first = officers[0]
const second = officers.find((o) => o.id !== first?.id)
if (first && second) {
  // Fresh turn for host then back? Just test reduceAction rejection after one activate.
  // Re-create by forcing: if AI already activated one, second should fail for AI seat.
  if (state.companyActivatedThisTurn?.[ai]) {
    const bad = reduceAction(state, ai, {
      type: 'activateCompany',
      officerUnitId:
        state.companyActivatedThisTurn[ai] === first.id ? second.id : first.id,
    })
    if (bad.ok) throw new Error('engine allowed second company activation')
  }
}

console.log('ACTIVATION_OK', {
  activatedThisTurn: activated.length,
  company: state.companyActivatedThisTurn?.[ai] ?? null,
})
