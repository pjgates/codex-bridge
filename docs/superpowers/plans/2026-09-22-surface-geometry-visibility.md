# Surface Visibility and Artwork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow intended cross-level sight while keeping the viewed level's terrain legible and retaining opaque obstructions.

**Architecture:** Native Define Surface restrictions implement sight/light. A scoped reconciler manages only explicitly owned native documents. Workshop exports independently occludable deck artwork without duplicate opaque pixels in combined images.

**Tech Stack:** Foundry14 native surfaces/tiles, Codex TypeScript/Vitest, Workshop SVG export/Node tests and browser verification.

**Spec:** [Surface geometry](../specs/2026-09-22-surface-geometry-and-visibility-design.md).

## Global Constraints

Read the [index](2026-09-22-surface-geometry.md) and complete A/B slices first. No live Mining Site edits, no blanket tile-elevation reset, no native-vision replacement, no world permission changes. Testing Scene only; player verification belongs to the user. Native occlusion behaviour must be proved before encoding it in production export.

## Review Focus

Unowned opaque surfaces surviving reconciliation (C2); upper backgrounds duplicating deck pixels (C3); arbitrary user tiles sharing elevations (C2/C4); transparency revealing unseen tokens (C1/C4); mutual level visibility fixing tokens but hiding terrain (C1/C3).

### C1 — Prove native above/below visibility and artwork configuration

**Files:** create `docs/testing/surface-visibility.md`, `tests/fixtures/surface-visibility.mjs` (an explicitly invoked GM macro fixture, not production startup code); use Workshop `fixtures/surface-geometry.hexmap.json` from B3 and existing test artwork.

**Interfaces:** consumes geometry from A1/B3. Produces the exact verified native `defineSurface` settings, region membership and `Tile.occlusion` configuration in the evidence document. No later code chooses a configuration that this fixture has not exercised.

- [ ] Snapshot Testing Scene's level visibility, Bob/test-token position, current GM viewed scene, created-document IDs and task message IDs. Add isolated solid-deck and grated-deck fixtures with equal top10ft/underside7.5ft; include open space beside the deck, a blocking wall, a lower terrain image and an upper deck image. Use only existing test levels or record every newly created test level for restoration.
```js
const scene=game.scenes.get('ICGvusDt5doJCahX');
if(canvas.scene.id!==scene.id) throw Error('View Testing Scene before this fixture.');
// Native setup values to verify, not yet a production default:
const solid={placement:'bottom',move:false,sight:true,light:true,sound:true,
 occlusion:true,exposure:false,culling:false};
const grated={...solid,sight:false,light:false};
const candidateTileOcclusion={modes:[CONST.OCCLUSION_MODES.SURFACE],alpha:0};
```
Supply the fixture's upper/lower level IDs from the Testing Scene documents. Use actual created IDs in teardown, never delete by broad name matching.
- [ ] First reproduce the user's failure with mutual visible levels, opaque overlapping artwork and no occlusion. Capture the lower-view image and test-token visibility. Then apply the native candidate configuration to the disposable fixtures only.
- [ ] Inspect from below and above with Bob controlled, including open-edge sight, a target behind the wall and a target hidden from players. Run native sight/light intersection queries as supporting evidence; record their results separately from actual token visibility. Check that only intended art fades and lower terrain remains legible. Repeat with the generated terrace/background combination, not only one isolated tile.
- [ ] If native controls fail, document the exact failed case and pause the dependent visibility/artwork work for a scoped design revision. Do not ship global opacity overrides, permission bypasses or a custom visibility engine. If they pass, record the exact working values and camera/level conditions; restore fixtures and produce the short player reproduction steps for C4.

### C2 — Managed native visibility and explicit adoption

**Files (Codex):** create `src/canvas/regions/visibility.ts`, `visibility-config.ts`, `tests/node/regions/visibility.test.ts`; modify `index.ts`, `geometry-config.ts`, `src/hooks/ready.ts`, `src/api.ts` only for the scoped authoring entry point.

**Interfaces:** consumes A1 geometry, B3 `surfaceKey` association and C1 verified native settings. Use a persisted owner key on managed documents: exported `surfaceKey` within its scene, or the geometry behaviour UUID for manually authored regions. No ownership inferred from names or pictures.
```ts
export interface VisibilityRequest {
  regionUuids:readonly string[];
  adoptBehaviorUuids?:readonly string[];
  apply?:boolean; // false by default
}
export interface VisibilityChange {
  ownerKey:string;documentUuid?:string;operation:"create"|"update"|"delete";
  data:Record<string,unknown>;
}
export async function configureSurfaceVisibility(request:VisibilityRequest):Promise<{
  changes:VisibilityChange[];conflicts:string[];applied:boolean
}>;
```
Use the repository's existing GM API error convention for unauthorized/invalid requests. Persist only the requested definition; native changes are a derived result. Require explicit adoption of an old unowned native behaviour; duplicate unrelated opacity remains a reported blocker, never an automatic deletion.

- [ ] Add tests using document adapters: preview performs no writes; repeated apply is idempotent; catwalk changes only the owned sight/light fields; disabled/deleted geometry removes its own generated restrictions; an unrelated opaque behaviour remains present and is reported. Test two GMs so only the selected active GM reconciles.
```ts
const preview=await configureSurfaceVisibility({regionUuids:[region.uuid]});
expect(preview.applied).toBe(false);
expect(region.updateEmbeddedDocuments).not.toHaveBeenCalled();
// The fixture includes a separate GM-authored opaque surface.
expect(after.behaviors.get(unrelatedId).system.sight).toBe(true);
```
- [ ] Run `npx vitest run tests/node/regions/visibility.test.ts`; observe failures before implementation.
- [ ] Implement a pure change calculation, then a small GM application adapter. Persist ownership on generated/adopted documents. Reconcile create/update/delete/disable under active-GM authority with a per-region busy guard so generated updates cannot recursively regenerate documents. Re-read the geometry before writing after a dialog. Use a companion native region only where C1 requires a second physical plane; leave source floor/water elevation bands alone. Preserve native sound settings and unrelated flags.
- [ ] Add a preview/apply action to the existing geometry authoring UI listing affected document IDs and unresolved blockers. Run Codex normal checks and live adoption on a disposable Testing Scene copy of an old floor. Confirm transparency, disable/re-enable, reload and preservation of the unrelated blocker.

