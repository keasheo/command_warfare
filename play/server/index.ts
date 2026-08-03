import http from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  PLAY_WS_PATH,
  PLAY_WS_PORT,
  createEmptyRoomState,
  formatGameLogLine,
  normalizeLoadedState,
  normalizeRoomCode,
  reduceAction,
  reduceJoin,
  reduceLeave,
  validateRoomCode,
  type ClientAction,
  type GameState,
  type SeatId,
  type ServerMessage,
} from '../shared/index.ts'
import {
  abilityNamesFromCards,
  armyCardIds,
  loadAbilityDefs,
  loadCardSnapshots,
} from './cards.ts'
import { clientIp, serverLog } from './log.ts'

type Client = {
  ws: WebSocket
  roomCode: string | null
  seat: SeatId | null
  token: string | null
  ip: string
}

type RoomData = {
  state: GameState
  lastActivityAt: number
}

/** Idle timeout in milliseconds (default 30 minutes). */
const ROOM_IDLE_MS =
  (Number(process.env.CW_ROOM_IDLE_MINUTES) || 30) * 60 * 1000

/** How often to check for idle rooms (5 minutes). */
const IDLE_CHECK_INTERVAL_MS = 5 * 60 * 1000

const rooms = new Map<string, RoomData>()
const clients = new Map<WebSocket, Client>()

type RoomMembershipAction = 'create' | 'join' | 'rejoin' | 'leave' | 'disconnect'

function logRoomMembership(
  action: RoomMembershipAction,
  roomCode: string,
  name: string,
  seat?: SeatId | null,
  ip?: string,
) {
  const seatPart = seat ? ` as ${seat}` : ''
  const ipOpt = ip !== undefined ? { ip } : undefined
  switch (action) {
    case 'create':
      serverLog('play', `${name} created room ${roomCode}${seatPart}`, ipOpt)
      break
    case 'join':
      serverLog('play', `${name} joined room ${roomCode}${seatPart}`, ipOpt)
      break
    case 'rejoin':
      serverLog('play', `${name} rejoined room ${roomCode}${seatPart}`, ipOpt)
      break
    case 'leave':
      serverLog('play', `${name} left room ${roomCode}${seatPart}`, ipOpt)
      break
    case 'disconnect':
      serverLog('play', `${name} disconnected from room ${roomCode}${seatPart}`, ipOpt)
      break
  }
}

function roomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return code
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}

function touchRoom(roomCode: string) {
  const room = rooms.get(roomCode)
  if (room) {
    room.lastActivityAt = Date.now()
  }
}

function broadcastRoom(roomCodeKey: string, state: GameState, except?: WebSocket) {
  rooms.set(roomCodeKey, { state, lastActivityAt: Date.now() })
  for (const [ws, c] of clients) {
    if (c.roomCode === roomCodeKey && ws !== except) {
      send(ws, { type: 'state', state })
    }
  }
}

function roomPlayerIps(roomCodeKey: string): Partial<Record<SeatId, string>> {
  const ips: Partial<Record<SeatId, string>> = {}
  for (const [, c] of clients) {
    if (c.roomCode === roomCodeKey && c.seat) {
      ips[c.seat] = c.ip
    }
  }
  return ips
}

/** Send seat→IP roster to the room host only (not broadcast to all players). */
function sendHostRoster(roomCodeKey: string) {
  const room = rooms.get(roomCodeKey)
  if (!room) return
  const playerIps = roomPlayerIps(roomCodeKey)
  for (const [ws, c] of clients) {
    if (
      c.roomCode === roomCodeKey &&
      c.seat === room.state.hostSeat &&
      ws.readyState === ws.OPEN
    ) {
      send(ws, { type: 'hostRoster', playerIps })
    }
  }
}

function detachClientFromRoom(client: Client) {
  if (!client.roomCode || !client.seat) return
  const code = client.roomCode
  const seat = client.seat
  const room = rooms.get(code)
  const name = room?.state.players.find((p) => p.seat === seat)?.name ?? seat
  client.roomCode = null
  client.seat = null
  client.token = null
  if (!room) return
  logRoomMembership('leave', code, name, seat, client.ip)
  const result = reduceLeave(room.state, seat)
  if (!result.ok) return
  room.state = result.state
  if (result.removed && result.state.players.length === 0) {
    rooms.delete(code)
  } else {
    broadcastRoom(code, result.state)
    sendHostRoster(code)
  }
}

