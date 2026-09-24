# Surface Geometry and Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Preserve the user's native execution choice; one writer, one slice at a time.

**Goal:** Stop invented climbs through air and support solid or see-through decks without obscuring lower-level terrain.

**Architecture:** Codex supplies physical face queries and movement policy; Workshop derives surface extent from its authored openings and exports separate physical/visual surfaces. Native Foundry surfaces own sight/light restrictions, while separately exported artwork uses verified native occlusion. A bridge is a preset over the general geometry contract.

**Tech Stack:** Foundry 14.368, SF2e/PF2e, TypeScript/Vite/Vitest in Codex; JavaScript/Node tests and the existing DOM editor in Workshop.

**Spec:** [Surface geometry and deck visibility](../specs/2026-09-22-surface-geometry-and-visibility-design.md). Read it and this index before the owning slice plan.

**Status:** Approved by the user (“lgtm”); implementation in progress in the current checkouts.

## Global Constraints

- “Disabling checks waives checks, never missing physical support. Speed and feats cannot create a wall across open air.”
- “Preserve existing floor and water behaviour names, IDs, DCs and unrelated data. Add geometry independently of the existing floor-height field.”
- “Runtime testing uses only Testing Scene and the built-in GM browser. The user owns player-client testing; PF2e runtime is waived.”
- “Do not modify Tessa, campaign geometry or campaign visibility settings during tests.”
- “Automatic cover, attacks through grates, rails, ladders, ropes, ceiling traversal and full 3D collision simulation are outside this change.”
- Use current checkouts, with no commits/pushes/PRs unless separately requested. Preserve all starting edits. Workshop is a subdirectory of the codex-dungeon repository; its parent AGENTS.md applies.
- Target under 200 changed lines per slice; split before exceeding 400. Tests and docs belong to their owning concern, not a final cleanup bundle. Do not start the next slice before the current slice's normal checks pass.
- Keep geometry independent of PF2e and native sight independent of artwork. Do not change level inclusion alone as a campaign fix.
- Units: Foundry absolute scene feet; Workshop safe integer height units ×2.5 ft. Do not silently round thickness or infer a level-base floor.

## Review Focus

1. An explicit Climb or prepared Climb Speed must not bypass missing geometry — A3.
2. Changing/disabling a face while a movement decision is open must not apply a stale climb — A4.
3. Two equal-height regions with different undersides must not be merged or arbitrarily selected — A2/B3.
4. An unrelated opaque native behaviour must survive a transparent-deck edit — C2.
5. An upper image duplicated in a background or terrace must not cover lower terrain after cross-level inclusion — C1/C3.

## Delivery order and ownership

| Order | Slice | Result | Owning plan |
|---|---|---|---|
| 1 | A1 | Editable geometry behaviour and presets | [Codex geometry](2026-09-22-surface-geometry-codex.md) |
| 2 | A2 | Pure exposed-face query | Codex geometry |
| 3 | A3 | Shared traversal/preview classification | Codex geometry |
| 4 | A4 | Partial/check-result geometry revalidation | Codex geometry |
| 5 | B1 | Saved Workshop surface properties and derived extent | [Workshop export](2026-09-22-surface-geometry-workshop.md) |
| 6 | B2 | Workshop surface inspector workflow | Workshop export |
| 7 | B3 | Export grouping by physical surface | Workshop export |
| 8 | B4 | Standalone/Codex import compatibility | Workshop export |
| 9 | C1 | Native vision/artwork configuration proven on fixtures | [Visibility and artwork](2026-09-22-surface-geometry-visibility.md) |
| 10 | C2 | Managed visibility reconciliation and explicit adoption | Visibility and artwork |
| 11 | C3 | Separately exported deck artwork | Visibility and artwork |
| 12 | C4 | Cross-repository acceptance and user player checklist | Visibility and artwork |

A1–A4 can be exercised using manually authored Testing Scene geometry. B1–B4 produce round-trippable authoring/export without requiring a replacement renderer. C1 must prove native configuration before C2/C3 ship; a documented native limitation triggers a design revision, not an improvised visibility engine.

## Normal checks

Record baseline commands/results before executable changes. Do not attribute pre-existing failures to a slice, suppress them, or claim a clean gate while required checks fail.

**Codex**, `/Users/peterg/code/codex-bridge`:
```sh
npm test -- --maxWorkers=2
npm run typecheck:runtime
npm run lint
npm run build
git -c core.fsmonitor=false diff --check
```
Current evidence:764 tests/83 files pass; lint has one existing unused `clearance` warning. Re-run relevant baselines at execution start. Run the repository's full `npm run verify` at final acceptance and record any pre-existing non-runtime failure explicitly.

**Workshop**, `/Users/peterg/code/codex-dungeon/map-workshop`:
```sh
npm test
git -c core.fsmonitor=false diff --check
```
Run focused Node tests first for each task. Verify DOM authoring through the local workshop browser, not only pure helpers.

## Completion and review

- [ ] Review every changed line personally against the starting working tree; do not stage unrelated work.
- [ ] All tasks below are checked and their normal checks/evidence are recorded.
- [ ] Native GM verification and the user's player-side visibility result are distinguished. Do not claim player acceptance from GM omniscience.
- [ ] Testing Scene fixtures/settings/chat are restored; campaign content is untouched.
- [ ] Update `README.md`, `CHANGELOG.md`, `docs/testing/regions-movement.md`, and Workshop/importer README with migration and configuration instructions.
- [ ] Report any user-owned player verification still pending and any native limitations precisely.
