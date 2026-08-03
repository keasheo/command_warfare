import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const certFile = path.join(root, 'certs', 'localhost.pem')
const keyFile = path.join(root, 'certs', 'localhost-key.pem')

/**
 * Vite https options when certs/localhost*.pem exist.
 * Used by the HTTPS listener (`--mode https`, port 5174) in dual `dev:play`.
 * Guests should use the plain HTTP listener on port 5175 (no cert warning).
 */
export function loadDevHttps() {
  if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) return undefined
  return {
    cert: fs.readFileSync(certFile),
    key: fs.readFileSync(keyFile),
  }
}
