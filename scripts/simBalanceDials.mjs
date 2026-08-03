/**
 * Printable balance dials for battleSim.
 * Prefer race-specific commander/officer ability edits over flat Compact stats.
 * Every active dial must declare a card/ability/keyword edit we can print.
 */

/** Printed Compact baselines (match DB). Only overridden if a Compact dial is active. */
export const PRINTED_COMPACT = {
  Human: { damage: 1, harden: 1, hit: 1 },
  Elf: { damage: 1, harden: 0, hit: 1 },
  Demon: { damage: 1, harden: 1, hit: 1 },
  Lizardman: { damage: 2, harden: 2, hit: 1 },
  Dwarf: { damage: 2, harden: 2, hit: 1 },
  Dragon: { damage: 1, harden: 0, hit: 0 },
  Beastfolk: { damage: 1, harden: 0, hit: 0 },
  Undead: { damage: 2, harden: 2, hit: 1 },
  Construct: { damage: 1, harden: 1, hit: 0 },
}

/**
 * @typedef {{
 *   id: string
 *   race: string
 *   active: boolean
 *   note?: string
 *   sim: Record<string, unknown>
 *   propose: {
 *     target: 'ability' | 'keyword'
 *     name: string
 *     field: string
 *     before: string
 *     after: string
 *     printable: string
 *   }
 * }} BalanceDial
 */

