/**
 * Smoke test: Unity-style network setup (submit army → force start → auto deploy).
 * Usage: node unity/CommandWarfare/scripts/networkSetupSmoke.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WS_URL = process.env.PLAY_WS ?? 'ws://127.0.0.1:8788/ws'
const PRESETS_PATH = path.resolve(__dirname, '../Assets/Data/quick-pick-armies-unity.json')

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function send(ws, obj) {
  ws.send(JSON.stringify(obj))
}

function parseState(msg) {
  if (msg.type === 'welcome') return msg.state
  if (msg.type === 'state') return msg.state
  return null
}

function playerFlags(state, seat) {
  const p = state.players?.find((x) => x.seat === seat)
  return p ?? {}
}

function deployQueues(state, seat) {
  return state.deployQueues?.[seat] ?? []
}

function loadPresetJson() {
  const doc = JSON.parse(fs.readFileSync(PRESETS_PATH, 'utf8'))
  const human = doc.presets.find((p) => p.race === 'Human')
  if (!human) throw new Error('No Human preset in quick-pick export')
  return human
}

function confirmForceSelectFromPreset(preset) {
  return JSON.parse(preset.confirmForceSelectJson)
}

async function main() {
  const preset = loadPresetJson()

  const ws = new WebSocket(WS_URL)
  let seat = null
  let state = null
  let token = null

  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw))
    if (msg.type === 'error') console.error('ERR', msg.message)
    const s = parseState(msg)
    if (s) {
      state = s
      console.log(`→ phase=${s.phase} round=${s.round ?? 0}`)
    }
    if (msg.type === 'welcome') {
      seat = msg.seat
      token = msg.token
    }
  })

  await new Promise((res, rej) => {
    ws.once('open', res)
    ws.once('error', rej)
  })

  send(ws, {
    type: 'create',
    name: 'SetupSmoke',
    opponent: 'ai',
    maxPlayers: 2,
    randomMap: true,
  })
  await sleep(400)

  send(ws, JSON.parse(preset.submitArmyJson))
  await sleep(600)

  for (let i = 0; i < 8 && state?.phase !== 'Play'; i++) {
    const flags = playerFlags(state, seat)
    if (
      (state.phase === 'ArmyBuild' || state.phase === 'Lobby') &&
      !flags.armyReady
    ) {
      send(ws, JSON.parse(preset.submitArmyJson))
    } else if (state.phase === 'ForceSelect' && !flags.forceSelectReady) {
      send(ws, confirmForceSelectFromPreset(preset))
    } else if (state.phase === 'Deploy' && !flags.deployDone) {
      const queue = deployQueues(state, seat)
      const idx = queue.findIndex((q) => !q.placed)
      if (idx >= 0) {
        const zone = state.boardSize
        const mid = Math.floor(zone / 2)
        send(ws, { type: 'deploy', queueIndex: idx, col: mid, row: 2 })
      } else {
        send(ws, { type: 'confirmDeploy' })
      }
    } else {
      send(ws, { type: 'forceStart' })
    }
    await sleep(500)
  }

  console.log('Final phase:', state?.phase, 'units:', state?.units?.length ?? 0)
  ws.close()
  if (state?.phase !== 'Play') process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
