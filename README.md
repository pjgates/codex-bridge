# SF2e Forge Custom Rules

Custom rules and homebrew modifications for the **Starfinder Second Edition** system in [Foundry VTT](https://foundryvtt.com/).

## Features

### Players Roll All Dice (PRAD)

A variant rule that puts dice in the players' hands for every roll:

- **NPC attacks become player armor saves** -- instead of the GM rolling to hit, the targeted player rolls a save against the NPC's attack DC.
- **NPC saves become player overcome checks** -- instead of the GM rolling saves for NPCs, the caster rolls an overcome check against each target's save DC.
- **Sheet augmentation** -- NPC sheets display DCs, and PC sheets display corresponding modifiers, so the right numbers are always visible.

### Target Helper

Per-target save/check rows on chat cards for spells, area effects, and other targeted actions:

- Adds a row for each targeted token directly on the chat card.
- Players and GMs can roll saves or apply results per target.
- Integrates with PRAD to support overcome checks.
- Compatible with [PF2e Toolbelt](https://github.com/reonZ/pf2e-toolbelt)'s Target Helper -- when Toolbelt is active, this module only handles PRAD-specific cards.

## Compatibility

| Requirement | Version |
|---|---|
| Foundry VTT | v14 |
| SF2e System | 0.0.4+ |

## Installation

1. In Foundry VTT, go to **Add-on Modules** and click **Install Module**.
2. Paste the following manifest URL into the bottom field:

```
https://github.com/pjgates/sf2e-forge-custom/releases/latest/download/module.json
```

3. Click **Install** and enable the module in your world.

Alternatively, download the latest `sf2e-forge-custom.zip` from the [Releases](https://github.com/pjgates/sf2e-forge-custom/releases) page and extract it into your `Data/modules/` folder.

## Configuration

All settings are world-scoped (GM only) and found under **Module Settings > SF2e Forge Custom Rules**.

| Setting | Description | Default |
|---|---|---|
| **Enable Custom Rules** | Master switch for the entire module. Requires reload. | On |
| **Enable Target Helper** | Adds per-target rows to chat cards. Requires reload. | On |
| **Players Roll All Dice** | Enables the PRAD variant. Requires Target Helper to be on. | Off |

## Development

### Prerequisites

- Node.js 20+
- A local Foundry VTT installation

### Setup

```bash
git clone https://github.com/pjgates/sf2e-forge-custom.git
cd sf2e-forge-custom
npm install
```

### Build

```bash
# One-time build
npm run build

# Watch mode (rebuilds on file changes)
npm run watch
```

### Link to Foundry

Symlink the repo into your Foundry modules folder so the built output is picked up automatically:

```bash
ln -s "$(pwd)" "<foundryData>/Data/modules/sf2e-forge-custom"
```

Replace `<foundryData>` with the path to your Foundry VTT user data directory.

### Lint

```bash
npm run lint
```

## License

[MIT](LICENSE)
