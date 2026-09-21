# Region Definitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Codex independently registered floor/water types and a verified migration path.
**Architecture:** Codex and importer each register their own namespace; readers accept both during transition.
**Tech Stack:** Foundry v14 manifests/data models, TypeScript, Vitest, importer Node tests.
**Spec:** [region-definitions](../specs/2026-09-21-regions-movement/SPEC-region-definitions.md).
## Global Constraints
Inherit all [plan constraints and checks](2026-09-21-regions-movement.md); no exporter format change is needed.
## Review Focus
Mixed namespaces, disabled behaviours, preserved embedded IDs, repeat migration, absent optional dependency.

### Slice 1: Register Codex region behaviours
Files: create `src/canvas/regions/index.ts`, `src/canvas/regions/lang/en.json`, `tests/node/regions/definitions.test.ts`; modify `module.json`, `src/hooks/init.ts`. Produces `registerRegionBehaviors(): void`; floor schema retains numeric `elevation`, water retains empty schema. Visible labels match the importer exactly.
- [ ] Write a failing registration test using stubbed Foundry fields and CONFIG: both canonical IDs resolve, floor defaults to zero, water has no fields, neither has event handlers.
```ts
registerRegionBehaviors();
expect(Object.keys(CONFIG.RegionBehavior.dataModels)).toEqual(expect.arrayContaining(["codex-foundry.setElevation", "codex-foundry.water"]));
```
- [ ] Run `npm test -- tests/node/regions/definitions.test.ts` red; declare both manifest subtypes and register models during init; rerun green and the common checks.
- [ ] In a disposable world with only Codex, create/save/reload each behaviour on a hand-authored region. Confirm manifest registration server-side; registration alone does not yet promise floor automation.

### Slice 2: Recognize both namespaces in existing consumers
Files: modify `src/canvas/regions/index.ts`, `src/rulesets/sf2e/gridless/floors.ts`, `src/rulesets/sf2e/gridless/routing.ts`, `tests/node/gridless/floors.test.ts`; create `tests/node/regions/reader.test.ts`. Depends on 1. Produces `isFloorType(type: string): boolean` and `isWaterType(type: string): boolean`; replace exact type checks, retaining one floor per region.
```ts
expect(["map-workshop-importer.setElevation", "codex-foundry.setElevation"].every(isFloorType)).toBe(true);
expect(isFloorType("terrainmapper.setElevation")).toBe(false);
```
- [ ] Add red tests for canonical, legacy, mixed, and disabled markers; assert identical movement/routing floors and water labels.
- [ ] Run `npm test -- tests/node/regions tests/node/gridless/floors.test.ts tests/node/gridless/routing.test.ts` red, implement predicates and replace checks, rerun green and common checks.
- [ ] Move a token across canonical and legacy treads with both modules enabled; one height update per transition, no duplicate floor contact.

### Slice 3: Select region types at import
Files: modify `W/foundry-module/scripts/import-scene.js`, `scripts/importer.js`, `module.json`, `import-scene.test.mjs`, `README.md` (all five under `W/foundry-module/`). Depends on 2. Produces pure `withRegionProvider(scene, codexAvailable)` returning a cloned scene with only the two known legacy type strings replaced when available.
```js
const source={regions:[{behaviors:[{_id:'kept',type:'map-workshop-importer.water',system:{}}]}]};
assert.equal(withRegionProvider(source,true).regions[0].behaviors[0].type,'codex-foundry.water');
assert.equal(withRegionProvider(source,false).regions[0].behaviors[0].type,'map-workshop-importer.water');
```
- [ ] Add those red assertions plus source immutability/unrelated-behaviour preservation; run `node --test foundry-module/import-scene.test.mjs` from W.
- [ ] In `importZip`, resolve active Codex plus registered canonical models before `Scene.create`; call the pure conversion, declare `relationships.recommends`, and show an inert-data notice if unavailable. Keep legacy fallback registration untouched.
- [ ] Rerun importer tests green; import the same archive with and without Codex, verifying real persistence and unchanged region IDs/flags/geometry. Update importer documentation.

### Slice 4: Preview and migrate existing scenes
Files: create `src/canvas/regions/migration.ts`, `tests/node/regions/migration.test.ts`; modify `src/canvas/regions/index.ts`, `src/api.ts`, `README.md`. Depends on 3. API: `api.regions.migrateLegacy({sceneUuids: string[], apply?: boolean})`, preview by default; returns per-scene changed behaviour UUIDs and failures in the existing API result style.
```ts
expect(legacyTypeUpdate({_id:"kept",type:"map-workshop-importer.water"})).toEqual({_id:"kept",type:"codex-foundry.water"});
expect(legacyTypeUpdate({_id:"kept",type:"codex-foundry.water"})).toBeNull();
```
- [ ] Define `legacyTypeUpdate(source: {_id: string; type: string}): {_id: string; type: string} | null`; test both types, foreign types, preview without writes, repeat migration and non-GM rejection; run `npm test -- tests/node/regions/migration.test.ts tests/node/api.test.ts` red.
- [ ] Use existing runtime API validation/authorization conventions; preview enumerates world Scene region behaviours, apply uses each region's embedded behaviour update with `_id` and `type` only. Re-read before applying, report partial failures, and never disable the importer automatically. If a region already carries both markers, migration replaces only the legacy type and the reader still selects a single floor; do not delete user-authored behaviours to deduplicate.
- [ ] Rerun green/common checks; preview and migrate a disposable legacy scene while both providers are enabled, repeat with zero changes, then disable importer and reload successfully. Run checkpoint 4.
