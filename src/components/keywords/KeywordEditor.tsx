import type { Keyword, KeywordCardRef } from '../../api'
import {
  KeywordDescriptionSection,
  KeywordIdentitySection,
  KeywordUsageSection,
  type KeywordPatch,
} from './sections/KeywordSections'

export function KeywordEditor({
  draft,
  isNew,
  usageCards,
  descriptionInvalid,
  onPatch,
}: {
  draft: Keyword
  isNew: boolean
  usageCards: KeywordCardRef[]
  descriptionInvalid?: boolean
  onPatch: KeywordPatch
}) {
  return (
    <div className="editor-sections panel-scroll">
      <KeywordIdentitySection
        draft={draft}
        isNew={isNew}
        usageCount={usageCards.length}
        onPatch={onPatch}
      />
      <KeywordDescriptionSection
        draft={draft}
        onPatch={onPatch}
        invalid={descriptionInvalid}
      />
      <KeywordUsageSection usageCards={usageCards} />
    </div>
  )
}
