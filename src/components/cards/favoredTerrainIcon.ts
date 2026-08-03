export type FavoredTerrainKind = 'plains' | 'forest' | 'swamp' | 'volcanic' | 'hills'

const RACE_TO_TERRAIN: Record<string, FavoredTerrainKind> = {
  Human: 'plains',
  Construct: 'plains',
  Beastfolk: 'forest',
  Elf: 'forest',
  Undead: 'swamp',
  Lizardman: 'swamp',
  Dragon: 'volcanic',
  Demon: 'volcanic',
  Dwarf: 'hills',
}

const KEYWORD_TO_TERRAIN: Record<string, FavoredTerrainKind> = {
  'Open Ground': 'plains',
  Woodwalker: 'forest',
  Bogstrider: 'swamp',
  Ashborn: 'volcanic',
  Hillborn: 'hills',
}

const TERRAIN_LABELS: Record<FavoredTerrainKind, string> = {
  plains: 'Plains',
  forest: 'Forest',
  swamp: 'Swamp',
  volcanic: 'Volcanic',
  hills: 'Hills',
}

export function resolveFavoredTerrain(
  favoredTerrain: string | null | undefined,
  race: string | null | undefined,
  keywords: string[] | null | undefined,
): FavoredTerrainKind | null {
  // Prefer explicit field
  if (favoredTerrain && isValidTerrainKind(favoredTerrain)) {
    return favoredTerrain as FavoredTerrainKind
  }
  // Fallback to keywords (legacy / special cases)
  for (const keyword of keywords ?? []) {
    const fromKeyword = KEYWORD_TO_TERRAIN[keyword]
    if (fromKeyword) return fromKeyword
  }
  // Fallback to race default
  if (race) {
    const fromRace = RACE_TO_TERRAIN[race]
    if (fromRace) return fromRace
  }
  return null
}

function isValidTerrainKind(value: string): boolean {
  return ['plains', 'forest', 'swamp', 'volcanic', 'hills', 'desert'].includes(value)
}

export function favoredTerrainIconUrl(kind: FavoredTerrainKind): string {
  return `/terrain-icons/${kind}.png`
}

export function favoredTerrainTooltip(kind: FavoredTerrainKind): string {
  return `Favored: ${TERRAIN_LABELS[kind]} (+1 Hit)`
}
