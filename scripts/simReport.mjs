/**
 * Battle Sim Matchup Report Generator
 * 
 * Generates Excel workbooks (.xlsx) and optional markdown reports with:
 * - Overview tab: Race win share, full matchup matrix, run metadata
 * - Per-race tabs: Matchup records, commander performance, combat stats, abilities
 * 
 * Usage:
 *   node scripts/simReport.mjs                     # Run sim and export to xlsx
 *   node scripts/simReport.mjs --from FILE.json    # Report from existing JSON
 *   node scripts/simReport.mjs --md                # Also generate markdown
 *   node scripts/simReport.mjs --out REPORT.xlsx   # Custom output path
 * 
 * Example:
 *   npm run sim:report
 *   node scripts/simReport.mjs --from sim/sim-200-latest.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import ExcelJS from 'exceljs'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Build matrix from report if not present in data
 */
function ensureMatrix(data) {
  if (data.matrix) return data
  
  const { report } = data
  if (!report || report.length === 0) return data
  
  // Extract unique races from report
  const raceSet = new Set()
  for (const row of report) {
    const [a, b] = row.matchup.split(' vs ')
    if (a && a !== 'Mixed') raceSet.add(a)
    if (b && b !== 'Mixed') raceSet.add(b)
  }
  const races = Array.from(raceSet).sort()
  
  // Build matrix from report data
  const matrix = {}
  for (const r of races) {
    matrix[r] = Object.fromEntries(races.map(c => [c, null]))
  }
  
  for (const row of report) {
    const [a, b] = row.matchup.split(' vs ')
    if (!a || !b || a === 'Mixed' || b === 'Mixed') continue
    
    const winsA = row.wins[a] || 0
    const winsB = row.wins[b] || 0
    const draws = row.wins.Draw || 0
    const total = winsA + winsB + draws || 1
    
    matrix[a][b] = +((100 * winsA) / total).toFixed(1)
    matrix[b][a] = +((100 * winsB) / total).toFixed(1)
  }
  
  return { ...data, matrix }
}

/**
 * Calculate race statistics from report
 */
function calculateRaceStats(data) {
  data = ensureMatrix(data)
  const { report, matrix } = data
  const races = Object.keys(matrix || {}).filter(r => r !== 'Mixed')
  
  const raceStats = {}
  for (const r of races) {
    raceStats[r] = { wins: 0, losses: 0, draws: 0, total: 0 }
  }
  
  for (const row of report || []) {
    const [a, b] = row.matchup.split(' vs ')
    if (!a || !b) continue
    
    const winsA = row.wins[a] || 0
    const winsB = row.wins[b] || 0
    const draws = row.wins.Draw || 0
    const games = row.runs || 0
    
    if (raceStats[a]) {
      raceStats[a].wins += winsA
      raceStats[a].losses += winsB
      raceStats[a].draws += draws
      raceStats[a].total += games
    }
    if (raceStats[b]) {
      raceStats[b].wins += winsB
      raceStats[b].losses += winsA
      raceStats[b].draws += draws
      raceStats[b].total += games
    }
  }
  
  // Calculate win percentages and sort
  const ranked = races
    .map(race => {
      const { wins, losses, draws, total } = raceStats[race]
      const winPct = total > 0 ? (100 * wins / total).toFixed(1) : '0.0'
      const lossPct = total > 0 ? (100 * losses / total).toFixed(1) : '0.0'
      const drawPct = total > 0 ? (100 * draws / total).toFixed(1) : '0.0'
      return { 
        race, 
        winPct: parseFloat(winPct), 
        lossPct: parseFloat(lossPct),
        drawPct: parseFloat(drawPct),
        wins, 
        losses,
        draws,
        games: total 
      }
    })
    .sort((a, b) => b.winPct - a.winPct || b.wins - a.wins)
  
  return { raceStats, ranked }
}

/**
 * Get matchup data for a specific race
 */
function getRaceMatchups(data, race) {
  const { report } = data
  if (!report) return []
  
  const matchups = []
  for (const row of report) {
    const [a, b] = row.matchup.split(' vs ')
    if (a !== race && b !== race) continue
    if (a === 'Mixed' || b === 'Mixed') continue
    
    const opponent = a === race ? b : a
    const winsRace = row.wins[race] || 0
    const winsOpp = row.wins[opponent] || 0
    const draws = row.wins.Draw || 0
    const games = row.runs || 0
    const winPct = games > 0 ? ((100 * winsRace) / games).toFixed(1) : '0.0'
    
    matchups.push({
      opponent,
      wins: winsRace,
      losses: winsOpp,
      draws,
      games,
      winPct: parseFloat(winPct)
    })
  }
  
  return matchups.sort((a, b) => a.opponent.localeCompare(b.opponent))
}

