/**
 * Install generated card art into data/art at 464×390.
 * Usage: node play/scripts/install-art-batch.mjs [race] [queueJson]
 * Looks for assets named card-{id}.png under the Cursor assets folder
 * (and optional play/scripts/art-staging/).
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { imageSize } from 'image-size'

const W = 464
const H = 390
const ART_DIR = path.resolve('data/art')
const raceFilter = process.argv[2] || null
const queuePath = path.resolve(
  process.argv[3] || 'play/scripts/art-queue-remaining.json',
)
const fallbackQueue = path.resolve('play/scripts/art-queue.json')

function loadQueue() {
  const paths = [queuePath, fallbackQueue]
  const cards = []
  const seen = new Set()
  for (const p of paths) {
    if (!fs.existsSync(p)) continue
    const data = JSON.parse(fs.readFileSync(p, 'utf8'))
    for (const c of data.cards || []) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      cards.push(c)
    }
  }
  return cards
}

const QUEUE_CARDS = loadQueue()
const searchDirs = [
  path.resolve(
    process.env.USERPROFILE || '',
    '.cursor/projects/c-Users-keash-Projects-CommandWarfare/assets',
  ),
  path.resolve('play/scripts/art-staging'),
]

fs.mkdirSync(ART_DIR, { recursive: true })
fs.mkdirSync(path.resolve('play/scripts/art-staging'), { recursive: true })

const cards = QUEUE_CARDS.filter((c) => {
  if (!raceFilter) return true
  return (c.race || 'Unknown') === raceFilter
})
let installed = 0
let missing = 0
const missingIds = []

for (const card of cards) {
  const destExists = ['.png', '.jpg', '.jpeg', '.webp'].some((ext) =>
    fs.existsSync(path.join(ART_DIR, `${card.id}${ext}`)),
  )
  if (destExists) {
    installed++
    continue
  }

  let src = null
  for (const dir of searchDirs) {
    const candidate = path.join(dir, `card-${card.id}.png`)
    if (fs.existsSync(candidate)) {
      src = candidate
      break
    }
  }
  if (!src) {
    missing++
    missingIds.push(card.id)
    continue
  }

  for (const ext of ['.jpg', '.jpeg', '.webp', '.png']) {
    const p = path.join(ART_DIR, `${card.id}${ext}`)
    if (fs.existsSync(p)) fs.unlinkSync(p)
  }
  const out = path.join(ART_DIR, `${card.id}.png`)
  await sharp(src)
    .resize(W, H, { fit: 'cover', position: 'centre' })
    .png({ compressionLevel: 8 })
    .toFile(out)
  const dim = imageSize(fs.readFileSync(out))
  if (dim.width !== W || dim.height !== H) {
    throw new Error(`Bad size for ${card.name}: ${dim.width}x${dim.height}`)
  }
  installed++
}

console.log(
  JSON.stringify(
    {
      race: raceFilter || 'all',
      queue: queuePath,
      installed,
      stillMissing: missing,
      missingSample: missingIds.slice(0, 10),
    },
    null,
    2,
  ),
)
