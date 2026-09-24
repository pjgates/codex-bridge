# Tile region inclusion and exclusion masks

## Behaviour

Tile Appearance has two native multi-select fields: Show inside regions (`clipRegions`) and Hide inside regions (`excludeRegions`), under `codex-foundry` flags. Any inclusion admits artwork; any exclusion removes it. Empty inclusions mean the whole tile. Old `clipRegion` data is used until an explicit inclusion array is saved. Clearing both lists removes the mask.

Foundry's native Clipper engine unions and subtracts polygons before rendering a stencil, preserving holes and avoiding overlap cancellation. The runtime uses Foundry's engine; `clipper-lib` is a development-only test dependency. Covered-token outline coverage applies the same inclusion/exclusion predicate. This does not alter native vision, movement or occlusion.

## Local verification

- 802 tests passed, including polygon union/subtraction, overlapping exclusions, holes, complete removal, legacy selection precedence, outline coverage policy, and selector contents.
- Runtime TypeScript check passed.
- Lint: no errors; existing unused `clearance` warning in gridless/routing.ts.
- Production build passed.
- Logs: `/private/tmp/masks-final-tests.log`, `/private/tmp/masks-lint.log`.

## Deployment and live verification — 2026-09-24

Installed module backed up to `/home/ubuntu/codex-test-backups/tile-masks-20260924/module-before.tgz`, then built dist uploaded to the existing module installation.

GM-side verification passed in Testing Scene on Foundry 14.368 / SF2e:

- Two inclusions and two overlapping exclusions displayed correctly in the native multi-select fields; normal Update Tile submission preserved all four selections.
- Removing both inclusion tags saved an empty array. Exclusion-only masking rendered correctly on a tile rotated 30 degrees.
- Removing both exclusion tags saved both lists empty and removed the stencil.
- Editing the second inclusion into a separated strip rebuilt the mask immediately: sampled points inside the first area, gap, and strip were true / false / true.
- A region present in both lists fully hid the tile; the rendered stencil was empty.
- Reload restored combined masking (inside / inside / cut-out: true / true / false) and the legacy single-region mask (inside / outside: true / false).
- Visual screenshots confirmed the merged rectangular cut-out, transformed artwork, and fully excluded tile. Initial fixture placement used top-left coordinates incorrectly; Foundry v14 tile position is anchor-based. Correcting the fixture centre resolved this, without product code changes.

Proof values are retained on the existing GM probe macro under `codex-foundry.maskProof`. Two temporary tiles, four regions and one level were removed after testing; campaign view restored. No campaign scene documents or chat messages were changed. Covered-token mask coverage has automated predicate coverage; no additional player-side outline test was performed in this pass.