function handleMessage(ws: WebSocket, raw: string) {
  const client = clients.get(ws)
  if (!client) return

  let action: ClientAction
  try {
    action = JSON.parse(raw) as ClientAction
  } catch {
    serverLog('play', 'Invalid JSON from client', {
      level: 'warn',
      ip: client.ip,
    })
    send(ws, { type: 'error', message: 'Invalid JSON.' })
    return
  }

  if (action.type === 'leave') {
    detachClientFromRoom(client)
    return
  }

  if (action.type === 'create') {
    detachClientFromRoom(client)
    let code: string
    const requested = action.roomCode?.trim()
    if (requested) {
      code = normalizeRoomCode(requested)
      const codeError = validateRoomCode(code)
      if (codeError) {
        send(ws, { type: 'error', message: codeError })
        return
      }
      if (rooms.has(code)) {
        send(ws, {
          type: 'error',
          message: 'Room code already in use. Choose another.',
        })
        return
      }
    } else {
      code = roomCode()
      while (rooms.has(code)) code = roomCode()
    }
    const maxPlayers = action.maxPlayers === 4 ? 4 : 2
    const enforceCommanderRace = action.enforceCommanderRace !== false
    let state = createEmptyRoomState(code, maxPlayers, enforceCommanderRace)
    const joined = reduceJoin(state, action.name)
    if (!joined.ok) {
      send(ws, { type: 'error', message: joined.error })
      return
    }
    state = joined.state
    rooms.set(code, { state, lastActivityAt: Date.now() })
    client.roomCode = code
    client.seat = joined.seat!
    client.token = joined.token!
    logRoomMembership('create', code, action.name, joined.seat, client.ip)
    send(ws, {
      type: 'welcome',
      token: joined.token!,
      seat: joined.seat!,
      state,
      yourIp: client.ip,
    })
    sendHostRoster(code)
    return
  }

  if (action.type === 'join') {
    const code = normalizeRoomCode(action.roomCode)
    if (client.roomCode && client.roomCode !== code) {
      detachClientFromRoom(client)
    }
    const room = rooms.get(code)
    if (!room) {
      send(ws, { type: 'error', message: 'Room not found.' })
      return
    }
    const isRejoin = Boolean(
      action.token && room.state.players.some((p) => p.token === action.token),
    )
    const joined = reduceJoin(room.state, action.name, action.token)
    if (!joined.ok) {
      send(ws, { type: 'error', message: joined.error })
      return
    }
    client.roomCode = code
    client.seat = joined.seat!
    client.token = joined.token!
    logRoomMembership(isRejoin ? 'rejoin' : 'join', code, action.name, joined.seat, client.ip)
    room.state = joined.state
    room.lastActivityAt = Date.now()
    send(ws, {
      type: 'welcome',
      token: joined.token!,
      seat: joined.seat!,
      state: joined.state,
      yourIp: client.ip,
    })
    broadcastRoom(code, joined.state, ws)
    sendHostRoster(code)
    return
  }

  if (action.type === 'ping') {
    send(ws, { type: 'pong' })
    if (client.roomCode) touchRoom(client.roomCode)
    return
  }

  if (!client.roomCode || !client.seat) {
    send(ws, { type: 'error', message: 'Join a room first.' })
    return
  }
  
  if (action.type === 'loadBoardState') {
    // Security: only allow load if sender is in the room
    const room = rooms.get(client.roomCode)
    if (!room) {
      send(ws, { type: 'error', message: 'Room gone.' })
      return
    }
    
    // Basic validation
    if (!action.state || typeof action.state !== 'object') {
      send(ws, { type: 'error', message: 'Invalid board state.' })
      return
    }
    
    // Preserve current room code
    const loadedState: GameState = normalizeLoadedState({
      ...action.state,
      roomCode: client.roomCode,
    })
    
    // Update connected status for currently connected players
    const currentPlayers = new Map<SeatId, boolean>()
    for (const [, c] of clients) {
      if (c.roomCode === client.roomCode && c.seat) {
        currentPlayers.set(c.seat, true)
      }
    }
    
    // Merge connected status with loaded state
    loadedState.players = loadedState.players.map((p) => ({
      ...p,
      connected: currentPlayers.has(p.seat) || p.connected,
    }))
    
    // Replace room state
    broadcastRoom(client.roomCode, loadedState)
    send(ws, { type: 'state', state: loadedState })
    
    serverLog('LoadBoard', `${client.seat} loaded board state in room ${client.roomCode}`, {
      ip: client.ip,
    })
    return
  }
  const room = rooms.get(client.roomCode)
  if (!room) {
    send(ws, { type: 'error', message: 'Room gone.' })
    return
  }

  let serverCards = undefined
  let serverAbilities = undefined
  if (action.type === 'submitArmy') {
    serverCards = loadCardSnapshots(armyCardIds(action.army))
    serverAbilities = loadAbilityDefs(abilityNamesFromCards(serverCards))
  }

  const result = reduceAction(
    room.state,
    client.seat,
    action,
    serverCards,
    serverAbilities,
  )
  if (!result.ok) {
    serverLog('play', `Action rejected (${action.type}): ${result.error}`, {
      level: 'warn',
      ip: client.ip,
    })
    send(ws, { type: 'error', message: result.error })
    return
  }
  broadcastRoom(client.roomCode, result.state)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)

  // Admin endpoints (localhost-only for security)
  if (url.pathname === '/admin/reset-rooms' && req.method === 'POST') {
    const count = rooms.size
    // Close all WebSocket clients
    for (const [ws, c] of clients) {
      if (c.roomCode) {
        try {
          ws.close(1000, 'Server reset all rooms')
        } catch {}
      }
    }
    rooms.clear()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, cleared: count }))
    serverLog('Admin', `Reset all rooms (${count} cleared)`)
    return
  }

  if (url.pathname.startsWith('/admin/reset-room/') && req.method === 'POST') {
    const code = normalizeRoomCode(url.pathname.slice('/admin/reset-room/'.length))
    const room = rooms.get(code)
    if (!room) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'Room not found' }))
      return
    }
    // Close WebSocket clients in this room
    for (const [ws, c] of clients) {
      if (c.roomCode === code) {
        try {
          ws.close(1000, 'Room reset by admin')
        } catch {}
      }
    }
    rooms.delete(code)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, code }))
    serverLog('Admin', `Reset room ${code}`)
    return
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('Command Warfare play server\n')
})

