/**
 * Human vs Demon matchup diagnostics.
 * Usage: SIM_RUNS=100 node scripts/diagnoseHumanDemon.mjs
 */
import fs from 'node:fs'

const API = process.env.CW_API || 'http://127.0.0.1:8787'
const RUNS = Number(process.env.SIM_RUNS || 100)

const src = fs.readFileSync(new URL('./battleSim.mjs', import.meta.url), 'utf8')
const modCode =
  src.replace(/async function main\(\)[\s\S]*$/, '') + '\nexport { simulateMatch }\n'
const tmp = new URL('./_battleSimExport.mjs', import.meta.url)
fs.writeFileSync(tmp, modCode)
const { simulateMatch } = await import(tmp.href + '?t=' + Date.now())

const cards = (await (await fetch(`${API}/api/cards`)).json()).cards
const abilities = (await (await fetch(`${API}/api/abilities`)).json()).abilities
const abilityMap = new Map(abilities.map((a) => [a.name, a]))

const byName = new Map(cards.map((c) => [c.name, c]))

function countKw(force, kw) {
  let n = 0
  for (const co of force.companies || []) {
    for (const r of co.roster || []) {
      const card = byName.get(r.unit)
      if (!card) continue
      const kws = card.keywords || []
      if (kws.includes(kw)) n += r.copies || 1
    }
  }
  return n
}

const agg = {
  wins: { Human: 0, Demon: 0, Draw: 0 },
  vp: { Human: 0, Demon: 0 },
  killVp: { Human: 0, Demon: 0 },
  objVp: { Human: 0, Demon: 0 },
  endAlive: { Human: 0, Demon: 0 },
  endUv: { Human: 0, Demon: 0 },
  cmdDead: { Human: 0, Demon: 0 },
  offAlive: { Human: 0, Demon: 0 },
  commanders: { Human: {}, Demon: {} },
  killRoles: {
    Human: { commander: 0, officer: 0, unit: 0 },
    Demon: { commander: 0, officer: 0, unit: 0 },
  },
  killedNames: { Human: {}, Demon: {} },
  earlyLeadR3: { Human: 0, Demon: 0, Tie: 0 },
  objCtrlR3: { Human: 0, Demon: 0, none: 0 },
  objCtrlFinal: { Human: 0, Demon: 0, none: 0 },
  kw: {
    Human: { Shieldwall: 0, Harden: 0, Brace: 0, Defender: 0 },
    Demon: { Fear: 0, Frenzy: 0, Charge: 0, Flying: 0, Cleave: 0 },
  },
  avgAp: { Human: 0, Demon: 0 },
  apN: 0,
  blowouts: { Human: 0, Demon: 0 },
  close: 0,
  rounds: 0,
}

