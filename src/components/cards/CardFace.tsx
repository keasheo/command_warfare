import {
  formatDamage,
  formatRange,
  MAX_CARD_ABILITIES,
  type Ability,
  type Card,
} from '../../api'
import { orderedAbilityNames } from '../../abilityOrder'
import {
  formatAbilityCostLabel,
  resolveAbilityIconKind,
} from './abilityDisplay'
import { AbilityKindIcon } from './AbilityKindIcon'
import {
  favoredTerrainIconUrl,
  favoredTerrainTooltip,
  resolveFavoredTerrain,
} from './favoredTerrainIcon'
import { StatIcon } from './StatIcon'
import { CardBorderOrnament } from './CardBorderOrnament'
import './card-face.css'

function RarityAlpha({ rarity }: { rarity: string }) {
  const rarityColors: Record<string, string> = {
    common: '#1a1a1a',
    uncommon: '#a8a9ad',
    rare: '#d4af37',
    epic: '#ea580c',
    legendary: '#7c3aed',
  }
  const fillColor = rarityColors[rarity.toLowerCase()] || rarityColors.common

  return (
    <svg
      className="kb-rarity-alpha"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 4L17.5 20H14.8L13.5 16H10.5L9.2 20H6.5L12 4ZM12 9.5L10.8 13.5H13.2L12 9.5Z"
        fill={fillColor}
        stroke="rgba(255, 255, 255, 0.15)"
        strokeWidth="0.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function CardFace({
  card,
  artNonce = 0,
  previewUrl = null,
  abilityByName,
}: {
  card: Card
  artNonce?: number
  previewUrl?: string | null
  abilityByName: Map<string, Ability>
}) {
  const stats: [string, string][] = [
    ['UV', card.uv == null ? '—' : String(card.uv)],
    ['Move', card.move == null ? '—' : String(card.move)],
    ['Damage', formatDamage(card.damage, card)],
    ['Range', formatRange(card.range)],
    ['Toughness', card.toughness == null ? '—' : String(card.toughness)],
  ]
  if (card.cardType === 'Officer') {
    stats.push(
      ['Company AP', card.companyAp == null ? '—' : String(card.companyAp)],
      ['Company Cap.', card.companyCapacity == null ? '—' : String(card.companyCapacity)],
      ['Cmd Radius', card.commandRadius == null ? '—' : String(card.commandRadius)],
    )
  }
  if (card.cardType === 'Commander') {
    stats.push(
      ['AP', card.apGeneration == null ? '—' : String(card.apGeneration)],
      ['CC', card.ccGeneration == null ? '—' : String(card.ccGeneration)],
      ['Cmd Radius', card.commandRadius == null ? '—' : String(card.commandRadius)],
    )
  }

  const artSrc =
    previewUrl ||
    (card.hasArt && card.artUrl ? `${card.artUrl}?v=${artNonce}` : null)

  const bannerClass =
    card.cardType === 'Commander'
      ? 'banner-commander'
      : card.cardType === 'Officer'
        ? 'banner-officer'
        : 'banner-unit'

  const typeLine = [card.race, card.primaryType, card.secondaryType]
    .filter((part): part is string => Boolean(part))
    .filter((part) => part.trim().toLowerCase() !== 'ranged')
    .join(' · ')
    .toUpperCase()

  const keywords = card.keywords ?? []
  const favoredTerrain = resolveFavoredTerrain(card.favoredTerrain, card.race, keywords)

  function renderAbilityRow(name: string, ultimate = false) {
    const ability = abilityByName.get(name)
    const kind = resolveAbilityIconKind(ability, ultimate)
    const costLabel = ultimate ? '' : formatAbilityCostLabel(ability)
    const description = ability?.description
    return (
      <div className={`kb-ability${ultimate ? ' ultimate' : ''}`} key={name}>
        <span className="kb-ability-cost">
          <AbilityKindIcon kind={kind} />
          {costLabel ? (
            <span className="kb-ability-cost-label" title={costLabel}>
              {costLabel}
            </span>
          ) : null}
        </span>
        <span className="kb-ability-text">
          <strong>{name}</strong>
          {description ? <> - {description}</> : null}
        </span>
      </div>
    )
  }

  const maxRegular = card.ultimate?.trim() ? MAX_CARD_ABILITIES - 1 : MAX_CARD_ABILITIES
  const visibleAbilities = orderedAbilityNames(card.abilities ?? [], abilityByName).slice(
    0,
    maxRegular,
  )

  return (
    <div className="card-face kb-card">
      <CardBorderOrnament />
      <div className="kb-content-wrapper">
        <div className={`kb-banner ${bannerClass}`}>
        <div className="kb-banner-name">{card.name}</div>
      </div>

      <div className="kb-mid">
        <div className="kb-art">
          {artSrc ? (
            <img src={artSrc} alt={`${card.name} art`} />
          ) : (
            <div className="card-art-empty">No image</div>
          )}
        </div>
        <div className="kb-stats">
          {stats.map(([label, value], index) => (
            <div
              key={label}
              className={`kb-stat-row${index % 2 === 1 ? ' alt' : ''}`}
            >
              <span className="kb-stat-left">
                <StatIcon label={label} />
                <span className="kb-stat-label">{label}</span>
              </span>
              <span className="kb-stat-value">{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="kb-type-strip">
        <span className="kb-type-line">{typeLine || card.cardType.toUpperCase()}</span>
      </div>

      <div className="kb-rules">
        {keywords.length ? (
          <div className="kb-keywords" title={keywords.join(', ')}>
            {keywords.join(', ')}
          </div>
        ) : null}
        <div className="kb-abilities">
          {visibleAbilities.length
            ? visibleAbilities.map((name) => renderAbilityRow(name))
            : card.ultimate || keywords.length
              ? null
              : (
                  <div className="muted kb-ability-empty">No abilities</div>
                )}
          {card.ultimate ? renderAbilityRow(card.ultimate, true) : null}
        </div>
        <div className="kb-rules-footer">
          {favoredTerrain ? (
            <span
              className="kb-favored-terrain"
              title={favoredTerrainTooltip(favoredTerrain)}
            >
              <img
                src={favoredTerrainIconUrl(favoredTerrain)}
                alt=""
                className="kb-favored-terrain-icon"
              />
            </span>
          ) : null}
          {card.flavorText ? (
            <em className="kb-flavor">“{card.flavorText}”</em>
          ) : (
            <span />
          )}
          <RarityAlpha rarity={card.rarity || 'Common'} />
        </div>
      </div>
      </div>
    </div>
  )
}