/** @type {BalanceDial[]} */
export const BALANCE_DIALS = [
  // --- Human kit buffs (floor races) ---
  {
    id: 'human-line-cadence-all-attacks',
    race: 'Human',
    active: true,
    note: 'Buff Line Cadence (officer) — Hit on every attack this activation, not only the first.',
    sim: { lineCadenceAllAttacks: true },
    propose: {
      target: 'ability',
      name: 'Line Cadence',
      field: 'description',
      before:
        'Human units of this company beginning activation in Command Radius gain +1 Hit on their first attack this activation.',
      after:
        'Human units of this company beginning activation in Command Radius gain +1 Hit on attacks this activation.',
      printable:
        'Line Cadence → “…gain +1 Hit on attacks this activation.” (not only first)',
    },
  },
  {
    id: 'human-realmward-march-2',
    race: 'Human',
    active: true,
    note: 'Buff Realmward March (commander) — +2 Move instead of +1.',
    sim: { realmwardMoveBonus: 2 },
    propose: {
      target: 'ability',
      name: 'Realmward March',
      field: 'description',
      before:
        'Human units in your army beginning activation inside Command Radius gain +1 Move.',
      after:
        'Human units in your army beginning activation inside Command Radius gain +2 Move.',
      printable: 'Realmward March → “…gain +2 Move.” (was +1)',
    },
  },
  {
    id: 'human-shield-column-1cc',
    race: 'Human',
    active: true,
    note: 'Economy buff — Shield Column cheaper so Human defensive kit fires more often.',
    sim: { abilityCostOverride: { 'Shield Column': { costAmount: 1, costResource: 'CC' } } },
    propose: {
      target: 'ability',
      name: 'Shield Column',
      field: 'cost',
      before: '2 CC',
      after: '1 CC',
      printable: 'Shield Column cost → 1 CC (was 2 CC).',
    },
  },
  {
    id: 'human-hearthfort-tough-2',
    race: 'Human',
    active: true,
    note: 'Buff Hearthfort Aegis — +2 Toughness while defending (sim: −2 damage floor 1).',
    sim: { hearthfortReduce: 2 },
    propose: {
      target: 'ability',
      name: 'Hearthfort Aegis',
      field: 'description',
      before:
        'Infantry in your army within Command Radius gain +1 Toughness while defending.',
      after:
        'Infantry in your army within Command Radius gain +2 Toughness while defending.',
      printable: 'Hearthfort Aegis → “…gain +2 Toughness while defending.”',
    },
  },
  {
    id: 'human-hold-the-line-harden-2',
    race: 'Human',
    active: true,
    note: 'Buff Hold the Line / Line Decree Harden floor.',
    sim: { holdTheLineHarden: 2 },
    propose: {
      target: 'ability',
      name: 'Hold the Line',
      field: 'description',
      before:
        "This company's Infantry within Command Radius gain Harden 1 until end of round.",
      after:
        "This company's Infantry within Command Radius gain Harden 2 until end of round.",
      printable: 'Hold the Line → Harden 2 (was Harden 1). Also mirror on Line Decree.',
    },
  },

  // --- Demon kit buffs (floor races) ---
  {
    id: 'demon-cinder-march-1cc',
    race: 'Demon',
    active: true,
    note: 'Cinder March cheaper for fire tempo.',
    sim: { abilityCostOverride: { 'Cinder March': { costAmount: 1, costResource: 'CC' } } },
    propose: {
      target: 'ability',
      name: 'Cinder March',
      field: 'cost',
      before: '2 CC',
      after: '1 CC',
      printable: 'Cinder March cost → 1 CC (was 2 CC).',
    },
  },
  {
    id: 'demon-hellfire-press-hit',
    race: 'Demon',
    active: true,
    note: 'Hellfire Press also grants +1 Hit vs damaged enemies.',
    sim: { hellfirePressHit: true },
    propose: {
      target: 'ability',
      name: 'Hellfire Press',
      field: 'description',
      before:
        'Fire units in your army within Command Radius gain +1 damage when attacking damaged enemies.',
      after:
        'Fire units in your army within Command Radius gain +1 Damage and +1 Hit when attacking damaged enemies.',
      printable: 'Hellfire Press → +1 Damage and +1 Hit vs damaged enemies.',
    },
  },
  {
    id: 'demon-blood-lottery-2cc',
    race: 'Demon',
    active: true,
    note: 'Blood Lottery cheaper sacrifice Frenzy spike.',
    sim: { abilityCostOverride: { 'Blood Lottery': { costAmount: 2, costResource: 'CC' } } },
    propose: {
      target: 'ability',
      name: 'Blood Lottery',
      field: 'cost',
      before: '3 CC',
      after: '2 CC',
      printable: 'Blood Lottery cost → 2 CC (was 3 CC).',
    },
  },
  {
    id: 'demon-blood-offering-multi-heal',
    race: 'Demon',
    active: true,
    note: 'Blood Offering: sacrifice one → Restore 2 to up to three company allies.',
    sim: {},
    propose: {
      target: 'ability',
      name: 'Blood Offering',
      field: 'description',
      before:
        'Destroy one unit of this company in Command Radius. Restore 3 Toughness to another unit of this company in Command Radius.',
      after:
        'Destroy one unit of this company in Command Radius. Restore 2 Toughness to up to three other units of this company in Command Radius.',
      printable:
        'Blood Offering → Restore 2 Toughness to up to three other company units (was Restore 3 to one).',
    },
  },
  {
    id: 'demon-infernal-rush-all',
    race: 'Demon',
    active: true,
    note: 'Infernal Rush: all Frenzy/Charge in CR (sim previously capped at 2).',
    sim: {},
    propose: {
      target: 'ability',
      name: 'Infernal Rush',
      field: 'description',
      before: 'All units in your army with Frenzy or Charge immediately move 1 space and attack.',
      after: 'All units in your army with Frenzy or Charge immediately move 1 space and attack.',
      printable:
        'Infernal Rush → all Frenzy/Charge in CR move 1 and attack (sim no longer caps at 2).',
    },
  },
  {
    id: 'demon-low-uv-damage',
    race: 'Demon',
    active: true,
    note: 'Printed: Ash Drill Imp, Chain Link Fiend, Brim Hornling, March Overseer Damage 3.',
    sim: {},
    propose: {
      target: 'unit',
      name: 'Demon UV≤5 soft bodies',
      field: 'damage',
      before: 'Ash Drill Imp / Chain Link Fiend / Brim Hornling / March Overseer at Damage 2',
      after: 'Those units Damage 3',
      printable:
        'Ash Drill Imp, Chain Link Fiend, Brim Hornling, March Overseer → Damage 3 (printed).',
    },
  },
  {
    id: 'soft-cmd-hearthbound-ult',
    race: 'Human',
    active: true,
    note: 'Hearthbound Stand → Harden 2 + Shieldwall + Inspire + Regen 1 (soft Hearthstone ult).',
    sim: {},
    propose: {
      target: 'ability',
      name: 'Hearthbound Stand',
      field: 'description',
      before: 'immovable + Harden 1 + Shieldwall',
      after: 'immovable + Harden 2 + Shieldwall + Inspire + Regenerate 1',
      printable:
        'Hearthbound Stand → Harden 2, Shieldwall, Inspire, Regenerate 1 (was Harden 1 + Shieldwall).',
    },
  },
  {
    id: 'soft-cmd-thunder-mammoth',
    race: 'Human',
    active: true,
    note: 'Mammoth Thunder also +1 Damage; Thunder Stampede wired in sim.',
    sim: {},
    propose: {
      target: 'ability',
      name: 'Mammoth Thunder',
      field: 'description',
      before: 'Beast/Cavalry gain Trample in CR',
      after: 'Beast/Cavalry gain Trample and +1 Damage in CR',
      printable: 'Mammoth Thunder → Trample and +1 Damage for Beast/Cavalry in CR.',
    },
  },
  {
    id: 'soft-cmd-battle-cry-2cc',
    race: 'Shared',
    active: true,
    note: 'Battle Cry cheaper (Thunderhoof / Doomforge spike).',
    sim: { abilityCostOverride: { 'Battle Cry': { costAmount: 2, costResource: 'CC' } } },
    propose: {
      target: 'ability',
      name: 'Battle Cry',
      field: 'cost',
      before: '3 CC',
      after: '2 CC',
      printable: 'Battle Cry cost → 2 CC (was 3 CC).',
    },
  },
  {
    id: 'soft-cmd-doomforge-kit',
    race: 'Demon',
    active: true,
    note: 'Printed: Inferno/Last Stand/Call 2 CC; Apocalypse Cry 4 dmg; Tyrant Tithe uncapped; Hellfire Press on Doomforge.',
    sim: {
      abilityCostOverride: {
        'Overwhelming Inferno': { costAmount: 2, costResource: 'CC' },
        'Last Stand': { costAmount: 2, costResource: 'CC' },
        'Call Reinforcements': { costAmount: 2, costResource: 'CC' },
      },
    },
    propose: {
      target: 'ability',
      name: 'Doomforge kit',
      field: 'kit',
      before: 'Inferno 4 CC / Last Stand 3 / Call 4 / Apocalypse 1 dmg / Tithe once',
      after: 'Inferno 2 / Last Stand 2 / Call 2 / Apocalypse 4 dmg / Tithe uncapped; +Hellfire Press',
      printable:
        'Doomforge kit printed: Overwhelming Inferno 2 CC, Last Stand 2 CC, Call Reinforcements 2 CC, Apocalypse Cry 4 dmg, Tyrant Tithe uncapped, Hellfire Press.',
    },
  },
  {
    id: 'soft-cmd-voidclaw-offensive',
    race: 'Demon',
    active: true,
    note: 'Printed: Overwhelming Offensive 2 CC; Dread Aura Fear; Voidclaw UV 12 / CC 7.',
    sim: {
      abilityCostOverride: { 'Overwhelming Offensive': { costAmount: 2, costResource: 'CC' } },
    },
    propose: {
      target: 'ability',
      name: 'Overwhelming Offensive / Dread Aura',
      field: 'kit',
      before: 'Offensive 5 CC; Dread Aura morale AP loss',
      after: 'Offensive 2 CC; Dread Aura grants Fear to adjacent enemies',
      printable:
        'Overwhelming Offensive → 2 CC. Dread Aura → adjacent enemies gain Fear. (Voidclaw UV 12 / CC 7 printed)',
    },
  },

  // --- Beastfolk softens (Pack / hunt kit) ---
  {
    id: 'beastfolk-pack-two-adjacent',
    race: 'Beastfolk',
    active: true,
    note: 'Pack +1 Hit requires two adjacent Pack units (was one).',
    sim: { packAdjacentRequired: 2, packBuddyMustHavePack: true },
    propose: {
      target: 'keyword',
      name: 'Pack',
      field: 'description',
      before:
        "While adjacent to another friendly unit with Pack, this unit's melee attacks gain +1 Hit.",
      after:
        "While adjacent to at least two friendly units with Pack, this unit's melee attacks gain +1 Hit.",
      printable: 'Pack → need two adjacent Pack units (was one).',
    },
  },
  {
    id: 'beastfolk-horn-no-charge-howl-fear-only',
    race: 'Beastfolk',
    active: true,
    note:
      'Printed: Horn +1 Move only; Alpha Howl Fear and −1 Damage (suite suppress).',
    sim: {},
    propose: {
      target: 'ability',
      name: 'Horn of Advance / Alpha Howl',
      field: 'description',
      before: 'Horn granted Charge+Move; Alpha Howl Fear only',
      after: 'Horn +1 Move only; Alpha Howl Fear and −1 Damage until next round',
      printable:
        'Horn of Advance → +1 Move only. Alpha Howl → Fear and −1 Damage (printed).',
    },
  },
  {
    id: 'beastfolk-wild-hunt-pack-mark',
    race: 'Beastfolk',
    active: true,
    note:
      'Wild Hunt Lord: Wild Mandate → Pack Mark. Rally Pack removed (use Rally).',
    sim: {},
    propose: {
      target: 'ability',
      name: 'Pack Mark',
      field: 'kit',
      before: 'Wild Hunt Lord had Wild Mandate; Rally Pack was a duplicate of Rally',
      after:
        'Wild Hunt Lord has Pack Mark. Cards with Rally Pack use Rally. Rally Pack deleted.',
      printable:
        'Wild Hunt Lord: Wild Mandate → Pack Mark. Rally Pack retired — use Rally.',
    },
  },
  {
    id: 'beastfolk-high-alpha-tribal-cadence-active',
    race: 'Beastfolk',
    active: true,
    note:
      'High Alpha: swap Inspiring Presence passive → Tribal Cadence (2 CC active, +1 Move Beastfolk in CR).',
    sim: {},
    propose: {
      target: 'ability',
      name: 'Tribal Cadence',
      field: 'description',
      before: 'Inspiring Presence (passive +1 Move in CR)',
      after: 'Beastfolk units in your army in Command Radius gain +1 Move this round. (2 CC, CD 2)',
      printable:
        'High Alpha: Inspiring Presence → Tribal Cadence (2 CC active; Beastfolk in CR +1 Move this round).',
    },
  },
  {
    id: 'beastfolk-blood-moon-frenzy-only',
    race: 'Beastfolk',
    active: true,
    note: 'Blood Moon grants Frenzy only (no Charge).',
    sim: {},
    propose: {
      target: 'ability',
      name: 'Blood Moon',
      field: 'description',
      before:
        'Beast units in your army in Command Radius gain Frenzy and Charge until next round.',
      after: 'Beast units in your army in Command Radius gain Frenzy until next round.',
      printable: 'Blood Moon → Frenzy only (drop Charge).',
    },
  },
  {
    id: 'beastfolk-pack-first-melee',
    race: 'Beastfolk',
    active: false,
    note: 'Reverted: Pack first-melee-only had negligible sim impact.',
    sim: {},
    propose: {
      target: 'keyword',
      name: 'Pack',
      field: 'description',
      before:
        "While adjacent to another friendly unit with Pack, this unit's melee attacks gain +1 Hit.",
      after:
        "While adjacent to another friendly unit with Pack, this unit's first melee attack each round gains +1 Hit.",
      printable: 'Pack → first melee attack each round only (+1 Hit).',
    },
  },
  {
    id: 'beastfolk-pack-uv-swap',
    race: 'Beastfolk',
    active: true,
    note:
      'Pack commons Horned Militia / Pack Pups / Wolfkin Runners UV2→3; Boar Boys / Camp Archers / Den Sergeant UV3→2.',
    sim: {},
    propose: {
      target: 'unit',
      name: 'Beastfolk UV2/3 swap',
      field: 'uv',
      before: 'Pack chaff UV2; Boar Boys / Camp Archers / Den Sergeant UV3',
      after: 'Pack commons UV3; Boar Boys / Camp Archers / Den Sergeant UV2',
      printable:
        'Pack: Horned Militia, Pack Pups, Wolfkin Runners → UV3. Non-Pack: Boar Boys, Camp Archers, Den Sergeant → UV2.',
    },
  },
  {
    id: 'beastfolk-pack-chaff-stats',
    race: 'Beastfolk',
    active: true,
    note:
      'UV2 Pack D3→2; UV≤3 Pack T4→T3; High Alpha loses Pack Reform.',
    sim: {},
    propose: {
      target: 'unit',
      name: 'Pack chaff',
      field: 'stats',
      before: 'UV2 Pack D3/T4; UV3 Pack T4; High Alpha has Pack Reform',
      after: 'UV2 Pack D2/T3; UV≤3 Pack T3; High Alpha no Pack Reform',
      printable:
        'Pack commons: UV2 Damage 2 / Toughness 3; UV3 Toughness 3. High Alpha drops Pack Reform.',
    },
  },
  {
    id: 'beastfolk-pack-melee-only',
    race: 'Beastfolk',
    active: true,
    note:
      'Pack +1 Hit on melee attacks only; stripped Pack from Sling Wolfkin, Longfang Archers, Thornbow Pack, Hunt Masters.',
    sim: {},
    propose: {
      target: 'keyword',
      name: 'Pack',
      field: 'description',
      before:
        "While adjacent to another friendly unit with Pack, this unit's attacks gain +1 Hit.",
      after:
        "While adjacent to another friendly unit with Pack, this unit's melee attacks gain +1 Hit.",
      printable:
        'Pack → melee attacks only (+1 Hit). Ranged Pack bodies lose the keyword.',
    },
  },
  {
    id: 'beastfolk-pack-two-adjacent-retired-beast-buddy',
    race: 'Beastfolk',
    active: false,
    note:
      'Superseded history: old two-Beast (any Beast) dial; Pack now requires two Pack neighbors.',
    sim: { packAdjacentRequired: 1, packBuddyMustHavePack: true },
    propose: {
      target: 'keyword',
      name: 'Pack',
      field: 'description',
      before:
        "While adjacent to another friendly Beast unit, this unit's attacks gain +1 Hit.",
      after:
        "While adjacent to another friendly unit with Pack, this unit's attacks gain +1 Hit.",
      printable: 'Pack → need one adjacent Pack unit (not any Beast).',
    },
  },
  {
    id: 'beastfolk-pack-hunt-no-damage',
    race: 'Beastfolk',
    active: false,
    note:
      'Superseded: Pack Hunt removed from kits; replaced by Pack Reform (reposition to form Pack).',
    sim: { packHuntDamage: 0 },
    propose: {
      target: 'ability',
      name: 'Pack Reform',
      field: 'description',
      before: 'Pack Hunt (+1 Damage / Hit combat buff)',
      after:
        "Move up to two of this company's Beast or Pack units one space each (form Pack adjacency).",
      printable:
        'Swap Pack Hunt → Pack Reform (Pack positioning, not combat buff).',
    },
  },
  {
    id: 'beastfolk-compact-no-hit',
    race: 'Beastfolk',
    active: false,
    note:
      'Already applied: Beastfolk Compact → +1 Damage only (removed +1 Hit).',
    sim: { compactHit: 0 },
    propose: {
      target: 'ability',
      name: 'Beastfolk Compact',
      field: 'description',
      before: 'Beastfolk units in your army within Command Radius gain +1 Damage and +1 Hit.',
      after: 'Beastfolk units in your army within Command Radius gain +1 Damage.',
      printable: 'Beastfolk Compact → “…gain +1 Damage.” (drop +1 Hit)',
    },
  },
  {
    id: 'beastfolk-wild-rush-threshold-only',
    race: 'Beastfolk',
    active: false,
    note:
      'Already applied: Wild Rush only softens Charge move requirement — does not grant Charge.',
    sim: { wildRushGrantsCharge: false },
    propose: {
      target: 'ability',
      name: 'Wild Rush',
      field: 'description',
      before:
        "This company's Beast or Cavalry in Command Radius may count Charge after moving only 1 hex this activation.",
      after:
        "This company's Beast or Cavalry in Command Radius that have Charge may count Charge after moving only 1 hex this activation.",
      printable:
        'Wild Rush → threshold only for units that already have Charge (no Charge grant).',
    },
  },

  {
    id: 'commander-cast-anytime',
    race: 'Shared',
    active: false,
    note:
      'Rules A/B: commanders may cast actives/ultimates anytime (AP/CC), but only move/attack on their once/round activation.',
    sim: { commanderCastAnytime: true },
    propose: {
      target: 'rules',
      name: 'Commander casting',
      field: 'timing',
      before:
        'Commander casts only during their once/round activation (with move/attack).',
      after:
        'Commander may cast anytime using Commander AP/CC; move and attack remain once/round on activation.',
      printable:
        'Rules: Commander abilities may be cast anytime (pay AP/CC). Move and attack still only during the once/round Commander activation.',
    },
  },

  // --- Shared officer nerfs (applied in print + sim) ---
  {
    id: 'shared-coordinated-volley-one',
    race: 'Shared',
    active: false,
    note:
      'Already applied: Coordinated Volley → one free ranged attack (was two). Was top ability-linked kill engine.',
    sim: { coordinatedVolleyShooters: 1 },
    propose: {
      target: 'ability',
      name: 'Coordinated Volley',
      field: 'description',
      before: "Two of this company's ranged units immediately attack.",
      after: "One of this company's ranged units immediately attacks.",
      printable:
        'Coordinated Volley → one free ranged attack (was two).',
    },
  },

  // --- Dwarf kit (if soft on printed baseline) ---
  {
    id: 'dwarf-stone-highways-plus',
    race: 'Dwarf',
    active: true,
    note: 'Buff Stone Highways — Disciplined Advance already; grant +1 Move via inspiringPresence path.',
    sim: { stoneHighwaysMove: true },
    propose: {
      target: 'ability',
      name: 'Stone Highways',
      field: 'description',
      before: '(see DB — terrain pace passive)',
      after:
        'Dwarf units in your army beginning activation inside Command Radius gain +1 Move and treat difficult terrain as 1.',
      printable:
        'Stone Highways → add “+1 Move” for Dwarves in CR (keep difficult→1 if already printed).',
    },
  },

  // --- Optional Compact dials (flat; prefer kit dials above) ---
  {
    id: 'human-compact-hit',
    race: 'Human',
    active: true,
    note: 'Human Compact +1 Hit (tiny mono lift with formation kit).',
    sim: { compactHit: 1 },
    propose: {
      target: 'ability',
      name: 'Human Compact',
      field: 'description',
      before:
        'Human units in your army within Command Radius gain +1 Damage and Harden 1.',
      after:
        'Human units in your army within Command Radius gain +1 Damage, +1 Hit, and Harden 1.',
      printable:
        'Human Compact → “…gain +1 Damage, +1 Hit, and Harden 1.”',
    },
  },
  {
    id: 'demon-compact-hit',
    race: 'Demon',
    active: true,
    note: 'Printed Demon Compact includes +1 Hit and Harden 1.',
    sim: { compactHit: 1, compactHarden: 1 },
    propose: {
      target: 'ability',
      name: 'Demon Compact',
      field: 'description',
      before: 'Demon units in your army within Command Radius gain +1 Damage.',
      after:
        'Demon units in your army within Command Radius gain +1 Damage, +1 Hit, and Harden 1.',
      printable: 'Demon Compact → “…gain +1 Damage, +1 Hit, and Harden 1.” (printed)',
    },
  },
  {
    id: 'elf-compact-hit',
    race: 'Elf',
    active: true,
    note: 'Printed Elf Compact includes +1 Hit.',
    sim: { compactHit: 1 },
    propose: {
      target: 'ability',
      name: 'Elf Compact',
      field: 'description',
      before: 'Elf units in your army within Command Radius gain +1 Damage.',
      after:
        'Elf units in your army within Command Radius gain +1 Damage and +1 Hit.',
      printable: 'Elf Compact → “…gain +1 Damage and +1 Hit.” (printed)',
    },
  },
  {
    id: 'dwarf-compact-hit',
    race: 'Dwarf',
    active: true,
    note: 'Printed Dwarf Compact: +2 Damage, +1 Hit, Harden 2.',
    sim: { compactHit: 1, compactDamage: 2, compactHarden: 2 },
    propose: {
      target: 'ability',
      name: 'Dwarf Compact',
      field: 'description',
      before:
        'Dwarf units in your army within Command Radius gain +1 Damage and Harden 1.',
      after:
        'Dwarf units in your army within Command Radius gain +2 Damage, +1 Hit, and Harden 2.',
      printable:
        'Dwarf Compact → “…gain +2 Damage, +1 Hit, and Harden 2.” (printed)',
    },
  },
  {
    id: 'lizardman-compact-hit',
    race: 'Lizardman',
    active: true,
    note: 'Printed Lizardman Compact: +2 Damage, +1 Hit, Harden 2.',
    sim: { compactHit: 1, compactDamage: 2, compactHarden: 2 },
    propose: {
      target: 'ability',
      name: 'Lizardman Compact',
      field: 'description',
      before: 'Lizardman units in your army within Command Radius gain +1 Damage.',
      after:
        'Lizardman units in your army within Command Radius gain +2 Damage, +1 Hit, and Harden 2.',
      printable:
        'Lizardman Compact → “…gain +2 Damage, +1 Hit, and Harden 2.” (printed)',
    },
  },
  {
    id: 'undead-compact-hit',
    race: 'Undead',
    active: true,
    note: 'Printed Undead Compact: +2 Damage, +1 Hit, Harden 2.',
    sim: { compactHit: 1, compactDamage: 2, compactHarden: 2 },
    propose: {
      target: 'ability',
      name: 'Undead Compact',
      field: 'description',
      before:
        'Undead units in your army within Command Radius gain +1 Damage and Harden 1.',
      after:
        'Undead units in your army within Command Radius gain +2 Damage, +1 Hit, and Harden 2.',
      printable:
        'Undead Compact → “…gain +2 Damage, +1 Hit, and Harden 2.” (printed)',
    },
  },
]

