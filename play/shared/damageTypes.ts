/**
 * Damage-vs-type bonuses (stub).
 *
 * Future: spear/pike vs Mounted, anti-armor vs Heavy, etc.
 * Combat should call damageTypeBonus() from strikeDamage once the matrix is filled.
 */

export type DamageTypeTag =
  | 'Mounted'
  | 'Siege'
  | 'Infantry'
  | 'Spear'
  | 'Pike'
  | 'Heavy'
  | string

export type DamageTypeBonusRule = {
  /** Attacker must have at least one of these tags. */
  attackerTags: DamageTypeTag[]
  /** Defender must have at least one of these tags. */
  defenderTags: DamageTypeTag[]
  bonusDamage: number
}

/**
 * Example rules (not active until populated into DAMAGE_TYPE_RULES):
 * - { attackerTags: ['Spear', 'Pike'], defenderTags: ['Mounted'], bonusDamage: 1 }
 */
export const DAMAGE_TYPE_RULES: DamageTypeBonusRule[] = [
  // Intentionally empty until card tags are audited.
]

/** Collect combat type tags from a card/unit snapshot. */
export function damageTypeTagsFrom(card: {
  primaryType?: string | null
  secondaryType?: string | null
  keywords?: string[] | null
}): DamageTypeTag[] {
  const tags: DamageTypeTag[] = []
  if (card.primaryType) tags.push(card.primaryType)
  if (card.secondaryType) tags.push(card.secondaryType)
  for (const k of card.keywords ?? []) tags.push(k)
  return tags
}

/**
 * Extra damage from type matchups. Returns 0 until DAMAGE_TYPE_RULES is populated.
 */
export function damageTypeBonus(
  attackerTags: DamageTypeTag[],
  defenderTags: DamageTypeTag[],
): number {
  if (!DAMAGE_TYPE_RULES.length) return 0
  const atk = new Set(attackerTags.map((t) => t.toLowerCase()))
  const def = new Set(defenderTags.map((t) => t.toLowerCase()))
  let bonus = 0
  for (const rule of DAMAGE_TYPE_RULES) {
    const atkHit = rule.attackerTags.some((t) => atk.has(t.toLowerCase()))
    const defHit = rule.defenderTags.some((t) => def.has(t.toLowerCase()))
    if (atkHit && defHit) bonus += rule.bonusDamage
  }
  return bonus
}
