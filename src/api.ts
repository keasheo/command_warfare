export type Card = {
  id: string
  name: string
  cardType: string
  rarity: string | null
  unique: boolean
  race: string | null
  primaryType: string | null
  secondaryType: string | null
  uv: number | null
  move: number | null
  damage: number | null
  range: number | null
  toughness: number | null
  companyAp: number | null
  companyCapacity: number | null
  /** Max unit models in this officer's company (not counting the officer). */
  companyUnitCap: number | null
  commandRadius: number | null
  apGeneration: number | null
  ccGeneration: number | null
  favoredTerrain: string | null
  abilities: string[]
  keywords: string[]
  ultimate: string | null
  flavorText: string | null
  complexity: number | null
  role: string | null
  tags: string[]
  supportedRaces: string[]
  supportedTypes: string[]
  supportedKeywords: string[]
  hasArt?: boolean
  artUrl?: string | null
}

export type Ability = {
  name: string
  type: string | null
  cost: string | null
  costAmount: number | null
  costResource: string | null
  description: string | null
  affects: string | null
  affectCount: number | null
  radiusFrom: string | null
  radiusSize: number | null
  usedBy: string | null
  /** Rounds before an Active can be used again. Passives ignore; Ultimates are once/battle. */
  cooldown: number | null
  tags: string[]
}

export type Keyword = {
  name: string
  description: string | null
  tags: string[]
  usageCount?: number
}

export type KeywordCardRef = {
  id: string
  name: string
  cardType: string
  race: string | null
  rarity: string | null
}

export class ApiError extends Error {
  status: number
  payload: Record<string, unknown>

