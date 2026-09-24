# Surface geometry and native visibility — 2026-09-22

Status: geometry, format changes, managed visibility and separate artwork implemented. Standalone importer server registration passed after the user-triggered restart. Runtime evidence below is GM-side SF2e on Foundry 14.368, exclusively in Testing Scene. Player verification is pending; PF2e runtime was waived by the user.

## Geometry evidence

- Native Surface Geometry creation, fractional thickness editing, Save/reopen and disable succeeded. Top20/underside18.75 persisted independently of sight/light choices.
- Unchecked solid ascent moved20ft. A thin deck's ascent paused for a ruling; descent paused for a20ft fall instead of inventing a wall.
- An actual movement-card Climb critical success moved Bob10ft up the20ft face and persisted the face region in Climbing. Shortening that face before the next attempt left Bob at the partial height and requested a ruling.
- A native movement origin includes body height. The planner now copies only its horizontal coordinates and preserves foot elevation; a regression covers the2.5ft offset observed in the runtime.

## Native configuration exercised

The explicit fixture is `tests/fixtures/surface-visibility.mjs`; it is not imported by production startup. It snapshots created IDs on the Testing Scene probe macro, uses isolated0–10/10–20ft levels, and includes lower terrain, a10ft deck, upper/lower targets, a hidden target and a blocking wall.

Both levels include each other. The physical owner region remains upper-only. A separate native plane has `levels:[]`, bottom/top10, with:

```js
{placement:'bottom', move:false, sight:opaque, light:opaque,
 sound:true, occlusion:true, exposure:false, culling:false}
```

The deck tile is at10ft and explicitly belongs to both fixture levels. Native tile membership does not inherit the token visibility list. Candidate occlusion was `modes:[CONST.OCCLUSION_MODES.SURFACE]` (value2), `alpha:0`.

With occlusion disabled, the shared upper artwork covered the lower terrain and Bob. Enabling the candidate exposed the green lower terrain. With the opaque restriction, the upper target was no longer visible from below; the lower target remained visible. The hidden target and target behind the wall remained invisible in the settled GM controlled-token view.

Native vertical ray queries at x1200/y1050 from2.5ft to12.5ft returned no sight/light collision for the grated surface and a10ft collision for the opaque surface. The open-edge ray at x1550 returned no collision. These are surface-intersection checks, not player-vision acceptance.

## Above-view finding and approved outline

With Bob above the grated deck and a visible target below it, the deck artwork disappeared. This is native behaviour: the GM token layer's occlusion mode was26 (`CONTROLLED | HIGHLIGHTED | VISIBLE`), and its occlusion subjects included the uncontrolled visible lower target. The opaque version retained its artwork above because the lower target was not visible.

The user chose a faint outline when the fill fades. The verified configuration adds a no-fill outline tile at the same elevation and level membership, alpha0.35 and no occlusion. The deck fill uses SURFACE/alpha0. The outline was visibly retained above and below without covering the lower terrain. No token occlusion override or replacement visibility engine was introduced.

## Verification and remaining acceptance

Codex:792 tests/89 files; all three typechecks, lint and module build passed. Lint retains the existing unused `clearance` warning. `npm run verify` reached the final dashboard plugin build, whose artifact-copy hook was denied writing to the unrelated Obsidian vault. No vault deployment was authorized for this task, so that side effect was not escalated.

Workshop:271 tests passed. The actual editor loaded a version4 stacked-opening fixture, disabled suspended presets for the lowest opening, applied a catwalk preset to the upper opening, and changed thickness7.5→2.5ft by changing the lower ceiling7→9 while preserving upper floor10. Undo/Redo restored both states. Save JSON reported success; reopening that downloaded file remains unverified.

After the artwork decision and export work, Peter's acceptance checklist is: below the catwalk, see upper target and lower terrain but not the hidden target; above it, see the lower target while the wall blocks its target; at the opaque deck, block through-deck sight but preserve open-edge sight; reload and check terrain legibility with both levels included.


## Final implementation and runtime checks

The geometry form's Configure native visibility action previews changes and explicit adoption choices. Adopted source behaviours retain sound and unrelated data; sight/light/occlusion are transferred to a companion at the floor top with all-level membership. The companion uses the authored sight/light flags, move=false, sound=false, occlusion=true, exposure=false, culling=false. Disabling/deleting geometry removes its generated plane. Only the active GM reconciles; edits received during a pending write schedule a fresh pass. Potential overlapping blockers are reported conservatively using document bounds and remain unchanged.

