# Codex Bridge

Obsidian↔Foundry VTT bridge: campaign content sync (**codex-sync**) plus opt-in ruleset houserules, currently for the **Starfinder Second Edition** system in [Foundry VTT](https://foundryvtt.com/).

> **Renamed from `sf2e-forge-custom` in v1.0.0.** Migration steps: see [CHANGELOG](CHANGELOG.md#100).

## Features

### Codex Sync (Vault Sync)

Campaign content (entities, creatures, art) flows from an external Obsidian vault into Foundry at runtime — no compendium packs. The push pipeline builds an encrypted payload from vault markdown and rsyncs it to the server; worlds with Vault Sync enabled pull it from the GM's sync dialog.

### Players Roll All Dice (PRAD)

A variant rule that puts dice in the players' hands for every roll:

- **NPC attacks become player armor saves** — instead of the GM rolling to hit, the targeted player rolls a save against the NPC's attack DC.
- **NPC saves become player overcome checks** — instead of the GM rolling saves for NPCs, the caster rolls an overcome check against each target's save DC.
- **Sheet augmentation** — NPC sheets display DCs, and PC sheets display corresponding modifiers, so the right numbers are always visible.

### Heroic Rerolls

An optional Hero Point variant rule: when a Hero Point rerolls a d20 below 10, the die result becomes 10.

### Target Helper

Per-target save/check rows on chat cards for spells, area effects, and other targeted actions:

- Adds a row for each targeted token directly on the chat card.
- Players and GMs can roll saves or apply results per target.
- Integrates with PRAD to support overcome checks.
- Compatible with [PF2e Toolbelt](https://github.com/reonZ/pf2e-toolbelt)'s Target Helper — when Toolbelt is active, this module only handles PRAD-specific cards.

## Compatibility

| Requirement | Version |
|---|---|
| Foundry VTT | v14 |
| SF2e System | 0.0.4+ |

## Installation

1. In Foundry VTT, go to **Add-on Modules** and click **Install Module**.
2. Paste the following manifest URL into the bottom field:

```
https://github.com/pjgates/codex-bridge/releases/latest/download/module.json
```

3. Click **Install** and enable the module in your world.

## Configuration

All settings are world-scoped (GM only) and found under **Module Settings > Codex Foundry**.

| Setting | Description | Default |
|---|---|---|
| **Enable Custom Rules** | Master switch for the entire module. Requires reload. | On |
| **Enable Target Helper** | Adds per-target rows to chat cards. Requires reload. | On |
| **Heroic Rerolls** | Raises Hero Point d20 rerolls below 10 to 10. Requires reload. | Off |
| **Players Roll All Dice** | Enables the PRAD variant. Requires Target Helper to be on. | Off |
| **Enable Vault Sync** | Fetch vault content pushed to `Data/codex-sync`. Requires reload. | Off |
| **Vault Sync Passphrase** | Decrypts the pushed payload. | — |

## Development

### Prerequisites

- Node.js 22.13+
- A local Foundry VTT installation

### Setup

```bash
git clone https://github.com/pjgates/codex-bridge.git
cd codex-bridge
npm install
```

### Build

```bash
# One-time build (Vite → dist/)
npm run build

# Watch mode (rebuilds on file changes)
npm run watch
```

### Vault sync (codex-sync)

The push pipeline lives in `sync/` and reads markdown from an external Obsidian vault.

1. Copy `codex-sync.config.example.json` to `codex-sync.config.json` and set `vaultPath`, `campaign`, and `remote`.
2. Put `CODEX_SYNC_PASSPHRASE` in `.env` (never commit).
3. Dry-run the build:

```bash
npm run push -- --dry-run
```

4. Push to the server:

```bash
npm run push
```

`npm run verify` runs typecheck, lint, tests, and `vite build`.

### Link to Foundry

```bash
ln -s "$(pwd)" "<foundryData>/Data/modules/codex-foundry"
```

### Layout

- `src/` — Foundry module (`src/sync/` pull-side; `src/rulesets/sf2e/` houserules; `src/shared/`, `src/hooks/`)
- `sync/` — push-side CLI (`sync/push.ts`, `sync/lib/`, `sync/converter/`)
- `tests/node/` — node-side feature tests (template/fixture access)

## License

[MIT](LICENSE)