### C3 — Independent deck artwork and native occlusion export

**Files (Workshop):** modify `foundry-export.js`, `foundry-geometry.js`, `foundry-export.test.mjs`, `foundry-geometry.test.mjs`; create `foundry-surface-art.js`, `foundry-surface-art.test.mjs` only to own the new masking/grouping operation; modify `fixtures/surface-workflow-check.html` for a visible export preview.

**Interfaces:** consumes B3 grouped surfaces and C1 verified native configuration. Keep `levelSvg`, `wallsSvg`, `terraceSvg` public behaviour for existing callers; supply optional exclusion geometry only for this exporter path.
```js
// describeSurfaceArt(groups) returns plans, not generated image bytes.
// groups: [{surfaceKey,height,geometry,loops}]
// result: {decks:[{surfaceKey,height,loops}], excludeFromCombined:loops[]}
// Only finite surfaces enter decks; solid areas remain in their established layers.
```
Deck images are positioned at `feet(height)` and linked to the owning surface key. Sight transparency does not imply image alpha: apply the native occlusion configuration proven in C1. If C1 required another grouping for opaque finite slabs, use that exact recorded grouping, preserving the same public result fields.

- [ ] Add pixel/mask coverage tests on a fixed fixture with adjacent same-height catwalk and solid floor, an opening through the deck, lower terrain and walls. Assert each deck footprint appears once in the visible export layers, its holes remain transparent, and its image is absent from the upper background, wall foreground and other terrace layers where they would cover the lower view.
```js
const art=describeSurfaceArt(groups);
assert.equal(art.decks.length,2); // Opaque finite slab and grated finite slab.
assert.deepEqual(art.decks.map(d=>d.height),[4,4]);
assert.equal(tiles.find(t=>t.flags['map-workshop'].surfaceKey===key).elevation,10);
```
Keep solid-region rendering assertions on the existing fixtures to reject a broad cave-art regression.
- [ ] Run `node --test foundry-surface-art.test.mjs foundry-export.test.mjs foundry-geometry.test.mjs`; observe the duplicate-layer failure before changes.
- [ ] Trace finite deck footprints with the existing physical loops, create separate tile images, and subtract the same footprint from combined layers using existing SVG masks. Retain boundary ink without an opaque duplicate floor fill. Keep native physical regions independent of any visual ink expansion. Write correct per-deck elevation and C1 occlusion settings; preserve mutual native level inclusion.
- [ ] Run Workshop normal checks and browser-render the fixed fixture. Import its disposable content into Testing Scene and repeat C1's lower/upper checks with the real exported images. Include decorated user tiles as negative controls: exporter changes must not rewrite them. If implementation approaches400 changed lines, split masking and tile emission into sequential reviewed slices before proceeding.

### C4 — End-to-end verification, migration guidance and restoration

**Files:** Codex `README.md`, `CHANGELOG.md`, `docs/testing/regions-movement.md`, `docs/testing/surface-visibility.md`; Workshop `README.md`, `foundry-module/README.md`, `NOTES.md`.

**Interfaces:** no new runtime API. This task verifies A/B/C delivered contracts through the actual UI/import path.

- [ ] Run the complete normal checks for both repositories, plus Codex `npm run verify`. Read the results; document unrelated failures without suppressing them. Personally review all changed lines, provider names, serialized versions, file references and managed-document ownership.
- [ ] In Workshop, open a version4 fixture, set a finite catwalk via its real lower opening, edit thickness, Undo/Redo, save/reload, export and import. Verify separate equal-height solid/catwalk regions and corresponding images. Preserve old-format import coverage.
- [ ] In Testing Scene, verify solid climb20ft both directions, thin-deck unsupported ascent/descent with checks on/off and Climb Speed, partial context and stale-definition rejection, forced fall, water landing and unknown legacy ruling. Use gridless, square and hex fixtures for preview/execution agreement.
- [ ] Verify mutual level visibility together with lower terrain rendering, solid/grated sight and light, correct native deck elevation, unrelated walls/tiles and hidden-token negative controls. Never declare this passed using GM omniscience alone.
- [ ] Give the user this player-side checklist for Peter, without controlling the player browser:
  1. Control Bob below the test catwalk: see the intended upper target and lower terrain; the hidden target remains hidden.
  2. Move/view Bob above it: see the intended lower target through the grate; the wall still blocks its target.
  3. Repeat at the opaque deck: native sight is blocked through the deck, while adjacent open-edge sight remains possible.
  4. Confirm lower terrain stays legible after reload with both levels included.
  Record the user's result separately; pending player verification is not a claimed pass.
- [ ] Restore all Testing Scene snapshots and the prior GM view; remove only task-created documents and messages. Do not repair campaign bridge thickness, tile elevations or visibility settings without a separate concrete scene-change approval.
- [ ] Document the scoped existing-region authoring/adoption workflow, unknown-geometry compatibility change and standalone importer semantics. Use one fresh independent GPT-6 Astra final review if required by the execution skill; review every line personally first and resolve demonstrated findings before completion.