Live adoption changed only the selected test surface, preserved sound, reported an unselected opaque behaviour and was idempotent. Disable removed the companion; re-enable and reload retained a single companion. Source band/elevation preservation, stale floor-height changes, upper-side conflicting material and concurrent definition edits have regression tests. The independent GPT-6 Astra review's five P2 findings were reproduced and fixed; no minor findings remained.

The browser fixture `map-workshop/fixtures/surface-workflow-check.html` passed save/encode/decode and actual raster checks:975 interior deck pixels for mixed surfaces and1421 for stacked openings were absent from all corresponding combined level/wall/terrace images. An explicit ring test preserved its hole. Separate deck and outline images were visually inspected. The earlier editor download itself was not reopened; the same serialization boundary was exercised by the browser fixture.

An actual format7 ZIP passed the installed importer's ZIP reader, scene preparation, capability check and Codex provider mapping. Its documents were embedded only in Testing Scene, with fresh level IDs. Native level textures were scaled/offset to fit that existing scene after restoring its dimensions. Source positions and visibility of five unrelated decorated tiles were verified unchanged. In the settled lower view, the catwalk's upper target was visible; the opaque upper target and hidden target were not. Catwalk sight/light rays passed and opaque rays hit10ft. Above, the lower target remained visible and the outline persisted. These results do not substitute for Peter's player-client checks.

Actual unchecked solid climbs reached100020 from100000 on gridless, square and hex grids, matching the shared planner. The original `token.move` returns false because Codex reissues its planned path; the probe initially read too early. Final positions were checked after the reissued movement. A temporary completion-hook observer timed out and is recorded separately, rather than treating its false result as an actual movement failure.

After the user-triggered server restart, Foundry accepted a disposable Testing Scene region containing `map-workshop-importer.setElevation` and `map-workshop-importer.surfaceGeometry`. The server persisted finite extent, underside18.75 and independent sight/light=false exactly; the importer geometry model had no event handlers. The disposable region was removed and cleanup verified. Evidence: probe macro `surfaceRestartProof`. This verifies importer subtype registration and inert data persistence with both modules installed; it does not claim a separate world run with Codex disabled.

Cleanup verified:21 task messages removed; all disposable levels/regions/tiles/walls/tokens removed. Bob restored to1050/1000/100000, size1, sight disabled, HP78, completed movement/pending0. The original floor behaviour, exploration/outcome settings, scene dimensions4000×3000, padding0.25, gridless mode and tokenVision=false were restored. Five unrelated decorated tiles retain their source positions and visibility. GM view returned to Mining Site -- Depths / Upper Region. The user-triggered restart and subsequent standalone subtype registration check passed; no test chat messages were added by that check.

## Follow-up: bridge-only surface fading

The migrated +7.5ft solid floor exposed a native Foundry hover interaction: the cursor defaults to the viewed level's base (0ft), so an occludable plane above it becomes occluded on hover. Existing decoration tiles use SURFACE/alpha0 and disappeared with that plane. Their own `hoverFade` was false; the region surface was the trigger.

Per the user's correction, only finite suspended geometry now enables the companion's occlusion. Solid terrain keeps sight/light blocking and disables fading. Codex reconciliation repairs existing managed companions; Workshop exports the same rule. The finite→solid→finite transition and mixed solid/deck/catwalk export regressions both failed before the two-line fix. Full suites: Codex793 and Workshop271 pass; runtime typecheck/build pass; lint has only the existing clearance warning.

Live reload verified14 solid companions with occlusion=false and10 suspended companions with occlusion=true; sight/light match every authored definition. The +7.5ft equipment room retains sight/light=true. Probe evidence: `codex-foundry.bridgeOnlyOcclusionProof` on the existing Testing Scene probe macro. No token movement or chat messages were needed.

## Scene follow-up — 2026-09-23

Investigated the current `Mining Site - Depths` scene (`01ICSa6MnmvGaamA`), which has different document IDs from the earlier migrated scene.

