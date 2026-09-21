# Surface Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find physical support and every boundary contact across native Scene Levels.
**Architecture:** Geometry reports supporting region identity and contacts; existing labels consume it before movement policy changes.
**Tech Stack:** TypeScript, Foundry region polygon trees, Vitest.
**Spec:** [surface-resolution](../specs/2026-09-21-regions-movement/SPEC-surface-resolution.md).
## Global Constraints
Inherit all [plan constraints, Support contract and point convention](2026-09-21-regions-movement.md).
## Review Focus
Holes narrower than five pixels, bridge above a token, equal-height levels, absent landing, large-token origin offsets.

### Slice 5: Preserve support identity across levels
Files: create `src/canvas/regions/support.ts`, `tests/node/regions/support.test.ts`; modify `src/canvas/regions/index.ts`, `src/rulesets/sf2e/gridless/floors.ts`, `src/rulesets/sf2e/flying/height.ts`. Depends on 2. Expose the index plan's `selectSupport` plus `supportsAt(scene, point)` with structural scene/region types taken from current `FloorRegion`. Existing numeric `surfaceBelow` becomes a compatibility projection for existing display callers.
```ts
expect(selectSupport([{regionId:"low",elevation:-20,levelIds:["lower"]}],0,"upper"))
  .toEqual({kind:"surface",support:{regionId:"low",elevation:-20,levelIds:["lower"]},level:"lower"});
expect(selectSupport([],0,"upper")).toEqual({kind:"none"});
```
- [ ] Add red tests for the example, intermediate floor, higher bridge exclusion, two ambiguous equal-height levels, disabled markers and polygon holes; run `npm test -- tests/node/regions/support.test.ts tests/node/gridless/floors.test.ts tests/node/flying`.
- [ ] Implement scene-document queries without requiring rendered objects or caches; preserve all winning region memberships, including empty membership's all-level meaning. Make existing surface-height callers consume the query without manufacturing a physical floor from level base.
- [ ] Rerun green/common checks; inspect labels over the lower floor with its level hidden, and under a higher bridge. Keep legacy movement execution unchanged until slice 7 replaces its transition handling.

### Slice 6: Trace floor exits as well as entries
Files: create `src/canvas/regions/contacts.ts`, `tests/node/regions/contacts.test.ts`; modify `src/canvas/regions/index.ts`, `src/rulesets/sf2e/gridless/floors.ts`, `tests/node/gridless/floors.test.ts`. Depends on 5. `traceContacts(scene, token, waypoints)` returns ordered `{leg: number; t: number; before: Support[]; after: Support[]}`; waypoints use the existing elevation waypoint shape extended with required level.
```ts
// Pure exported helper used by traceContacts; t is along the segment from 0 to 1.
expect(segmentParameters({x:0,y:0},{x:100,y:0},[40,-10,41,-10,41,10,40,10]))
  .toEqual([0.4,0.41]);
```
- [ ] Define `segmentParameters(a: {x:number;y:number}, b: {x:number;y:number}, points: readonly number[]): number[]`; test a one-pixel gap, hole ring, shared boundary, tangent, zero-length and multi-leg paths; run `npm test -- tests/node/regions/contacts.test.ts tests/node/gridless/floors.test.ts` red.
- [ ] Split at exact polygon-edge intersection parameters, deduplicate coincident parameters, evaluate interval membership through the polygon tree, and use `getMovementOrigin` consistently. Adapt existing floor crossing output from these contacts; remove its fixed sampling/corner-skip dependency when replaced.
- [ ] Rerun green/common checks; compare 1×1 and 2×2 token origin crossing against the Regions layer, including a narrow hole on a long drag. Keep collisions full-footprint; do not invent footprint physics for art overhang.
