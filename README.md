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
- Horizontal routing searches the current level. The movement resolver handles consequential elevation transitions; explicit teleportation retains native behavior.

### Regions and movement

Floors now support an additive **Surface Geometry** behaviour. Add it to the same region as **Set Floor Elevation**: choose **Solid terrain** for a continuous ledge, or a finite **Solid bridge / balcony** or **Grated catwalk** with an authored underside. Thickness is the floor top minus underside; the top and DCs remain on the floor behaviour. Foundry-authored thickness can use fractional feet. Missing, disabled or conflicting geometry asks for a GM ruling instead of assuming a wall extends to the landing. Climb Speed and waived exploration checks do not create a face across open air.

Workshop format7 preserves this geometry. Existing scene migration preserves IDs/data and recognizes the importer geometry subtype, but does not infer thickness for old maps. Re-export/import creates a new scene rather than repairing an existing campaign scene. After saving geometry, use **Configure native visibility…** to preview/apply a native plane. Explicitly select any old native surface to adopt; unrelated blockers stay unchanged and are reported. Adopted sound settings remain on the source, while sight/light follow the floor-height companion. Enabled definitions reconcile on GM edits. Artwork fading defaults to off. Enable **Fade suspended surface artwork by default** in module settings, or choose **Module default / Off / On** under a region’s Surface Geometry → Configure native visibility → Artwork fading. Manual Occlusion edits on its managed native companion save the same override and survive reloads. Sight/light restrictions remain independent. **Outline visible tokens beneath artwork** is a client setting: active PC sight can reveal a cyan token silhouette and elevation relative to the viewed level, without revealing hidden or unseen creatures. GM Vision must be off and a PC controlled to preview this as GM. Workshop exports separate deck fill and a faint outline; native occlusion fades the fill when a visible creature is below, including when viewing from above. See [surface verification and remaining acceptance](docs/testing/surface-visibility.md).

Codex owns **Set Floor Elevation (map workshop)** and **Water (map workshop)**. These data-only behaviours work independently of the importer. The importer uses Codex types when available, or retains inert legacy data when used alone.

With **Apply resolved outcomes**, **Travelling** prefers walking, uses prepared Climb/Swim Speeds for ordinary authored terrain, and uses an available Fly Speed when needed. Climb presets through Expert and calm/flowing water waive ordinary checks; custom, unspecified and harder terrain retain the decision workflow. Explicit movement actions and forced movement keep their own rules. Flight never substitutes for swimming underwater.

**Climbing** and **Swimming** effects show token icons while those states persist, with GM **Toggle Climbing** and **Toggle Swimming** macros for rulings. Automatic tracking follows the corresponding feature switch and Apply mode. Special Speeds remove the associated Off-Guard penalty while retaining the status. Combat Climber and Underwater Marauder are recognised; speed changes refresh the effects. Other sources of Off-Guard remain intact. Quick Swim adjusts resolved progress, and Combat Climber permits one occupied hand. Swimming marks the movement state; it does not apply the system’s full Aquatic Combat package.

Under **Configure Settings → Codex Foundry**, settings are grouped into Rules, Movement and terrain, Gridless combat, Imports and sync, and Diagnostics. **Enable Custom Rules** controls rules; Vault Sync and statblock import retain independent switches. Upgrades preserve disabled preferences. **Movement outcomes** defaults to **Advisory**; choose **Apply after choices** to apply resolved movement, system damage and conditions.

