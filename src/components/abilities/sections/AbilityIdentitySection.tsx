import type { Ability } from '../../../api'
import { FormSection } from '../../ui/FormSection'
import { Field } from '../../ui/Field'
import { TagsField } from '../../ui/TagsField'
import {
  USED_BY_OPTIONS,
  USED_BY_LABELS,
  describeAbilityTier,
  setAbilityType,
  type AbilityPatch,
} from '../abilityCost'

export function AbilityIdentitySection({
  draft,
  onPatch,
}: {
  draft: Ability
  onPatch: AbilityPatch
}) {
  const tierHint = describeAbilityTier(draft)

  return (
    <FormSection
      title="Identity"
      hint="Type + Used By set the ability tier. Card editors only list abilities legal for that card type."
    >
      <Field label="Name" className="span-3">
        <input value={draft.name} readOnly />
      </Field>
      <Field label="Type" className="span-3">
        <select
          value={draft.type ?? 'Active'}
          onChange={(e) => setAbilityType(draft, onPatch, e.target.value)}
        >
          {['Passive', 'Active', 'Ultimate'].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </Field>
      <Field label="Used By (tier)" className="span-3">
        <select
          value={draft.usedBy ?? ''}
          onChange={(e) => onPatch('usedBy', e.target.value || null)}
        >
          {USED_BY_OPTIONS.map((value) => (
            <option key={value || 'none'} value={value}>
              {USED_BY_LABELS[value]}
            </option>
          ))}
        </select>
      </Field>
      {tierHint ? (
        <p className="muted span-3" style={{ margin: 0 }}>
          {tierHint}
        </p>
      ) : null}
      <TagsField
        className="span-3"
        tags={draft.tags ?? []}
        onChange={(tags) => onPatch('tags', tags)}
      />
    </FormSection>
  )
}
