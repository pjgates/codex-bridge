# Movement preview performance — 2026-09-28

The route-status field is bounded by a planar native-grid radius of
`max(1.5 × Speed, 50 ft, 10 × scene cell distance)` around the frozen starting
cell. Walking detours outside this radius are deliberately excluded, as approved
by the user. The nearby hazard display still follows the preview; cells without a
safe bounded route retain their direct-approach status and manual movement policy.

Completed fields survive releasing the preview key. Crossing a starting-cell
boundary recalculates the field while reusing its exact polygon, terrain and wall
queries. Geometry, actor/item or actor association, movement rules/mode, footprint,
height/level, scene and
player-vision changes invalidate the relevant caches. GM vision refreshes do not
restart an unrestricted search. Cancellation still prevents stale publication.

## Native results

Foundry 14.368 / SF2e 1.5.1, **Mining Site - Depths**, Tessa Dax, Upper level.
The scene contains 24 regions and 13,282 polygon vertices. The initial field
settled 147 cells / 983 route states; the neighboring bridge origin settled 144
cells / 961 states. Each run waited for the complete field, rather than its first
partial paint. Neighboring origins were supplied through temporary ruler previews;
no campaign token documents were moved.

| Operation | Complete calculation | Including preview rendering |
| --- | ---: | ---: |
| Initial terrain build | 1,728.3 ms | 1,733.4 ms |
| Same-cell cached preview, five runs | No search | 11.6–12.7 ms |
| Neighboring-origin recalculation, three runs | 19.2–29.6 ms | 24.2–37.7 ms |

**The 50 ms target is met for the measured cached previews and neighboring-origin
recalculations. It is not met by the initial terrain build.** Entering previously
uncomputed terrain or invalidating scene/rules data can require new geometry and
collision work; the warm measurements are not a universal worst-case guarantee.
The search retains cooperative yields and publishes settled cells while building.

All seven visible authored Bridge centers remained Walk at Tessa's origin; six
remained visible at the neighboring origin because its occupied cell is excluded.
Every run had zero hazard fills and unchanged campaign token positions. Native
incremental hex costs matched complete native measurement on **800 prefixes**,
including **300 odd-diagonal carry cases**, using Walk, Climb, Swim and Fly. Square
grids retain complete native histories for diagonal accounting.

After the final actor/rules invalidation fixes, a smoke check on the user's then
selected **Bob** token in the Lower level verified actor UUID handling, zero
hazard fills, unchanged token positions and automatic removal of the QA macro.
Its complete-field hook did not arrive within the 10-second probe timeout. This
check does not establish a cold-performance result for Bob, and the Tessa bridge
numbers above must not be generalized to that lower-level case.

## Optimization ledger

| Attempt | Evidence | Outcome |
| --- | --- | --- |
| Exact boundary index and point memoization | Baseline: 1,447,155 native membership calls in 2.3 s; indexed probe: 296,253 in 5.1 s | Kept; exact narrow-gap and reverse-contact regressions pass |
| Reuse processed local terrain edges instead of rebuilding full histories | Exhaustive probe previously exceeded 15 s; complete field became 3.47 s | Kept; local terrain-preprocessing budget regression passes |
| Bounded field and completed-field cache | 399 cells became 145 in the original 3D radius; cached renders 11.8–14.3 ms | Kept; radius and cache/invalidation regressions pass |
| Flat walking shortcut | Flat fixture membership calls reduced from 106 to at most 60; native bounded cold probe 2.54 s → 2.39 s | Kept; both endpoints and exact boundary crossings are checked |
| Reuse indexed climb-face queries and terrain edges between origins | Fresh build 2.03 s; neighboring recalculations 226–247 ms | Kept; ownership, holes and slab obstruction remain checked |
| Restrict adjacency to horizontal offsets | Native 3D offsets had proposed 20 neighbors for a six-neighbor hex; fixture center-query budget 600 → 180 | Kept; terrain transitions still own height/level changes |
| First horizontal-neighbor experiment | Native radius mixed a 3D origin with 2D destinations; only one cell settled and bridge verification failed | Corrected before acceptance: measure the radius with two planar points; final coverage 147 cells |
| Preserve native hex diagonal carry with a zero-cost measurement prefix | Neighboring recalculations 148–174 ms → 19–30 ms; 800 native comparisons agree | Kept; edge costs are cached by incoming parity, square history is retained |

## Verification and deployment

New performance/radius/cache regressions failed before their corresponding fixes.
Final full suite: **902 tests / 113 files pass**. All three typechecks and the
production build pass; lint retains only the existing unused `clearance` warning.
Changes were personally reviewed, including native core measurement behavior.

Only the compiled bundle and sourcemap were deployed, under the user's explicit
deployment authorization. English content is unchanged. The existing pre-request
module backup is retained at
`/home/ubuntu/codex-test-backups/plus-markers-20260928/module-before.tgz`.

Bundle SHA-256: `a040b9b1196f295007990c24326907b9d0bd82dc26031daf603d646872f4209a`.
English SHA-256: `77390ed7c58c1ad7e059005ee343ae386bcef68250225e266307f60e97ffd5c8`.

The disposable QA macro and uploaded screenshot are removed after capture; the
original selection and view are restored. Screenshot: `movement-performance-native.png`
in this task's artifact directory. A separate live player client remains
unavailable. Local square, hex and gridless tests cover filtering and invalidation.
