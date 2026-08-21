import { useMemo, useState, type ReactNode } from 'react'
import type { Ability, Card } from '../../../src/api'
import { CardFace } from '../../../src/components/cards/CardFace'
import { resolvePreviewCard } from './cardPreview'
import {
  ARMY_UNUSED_UV_GUIDE,
  battleLoadoutTotals,
  defaultBattleLoadout,
  MAX_DEPLOY_SIEGE,
  normalizeLoadoutPools,
  resolveArmy,
  resolvedCompanyUv,
  validateBattleLoadout,
  type ArmyList,
  type BattleBucket,
  type BattleLoadout,
  type CardSnapshot,
  type LoadoutPools,
  type SeatId,
} from '../../shared/index'

type OpponentArmy = {
  seat: SeatId
  name: string
  army: ArmyList
  armyUv: number | null
}

type UnitCount = { id: string; name: string; count: number }

function companyUnitCounts(
  co: { officer: { name: string }; units: Array<{ id: string; name: string }> },
): UnitCount[] {
  const counts = new Map<string, UnitCount>()
  for (const u of co.units) {
    const cur = counts.get(u.id)
    if (cur) cur.count += 1
    else counts.set(u.id, { id: u.id, name: u.name, count: 1 })
  }
  return [...counts.values()]
}

type OpponentStatus = {
  seat: SeatId
  name: string
  forceSelectReady: boolean
}

type Props = {
  army: ArmyList
  catalog: Record<string, CardSnapshot>
  opponents: OpponentArmy[]
  opponentStatus: OpponentStatus[]
  onConfirm: (loadout: BattleLoadout) => void
  disabled?: boolean
  /** True after local player confirmed — hide assignment UI, show wait state. */
  waiting?: boolean
  /** Room force-select UV caps (host-configured). */
  loadoutPools?: Partial<LoadoutPools> | null
  /** Full cards from the card API when available. */
  cardsById?: Map<string, Card>
  abilityByName?: Map<string, Ability>
}

const BUCKETS: BattleBucket[] = ['deploy', 'reserve', 'unused']

function bucketLabel(b: BattleBucket): string {
  if (b === 'deploy') return 'Deploy'
  if (b === 'reserve') return 'Reserve'
  return 'Unused'
}

function CardNameButton({
  cardId,
  children,
  onInspect,
  className,
}: {
  cardId: string
  children: ReactNode
  onInspect: (cardId: string) => void
  className?: string
}) {
  return (
    <button
      type="button"
      className={`force-card-link${className ? ` ${className}` : ''}`}
      onClick={() => onInspect(cardId)}
      title="View card"
    >
      {children}
    </button>
  )
}