  constructor(status: number, payload: Record<string, unknown>) {
    super(String(payload.error || `Request failed (${status})`))
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

export type Settings = {
  races: string[]
  rarities: string[]
  roles: string[]
  primaryTypes: string[]
  secondaryTypes: string[]
  cardTypes: string[]
}

export type Dashboard = {
  total: number
  abilityCount: number
  avgUv: number | null
  byType: { label: string; count: number }[]
  byRace: { label: string; count: number }[]
  byRarity: { label: string; count: number }[]
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
    throw new ApiError(response.status, payload)
  }
  return response.json() as Promise<T>
}

export const api = {
  dashboard: () => request<Dashboard>('/api/dashboard'),
  settings: () => request<Settings>('/api/settings'),
  saveRaces: (races: string[]) =>
    request<{ races: string[] }>('/api/settings/races', {
      method: 'PUT',
      body: JSON.stringify({ races }),
    }),
  cards: (params: Record<string, string>) => {
    const q = new URLSearchParams(params)
    return request<{ cards: Card[]; total: number }>(`/api/cards?${q}`)
  },
  card: (id: string) => request<{ card: Card }>(`/api/cards/${id}`),
  saveCard: (card: Card) =>
    request<{ card: Card }>(`/api/cards/${card.id}`, {
      method: 'PUT',
      body: JSON.stringify(card),
    }),
  createCard: (card: Partial<Card>) =>
    request<{ card: Card }>('/api/cards', {
      method: 'POST',
      body: JSON.stringify(card),
    }),
  deleteCard: (id: string) =>
    request<{ ok: boolean }>(`/api/cards/${id}`, { method: 'DELETE' }),
  uploadArt: async (id: string, file: File) => {
    const body = new FormData()
    body.append('art', file)
    const response = await fetch(`/api/cards/${id}/art`, {
      method: 'POST',
      body,
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.error || `Upload failed (${response.status})`)
    }
    return response.json() as Promise<{ card: Card }>
  },
  clearArt: (id: string) =>
    request<{ card: Card }>(`/api/cards/${id}/art`, { method: 'DELETE' }),
  abilities: (params: Record<string, string> = {}) => {
    const q = new URLSearchParams(params)
    return request<{ abilities: Ability[] }>(`/api/abilities?${q}`)
  },
  keywords: (params: Record<string, string> = {}) => {
    const q = new URLSearchParams(params)
    return request<{ keywords: Keyword[] }>(`/api/keywords?${q}`)
  },
  keywordUsage: (name: string) =>
    request<{ keyword: Keyword; usageCount: number; cards: KeywordCardRef[] }>(
      `/api/keywords/${encodeURIComponent(name)}/usage`,
    ),
  saveKeyword: (keyword: Keyword) =>
    request<{ keyword: Keyword }>(`/api/keywords/${encodeURIComponent(keyword.name)}`, {
      method: 'PUT',
      body: JSON.stringify(keyword),
    }),
  deleteKeyword: (name: string) =>
    request<{ ok: true; name: string }>(`/api/keywords/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),
  saveAbility: (ability: Ability) =>
    request<{ ability: Ability }>(`/api/abilities/${encodeURIComponent(ability.name)}`, {
      method: 'PUT',
      body: JSON.stringify(ability),
    }),
  document: (slug: string) =>
    request<{ slug: string; title: string; document: DocPayload }>(`/api/docs/${slug}`),
  importYaml: () =>
    request<{
      cards: number
      abilities: number
      keywords: number
      documents: number
      source: string
    }>('/api/import', { method: 'POST', body: '{}' }),
}

export type DocSection = {
  id?: string
  title?: string
  body?: string
  children?: DocSection[]
}

export type DocPayload = {
  title?: string
  sections?: DocSection[]
}

export function formatRange(value: number | null | undefined): string {
  if (value == null) return '—'
  if (value === 1) return 'Melee'
  return String(value)
}

/** True if the card has Adaptive Attack (Damage = current Toughness). */
export function hasAdaptiveAttack(card: {
  keywords?: string[] | null
  abilities?: string[] | null
}): boolean {
  const lists = [card.keywords ?? [], card.abilities ?? []]
  return lists.some((list) =>
    list.some((name) => String(name).trim() === 'Adaptive Attack'),
  )
}

/** Printed Damage: Adaptive Attack shows * instead of a fixed number. */
export function formatDamage(
  damage: number | null | undefined,
  card?: { keywords?: string[] | null; abilities?: string[] | null },
): string {
  if (card && hasAdaptiveAttack(card)) return '*'
  if (damage == null) return '—'
  return String(damage)
}

/** Matches KingdomsBuilder portrait panel. */
export const CARD_ART_WIDTH = 464
export const CARD_ART_HEIGHT = 390
export const CARD_ART_MAX_BYTES = 2 * 1024 * 1024

/** Max ability rows on a card (regular abilities + ultimate). */
export const MAX_CARD_ABILITIES = 5

/** Units may have at most this many Passive abilities. */
export const MAXIMUM_UNIT_PASSIVES = 2

/** Keyword budget by rarity (matches KingdomsBuilder rules.yaml). */
export const MAX_KEYWORDS_BY_RARITY: Record<string, number> = {
  Common: 1,
  Uncommon: 2,
  Rare: 2,
  Epic: 3,
  Legendary: 3,
}

export function maxKeywordsForRarity(rarity: string | null | undefined): number {
  return MAX_KEYWORDS_BY_RARITY[(rarity || '').trim()] ?? 2
}

export function countCardAbilitySlots(
  abilities: string[],
  ultimate?: string | null,
): number {
  return abilities.length + (ultimate?.trim() ? 1 : 0)
}

export function cardArtRequirementText(): string {
  const maxMb = CARD_ART_MAX_BYTES / (1024 * 1024)
  return `Fits to ${CARD_ART_WIDTH}×${CARD_ART_HEIGHT} px (auto crop) · max ${maxMb} MB · png / jpg / webp`
}

/** Resize/crop any image to the card art panel size before upload. */
export async function prepareCardArtFile(file: File): Promise<File> {
  if (file.size > CARD_ART_MAX_BYTES) {
    throw new Error(
      `Image file is too large (${Math.ceil(file.size / 1024)} KB). Max ${CARD_ART_MAX_BYTES / 1024} KB.`,
    )
  }
  if (!/\.(png|jpe?g|webp)$/i.test(file.name)) {
    throw new Error('Unsupported image type. Use png, jpg, jpeg, or webp.')
  }

  const bitmap = await createImageBitmap(file)
  try {
    if (bitmap.width === CARD_ART_WIDTH && bitmap.height === CARD_ART_HEIGHT) {
      return file
    }

    const canvas = document.createElement('canvas')
    canvas.width = CARD_ART_WIDTH
    canvas.height = CARD_ART_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Could not process image in this browser.')
    }

    const scale = Math.max(
      CARD_ART_WIDTH / bitmap.width,
      CARD_ART_HEIGHT / bitmap.height,
    )
    const drawW = bitmap.width * scale
    const drawH = bitmap.height * scale
    ctx.drawImage(
      bitmap,
      (CARD_ART_WIDTH - drawW) / 2,
      (CARD_ART_HEIGHT - drawH) / 2,
      drawW,
      drawH,
    )

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) =>
          result
            ? resolve(result)
            : reject(new Error('Could not encode resized image.')),
        'image/png',
      )
    })

    if (blob.size > CARD_ART_MAX_BYTES) {
      throw new Error(
        `Processed image is too large (${Math.ceil(blob.size / 1024)} KB). Max ${CARD_ART_MAX_BYTES / 1024} KB.`,
      )
    }

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'card-art'
    return new File([blob], `${baseName}.png`, { type: 'image/png' })
  } finally {
    bitmap.close()
  }
}

