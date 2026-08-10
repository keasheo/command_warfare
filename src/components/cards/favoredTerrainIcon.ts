export type FavoredTerrainKind =
  | 'plains'
  | 'forest'
  | 'swamp'
  | 'desert'
  | 'volcanic'
  | 'mountains'
  | 'water'

const RACE_TO_TERRAIN: Record<string, FavoredTerrainKind> = {
  Human: 'plains',
  Construct: 'plains',
  Beastfolk: 'forest',
  Elf: 'forest',
  Undead: 'swamp',
  Lizardman: 'swamp',
  Dragon: 'volcanic',
  Demon: 'volcanic',
  Dwarf: 'mountains',
}

const KEYWORD_TO_TERRAIN: Record<string, FavoredTerrainKind> = {
  'Open Ground': 'plains',
  Woodwalker: 'forest',
  Bogstrider: 'swamp',
  Duneborn: 'desert',
  Ashborn: 'volcanic',
  Mountainborn: 'mountains',
  Deepwalker: 'water',
}

const TERRAIN_LABELS: Record<FavoredTerrainKind, string> = {
  plains: 'Plains',
  forest: 'Forest',
  swamp: 'Swamp',
  desert: 'Desert',
  volcanic: 'Volcanic',
  mountains: 'Mountains',
  water: 'Water',
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
  return value in TERRAIN_LABELS
}

export function favoredTerrainIconUrl(kind: FavoredTerrainKind): string {
  return `/terrain-icons/${kind}.png`
}

export function favoredTerrainTooltip(kind: FavoredTerrainKind): string {
  switch (kind) {
    case 'mountains':
      return 'Favored: Mountains (+1 Harden)'
    case 'forest':
      return 'Favored: Forest (ignore Forest ranged penalty)'
    case 'swamp':
      return 'Favored: Swamp (Guard)'
    case 'volcanic':
      return 'Favored: Volcanic (+1 Damage)'
    case 'water':
      return 'Favored: Water (+1 Move)'
    case 'desert':
      return 'Favored: Desert (+1 Hit)'
    default:
      return `Favored: ${TERRAIN_LABELS[kind]} (+1 Hit)`
  }
}