const wss = new WebSocketServer({ server, path: PLAY_WS_PATH })

wss.on('connection', (ws, req) => {
  const ip = clientIp(req)
  clients.set(ws, { ws, roomCode: null, seat: null, token: null, ip })
  serverLog('play', 'WebSocket connected', { ip })
  ws.on('message', (data) => {
    handleMessage(ws, String(data))
  })
  ws.on('close', () => {
    const c = clients.get(ws)
    clients.delete(ws)
    if (!c?.roomCode || !c.seat) {
      if (c) serverLog('play', 'WebSocket disconnected (no room)', { ip: c.ip })
      return
    }
    const room = rooms.get(c.roomCode)
    if (!room) return
    const player = room.state.players.find((p) => p.seat === c.seat)
    logRoomMembership(
      'disconnect',
      c.roomCode,
      player?.name ?? c.seat,
      c.seat,
      c.ip,
    )
    const players = room.state.players.map((p) =>
      p.seat === c.seat ? { ...p, connected: false } : p,
    )
    broadcastRoom(c.roomCode, {
      ...room.state,
      players,
      log: [...room.state.log.slice(-40), formatGameLogLine(`${c.seat} disconnected.`)],
    })
    sendHostRoster(c.roomCode)
  })
})

server.listen(PLAY_WS_PORT, '0.0.0.0', () => {
  serverLog('play', `WS listening on ws://0.0.0.0:${PLAY_WS_PORT}${PLAY_WS_PATH}`)
  serverLog('play', `HTTP admin on http://0.0.0.0:${PLAY_WS_PORT}`)
  serverLog('play', `Room idle timeout: ${ROOM_IDLE_MS / 1000 / 60} minutes`)
  serverLog(
    'play',
    'Player join/leave IPs log here (ip=…) — check this terminal, not browser DevTools',
  )
  serverLog(
    'play',
    'HTTPS clients use Vite /ws proxy (X-Forwarded-For); HTTP LAN may connect ws://HOST:8788/ws directly',
  )
})

/** Periodically close idle rooms. */
setInterval(() => {
  const now = Date.now()
  const toDelete: string[] = []
  for (const [code, room] of rooms) {
    if (now - room.lastActivityAt >= ROOM_IDLE_MS) {
      toDelete.push(code)
    }
  }
  if (toDelete.length > 0) {
    for (const code of toDelete) {
      // Close WebSocket clients in this room
      for (const [ws, c] of clients) {
        if (c.roomCode === code) {
          try {
            ws.close(1000, 'Room closed due to inactivity')
          } catch {}
        }
      }
      rooms.delete(code)
    }
    serverLog('Idle cleanup', `Closed ${toDelete.length} room(s): ${toDelete.join(', ')}`)
  }
}, IDLE_CHECK_INTERVAL_MS)
