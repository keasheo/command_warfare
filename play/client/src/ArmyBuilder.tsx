import { useEffect, useMemo, useRef, useState } from 'react'
import type { Ability, Card } from '../../../src/api'
import { CardFace } from '../../../src/components/cards/CardFace'
import {
  ARMY_UV_MAX,
  armyFileBasename,
  buildArmyFileFromNames,
  copyLimitForCard,
  countCardCopiesInList,
  namedListFromArmy,
  normalizeLoadoutPools,
  parseArmyFile,
  resolveArmy,
  resolveNamedArmy,
  type ArmyCompany,
  type ArmyFile,
  type ArmyList,
  type CardSnapshot,
  type LoadoutPools,
} from '../../shared/index'

const LOCAL_ARMIES_KEY = 'cw-play-saved-armies'

function toSnapshot(c: Card): CardSnapshot {
  return {
    id: c.id,
    name: c.name,
    cardType: c.cardType,
    rarity: c.rarity,
    unique: Boolean(c.unique),
    race: c.race,
    uv: c.uv,
    move: c.move,
    damage: c.damage,
    range: c.range,
    toughness: c.toughness,
    companyCapacity: c.companyCapacity,
    commandRadius: c.commandRadius,
    companyAp: c.companyAp,
    apGeneration: c.apGeneration,
    ccGeneration: c.ccGeneration,
    keywords: [...(c.keywords ?? [])],
    abilities: [...(c.abilities ?? [])],
    ultimate: c.ultimate ?? null,
  }
}

