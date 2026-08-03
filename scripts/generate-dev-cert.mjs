/**
 * Generate a local trusted HTTPS cert for Vite (localhost + LAN IPs).
 * Used by the HTTPS half of `npm run dev:play` (port 5174). Guests use HTTP :5175.
 * Requires mkcert: https://github.com/FiloSottile/mkcert
 *
 *   npm run cert:dev
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const certDir = path.join(root, 'certs')
const certFile = path.join(certDir, 'localhost.pem')
const keyFile = path.join(certDir, 'localhost-key.pem')

function findMkcert() {
  const fromPath = process.env.Path || process.env.PATH || ''
  const exts = process.platform === 'win32' ? ['.exe', ''] : ['']
  for (const dir of fromPath.split(path.delimiter)) {
    for (const ext of exts) {
      const candidate = path.join(dir, `mkcert${ext}`)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  // Common winget / scoop locations
  const home = os.homedir()
  const guesses = [
    path.join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', 'mkcert.exe'),
    path.join(home, 'scoop', 'shims', 'mkcert.exe'),
    '/usr/local/bin/mkcert',
  ]
  for (const g of guesses) if (fs.existsSync(g)) return g
  return null
}

function lanIpv4s() {
  const out = new Set()
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue
      if (a.internal) continue
      out.add(a.address)
    }
  }
  return [...out]
}

const mkcert = findMkcert()
if (!mkcert) {
  console.error('mkcert not found. Install it, then re-run:')
  console.error('  winget install FiloSottile.mkcert')
  console.error('  mkcert -install')
  console.error('  npm run cert:dev')
  process.exit(1)
}

fs.mkdirSync(certDir, { recursive: true })

try {
  execFileSync(mkcert, ['-install'], { stdio: 'inherit' })
} catch {
  console.warn('mkcert -install reported a warning (often fine on Windows).')
}

const hosts = ['localhost', '127.0.0.1', '::1', ...lanIpv4s()]
console.log('Generating cert for:', hosts.join(', '))

const tmpCert = path.join(certDir, '_tmp.pem')
const tmpKey = path.join(certDir, '_tmp-key.pem')
// mkcert writes "<first>+N.pem" — run from certDir with -cert-file/-key-file
execFileSync(
  mkcert,
  ['-cert-file', tmpCert, '-key-file', tmpKey, ...hosts],
  { stdio: 'inherit', cwd: certDir },
)
fs.renameSync(tmpCert, certFile)
fs.renameSync(tmpKey, keyFile)

console.log('')
console.log('Wrote:')
console.log(' ', certFile)
console.log(' ', keyFile)
console.log('')
console.log('Host HTTPS (with npm run dev:play): https://localhost:5174 on THIS PC')
console.log('                 (requires mkcert -install)')
console.log('')
console.log('LAN / phone guests: share http://YOUR_LAN_IP:5175 (HTTP — no cert warning)')
console.log('                    mkcert does NOT remove warnings on other devices.')
console.log('                    Do not share https://LAN_IP with guests.')
console.log('')
console.log('Re-run npm run cert:dev if your LAN IP changes (HTTPS SAN list).')
