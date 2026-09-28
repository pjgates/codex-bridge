# Movement hazard overlay — 2026-09-28

Deployed to Silverhold with user approval; verified in native Foundry **Testing Scene**.

## Behavior

For exactly one selected token, show nearby terrain cells during drag previews or movement animation, or while **Preview Movement** is held. The existing configurable `previewMovement` binding is retained. Releasing the key, Escape, loss of window focus, cancellation, deselection and canvas teardown clear idle previews.

Native square and hex grids use their own cell centers and vertices. Gridless scenes use scene-aligned hexes at the scene grid scale. Coverage is a full land Speed plus two grid spaces, with a minimum of four spaces; it is independent of the remaining-movement ring. The default style is a colored center **+**, with white for ordinary Walk/Fly. **Movement → Movement cell style** offers cell outlines as an alternative, with the existing two-screen-pixel inset. Both styles are unfilled. The selected token's actual and preview occupied cells are omitted (the centre hex on gridless maps). Hover any inspected cell for its direct-approach summary; hit areas and visibility checks retain the whole original cell. No persistent legend is shown.

Amber means Climb, blue Swim, red a known Fall, purple **Landing unknown**, and orange **GM ruling needed**. The shared movement evaluator supplies these statuses, including unchecked exploration modes, authored faces and active flight. Colors and native wall checks stay anchored to the starting position, elevation and level throughout a drag, checkpoints and movement animation. Coverage follows the preview position; selected movement actions remain live. After movement finishes or cancels, a held preview uses the token's current position. Native movement constraints exclude blocked direct approaches before terrain classification; hovering those cells shows **Blocked**. Movement cost is ignored so inspection still extends beyond the remaining budget. The overlay performs no document writes or rule resolution. Scenes without authored floor/water data retain ordinary movement.

Cells use the best available route from the frozen origin, preferring a walking route before Climb or Swim. A shared search uses the same surface-step evaluator, native movement costs and native walls as routing, without a remaining-movement limit. It publishes settled cells while searching and is reused when the cursor or style changes. Hover distinguishes **Best route** from the **Direct approach** fallback used while a cell has no safe route result. That fallback retains Fall, Landing unknown and GM ruling hazards beyond the reachable area. Cells outside the player's known area are excluded and graphics use the native vision mask.

## Local verification

- Baseline: 120 existing movement/overlay tests passed before implementation.
- New classification and rendering/lifecycle regressions failed before implementation and passed afterward.
- Final full suite: **870 tests / 112 files pass**. All three typechecks and the Foundry production build pass. Lint retains only the existing unused `clearance` warning.
- Aggregate `npm run verify` stops at the unrelated dashboard artifact-copy hook's sandbox-denied Obsidian vault write. Dashboard compilation passes with that copy hook excluded.
- Browser fixture exercised the production overlay with real Pixi 7.4.3 and simulated Foundry documents, hooks and grid APIs. Verified square/hex shapes, all hazard colors, Landing unknown hover text, active-flight removal, and drag cleanup; no browser warnings/errors. This is rendering evidence, not native Foundry acceptance.
- Read-only deployment dry run identifies `dist/module.js`, `dist/module.js.map`, and `dist/lang/en.json` only.

## Deployment and native verification

- Backed up the installed bundle and language file to `/home/ubuntu/codex-test-backups/movement-hazards-20260928-m1asct/module-before.tgz`, then deployed only the three files above. Remote checksums match the tested build.
- Native runtime: Foundry **14.368**, SF2e **1.5.1**. Created an isolated temporary level, four regions and an unlinked Bob token exclusively in **Testing Scene**.
- Native hex, square and gridless overlays showed all five hazard colors: Climb, Swim, Fall, Landing unknown and GM ruling. The native hex overlay contained 169 tinted cells; square 147; gridless 164.
- Invoked the registered Movement Preview key callbacks: release and deselection removed the overlay. Active flight retained the legend with zero tinted cells.
- Dragged the token through the native canvas: five sampled drag frames contained 168 tinted cells, the hover summary showed Walk, and the overlay was absent after movement finished.
- Restored the original grid, removed every temporary token/region/level and the QA macro, removed the temporary server screenshot, and restored the original scene view. The native cleanup report confirmed no QA document IDs remain and the grid/view match their original state.
- At initial verification, the client had no key assigned to `previewMovement`; choose **Preview Movement** in Controls to use the held-key shortcut. Native drag preview requires no shortcut.
- A separate player client was unavailable. Player visibility filtering and masking are covered locally, but live player-client acceptance remains unverified. Existing Named Encounters and libWrapper errors/warnings were present; no movement-overlay runtime errors appeared.

