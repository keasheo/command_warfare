/** Shared game design constants for Command Warfare. */
export const MINIMUM_COMMANDER_CC_GENERATION = 5
export const MINIMUM_COMMANDER_RADIUS = 5
export const MAXIMUM_COMMANDER_RADIUS = 7
export const MINIMUM_OFFICER_RADIUS = 3
export const MAXIMUM_OFFICER_RADIUS = 5

/** Max ability rows on a printed card (regular abilities + ultimate). */
export const MAX_CARD_ABILITIES = 5

/** Units may have at most this many Passive abilities. */
export const MAXIMUM_UNIT_PASSIVES = 2

/** Printed ability text budget (fits card face; matches KingdomsBuilder validation). */
export const MAXIMUM_ABILITY_DESCRIPTION_LENGTH = 175

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

/** Matches KingdomsBuilder portrait panel (ART_PANEL_WIDTH × ART_PANEL_HEIGHT). */
export const CARD_ART_WIDTH = 464
export const CARD_ART_HEIGHT = 390
export const CARD_ART_MAX_BYTES = 2 * 1024 * 1024 // 2 MB

export const CARD_ART_FORMATS = 'png / jpg / webp' as const

export function cardArtRequirementText(): string {
  const maxMb = CARD_ART_MAX_BYTES / (1024 * 1024)
  return `Stored at ${CARD_ART_WIDTH}×${CARD_ART_HEIGHT} px · max ${maxMb} MB · ${CARD_ART_FORMATS}`
}

export function countCardAbilitySlots(
  abilities: string[],
  ultimate?: string | null,
): number {
  return abilities.length + (ultimate?.trim() ? 1 : 0)
}