- Separate switches control climbing, swimming, falling, forced movement and flight upkeep. Flight upkeep requires falling and defaults off.
- Native movement pauses before a climb or loss of support. The resolver finds the highest mapped floor below across native scene levels, including holes that expose another level. It never invents a floor at a level base.
- Ordinary walking/Travelling down mapped ledges greater than 5 ft defaults to Climb down, including across levels, using the upper ledge’s Climb DC. Existing exploration-check settings and prepared Speeds apply. Forced movement and explicit falls retain fall handling; unknown landings still require a ruling.
- Small 2.5 ft treads remain traversable. Larger climbs use the system Climb check and advance only as far as that action allows. Quick Climb and prepared climb Speed are respected. Partial climbs and caught edges get a source-marked Off-Guard condition. Continue a partial climb with Climb or Travelling; the Climbing status keeps ordinary drags in climbing mode. Successful checks move the token and report vertical progress. Failure makes no progress; critical failure triggers a fall with available reactions.
- Set terrain presets and optional **Climb DC** / **Grab an Edge DC** on the **Set Elevation** behaviour, and **Swim terrain** / **Swim DC** on the **Water** behaviour. Custom DCs override presets. Edge DC falls back to Climb DC; unspecified terrain asks the GM. Existing region DC flags remain a fallback for legacy floor behaviours.
- Separate **Climb checks outside combat** and **Swim checks outside combat** switches allow free ordinary exploration movement. They start enabled to preserve preferences. The GM's token-control toggle **Require terrain checks this scene session** temporarily requires both checks; it clears when that GM leaves the scene or reloads. Falls and dangerous forced movement remain guarded. **Announce unchecked exploration movement** posts one compact notice with the measured distance climbed/swum per completed move; turn it off to keep this travel silent.
- Authored water uses system Swim checks, prepared swim Speed and action-limited progress. Calm water grants the normal automatic critical success. At turn end without a successful Swim, a private GM prompt offers sinking up to 10 ft, movement with a specified current, or no consequence. Mapped beds and native wall collision constrain those moves. Breath tracking stays manual: critical failures remind the GM of air loss, except while SF2e Automation’s environmental protection is active. Oxygen does not prevent sinking.
- Falls offer Grab an Edge and eligible Arrest a Fall before descending. The GM confirms normal gravity and a clear landing; cancel that confirmation for creature collisions or other exceptional falls. Confirm reaction availability in the dialog and track expenditure on the sheet. Damage uses system resistances and temporary HP; Prone depends on actual applied damage.
- Hold **F** while dragging to mark forced movement. Change the key under **Configure Controls → Codex Foundry**. Releasing it after submission retains the intent. Dangerous destinations require push/pull or explicit effect permission; forbidden destinations stop safely. Forced movement uses no voluntary movement budget and retains wall collision.
- Water uses the local surface and depth. The GM chooses surface/swimming or bed and confirms an intentional dive. Shallow water caps the reduction; a dry bridge above the water remains solid ground.
- Missing or ambiguous support, uncertain mitigation, blocked landings and falls longer than 500 ft require a GM ruling. **Resolve manually** moves along the requested path, bypassing terrain checks while still respecting walls and closed doors. The GM handles any additional consequences. Interrupted application enters recovery and is never automatically retried.
- Explicit jump/teleport paths remain under their originating action's control. This feature does not validate jump distance, shove direction or effect range. Placement remains a separate operation.
- Previews share the transition evaluator and show the safe height before unresolved outcomes. The old **Refuse climbs on foot** bypass is retired; **Prompt Squeeze checks** only controls Squeeze.

To migrate existing maps, keep the importer enabled, back up the world and preview an explicit scene scope:

```js
const api = game.modules.get("codex-foundry").api;
await api.regions.migrateLegacy({sceneUuids: [canvas.scene.uuid]});
// After inspecting the preview:
await api.regions.migrateLegacy({sceneUuids: [canvas.scene.uuid], apply: true});
```

Migration preserves embedded IDs, names, flags, geometry and system data, changing only the two legacy behaviour types. It is repeatable; per-scene errors are returned. Disable the importer only after all required legacy scenes are migrated.

GM macros can submit an already legal forced path:

```js
await game.modules.get("codex-foundry").api.movement.forceMove({
  tokenUuid: canvas.tokens.controlled[0].document.uuid,
  waypoints: [{x: 1200, y: 800}],
  danger: "allowed" // push/pull or explicit permission; otherwise "forbidden"
});
```

Movement chat cards explain the paused transition, put relevant choices first, and replace those controls with the resolved outcome. GM controls are secondary; internal choice receipts are private and hidden, while native check rolls remain visible. Grab an Edge and Arrest a Fall show the native PF2e reaction symbol.

The API returns the submission result; the movement chat request records resolution. See [runtime evidence and player checks](docs/testing/regions-movement.md).

#### Heights players can read

On these scenes the elevation label over a token reads against the ground, not the level:

