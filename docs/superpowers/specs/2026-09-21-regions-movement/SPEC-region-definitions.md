# Spec: region-definitions

Status: design approved on 2026-09-21. Inherits the shared engineering contract in [README](README.md).

## Objective

Make Codex the owner of region data and its interpretation while preserving standalone import and existing scene meaning.

## Data and compatibility

Keep the user-visible floor and water behaviour names. Preserve floor `elevation` as absolute scene feet and the water region's bed-to-surface elevation band. Preserve region and behaviour document IDs, geometry, level membership, flags and unrelated behaviours.

Optional region metadata supplies Climb DC and, when different, Grab an Edge DC. Missing metadata requires a GM decision, not an invented DC. This metadata can use Codex region flags so legacy behaviour schemas remain unchanged.

Foundry's supported registration mechanism ties a full behaviour type to its module namespace. The user selected independent Codex types with migration:

- Register `codex-foundry.setElevation` and `codex-foundry.water`; support legacy readers during transition; provide a GM-run migration of behaviour type fields.
- The importer uses registered Codex types when Codex is active and legacy types otherwise. Old exported archives remain accepted.
- Run migration while both providers are enabled, verify all targeted scenes, then allow disabling the importer. A migration preview reports legacy behaviours before applying changes; unmigrated scenes remain visible as unresolved work.
- Keep the importer's legacy manifest definitions and inert fallback models for standalone operation. There is no need for Codex to overwrite those models: both IDs can have one registered provider, and the shared reader recognizes either during migration.

The importer declares Codex as optional. Without it, import still preserves floor/water data and explains that movement automation is inactive. With it, only one module owns each behaviour's registration; hook ordering must not determine the result.

## Structure and verification

Codex registration belongs in a small canvas feature initialized from `src/hooks/init.ts`, with public exports through its `index.ts`. The importer seam is `foundry-module/scripts/main.js`, `scripts/set-elevation.js`, `scripts/import-scene.js`, and its manifest. Only change exporter output if the chosen import contract needs it.

Test importer only, Codex only, both modules, and reloading an existing scene. Validate persistence through real `Scene.create`/behaviour updates: mocked CONFIG registration does not prove server acceptance. Verify old archives, disabled behaviours, and unchanged visible names.

## Success criteria and boundaries

- Existing scene geometry and behaviour data survive the chosen compatibility path.
- Codex can offer its region definitions on hand-authored scenes.
- Standalone import retains inert floor/water data and succeeds without either reference module.
- No duplicate registration or movement handlers when both local modules are active.
- The migration, if selected, is idempotent, reports changed scenes, and is tested on disposable copies before use on a campaign.
- This module does not apply movement policy or introduce new map geometry.
