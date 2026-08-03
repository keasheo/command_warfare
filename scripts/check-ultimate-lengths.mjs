import fs from 'fs';
import path from 'path';
import * as yaml from 'js-yaml';

// Paths
const abilitiesPath = path.join('data', 'abilities.yaml');
const cardsDir = path.join('data', 'cards');

// Load abilities.yaml
const abilitiesContent = fs.readFileSync(abilitiesPath, 'utf8');
const abilities = yaml.load(abilitiesContent);

// Find all commander files
const factions = fs.readdirSync(cardsDir);
const ultimateAbilities = new Set();

// Collect all ultimates from commander cards
for (const faction of factions) {
  const commanderPath = path.join(cardsDir, faction, 'commanders.yaml');
  if (fs.existsSync(commanderPath)) {
    const commanderContent = fs.readFileSync(commanderPath, 'utf8');
    const commanderData = yaml.load(commanderContent);
    
    if (commanderData && commanderData.cards) {
      for (const card of commanderData.cards) {
        if (card.ultimate) {
          ultimateAbilities.add(card.ultimate);
        }
      }
    }
  }
}

// Also find abilities marked as type: Ultimate
for (const [abilityName, abilityData] of Object.entries(abilities)) {
  if (abilityData.type === 'Ultimate') {
    ultimateAbilities.add(abilityName);
  }
}

// Check lengths
const results = [];
for (const abilityName of ultimateAbilities) {
  const ability = abilities[abilityName];
  if (!ability) {
    console.warn(`Warning: Ultimate ability "${abilityName}" not found in abilities.yaml`);
    continue;
  }
  
  const description = ability.description || '';
  const length = description.length;
  
  if (length > 175) {
    results.push({
      name: abilityName,
      length: length,
      description: description,
      exceeds: length - 175
    });
  }
}

// Sort by excess length (most over first)
results.sort((a, b) => b.exceeds - a.exceeds);

// Output results
console.log(`\nFound ${results.length} ultimate abilities exceeding 175 characters:\n`);
console.log('â•'.repeat(100));

for (const result of results) {
  console.log(`\n${result.name}`);
  console.log(`  Current length: ${result.length} chars (${result.exceeds} over limit)`);
  console.log(`  Text: "${result.description}"`);
  console.log('â”€'.repeat(100));
}

// Also output as JSON for easier processing
fs.writeFileSync('ultimate-lengths.json', JSON.stringify(results, null, 2));
console.log(`\nâœ“ Results saved to ultimate-lengths.json`);
