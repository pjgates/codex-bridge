# Codex Surface Geometry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require actual solid faces for climbing, with one shared preview/execution decision.

**Architecture:** Add a data-only geometry behaviour next to the existing floor behaviour; keep a pure face query in `canvas/regions`; consume its facts through existing movement decisions.

**Tech Stack:** Foundry 14, TypeScript, Vitest, Vite.

**Spec:** [Surface geometry](../specs/2026-09-22-surface-geometry-and-visibility-design.md).

## Global Constraints

All constraints and normal checks in the [plan index](2026-09-22-surface-geometry.md) apply. No assumptions of solid legacy terrain, no native region-band rewrite, no PF2e rules in geometry.

## Review Focus

Explicit Climb/Speed bypasses (A3), stale decisions (A4), overlapping differing extents (A2), source-face identity on descent (A4), holes crossed by long drags (A2).

### A1 — Geometry definition and manual authoring

**Files:** create `src/canvas/regions/geometry.ts`, `src/canvas/regions/geometry-config.ts`, `tests/node/regions/geometry.test.ts`; modify `src/canvas/regions/index.ts`, `types.ts`, `lang/en.json`, `module.json`, and the region hook registration in `src/hooks/init.ts`.

**Interfaces:**
```ts
export type SurfaceGeometry =
  | {extent:"unknown";underside:null;blocksSight:boolean;blocksLight:boolean}
  | {extent:"solid";underside:null;blocksSight:boolean;blocksLight:boolean}
  | {extent:"finite";underside:number;blocksSight:boolean;blocksLight:boolean};
export function readSurfaceGeometry(region:SurfaceRegion):SurfaceGeometry;
export function geometryPreset(
  preset:"solid"|"deck"|"catwalk", underside:number|null
):SurfaceGeometry;
```
Missing/disabled geometry reads unknown. Duplicate enabled definitions or invalid persisted values are rejected at the document boundary; the query reports unresolved geometry rather than coercing values. `solid` does not require an underside; deck/catwalk do. Finite underside must be below the floor top when authored.

- [ ] Add tests before implementation using real region data models or the existing registration stub. Contract assertions:
```ts
expect(readSurfaceGeometry({behaviors:[]} as never).extent).toBe("unknown");
expect(geometryPreset("catwalk",3)).toEqual({extent:"finite",underside:3,blocksSight:false,blocksLight:false});
expect(()=>geometryPreset("deck",null)).toThrow();
```
- [ ] Run `npx vitest run tests/node/regions/geometry.test.ts`; verify the missing API/behaviour failure.
- [ ] Register `codex-foundry.surfaceGeometry` in the manifest and data-model registry. Native fields are extent, nullable underside, blocksSight and blocksLight. Add a small GM configuration action for preset/thickness convenience; changing thickness writes only `underside=top-thickness`. Show which floor supplies the top. Do not create native visibility documents yet.
The stored field implementation uses Foundry fields, not a new persistence layer:
```ts
extent: new foundry.data.fields.StringField({initial:"unknown",choices:["unknown","solid","finite"]}),
underside: new foundry.data.fields.NumberField({nullable:true,initial:null}),
blocksSight: new foundry.data.fields.BooleanField({initial:true}),
blocksLight: new foundry.data.fields.BooleanField({initial:true}),
```
- [ ] Re-run focused tests and Codex normal checks. In Testing Scene, add/edit/disable the behaviour and reopen its sheet to verify persistence and fractional-foot underside. No movement-policy changes in this slice.

### A2 — Continuous exposed-face facts

**Files:** create `src/canvas/regions/faces.ts`, `tests/node/regions/faces.test.ts`; modify `support.ts`, `contacts.ts` only where geometry boundaries must join the existing trace, and export through `index.ts`.

**Interfaces:** consumes `SurfaceGeometry`/`readSurfaceGeometry` from A1 and existing `SurfaceScene`, `ContactWaypoint`, `supportsAt`.
```ts
export type FaceResult =
  | {kind:"face";regionId:string;top:number;bottom:number|null}
  | {kind:"gap";regionId:string}
  | {kind:"unknown";reason:string};
export function faceBetween(scene:SurfaceScene,from:ContactWaypoint,to:ContactWaypoint):FaceResult;
```
Coordinates are movement-origin points in scene pixels, elevations absolute feet. Output is fresh immutable facts for this query; no persistent cache. `bottom:null` denotes explicitly authored solid depth, not unknown.