export function ForceSelectPanel({
  army,
  catalog,
  opponents,
  opponentStatus,
  onConfirm,
  disabled,
  waiting = false,
  loadoutPools,
  cardsById,
  abilityByName,
}: Props) {
  const pools = useMemo(() => normalizeLoadoutPools(loadoutPools), [loadoutPools])

  const lookup = useMemo(
    () => new Map(Object.values(catalog).map((c) => [c.id, c])),
    [catalog],
  )

  const resolved = useMemo(
    () => resolveArmy(army, lookup, { enforceCommanderRace: false }),
    [army, lookup],
  )

  const [loadout, setLoadout] = useState<BattleLoadout>(() =>
    resolved.ok ? defaultBattleLoadout(resolved.army, pools) : {},
  )
  const [error, setError] = useState<string | null>(null)
  const [inspectId, setInspectId] = useState<string | null>(
    () => army.commanderCardId || null,
  )

  const totals = useMemo(() => {
    if (!resolved.ok) return { deploy: 0, reserve: 0, unused: 0 }
    return battleLoadoutTotals(resolved.army, loadout)
  }, [resolved, loadout])

  const inspectCard = useMemo(
    () =>
      resolvePreviewCard(
        inspectId,
        cardsById ?? new Map(),
        catalog,
      ),
    [catalog, cardsById, inspectId],
  )

  const deployOver = totals.deploy > pools.deployMax
  const reserveOver = totals.reserve > pools.reserveMax

  function setBucket(officerId: string, bucket: BattleBucket) {
    setLoadout((prev) => ({ ...prev, [officerId]: bucket }))
    setError(null)
  }

  function handleConfirm() {
    if (!resolved.ok) {
      setError(resolved.error)
      return
    }
    const check = validateBattleLoadout(resolved.army, loadout, pools)
    if (!check.ok) {
      setError(check.error)
      return
    }
    setError(null)
    onConfirm(loadout)
  }

  if (!resolved.ok) {
    return (
      <div className="force-select-shell">
        <p className="error">Cannot resolve army: {resolved.error}</p>
      </div>
    )
  }

  const inspectPanel = (
    <aside className="force-inspect-panel" aria-live="polite">
      <h3>Card preview</h3>
      <p className="muted">Click any commander, officer, or unit name to inspect.</p>
      {inspectCard ? (
        <div className="force-inspect-card">
          <CardFace
            card={inspectCard}
            abilityByName={abilityByName ?? new Map()}
          />
        </div>
      ) : (
        <p className="muted">Select a card from the rosters.</p>
      )}
    </aside>
  )

  return (
    <div className="force-select-shell">
      <header className="force-select-header">
        <h2>Battle loadout</h2>
        <p className="muted">
          Both armies are locked — assign each company to <strong>Deploy</strong> (≤
          {pools.deployMax} UV), <strong>Reserve</strong> (≤{pools.reserveMax} UV), or{' '}
          <strong>Unused</strong> (rest of the list; not brought — under-fill is fine).
          Commander always deploys. Deploy may include at most {MAX_DEPLOY_SIEGE}{' '}
          Siege units. Opponents
          cannot see your bucket choices.
        </p>
      </header>

      <ul className="force-status-list">
        <li className="force-status-you">
          <strong>You</strong> — {waiting ? 'Confirmed' : 'Choosing loadout…'}
        </li>
        {opponentStatus.map((opp) => (
          <li key={opp.seat}>
            <strong>
              {opp.seat} — {opp.name}
            </strong>{' '}
            — {opp.forceSelectReady ? 'Confirmed' : 'Choosing loadout…'}
          </li>
        ))}
      </ul>

      {waiting ? (
        <div className="force-select-wait-layout">
          <aside className="force-select-rosters force-select-rosters-wait">
            <p className="muted">
              Your deploy / reserve / flex split is private. Waiting for all players
              to confirm before the battle continues.
            </p>
            <ArmyRosterView
              title="Your army"
              army={army}
              catalog={catalog}
              onInspect={setInspectId}
              activeCardId={inspectId}
            />
            {opponents.map((opp) => (
              <ArmyRosterView
                key={opp.seat}
                title={`${opp.seat} — ${opp.name}`}
                army={opp.army}
                catalog={catalog}
                onInspect={setInspectId}
                activeCardId={inspectId}
                subtitle={
                  opp.armyUv != null ? `${opp.armyUv} UV · opponent list` : 'Opponent list'
                }
              />
            ))}
          </aside>
          {inspectPanel}
        </div>
      ) : (
        <div className="force-select-grid">
          <section className="force-select-main">
            <h3>Your companies</h3>
            <div className="force-bucket-totals">
              <span className={deployOver ? 'over-cap' : ''}>
                Deploy <strong>{totals.deploy}</strong> / {pools.deployMax}
              </span>
              <span className={reserveOver ? 'over-cap' : ''}>
                Reserve <strong>{totals.reserve}</strong> / {pools.reserveMax}
              </span>
              <span title={`Soft guide ~${ARMY_UNUSED_UV_GUIDE} UV; higher unused is allowed`}>
                Unused <strong>{totals.unused}</strong>
              </span>
            </div>

            <ul className="force-company-assign-list">
              {resolved.army.companies.map((co) => {
                const uv = resolvedCompanyUv(co)
                const bucket = loadout[co.officer.id] ?? 'deploy'
                const units = companyUnitCounts(co)
                return (
                  <li key={co.officer.id} className="force-company-row">
                    <div className="force-company-info">
                      <CardNameButton
                        cardId={co.officer.id}
                        onInspect={setInspectId}
                        className={`force-company-name${
                          inspectId === co.officer.id ? ' active' : ''
                        }`}
                      >
                        {co.officer.name}
                      </CardNameButton>
                      <span className="force-company-units">
                        {units.map((u, i) => (
                          <span key={u.id}>
                            {i > 0 ? ', ' : null}
                            <CardNameButton cardId={u.id} onInspect={setInspectId}>
                              {u.name}×{u.count}
                            </CardNameButton>
                          </span>
                        ))}
                      </span>
                      <span className="force-company-uv">{uv} UV</span>
                    </div>
                    <div
                      className="bucket-toggle"
                      role="group"
                      aria-label={`Bucket for ${co.officer.name}`}
                    >
                      {BUCKETS.map((b) => (
                        <button
                          key={b}
                          type="button"
                          className={`bucket-btn bucket-${b}${bucket === b ? ' active' : ''}`}
                          disabled={disabled}
                          onClick={() => setBucket(co.officer.id, b)}
                        >
                          {bucketLabel(b)}
                        </button>
                      ))}
                    </div>
                  </li>
                )
              })}
            </ul>

            {error ? <p className="error">{error}</p> : null}

            <button
              type="button"
              className="primary"
              disabled={disabled || deployOver || reserveOver}
              onClick={handleConfirm}
            >
              Confirm force selection
            </button>
          </section>

          <aside className="force-select-rosters">
            <ArmyRosterView
              title="Your army"
              army={army}
              catalog={catalog}
              onInspect={setInspectId}
              activeCardId={inspectId}
            />
            {opponents.map((opp) => (
              <ArmyRosterView
                key={opp.seat}
                title={`${opp.seat} — ${opp.name}`}
                army={opp.army}
                catalog={catalog}
                onInspect={setInspectId}
                activeCardId={inspectId}
                subtitle={
                  opp.armyUv != null ? `${opp.armyUv} UV · opponent list` : 'Opponent list'
                }
              />
            ))}
          </aside>

          {inspectPanel}
        </div>
      )}
    </div>
  )
}