/**
 * Generate Excel workbook with multi-tab report
 */
async function generateExcelReport(data, outPath) {
  data = ensureMatrix(data)
  const { summary, matrix, commanderPerformanceByRace, combatStats, abilityPerformance } = data
  const { ranked } = calculateRaceStats(data)
  const races = ranked.map(r => r.race)
  
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'CommandWarfare Sim Report'
  workbook.created = new Date()
  
  // Tab 1: Overview
  const overviewSheet = workbook.addWorksheet('Overview')
  let row = 1
  
  // Title and metadata
  overviewSheet.getCell(`A${row}`).value = 'Battle Sim Matchup Report'
  overviewSheet.getCell(`A${row}`).font = { bold: true, size: 16 }
  row += 1
  
  overviewSheet.getCell(`A${row}`).value = `Generated: ${new Date().toISOString()}`
  row += 1
  
  const totalGames = summary?.samples || ranked.reduce((sum, r) => sum + r.games, 0) / 2
  overviewSheet.getCell(`A${row}`).value = `Total games: ${totalGames}`
  row += 1
  
  if (summary?.caps) {
    const { army, deploy, reserve, unused } = summary.caps
    overviewSheet.getCell(`A${row}`).value = `Army cap: ${army}, Deploy: ${deploy}, Reserve: ${reserve}${unused != null ? `, Flex: ${unused}` : ''}`
    row += 1
  }
  
  if (summary?.monoRace !== undefined) {
    overviewSheet.getCell(`A${row}`).value = `Mixed armies: ${summary.monoRace ? 'OFF' : 'ON'}`
    row += 1
  }
  
  row += 1
  
  // Race Win Share Table
  overviewSheet.getCell(`A${row}`).value = 'Race Win Share'
  overviewSheet.getCell(`A${row}`).font = { bold: true, size: 14 }
  row += 1
  
  const headers = ['Rank', 'Race', 'Win %', 'Loss %', 'Draw %', 'Wins', 'Losses', 'Draws', 'Games']
  headers.forEach((header, i) => {
    const cell = overviewSheet.getCell(row, i + 1)
    cell.value = header
    cell.font = { bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } }
  })
  row += 1
  
  ranked.forEach((r, i) => {
    overviewSheet.getCell(row, 1).value = i + 1
    overviewSheet.getCell(row, 2).value = r.race
    overviewSheet.getCell(row, 3).value = r.winPct
    overviewSheet.getCell(row, 4).value = r.lossPct
    overviewSheet.getCell(row, 5).value = r.drawPct
    overviewSheet.getCell(row, 6).value = r.wins
    overviewSheet.getCell(row, 7).value = r.losses
    overviewSheet.getCell(row, 8).value = r.draws
    overviewSheet.getCell(row, 9).value = r.games
    row += 1
  })
  
  row += 1
  
  // Matchup Matrix
  overviewSheet.getCell(`A${row}`).value = 'Race Matchup Matrix (Row win % vs Column)'
  overviewSheet.getCell(`A${row}`).font = { bold: true, size: 14 }
  row += 1
  
  // Matrix header
  overviewSheet.getCell(row, 1).value = 'vs'
  overviewSheet.getCell(row, 1).font = { bold: true }
  races.forEach((race, i) => {
    const cell = overviewSheet.getCell(row, i + 2)
    cell.value = race
    cell.font = { bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } }
  })
  row += 1
  
  // Matrix data
  races.forEach((rowRace, i) => {
    const cell = overviewSheet.getCell(row, 1)
    cell.value = rowRace
    cell.font = { bold: true }
    
    races.forEach((colRace, j) => {
      const val = matrix[rowRace]?.[colRace]
      const cellData = overviewSheet.getCell(row, j + 2)
      
      if (rowRace === colRace) {
        cellData.value = '—'
        cellData.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } }
      } else if (val !== null && val !== undefined) {
        cellData.value = val
        // Color code: green for >55%, red for <45%
        if (val >= 55) {
          cellData.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } }
        } else if (val <= 45) {
          cellData.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } }
        }
      } else {
        cellData.value = '—'
      }
    })
    row += 1
  })
  
  // Auto-size columns
  overviewSheet.columns.forEach(column => {
    column.width = 12
  })
  overviewSheet.getColumn(2).width = 20 // Race names
  
  // Tab 2+: Per-race sheets
  for (const race of races) {
    const sheet = workbook.addWorksheet(race)
    let r = 1
    
    // Race title
    sheet.getCell(`A${r}`).value = `${race} Performance Report`
    sheet.getCell(`A${r}`).font = { bold: true, size: 16 }
    r += 2
    
    // Matchup records
    sheet.getCell(`A${r}`).value = 'Matchup Records'
    sheet.getCell(`A${r}`).font = { bold: true, size: 14 }
    r += 1
    
    const matchupHeaders = ['Opponent', 'Win %', 'W–L–D', 'Games']
    matchupHeaders.forEach((h, i) => {
      const cell = sheet.getCell(r, i + 1)
      cell.value = h
      cell.font = { bold: true }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } }
    })
    r += 1
    
    const matchups = getRaceMatchups(data, race)
    matchups.forEach(m => {
      sheet.getCell(r, 1).value = m.opponent
      sheet.getCell(r, 2).value = m.winPct
      sheet.getCell(r, 3).value = `${m.wins}–${m.losses}–${m.draws}`
      sheet.getCell(r, 4).value = m.games
      r += 1
    })
    
    r += 1
    
    // Commander Performance
    const commanders = commanderPerformanceByRace?.[race]
    if (commanders && commanders.length > 0) {
      sheet.getCell(`A${r}`).value = 'Commander Performance'
      sheet.getCell(`A${r}`).font = { bold: true, size: 14 }
      r += 1
      
      const cmdHeaders = ['Commander', 'Rarity', 'Win %', 'W–L–D', 'Games', 'Avg VP Diff', 'Avg Kills', 'Avg Dmg Dealt', 'Avg Dmg Taken', 'Hit Rate %']
      cmdHeaders.forEach((h, i) => {
        const cell = sheet.getCell(r, i + 1)
        cell.value = h
        cell.font = { bold: true }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } }
      })
      r += 1
      
      commanders
        .sort((a, b) => b.winPct - a.winPct)
        .forEach(cmd => {
          sheet.getCell(r, 1).value = cmd.name
          sheet.getCell(r, 2).value = cmd.rarity
          sheet.getCell(r, 3).value = cmd.winPct
          sheet.getCell(r, 4).value = `${cmd.wins}–${cmd.losses}–${cmd.draws}`
          sheet.getCell(r, 5).value = cmd.games
          sheet.getCell(r, 6).value = cmd.avgVpDiff
          sheet.getCell(r, 7).value = cmd.combat?.avgKills || 0
          sheet.getCell(r, 8).value = cmd.combat?.avgDamageDealt || 0
          sheet.getCell(r, 9).value = cmd.combat?.avgDamageTaken || 0
          sheet.getCell(r, 10).value = cmd.combat?.hitRate || 0
          r += 1
        })
      
      r += 1
    }
    
    // Combat Stats (from combatStats.byRace if available)
    const raceCombat = combatStats?.byRace?.[race]
    if (raceCombat) {
      sheet.getCell(`A${r}`).value = 'Combat Statistics'
      sheet.getCell(`A${r}`).font = { bold: true, size: 14 }
      r += 1
      
      const combatHeaders = ['Metric', 'Value']
      combatHeaders.forEach((h, i) => {
        const cell = sheet.getCell(r, i + 1)
        cell.value = h
        cell.font = { bold: true }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } }
      })
      r += 1
      
      const combatMetrics = [
        ['Games', raceCombat.games],
        ['Total Attacks', raceCombat.attacks],
        ['Total Hits', raceCombat.hits],
        ['Total Misses', raceCombat.misses],
        ['Hit Rate %', raceCombat.hitRate],
        ['Damage Dealt', raceCombat.damageDealt],
        ['Damage Taken', raceCombat.damageTaken],
        ['Avg Damage Dealt', raceCombat.avgDamageDealt],
        ['Avg Damage Taken', raceCombat.avgDamageTaken],
        ['Avg Attacks/Game', raceCombat.avgAttacks],
        ['Total Kills', raceCombat.kills],
        ['Avg Kills/Game', raceCombat.avgKills],
        ['Kill VP', raceCombat.killVp],
        ['Avg Kill VP/Game', raceCombat.avgKillVp],
        ['Brace Reactions', raceCombat.reactions?.brace || 0],
        ['Evade Reactions', raceCombat.reactions?.evade || 0],
        ['Retaliate Reactions', raceCombat.reactions?.retaliate || 0],
        ['Retaliate Hit Rate %', raceCombat.retaliateHitRate || 0],
      ]
      
      combatMetrics.forEach(([metric, value]) => {
        sheet.getCell(r, 1).value = metric
        sheet.getCell(r, 2).value = value
        r += 1
      })
      
      r += 1
    }
    
    // Ability Performance (if available and race-specific)
    if (abilityPerformance && Array.isArray(abilityPerformance)) {
      const raceAbilities = abilityPerformance
        .filter(a => a.race === race || !a.race)
        .sort((a, b) => (b.casts || 0) - (a.casts || 0))
        .slice(0, 20) // Top 20
      
      if (raceAbilities.length > 0) {
        sheet.getCell(`A${r}`).value = 'Top Ability Usage'
        sheet.getCell(`A${r}`).font = { bold: true, size: 14 }
        r += 1
        
        const abilityHeaders = ['Ability', 'Casts', 'Success Rate %', 'Avg Effect']
        abilityHeaders.forEach((h, i) => {
          const cell = sheet.getCell(r, i + 1)
          cell.value = h
          cell.font = { bold: true }
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } }
        })
        r += 1
        
        raceAbilities.forEach(ability => {
          sheet.getCell(r, 1).value = ability.name || 'Unknown'
          sheet.getCell(r, 2).value = ability.casts || 0
          sheet.getCell(r, 3).value = ability.successRate || 0
          sheet.getCell(r, 4).value = ability.avgEffect || ''
          r += 1
        })
      }
    }
    
    // Auto-size columns
    sheet.columns.forEach((column, i) => {
      if (i === 0) column.width = 25 // First column wider
      else column.width = 12
    })
  }
  
  // Write file
  await workbook.xlsx.writeFile(outPath)
}

