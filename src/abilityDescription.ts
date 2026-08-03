/** Matches server/constants.ts MAXIMUM_ABILITY_DESCRIPTION_LENGTH */
export const MAXIMUM_ABILITY_DESCRIPTION_LENGTH = 175

/** Collapse whitespace the same way the API validates on save. */
export function normalizedAbilityDescription(description: string | null | undefined): string {
  return (description ?? '').replace(/\s+/g, ' ').trim()
}

export function abilityDescriptionLength(description: string | null | undefined): number {
  return normalizedAbilityDescription(description).length
}

export function abilityDescriptionLimitError(
  description: string | null | undefined,
): string | null {
  const length = abilityDescriptionLength(description)
  if (length <= MAXIMUM_ABILITY_DESCRIPTION_LENGTH) return null
  return `Ability description is ${length} characters (max ${MAXIMUM_ABILITY_DESCRIPTION_LENGTH}).`
}
