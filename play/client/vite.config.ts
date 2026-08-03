import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDevHttps } from './devHttps'

const root = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(root, '../..')

/** Original client IP as seen by Vite (before the proxy hop to play server). */
function peerIp(req: IncomingMessage): string | undefined {
  const addr = req.socket?.remoteAddress
  if (!addr) return undefined
  return addr.startsWith('::ffff:') ? addr.slice(7) : addr
}

export default defineConfig(({ mode }) => {
  const useHttps = mode === 'https'
  const https = useHttps ? loadDevHttps() : undefined
  // Dual stack: HTTPS host on 5174, plain HTTP guests on 5175 (no cert warning).
  const port = useHttps ? 5174 : 5175

  return {
    plugins: [react()],
    root,
    resolve: {
      alias: {
        '@shared': path.resolve(root, '../shared'),
        '@cw': path.resolve(repoRoot, 'src'),
      },
    },
    server: {
      host: true,
      port,
      strictPort: true,
      https,
      fs: {
        allow: [repoRoot],
      },
      proxy: {
        '/ws': {
          target: 'ws://127.0.0.1:8788',
          ws: true,
          // Without this, play/server sees ip=127.0.0.1 for every client (phone, LAN, WAN).
          // Port-forward does not strip IPs — the local Vite→8788 hop does.
          xfwd: true,
          configure: (proxy) => {
            const forwardPeerIp = (
              proxyReq: { setHeader: (name: string, value: string) => void },
              req: IncomingMessage,
            ) => {
              const ip = peerIp(req)
              if (ip) proxyReq.setHeader('x-forwarded-for', ip)
            }
            proxy.on('proxyReqWs', forwardPeerIp)
            proxy.on('proxyReq', forwardPeerIp)
          },
        },
        '/api': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
      },
    },
  }
})