/**
 * Format race win share table (markdown)
 */
function formatWinShareTable(data) {
  const { ranked } = calculateRaceStats(data)
  
  const lines = [
    '## Race Win Share',
    '',
    '| Rank | Race | Win % | Wins | Losses | Draws | Games |',
    '|---:|---|---:|---:|---:|---:|---:|',
  ]
  
  ranked.forEach((row, i) => {
    lines.push(`| ${i + 1} | ${row.race} | ${row.winPct}% | ${row.wins} | ${row.losses} | ${row.draws} | ${row.games} |`)
  })
  
  return lines.join('\n')
}

/**
 * Format full race vs race matchup matrix (markdown)
 */
function formatMatchupMatrix(data) {
  data = ensureMatrix(data)
  const { matrix } = data
  if (!matrix || Object.keys(matrix).length === 0) {
    return '## Race Matchup Matrix\n\n_No matrix data available_'
  }
  
  const races = Object.keys(matrix).filter(r => r !== 'Mixed')
  
  const lines = [
    '## Race Matchup Matrix',
    '',
    '_Row win % vs Column (diagonal = mirror matchup)_',
    '',
  ]
  
  // Header row
  const header = ['|', '**vs**', ...races.map(r => `**${r}**`)].join(' | ') + ' |'
  const separator = ['|', '---:', ...races.map(() => '---:')].join('|') + '|'
  lines.push(header)
  lines.push(separator)
  
  // Data rows
  for (const rowRace of races) {
    const cells = [rowRace]
    for (const colRace of races) {
      const val = matrix[rowRace][colRace]
      if (val === null || val === undefined) {
        cells.push('—')
      } else {
        cells.push(`${val}%`)
      }
    }
    lines.push(`| **${cells[0]}** | ${cells.slice(1).join(' | ')} |`)
  }
  
  return lines.join('\n')
}

