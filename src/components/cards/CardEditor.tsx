import { useMemo } from 'react'
import {
  MAX_CARD_ABILITIES,
  maxKeywordsForRarity,
  type Ability,
  type Card,
  type Keyword,
  type Settings,
} from '../../api'
import { orderedAbilityNames } from '../../abilityOrder'
import { abilityAllowedForCard } from '../../abilityAccess'
import { CardFace } from './CardFace'
import { CardAbilitiesSection } from './sections/CardAbilitiesSection'
import { CardArtSection } from './sections/CardArtSection'
import { CardCombatStatsSection } from './sections/CardCombatStatsSection'
import { CardCommandStatsSection } from './sections/CardCommandStatsSection'
import { CardFooterSection } from './sections/CardFooterSection'
import { CardIdentitySection } from './sections/CardIdentitySection'
import { CardKeywordsSection } from './sections/CardKeywordsSection'

export function CardEditor({
  draft,
  settings,
  abilityByName,
  keywordByName,
  artNonce,
  artPreviewUrl,
  artFileName,
  artUploading,
  onPatch,
  onError,
  onUploadArt,
  onClearArt,
}: {
  draft: Card
  settings: Settings | null
  abilityByName: Map<string, Ability>
  keywordByName: Map<string, Keyword>
  artNonce: number
  artPreviewUrl: string | null
  artFileName: string
  artUploading: boolean
  onPatch: <K extends keyof Card>(key: K, value: Card[K]) => void
  onError: (message: string) => void
  onUploadArt: (file: File | null) => void
  onClearArt: () => void
}) {
  const showUltimate = draft.cardType === 'Commander'
  const maxRegular = showUltimate ? MAX_CARD_ABILITIES - 1 : MAX_CARD_ABILITIES
  const maxKeywords = maxKeywordsForRarity(draft.rarity)

  const regularOptions = useMemo(() => {
    return [...abilityByName.values()]
      .filter((ability) =>
        abilityAllowedForCard(ability, draft.cardType, { slot: 'regular' }),
      )
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }, [abilityByName, draft.cardType])

  const ultimateOptions = useMemo(() => {
    return [...abilityByName.values()]
      .filter((ability) =>
        abilityAllowedForCard(ability, draft.cardType, { slot: 'ultimate' }),
      )
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }, [abilityByName, draft.cardType])

  const keywordCatalog = useMemo(() => {
    return [...keywordByName.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    )
  }, [keywordByName])

  const abilitySlots = useMemo(() => {
    const current = draft.abilities ?? []
    const slots = current.slice(0, maxRegular)
    while (slots.length < maxRegular) slots.push('')
    return slots
  }, [draft.abilities, maxRegular])

  const keywordSlots = useMemo(() => {
    const current = draft.keywords ?? []
    const slots = current.slice(0, maxKeywords)
    while (slots.length < maxKeywords) slots.push('')
    return slots
  }, [draft.keywords, maxKeywords])

  function setAbilitySlot(index: number, value: string) {
    const next = abilitySlots.map((slot, i) => (i === index ? value : slot))
    const cleaned = next.map((name) => name.trim()).filter(Boolean)
    const seen = new Set<string>()
    const unique = cleaned.filter((name) => {
      if (seen.has(name)) return false
      seen.add(name)
      return true
    })
    onError('')
    onPatch('abilities', orderedAbilityNames(unique, abilityByName))
  }

  function setKeywordSlot(index: number, value: string) {
    const next = keywordSlots.map((slot, i) => (i === index ? value : slot))
    const cleaned = next.map((name) => name.trim()).filter(Boolean)
    const seen = new Set<string>()
    const unique = cleaned.filter((name) => {
      if (seen.has(name)) return false
      seen.add(name)
      return true
    })
    if (unique.length > maxKeywords) {
      onError(`${draft.rarity || 'Card'} can have at most ${maxKeywords} keywords.`)
      onPatch('keywords', unique.slice(0, maxKeywords))
      return
    }
    onError('')
    onPatch('keywords', unique)
  }

  function setUltimate(value: string) {
    const nextUltimate = value.trim() || null
    if (nextUltimate && (draft.abilities ?? []).length > MAX_CARD_ABILITIES - 1) {
      onError(
        `Cards can have at most ${MAX_CARD_ABILITIES} abilities (including ultimate).`,
      )
      onPatch('abilities', (draft.abilities ?? []).slice(0, MAX_CARD_ABILITIES - 1))
    } else {
      onError('')
    }
    onPatch('ultimate', nextUltimate)
  }

  function setCardType(cardType: string) {
    const nextMax =
      cardType === 'Commander' ? MAX_CARD_ABILITIES - 1 : MAX_CARD_ABILITIES
    let nextAbilities = (draft.abilities ?? []).slice(0, nextMax)
    if (cardType !== 'Commander') {
      nextAbilities = nextAbilities.filter((name) => {
        const ability = abilityByName.get(name)
        return ability ? abilityAllowedForCard(ability, cardType, { slot: 'regular' }) : true
      })
    }
    const nextUltimate = cardType === 'Commander' ? draft.ultimate : null
    onPatch('cardType', cardType)
    if (nextUltimate !== draft.ultimate) onPatch('ultimate', nextUltimate)
    if (
      nextAbilities.length !== (draft.abilities ?? []).length ||
      nextAbilities.some((name, i) => name !== (draft.abilities ?? [])[i])
    ) {
      onPatch('abilities', nextAbilities)
    }
  }

  function setRarity(rarity: string | null) {
    onPatch('rarity', rarity)
    const nextMax = maxKeywordsForRarity(rarity)
    if ((draft.keywords ?? []).length > nextMax) {
      onError(`${rarity || 'Card'} can have at most ${nextMax} keywords.`)
      onPatch('keywords', (draft.keywords ?? []).slice(0, nextMax))
    }
  }

  return (
    <div className="panel-scroll">
      <CardFace
        card={draft}
        artNonce={artNonce}
        previewUrl={artPreviewUrl}
        abilityByName={abilityByName}
      />
      <div className="editor-sections">
        <CardArtSection
          draft={draft}
          artFileName={artFileName}
          artPreviewUrl={artPreviewUrl}
          artUploading={artUploading}
          onUploadArt={onUploadArt}
          onClearArt={onClearArt}
        />
        <CardIdentitySection
          draft={draft}
          settings={settings}
          onPatch={onPatch}
          onCardTypeChange={setCardType}
          onRarityChange={setRarity}
        />
        <CardCombatStatsSection draft={draft} onPatch={onPatch} />
        <CardCommandStatsSection draft={draft} onPatch={onPatch} />
        <CardKeywordsSection
          keywordSlots={keywordSlots}
          keywordCatalog={keywordCatalog}
          keywordByName={keywordByName}
          onSlotChange={setKeywordSlot}
        />
        <CardAbilitiesSection
          draft={draft}
          abilitySlots={abilitySlots}
          regularOptions={regularOptions}
          ultimateOptions={ultimateOptions}
          showUltimate={showUltimate}
          abilityByName={abilityByName}
          onAbilitySlotChange={setAbilitySlot}
          onUltimateChange={setUltimate}
        />
        <CardFooterSection draft={draft} showUltimate={showUltimate} onPatch={onPatch} />
      </div>
    </div>
  )
}
