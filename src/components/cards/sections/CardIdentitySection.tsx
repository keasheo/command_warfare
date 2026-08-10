import { maxKeywordsForRarity, type Card, type Settings } from '../../../api'
import { FormSection } from '../../ui/FormSection'
import { Field } from '../../ui/Field'

export function CardIdentitySection({
  draft,
  settings,
  onPatch,
  onCardTypeChange,
  onRarityChange,
}: {
  draft: Card
  settings: Settings | null
  onPatch: <K extends keyof Card>(key: K, value: Card[K]) => void
  onCardTypeChange: (cardType: string) => void
  onRarityChange: (rarity: string | null) => void
}) {
  return (
    <FormSection title="Identity" hint="Name, type, race, and classification.">
      <Field label="Name" className="span-2">
        <input value={draft.name} onChange={(e) => onPatch('name', e.target.value)} />
      </Field>
      <Field label="Card Type">
        <select value={draft.cardType} onChange={(e) => onCardTypeChange(e.target.value)}>
          {(settings?.cardTypes ?? []).map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </Field>
      <Field label="Rarity">
        <select
          value={draft.rarity ?? ''}
          onChange={(e) => onRarityChange(e.target.value || null)}
        >
          <option value="">—</option>
          {(settings?.rarities ?? []).map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </Field>
      <Field label="Unique">
        <select
          value={draft.unique ? 'true' : 'false'}
          onChange={(e) => onPatch('unique', e.target.value === 'true')}
        >
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      </Field>
      <Field label="Race">
        <select
          value={draft.race ?? ''}
          onChange={(e) => onPatch('race', e.target.value || null)}
        >
          <option value="">—</option>
          {(settings?.races ?? []).map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </Field>
      <Field label="Favored Terrain">
        <select
          value={draft.favoredTerrain ?? ''}
          onChange={(e) => onPatch('favoredTerrain', e.target.value || null)}
        >
          <option value="">—</option>
          <option value="plains">Plains</option>
          <option value="forest">Forest</option>
          <option value="swamp">Swamp</option>
          <option value="volcanic">Volcanic</option>
          <option value="mountains">Mountains</option>
          <option value="desert">Desert</option>
        </select>
      </Field>
      <Field label="Primary Type">
        <select
          value={draft.primaryType ?? ''}
          onChange={(e) => onPatch('primaryType', e.target.value || null)}
        >
          <option value="">—</option>
          {(settings?.primaryTypes ?? []).map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </Field>
      <Field label="Secondary Type">
        <select
          value={draft.secondaryType ?? ''}
          onChange={(e) => onPatch('secondaryType', e.target.value || null)}
        >
          <option value="">—</option>
          {(settings?.secondaryTypes ?? []).map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </Field>
      <Field label="Role">
        <select
          value={draft.role ?? ''}
          onChange={(e) => onPatch('role', e.target.value || null)}
        >
          <option value="">—</option>
          {(settings?.roles ?? []).map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </Field>
      <p className="muted span-3" style={{ margin: 0 }}>
        {draft.rarity || 'This rarity'} allows up to {maxKeywordsForRarity(draft.rarity)} keywords.
      </p>
    </FormSection>
  )
}
