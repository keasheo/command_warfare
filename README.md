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
