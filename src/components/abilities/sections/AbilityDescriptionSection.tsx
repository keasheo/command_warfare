import type { Ability } from '../../../api'
import {
  MAXIMUM_ABILITY_DESCRIPTION_LENGTH,
  abilityDescriptionLength,
  abilityDescriptionLimitError,
} from '../../../abilityDescription'
import { FormSection } from '../../ui/FormSection'
import { Field } from '../../ui/Field'
import type { AbilityPatch } from '../abilityCost'

export function AbilityDescriptionSection({
  draft,
  onPatch,
}: {
  draft: Ability
  onPatch: AbilityPatch
}) {
  const descLength = abilityDescriptionLength(draft.description)
  const descOver = descLength > MAXIMUM_ABILITY_DESCRIPTION_LENGTH

  return (
    <FormSection title="Description" hint="Printed rules text on the card face.">
      <Field
        label={`Character count (${descLength}/${MAXIMUM_ABILITY_DESCRIPTION_LENGTH})`}
        className="span-3"
      >
        <textarea
          className={`ability-description-field${descOver ? ' field-invalid' : ''}`}
          rows={5}
          value={draft.description ?? ''}
          onChange={(e) => onPatch('description', e.target.value || null)}
        />
      </Field>
      {descOver ? (
        <div className="span-3">
          <p className="error" style={{ margin: 0 }}>
            {abilityDescriptionLimitError(draft.description)}
          </p>
        </div>
      ) : (
        <div className="span-3">
          <p className="muted" style={{ margin: 0 }}>
            Max {MAXIMUM_ABILITY_DESCRIPTION_LENGTH} characters (whitespace collapsed) so text fits the
            printed card.
          </p>
        </div>
      )}
    </FormSection>
  )
}