/**
 * Generate markdown report
 */
function generateMarkdownReport(data, options = {}) {
  const { summary } = data
  const timestamp = new Date().toISOString()
  const totalGames = summary?.samples || 0
  
  const lines = [
    '# Battle Sim Matchup Report',
    '',
    `Generated: ${timestamp}`,
    `Total games: ${totalGames}`,
    '',
  ]
  
  if (summary?.caps) {
    const { army, deploy, reserve, unused } = summary.caps
    lines.push(`Army cap: ${army}, Deploy: ${deploy}, Reserve: ${reserve}${unused != null ? `, Flex: ${unused}` : ''}`)
    lines.push('')
  }
  
  lines.push(formatWinShareTable(data))
  lines.push('')
  lines.push(formatMatchupMatrix(data))
  lines.push('')
  
  return lines.join('\n')
}

/**
 * Run battleSim.mjs and capture JSON output
 */
async function runSim() {
  return new Promise((resolve, reject) => {
    const simPath = join(__dirname, 'battleSim.mjs')
    const proc = spawn('node', [simPath], {
      cwd: dirname(__dirname),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    })
    
    let stdout = ''
    let stderr = ''
    
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      process.stderr.write(chunk)
    })
    
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Sim exited with code ${code}\n${stderr}`))
      } else {
        try {
          const data = JSON.parse(stdout)
          resolve(data)
        } catch (err) {
          reject(new Error(`Failed to parse sim output: ${err.message}`))
        }
      }
    })
    
    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn sim: ${err.message}`))
    })
  })
}