function ArmyRosterView({
  title,
  army,
  catalog,
  subtitle,
  onInspect,
  activeCardId,
}: {
  title: string
  army: ArmyList
  catalog: Record<string, CardSnapshot>
  subtitle?: string
  onInspect: (cardId: string) => void
  activeCardId?: string | null
}) {
  const lookup = useMemo(
    () => new Map(Object.values(catalog).map((c) => [c.id, c])),
    [catalog],
  )
  const resolved = useMemo(
    () => resolveArmy(army, lookup, { enforceCommanderRace: false }),
    [army, lookup],
  )

  if (!resolved.ok) {
    return (
      <div className="force-roster-block">
        <h4>{title}</h4>
        <p className="muted">{resolved.error}</p>
      </div>
    )
  }

  return (
    <div className="force-roster-block">
      <h4>{title}</h4>
      {subtitle ? <p className="muted">{subtitle}</p> : null}
      <p className="muted">
        <CardNameButton
          cardId={resolved.army.commander.id}
          onInspect={onInspect}
          className={activeCardId === resolved.army.commander.id ? 'active' : undefined}
        >
          {resolved.army.commander.name}
        </CardNameButton>{' '}
        · {resolved.army.totalUv} UV
      </p>
      <ul className="force-roster-companies">
        {resolved.army.companies.map((co) => (
          <li key={co.officer.id}>
            <CardNameButton
              cardId={co.officer.id}
              onInspect={onInspect}
              className={`force-roster-officer${
                activeCardId === co.officer.id ? ' active' : ''
              }`}
            >
              {co.officer.name}
            </CardNameButton>{' '}
            ({resolvedCompanyUv(co)} UV)
            <div className="muted force-roster-units">
              {companyUnitCounts(co).map((u, i) => (
                <span key={u.id}>
                  {i > 0 ? ', ' : null}
                  <CardNameButton
                    cardId={u.id}
                    onInspect={onInspect}
                    className={activeCardId === u.id ? 'active' : undefined}
                  >
                    {u.name}×{u.count}
                  </CardNameButton>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