The initial native screenshot is saved with this task's local QA artifacts as `native-overlay.png`.

## Outline correction — 2026-09-28

The initial terrain-only preview painted cells across walls, making blocked rock look enterable. A read-only scene replay reproduced 51 unknown approaches near Tessa, 44 crossing a wall. The user confirmed actual movement was blocked and requested white ordinary borders, colored hazard borders and no fills.

The renderer now uses native `constrainMovementPath` with preview visibility and wall checks enabled, and movement cost ignored. Blocked cells retain hover explanations but have no outline. Native constraints receive the live preview level, elevation, shape and action. Orange distinguishes GM rulings from ordinary white borders.

- Wall regression failed before the fix; square/hex outline assertions failed before the style change. Final full suite: **871 tests / 112 files pass**; all typechecks, lint and Foundry build pass (existing lint warning unchanged).
- Deployed only the bundle, sourcemap and English language file; backup: `/home/ubuntu/codex-test-backups/movement-outlines-20260928/module-before.tgz`. Remote hashes match the local build.
- Native Testing Scene checks on hex, square and gridless grids: all six border colors present, zero filled shapes, an actual native wall rejects the target, and that target has no outline. Native refresh measurements were 21–30 ms in this fixture.
- Read-only current-map preview on Tessa: 80 outlined cells, zero fills, 63 ms refresh. Screenshot: `movement-outlines-native.png` in this task's artifact directory. No campaign token, actor, wall or region documents were changed.
- Removed all disposable levels, regions, tokens, walls, the QA macro and server screenshot; restored Testing Scene grid and the original view/selection. Live player-client acceptance remains unverified.

### Border inset

The user requested a 2 px inset to separate adjacent borders. Existing square/hex rendering tests failed before the change and passed at zoom 1 and 0.5 afterward. All 871 tests, typechecks and build pass. Native current-map measurements confirmed exactly 2 screen pixels at both zooms and zero fills; token positions stayed unchanged. The temporary macro and server capture were removed, and view/selection restored. Screenshot: `movement-inset-native.png` (detail: `movement-inset-detail.png`). Deployment backup: `/home/ubuntu/codex-test-backups/movement-inset-20260928/module-before.tgz`.

### Token highlight line style

Movement cells now use Foundry's native `canvas.borders.drawBorder`, matching the token highlight's opaque colored stroke, black backing and rounded joins. The inset accounts for the outer stroke width, keeping its visible edge two screen pixels inside the cell. Hazard colors and unfilled cells are retained.

The rendering regression failed before implementation; all **871 tests**, typechecks and the production build pass afterward. Native current-map checks at zoom 0.5 and 1 confirmed matching token/overlay widths (4 px black backing, 2 px color at the current UI scale), opacity and joins, 80 cells, zero fills and exactly 2 px outer-edge inset. Token positions stayed unchanged; the temporary QA macro and server capture were removed, and view/selection restored. Screenshot: `movement-token-style-native.png` (detail: `movement-token-style-detail.png`). Deployment backup: `/home/ubuntu/codex-test-backups/movement-token-style-20260928/module-before.tgz`.

### Occupied cells and hover-only labels

Removed the persistent legend and its language entry. Native occupied cells are excluded using `TokenDocument.getOccupiedGridSpaceOffsets` at the preview position, including larger token footprints. Gridless previews omit the hex under the token's centre. Excluded cells have no overlay hover status.