/**
 * Main
 */
async function main() {
  const args = process.argv.slice(2)
  
  const options = {
    fromFile: null,
    outFile: null,
    generateMd: false,
  }
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--from' && i + 1 < args.length) {
      options.fromFile = args[++i]
    } else if (arg === '--out' && i + 1 < args.length) {
      options.outFile = args[++i]
    } else if (arg === '--md') {
      options.generateMd = true
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Battle Sim Matchup Report Generator

Usage:
  node scripts/simReport.mjs [options]

Options:
  --from FILE.json    Read sim data from existing JSON file
  --out REPORT.xlsx   Write report to xlsx file (default: sim/sim-matchup-report.xlsx)
  --md                Also generate markdown report
  --help, -h          Show this help

Examples:
  node scripts/simReport.mjs
  node scripts/simReport.mjs --from sim/sim-200-latest.json
  node scripts/simReport.mjs --out sim/custom-report.xlsx --md
  npm run sim:report
      `.trim())
      process.exit(0)
    }
  }
  
  let data
  
  if (options.fromFile) {
    console.error(`Reading sim data from ${options.fromFile}...`)
    try {
      let content = readFileSync(options.fromFile, 'utf-8')
      // Strip BOM if present (handles UTF-16 files from Windows)
      if (content.charCodeAt(0) === 0xFEFF || content.charCodeAt(0) === 0xFFFE) {
        content = content.substring(1)
      }
      data = JSON.parse(content)
    } catch (err) {
      console.error(`Error reading file: ${err.message}`)
      process.exit(1)
    }
  } else {
    console.error('Running battle sim...')
    try {
      data = await runSim()
    } catch (err) {
      console.error(`Error running sim: ${err.message}`)
      process.exit(1)
    }
  }
  
  // Default output paths
  const xlsxPath = options.outFile || join(dirname(__dirname), 'sim', 'sim-matchup-report.xlsx')
  const mdPath = xlsxPath.replace(/\.xlsx$/i, '.md')
  
  // Generate Excel report
  try {
    mkdirSync(dirname(xlsxPath), { recursive: true })
    console.error(`\nGenerating Excel report...`)
    await generateExcelReport(data, xlsxPath)
    console.error(`✓ Excel report written to ${xlsxPath}`)
    
    // List sheets
    const { ranked } = calculateRaceStats(data)
    console.error(`\n  Sheets: Overview, ${ranked.map(r => r.race).join(', ')}`)
    
  } catch (err) {
    console.error(`Error generating Excel report: ${err.message}`)
    process.exit(1)
  }
  
  // Generate markdown if requested
  if (options.generateMd) {
    try {
      const mdReport = generateMarkdownReport(data, options)
      writeFileSync(mdPath, mdReport, 'utf-8')
      console.error(`✓ Markdown report written to ${mdPath}`)
    } catch (err) {
      console.error(`Warning: Failed to generate markdown: ${err.message}`)
    }
  }
  
  console.error('\nDone.')
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`)
  process.exit(1)
})