export function activeDials() {
  return BALANCE_DIALS.filter((d) => d.active)
}

export function setDialActive(id, active) {
  const d = BALANCE_DIALS.find((x) => x.id === id)
  if (!d) throw new Error(`Unknown dial: ${id}`)
  d.active = !!active
  return d
}

/** Resolve Compact bonuses for a race after applying active Compact dials only. */
export function compactBonusForRace(race) {
  const base = PRINTED_COMPACT[race] || { damage: 0, harden: 0, hit: 0 }
  const out = { damage: base.damage, harden: base.harden, hit: base.hit }
  for (const d of activeDials()) {
    if (d.race !== race) continue
    if (d.sim.compactDamage != null) out.damage = d.sim.compactDamage
    if (d.sim.compactHarden != null) out.harden = d.sim.compactHarden
    if (d.sim.compactHit != null) out.hit = d.sim.compactHit
  }
  return out
}

/** Ability cost overrides from active dials. */
export function abilityCostOverrides() {
  const out = {}
  for (const d of activeDials()) {
    const ov = d.sim.abilityCostOverride
    if (!ov) continue
    Object.assign(out, ov)
  }
  return out
}

/** Resolved gameplay flags from active ability-kit dials. */
export function dialEffects() {
  const fx = {
    lineCadenceAllAttacks: false,
    realmwardMoveBonus: 1,
    hearthfortReduce: 1,
    holdTheLineHarden: 1,
    packAdjacentRequired: 2,
    packHuntDamage: 1, // printed Pack Hunt is +1 Damage (no Hit)
    stoneHighwaysMove: false,
    commanderCastAnytime: false,
  }
  for (const d of activeDials()) {
    if (d.sim.lineCadenceAllAttacks) fx.lineCadenceAllAttacks = true
    if (d.sim.realmwardMoveBonus != null) fx.realmwardMoveBonus = Number(d.sim.realmwardMoveBonus)
    if (d.sim.hearthfortReduce != null) fx.hearthfortReduce = Number(d.sim.hearthfortReduce)
    if (d.sim.holdTheLineHarden != null) fx.holdTheLineHarden = Number(d.sim.holdTheLineHarden)
    if (d.sim.packAdjacentRequired != null) {
      fx.packAdjacentRequired = Number(d.sim.packAdjacentRequired)
    }
    if (d.sim.packHuntDamage != null) fx.packHuntDamage = Number(d.sim.packHuntDamage)
    if (d.sim.stoneHighwaysMove) fx.stoneHighwaysMove = true
    if (d.sim.commanderCastAnytime) fx.commanderCastAnytime = true
  }
  return fx
}

