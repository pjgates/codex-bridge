# Codex Bridge

Obsidian↔Foundry VTT bridge: campaign content sync (**codex-sync**) plus opt-in rules for **Pathfinder Second Edition** and **Starfinder Second Edition** in [Foundry VTT](https://foundryvtt.com/).

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

### Gridless Combat

An optional setting for PF2e and SF2e gridless scenes. Gridded scenes keep their native behavior.

- Distances use continuous Euclidean geometry without rounding. Large tokens retain PF2e occupied-space reach.
- Native flanking rules remain active. A wall that blocks all five target rays also blocks flanking.
- With one controlled creature and one target, hex mode shows low-opacity red cells on the shared 6-inch lattice.
- Each marked cell center passes native flanking and reach checks, plus the attacker's normal standing-footprint wall clearance. Unknown cell centers remain unmarked.
- Flanking cells show all eligible positions, regardless of remaining movement. Movement Debug is not required.
- Continuous mode retains red directional wedges. Their outer arc uses native flanking checks, while the interior fill indicates direction only.
- An eligible ally must already be within reach. The guide preserves native flanking feats and excludes wall-blocked positions.
- Automatic cover samples the target center and four corners from the attacker center. Movement-blocking walls provide the obstruction.
- A creature across the center line provides lesser cover (+1 AC).
- Terrain that blocks corner rays but leaves the center visible provides light cover (+1 AC).
- Terrain that blocks the center but leaves a corner visible provides standard cover (+2 AC and area Reflex).
- All five blocked rays prevent the attack or save. Native Take Cover effects provide greater cover without stacking circumstance bonuses.
- Native area shapes remain continuous. Area placement selects visible targets inside the shape with at least one clear wall ray.
- Area saves use the placed shape as their origin. If an item has multiple areas, select the relevant area before the save.
- The remaining-Stride outline appears only for one selected token during movement or while the **Preview Movement Ring** shortcut is held.
- Selecting multiple tokens hides movement rings, including held previews.
- The shortcut is unassigned by default. Assign it under **Configure Controls → Codex Foundry → Preview Movement Ring**.
- Ready attacks add colored distance overlays: filled melee-reach circles and outline-only ranged circles. They use the same movement/hold-preview visibility.
- Ranged circles show the first range increment, or the fixed maximum when an attack has no increment.
- Equal distances of the same kind share a circle with combined attack labels.
- Attack overlays show the listed distances from the token center. Attack resolution still uses native target-specific rules.
- During its turn, recorded movement costs reduce the remaining distance. Crossing a Stride limit advances to the next action increment.
- Drag previews include the planned path. Canceling a drag restores the recorded budget, and the next turn resets movement history.
- This is a movement-only indicator. Attacks and other non-movement actions do not consume its budget.
- Outside the token's turn, only the current drag preview consumes the displayed allowance.
- The outline shows an approximate reachable area around walls and through terrain. It uses native movement costs, not a hidden square grid.
- The overlay has three modes under **Movement Preview**: the reachable-area ring (default), a simple circle of the remaining distance (routed path costs included, terrain ignored), or off.
- During dragging, the last completed outline stays at its calculated position until the latest replacement is ready.
- Moves are computed by continuous geometry by default. **Movement Lattice** can instead run them on a fixed 6-inch hex lattice a tenth of a square wide — the same cells for every token.
- On the lattice, the reachable ring comes from a typed-array flood instead of thousands of native measurements: a 25-foot ring floods in about 2 ms and a 75-foot ring in about 3 ms (44 000 cells), with its outline tracing in another 5–10 ms. Continuous mode makes roughly 2 500 native path measurements per drag update.
- Normal hex routes keep the token's full footprint clear along every segment. Straightening removes redundant waypoints without moving corners.
- If no full-footprint route exists, routing tries the smaller cramped-passage footprint. Straightening retains the footprint selected by that search.
- Normal movement keeps the native ruler line and movement outline without a hex-cell trail.
- **Movement Debug** is a client-only setting, off by default. On the hex lattice, it fills reachable cells for one selected token at 12% opacity.
- Debug outlines show cost per CELL: white for normal, amber for higher, red for triple or more. A legend explains the colors.
- Debug fills use explicit Environment tags, including blue for Aquatic. Aquatic takes visual priority over broader tags such as Underground.
- Debug cells respect fog and the remaining movement budget. They stay visible while the token is selected and clear on deselection or disable.
- The cramped fallback and approximate ring retain a half-cell tolerance. Normal hex routes use the full footprint without shrinking it.
- Every other gridless rule is shared: distance, cover, flanking, areas, terrain, fog, elevation, and movement budgets.
- Automatic routing preserves placed waypoints and searches for cheaper routes around walls and difficult terrain.
- Clearance uses the occupied rectangle. Continuous routing permits exact fits. Hex routing requires usable cell centres within the selected clearance.
- Small creatures use 2.5-foot passages normally and 1.25-foot passages as difficult terrain. Medium creatures use 2.5-foot passages as difficult terrain.
- Large, Huge, and Gargantuan creatures can use 5-, 10-, and 15-foot passages, respectively, as difficult terrain.
- Only the cramped portion costs extra. This penalty does not stack with other difficult terrain.
- Gaps down to half the cramped footprint are squeezed through as greater difficult terrain: the squeezed stretch costs triple and the ruler label shows a compress icon. Anything tighter is impassable to automatic routing. Small and Tiny creatures squeeze through gaps down to about 0.6 ft.
- Terrain uses Region behaviors that modify movement costs, labeled **Difficult Terrain** in PF2e/SF2e.
- Prepared abilities that ignore all difficult or greater difficult terrain also affect gridless movement costs.
- Hex search and reachable outlines charge terrain cost on every CELL step. Straightening preserves cheaper terrain detours using sampled terrain costs.
- Routing stays on the current elevation and level. Explicit vertical transitions, teleportation, and unconstrained movement retain native behavior.

### Floors (map-workshop caves)

Scenes imported by the Map Workshop Importer carry `setElevation` floor regions. Codex Foundry applies their heights on every such scene, gridless or not:

- Entering a floor inserts its height into the path at the entry point. A rise of one 2.5-foot step or any descent is free.
- A higher rise is a climb: by default the token goes up, takes the new height, and the Climb roll is prompted. Climb, Fly, Blink, and Displace may take any rise without question.
- **Refuse climbs on foot** (world setting, off by default) instead stops a walking-type move at the ledge with a warning.
- Tokens dropped onto the map land at the floor under them.
- **Prompt checks for ledges and gaps** (world setting, on by default): a move that climbs or drops more than one tread posts the system's Climb (Athletics) roll, and a move through a squeeze-width gap posts Squeeze (Acrobatics). The move still happens; the GM reads the result against the DC the terrain warrants.
- On gridless scenes in hex lattice mode, the drag label previews the planned height at each waypoint, marks waypoints past a refused ledge, and the reachable ring and automatic routes stop at ledges the current movement action cannot climb.

### Why can't I go there?

With the reachable ring on in hex lattice mode, cells just beyond the ring that the token could enter only by other means are filled red, one icon per stretch:

- The **Climb action's marker**, the ladder by default, marks a ledge more than one 2.5-foot step up. Amber means the move goes ahead and prompts a Climb roll; red means climbs on foot are refused and the action must change.
- A **compress arrow** marks a gap too tight for the token's cramped footprint but wide enough for a Squeeze, half the cramped width. Routes do go through, at triple cost, shown in amber. It appears only where the gap leads to ground the token cannot otherwise reach, so ordinary walls stay unmarked.

### Ruler label

On gridless scenes the native ruler label carries everything in one place: distance, any cramped-passage or terrain surcharge as an added cost, elevation, the action glyph, and the remaining movement for the turn. The module supplies its own waypoint-label template while Gridless Combat is on and draws only the reachable outline itself.
- Movement budgets require native history recording. PF2e Toolbelt's per-user **Better Movement → No History Record** option must be off.

Automatic cover is this module's geometric approximation, not native PF2e/SF2e automation. Region outlines do not clip to walls.

## Compatibility

| Requirement | Version |
|---|---|
| Foundry VTT | v14 |
| SF2e System | 0.0.4+ |
| PF2e System | 8.5.0+ |

Gridless integration targets Foundry 14.367, PF2e 8.5.0, and SF2e 1.5.0.

## Installation

1. In Foundry VTT, go to **Add-on Modules** and click **Install Module**.
2. Paste the following manifest URL into the bottom field:

```
https://github.com/pjgates/codex-bridge/releases/latest/download/module.json
```

3. Click **Install** and enable the module in your world.

## Configuration

Found under **Module Settings > Codex Foundry**. All settings are world-scoped (GM only) except the Vault Sync Passphrase, which is client-scoped by design — it lives in the GM's browser localStorage and is never replicated to other clients.

| Setting | Description | Default |
|---|---|---|
| **Enable Custom Rules** | Master switch for the entire module. Requires reload. | On |
| **Enable Target Helper** | Adds per-target rows to chat cards. Requires reload. | On |
| **Heroic Rerolls** | Raises Hero Point d20 rerolls below 10 to 10. Requires reload. | Off |
| **Gridless Combat** | Continuous geometry, automatic cover, area targeting, flanking guides, and remaining-movement rings. Requires reload. | Off |
| **Movement Preview** | Gridless remaining-movement overlay: **Reachable ring**, **Simple circle** (remaining distance; routed costs included, terrain ignored), or **Off**. Requires Gridless Combat. | Reachable ring |
| **Movement Lattice** | Gridless movement model: **Continuous geometry** (exact) or a **6-inch hex lattice** that floods rings and routes in milliseconds with cell-centre waypoints. Requires Gridless Combat. | Continuous geometry |
| **Players Roll All Dice** | Enables the PRAD variant. Requires Target Helper to be on. | Off |
| **Strict DC Mode (Exact Probabilities)** | Uses DC = 12 + modifier instead of 11 + modifier under PRAD, exactly preserving original probabilities. | Off |
| **Statblock Importer** | Adds an Import Statblock button to the Actors sidebar (GM only). | On |
| **Enable Vault Sync** | Fetch vault content pushed to `Data/codex-sync`. Requires reload. | On |
| **Vault Sync Passphrase** | Decrypts the pushed payload. Client-scoped (this browser only). | — |

## Development

### Prerequisites

- Node.js 22.13+
- A local Foundry VTT installation
- `gitleaks` (e.g. `brew install gitleaks`) — the pre-commit hook in `.githooks/` (auto-wired by `npm install`) blocks sensitive paths and scans staged changes for secrets; this repo is public.

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
