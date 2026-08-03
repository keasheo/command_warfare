import type { IncomingMessage } from 'node:http'
import { formatLogTimestamp } from '../shared/constants'

export { formatLogTimestamp }

/** Resolve client IP from an HTTP upgrade request (supports reverse proxies). */
export function clientIp(req?: IncomingMessage): string {
  if (!req) return 'unknown'

  // Set by Vite /ws proxy (xfwd + proxyReqWs) for clients hitting Vite :5174/:5175.
  const forwarded = req.headers['x-forwarded-for']
  if (forwarded) {
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded
    const first = raw.split(',')[0]?.trim()
    if (first) return normalizeIp(first)
  }

  const realIp = req.headers['x-real-ip']
  if (realIp) {
    const raw = Array.isArray(realIp) ? realIp[0] : realIp
    if (raw.trim()) return normalizeIp(raw.trim())
  }

  const addr = req.socket?.remoteAddress
  if (addr) return normalizeIp(addr)

  return 'unknown'
}

function normalizeIp(addr: string): string {
  if (addr.startsWith('::ffff:')) return addr.slice(7)
  return addr
}

type LogLevel = 'log' | 'warn' | 'error'

export function serverLog(
  tag: string,
  message: string,
  opts?: { level?: LogLevel; ip?: string | null },
) {
  const level = opts?.level ?? 'log'
  const ts = formatLogTimestamp()
  const ipPart =
    opts?.ip !== undefined ? ` ip=${opts.ip ?? 'unknown'}` : ''
  console[level](`[${ts}] [${tag}] ${message}${ipPart}`)
}
