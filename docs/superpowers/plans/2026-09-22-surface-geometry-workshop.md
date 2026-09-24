# Workshop Surface Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve authored solid extent and deck visibility through save, export and import.

**Architecture:** Derive geometry from sorted open spans; store only surface visibility metadata beside the owning span. Partition exported regions by the resulting geometry/visibility contract and retain an inert compatible subtype without Codex.

**Tech Stack:** Existing JavaScript DOM editor, Node test runner, Foundry14 importer.

**Spec:** [Surface geometry](../specs/2026-09-22-surface-geometry-and-visibility-design.md).

## Global Constraints

The [index](2026-09-22-surface-geometry.md) supplies scope, sequence and normal checks. All file paths below are relative to `/Users/peterg/code/codex-dungeon/map-workshop`. Follow the parent AGENTS.md: one slice at a time, no commits unless requested, no wholesale editor refactor. Span geometry remains integer2.5ft units.

## Review Focus

Old saves becoming transparent (B1); underside edits unexpectedly merging/deleting openings (B2); equal-height differing extents merged on export (B3); older Codex rejecting an unknown subtype (B4); stale export geometry after undo/redo (B2/B3).

### B1 — Surface persistence and extent derivation

**Files:** create `span-surfaces.js`, `span-surfaces.test.mjs`; modify `span-files.js`, `span-files.test.mjs`, and new-map span creation in `span-generation.js` only if normalization is needed there.

**Interfaces:** consumes sorted canonical spans from `spans.js`. Produces:
```js
// `surface` lives on an authored span; no redundant underside field.
const surface = {blocksSight:true,blocksLight:true};
// surfaceOf(spans, spanId) returns the shared Foundry contract in FEET:
// {extent:'solid'|'finite',underside:number|null,blocksSight,blocksLight}
// Public function: surfaceOf(spans, spanId) -> SurfaceGeometry
```
A finite underside is the previous opening's ceiling ×2.5. The lowest opening is solid below. Default visibility is opaque for new and migrated spans. Reject malformed persisted booleans at decode; preserve unrelated extension metadata.

- [ ] Test derivation and version4→5 migration before implementation:
```js
assert.deepEqual(surfaceOf([{id:1,floor:-10,ceiling:-1},
 {id:2,floor:1,ceiling:8,surface:{blocksSight:false,blocksLight:false}}],2),
 {extent:'finite',underside:-2.5,blocksSight:false,blocksLight:false});
```
Also save/load a catwalk and reject an invalid visibility value without discarding other fields.
- [ ] Run `node --test span-surfaces.test.mjs span-files.test.mjs`; record the expected failure.
- [ ] Implement `surfaceOf` with a predecessor lookup, and `migrateSpanMapV4(data)` that returns version5 and adds opaque surface defaults without altering floor/ceiling/IDs. Extend the existing migration chain and decoder; leave previous version semantics intact.
The derivation does not infer thickness from the next landing:
```js
const index=spans.findIndex(span=>span.id===spanId);
const current=spans[index],previous=spans[index-1];
return {extent:previous?'finite':'solid',underside:previous?previous.ceiling*2.5:null,
 blocksSight:current.surface?.blocksSight??true,blocksLight:current.surface?.blocksLight??true};
```
`spans` has already passed the canonical save/model boundary checks.
- [ ] Run focused tests and Workshop normal checks. A loaded version4 fixture must render the same floor/ceiling geometry before any edit.

### B2 — Surface inspector, presets and thickness edits

**Files:** create `surface-inspector.js`, `surface-inspector.test.mjs`; modify `span-surfaces.js`, `span-surfaces.test.mjs`, `span-inspector.js`, `editor.js`, `index.html`, `style.css` with scoped additions. Add `fixtures/surface-workflow-check.html` if the existing browser fixture cannot exercise the inspector.

**Interfaces:** consumes `surfaceOf` from B1, `applySpanBounds` and editor `sectionCommand`. Produces:
```js
// Edits canonical source, not Projection. Patch keys are optional.
// Returns the existing {map,survivor,removedTargets} shape consumed by sectionCommand.
// Public function: applySurfaceEdit(map, target, patch) -> {map, survivor, removedTargets}
// patch: {preset?:'solid'|'deck'|'catwalk', thicknessUnits?:number,
//         blocksSight?:boolean, blocksLight?:boolean}
```
`thicknessUnits` adjusts the immediately lower opening's ceiling to upper.floor−thicknessUnits. Reject nonpositive/noninteger thickness, no lower opening, or a result at/below that opening's floor. Never silently remove/merge openings. Solid preset on a finite slab requires the user to author the fill separately; preset application itself does not delete the lower space.

- [ ] Add tests for changing a lower ceiling, preserving the upper floor and unrelated fields, refusing an invalid thickness, and undo/redo restoring both geometry and visibility via existing snapshots.
```js
const result=applySurfaceEdit(map,{q:0,r:0,spanId:2},{thicknessUnits:1,preset:'catwalk'});
assert.equal(result.map.cells[0].spans[0].ceiling,upper.floor-1);
assert.equal(result.map.cells[0].spans[1].floor,upper.floor);
```
- [ ] Run `node --test span-surfaces.test.mjs surface-inspector.test.mjs` and observe failures first.
- [ ] Mount a focused inspector section for the selected opening. Display top, derived underside and thickness in feet; show which lower opening changes. Route edits through `sectionCommand`; derive presets from fields rather than saving a second preset authority. Show the need for a lower opening instead of guessing one. Add independent sight/light controls; do not add a new sound model.
The thickness edit updates the lower span through the existing model operation:
```js
const ceiling=upper.floor-patch.thicknessUnits;
if (ceiling<=lower.floor) { throw new Error('Thickness would remove the lower opening.'); }
const result=applySpanBounds(map,{...target,spanId:lower.id},lower.floor,ceiling);
```
`upper` and `lower` are the selected span and its checked immediate predecessor. Keep the selected upper target as the editor's survivor and apply visibility to that upper span in the returned map.
- [ ] Run Workshop normal checks. In the browser, edit a two-opening column, Undo, Redo, save/reload and export. Verify the same selected opening and geometry at each step; inspect disabled controls for a lone lowest opening.