- Aspect-12's NW and SE floor boundaries contain gaps of approximately 0.820 and 0.229 scene pixels. The movement planner now crosses a subpixel seam only when the same leg immediately regains a floor within the existing 2.5-ft walking step height. It still pauses at gaps of one pixel or more, genuine drops, and destinations inside a gap. Exact contact tracing remains unchanged.
- Tile clip hooks were registered after the initial scene had rendered. Saved masks now restore immediately on activation and at `canvasReady`.
- Live read-only planner verification after deployment: NW and NE are walking to 2.5 ft; SE is walking at 5 ft; east still falls to -12.5 ft. Aspect-12 remained at x750/y1386/elevation5. The crystal dirt tile's mesh has its persisted mask after reload.
- The dirt tile `aW7VJkFD9LFLxqDF` selects `wvxNvlJNx6FQCgRZ` (`Floor -15 ft Island`). Its local region component is about 915×892 pixels, larger than the 575×574 dirt tile, so restoring the mask alone does not visibly trim the desired island. Awaiting the intended footprint before editing geometry.
- Manual native occlusion is still overwritten by managed visibility reconciliation; an override preference is pending.

Validation: 795 tests in 90 files; runtime typecheck and build pass. Lint has the existing unused `clearance` warning only. Installed module backup: `/home/ubuntu/codex-test-backups/scene-bugs-20260923/module-before.tgz`.

### Follow-up audit and island correction

Read-only audit of 776 neighbouring-hex routes with floors at comparable endpoint heights found 107 subpixel seam crossings (crossings, not unique holes). Five wider candidates remain: (1728.7,1146.8) 1.0583 px; (1275.1,2093.0) 1.6462 px; (1325.2,2092.6) 3.3018 px; (1375.1,2093.0) 1.6462 px; (1225.2,2179.9) 1.6462 px. These were not repaired or automatically treated as walkable; the audit ignores wall collisions and is a geometry screening pass, not exhaustive arbitrary-path validation.

An on-canvas outline resolved the island ambiguity: `Floor -15 ft Island` actually covers the surrounding basin. The raised crystal island is `Floor -10 ft` (`FaH2G47bSjxCic3e`). Corrected only dirt tile `aW7VJkFD9LFLxqDF`'s `codex-foundry.clipRegion` from `wvxNvlJNx6FQCgRZ` to `FaH2G47bSjxCic3e`. Screenshot verification shows dirt cropped precisely to the small island while the crystal remains intact. Diagnostic overlays removed. No region shape, actor or token edits.

Occlusion alternatives under discussion, not implemented: default artwork fading off; native local radial/vision reveal for chosen artwork; or a new sight-gated token silhouette layer above opaque artwork. Visual fading must remain separate from native sight/light restrictions and actual token detection.

## Opaque artwork and covered-token outlines — 2026-09-23

Implemented the approved default: managed surface fading is off. Module settings can opt suspended surfaces into fading. Surface Geometry → Configure native visibility now offers Module default / Off / On. Native companion Occlusion edits store a `surfaceOcclusion` override on that same behavior in the same update, avoiding an observed race from writing a separate geometry document. Internal reconciliation does not convert defaults into manual overrides. Workshop exports now also default native occlusion to false.

A client setting enables cyan outlines and relative-elevation labels for sight-visible tokens beneath artwork. It uses active player-owned vision sources and Foundry sight detection modes, not GM omniscience, explored fog, or nonvisual senses. Hidden tokens are excluded. Native alpha-aware artwork tests and Codex clipping regions determine coverage. Existing token documents, sight/light restrictions and movement are not modified by this display layer.

Live GM-side verification used only temporary fixtures in Testing Scene:
- GM Vision enabled: no PC sources, no outline disclosure.
- GM Vision disabled, PC controlled: the visible covered target produces a cyan silhouette; hidden and wall-blocked targets remain absent.
- Opaque native surface between upper PC and lower target: native visibility false and zero visible outline sprites with one active PC source.
- Same surface made see-through: target visible, silhouette shown with `-20 ft` on the upper level, hidden and wall-blocked targets remain invisible.
- Rapid native Occlusion on/off edits survive reconciliation and a browser reload as `off` / false.
- Real region dialog correctly displays Off after reload; choosing Module default saves `inherit` / false.

Evidence retained on the GM diagnostic macro in `codex-foundry.outlineProof`. Disposable test documents removed and the GM's original GM Vision=true restored. Player-side confirmation remains user-owned; no PF2e runtime session requested. Native tests emitted pre-existing Named Encounters and Bestiary Tracking errors; there were no outline renderer errors.

Validation: 797 Codex tests / 91 files, 271 Workshop tests, runtime typecheck and production build pass. Lint reports only the pre-existing unused clearance warning. Installed module backed up at `/home/ubuntu/codex-test-backups/occlusion-outlines-20260923/module-before.tgz` before deployment. Depth darkening and blur remain deferred.
