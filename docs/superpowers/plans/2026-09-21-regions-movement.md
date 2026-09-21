# Regions and Movement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execution method awaits user selection.

**Goal:** Consolidate compatible region data and resolve elevation movement, checks and falls inside Codex Foundry.
**Architecture:** One installable Codex Foundry module contains three internal components. Map Workshop Importer optionally imports using its types; a shared surface query feeds one movement transition owner.
**Tech Stack:** Foundry v14; PF2e/SF2e; TypeScript/ESM, Vite, Vitest; JavaScript/Node tests for the importer.
**Spec:** [Approved design and component specs](../specs/2026-09-21-regions-movement/README.md).

## Global Constraints

- Use `codex-foundry.setElevation` / `.water` for Codex-owned behaviours, preserving visible names and data through a migration of existing scenes.
- Default the configurable modifier to **F**, show “Forced” in the preview, and clarify the effect when a dangerous destination requires it.
- Pause at consequential transitions, offer applicable checks/reactions, then apply the resolved movement, damage and conditions.
- When no landing surface is mapped, pause for a GM ruling; a level base is not proof of ground.
- Adapt useful approaches from Terrain Mapper and Region Behaviour Adjustments without requiring either module.
- Follow the [configuration supplement](../specs/2026-09-21-regions-movement/CONFIGURATION.md): separate feature switches, shared advisory/application mode, opt-in consequences, and independently configurable utilities with preserved upgrade state.
- Each slice has one concern, targets about 200 changed executable/test lines, and must split before exceeding 400; no new generic plugin framework or catch-all context object.
- Preserve pre-existing changes in both checkouts. Record starting diffs; stage only owned changes if commits are later requested. The workshop parent AGENTS.md prohibits unsolicited commits.
- No live campaign migration or deployment during implementation verification; use disposable test worlds/scenes.

## Review Focus

1. Legacy and new behaviours coexist or are disabled: preserve scene data and count each floor once (slices 2–4).
2. Narrow holes, overlapping levels and large tokens: first support loss must agree with the preview (slices 5–6, 17).
3. Another client moves a token while a decision is open: reject stale outcomes and release pending movement safely (slice 7).
4. Reaction success, cancellation or damage fully absorbed by temporary HP: preserve reaction semantics and apply Prone from actual damage, not just an HP comparison (slices 10–11).
5. F released before async continuation, a hidden browser tab or zero-distance Fly: retain submitted intent and avoid false flight failure (slices 12, 16).

## Ordered slices and dependencies

Each numbered item is a separately reviewable PR-sized slice; the leaf plans contain its TDD steps. Execute sequentially, completing all slices after plan approval. Progress is tracked in [tasks/todo.md](../../../tasks/todo.md).

Before slice 1, execute the three [settings slices](2026-09-21-regions-settings.md): **S1** native form organization → **S2** utility separation with migration → **S3** movement controls and preference migration. These cross-cutting controls do not create another installable module. Every subsequent movement slice wires and tests its own off/advisory/apply behaviour.

1. Register Codex floor/water behaviours — [definitions](2026-09-21-regions-definitions.md); no dependency.
2. Read both behaviour namespaces — definitions; depends on 1.
3. Select the provider during import — definitions; depends on 2.
4. Preview and migrate legacy scene behaviours — definitions; depends on 3.
5. Return supporting surface identity across levels — [surfaces](2026-09-21-regions-surfaces.md); depends on 2.
6. Trace every crossed support boundary — surfaces; depends on 5.
7. Stop at transitions (7a), then add recoverable GM decisions (7b) — [movement](2026-09-21-regions-rules.md); 7a depends on 6, 7b depends on 7a. These are two separate PR-sized slices.
8. Edit terrain DCs on regions — movement; depends on 7.
9. Resolve climbing before progress — movement; depends on 8.
10. Resolve ordinary falls through the system — movement; depends on 7.
11. Offer and resolve fall reactions — movement; depends on 8, 10.
12. Mark forced drags with F — movement; depends on 11.
13. Expose forced movement to macros — movement; depends on 12.
14. Route flight loss through the shared fall flow — movement; depends on 11.
15. Resolve water and conditional fall mitigation — movement; depends on 14.
16. Resolve uncertain flight upkeep at turn end — movement; depends on 14.
17. Align previews and movement costs with resolved transitions — movement; depends on 9, 12, 15, 16.

## File boundaries and integration contracts

`src/canvas/regions/` owns definitions, migration, geometry and region configuration; it has no PF2e imports. `src/rulesets/sf2e/movement/` owns transition handling, decisions and action/damage adapters. Existing `gridless/` owns route search/labels; `flying/` retains the flight effect, pure fall-profile calculations and reminders. Cross-feature imports use `index.ts`; movement may consume flying exports, while ready-hook orchestration passes a fall-request callback into flight activation so flying never imports movement.

Paths in leaf plans are relative to `/Users/peterg/code/codex-bridge`; `W/` means `/Users/peterg/code/codex-dungeon/map-workshop/`. Each new test file uses Vitest unless prefixed `W/`.

Preserve the existing movement-origin point convention for support: call `token.getMovementOrigin(waypoint)` using its width/height/shape. A token's art overhang does not change this rule. Trace polygon-edge intersection parameters and test interval interiors with the region's polygon tree; do not use fixed pixel samples to skip short holes. Native collision still handles the full token footprint. This makes the spec's initial point convention explicit and testable.

`Support = { regionId: string; elevation: number; levelIds: readonly string[] }`. `selectSupport(candidates: readonly Support[], elevation: number, currentLevel: string): {kind: "surface"; support: Support; level: string} | {kind: "none"} | {kind: "ambiguous"; candidates: readonly Support[]}`. Resolve from region membership; if membership does not identify one level, use current membership when valid, otherwise a GM ruling.

`MovementIntent = {kind: "voluntary"} | {kind: "forced"; danger: "unknown" | "allowed" | "forbidden"} | {kind: "placement"}`. `TransitionRef = {tokenUuid: string; movementId: string; checkpoint: number}`. A resolution always refers to this identity, never a global “current token”.

## Verification and delivery checkpoints

Before executable edits: rerun `npm test -- tests/node/flying tests/node/gridless` in Codex and `node --test foundry-module/*.test.mjs` in W; record failures without changing unrelated code. Previous focused baseline: 43 Codex tests and 15 importer tests passed.

Locate an existing disposable Foundry v14 test world and record its core/system versions before slice 1. The previous turn inspected cached Foundry source and a local system checkout, which do not establish the installed test runtime's versions. If only a live campaign is available, finish local verification and request a test-world location before any external mutations.

Each slice: red test → minimal implementation → focused green tests → `npm run typecheck:runtime && npm run lint && npm run build` for Codex edits; run the importer command above for W edits. Run its manual Foundry scenario. Keep documentation changes with the owning slice. If a slice grows past the size ceiling, split its executable delivery without dropping acceptance criteria.

Checkpoints after 4, 7, 11, 17: run `npm run verify` and importer tests; after 7 verify GM/player pause/resume in a disposable Foundry v14 world before adding automated consequences. Final checkpoint includes PF2e and SF2e, square/hex/gridless, custom rules off, modules individually/both, legacy archive import, cancellation, and cross-level 20 ft fall evidence. Record browser console errors and screenshots with results in `docs/testing/regions-movement.md`.

## Approval and execution

Plan status: approved, including configurable features and settings cleanup. Execute natively in the current checkouts, one slice at a time, followed by one independent GPT-6 Astra review. The user authorized committing and pushing existing changes before implementation and supplied https://foundry.silverholdstudios.com/game for runtime testing; user login is pending.