export function lintDialRegistry() {
  const errors = []
  for (const d of BALANCE_DIALS) {
    if (d.active && !d.propose?.printable) {
      errors.push(`${d.id}: active dial missing propose.printable`)
    }
    if (d.active && !d.propose?.name) {
      errors.push(`${d.id}: active dial missing propose.name`)
    }
  }
  return errors
}

/**
 * @param {{ raceWinShare: Record<string, number>, label?: string, observations?: string[] }} summary
 */
export function buildProposalsReport(summary) {
  const active = activeDials()
  const lint = lintDialRegistry()
  return {
    generatedAt: new Date().toISOString(),
    suiteLabel: summary.label || 'sim-200',
    raceWinShare: summary.raceWinShare || {},
    observations: summary.observations || [],
    philosophy:
      'Prefer race-specific commander/officer ability edits over flat Compact stats. Every active dial maps to printable card text. Cast-AI preferences are not card changes. Mono lists sample multiple commanders (not kinship-only).',
    lintErrors: lint,
    activeDials: active.map((d) => ({
      id: d.id,
      race: d.race,
      note: d.note || null,
      sim: d.sim,
      propose: d.propose,
    })),
    inactiveDials: BALANCE_DIALS.filter((d) => !d.active).map((d) => ({
      id: d.id,
      race: d.race,
      note: d.note || null,
      propose: d.propose,
    })),
    doNotApply: [
      'Commander/officer cast() probabilities (AI preference only).',
      'Army-build list heuristics for Mixed/Beastfolk variety.',
      'Naked race hitRequirement/move/damage dials (removed from sim).',
    ],
    cardEdits: active.map((d) => ({
      abilityOrCard: d.propose.name,
      target: d.propose.target,
      field: d.propose.field,
      before: d.propose.before,
      after: d.propose.after,
      printable: d.propose.printable,
      dialId: d.id,
      race: d.race,
    })),
  }
}