- [ ] Add a small fixture builder inside `faces.test.ts`: adjacent rectangular polygons, top20/landing0, floor+geometry behaviours, and native level IDs. Test finite underside18 → gap, underside0 → face; solid → face; missing/duplicate/conflicting geometry → unknown; reversed ascent/descent use the same upper face. Add a hole and an intervening slab case to prove no continuous face through air or occupied space.
```ts
// In the test fixture, left region is top20 and right region is ground0.
expect(faceBetween(scene, {x:39,y:0,elevation:20,level:"upper"},
  {x:41,y:0,elevation:0,level:"lower"})).toEqual({kind:"gap",regionId:"ledge"});
```
- [ ] Run `npx vitest run tests/node/regions/faces.test.ts`; observe failures before adding query code.
- [ ] Select the upper-side region from the actual contact, compare the required vertical interval with its authored solid interval, then inspect the outside side for intervening material. Return unknown for ambiguous region ownership. Do not use nearest-floor difference as evidence. Keep polygon intersections in the existing contact module, not a second sampler.
The interval decision, after ownership and outside-clearance checks, is:
```ts
if (geometry.extent === "unknown") return {kind:"unknown",reason:"Surface extent is not authored."};
const low=Math.min(from.elevation,to.elevation);
if (geometry.extent === "finite" && geometry.underside>low) return {kind:"gap",regionId:upper.id};
return {kind:"face",regionId:upper.id,top:upperTop,bottom:geometry.underside};
```
Here `geometry` is the A1 definition for the selected `upper` region, and `upperTop` is its existing floor elevation.
- [ ] Run focused tests and Codex normal checks. Record a read-only Testing Scene geometry probe for a thin deck and solid cliff; query results must not mutate documents.

### A3 — Traversal and preview consume the same face

**Files:** modify `src/rulesets/sf2e/movement/transitions.ts`, `preview.ts`, `card.ts`, `resolution.ts`; tests `tests/node/movement/descent.test.ts`, `exploration-route.test.ts`, `travel.test.ts`, `preview.test.ts`; add `tests/node/movement/face-transitions.test.ts`.

**Interfaces:** consumes `faceBetween`; existing `prepareTransition` return shape remains stable, with optional `faceRegionId:string` on a Climb transition for DC/context. `sourceRegionId` retains its fall-reaction meaning.

- [ ] Add real planner tests for the same20ft route over solid versus finite2ft material. Cover ordinary Walk/Travel, explicit Climb, prepared Climb Speed and disabled exploration checks. All thin-deck variants must refuse a full-height climb. Add preview/card assertions for gap and unknown results.
```ts
expect(plan.transition?.reason).toBe("fall"); // Known downward gap.
expect(plan.waypoints.at(-1)?.elevation).not.toBe(0); // Safe prefix does not grant descent.
// For an attempted ascent across the same gap:
expect(ascent.transition?.reason).toBe("ruling");
```
- [ ] Run `npx vitest run tests/node/movement/face-transitions.test.ts`; observe the current false-climb failures.
- [ ] Call `faceBetween` before any Climb rewrite, prepared-Speed shortcut or unchecked elevation change. Face → existing climb; known descent gap → existing fall decision; unsupported ascent/unknown → ruling. Preserve forced/flight/jump/placement handling. Do not auto-lower to an underside before falling. Feed the same result to the preview, including the relevant face DC.
Use the face result before the existing climb bypasses:
```ts
if (face.kind === "unknown") reason="ruling";
else if (face.kind === "gap") reason=rise<0?"fall":"ruling";
else {reason="climb";faceRegionId=face.regionId;}
```
This classification applies only after the existing forced/flight/placement branches select an eligible voluntary climb candidate.
- [ ] Update older climb fixtures to explicitly author solid geometry where that was their intent; retain explicit legacy-unknown tests rather than giving every test an implicit solid default. Run movement/region tests and Codex normal checks. Live GM test in Testing Scene must reproduce both upward/downward thin-deck refusal with checks disabled and a valid solid20ft climb.

### A4 — Partial climb context and stale geometry

**Files:** modify `src/rulesets/sf2e/movement/resolution.ts`, `transitions.ts`, `climbing-state.ts`, `status.ts` only for persisted face context needed between requests; tests `tests/node/movement/climb-outcomes.test.ts`, `descent.test.ts`, new `face-continuation.test.ts`.

**Interfaces:** store the owning face region ID with this token's Climbing status when a partial climb starts. Each new request re-reads geometry; a stored ID is a locator, not proof that the face still exists. Existing status/DC APIs remain backwards compatible when context is absent.

- [ ] Add tests: partial descent uses upper-face DC; an underside shortened between the check and application prevents movement; removing/disabling the geometry asks for a ruling; a critical failure keeps the correct edge-reaction region. Existing statuses with no face locator resolve by a fresh unambiguous query or ask the GM.
```ts
const before = token._source.elevation;
await resolveMovementChoice(token,data,"climb",gm,message,response);
expect(token._source.elevation).toBe(before); // Geometry was invalidated after the roll.
```
- [ ] Run `npx vitest run tests/node/movement/face-continuation.test.ts`; verify the stale-application failure first.
- [ ] Revalidate the face immediately before application alongside existing movement-ID guards. Preserve completed progress, never silently extend beyond finite material, and do not repeat damage/checks when a pending decision becomes stale.
Use the freshly reconstructed transition at application time:
```ts
const current=currentTransition(token,data);
if (!current || current.reason!=="climb" || current.faceRegionId!==data.transition.faceRegionId) {
  throw new Error("The climb surface changed; reassess this movement.");
}
```
The shared planner has already rechecked the face interval; retaining the same ID alone is insufficient.
- [ ] Run Codex normal checks. Verify partial solid ascent/descent and geometry edits during a paused request in Testing Scene; restore data and delete only task messages. Document missing-geometry authoring requirements in `README.md` and `docs/testing/regions-movement.md`.
