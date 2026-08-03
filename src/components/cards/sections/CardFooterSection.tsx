import type { Card } from '../../../api'
import { FormSection } from '../../ui/FormSection'
import { Field } from '../../ui/Field'
import { TagsField } from '../../ui/TagsField'

export function CardFooterSection({
  draft,
  showUltimate,
  onPatch,
}: {
  draft: Card
  showUltimate: boolean
  onPatch: <K extends keyof Card>(key: K, value: Card[K]) => void
}) {
  return (
    <FormSection title="Extras" hint="Tags, flavor text, and internal card ID.">
      <TagsField
        className={showUltimate ? undefined : 'span-2'}
        tags={draft.tags ?? []}
        onChange={(tags) => onPatch('tags', tags)}
      />
      <Field label="Flavor Text" className="span-3">
        <textarea
          rows={3}
          value={draft.flavorText ?? ''}
          onChange={(e) => onPatch('flavorText', e.target.value || null)}
        />
      </Field>
      <Field label="Card ID" className="span-3">
        <input value={draft.id} readOnly />
      </Field>
    </FormSection>
  )
}
