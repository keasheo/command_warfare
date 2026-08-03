import type { Ability } from '../../../api'
import { FormSection } from '../../ui/FormSection'
import { Field } from '../../ui/Field'
import {
  costOptionsForDraft,
  setAbilityCost,
  setAbilityCostAmount,
  setAbilityCostResource,
  type AbilityPatch,
} from '../abilityCost'

export function AbilityCostSection({
  draft,
  onPatch,
}: {
  draft: Ability
  onPatch: AbilityPatch
}) {
  const isPassive = (draft.type || '').trim() === 'Passive'
  const isUltimate = (draft.type || '').trim() === 'Ultimate'
  const costLocked = isPassive
  const costValue = draft.cost ?? ''
  const usedBy = (draft.usedBy || '').trim()
  const apPoolHint =
    usedBy === 'Commander'
      ? 'AP spends the Commander’s personal AP pool.'
      : usedBy === 'Officer' || usedBy === 'Both'
        ? 'AP spends Company AP from the Officer.'
        : 'AP on units is rare; prefer Company AP via Officers.'

  return (
    <FormSection
      title="Cost & cooldown"
      hint="Actives spend AP or CC. CC is Commander-only. Cooldown is optional extra gating after use."
    >
      <Field label="Cost">
        <select
          value={costValue}
          onChange={(e) => setAbilityCost(onPatch, e.target.value)}
          disabled={isPassive || isUltimate}
        >
          <option value="">—</option>
          {costOptionsForDraft(costValue).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Cost Amount (AP/CC)">
        <input
          value={draft.costAmount ?? ''}
          onChange={(e) => setAbilityCostAmount(draft, onPatch, e.target.value)}
          placeholder="e.g. 2"
          disabled={costLocked || isUltimate}
        />
      </Field>
      <Field label="Cost Resource">
        <select
          value={(draft.costResource || '').toUpperCase()}
          onChange={(e) => setAbilityCostResource(draft, onPatch, e.target.value)}
          disabled={costLocked || isUltimate}
        >
          <option value="">—</option>
          <option value="AP">AP</option>
          <option value="CC">CC (Commander only)</option>
        </select>
      </Field>
      {!isPassive && !isUltimate ? (
        <p className="muted span-3" style={{ margin: 0 }}>
          {apPoolHint}
        </p>
      ) : null}
      <Field label="Cooldown (rounds, optional)" className="span-3">
        <input
          value={draft.cooldown ?? ''}
          onChange={(e) =>
            onPatch(
              'cooldown',
              e.target.value.trim() ? Number(e.target.value) : null,
            )
          }
          placeholder="Actives only — leave blank if none"
          disabled={costLocked}
        />
      </Field>
    </FormSection>
  )
}