export function proposalsMarkdown(report) {
  const lines = []
  lines.push('# Sim dial → card proposals')
  lines.push('')
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Suite: ${report.suiteLabel}`)
  lines.push('')
  lines.push(report.philosophy)
  lines.push('')
  if (report.observations?.length) {
    lines.push('## Observations')
    lines.push('')
    for (const o of report.observations) lines.push(`- ${o}`)
    lines.push('')
  }
  lines.push('## Race win share')
  lines.push('')
  const shares = Object.entries(report.raceWinShare || {}).sort(
    (a, b) => b[1] - a[1],
  )
  for (const [r, v] of shares) lines.push(`- **${r}**: ${v}%`)
  lines.push('')
  lines.push('## Active dials → apply these card edits')
  lines.push('')
  if (!report.cardEdits.length) {
    lines.push('_No active dials — suite is printed baseline only._')
    lines.push('')
  } else {
    for (const e of report.cardEdits) {
      lines.push(`### ${e.abilityOrCard} (\`${e.dialId}\`)`)
      lines.push('')
      lines.push(`- **Target:** ${e.target}`)
      lines.push(`- **Field:** ${e.field}`)
      lines.push(`- **Before:** ${e.before}`)
      lines.push(`- **After:** ${e.after}`)
      lines.push(`- **Printable:** ${e.printable}`)
      lines.push('')
    }
  }
  lines.push('## Inactive dials (available to toggle)')
  lines.push('')
  for (const d of report.inactiveDials) {
    lines.push(`- \`${d.id}\` (${d.race}): ${d.propose.printable}`)
  }
  lines.push('')
  lines.push('## Do not apply as card changes')
  lines.push('')
  for (const x of report.doNotApply) lines.push(`- ${x}`)
  lines.push('')
  if (report.lintErrors?.length) {
    lines.push('## Lint errors')
    lines.push('')
    for (const e of report.lintErrors) lines.push(`- ${e}`)
    lines.push('')
  }
  return lines.join('\n')
}
