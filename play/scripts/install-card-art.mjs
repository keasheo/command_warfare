import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { imageSize } from 'image-size'

const W = 464
const H = 390
const ART_DIR = path.resolve('data/art')
const ASSETS = path.resolve(
  process.env.USERPROFILE || '',
  '.cursor/projects/c-Users-keash-Projects-CommandWarfare/assets',
)

const jobs = [
  {
    id: 'e0e112a7d2639c9357b175ecc2a4de19',
    src: 'art-ashen-blood-sovereign.png',
    name: 'Ashen Blood Sovereign',
  },
  {
    id: '0b94539e77c44ccb9a329f636ed94649',
    src: 'art-imp-overseer.png',
    name: 'Imp Overseer',
  },
  {
    id: 'a9cc7ddf0ff54b34942b01932a207759',
    src: 'art-cinderlash-handler.png',
    name: 'Cinderlash Handler',
  },
  {
    id: '5838fd5d508348318e76afd70f7a0806',
    src: 'art-doom-cultist.png',
    name: 'Doom Cultist',
  },
  {
    id: 'f5030fd278ec4e27acc5025ca0a448b5',
    src: 'art-magma-spitter.png',
    name: 'Magma Spitter',
  },
  {
    id: '42821076dab445c0b1a42a5575b1828d',
    src: 'art-sulfur-piker.png',
    name: 'Sulfur Piker',
  },
]

fs.mkdirSync(ART_DIR, { recursive: true })

for (const job of jobs) {
  const input = path.join(ASSETS, job.src)
  if (!fs.existsSync(input)) {
    console.error('Missing', input)
    process.exit(1)
  }
  const out = path.join(ART_DIR, `${job.id}.png`)
  // Clear other extensions for this id
  for (const ext of ['.jpg', '.jpeg', '.webp', '.png']) {
    const p = path.join(ART_DIR, `${job.id}${ext}`)
    if (fs.existsSync(p)) fs.unlinkSync(p)
  }
  await sharp(input)
    .resize(W, H, { fit: 'cover', position: 'centre' })
    .png({ compressionLevel: 8 })
    .toFile(out)
  const buf = fs.readFileSync(out)
  const dim = imageSize(buf)
  console.log(
    `${job.name}: ${dim.width}x${dim.height} ${Math.round(buf.length / 1024)}KB → ${out}`,
  )
}

// Verify existing two arts as well
for (const id of [
  '37d107bcf39540c3a1adc73897e0bc68',
  '3033116103ed4ce78d8cb9d33fc44134',
]) {
  const p = path.join(ART_DIR, `${id}.png`)
  if (!fs.existsSync(p)) continue
  const dim = imageSize(fs.readFileSync(p))
  console.log(`existing ${id}: ${dim.width}x${dim.height}`)
}