- Your selected token (or your character's token when none or several are selected) shows its height above the floor beneath it in green, even when that floor belongs to a level below. A token 20 ft above a cave floor reads **+20 ft above ground**, whatever level the cave is on.
- Over water it reads against the surface in blue: **+10 ft above water**, or **5 ft below surface** for a token wading on the bed. Water is recognised by the map-workshop `water` region behaviour (exports from format 6; older scenes need the behaviour added to their Water regions).
- Every other token shows its height relative to yours in plain white, so **-15 ft** is 15 ft lower than you.
- Hold **Show absolute elevation** (`H` by default, editable under **Configure Controls → Codex Foundry**) to see scene elevations instead.
- While that key is held, a label at the cursor reads the top visible floor beneath it, for example **-15 ft · 20 ft below you**, on whichever level that floor lies. Over water it reads the surface and depth: **-10 ft · 5 ft deep · 15 ft below you**. Off the floors it shows nothing.
- Scenes without floor regions keep Foundry's own labels.

### Flying

An "Effect: Flying" item marks an airborne creature. The GM's client creates a **Toggle Flying** script macro on first load; running it with tokens selected adds the effect to their actors, or removes it from actors that already fly. Share the macro with players to let them toggle their own tokens. While the effect is present the token's movement action is Fly, so ledges and gaps never prompt Climb, and removing the effect (by macro or from the sheet) hands the action back to the system's default. Scripts can call `game.modules.get("codex-foundry").api.flying.toggleFlying({ tokenUuids })`.

Flight loss from grounding conditions, fly-Speed loss or effect removal uses the same paused fall workflow. Flying and forced displacement preserve altitude until a landing or resolved loss of flight. Grabbed and unusual flight anatomy require GM adjudication. The optional turn-end upkeep prompt asks whether Fly was used, including stationary hovering; movement distance alone does not prove action expenditure.

At the start of a flying creature's turn in an encounter, a public chat message reminds the table that it is airborne and how far above the surface below it is, measured across levels.

### Clip tiles to regions

Open **Tile configuration → Appearance → Region masks**:

- **Show inside regions** keeps artwork inside any selected region. Empty means the whole tile.
- **Hide inside regions** cuts out every selected region, including overlapping exclusions. Exclusions take priority.

Regions' holes are respected. Masks follow tile transforms and region edits, and persist across reloads. Existing single-region masks continue working without migration. Missing references remain visible in the selector so they can be removed; missing inclusion regions contribute no visible area, while missing exclusions cut out nothing.

Masking changes artwork only, not movement, lighting or native overhead occlusion. Codex's covered-token outlines respect the resulting mask; native overhead occlusion still uses the tile's full rectangle, so keep clipped textures at floor elevation when they should not occlude tokens.

Scripts can set the two lists directly (an explicit empty `clipRegions` list overrides the old `clipRegion` flag):

```js
await tile.document.update({
    "flags.codex-foundry.clipRegions": [islandA.id, islandB.id],
    "flags.codex-foundry.excludeRegions": [bridge.id]
});
```

### Why can't I go there?

With the reachable ring on in hex lattice mode, cells just beyond the ring that the token could enter only by other means are filled red, one icon per stretch:

- The **Climb action's marker**, the ladder by default, marks a ledge more than one 2.5-foot step up. The marker identifies conditional movement that needs climbing resolution.
- A **compress arrow** marks a gap too tight for the token's cramped footprint but wide enough for a Squeeze, half the cramped width. Routes do go through, at triple cost, shown in amber. It appears only where the gap leads to ground the token cannot otherwise reach, so ordinary walls stay unmarked.

### Ruler label

With Custom Rules enabled, the native ruler label shows distance, terrain surcharge, elevation and movement-action budgets on gridless, square and hex scenes. Budgets use the relevant walk, climb, swim or fly Speed and include recorded movement on the current turn. Mixed modes count separately; check-dependent progress is labelled as an estimate on success. Unchecked exploration retains the movement types, segment distances and elevation, while hiding action budgets and remaining movement. This estimates movement actions, not actions spent elsewhere on the character sheet. Terrain transitions show the required check or ruling, with the PF2e reaction glyph for offered fall reactions. An amber pause marker identifies the safe point. Gridless Combat still controls the reachable-area outline and movement rings.

Only the final tooltip is shown; intermediate waypoint markers remain. The tooltip puts movement types first with action glyphs aligned right, then distance and remaining movement, followed by elevation. Mixed routes retain their ordered segments: `Walk → Climb → Walk` above `5 ft + 10 ft + 5 ft`. A suffix such as `Climb*` means estimated progress on success; the action glyph's accessible description gives the full budget. The label stays between 160 and 240px wide. Forced movement shows a dash for zero movement actions; more than three actions shows the three-action glyph plus `+`.
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