for (let i = 0; i < RUNS; i++) {
  const result = simulateMatch('Human', 'Demon', cards, abilityMap, 9000 + i * 17)
  const w = result.winner
  agg.wins[w] = (agg.wins[w] || 0) + 1
  agg.vp.Human += result.vp.Human
  agg.vp.Demon += result.vp.Demon
  agg.killVp.Human += result.killVp.Human
  agg.killVp.Demon += result.killVp.Demon
  agg.objVp.Human += Math.max(0, result.vp.Human - result.killVp.Human)
  agg.objVp.Demon += Math.max(0, result.vp.Demon - result.killVp.Demon)
  agg.endAlive.Human += result.end.Human.alive
  agg.endAlive.Demon += result.end.Demon.alive
  agg.endUv.Human += result.end.Human.uvAlive
  agg.endUv.Demon += result.end.Demon.uvAlive
  if (!result.end.Human.commanderAlive) agg.cmdDead.Human++
  if (!result.end.Demon.commanderAlive) agg.cmdDead.Demon++
  agg.offAlive.Human += result.end.Human.officersAlive
  agg.offAlive.Demon += result.end.Demon.officersAlive
  agg.rounds += result.roundsPlayed

  const margin = Math.abs(result.vp.Human - result.vp.Demon)
  if (margin >= 20) agg.blowouts[w === 'Draw' ? 'Human' : w]++
  else if (margin <= 6) agg.close++

  const hc = result.forces.Human.commander
  const dc = result.forces.Demon.commander
  agg.commanders.Human[hc] = (agg.commanders.Human[hc] || 0) + 1
  agg.commanders.Demon[dc] = (agg.commanders.Demon[dc] || 0) + 1

  for (const k of Object.keys(agg.kw.Human)) agg.kw.Human[k] += countKw(result.forces.Human, k)
  for (const k of Object.keys(agg.kw.Demon)) agg.kw.Demon[k] += countKw(result.forces.Demon, k)

  const hap = result.forces.Human.companies.reduce((s, c) => s + (c.companyAp || 0), 0)
  const dap = result.forces.Demon.companies.reduce((s, c) => s + (c.companyAp || 0), 0)
  agg.avgAp.Human += hap
  agg.avgAp.Demon += dap
  agg.apN++

  for (const k of result.kills.Human) {
    agg.killRoles.Human[k.role] = (agg.killRoles.Human[k.role] || 0) + 1
    agg.killedNames.Human[k.name] = (agg.killedNames.Human[k.name] || 0) + 1
  }
  for (const k of result.kills.Demon) {
    agg.killRoles.Demon[k.role] = (agg.killRoles.Demon[k.role] || 0) + 1
    agg.killedNames.Demon[k.name] = (agg.killedNames.Demon[k.name] || 0) + 1
  }

  const r3 = result.log.find((l) => l.round === 3 && l.vp)
  if (r3) {
    if (r3.vp.A > r3.vp.B) agg.earlyLeadR3.Human++
    else if (r3.vp.B > r3.vp.A) agg.earlyLeadR3.Demon++
    else agg.earlyLeadR3.Tie++
    for (const o of r3.obj || []) {
      if (o.ctrl === 'A') agg.objCtrlR3.Human++
      else if (o.ctrl === 'B') agg.objCtrlR3.Demon++
      else agg.objCtrlR3.none++
    }
  }
  const last = result.lastRound
  if (last?.obj) {
    for (const o of last.obj) {
      if (o.ctrl === 'A') agg.objCtrlFinal.Human++
      else if (o.ctrl === 'B') agg.objCtrlFinal.Demon++
      else agg.objCtrlFinal.none++
    }
  }
}

const avg = (n) => +(n / RUNS).toFixed(2)
const top = (obj, n = 8) =>
  Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k}×${v}`)
    .join(', ')

const out = {
  runs: RUNS,
  wins: agg.wins,
  avgVp: { Human: avg(agg.vp.Human), Demon: avg(agg.vp.Demon) },
  avgKillVp: { Human: avg(agg.killVp.Human), Demon: avg(agg.killVp.Demon) },
  avgObjVp: { Human: avg(agg.objVp.Human), Demon: avg(agg.objVp.Demon) },
  avgEndAlive: { Human: avg(agg.endAlive.Human), Demon: avg(agg.endAlive.Demon) },
  avgEndUv: { Human: avg(agg.endUv.Human), Demon: avg(agg.endUv.Demon) },
  commanderDeathRate: {
    Human: +((agg.cmdDead.Human / RUNS) * 100).toFixed(1) + '%',
    Demon: +((agg.cmdDead.Demon / RUNS) * 100).toFixed(1) + '%',
  },
  avgOfficersAlive: { Human: avg(agg.offAlive.Human), Demon: avg(agg.offAlive.Demon) },
  earlyLeadR3: agg.earlyLeadR3,
  objHexesControlledR3: agg.objCtrlR3,
  objHexesControlledFinal: agg.objCtrlFinal,
  blowoutsMargin20: agg.blowouts,
  closeGamesMargin6: agg.close,
  avgRounds: avg(agg.rounds),
  avgCompanyApPool: {
    Human: avg(agg.avgAp.Human),
    Demon: avg(agg.avgAp.Demon),
  },
  commanders: agg.commanders,
  avgKeywordsPerGame: {
    Human: Object.fromEntries(
      Object.entries(agg.kw.Human).map(([k, v]) => [k, avg(v)]),
    ),
    Demon: Object.fromEntries(
      Object.entries(agg.kw.Demon).map(([k, v]) => [k, avg(v)]),
    ),
  },
  killsByRole: agg.killRoles,
  topUnitsKilledByHuman: top(agg.killedNames.Human),
  topUnitsKilledByDemon: top(agg.killedNames.Demon),
}

fs.mkdirSync(new URL('../sim/', import.meta.url), { recursive: true })
fs.writeFileSync(
  new URL('../sim/diag-human-demon.json', import.meta.url),
  JSON.stringify(out, null, 2),
)
console.log(JSON.stringify(out, null, 2))
fs.unlinkSync(tmp)