### B3 — Partition physical export regions

**Files:** modify `foundry-export.js`, `foundry-geometry.js`, `foundry-export.test.mjs`, `foundry-geometry.test.mjs`, `span-projection.js` only to carry the owning authored span/derived facts to export; create `fixtures/surface-geometry.hexmap.json` with adjacent same-height solid, slab and catwalk areas.

**Interfaces:** consumes `surfaceOf` and existing `traceCells`/`polygonShapes`. Extend:
```js
floorRegion({height,levelId,shapes,geometry,surfaceKey})
// geometry is SurfaceGeometry in feet; height retains Workshop units.
// surfaceKey = JSON.stringify([levelId,height,extent,underside,blocksSight,blocksLight])
```
Fresh region flags carry `map-workshop.surfaceKey`; new native visibility behaviours carry a matching owner key. Identical disconnected pieces may share one region, but differing keys may not. The key is scoped to one scene and is a generated association, not an authored identity.

- [ ] Add tests proving three equal-height areas produce distinct geometry groups, holes remain holes, negative undersides remain absolute feet, and old solid fixtures still cover the same footprints.
```js
assert.equal(regions.filter(r=>r.behaviors.some(b=>b.type.endsWith('.surfaceGeometry'))).length,3);
assert.deepEqual(new Set(regions.map(r=>r.flags['map-workshop'].surfaceKey)).size,3);
```
- [ ] Run `node --test foundry-export.test.mjs foundry-geometry.test.mjs`; observe partition/data failures.
- [ ] Group physical regions by the full key instead of `heightLoops` alone; keep height-only visual grouping until C3. Add inert `map-workshop-importer.surfaceGeometry` with the exact four fields from A1. Export format becomes7. Keep native floor bands unchanged and top elevation/DC ownership separate. Mark only generated core visibility behaviours as managed, preserving current sound defaults.
Use an explicit grouping key:
```js
const key=JSON.stringify([levelId,height,geometry.extent,geometry.underside,
 geometry.blocksSight,geometry.blocksLight]);
```
Store the group cells locally, trace each group with existing polygon tools, and attach `surfaceKey:key` to the exported owner/managed-native association.
- [ ] Run Workshop normal checks and inspect exported JSON/zip. Verify all referenced images exist and mutual level inclusion remains present. Do not import this new format into a runtime lacking B4 support.

### B4 — Importer compatibility and canonical migration

**Files:** modify `foundry-module/module.json`, `scripts/set-elevation.js`, `scripts/main.js`, `scripts/import-scene.js`, `scripts/importer.js`, `lang/en.json`, `import-scene.test.mjs`, importer README; Codex `src/canvas/regions/migration.ts` and `tests/node/regions/migration.test.ts` for explicit legacy-type conversion.

**Interfaces:** existing `withRegionProvider(scene,codexAvailable)` keeps its signature. For format7, `codexAvailable` requires all three types (floor, water, geometry). If Codex is active but lacks the new capability, reject format7 with an upgrade-or-disable message: falling back to legacy types would let the old movement engine ignore the geometry. With Codex disabled, standalone inert import remains available. Do not map geometry to an unregistered subtype. Extend `legacyTypeUpdate` with a third mapping that preserves behaviour system data/ID.

- [ ] Test format7 support alongside2–6; standalone inert geometry, full Codex mapping, and older Codex lacking the new subtype. Assert untouched flags, IDs, native visibility settings and images.
```js
assert.equal(withRegionProvider(scene,true).regions[0].behaviors
 .find(b=>b.type.endsWith('.surfaceGeometry')).type,'codex-foundry.surfaceGeometry');
assert.equal(withRegionProvider(scene,false).regions[0].behaviors
 .find(b=>b.type.endsWith('.surfaceGeometry')).type,'map-workshop-importer.surfaceGeometry');
```
- [ ] Run `node --test foundry-module/*.test.mjs` and the Codex migration test before implementation; verify failures.
- [ ] Register the inert four-field legacy subtype in manifest/init, add format7 to `FORMATS`, and check provider capabilities before conversion. Keep formats2–6 available and show the existing automation notice for standalone import. For an active older Codex, reject format7 before uploading/creating scene content. Never silently drop geometry or auto-migrate existing campaign scenes.
The new mapping preserves the document rather than reconstructing it:
```js
if (behavior.type==='map-workshop-importer.surfaceGeometry') {
  behavior.type='codex-foundry.surfaceGeometry';
}
```
Only execute this inside the confirmed provider-capability branch.
- [ ] Run both repositories' normal checks. Exercise a new format7 archive using Testing Scene-scoped fixture documents; verify provider conversion and read-back of native surface settings. No world module disabling merely to test standalone mode: exercise its pure import path and registration fixture locally, or use an isolated test world only if supplied.
