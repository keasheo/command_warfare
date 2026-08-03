import type { Keyword, KeywordCardRef } from '../../../api'
import { FormSection } from '../../ui/FormSection'
import { Field } from '../../ui/Field'
import { TagsField } from '../../ui/TagsField'

export type KeywordPatch = <K extends keyof Keyword>(key: K, value: Keyword[K]) => void

export function KeywordIdentitySection({
  draft,
  isNew,
  usageCount,
  onPatch,
}: {
  draft: Keyword
  isNew: boolean
  usageCount: number
  onPatch: KeywordPatch
}) {
  return (
    <FormSection title="Identity" hint="Keyword name and classification tags.">
      <Field label="Name" className="span-3">
        <input
          value={draft.name}
          readOnly={!isNew}
          onChange={(e) => onPatch('name', e.target.value)}
          placeholder="Keyword name"
        />
      </Field>
      <Field label="Used by" className="span-3">
        <input
          value={usageCount === 1 ? '1 card' : `${usageCount} cards`}
          readOnly
        />
      </Field>
      <TagsField
        className="span-3"
        tags={draft.tags ?? []}
        placeholder="e.g. passive, movement"
        onChange={(tags) => onPatch('tags', tags)}
      />
    </FormSection>
  )
}

export function KeywordDescriptionSection({
  draft,
  onPatch,
  invalid,
}: {
  draft: Keyword
  onPatch: KeywordPatch
  invalid?: boolean
}) {
  return (
    <FormSection title="Rules text" hint="Full keyword definition shown in popovers and the rulebook.">
      <Field label="Description (required)" className="span-3">
        <textarea
          className={`keyword-description-field${invalid ? ' field-invalid' : ''}`}
          rows={5}
          value={draft.description ?? ''}
          onChange={(e) => onPatch('description', e.target.value || null)}
          placeholder="Keyword rules text…"
        />
      </Field>
      {invalid ? (
        <p className="error span-3" style={{ margin: 0 }}>
          Every keyword must have a rules description.
        </p>
      ) : null}
    </FormSection>
  )
}

export function KeywordUsageSection({
  usageCards,
}: {
  usageCards: KeywordCardRef[]
}) {
  return (
    <FormSection title="Usage" hint="Cards that reference this keyword in the library.">
      {usageCards.length ? (
        <div className="span-3">
          <ul className="keyword-usage-list">
            {usageCards.map((card) => (
              <li key={card.id}>
                {card.name}
                <span className="muted">
                  {' '}
                  · {[card.cardType, card.race, card.rarity].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="muted span-3" style={{ margin: 0 }}>
          No cards currently use this keyword — it can be deleted.
        </p>
      )}
    </FormSection>
  )
}
