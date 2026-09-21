# Regions and movement consolidation

Status: core design approved by the user on 2026-09-21; configuration requirements confirmed and added in the [configuration supplement](CONFIGURATION.md). Implementation has not started.

## Objective and confirmed decisions

Codex Foundry owns region semantics and PF2e/SF2e elevation movement. Map Workshop produces geometry and imports scenes, and remains useful without Codex. Existing maps retain their meaning through compatible registration or migration.

- Pause at consequential transitions, offer applicable checks/reactions, then apply the resolved movement, damage and conditions.
- Store optional Climb and Grab an Edge DCs on regions; ask the GM when the necessary DC is absent.
- Find supporting surfaces across native Foundry v14 Scene Levels, using absolute scene elevation.
- When no landing surface is mapped, pause for a GM ruling; a level base is not proof of ground.
- Mark forced movement explicitly through a held drag modifier and a macro API. Ordinary GM dragging does not imply forced movement.
- Default the configurable modifier to **F**, show “Forced” in the preview, and clarify the effect when a dangerous destination requires it.
- Use `codex-foundry.setElevation` / `.water` for Codex-owned behaviours, preserving visible names and data through a migration of existing scenes.
- Adapt useful approaches from Terrain Mapper and Region Behaviour Adjustments without requiring either module.
- Expose separate movement-feature switches and a shared outcome mode in Foundry settings; require opt-in for new automatic consequences, and separate rule automation from utilities while preserving upgrade preferences.

## Approved capability map

These are internal code components of the single installable `codex-foundry` module. The Map Workshop Importer is the only separate Foundry module in this design.

| Component id | Responsibility | Depends on |
|---|---|---|
| region-definitions | Behaviour registration, persistent data, importer compatibility | — |
| surface-resolution | Physical support and boundary queries across scene levels | region-definitions |
| movement-rules | Movement intent, checks/reactions, and resolved outcomes | surface-resolution |

Build order: [region-definitions](SPEC-region-definitions.md) → [surface-resolution](SPEC-surface-resolution.md) → [movement-rules](SPEC-movement-rules.md).

## Evidence from the current implementation

- The importer registers `map-workshop-importer.setElevation` (one numeric elevation) and `map-workshop-importer.water` (marker). Neither has event handlers.
- Codex's `gridless/floors.ts` rewrites paths using only current-level floors. Leaving a floor for empty space produces no entering-floor event.
- `gridless/elevation.ts` follows floor heights even for Fly and permits every downward transition. `gridless/checks.ts` requests Climb for upward and downward height differences alike.
- `flying/height.ts` can find the highest floor below across levels, but returns only its height. `flying/fall.ts` subsequently guesses the level from elevation bands and uses level base when no floor exists.
- The existing fall path moves the token immediately and posts advisory damage/reaction text. It does not await a reaction or apply damage.
- Existing movement and flight checks: 43 tests passed. Importer checks: 15 tests passed on 2026-09-21. These are baseline results, not evidence for the proposed behaviour.
- Both working trees contain pre-existing edits. Implementation must preserve them and review the resulting diff against the starting state.

## Reference modules and recommendation

**Terrain Mapper**, inspected at `4b0d62507cc433219061268f465e3d9c67e36426`: its [terrain path wrapper](https://github.com/caewok/fvtt-terrain-mapper/blob/4b0d62507cc433219061268f465e3d9c67e36426/scripts/Token.js) inserts terrain waypoints while preserving waypoint properties. Its [elevation handler](https://github.com/caewok/fvtt-terrain-mapper/blob/4b0d62507cc433219061268f465e3d9c67e36426/scripts/TokenElevationHandler.js) selects different path algorithms for walking, flying and burrowing. Adopt that separation and the idea of ordered boundary contacts. Its geometry operates on terrain cutaways and a scene floor; it is not a ready-made PF2e reaction or native-level ownership resolver.

**Region Behaviour Adjustments**, inspected at `144fa526b89a65a8b362fa794c153e8c73b4cb48`: its [level change implementation](https://github.com/Saibot393/regionba/blob/144fa526b89a65a8b362fa794c153e8c73b4cb48/scripts/adjustments/changeLevel.js) pauses movement, checks movement identity after interaction, and optionally reissues the remaining path on the destination level. Adopt the identity and continuation principles. Do not copy its broad replacement of core level-change methods; its file explicitly incorporates Foundry implementation code.

**Foundry API**: [pause/resume](https://foundryvtt.com/api/classes/foundry.documents.TokenDocument.html#pauseMovement) already provides movement-scoped coordination. [Document subtype registration](https://foundryvtt.com/api/modules/foundry.documents.html#document-subtypes) requires manifest declarations and gives module types a module namespace. Client data-model registration alone cannot establish a server-recognized legacy type.

Alternatives considered: requiring the reference modules introduces a second movement owner; building unrelated replacements discards working Codex code. Extend the existing code behind the three boundaries above, replacing overlapping paths as their consumers move.

## Shared engineering contract

The component specs inherit these commands, style and delivery rules, plus the [configuration and upgrade contract](CONFIGURATION.md). Their automatic-outcome descriptions apply when the GM selects Apply after choices; Advisory presents proposed consequences for manual resolution.

- Runtime: Foundry v14, PF2e and SF2e; Codex is TypeScript/ESM with Vite and Vitest. Importer is JavaScript/ESM with Node tests.
- Codex checks, from `/Users/peterg/code/codex-bridge`: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and final `npm run verify`.
- Importer checks, from `/Users/peterg/code/codex-dungeon/map-workshop`: `node --test foundry-module/*.test.mjs`, then `npm test` when exporter or shared workshop code changes.
- Put Codex tests under `tests/node/`; keep importer tests beside the existing `foundry-module/*.test.mjs` files.
- Keep pure decisions independent of Foundry globals. Use typed results, descriptive function names, and explicit units. Example of existing style: `export function surfaceBelow(floors: readonly Floor[], point: Point, elevation = Infinity): number | null`.
- Expose cross-feature imports through the existing `index.ts` boundaries. Do not move unrelated gridless navigation code.
- Always: red/green tests for changed executable behaviour; review every changed line; verify in Foundry with both GM and player clients.
- Ask first: design/plan approval under the selected skills and the workshop's parent `AGENTS.md`; deployment or changes to live campaign scenes are separate from local implementation.
- Never: overwrite existing work, infer physical floors from level display bases, roll reactions without a choice, or bypass collisions globally to make a transition work.

## Implementation planning focus

1. Verify the migration workflow in `SPEC-region-definitions.md`, including the transition while legacy scenes still exist.
2. Pin the support/footprint contract in `SPEC-surface-resolution.md`, especially large tokens at ledges.
3. Cover the movement scope and exceptional-case boundary in `SPEC-movement-rules.md` without silently applying ordinary outcomes to unresolved cases.

The [implementation plan](../../plans/2026-09-21-regions-movement.md) is approved for native execution in the current checkouts. Deployment and changes to existing campaign scenes remain separate from local implementation.
