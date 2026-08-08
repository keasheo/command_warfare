import { useMemo, useState } from 'react'
import {
  ARMY_UNUSED_UV_GUIDE,
  battleLoadoutTotals,
  defaultBattleLoadout,
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

function resolvedCompanyUnitSummary(
  co: { officer: { name: string }; units: Array<{ id: string; name: string }> },
): string {
  const counts = new Map<string, { name: string; count: number }>()
  for (const u of co.units) {
    const cur = counts.get(u.id)
    if (cur) cur.count += 1
    else counts.set(u.id, { name: u.name, count: 1 })
  }
  return [...counts.values()].map((x) => `${x.name}×${x.count}`).join(', ')
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
}

const BUCKETS: BattleBucket[] = ['deploy', 'reserve', 'unused']

function bucketLabel(b: BattleBucket): string {
  if (b === 'deploy') return 'Deploy'
  if (b === 'reserve') return 'Reserve'
  return 'Unused'
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

  const totals = useMemo(() => {
    if (!resolved.ok) return { deploy: 0, reserve: 0, unused: 0 }
    return battleLoadoutTotals(resolved.army, loadout)
  }, [resolved, loadout])

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

  return (
    <div className="force-select-shell">
      <header className="force-select-header">
        <h2>Battle loadout</h2>
        <p className="muted">
          Both armies are locked — assign each company to <strong>Deploy</strong> (≤
          {pools.deployMax} UV), <strong>Reserve</strong> (≤{pools.reserveMax} UV), or{' '}
          <strong>Unused</strong> (rest of the list; not brought — under-fill is fine).
          Commander always deploys. Opponents cannot see your bucket choices.
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
        <aside className="force-select-rosters force-select-rosters-wait">
          <p className="muted">
            Your deploy / reserve / flex split is private. Waiting for all players to
            confirm before terrain setup.
          </p>
          <ArmyRosterView title="Your army" army={army} catalog={catalog} />
          {opponents.map((opp) => (
            <ArmyRosterView
              key={opp.seat}
              title={`${opp.seat} — ${opp.name}`}
              army={opp.army}
              catalog={catalog}
              subtitle={
                opp.armyUv != null ? `${opp.armyUv} UV · opponent list` : 'Opponent list'
              }
            />
          ))}
        </aside>
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
              return (
                <li key={co.officer.id} className="force-company-row">
                  <div className="force-company-info">
                    <span className="force-company-name">{co.officer.name}</span>
                    <span className="force-company-units">
                      {resolvedCompanyUnitSummary(co)}
                    </span>
                    <span className="force-company-uv">{uv} UV</span>
                  </div>
                  <div className="bucket-toggle" role="group" aria-label={`Bucket for ${co.officer.name}`}>
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
          <ArmyRosterView title="Your army" army={army} catalog={catalog} />
          {opponents.map((opp) => (
            <ArmyRosterView
              key={opp.seat}
              title={`${opp.seat} — ${opp.name}`}
              army={opp.army}
              catalog={catalog}
              subtitle={
                opp.armyUv != null ? `${opp.armyUv} UV · opponent list` : 'Opponent list'
              }
            />
          ))}
        </aside>
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
}: {
  title: string
  army: ArmyList
  catalog: Record<string, CardSnapshot>
  subtitle?: string
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
        {resolved.army.commander.name} · {resolved.army.totalUv} UV
      </p>
      <ul className="force-roster-companies">
        {resolved.army.companies.map((co) => (
          <li key={co.officer.id}>
            <strong>{co.officer.name}</strong> ({resolvedCompanyUv(co)} UV)
            <div className="muted">{resolvedCompanyUnitSummary(co)}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}
