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
  commandRadius: number | null
  apGeneration: number | null
  ccGeneration: number | null
  abilities: string[]
  ultimate: string | null
  flavorText: string | null
  complexity: number | null
  role: string | null
  tags: string[]
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
  tags: string[]
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
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.error || `Request failed (${response.status})`)
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
  abilities: (params: Record<string, string> = {}) => {
    const q = new URLSearchParams(params)
    return request<{ abilities: Ability[] }>(`/api/abilities?${q}`)
  },
  saveAbility: (ability: Ability) =>
    request<{ ability: Ability }>(`/api/abilities/${encodeURIComponent(ability.name)}`, {
      method: 'PUT',
      body: JSON.stringify(ability),
    }),
  document: (slug: string) =>
    request<{ slug: string; title: string; document: DocPayload }>(`/api/docs/${slug}`),
  importYaml: () =>
    request<{ cards: number; abilities: number; documents: number; source: string }>(
      '/api/import',
      { method: 'POST', body: '{}' },
    ),
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
