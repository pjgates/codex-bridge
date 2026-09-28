# Terrain-aware grid routing — 2026-09-28

Codex owns pathfinding on native square and hex grids. It uses native neighbors,
movement origins, terrain costs, diagonal accounting, movement history and wall
constraints. Each step uses the same transition evaluator as movement execution.
Wayfinder is not required and cannot replace the selected terrain-aware route.

- Prefer any safe walking route over a route requiring Climb or Swim.
- Use Climb/Swim when no walking route exists, or honor the selected movement mode.
- Avoid Fall, Landing unknown, blocked cells and GM rulings automatically.
- Carry climb landing elevation/level through later checkpoints. Execution retains
  the existing terrain checks and pauses; planning does not approve their outcomes.
- Preserve explicit waypoints and precise movement within a cell.
- Exclude unknown cells for players with token vision. Search yields cooperatively
  and cancels superseded results.
- The client **Pathfinding** toolbar toggle defaults on. Turn it off for deliberate
  direct movement into hazards; native collision constraints still apply.
- A quick release waits for the native ruler's asynchronous route presentation.
  Escape, destroyed previews and cancelled drags prevent the deferred drop.

## Verification

Baseline movement tests passed before implementation. New route and toolbar tests
failed before implementation; additional checkpoint, precise-position and quick
release regressions failed before their fixes. Final suite: **885 tests / 113 files
pass**. All three typechecks and the Foundry production build pass. Lint has only
the existing unused `clearance` warning. Aggregate `npm run verify` reaches the
unrelated dashboard artifact-copy hook, which cannot write to the Obsidian vault
under the workspace sandbox.

Native runtime: Foundry **14.368**, SF2e **1.5.1**, Wayfinder disabled. Disposable
Testing Scene fixtures verified square/hex walking detours, explicitly selected
Swim, cross-level Climb to elevation 20, fall avoidance, direct movement with the
toggle off, and native wall detours. An isolated water barrier spanning the scene
verified required Swim on both grids. Ordinary hex detours took 81–88 ms in this
fixture; proving no dry route existed before swimming took 1.57–2.95 s in the open
scene. Searches remain cancellable during that wait.

The original quick-drag probe left the token at its origin. After the release fix,
the same native canvas gesture reached `(1700, 1126)` from `(1300, 1134)`; all five
executed waypoints were Walk and followed the dry detour. The renderer capture
`grid-pathfinding-native.png` in this task's artifact directory shows that route
and the existing unfilled hazard borders.

Cleanup confirmed no temporary token, wall, region or level IDs remain. The QA
macro, eleven test movement messages and temporary server capture were removed.
Testing Scene's original grid and remembered view were restored, along with the
campaign view/selection. Campaign token positions remained unchanged.

A separate live player client was unavailable; live player visibility remains
unverified. The unit tests use real terrain classification with native API fakes;
native tests exercise the installed token, grid, region and constraint APIs.

## Deployment

Only `dist/module.js`, its sourcemap and `dist/lang/en.json` were deployed. Backup:
`/home/ubuntu/codex-test-backups/grid-pathfinding-20260928/module-before.tgz`.
Remote checksums match the tested build:

- Bundle SHA-256: `5b6dd12b4c70472ed522bb4c5de566681681ce96711202d80bc05e327c41b9c5`
- English SHA-256: `d14ae51556c587837a439f89b6d6189cee492ce39527bad557c2463b573bdd9f`

## Grid distance display correction

The ruler now displays native grid-step distance on square and hex grids. A
default `TokenDocument.measureMovementPath` cost supplies the grid distance with
no terrain or action multipliers; its fractional `distance` describes the drawn
line and is retained only for gridless displays. Full waypoint history preserves
the scene's square diagonal rules. Mixed mode segments use the same grid baseline,
and additional terrain costs are calculated separately against that baseline.

The two new regressions failed before the fix. **887 tests / 113 files pass**, all
typechecks and the production build pass, and the existing lint warning is unchanged.
Native checks used in-memory Scene/Token documents and the installed ruler/template:

| Route | Fractional line length | Displayed grid distance |
| --- | --- | --- |
| One hex, endpoint inside the neighboring cell | 4.5 ft | 5 ft |
| One square, endpoint inside the neighboring cell | 4.5 ft | 5 ft |
| Two square diagonals, including a passed waypoint | 14.85 ft | 15 ft; second diagonal +10 ft |
| Walk then Swim through two hexes | — | 5 ft + 5 ft |

Campaign token positions remained unchanged. No scene, token, region or wall
documents were saved for these checks. The disposable QA macro and server capture
were removed. Screenshot: `grid-distance-native.png` in this task's artifact directory.

Deployed only the bundle and sourcemap. Backup:
`/home/ubuntu/codex-test-backups/grid-distance-20260928/module-before.tgz`.
Grid-distance bundle SHA-256 at this check: `3afd8825e6de17e13d8d497959e9bc8cb67eb37cf1ac271790aaf8726e842a72`.
English SHA-256 is unchanged. Remote bundle checksum matches the tested build.

The overlay subsequently gained center + markers, a frozen starting position and shared route-status coloring. See [movement overlay verification](movement-hazards.md) for the current bundle hash and native bridge checks.
