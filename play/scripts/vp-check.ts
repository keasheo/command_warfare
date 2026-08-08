/**
 * Verify: claiming objectives does not end the game; VP scores after rounds.
 */
import {
  createEmptyRoomState,
  MAX_ROUNDS,
  VP_PER_OBJECTIVE,
  reduceAction,
  reduceJoin,
  type GameState,
} from '../shared/index.ts'

function basePlay(): GameState {
  let state = createEmptyRoomState('VPTEST', 2, true, 'human', null)
  let j = reduceJoin(state, 'A')
  if (!j.ok) throw new Error(j.error)
  state = j.state
  const a = j.seat!
  j = reduceJoin(state, 'B')
  if (!j.ok) throw new Error(j.error)
  state = j.state
  const b = j.seat!

  state = {
    ...state,
    phase: 'Play',
    round: 1,
    turnOrder: [a, b],
    activeSeat: a,
    scores: { [a]: 0, [b]: 0 },
    companiesActivatedThisRound: {},
    companyActivatedThisTurn: {},
    commanderActivatedThisRound: {},
    objectives: [
      {
        id: 'o1',
        col: 10,
        row: 10,
        controller: a,
        hexes: [{ col: 10, row: 10 }],
      },
      {
        id: 'o2',
        col: 20,
        row: 20,
        controller: a,
        hexes: [{ col: 20, row: 20 }],
      },
    ],
    // No living officers → endTurn immediately advances the round.
    units: [],
    winner: null,
    draw: false,
  }
  return state
}

let state = basePlay()
const a = state.turnOrder[0]!
const b = state.turnOrder[1]!

let r = reduceAction(state, a, { type: 'endTurn' })
if (!r.ok) throw new Error(r.error)
state = r.state

if (state.phase === 'Ended' && state.round < MAX_ROUNDS) {
  throw new Error('ended too early after first endTurn')
}

const expected = 2 * VP_PER_OBJECTIVE
if ((state.scores?.[a] ?? 0) !== expected) {
  throw new Error(
    `expected ${a} to have ${expected} VP after round 1, got ${state.scores?.[a]} (round=${state.round} phase=${state.phase})`,
  )
}
if ((state.scores?.[b] ?? 0) !== 0) {
  throw new Error(`expected ${b} to have 0 VP`)
}

while (state.phase === 'Play' && state.round <= MAX_ROUNDS) {
  const seat = state.activeSeat
  if (!seat) break
  r = reduceAction(state, seat, { type: 'endTurn' })
  if (!r.ok) throw new Error(r.error)
  state = r.state
  if (state.phase === 'Ended') break
}

if (state.phase !== 'Ended') throw new Error(`expected Ended, got ${state.phase}`)
if (state.winner !== a) throw new Error(`expected winner ${a}, got ${state.winner}`)
if (state.draw) throw new Error('should not be a draw')

console.log('VP_OK', {
  winner: state.winner,
  scores: state.scores,
  rounds: MAX_ROUNDS,
  vpPerObj: VP_PER_OBJECTIVE,
})
