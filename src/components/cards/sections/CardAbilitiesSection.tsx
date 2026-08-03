import type { Ability, Card } from '../../../api'
import { FormSection } from '../../ui/FormSection'
import { Field } from '../../ui/Field'
import { isUltimateAbility } from '../../../abilityAccess'
import { AbilitySelect, type AbilitySelectOption } from '../AbilitySelect'

export function CardAbilitiesSection({
  draft,
  abilitySlots,
  regularOptions,
  ultimateOptions,
  showUltimate,
  abilityByName,
  onAbilitySlotChange,
  onUltimateChange,
}: {
  draft: Card
  abilitySlots: string[]
  regularOptions: Ability[]
  ultimateOptions: Ability[]
  showUltimate: boolean
  abilityByName: Map<string, Ability>
  onAbilitySlotChange: (index: number, value: string) => void
  onUltimateChange: (value: string) => void
}) {
  return (
    <FormSection title="Abilities" hint="Regular ability slots and commander ultimate.">
      {abilitySlots.map((slotValue, index) => {
        const takenElsewhere = new Set(
          abilitySlots.filter((name, i) => i !== index && name.trim()),
        )
        const options: AbilitySelectOption[] = regularOptions.map((ability) => ({
          name: ability.name,
          ability,
          disabled: takenElsewhere.has(ability.name) && ability.name !== slotValue,
        }))
        if (slotValue && !options.some((option) => option.name === slotValue)) {
          const ability = abilityByName.get(slotValue)
          options.unshift({
            name: slotValue,
            ability,
            warning: ability
              ? isUltimateAbility(ability)
                ? 'ultimate — use Ultimate slot'
                : 'not for this card type'
              : 'missing from library',
          })
        }
        return (
          <Field key={`ability-${index}`} label={`Ability ${index + 1}`}>
            <AbilitySelect
              value={slotValue}
              options={options}
              onChange={(name) => onAbilitySlotChange(index, name)}
            />
          </Field>
        )
      })}
      {showUltimate ? (
        <Field label="Ultimate" className="span-2">
          <AbilitySelect
            value={draft.ultimate ?? ''}
            options={(() => {
              const options: AbilitySelectOption[] = ultimateOptions.map((ability) => ({
                name: ability.name,
                ability,
              }))
              if (
                draft.ultimate &&
                !options.some((option) => option.name === draft.ultimate)
              ) {
                const ability = abilityByName.get(draft.ultimate)
                options.unshift({
                  name: draft.ultimate,
                  ability,
                  warning: ability ? 'not an ultimate' : 'missing from library',
                })
              }
              return options
            })()}
            onChange={onUltimateChange}
            placeholder="Select ultimate…"
          />
        </Field>
      ) : null}
    </FormSection>
  )
}
