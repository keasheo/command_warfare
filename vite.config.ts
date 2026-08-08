import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const certFile = path.join(root, 'certs', 'localhost.pem')
const keyFile = path.join(root, 'certs', 'localhost-key.pem')
const https =
  fs.existsSync(certFile) && fs.existsSync(keyFile)
    ? { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }
    : undefined

export default defineConfig({
  plugins: [react()],
  // Explicit default so it stays distinct from play/client (`node_modules/.vite-play`).
  cacheDir: path.join(root, 'node_modules/.vite'),
  server: {
    host: true,
    port: 5173,
    https,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
})
