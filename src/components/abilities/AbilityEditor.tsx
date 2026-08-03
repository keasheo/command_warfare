import type { Ability } from '../../api'
import type { AbilityPatch } from './abilityCost'
import { AbilityCostSection } from './sections/AbilityCostSection'
import { AbilityDescriptionSection } from './sections/AbilityDescriptionSection'
import { AbilityIdentitySection } from './sections/AbilityIdentitySection'
import { AbilityTargetingSection } from './sections/AbilityTargetingSection'

export function AbilityEditor({
  draft,
  onPatch,
}: {
  draft: Ability
  onPatch: AbilityPatch
}) {
  return (
    <div className="editor-sections panel-scroll">
      <AbilityIdentitySection draft={draft} onPatch={onPatch} />
      <AbilityCostSection draft={draft} onPatch={onPatch} />
      <AbilityTargetingSection draft={draft} onPatch={onPatch} />
      <AbilityDescriptionSection draft={draft} onPatch={onPatch} />
    </div>
  )
}
