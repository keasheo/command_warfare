import type { Ability } from '../../../api'
import { FormSection } from '../../ui/FormSection'
import { Field } from '../../ui/Field'
import { RADIUS_FROM_OPTIONS, type AbilityPatch } from '../abilityCost'

export function AbilityTargetingSection({
  draft,
  onPatch,
}: {
  draft: Ability
  onPatch: AbilityPatch
}) {
  const radiusFrom = draft.radiusFrom ?? ''
  const radiusFromOptions =
    radiusFrom &&
    !RADIUS_FROM_OPTIONS.includes(radiusFrom as (typeof RADIUS_FROM_OPTIONS)[number])
      ? [radiusFrom, ...RADIUS_FROM_OPTIONS]
      : [...RADIUS_FROM_OPTIONS]

  return (
    <FormSection
      title="Targeting"
      hint="Who is affected and whose radius applies. Officers affect only Combat Units of their company. Combat Unit abilities (e.g. Heal) may target any friendly model in Range."
    >
      <Field label="Affects" className="span-3">
        <input
          value={draft.affects ?? ''}
          onChange={(e) => onPatch('affects', e.target.value || null)}
          placeholder="e.g. army, company, self, enemy"
        />
      </Field>
      <Field label="Affect Count" className="span-3">
        <input
          value={draft.affectCount ?? ''}
          onChange={(e) =>
            onPatch(
              'affectCount',
              e.target.value.trim() ? Number(e.target.value) : null,
            )
          }
        />
      </Field>
      <Field label="Radius From" className="span-3">
        <select
          value={radiusFrom}
          onChange={(e) => onPatch('radiusFrom', e.target.value || null)}
        >
          {radiusFromOptions.map((value) => (
            <option key={value || 'none'} value={value}>
              {value || '—'}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Radius Size" className="span-3">
        <input
          value={draft.radiusSize ?? ''}
          onChange={(e) =>
            onPatch(
              'radiusSize',
              e.target.value.trim() ? Number(e.target.value) : null,
            )
          }
          placeholder="Leave blank to use printed Command Radius"
        />
      </Field>
    </FormSection>
  )
}