The existing square, hex and gridless rendering regressions failed before the change and pass afterward; all **871 tests**, typechecks and the production build pass. Native current-map checks excluded all six occupied cells for Shellbarrager and Tessa's one occupied cell, with zero fills. Neither token showed a tooltip over its occupied cell; both showed **Direct approach: Walk** over a nearby cell. No legend remained. Token positions stayed unchanged; the temporary macro and server capture were removed, and view/selection restored. Screenshot: `movement-hover-only-native.png` (detail: `movement-hover-only-detail.png`). Deployment backup: `/home/ubuntu/codex-test-backups/movement-hover-only-20260928/module-before.tgz`.

Terrain-aware square/hex routing was subsequently added; see [grid routing verification](grid-routing.md).

### Center markers and fixed starting position

The client preference defaults to **Center + markers**. Each marker has 12-screen-pixel strokes with a 4 px black backing and 2 px colored foreground, constant while zooming. Cell outlines remain available and switch immediately. Starting geometry is captured once per preview and retained through explicit checkpoints and animation; classification no longer moves with the cursor. Actual and preview footprints are both excluded.

- Default-style and origin regressions failed before their changes, then passed. Full suite: **889 tests / 113 files pass**; all three typechecks and build pass. Lint retains the existing `clearance` warning.
- Local square, hex and gridless checks cover centered markers, color preservation, zero fills, whole-cell hover, hidden and blocked filtering, zoom, style switching and origin reset after movement.
- Native current-map checks: 79 markers, zero fills, 12 px strokes across both zoom 1 and 0.5, and 4/2 px widths. Switching to outlines produced 79 unfilled polygons.
- Native ruler previews changed position and elevation, then added a checkpoint: all **75 common cells** retained their original colors. No actual/preview occupied cell had a marker; ending the preview restored the original set.
- Deployed bundle and sourcemap after explicit approval; remote checksums match. Backup before this request: `/home/ubuntu/codex-test-backups/plus-markers-20260928/module-before.tgz`.
- Campaign token positions remained unchanged; selection and view were restored. Temporary macro and server screenshot removed. Local screenshot: `movement-plus-origin-native.png` in this task's artifact directory. Separate live player-client checks remain unavailable.

### Route-aware bridge colors

The user's bridge report exposed a mismatch: four visible cell centers inside the authored **Bridge** region were red because their straight-line approach crossed a gap. Read-only native pathfinding returned walking routes to the two sampled bridge destinations, at elevation 5 ft. The renderer now consumes the shared route-status search rather than coloring every cell only by that shortcut. Unreachable hazards retain their direct-approach explanation; this preserves nearby Fall and Landing unknown inspection beyond the movement budget.

- Square/hex finite-deck regressions reproduced a direct Fall with a safe walking detour; the shared field returns Walk. Gridless rendering verifies that asynchronous route results update the marker and whole-cell hover, and cancellation prevents stale results reappearing.
- The first native field waited for exhaustive search completion and left the bridge red for over 18 seconds. Settled cells now publish every 100 ms while the search continues, and route geometry is cached across cursor, waypoint and style changes.
- Final suite: **892 tests / 113 files pass**. Typechecks and build pass; lint retains only the existing unused `clearance` warning.
- Native acceptance: all **seven visible authored Bridge cell centers** became white, including the four formerly red cells, in **2.801 s** from a fresh preview. No fills in either style. All **75 common cells** kept their colors after a preview position/elevation change.
- Screenshot: `movement-bridge-routes-native.png` in this task's artifact directory. No campaign token positions changed. The preview, view and selection were restored, and the disposable macro and server capture were removed.
- Remote bundle checksum matches the tested final build. The same pre-request backup recorded above is retained.

Current tested bundle SHA-256: `afbef98c57a42e7a7f6f262cefd182b0be0b15154028362483a1e2a7136cb5c2`.
English language SHA-256: `77390ed7c58c1ad7e059005ee343ae386bcef68250225e266307f60e97ffd5c8`.

The field was subsequently bounded and optimized. See [performance verification](movement-performance.md)
for the current bundle, exact timing conditions and the remaining cold-build limitation.
