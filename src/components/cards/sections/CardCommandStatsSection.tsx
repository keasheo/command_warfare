import type { Card } from '../../../api'
import { FormSection } from '../../ui/FormSection'
import { NumberField } from '../../ui/NumberField'

export function CardCommandStatsSection({
  draft,
  onPatch,
}: {
  draft: Card
  onPatch: <K extends keyof Card>(key: K, value: Card[K]) => void
}) {
  return (
    <FormSection
      title="Command & company"
      hint="Officer company pools, command radius, and generation values."
    >
      <NumberField
        label="Company AP"
        value={draft.companyAp}
        onChange={(v) => onPatch('companyAp', v)}
        min={0}
      />
      <NumberField
        label="Company UV"
        value={draft.companyCapacity}
        onChange={(v) => onPatch('companyCapacity', v)}
        min={0}
      />
      <NumberField
        label="Unit cap"
        value={draft.companyUnitCap}
        onChange={(v) => onPatch('companyUnitCap', v)}
        min={0}
        max={10}
      />
      <NumberField
        label="Cmd Radius"
        value={draft.commandRadius}
        onChange={(v) => onPatch('commandRadius', v)}
        min={
          draft.cardType === 'Commander' ? 5 : draft.cardType === 'Officer' ? 3 : 0
        }
        max={
          draft.cardType === 'Commander' ? 7 : draft.cardType === 'Officer' ? 5 : undefined
        }
      />
      <NumberField
        label="AP Gen"
        value={draft.apGeneration}
        onChange={(v) => onPatch('apGeneration', v)}
        min={0}
      />
      <NumberField
        label="CC Gen"
        value={draft.ccGeneration}
        onChange={(v) =>
          onPatch(
            'ccGeneration',
            draft.cardType === 'Commander' && (v == null || v < 5) ? 5 : v,
          )
        }
        min={draft.cardType === 'Commander' ? 5 : 0}
      />
    </FormSection>
  )
}
