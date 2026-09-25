# Generic Sensory Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user approved Native execution on 2026-09-25. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure shared sensory Effects in Foundry that selectively reveal signals across floors and play ambient sounds only through selected, owned tokens.

**Architecture:** A single `src/canvas/sensory/` feature resolves world Effect definitions and individual ranks, builds scene-wide signal geometry, and renders a private overlay. Tagged audio is separated before native file-path aggregation, uses native elevated sound-source calculations, and has a per-voice output gate that stays closed during revoked or stale playback work.

**Tech Stack:** Foundry v14; PF2e; TypeScript/ESM, Vite, Vitest, happy-dom, native PIXI and Web Audio. No new dependencies.

**Spec:** [Approved sensory-effects design](../specs/2026-09-25-sensory-effects-design.md).

## Global Constraints

- All campaign-specific meaning is configured in an ordinary PF2e Effect item in Foundry.
- A player contributes a viewpoint only through a selected token whose actor they own. There is no assigned-character or unselected-owned-token fallback.
- When several owned tokens are selected, combine their eligible senses. Evaluate each token's capabilities, position, and range independently.
- Tiles choose the same world Effect item and have their own rank.
- Existing applications follow edits to the world Effect's sensory settings. An actor's effect counter or a tile's rank remains individual.
- Cross-floor perception is required. Read emitters across all levels of the current scene, including levels that are not rendered, and include vertical separation in range.
- GM-hidden token and tile documents remain excluded from player-visible glows.
- Each slice has one concern, targets roughly 200 changed code/test lines, and splits before exceeding 400. Tests accompany the owning behaviour.
- Keep configuration and activation independent of `enableCustomRules`. Do not change native sight, fog exploration, level navigation, targeting, conditions, movement, or untagged audio.
- Any delegated implementer or reviewer, including descendants, must use GPT-6 Astra (`gpt-6-astra`) explicitly. Do not dispatch until the plan and execution method are approved.
- Review every changed line personally. No push, PR, deployment, or mutation of live campaign scenes is implied by implementation approval.

## Review Focus

1. A private and an ordinary source use the same audio file, including tagging an already-playing source or changing its path: isolate private output without silencing or activating ordinary playback (tasks 8 and 10).
2. Selection or ownership changes while audio is loading or starting: the private output gate closes immediately and an obsolete request cannot reopen it (task 9).
3. A definition is deleted or its flag becomes malformed while applications remain: copied settings never revive it and tagged audio never becomes ordinary audio (tasks 1 and 10).
4. An emitter has no rendered object on another floor: use stored document geometry, absolute elevation, and the qualifying viewer's range (task 5).
5. An Effect sheet is rendered repeatedly or edited on an actor rather than as a world item: avoid duplicate controls, retain independent ranks, and edit the canonical definition only with permission (task 3).

## Evidence and preflight

The current branch is `peterg-sensory-effects`. At the start of planning only the design was committed; existing movement plans remain separate. There is no `docs/solutions/` store in this checkout. Preserve the existing `tasks/todo.md`, which belongs to the movement initiative.

Observed baseline on 2026-09-25: `npm test -- tests/node/flying tests/node/clip-tiles` passed 22 tests in four files. Rerun it before executable edits; this is baseline evidence, not feature verification.

The Foundry server's public client bundle was read, without logging in or changing the world:

- URL: `https://foundry.silverholdstudios.com/scripts/foundry.mjs`.
- Local inspection copy: `/private/tmp/codex-sensory-foundry-reference.mjs`.
- SHA-256: `c90618840274e7db98564eac9e96778b1acc6f62aef3a59a460e6c8708393829`.
- `SoundsLayer._syncPositions` groups sources by path before checking audibility. Merely overriding `isAudible` cannot isolate shared-file playback.
- `PointSoundSource.getVolumeMultiplier` accepts elevated listeners and handles native shape/range attenuation. `_configurePlayback` applies native wall/surface muffling.
- Ambient sounds and sound sources normally acquire singleton Sound objects. A private voice needs its own Sound and output gate.
- `PointSoundSource.sync` can await loading; stopping a request is insufficient proof that obsolete work cannot become audible later. The output gate supplies that guarantee.
- Token documents provide `getCenterPoint()` and `getListenerPosition()`. Tile documents provide prepared `shape.center` and `shape.polygonTree`, without requiring a placeable.

Do not vendor the bundle or copy native method bodies into this public repository. Use the APIs and narrow wrappers below. Record actual core/system versions and confirm these interfaces in a disposable test world before the runtime adapter tasks. Reading the bundle did not establish a logged-in test session or the precise installed release.

## File boundaries and shared contracts

All paths below are relative to `/Users/peterg/code/codex-bridge`. `S/` means `src/canvas/sensory/`; `T/` means `tests/node/sensory/`. Cross-feature imports go through `index.ts`. The renderer may consume clipping geometry through an added export in `src/canvas/clip-tiles/index.ts`; it must not import that feature's private files.

