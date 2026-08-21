/**
 * Smoke test: Unity-style network setup through Play phase.
 * Usage: npx tsx unity/CommandWarfare/scripts/networkSetupSmoke.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { chooseBotAction } from '../../../play/server/aiBot.ts'
import type { GameState, SeatId } from '../../../play/shared/types.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WS_URL = process.env.PLAY_WS ?? 'ws://127.0.0.1:8788/ws'
const PRESETS_PATH = path.resolve(__dirname, '../Assets/Data/quick-pick-armies-unity.json')

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function send(ws: WebSocket, obj: unknown) {
  ws.send(JSON.stringify(obj))
}

function parseState(msg: { type?: string; state?: GameState }) {
  if (msg.type === 'welcome' || msg.type === 'state') return msg.state ?? null
  return null
}

function loadPresetJson() {
  const doc = JSON.parse(fs.readFileSync(PRESETS_PATH, 'utf8'))
  const human = doc.presets.find((p: { race: string }) => p.race === 'Human')
  if (!human) throw new Error('No Human preset in quick-pick export')
  return human as {
    submitArmyJson: string
    confirmForceSelectJson: string
  }
}

async function main() {
  const preset = loadPresetJson()
  const ws = new WebSocket(WS_URL)
  let seat: SeatId | null = null
  let state: GameState | null = null

  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw)) as {
      type?: string
      message?: string
      state?: GameState
      seat?: SeatId
    }
    if (msg.type === 'error') console.error('ERR', msg.message)
    const s = parseState(msg)
    if (s) {
      state = s
      console.log(`→ phase=${s.phase} round=${s.round ?? 0} units=${s.units?.length ?? 0}`)
    }
    if (msg.type === 'welcome') seat = msg.seat ?? null
  })

  await new Promise<void>((res, rej) => {
    ws.once('open', () => res())
    ws.once('error', rej)
  })

  send(ws, {
    type: 'create',
    name: 'SetupSmoke',
    opponent: 'ai',
    maxPlayers: 2,
    randomMap: true,
  })
  await sleep(500)

  send(ws, JSON.parse(preset.submitArmyJson))
  await sleep(700)

  for (let i = 0; i < 120 && state?.phase !== 'Play'; i++) {
    if (!state || !seat) {
      await sleep(200)
      continue
    }

    const player = state.players.find((p) => p.seat === seat)
    let action: ReturnType<typeof chooseBotAction> | { type: 'forceStart' } | null = null

    if (
      (state.phase === 'ArmyBuild' || state.phase === 'Lobby') &&
      player &&
      !player.armyReady
    ) {
      action = JSON.parse(preset.submitArmyJson)
    } else if (state.phase === 'ForceSelect' && player && !player.forceSelectReady) {
      action = JSON.parse(preset.confirmForceSelectJson)
    } else if (state.phase === 'Deploy' || state.phase === 'Terrain') {
      action = chooseBotAction(state, seat, 'medium')
    } else if (
      state.phase === 'ArmyBuild' ||
      state.phase === 'Commanders' ||
      state.phase === 'ForceSelect'
    ) {
      action = { type: 'forceStart' }
    }

    if (action) send(ws, action)
    await sleep(350)
  }

  console.log('Final:', state?.phase, 'units:', state?.units?.length ?? 0)
  ws.close()
  if (state?.phase !== 'Play') process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
