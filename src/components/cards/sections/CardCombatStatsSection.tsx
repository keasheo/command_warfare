import type { Card } from '../../../api'
import { FormSection } from '../../ui/FormSection'
import { Field } from '../../ui/Field'
import { NumberField, numOrNull } from '../../ui/NumberField'

const RANGE_OPTIONS = [
  { value: '', label: '—' },
  { value: '1', label: 'Melee' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
] as const

export function CardCombatStatsSection({
  draft,
  onPatch,
}: {
  draft: Card
  onPatch: <K extends keyof Card>(key: K, value: Card[K]) => void
}) {
  return (
    <FormSection title="Combat stats" hint="Core unit values printed on the card.">
      <NumberField label="UV" value={draft.uv} onChange={(v) => onPatch('uv', v)} min={0} />
      <NumberField label="Move" value={draft.move} onChange={(v) => onPatch('move', v)} min={0} />
      <NumberField
        label="Damage"
        value={draft.damage}
        onChange={(v) => onPatch('damage', v)}
        min={0}
      />
      <Field label="Range">
        <select
          value={draft.range == null ? '' : String(draft.range)}
          onChange={(e) => onPatch('range', numOrNull(e.target.value))}
        >
          {RANGE_OPTIONS.map((option) => (
            <option key={option.value || 'empty'} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      <NumberField
        label="Toughness"
        value={draft.toughness}
        onChange={(v) => onPatch('toughness', v)}
        min={0}
      />
      <NumberField
        label="Complexity"
        value={draft.complexity}
        onChange={(v) => onPatch('complexity', v)}
        min={1}
        max={5}
      />
    </FormSection>
  )
}