| File | Responsibility |
|---|---|
| `S/types.ts`, `S/definition.ts` | Persistent flag schema, validation, ranks, canonical world definitions |
| `S/observers.ts` | Selected actor owners and eligible applications |
| `S/effect-config.ts`, `S/tile-config.ts`, `S/sound-config.ts` | Native sheet augmentation and reference controls |
| `S/geometry.ts`, `S/frame.ts` | Stored token/tile geometry, strongest emissions, 3D detection and cues |
| `S/glow.ts` | Private PIXI markers and cleanup |
| `S/audio-guard.ts` | Native source partition and shared-node transition handling |
| `S/audio-voice.ts` | Independent Sound, output gate, load/revoke lifecycle |
| `S/audio.ts` | Native sound-source geometry, eligible spatial playback and voice reconciliation |
| `S/lifecycle.ts`, `S/index.ts`, `S/lang/en.json` | Feature registration, event refreshes, barrel exports, UI text |
| `T/fixtures.ts` | Independently authored document fixtures shared by contract tests |
| `docs/testing/sensory-effects.md` | Runtime versions, scenarios, screenshots and audio observations |

Declare these types once in task 1; later tasks consume them rather than inventing parallel shapes:

```ts
interface SensoryDefinition {
    channel: string;
    emission: { enabled: boolean; strength: "rank" | "fixed"; fixed: number; colour: string };
    glow: { enabled: boolean; minRank: number; range: number; walls: boolean };
    hearing: { enabled: boolean; minRank: number };
}
interface SensoryApplication { definitionUuid: string; rank: number; definition: SensoryDefinition }
interface SensoryPosition { x: number; y: number; elevation: number; levelId: string }
interface SensoryRing { points: readonly { x: number; y: number }[]; hole: boolean }
interface SensoryObserver {
    tokenUuid: string; position: SensoryPosition; listener: SensoryPosition;
    applications: readonly SensoryApplication[];
}
interface SensoryEmitter {
    documentUuid: string; channel: string; position: SensoryPosition;
    strength: number; colour: string; rings: readonly SensoryRing[];
}
interface SensoryGlow {
    emitter: SensoryEmitter; viewerUuid: string; direction: -1 | 0 | 1;
}
type DefinitionLookup = (uuid: string) => SensoryDefinition | null;
```

These are feature-local types consumed by production configuration, frame and audio code. Define narrow `SensoryItem`, `SensoryTokenDocument`, `SensoryTileDocument`, `SensoryScene`, and `SensoryUser` interfaces beside their consuming adapters, using the real fields named in the leaf plans. Do not create a generic injected services container or exports solely for tests.

## Dependency-ordered slices

1. Shared definitions and application ranks — [definitions plan](2026-09-25-sensory-definitions.md), no dependency.
2. Selected owned viewpoints — definitions plan; depends on 1.
3. Effect editor and canonical copy provenance — definitions plan; depends on 1.
4. Tile Effect bindings — definitions plan; depends on 1 and 3.
5. Scene-wide emission and 3D detection — [visual plan](2026-09-25-sensory-visuals.md); depends on 1, 2 and 4.
6. Private glow rendering and event cleanup — visual plan; depends on 3–5.
7. Ambient Sound Effect picker — [audio plan](2026-09-25-sensory-audio.md); depends on 3.
8. Native audio exclusion and shared-file isolation — audio plan; depends on 7.
9. Private audio voice and cancellation — audio plan; depends on 8.
10. Native spatial playback and refresh integration — audio plan; depends on 2 and 7–9.
11. In-game workflow documentation and complete runtime acceptance — audio plan; depends on all prior slices.

Execute sequentially. Splitting an oversized slice preserves its contract and dependencies; it does not drop acceptance criteria. The three leaf plans are parts of one feature, not independent delivery options.

## Checks and checkpoints

For each executable slice: run its red test, implement minimally, then run its focused green tests, `npm run typecheck:runtime`, `npm run lint`, `npm run build`, and `git diff --check`. Commit only that slice's owned files, after personally reading the staged diff. Meaningful UI/runtime checks accompany the relevant slice; pure model slices do not require a browser demo of unused code.

After task 6, verify the native Effect-to-token/tile-to-glow workflow in Foundry. Before tasks 8–10, inspect actual source instances and audio routing in the disposable runtime. After task 10, verify owner and non-owner audio clients, same-file isolation, revocation while loading, and cross-floor sound geometry. After task 11 run `npm run verify` once; broaden checks earlier only for new failures or unresolved concerns.

Runtime access is not a substitute for local tests and local tests are not proof of real audio or fog behaviour. If a disposable Foundry environment is unavailable, finish independently verifiable local work and then request the missing test environment. Do not silently use the live campaign. Do not declare the feature complete until the approved runtime scenarios pass.

## Plan review and execution

Status: Native execution complete. All slices are implemented, tested and deployed; native configuration, canvas, audio and Unidentified acceptance passed in the authorized Foundry v14 / SF2e environment. See [the test record](../../testing/sensory-effects.md) for evidence, cleanup and the PF2e runtime / automated pointer-drag limits. The approved spec remains authoritative.

Recommend **Native**: one implementer keeps the closely coupled canvas/audio interfaces consistent, followed by one fresh GPT-6 Astra review of the complete branch. **Subagent-driven** instead uses a fresh GPT-6 Astra implementer and reviewer for each slice, followed by a final branch review. Both methods require the primary agent's own full diff review and all requested slices and verification before the final completion report.
