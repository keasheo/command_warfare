import { useCallback, useEffect, useRef, useState } from 'react'
import { formatLogTimestamp, PLAY_WS_PATH, PLAY_WS_PORT } from '../../shared/constants'
import type { ClientAction, GameState, SeatId, ServerMessage } from '../../shared/types'

const STORAGE_TOKEN = 'cw-play-token'
const STORAGE_ROOM = 'cw-play-room'
const STORAGE_SEAT = 'cw-play-seat'
const STORAGE_NAME = 'cw-play-name'

export function clearPlaySessionStorage() {
  localStorage.removeItem(STORAGE_TOKEN)
  localStorage.removeItem(STORAGE_ROOM)
  localStorage.removeItem(STORAGE_SEAT)
}

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = location.hostname
  const isLocal =
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]'

  // HTTP on LAN/WAN: skip Vite proxy and hit play server directly (real remoteAddress).
  // HTTPS must use /ws proxy (wss); vite.config.ts forwards X-Forwarded-For for that path.
  if (location.protocol === 'http:' && !isLocal) {
    return `${proto}//${host}:${PLAY_WS_PORT}${PLAY_WS_PATH}`
  }

  return `${proto}//${location.host}/ws`
}

type ClientRoomAction = 'create' | 'join' | 'rejoin' | 'leave' | 'disconnect'

function logClientRoom(
  action: ClientRoomAction,
  roomCode: string,
  seat?: SeatId | null,
  ip?: string | null,
) {
  const ts = formatLogTimestamp()
  const seatPart = seat ? ` as ${seat}` : ''
  const ipPart = ip ? ` ip=${ip}` : ''
  switch (action) {
    case 'create':
      console.log(`[${ts}] [play] Created room ${roomCode}${seatPart}${ipPart}`)
      break
    case 'join':
      console.log(`[${ts}] [play] Joined room ${roomCode}${seatPart}${ipPart}`)
      break
    case 'rejoin':
      console.log(`[${ts}] [play] Rejoined room ${roomCode}${seatPart}${ipPart}`)
      break
    case 'leave':
      console.log(`[${ts}] [play] Left room ${roomCode}${ipPart}`)
      break
    case 'disconnect':
      console.log(`[${ts}] [play] Disconnected from room ${roomCode}${ipPart}`)
      break
  }
}

export function usePlaySocket() {
  const [state, setState] = useState<GameState | null>(null)
  const [seat, setSeat] = useState<SeatId | null>(null)
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(STORAGE_TOKEN))
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [yourIp, setYourIp] = useState<string | null>(null)
  const [playerIps, setPlayerIps] = useState<Partial<Record<SeatId, string>>>({})
  const wsRef = useRef<WebSocket | null>(null)
  const autoRejoinAttemptedRef = useRef(false)
  const skipAutoRejoinRef = useRef(false)
  const pendingRoomActionRef = useRef<ClientRoomAction | null>(null)
  const currentRoomRef = useRef<string | null>(null)

  const send = useCallback((action: ClientAction) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError('Not connected.')
      return
    }
    if (action.type === 'create') {
      pendingRoomActionRef.current = 'create'
    } else if (action.type === 'join') {
      pendingRoomActionRef.current = action.token ? 'rejoin' : 'join'
    }
    ws.send(JSON.stringify(action))
  }, [])

  const leaveRoom = useCallback(() => {
    skipAutoRejoinRef.current = true
    const roomCode = localStorage.getItem(STORAGE_ROOM)
    if (roomCode) {
      logClientRoom('leave', roomCode)
    }
    currentRoomRef.current = null
    clearPlaySessionStorage()

    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'leave' }))
    }

    setState(null)
    setSeat(null)
    setToken(null)
    setYourIp(null)
    setPlayerIps({})
    setError(null)
  }, [])

  const abandonSavedSession = useCallback(() => {
    skipAutoRejoinRef.current = true
    clearPlaySessionStorage()
    setToken(null)
    setError(null)
  }, [])

  useEffect(() => {
    const ws = new WebSocket(wsUrl())
    wsRef.current = ws
    ws.onopen = () => {
      setConnected(true)
      setError(null)
      
      // Auto-rejoin if we have saved session and haven't already rejoined
      const savedRoomCode = localStorage.getItem(STORAGE_ROOM)
      const savedToken = localStorage.getItem(STORAGE_TOKEN)
      const savedName = localStorage.getItem(STORAGE_NAME)
      
      if (savedRoomCode && savedToken && !autoRejoinAttemptedRef.current && !skipAutoRejoinRef.current) {
        autoRejoinAttemptedRef.current = true
        pendingRoomActionRef.current = 'rejoin'
        // Give the connection a moment to stabilize
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'join',
              roomCode: savedRoomCode,
              name: savedName || 'Guest',
              token: savedToken,
            }))
          }
        }, 100)
      }
    }
    ws.onclose = () => {
      setConnected(false)
      autoRejoinAttemptedRef.current = false
      if (currentRoomRef.current) {
        logClientRoom('disconnect', currentRoomRef.current)
        currentRoomRef.current = null
      }
    }
    ws.onerror = () => {
      setError('WebSocket error — is the play server running?')
    }
    ws.onmessage = (ev) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage
      } catch {
        return
      }
      if (msg.type === 'welcome') {
        setState(msg.state)
        setSeat(msg.seat)
        setToken(msg.token)
        setYourIp(msg.yourIp)
        localStorage.setItem(STORAGE_TOKEN, msg.token)
        localStorage.setItem(STORAGE_ROOM, msg.state.roomCode)
        localStorage.setItem(STORAGE_SEAT, msg.seat)
        const player = msg.state.players.find((p) => p.seat === msg.seat)
        if (player) {
          localStorage.setItem(STORAGE_NAME, player.name)
        }
        const action = pendingRoomActionRef.current ?? 'join'
        pendingRoomActionRef.current = null
        currentRoomRef.current = msg.state.roomCode
        logClientRoom(action, msg.state.roomCode, msg.seat, msg.yourIp)
        setError(null)
      } else if (msg.type === 'state') {
        setState(msg.state)
      } else if (msg.type === 'hostRoster') {
        setPlayerIps(msg.playerIps)
      } else if (msg.type === 'error') {
        setError(msg.message)
        // If error mentions token or room not found, clear saved session
        const errorLower = msg.message.toLowerCase()
        if (
          errorLower.includes('room not found') ||
          errorLower.includes('token') ||
          errorLower.includes('already started')
        ) {
          // Clear saved session after a delay so user can see the error
          setTimeout(() => {
            if (errorLower.includes('room not found')) {
              localStorage.removeItem('cw-play-token')
              localStorage.removeItem('cw-play-room')
              localStorage.removeItem('cw-play-seat')
            }
          }, 3000)
        }
      }
    }
    return () => {
      ws.close()
    }
  }, [])

  return {
    state,
    seat,
    token,
    connected,
    error,
    yourIp,
    playerIps,
    setError,
    send,
    leaveRoom,
    abandonSavedSession,
    clearPlaySessionStorage,
    savedRoom: localStorage.getItem(STORAGE_ROOM),
    savedSeat: localStorage.getItem(STORAGE_SEAT),
    savedName: localStorage.getItem(STORAGE_NAME),
  }
}
