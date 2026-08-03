#!/usr/bin/env node
/**
 * Audit officers for UV cost vs ability/stats fairness.
 * Flags officers with similar stats but different UV, or similar UV with vastly different ability kits.
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '..', 'data', 'command-warfare.sqlite');

const db = new Database(DB_PATH);

// Fetch all officers
const officers = db.prepare(`
  SELECT 
    id, name, race, card_type, rarity, uv,
    move, damage, range_value, toughness, command_radius, 
    company_ap, ap_generation, cc_generation, company_capacity,
    abilities_json, keywords_json
  FROM cards
  WHERE card_type = 'Officer'
  ORDER BY race, uv, name
`).all();

// Fetch all abilities for power assessment
const abilitiesMap = new Map();
const abilities = db.prepare(`SELECT name, ability_type, cost, cost_amount, description FROM abilities`).all();
for (const ability of abilities) {
  abilitiesMap.set(ability.name, ability);
}

db.close();

// Parse and enrich officers
const enrichedOfficers = officers.map(officer => {
  const abilities = JSON.parse(officer.abilities_json || '[]');
  const keywords = JSON.parse(officer.keywords_json || '[]');
  
  return {
    id: officer.id,
    name: officer.name,
    race: officer.race,
    rarity: officer.rarity,
    uv: officer.uv || 0,
    stats: {
      move: officer.move || 0,
      damage: officer.damage || 0,
      range: officer.range_value || 0,
      toughness: officer.toughness || 0,
      commandRadius: officer.command_radius || 0,
      companyAp: officer.company_ap || 0,
      companyCap: officer.company_capacity || 0,
      apGen: officer.ap_generation || 0,
      ccGen: officer.cc_generation || 0,
    },
    abilities,
    keywords,
    abilityDetails: abilities.map(a => abilitiesMap.get(a)).filter(Boolean),
  };
});

// Helper: calculate stat similarity (0 = identical, higher = more different)
function statDistance(stats1, stats2) {
  const keys = ['move', 'damage', 'range', 'toughness', 'commandRadius', 'companyAp', 'companyCap'];
  let diff = 0;
  for (const key of keys) {
    diff += Math.abs(stats1[key] - stats2[key]);
  }
  return diff;
}

// Helper: classify ability power (improved heuristic)
function abilityPower(abilityDetails) {
  let score = 0;
  for (const ab of abilityDetails) {
    if (!ab) continue;
    
    // Active abilities are more valuable
    if (ab.ability_type === 'Active') {
      score += 3;
      
      // High-value actives (CC spells, big buffs, combat effects)
      const highValue = ['Raise', 'Mass Fear', 'Terrify', 'Charge', 'Battle Cry', 'Frenzy', 
                        'Necrotic Bolt', 'Bone Prison', 'Inferno Cone', 'Terror Dive',
                        'Ember Burst', 'Blood Lottery', 'Alpha Mark', 'Brood Call'];
      if (highValue.some(v => ab.name.includes(v))) {
        score += 2;
      }
      
      // Check cost - low-cost actives are often spammable
      if (ab.cost_amount && ab.cost_amount <= 1) {
        score += 1;
      }
      
      // CC-cost abilities are typically stronger
      if (ab.cost && ab.cost.includes('CC')) {
        score += 1;
      }
    } else if (ab.ability_type === 'Passive') {
      score += 1;
      
      // Strong passives
      const strongPassives = ['Leadership', 'Bolster', 'Inspire', 'Rally', 'Compact'];
      if (strongPassives.some(v => ab.name.includes(v))) {
        score += 1;
      }
    }
  }
  
  return score;
}

// Helper: count active abilities
function countActives(abilityDetails) {
  return abilityDetails.filter(ab => ab && ab.ability_type === 'Active').length;
}

// Helper: count passive abilities
function countPassives(abilityDetails) {
  return abilityDetails.filter(ab => ab && ab.ability_type === 'Passive').length;
}

// Helper: format stats for display
function formatStats(stats) {
  return `M${stats.move}/D${stats.damage}/R${stats.range}/T${stats.toughness}/CR${stats.commandRadius}` +
         (stats.companyAp ? `/CAP${stats.companyAp}` : '');
}

// Helper: format abilities with types
function formatAbilities(abilityDetails) {
  return abilityDetails.map(ab => {
    if (!ab) return '?';
    const type = ab.ability_type === 'Active' ? 'A' : ab.ability_type === 'Passive' ? 'P' : 'U';
    const cost = ab.cost_amount ? `${ab.cost_amount}${ab.cost?.includes('CC') ? 'CC' : 'AP'}` : '';
    return `${ab.name}(${type}${cost ? ':' + cost : ''})`;
  }).join(', ');
}

// Group by race
const byRace = {};
for (const officer of enrichedOfficers) {
  if (!byRace[officer.race]) byRace[officer.race] = [];
  byRace[officer.race].push(officer);
}

console.log('# Officer UV Cost vs Ability/Stats Fairness Audit\n');
console.log(`Total officers: ${enrichedOfficers.length}\n`);

// Find problem clusters per race
const problems = [];

for (const [race, officers] of Object.entries(byRace)) {
  for (let i = 0; i < officers.length; i++) {
    for (let j = i + 1; j < officers.length; j++) {
      const a = officers[i];
      const b = officers[j];
      
      const uvDiff = Math.abs(a.uv - b.uv);
      const statDist = statDistance(a.stats, b.stats);
      const powerA = abilityPower(a.abilityDetails);
      const powerB = abilityPower(b.abilityDetails);
      const activesA = countActives(a.abilityDetails);
      const activesB = countActives(b.abilityDetails);
      
      // Flag if: similar stats (≤3 total stat diff), close UV (≤2), but very different ability power (≥4 diff)
      if (statDist <= 3 && uvDiff <= 2 && Math.abs(powerA - powerB) >= 4) {
        problems.push({
          race,
          officer1: a,
          officer2: b,
          uvDiff,
          statDist,
          powerDiff: Math.abs(powerA - powerB),
          activeDiff: Math.abs(activesA - activesB),
          issue: `Sim stats (Δ${statDist}), UV Δ${uvDiff.toFixed(1)}, power Δ${Math.abs(powerA - powerB)} (${a.abilities.length}ab/${activesA}act vs ${b.abilities.length}ab/${activesB}act)`,
        });
      }
      
      // Also flag if: same UV (±0.5), but very different active counts (≥2)
      if (uvDiff <= 0.5 && Math.abs(activesA - activesB) >= 2) {
        problems.push({
          race,
          officer1: a,
          officer2: b,
          uvDiff,
          statDist,
          powerDiff: Math.abs(powerA - powerB),
          activeDiff: Math.abs(activesA - activesB),
          issue: `Same UV (Δ${uvDiff.toFixed(1)}), active Δ${Math.abs(activesA - activesB)} (${activesA} vs ${activesB})`,
        });
      }
    }
  }
}

// Sort problems by severity (power diff + UV mismatch)
problems.sort((a, b) => (b.powerDiff * 2 + b.activeDiff) - (a.powerDiff * 2 + a.activeDiff));

console.log('## Problem Clusters (Similar Stats/UV, Different Ability Power)\n');
console.log('| Race | Officer 1 | UV | Stats | Actives | Power | Officer 2 | UV | Stats | Actives | Power | Issue |');
console.log('|------|-----------|-----|-------|---------|-------|-----------|-----|-------|---------|-------|-------|');

for (const problem of problems.slice(0, 40)) {
  const o1 = problem.officer1;
  const o2 = problem.officer2;
  const p1 = abilityPower(o1.abilityDetails);
  const p2 = abilityPower(o2.abilityDetails);
  const a1 = countActives(o1.abilityDetails);
  const a2 = countActives(o2.abilityDetails);
  console.log(`| ${problem.race} | **${o1.name}** | ${o1.uv} | ${formatStats(o1.stats)} | ${a1} | ${p1} | **${o2.name}** | ${o2.uv} | ${formatStats(o2.stats)} | ${a2} | ${p2} | ${problem.issue} |`);
}

// Find overcosted/undercosted officers
console.log('\n\n## Potential Overcosted Officers (High UV, Weak Kit)\n');
console.log('Criteria: UV ≥ 11 but ability power ≤ 6 and actives ≤ 1\n');
console.log('| Race | Officer | UV | Stats | Abilities | Actives | Power | Recommendation |');
console.log('|------|---------|-----|-------|-----------|---------|-------|----------------|');

const overcosted = [];
for (const officer of enrichedOfficers) {
  const power = abilityPower(officer.abilityDetails);
  const actives = countActives(officer.abilityDetails);
  
  // Flag if UV ≥ 11 but power score ≤ 6 and actives ≤ 1
  if (officer.uv >= 11 && power <= 6 && actives <= 1) {
    overcosted.push({ officer, power, actives });
  }
}

overcosted.sort((a, b) => (b.officer.uv - a.officer.uv) || (a.power - b.power));

for (const { officer, power, actives } of overcosted.slice(0, 20)) {
  const targetUV = officer.uv - (actives === 0 ? 2 : 1);
  console.log(`| ${officer.race} | **${officer.name}** | ${officer.uv} | ${formatStats(officer.stats)} | ${officer.abilities.join(', ')} | ${actives} | ${power} | **UV ${officer.uv} → ${targetUV}** or add 1-2 actives |`);
}

console.log('\n\n## Potential Undercosted Officers (Low UV, Strong Kit)\n');
console.log('Criteria: UV ≤ 10 but ability power ≥ 10 and actives ≥ 3\n');
console.log('| Race | Officer | UV | Stats | Abilities | Actives | Power | Recommendation |');
console.log('|------|---------|-----|-------|-----------|---------|-------|----------------|');

const undercosted = [];
for (const officer of enrichedOfficers) {
  const power = abilityPower(officer.abilityDetails);
  const actives = countActives(officer.abilityDetails);
  
  // Flag if UV ≤ 10 but power score ≥ 10 and actives ≥ 3
  if (officer.uv <= 10 && power >= 10 && actives >= 3) {
    undercosted.push({ officer, power, actives });
  }
}

undercosted.sort((a, b) => (b.power - a.power) || (a.officer.uv - b.officer.uv));

for (const { officer, power, actives } of undercosted.slice(0, 15)) {
  const targetUV = officer.uv + 1;
  console.log(`| ${officer.race} | **${officer.name}** | ${officer.uv} | ${formatStats(officer.stats)} | ${officer.abilities.join(', ')} | ${actives} | ${power} | **UV ${officer.uv} → ${targetUV}** or reduce 1 active |`);
}

console.log('\n\n## All Officers by Race (with Ability Analysis)\n');
for (const [race, officers] of Object.entries(byRace)) {
  console.log(`\n### ${race} (${officers.length} officers)\n`);
  console.log('| Officer | UV | Stats | Abilities | Act | Pas | Power |');
  console.log('|---------|-----|-------|-----------|-----|-----|-------|');
  
  for (const officer of officers) {
    const power = abilityPower(officer.abilityDetails);
    const actives = countActives(officer.abilityDetails);
    const passives = countPassives(officer.abilityDetails);
    console.log(`| ${officer.name} | ${officer.uv} | ${formatStats(officer.stats)} | ${officer.abilities.join(', ')} | ${actives} | ${passives} | ${power} |`);
  }
}

console.log('\n\n---\n');
console.log('## Legend\n');
console.log('- **Power Score**: Heuristic (3 per active, 1 per passive, bonuses for strong abilities like Raise, Mass Fear, etc.)\n');
console.log('- **Act**: Count of active abilities\n');
console.log('- **Pas**: Count of passive abilities\n');
console.log('- **Stats**: M=Move, D=Damage, R=Range, T=Toughness, CR=Command Radius, CAP=Company AP\n');
console.log('- **Sim**: Similar\n');
console.log('- **Δ**: Delta (difference)\n');
