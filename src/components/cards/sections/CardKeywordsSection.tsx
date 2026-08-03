import type { Keyword } from '../../../api'
import { FormSection } from '../../ui/FormSection'
import { Field } from '../../ui/Field'
import { CatalogSelect, type CatalogSelectOption } from '../AbilitySelect'

export function CardKeywordsSection({
  keywordSlots,
  keywordCatalog,
  keywordByName,
  onSlotChange,
}: {
  keywordSlots: string[]
  keywordCatalog: Keyword[]
  keywordByName: Map<string, Keyword>
  onSlotChange: (index: number, value: string) => void
}) {
  if (!keywordSlots.length) return null

  return (
    <FormSection title="Keywords" hint="Printed keyword rules on the card face.">
      {keywordSlots.map((slotValue, index) => {
        const takenElsewhere = new Set(
          keywordSlots.filter((name, i) => i !== index && name.trim()),
        )
        const options: CatalogSelectOption[] = []
        for (const keyword of keywordCatalog) {
          if (keyword.name === 'Harden') {
            for (const rank of [1, 2, 3]) {
              const printed = `Harden ${rank}`
              options.push({
                name: printed,
                description: keyword.description,
                meta: (keyword.tags ?? []).join(' · ') || undefined,
                disabled: takenElsewhere.has(printed) && printed !== slotValue,
              })
            }
            continue
          }
          options.push({
            name: keyword.name,
            description: keyword.description,
            meta: (keyword.tags ?? []).join(' · ') || undefined,
            disabled: takenElsewhere.has(keyword.name) && keyword.name !== slotValue,
          })
        }
        if (slotValue && !options.some((option) => option.name === slotValue)) {
          options.unshift({
            name: slotValue,
            description:
              keywordByName.get(slotValue)?.description ??
              (/^Harden \d+$/.test(slotValue)
                ? keywordByName.get('Harden')?.description
                : undefined),
            warning: 'not in library',
          })
        }
        return (
          <Field key={`keyword-${index}`} label={`Keyword ${index + 1}`}>
            <CatalogSelect
              value={slotValue}
              options={options}
              onChange={(name) => onSlotChange(index, name)}
              placeholder="Select keyword…"
            />
          </Field>
        )
      })}
    </FormSection>
  )
}