function loadLocalArmies(): ArmyFile[] {
  try {
    const raw = localStorage.getItem(LOCAL_ARMIES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: ArmyFile[] = []
    for (const item of parsed) {
      const result = parseArmyFile(item)
      if (result.ok) out.push(result.file)
    }
    return out
  } catch {
    return []
  }
}

function persistLocalArmies(armies: ArmyFile[]) {
  localStorage.setItem(LOCAL_ARMIES_KEY, JSON.stringify(armies))
}

type Props = {
  onSubmit: (army: ArmyList, cards: CardSnapshot[]) => void
  disabled?: boolean
  /** Room rule: officers/units must match commander race (default true). */
  enforceCommanderRace?: boolean
  /** Override primary action label (default: Lock army · UV). */
  submitLabel?: string
  /** Save to browser storage on primary action before onSubmit. */
  workshopMode?: boolean
  /** Room force-select caps (defaults if omitted). */
  loadoutPools?: Partial<LoadoutPools> | null
}

type AddCheck = { ok: true } | { ok: false; reason: string }

type CardSortMode = 'name' | 'uv-asc' | 'uv-desc'
type PickerKind = 'Commander' | 'Officer' | 'Unit'

type PendingAction =
  | { kind: 'commander' }
  | { kind: 'officer' }
  | { kind: 'unit'; companyIndex: number }
  | null

function CardThumb({
  card,
  selected,
  badge,
  onClick,
  disabled,
}: {
  card: Card
  selected?: boolean
  badge?: string
  onClick: () => void
  disabled?: boolean
}) {
  const art = card.hasArt && card.artUrl ? card.artUrl : null
  return (
    <button
      type="button"
      className={`card-thumb${selected ? ' selected' : ''}`}
      disabled={disabled}
      onClick={onClick}
      title={card.name}
    >
      <div className="card-thumb-art">
        {art ? (
          <img src={art} alt="" loading="lazy" />
        ) : (
          <span className="card-thumb-empty">No art</span>
        )}
      </div>
      <div className="card-thumb-meta">
        <span className="card-thumb-name">{card.name}</span>
        <span className="card-thumb-footer">
          <span className="card-thumb-stats">
            UV {card.uv ?? '—'}
            {card.cardType === 'Officer' ? ` · cap ${card.companyCapacity ?? '—'}` : ''}
            {card.cardType === 'Commander' ? ` · CR ${card.commandRadius ?? '—'}` : ''}
          </span>
          {card.cardType === 'Unit' ? (
            <span
              className={`card-thumb-gem rarity-${(card.rarity || 'Common').toLowerCase()}`}
              title={card.rarity || 'Common'}
              aria-label={`Rarity: ${card.rarity || 'Common'}`}
            />
          ) : null}
        </span>
      </div>
      {badge ? <span className="card-thumb-badge">{badge}</span> : null}
    </button>
  )
}

export function ArmyBuilder({
  onSubmit,
  disabled,
  enforceCommanderRace = true,
  submitLabel,
  workshopMode = false,
  loadoutPools,
}: Props) {
  const pools = normalizeLoadoutPools(loadoutPools)
  const battleActiveMax = pools.deployMax + pools.reserveMax
  const [cards, setCards] = useState<Card[]>([])
  const [abilityByName, setAbilityByName] = useState<Map<string, Ability>>(new Map())
  const [loadError, setLoadError] = useState<string | null>(null)
  const [quickPickBusy, setQuickPickBusy] = useState(false)
  const [quickPickPresets, setQuickPickPresets] = useState<
    Array<{
      commanderId: string
      commanderName: string
      race: string
      totalUv: number
      companyCount: number
    }>
  >([])
  const [quickPickCommanderId, setQuickPickCommanderId] = useState('')
  const [raceFilter, setRaceFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [nameFilter, setNameFilter] = useState('')
  const [keywordFilter, setKeywordFilter] = useState('')
  const [abilityFilter, setAbilityFilter] = useState('')
  const [uvMinFilter, setUvMinFilter] = useState('')
  const [uvMaxFilter, setUvMaxFilter] = useState('')
  const [sortMode, setSortMode] = useState<CardSortMode>('name')
  const [commanderId, setCommanderId] = useState('')
  const [companies, setCompanies] = useState<ArmyCompany[]>([])
  const [activeCompany, setActiveCompany] = useState(0)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [armyName, setArmyName] = useState('My army')
  const [savedArmies, setSavedArmies] = useState<ArmyFile[]>(() => loadLocalArmies())
  const [ioMessage, setIoMessage] = useState<string | null>(null)
  const [ioError, setIoError] = useState<string | null>(null)
  const [ioIssues, setIoIssues] = useState<string[]>([])
  const importRef = useRef<HTMLInputElement>(null)
  const [showDisplaySettings, setShowDisplaySettings] = useState(false)
  
  // Display settings with localStorage persistence
  const [previewScale, setPreviewScale] = useState<'small' | 'medium' | 'large'>(() => {
    const stored = localStorage.getItem('cw-army-preview-scale')
    return (stored === 'small' || stored === 'large') ? stored : 'medium'
  })
  const [compactRoster, setCompactRoster] = useState(() => {
    return localStorage.getItem('cw-army-compact-roster') === '1'
  })
  const [hidePreview, setHidePreview] = useState(() => {
    return localStorage.getItem('cw-army-hide-preview') === '1'
  })
  const [artFit, setArtFit] = useState<'cover' | 'contain'>(() => {
    const stored = localStorage.getItem('cw-army-art-fit')
    return stored === 'contain' ? 'contain' : 'cover'
  })

  function savePreviewScale(value: 'small' | 'medium' | 'large') {
    setPreviewScale(value)
    localStorage.setItem('cw-army-preview-scale', value)
  }

  function saveCompactRoster(value: boolean) {
    setCompactRoster(value)
    localStorage.setItem('cw-army-compact-roster', value ? '1' : '0')
  }

  function saveHidePreview(value: boolean) {
    setHidePreview(value)
    localStorage.setItem('cw-army-hide-preview', value ? '1' : '0')
  }

  function saveArtFit(value: 'cover' | 'contain') {
    setArtFit(value)
    localStorage.setItem('cw-army-art-fit', value)
  }

  const previewScaleValue = previewScale === 'small' ? 0.5 : previewScale === 'large' ? 0.8 : 0.64

  useEffect(() => {
    let cancelled = false
    console.log('[ArmyBuilder] Component mounted, fetching cards from /api/cards')
    ;(async () => {
      try {
        const [cardsRes, abilitiesRes] = await Promise.all([
          fetch('/api/cards'),
          fetch('/api/abilities'),
        ])
        if (!cardsRes.ok) {
          throw new Error(`API ${cardsRes.status} — is the card API running?`)
        }
      const cardData = (await cardsRes.json()) as { cards: Card[] }
      const abilityData = abilitiesRes.ok
        ? ((await abilitiesRes.json()) as { abilities: Ability[] })
        : { abilities: [] }
      if (cancelled) return
      console.log('[ArmyBuilder] Loaded', cardData.cards.length, 'cards from API')
      const map = new Map<string, Ability>()
      for (const a of abilityData.abilities) map.set(a.name, a)
      setAbilityByName(map)
      const filteredCards = cardData.cards.filter((c) => c.uv != null && c.uv > 0)
      console.log('[ArmyBuilder] Filtered to', filteredCards.length, 'cards with UV > 0')
      if (filteredCards.length === 0 && cardData.cards.length > 0) {
        setLoadError('No cards have UV values set. Import card data first.')
        return
      }
      setCards(filteredCards)
      setLoadError(null)
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : String(e))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (workshopMode) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/quick-pick-armies')
        if (!res.ok) return
        const body = (await res.json()) as {
          presets?: Array<{
            commanderId: string
            commanderName: string
            race: string
            totalUv: number
            companyCount: number
          }>
        }
        if (cancelled || !body.presets?.length) return
        setQuickPickPresets(body.presets)
        setQuickPickCommanderId((prev) => prev || body.presets![0]!.commanderId)
      } catch {
        // Quick pick is optional — ignore if API unavailable.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [workshopMode])

  useEffect(() => {
    if (!commanderId || !quickPickPresets.length) return
    if (quickPickPresets.some((p) => p.commanderId === commanderId)) {
      setQuickPickCommanderId(commanderId)
    }
  }, [commanderId, quickPickPresets])

  const cardMap = useMemo(() => {
    const m = new Map<string, Card>()
    for (const c of cards) m.set(c.id, c)
    return m
  }, [cards])

  const snapshotLookup = useMemo(() => {
    const m = new Map<string, CardSnapshot>()
    for (const c of cards) m.set(c.id, toSnapshot(c))
    return m
  }, [cards])

  const races = useMemo(() => {
    const s = new Set<string>()
    for (const c of cards) if (c.race) s.add(c.race)
    return [...s].sort()
  }, [cards])

  const keywordOptions = useMemo(() => {
    const s = new Set<string>()
    for (const c of cards) {
      for (const k of c.keywords ?? []) if (k.trim()) s.add(k)
    }
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [cards])

  const abilityOptions = useMemo(() => {
    const s = new Set<string>()
    for (const c of cards) {
      for (const a of c.abilities ?? []) if (a.trim()) s.add(a)
      if (c.ultimate?.trim()) s.add(c.ultimate.trim())
    }
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [cards])

  const commander = commanderId ? cardMap.get(commanderId) ?? null : null

  const liveUv = useMemo(() => {
    let uv = commander?.uv ?? 0
    for (const co of companies) {
      uv += cardMap.get(co.officerCardId)?.uv ?? 0
      for (const u of co.units) {
        uv += (cardMap.get(u.cardId)?.uv ?? 0) * u.count
      }
    }
    return uv
  }, [commander, companies, cardMap])

  function companyUv(co: ArmyCompany): number {
    return co.units.reduce(
      (s, u) => s + (cardMap.get(u.cardId)?.uv ?? 0) * u.count,
      0,
    )
  }

  const company =
    companies.length > 0
      ? companies[Math.min(activeCompany, companies.length - 1)]!
      : null
  const companyIndex = company ? Math.min(activeCompany, companies.length - 1) : -1
  const officer = company?.officerCardId
    ? cardMap.get(company.officerCardId) ?? null
    : null
  const focusCard = focusId ? cardMap.get(focusId) ?? null : null

  const chosenOfficerIds = useMemo(() => {
    const ids = new Set<string>()
    for (const co of companies) {
      if (co.officerCardId) ids.add(co.officerCardId)
    }
    return ids
  }, [companies])

  const filteredCards = useMemo(() => {
    const q = nameFilter.trim().toLowerCase()
    const kw = keywordFilter.trim().toLowerCase()
    const ab = abilityFilter.trim().toLowerCase()
    const uvMin = uvMinFilter.trim() === '' ? null : Number(uvMinFilter)
    const uvMax = uvMaxFilter.trim() === '' ? null : Number(uvMaxFilter)
    const activeOfficerId = company?.officerCardId || ''
    return cards.filter((c) => {
      if (raceFilter && c.race !== raceFilter) return false
      if (typeFilter && c.cardType !== typeFilter) return false
      if (q && !c.name.toLowerCase().includes(q)) return false
      if (kw) {
        const list = c.keywords ?? []
        if (!list.some((k) => k.toLowerCase().includes(kw))) return false
      }
      if (ab) {
        const list = [...(c.abilities ?? []), c.ultimate].filter(Boolean) as string[]
        if (!list.some((a) => a.toLowerCase().includes(ab))) return false
      }
      const uv = c.uv ?? 0
      if (uvMin != null && !Number.isNaN(uvMin) && uv < uvMin) return false
      if (uvMax != null && !Number.isNaN(uvMax) && uv > uvMax) return false
      // Officers are unique — hide ones already assigned to another company.
      if (
        c.cardType === 'Officer' &&
        chosenOfficerIds.has(c.id) &&
        c.id !== activeOfficerId
      ) {
        return false
      }
      return true
    })
  }, [
    cards,
    raceFilter,
    typeFilter,
    nameFilter,
    keywordFilter,
    abilityFilter,
    uvMinFilter,
    uvMaxFilter,
    chosenOfficerIds,
    company?.officerCardId,
  ])

  const sortedCards = useMemo(() => {
    const list = [...filteredCards]
    if (sortMode === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name))
    } else if (sortMode === 'uv-asc') {
      list.sort(
        (a, b) =>
          (a.uv ?? 0) - (b.uv ?? 0) || a.name.localeCompare(b.name),
      )
    } else {
      list.sort(
        (a, b) =>
          (b.uv ?? 0) - (a.uv ?? 0) || a.name.localeCompare(b.name),
      )
    }
    return list
  }, [filteredCards, sortMode])

  function focusPickerSlot(
    kind: PickerKind,
    opts?: { companyIndex?: number; focusCardId?: string },
  ) {
    setTypeFilter(kind)
    if (opts?.companyIndex != null) setActiveCompany(opts.companyIndex)
    setFocusId(opts?.focusCardId ?? null)
    if (kind !== 'Commander' && enforceCommanderRace && commander?.race) {
      setRaceFilter(commander.race)
    }
  }

  function startPendingAction(action: PendingAction) {
    setPendingAction(action)
    if (action?.kind === 'commander') {
      setTypeFilter('Commander')
      setFocusId(commanderId || null)
    } else if (action?.kind === 'officer') {
      setTypeFilter('Officer')
      if (enforceCommanderRace && commander?.race) setRaceFilter(commander.race)
      setFocusId(null)
    } else if (action?.kind === 'unit') {
      setTypeFilter('Unit')
      setActiveCompany(action.companyIndex)
      if (enforceCommanderRace && commander?.race) setRaceFilter(commander.race)
      setFocusId(null)
    }
  }

  const addPreview = useMemo(() => {
    if (!focusCard) return null
    const uv = focusCard.uv ?? 0
    if (focusCard.cardType === 'Unit') {
      const used = company ? companyUv(company) : 0
      return {
        addUv: uv,
        companyAfter: used + uv,
        companyCap: officer?.companyCapacity ?? null,
        armyAfter: liveUv + uv,
      }
    }
    if (focusCard.cardType === 'Officer') {
      const old = officer?.uv ?? 0
      return {
        addUv: uv - old,
        companyAfter: company ? companyUv(company) : null,
        companyCap: focusCard.companyCapacity ?? null,
        armyAfter: liveUv - old + uv,
      }
    }
    if (focusCard.cardType === 'Commander') {
      const old = commander?.uv ?? 0
      return {
        addUv: uv - old,
        companyAfter: null,
        companyCap: null,
        armyAfter: liveUv - old + uv,
      }
    }
    return null
  }, [focusCard, company, officer, liveUv, commander])

  const currentArmy = useMemo(
    (): ArmyList => ({ commanderCardId: commanderId, companies }),
    [commanderId, companies],
  )

  function applyArmy(army: ArmyList, name?: string, note?: string) {
    setCommanderId(army.commanderCardId)
    setCompanies(army.companies)
    setActiveCompany(0)
    setFocusId(army.commanderCardId || null)
    if (name) setArmyName(name)
    if (army.commanderCardId) {
      const race = cardMap.get(army.commanderCardId)?.race
      if (race) setRaceFilter(race)
    }
    setIoError(null)
    setIoIssues([])
    setIoMessage(note ?? 'Army loaded.')
  }

  function reportIllegal(error: string, issues: string[]) {
    setIoMessage(null)
    setIoError(error)
    setIoIssues(issues)
  }

  function makeExportFile(): ArmyFile | null {
    if (!commanderId) {
      reportIllegal('Set a commander before saving.', ['No commander set.'])
      return null
    }
    const named = namedListFromArmy(currentArmy, snapshotLookup)
    if (!named) {
      reportIllegal('Cannot export — some cards are missing from the roster.', [
        'One or more army cards are not in the current roster.',
      ])
      return null
    }
    const check = resolveNamedArmy(named, snapshotLookup, ARMY_UV_MAX, {
      enforceCommanderRace,
    })
    if (!check.ok) {
      reportIllegal(check.error, check.issues)
      return null
    }
    setIoError(null)
    setIoIssues([])
    return buildArmyFileFromNames(named, armyName)
  }

  function downloadArmy() {
    const file = makeExportFile()
    if (!file) return
    const blob = new Blob([JSON.stringify(file, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = armyFileBasename(file.name)
    a.click()
    URL.revokeObjectURL(url)
    setIoError(null)
    setIoIssues([])
    setIoMessage(`Downloaded ${a.download}`)
  }

  function saveToBrowser() {
    const file = makeExportFile()
    if (!file) return
    const next = [
      file,
      ...savedArmies.filter((a) => a.name.toLowerCase() !== file.name.toLowerCase()),
    ].slice(0, 30)
    setSavedArmies(next)
    persistLocalArmies(next)
    setIoError(null)
    setIoIssues([])
    setIoMessage(`Saved “${file.name}” in this browser.`)
  }

  async function quickPickDemo(lock: boolean) {
    if (disabled || quickPickBusy || !cards.length || !quickPickCommanderId) return
    setQuickPickBusy(true)
    try {
      const res = await fetch(
        `/api/demo-army?commanderId=${encodeURIComponent(quickPickCommanderId)}`,
      )
      if (!res.ok) {
        throw new Error(`API ${res.status} — failed to load quick-pick army`)
      }
      const body = (await res.json()) as {
        army?: ArmyList
        cards?: CardSnapshot[]
        error?: string
      }
      if (!body.army) {
        throw new Error(body.error ?? 'Quick-pick army missing from response')
      }

      const preset = quickPickPresets.find((p) => p.commanderId === quickPickCommanderId)
      const label = preset?.commanderName ?? 'Quick pick army'
      applyArmy(
        body.army,
        label,
        `Loaded ${label} (${preset?.companyCount ?? body.army.companies.length} companies · ${preset?.totalUv ?? liveUv} UV).`,
      )

      if (!lock) return

      const snaps =
        body.cards?.length
          ? body.cards
          : [...new Set([body.army.commanderCardId, ...body.army.companies.flatMap((co) => [co.officerCardId, ...co.units.map((u) => u.cardId)])])]
              .map((id) => cardMap.get(id))
              .filter((c): c is Card => Boolean(c))
              .map(toSnapshot)
      const lookup = new Map(snaps.map((s) => [s.id, s]))
      const resolved = resolveArmy(body.army, lookup, { enforceCommanderRace })
      if (!resolved.ok) {
        reportIllegal(resolved.error, [resolved.error])
        return
      }

      onSubmit(body.army, snaps)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setIoError(msg)
      setIoIssues([])
      setIoMessage(null)
    } finally {
      setQuickPickBusy(false)
    }
  }

  function importArmyFile(file: ArmyFile) {
    const resolved = resolveNamedArmy(file.list, snapshotLookup, ARMY_UV_MAX, {
      enforceCommanderRace,
    })
    if (!resolved.ok) {
      reportIllegal(resolved.error, resolved.issues)
      return
    }
    applyArmy(
      resolved.army,
      file.name,
      `Loaded “${file.name}” (${resolved.totalUv} UV) — legal.`,
    )
  }

  async function onImportFile(file: File) {
    try {
      const text = await file.text()
      const raw = JSON.parse(text) as unknown
      const parsed = parseArmyFile(raw)
      if (!parsed.ok) {
        reportIllegal(parsed.error, [parsed.error])
        return
      }
      importArmyFile(parsed.file)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to read army file.'
      reportIllegal(msg, [msg])
    }
  }

  function deleteSaved(name: string) {
    const next = savedArmies.filter((a) => a.name !== name)
    setSavedArmies(next)
    persistLocalArmies(next)
  }

  function draftList(): ArmyList {
    return {
      commanderCardId: commanderId || '',
      companies,
    }
  }

  function rarityLimitCheck(card: Card, adding = 1): AddCheck {
    const snap = toSnapshot(card)
    const max = copyLimitForCard(snap)
    let have = countCardCopiesInList(draftList(), card.id)
    // Replacing the current company's officer does not consume an extra copy.
    if (
      card.cardType === 'Officer' &&
      company?.officerCardId === card.id
    ) {
      return { ok: true }
    }
    if (
      card.cardType === 'Officer' &&
      company?.officerCardId &&
      company.officerCardId !== card.id
    ) {
      // Current officer slot will be vacated; only count other slots.
      have = countCardCopiesInList(
        {
          ...draftList(),
          companies: companies.map((co, i) =>
            i === companyIndex ? { ...co, officerCardId: '' } : co,
          ),
        },
        card.id,
      )
    }
    if (
      card.cardType === 'Commander' &&
      commanderId === card.id
    ) {
      return { ok: true }
    }
    if (card.cardType === 'Commander' && commanderId && commanderId !== card.id) {
      have = countCardCopiesInList(
        { ...draftList(), commanderCardId: '' },
        card.id,
      )
    }
    if (have + adding > max) {
      return {
        ok: false,
        reason: `${card.rarity || 'Common'}${card.unique ? ' Unique' : ''} limit is ${max} per army (have ${have}).`,
      }
    }
    return { ok: true }
  }

  function checkAdd(card: Card): AddCheck {
    if (card.cardType === 'Commander') {
      return rarityLimitCheck(card)
    }

    if (card.cardType === 'Officer') {
      if (!companies.length || companyIndex < 0) {
        return { ok: false, reason: 'Add an officer company first.' }
      }
      if (
        chosenOfficerIds.has(card.id) &&
        company?.officerCardId !== card.id
      ) {
        return {
          ok: false,
          reason: 'That officer is already assigned to another company.',
        }
      }
      if (
        enforceCommanderRace &&
        commander?.race &&
        card.race &&
        card.race !== commander.race
      ) {
        return {
          ok: false,
          reason: `Must match commander race (${commander.race}).`,
        }
      }
      const cap = card.companyCapacity ?? 0
      if (cap <= 0) {
        return { ok: false, reason: 'Officer has no company capacity.' }
      }
      const used = company ? companyUv(company) : 0
      if (used > cap) {
        return {
          ok: false,
          reason: `Company already uses ${used} UV; this officer’s cap is ${cap}.`,
        }
      }
      const oldOfficerUv = officer?.uv ?? 0
      const nextArmyUv = liveUv - oldOfficerUv + (card.uv ?? 0)
      if (nextArmyUv > ARMY_UV_MAX) {
        return {
          ok: false,
          reason: `Army would be ${nextArmyUv} UV (max ${ARMY_UV_MAX}).`,
        }
      }
      return rarityLimitCheck(card)
    }

    if (card.cardType === 'Unit') {
      if (!companies.length || companyIndex < 0 || !company) {
        return { ok: false, reason: 'Add an officer company first.' }
      }
      if (!officer) {
        return { ok: false, reason: 'Set this company’s officer first.' }
      }
      if (
        enforceCommanderRace &&
        commander?.race &&
        card.race &&
        card.race !== commander.race
      ) {
        return {
          ok: false,
          reason: `Must match commander race (${commander.race}).`,
        }
      }
      const unitUv = card.uv ?? 0
      const cap = officer.companyCapacity ?? 0
      const used = companyUv(company)
      if (used + unitUv > cap) {
        return {
          ok: false,
          reason: `Company UV ${used}+${unitUv} exceeds capacity ${cap}.`,
        }
      }
      if (liveUv + unitUv > ARMY_UV_MAX) {
        return {
          ok: false,
          reason: `Army would be ${liveUv + unitUv} UV (max ${ARMY_UV_MAX}).`,
        }
      }
      return rarityLimitCheck(card)
    }

    return { ok: false, reason: 'Not an army card type.' }
  }

  const addCheck = focusCard ? checkAdd(focusCard) : null

  function applyFocusedCard() {
    if (!focusCard || !addCheck?.ok) return

    if (focusCard.cardType === 'Commander') {
      setCommanderId(focusCard.id)
      if (enforceCommanderRace && focusCard.race) {
        setRaceFilter(focusCard.race)
      }
      setTypeFilter('') // Clear filter after adding commander
      setFocusId(null)
      return
    }

    if (focusCard.cardType === 'Officer') {
      if (companyIndex < 0) return
      const next = [...companies]
      const co = next[companyIndex]
      if (!co) return
      next[companyIndex] = { ...co, officerCardId: focusCard.id }
      setCompanies(next)
      // Auto-switch to Unit mode for this company after adding officer
      setTypeFilter('Unit')
      setFocusId(null)
      return
    }

    if (focusCard.cardType === 'Unit') {
      if (companyIndex < 0) return
      const next = [...companies]
      const co = next[companyIndex]
      if (!co) return
      const unitsList = [...co.units]
      const existing = unitsList.find((u) => u.cardId === focusCard.id)
      if (existing) existing.count += 1
      else unitsList.push({ cardId: focusCard.id, count: 1 })
      next[companyIndex] = { ...co, units: unitsList }
      setCompanies(next)
      setFocusId(null)
    }
  }

  function addCompany() {
    setCompanies((prev) => [...prev, { officerCardId: '', units: [] }])
    focusPickerSlot('Officer', { companyIndex: companies.length })
  }

  function actionLabel(card: Card): string {
    if (card.cardType === 'Commander') {
      return commanderId === card.id ? 'Commander set' : 'Set as commander'
    }
    if (card.cardType === 'Officer') {
      return company?.officerCardId === card.id
        ? 'Officer set'
        : `Set as officer (co. ${companyIndex + 1})`
    }
    return `Add to company ${companyIndex + 1}`
  }

  function trySubmit() {
    if (!commanderId || !companies.length) return
    if (companies.some((c) => !c.officerCardId || !c.units.length)) return
    const army: ArmyList = { commanderCardId: commanderId, companies }
    const ids = new Set<string>([commanderId])
    for (const co of companies) {
      ids.add(co.officerCardId)
      for (const u of co.units) ids.add(u.cardId)
    }
    const snaps = [...ids]
      .map((id) => cardMap.get(id))
      .filter((c): c is Card => Boolean(c))
      .map(toSnapshot)
    const lookup = new Map(snaps.map((s) => [s.id, s]))
    const resolved = resolveArmy(army, lookup, { enforceCommanderRace })
    if (!resolved.ok) {
      reportIllegal(resolved.error, [resolved.error])
      return
    }
    if (workshopMode) {
      saveToBrowser()
    }
    onSubmit(army, snaps)
  }

  const canLock =
    !!commanderId &&
    companies.length > 0 &&
    companies.every((c) => c.officerCardId && c.units.length > 0) &&
    liveUv <= ARMY_UV_MAX &&
    !disabled

  if (loadError) {
    return (
      <div className="army-builder-shell">
        <div className="army-builder-loading-state">
          <div className="error">
            Could not load cards: {loadError}
            <br />
            <span className="muted">Card API must be running (npm run dev:play includes it).</span>
            <br />
            <span className="muted">Vite dev server proxies /api to http://127.0.0.1:8787</span>
          </div>
        </div>
      </div>
    )
  }

  if (!cards.length) {
    return (
      <div className="army-builder-shell">
        <div className="army-builder-loading-state">
          <p className="muted">Loading card roster…</p>
          <p className="muted" style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>
            Fetching from /api/cards. Check console if this persists.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="army-builder-shell">
      <aside className="army-controls" data-compact={compactRoster}>
        <h2>Build army</h2>
        <p className="muted">
          Army list <strong>{liveUv}</strong> / {ARMY_UV_MAX} UV
        </p>
        <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>
          Battle lock: deploy ≤{pools.deployMax}, reserve ≤{pools.reserveMax} (
          {battleActiveMax} active max) · unused holds the rest (under-fill allowed)
        </p>

        <div className="field">
          <label>Army name</label>
          <input
            value={armyName}
            disabled={disabled}
            onChange={(e) => setArmyName(e.target.value)}
            placeholder="My army"
          />
        </div>

        {!workshopMode ? (
          <div className="quick-pick-panel">
            <div className="field">
              <label>Quick pick commander</label>
              <select
                value={quickPickCommanderId}
                disabled={disabled || quickPickBusy || !quickPickPresets.length}
                onChange={(e) => setQuickPickCommanderId(e.target.value)}
              >
                {!quickPickPresets.length ? (
                  <option value="">Loading presets…</option>
                ) : (
                  quickPickPresets.map((p) => (
                    <option key={p.commanderId} value={p.commanderId}>
                      {p.commanderName} ({p.race}) · {p.totalUv} UV · {p.companyCount} co.
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="row">
              <button
                type="button"
                disabled={
                  disabled || quickPickBusy || !cards.length || !quickPickCommanderId
                }
                onClick={() => void quickPickDemo(false)}
                title="Load this commander's preset army."
              >
                Load preset
              </button>
              <button
                type="button"
                className="primary"
                disabled={
                  disabled || quickPickBusy || !cards.length || !quickPickCommanderId
                }
                onClick={() => void quickPickDemo(true)}
                title="Load the preset army and immediately lock it."
              >
                Load & lock
              </button>
            </div>
          </div>
        ) : null}

        <button
          type="button"
          className="display-settings-toggle"
          onClick={() => setShowDisplaySettings((v) => !v)}
        >
          ⚙ Display
        </button>

        {showDisplaySettings && (
          <div className="display-settings-panel">
            <h3>Display settings</h3>
            
            <div className="field">
              <label>Preview scale (mobile)</label>
              <select
                value={previewScale}
                onChange={(e) => savePreviewScale(e.target.value as 'small' | 'medium' | 'large')}
              >
                <option value="small">Small (50%)</option>
                <option value="medium">Medium (64%)</option>
                <option value="large">Large (80%)</option>
              </select>
            </div>

            <div className="field">
              <label>Card art fit</label>
              <select
                value={artFit}
                onChange={(e) => saveArtFit(e.target.value as 'cover' | 'contain')}
              >
                <option value="cover">Cover (fill, may clip)</option>
                <option value="contain">Contain (fit all, may letterbox)</option>
              </select>
            </div>

            <label className="check-field">
              <input
                type="checkbox"
                checked={compactRoster}
                onChange={(e) => saveCompactRoster(e.target.checked)}
              />
              <span>Compact roster view</span>
            </label>

            <label className="check-field">
              <input
                type="checkbox"
                checked={hidePreview}
                onChange={(e) => saveHidePreview(e.target.checked)}
              />
              <span>Hide card preview (more list space)</span>
            </label>

            <p className="muted">Settings saved per device.</p>
          </div>
        )}

        <div className="row army-io-row">
          <button type="button" disabled={disabled || !commanderId} onClick={downloadArmy}>
            Export JSON
          </button>
          <button type="button" disabled={disabled || !commanderId} onClick={saveToBrowser}>
            Save here
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => importRef.current?.click()}
          >
            Import…
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json,.cwarmy.json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void onImportFile(f)
            }}
          />
        </div>
        {ioMessage ? <p className="status-ok">{ioMessage}</p> : null}
        {ioError ? <p className="error">{ioError}</p> : null}
        {ioIssues.length > 0 ? (
          <ul className="io-issues">
            {ioIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : null}

        {savedArmies.length > 0 ? (
          <div className="saved-armies">
            <h3>Saved in browser</h3>
            <ul>
              {savedArmies.map((a) => (
                <li key={`${a.name}-${a.savedAt}`}>
                  <button
                    type="button"
                    className="unit-chip"
                    disabled={disabled}
                    onClick={() => importArmyFile(a)}
                    title={a.savedAt}
                  >
                    {a.name}
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => deleteSaved(a.name)}
                    title="Remove saved army"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <button
          type="button"
          className={`army-slot${commanderId ? ' filled' : ''}${typeFilter === 'Commander' ? ' active' : ''}`}
          disabled={disabled}
          onClick={() => {
            focusPickerSlot('Commander', {
              focusCardId: commanderId || undefined,
            })
          }}
        >
          <span className="army-slot-label">Commander</span>
          <span className="army-slot-value">
            {commander?.name ?? 'Not set'}
          </span>
        </button>

        {companies.map((co, ci) => {
          const off = cardMap.get(co.officerCardId)
          const used = companyUv(co)
          const cap = off?.companyCapacity ?? 0
          return (
            <div
              key={ci}
              className={`company-block${activeCompany === ci ? ' active-company' : ''}`}
            >
              <button
                type="button"
                className={`army-slot${co.officerCardId ? ' filled' : ''}${activeCompany === ci && typeFilter === 'Officer' ? ' active' : ''}`}
                disabled={disabled}
                onClick={() => {
                  focusPickerSlot('Officer', {
                    companyIndex: ci,
                    focusCardId: co.officerCardId || undefined,
                  })
                }}
              >
                <span className="army-slot-label">
                  Officer {ci + 1} · UV {used}/{cap || '—'}
                </span>
                <span className="army-slot-value">{off?.name ?? 'Not set'}</span>
              </button>

              <ul className="unit-list">
                {co.units.map((u) => {
                  const card = cardMap.get(u.cardId)
                  return (
                    <li key={u.cardId}>
                      <button
                        type="button"
                        className="unit-chip"
                        disabled={disabled}
                        onClick={() => {
                          focusPickerSlot('Unit', {
                            companyIndex: ci,
                            focusCardId: u.cardId,
                          })
                        }}
                      >
                        {card?.name ?? u.cardId} ×{u.count}
                      </button>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          const next = [...companies]
                          next[ci] = {
                            ...co,
                            units: co.units
                              .map((x) =>
                                x.cardId === u.cardId
                                  ? { ...x, count: x.count - 1 }
                                  : x,
                              )
                              .filter((x) => x.count > 0),
                          }
                          setCompanies(next)
                        }}
                      >
                        −
                      </button>
                    </li>
                  )
                })}
              </ul>

              <div className="row">
                <button
                  type="button"
                  className={activeCompany === ci && typeFilter === 'Unit' ? 'primary' : undefined}
                  disabled={disabled || !co.officerCardId}
                  onClick={() => {
                    focusPickerSlot('Unit', { companyIndex: ci })
                  }}
                  title={!co.officerCardId ? 'Set an officer first' : undefined}
                >
                  + Unit
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    const next = companies.filter((_, i) => i !== ci)
                    setCompanies(next)
                    setActiveCompany(Math.max(0, Math.min(activeCompany, next.length - 1)))
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          )
        })}

        <div className="row">
          <button type="button" disabled={disabled} onClick={addCompany}>
            + Officer
          </button>
          <button
            type="button"
            className="primary"
            disabled={!canLock}
            onClick={trySubmit}
          >
            {submitLabel ?? `Lock army (${liveUv} UV)`}
          </button>
        </div>
        {!canLock && commanderId && companies.length > 0 ? (
          <p className="muted">
            Each company needs an officer and ≥1 unit · army list ≤ {ARMY_UV_MAX} UV.
          </p>
        ) : null}
      </aside>

      <div className="army-picker">
        {typeFilter && (
          <div className="army-intent-banner">
            {typeFilter === 'Commander' && (
              <span>Select a commander card to set or replace your commander</span>
            )}
            {typeFilter === 'Officer' && (
              <span>
                Select an officer card to {company ? `set officer for Company ${companyIndex + 1}` : 'add to a new company'}
              </span>
            )}
            {typeFilter === 'Unit' && company && (
              <span>
                Adding units to <strong>Company {companyIndex + 1}</strong> — click a unit card
              </span>
            )}
          </div>
        )}
        <div
          className="army-preview"
          style={{
            '--card-mobile-scale': previewScaleValue,
            '--card-art-fit': artFit,
          } as React.CSSProperties}
          data-hide-preview={hidePreview}
        >
          {!hidePreview && focusCard ? (
            <>
              <div className="card-scale-wrap">
                <CardFace card={focusCard} abilityByName={abilityByName} />
              </div>
              <div className="army-add-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={
                    disabled ||
                    !addCheck?.ok ||
                    (focusCard.cardType === 'Commander' && commanderId === focusCard.id) ||
                    (focusCard.cardType === 'Officer' &&
                      company?.officerCardId === focusCard.id)
                  }
                  onClick={applyFocusedCard}
                >
                  {actionLabel(focusCard)}
                </button>
                {addPreview ? (
                  <p className="muted">
                    {addPreview.addUv >= 0 ? '+' : ''}
                    {addPreview.addUv} UV
                    {addPreview.companyAfter != null
                      ? ` → company ${addPreview.companyAfter}/${addPreview.companyCap ?? '—'}`
                      : ''}
                    {` · army ${addPreview.armyAfter}/${ARMY_UV_MAX}`}
                  </p>
                ) : null}
                {addCheck && !addCheck.ok ? (
                  <p className="error">{addCheck.reason}</p>
                ) : null}
              </div>
            </>
          ) : !hidePreview ? (
            <div className="card-scale-wrap card-scale-wrap-empty">
              <div className="army-preview-empty muted">
                Select a card to preview. Use Add to put it in your army.
              </div>
            </div>
          ) : (
            <div className="army-preview-hidden muted">
              Card preview hidden (Display settings)
            </div>
          )}
        </div>
        <div className="army-picker-list">
          <div className="army-filters">
            <div className="field">
              <label>Race</label>
              <select
                value={raceFilter}
                disabled={disabled}
                onChange={(e) => setRaceFilter(e.target.value)}
              >
                <option value="">All races</option>
                {races.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Type</label>
              <select
                value={typeFilter}
                disabled={disabled}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="">All types</option>
                <option value="Commander">Commander</option>
                <option value="Officer">Officer</option>
                <option value="Unit">Unit</option>
              </select>
            </div>
            <div className="field">
              <label>Name</label>
              <input
                value={nameFilter}
                disabled={disabled}
                placeholder="Search name…"
                onChange={(e) => setNameFilter(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Keyword</label>
              <input
                list="army-keyword-options"
                value={keywordFilter}
                disabled={disabled}
                placeholder="e.g. Pack, Fear…"
                onChange={(e) => setKeywordFilter(e.target.value)}
              />
              <datalist id="army-keyword-options">
                {keywordOptions.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label>Ability</label>
              <input
                list="army-ability-options"
                value={abilityFilter}
                disabled={disabled}
                placeholder="e.g. Inspire, Medic…"
                onChange={(e) => setAbilityFilter(e.target.value)}
              />
              <datalist id="army-ability-options">
                {abilityOptions.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </div>
            <div className="field army-uv-range">
              <label>UV</label>
              <div className="army-uv-inputs">
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={uvMinFilter}
                  disabled={disabled}
                  placeholder="Min"
                  aria-label="Minimum UV"
                  onChange={(e) => setUvMinFilter(e.target.value)}
                />
                <span className="muted">–</span>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={uvMaxFilter}
                  disabled={disabled}
                  placeholder="Max"
                  aria-label="Maximum UV"
                  onChange={(e) => setUvMaxFilter(e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label>Sort</label>
              <select
                value={sortMode}
                disabled={disabled}
                onChange={(e) => setSortMode(e.target.value as CardSortMode)}
              >
                <option value="name">Name (A–Z)</option>
                <option value="uv-asc">UV (low → high)</option>
                <option value="uv-desc">UV (high → low)</option>
              </select>
            </div>
          </div>
          <h3>Card roster</h3>
          <p className="muted">
            Click a card to preview. {typeFilter === 'Unit' && company 
              ? `Next click adds to Company ${companyIndex + 1}.`
              : 'Copy limits: C4 / U3 / R2 / E1 / L1'}
          </p>
          <div className="card-thumb-grid">
            {(() => {
              const draft = {
                commanderCardId: commanderId || '',
                companies,
              }
              return sortedCards.map((c) => {
                const inArmyCount = countCardCopiesInList(draft, c.id)
                const maxCopies = copyLimitForCard(toSnapshot(c))
                const badge =
                  inArmyCount > 0
                    ? `×${inArmyCount}/${maxCopies}`
                    : undefined
                return (
                  <CardThumb
                    key={c.id}
                    card={c}
                    selected={focusId === c.id}
                    badge={badge}
                    disabled={disabled}
                    onClick={() => setFocusId(c.id)}
                  />
                )
              })
            })()}
          </div>
          {!sortedCards.length ? (
            <div className="army-filter-empty">
              <p className="muted">No cards match these filters.</p>
              <p className="muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                {cards.length} cards loaded total. Try clearing filters above.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
