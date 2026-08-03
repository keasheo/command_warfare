import type { Ability } from '../../api'
import { formatAbilityMeta } from './abilityFormat'

export function AbilityList({
  abilities,
  selected,
  onSelect,
}: {
  abilities: Ability[]
  selected: string | null
  onSelect: (name: string) => void
}) {
  return (
    <div className="panel">
      <div className="panel-scroll">
        {abilities.map((ability) => (
          <button
            key={ability.name}
            className={`list-item${ability.name === selected ? ' active' : ''}`}
            onClick={() => onSelect(ability.name)}
          >
            <div>{ability.name}</div>
            <div className="meta">{formatAbilityMeta(ability)}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
