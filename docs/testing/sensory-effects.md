# Sensory Effects verification

## Current status

Local implementation and automated checks are available on
`peterg-sensory-effects`. Native end-to-end acceptance is **pending**; this
record does not claim that player glows, audio, or persistence have passed.

## Environment observed on 2026-09-25

- Server: `https://foundry.silverholdstudios.com/game`.
- Core: Foundry v14 Stable, build 368.
- System: **SF2e 1.5.1**. The user authorized this server’s **Testing Scene**;
  these checks do not establish PF2e-specific runtime coverage.
- GM login and Testing Scene viewing succeeded. The active campaign scene was
  not changed. Existing campaign actors and sounds were not modified.
- A disposable `Codex sensory QA — temporary` macro was created. Native editor
  clipboard input and execution succeeded with an informational notification.
  It currently contains only that notification, not the feature bundle.
- Loading a localhost test module failed in the browser. No feature-loaded
  result or new sensory scene fixtures have been observed.
- Read-only SSH inspection confirmed the existing module installation at
  `/home/ubuntu/foundryuserdata/Data/modules/codex-foundry`.
  Deployment remains outside the previously approved implementation scope.

## Local evidence

- Baseline: 643 tests passed; focused Flying and tile-clipping tests: 22 passed.
- After review fixes, all typechecks, lint, the **671-test suite**, the Foundry
  build, and the dashboard build passed. The suite used
  `npm test -- --no-file-parallelism`, with every assertion and timing
  threshold unchanged.
- `npm run verify` was also executed. Parallel runs hit the existing 150 ms
  clearance benchmark at 281.7–304.9 ms; the unchanged isolated test and full
  serial suite passed. The initial dashboard build was blocked by its
  automatic vault copy; it subsequently passed through the normal permission
  mechanism. No movement test or implementation was changed for this feature.
- Lint retains one existing warning in `src/rulesets/sf2e/gridless/routing.ts`
  for unused `clearance`.
- New tests were observed failing before implementation. They cover shared
  definitions/ranks, selected ownership, native form controls and provenance,
  tile binding normalization, stored off-level geometry and 3D range, overlay
  cleanup, malformed private sound assignments, shared-file transitions,
  positive output and asynchronous revocation, eligible spatial listeners,
  and immediate output closure from registered selection callbacks.
- These tests mock external engine boundaries; they are not evidence of real
  fog, PIXI output, browser audio, native persistence, or multiple clients.

## Independent review and fixes

A fresh GPT-6 Astra reviewer inspected the branch and native source contracts.
The primary implementer also read every changed line. Each material finding
was reproduced by a failing regression, fixed, and included in the passing
671-test serial suite:

- Native PF2e world drops clone data without `addSource`. World serialization
  now captures the chosen definition UUID before cloning, including fresh,
  imported and duplicated world Effects; embedded copies retain their link.
- Tagging a playing source now reconciles ordinary sources without a fade
  tail and cancels a former node’s gain transition even when already stopping.
  Eligible ordinary same-file playback retains its manager.
- Removing an assignment while changing file now leaves acquisition to the
  native handler, preserving an ordinary singleton on the destination path.
- A tile’s clipped fill keeps its mask; its above/below cue remains visible
  even when the original center lies in a clipping hole.
- A related source-factory check preserves native silence when no file is set.

These fixes establish local regression coverage; native acceptance below is
still required. No reviewer findings were deferred.

## Native acceptance still required

Use disposable sensory artifacts in the authorized Testing Scene, with a GM,
an owner client, and a non-owner client. Record observed results, screenshots,
and positive audio/output-gate evidence rather than checking off these rows
from unit-test results.

| Scenario | Status |
|---|---|
| Save/reload a configured world Effect, then apply it natively | Pending |
| Shared edits retain independent application counters and tile ranks | Pending |
| Selected owner perceives; unselected owner and selected non-owner do not | Pending |
| Multiple owned selections combine independently eligible viewpoints | Pending |
| Above/below sources on unrendered floors, including directly overhead | Pending |
| Vertical/diagonal range, walls, clipped tile holes, hidden emitters | Pending |
| No fog, room/artwork, targeting, names/heights, or navigation revelation | Pending |
| Eligible positive audio; private/public same-file isolation | Pending |
| Native audio range, falloff, wall muffling, darkness and elevation | Pending |
| Deselect/revoke ownership during pending load/start closes output | Pending |
| Invalid/deleted definition, expiry, removal, path/assignment changes | Pending |
| Explicit GM sound preview; gameplay has no GM eligibility bypass | Pending |
| Level/scene changes, client reload, teardown, custom rules disabled | Pending |

## Prepared SSH sync

The read-only dry run uses the configured SSH host. It would update only
built module files under `dist/`, preserving the installed root manifest and
test surfaces. The dry run also found an older installed stylesheet and
waypoint template; deploying the current build therefore includes the
existing local movement updates as well as this feature. Back up the current
`dist/` before an authorized sync. Reload the client afterward; no Foundry
process restart is required for these static module files.

```sh
rsync -azn --itemize-changes --exclude module.json dist/ \
  foundry.silverholdstudios.com:/home/ubuntu/foundryuserdata/Data/modules/codex-foundry/dist/
```
