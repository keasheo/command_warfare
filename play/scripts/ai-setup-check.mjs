import { createEmptyRoomState, reduceJoin, reduceAction } from '../shared/index.ts'
import {
  chooseBotAction,
  aiDisplayName,
  loadDemoArmy,
  enrichSubmitArmy,
} from '../server/aiBot.ts'
import { armyCardIds, loadCardSnapshots } from '../server/cards.ts'
import { defaultBattleLoadout, resolveArmy } from '../shared/army.ts'

let state = createEmptyRoomState('AITEST', 2, true, 'ai', 'medium')
let j = reduceJoin(state, 'Host')
if (!j.ok) throw new Error(j.error)
state = j.state
const host = j.seat
j = reduceJoin(state, aiDisplayName('medium'))
if (!j.ok) throw new Error(j.error)
state = {
  ...j.state,
  players: j.state.players.map((p) =>
    p.seat === j.seat ? { ...p, isAi: true } : p,
  ),
}
const ai = j.seat
console.log('seats', host, ai, 'phase', state.phase)

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
const cards = loadCardSnapshots(armyCardIds(demo.army))
const cardList = [...demo.cards]
for (const [id, c] of cards) {
  if (!cardList.some((x) => x.id === id)) cardList.push(c)
}
apply(host, { type: 'submitArmy', army: demo.army, cards: cardList })

for (let i = 0; i < 120; i++) {
  const hp = state.players.find((p) => p.seat === host)

  if (state.phase === 'Commanders' && hp && !hp.commanderReady) {
    apply(host, { type: 'readyCommander' })
  }
  if (state.phase === 'ForceSelect' && hp && !hp.forceSelectReady) {
    const lookup = new Map(cardList.map((c) => [c.id, c]))
    const resolved = resolveArmy(hp.army, lookup)
    const loadout = resolved.ok
      ? defaultBattleLoadout(resolved.army)
      : Object.fromEntries(hp.army.companies.map((co) => [co.officerCardId, 'deploy']))
    apply(host, { type: 'confirmForceSelect', battleLoadout: loadout })
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
    if (idx < 0) {
      apply(host, { type: 'confirmDeploy' })
    } else {
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

  if (state.phase === 'Play') break

  const act = chooseBotAction(state, ai, 'medium')
  if (!act) {
    console.log('AI idle at', state.phase, state.terrainStage, state.activeSeat)
    continue
  }
  apply(ai, act)
  console.log(i, act.type, state.phase, state.terrainStage || '', 'active', state.activeSeat)
}

console.log('FINAL', state.phase, 'units', state.units.length, 'active', state.activeSeat)
if (state.phase !== 'Play') throw new Error(`did not reach Play, got ${state.phase}`)

// Advance until AI's play turn, then take a few actions
for (let i = 0; i < 20 && state.phase === 'Play' && !state.winner; i++) {
  if (state.activeSeat === host) {
    apply(host, { type: 'endTurn' })
    console.log('host endTurn →', state.activeSeat)
    continue
  }
  if (state.activeSeat !== ai) break
  const playAct = chooseBotAction(state, ai, 'hard')
  if (!playAct) break
  apply(ai, playAct)
  console.log('AI play', playAct.type, '→ active', state.activeSeat)
  if (playAct.type === 'endTurn') break
}

console.log('SETUP_OK')
