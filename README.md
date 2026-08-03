# Command Warfare

Local web design kit for the Command Warfare card game.

- **Frontend:** Vite + React + TypeScript
- **API:** Express
- **Database:** SQLite (`data/command-warfare.sqlite`)

## Setup

```bash
npm install
npm run import:yaml
npm run dev
```

- Web UI: http://127.0.0.1:5173
- API: http://127.0.0.1:8787

`import:yaml` loads cards, abilities, settings, rulebook, and design bible from:

`C:\Users\keash\Projects\KingdomsBuilder\data`

Override with `KINGDOMS_DATA=...` if needed.

## What’s included

- Dashboard (counts + YAML re-import)
- Cards (search any field, full editor, embedded card face / viewer)
- Abilities
- Races
- Design Bible
- Rules

The old KingdomsBuilder desktop app can stay as a YAML source until this kit fully replaces it.

## Battle Sim Reports

Generate race win-share tables and matchup matrices from battle simulations:

```bash
# Run sim and generate report (saves to sim/sim-matchup-report.md)
npm run sim:report

# Generate report from existing sim output
node scripts/simReport.mjs --from sim/sim-200-latest.json

# Include flat matchup list with W-L records
node scripts/simReport.mjs --from sim/sim-200-latest.json --flat

# Custom output file
node scripts/simReport.mjs --from sim/sim-200-latest.json --out sim/my-report.md
```

Reports include:
- **Race Win Share Table** — Ranked by win %, with total wins and appearances
- **Full NxN Matchup Matrix** — Row race win % vs column race
- **Optional Flat Matchup List** — All race vs race with W-L-D records (use `--flat`)
