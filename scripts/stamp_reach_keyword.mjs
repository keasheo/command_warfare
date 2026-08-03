#!/usr/bin/env node
/**
 * Stamp Reach keyword onto all cards with printed Range > 1.
 * Reach allows attacking Flying units in melee (Range > 1 implies Reach).
 */

import fs from 'node:fs'
import path from 'node:path'
import { load, dump } from 'js-yaml'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const KINGDOMS_BUILDER_DATA = path.resolve(
  process.env.KINGDOMS_DATA ?? path.resolve(__dirname, '../data'),
)
const KEYWORDS_PATH = path.join(KINGDOMS_BUILDER_DATA, 'keywords.yaml')

function getAllCardYamlFiles(baseDir) {
  const cardsDir = path.join(baseDir, 'cards')
  const files = []

  function walkDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) walkDir(fullPath)
      else if (entry.isFile() && entry.name.endsWith('.yaml')) files.push(fullPath)
    }
  }

  walkDir(cardsDir)
  return files
}

function ensureReachKeywordDef() {
  if (!fs.existsSync(KEYWORDS_PATH)) {
    console.warn(`âš  keywords.yaml not found at ${KEYWORDS_PATH}`)
    return false
  }
  const data = load(fs.readFileSync(KEYWORDS_PATH, 'utf8')) ?? {}
  if (data.Reach) return false
  data.Reach = {
    description: 'This unit may attack Flying units.',
    tags: ['passive'],
  }
  fs.writeFileSync(
    KEYWORDS_PATH,
    dump(data, { lineWidth: -1, noRefs: true, sortKeys: false }),
    'utf8',
  )
  console.log('âœ“ Added Reach keyword definition to keywords.yaml')
  return true
}

function stampReachOnCard(card) {
  const range = Number(card.range ?? 1)
  if (!(range > 1)) return false
  if (!card.keywords) card.keywords = []
  if (card.keywords.includes('Reach')) return false
  card.keywords.push('Reach')
  return true
}

function processYamlFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  const data = load(content)
  if (!data?.cards || !Array.isArray(data.cards)) return 0

  let updatedCount = 0
  for (const card of data.cards) {
    if (!card || typeof card !== 'object') continue
    if (stampReachOnCard(card)) updatedCount++
  }

  if (updatedCount > 0) {
    fs.writeFileSync(
      filePath,
      dump(data, { lineWidth: -1, noRefs: true, sortKeys: false }),
      'utf8',
    )
    console.log(`  âœ“ ${path.relative(KINGDOMS_BUILDER_DATA, filePath)}: ${updatedCount} card(s)`)
  }
  return updatedCount
}

function main() {
  console.log('ðŸš€ Stamping Reach onto cards with Range > 1...')
  console.log(`ðŸ“‚ KingdomsBuilder data: ${KINGDOMS_BUILDER_DATA}`)

  ensureReachKeywordDef()

  const files = getAllCardYamlFiles(KINGDOMS_BUILDER_DATA)
  let totalUpdated = 0
  let rangeGt1 = 0
  let alreadyHad = 0

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8')
    const data = load(content)
    if (data?.cards) {
      for (const card of data.cards) {
        if (!card || typeof card !== 'object') continue
        if (Number(card.range ?? 1) > 1) {
          rangeGt1++
          if ((card.keywords || []).includes('Reach')) alreadyHad++
        }
      }
    }
    totalUpdated += processYamlFile(file)
  }

  console.log('\n' + '='.repeat(60))
  console.log(`Cards with Range > 1: ${rangeGt1}`)
  console.log(`Already had Reach: ${alreadyHad}`)
  console.log(`Newly stamped: ${totalUpdated}`)
  console.log('='.repeat(60))
  console.log('\nðŸ’¡ Next step: Run "npm run import:yaml" in CommandWarfare')
}

main()
