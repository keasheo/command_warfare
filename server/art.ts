/**
 * Card artwork stored as data/art/{cardId}.{ext}
 */
import { imageSize } from 'image-size'
import fs from 'node:fs'
import path from 'node:path'
import {
  CARD_ART_HEIGHT,
  CARD_ART_MAX_BYTES,
  CARD_ART_WIDTH,
} from './constants.ts'
import { DATA_DIR } from './db.ts'

export const ART_DIR = path.join(DATA_DIR, 'art')
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

export function ensureArtDir(): void {
  fs.mkdirSync(ART_DIR, { recursive: true })
}

export function artPathFor(cardId: string): string | null {
  ensureArtDir()
  for (const ext of IMAGE_EXTENSIONS) {
    const candidate = path.join(ART_DIR, `${cardId}${ext}`)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

export function hasArt(cardId: string): boolean {
  return artPathFor(cardId) != null
}

export function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

export function clearCardArt(cardId: string): boolean {
  let removed = false
  for (const ext of IMAGE_EXTENSIONS) {
    const candidate = path.join(ART_DIR, `${cardId}${ext}`)
    if (fs.existsSync(candidate)) {
      fs.unlinkSync(candidate)
      removed = true
    }
  }
  return removed
}

function normalizeExtension(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase()
  if (!IMAGE_EXTENSIONS.includes(ext as (typeof IMAGE_EXTENSIONS)[number])) {
    throw new Error(
      `Unsupported image type '${ext || '(none)'}'. Use png, jpg, jpeg, or webp.`,
    )
  }
  return ext
}

export function setCardArtFromBuffer(
  cardId: string,
  buffer: Buffer,
  originalName: string,
): string {
  if (buffer.length > CARD_ART_MAX_BYTES) {
    throw new Error(
      `Image file is too large (${Math.ceil(buffer.length / 1024)} KB). Max ${CARD_ART_MAX_BYTES / 1024} KB.`,
    )
  }
  const ext = normalizeExtension(originalName)
  let dimensions: { width?: number; height?: number }
  try {
    dimensions = imageSize(buffer)
  } catch {
    throw new Error('Could not read image dimensions. Use a valid png, jpg, or webp.')
  }
  const width = dimensions.width ?? 0
  const height = dimensions.height ?? 0
  if (width !== CARD_ART_WIDTH || height !== CARD_ART_HEIGHT) {
    throw new Error(
      `Image must be ${CARD_ART_WIDTH}×${CARD_ART_HEIGHT} px (got ${width}×${height}). The UI normally resizes uploads automatically.`,
    )
  }
  ensureArtDir()
  clearCardArt(cardId)
  const destination = path.join(ART_DIR, `${cardId}${ext}`)
  fs.writeFileSync(destination, buffer)
  return destination
}

export function copyArtIfPresent(cardId: string, sourceArtDir: string): boolean {
  if (!fs.existsSync(sourceArtDir)) return false
  for (const ext of IMAGE_EXTENSIONS) {
    const source = path.join(sourceArtDir, `${cardId}${ext}`)
    if (!fs.existsSync(source)) continue
    ensureArtDir()
    clearCardArt(cardId)
    fs.copyFileSync(source, path.join(ART_DIR, `${cardId}${ext}`))
    return true
  }
  return false
}
