#!/usr/bin/env node
/**
 * Stamp favored terrain keywords onto all cards based on race.
 * Adds the keyword to the keywords array if not already present.
 */

import fs from 'fs'
import path from 'path'
import { load, dump } from 'js-yaml'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const KINGDOMS_BUILDER_DATA = path.resolve(__dirname, '../../KingdomsBuilder/data')

// Race → Terrain Keyword mapping
const RACE_KEYWORD_MAP = {
  Human: 'Open Ground',
  Construct: 'Open Ground',
  Beastfolk: 'Woodwalker',
  Elf: 'Woodwalker',
  Dragon: 'Ashborn',
  Demon: 'Ashborn',
  Undead: 'Bogstrider',
  Lizardman: 'Bogstrider',
  Dwarf: 'Hillborn',
}

function getAllCardYamlFiles(baseDir) {
  const cardsDir = path.join(baseDir, 'cards')
  const files = []
  
  function walkDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walkDir(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.yaml')) {
        files.push(fullPath)
      }
    }
  }
  
  walkDir(cardsDir)
  return files
}

function stampKeywordOnCard(card, keyword) {
  if (!card.keywords) {
    card.keywords = []
  }
  if (!card.keywords.includes(keyword)) {
    card.keywords.push(keyword)
    return true
  }
  return false
}

function processYamlFile(filePath) {
  console.log(`\nProcessing: ${path.relative(KINGDOMS_BUILDER_DATA, filePath)}`)
  
  const content = fs.readFileSync(filePath, 'utf8')
  const data = load(content)
  
  let updatedCount = 0
  
  // Check if this is a cards array structure
  if (data && data.cards && Array.isArray(data.cards)) {
    for (const cardData of data.cards) {
      if (!cardData || typeof cardData !== 'object') continue
      
      const race = cardData.race
      const cardName = cardData.name || cardData.id
      
      if (!race) {
        console.log(`  ⚠ ${cardName}: No race defined, skipping`)
        continue
      }
      
      const keyword = RACE_KEYWORD_MAP[race]
      if (!keyword) {
        console.log(`  ⚠ ${cardName}: Race "${race}" has no terrain keyword mapping`)
        continue
      }
      
      const wasUpdated = stampKeywordOnCard(cardData, keyword)
      if (wasUpdated) {
        updatedCount++
        console.log(`  ✓ ${cardName}: Added "${keyword}"`)
      }
    }
  }
  
  if (updatedCount > 0) {
    const newContent = dump(data, {
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    })
    fs.writeFileSync(filePath, newContent, 'utf8')
    console.log(`✅ Updated ${updatedCount} card(s) in ${path.basename(filePath)}`)
  } else if (data && data.cards) {
    console.log(`  No updates needed`)
  }
  
  return updatedCount
}

function main() {
  console.log('🚀 Stamping terrain keywords onto cards...')
  console.log(`📂 KingdomsBuilder data: ${KINGDOMS_BUILDER_DATA}`)
  
  const files = getAllCardYamlFiles(KINGDOMS_BUILDER_DATA)
  console.log(`\n📝 Found ${files.length} card YAML files\n`)
  
  let totalUpdated = 0
  
  for (const file of files) {
    totalUpdated += processYamlFile(file)
  }
  
  console.log('\n' + '='.repeat(60))
  console.log(`✨ Complete! Updated ${totalUpdated} total cards`)
  console.log('='.repeat(60))
  console.log('\n💡 Next step: Run "npm run import:yaml" in CommandWarfare to update the database')
}

main()
