# Sensory Effects verification

## Light appearance: local code, manual testing pending

Emit Signal now offers **Appearance → Light appearance (visual only)**. Existing
rules default to Soft glow, so enabling the new renderer is explicit. In the
Effect's Rules tab, set a nonzero **Bright** or **Dim** radius under Light appearance.
Configure opacity (Alpha), emission Angle, Attenuation, Saturation, Colour technique,
and Animation with Speed, Intensity and Reverse. The rule's existing Colour and
Strength fields apply; strength scales final opacity, including animations that
ignore native light alpha. Radius stays independent of rank and perception range.

The renderer uses Foundry's native colour shaders and animations against a neutral
grey texture. Scene-adaptive colour techniques therefore differ from lighting a
textured room. Illumination-only controls (darkness sources, vision, environmental
brightness/contrast/shadows, light priority) are not exposed. No native background
or illumination mesh is added to the canvas, and no source enters ordinary light
or vision collections. Tile appearances retain their footprint/clipping mask;
token appearances extend to their configured radius and follow token rotation.

User requested code changes only and will perform in-game testing; this addition
has not been SSH-deployed or tested in a player browser. Verification: all three
TypeScript checks passed; final runtime typecheck, lint (one existing unused
`clearance` warning), 711 tests in 66 files, and Foundry build passed. Independent
Astra review found and closed native geometry allocation, nested form rendering,
and animation-opacity issues; primary reviewed every production change.

Manual checks after deploying the build:

1. On Nakondis Particles → Rules → Emit Signal, choose Light appearance, Dim 5,
   Bright 2 and a Torch or Pulse animation. Keep the existing gold Colour/channel.
2. As an owner with a selected rank-2 PC, check the visual around another emitter.
   Deselect or reduce receiver rank: it disappears. Check across floors/walls at
   the existing 30-foot perception boundary without revealing scenery or fog.
3. Change emitter rank and Alpha, including Alpha 0; check Torch, Radial Rainbow,
   Color Burn, and Invert Absorption. Brightness must follow rank for every animation.
4. Check a rotated cone and a clipped tile with a central hole. Ordinary lighting,
   fog exploration, and conditional tile artwork must retain their prior behavior.
5. Change scene/reload and toggle Soft glow/Light appearance; verify no lingering
   animation, error, or stale appearance. Existing Soft glow rules should look unchanged.

## Current revision: composable native rules

The original single-definition implementation passed native acceptance below.
The replacement uses repeatable **Codex: Emit Signal**, **Codex: Perceive Signal**,
and **Codex: Hear Signal** entries in the native Effect Rules tab. Ordinary rules
can coexist. Canonical sensory edits remain shared; application counters remain individual.
Ambient Sounds now broadcast an explicit channel. Tile Appearance also offers
**Conditional artwork**, separate from sensory emission.

Nakondis Particles remains `Item.ZLDzhzq0WaeeAreG`: channel `nakondis-particles`,
gold `#ffd700` emission scaled by rank, hearing at rank 1, perception at rank 2
with range 30 scene units and walls disabled. On the campaign's feet-based scene
this is 30 feet. Native Unidentified, unlimited duration, counter, and GM-only
world ownership are preserved. Migration reuses the existing world item.

The user owns manual player acceptance for this revision. Earlier native results
below establish the original implementation, not new artwork or Rule Element UI behavior.

### Revision delivery checks

- Full serial suite: 706 tests/65 files passed. After the final native form and
  migration fixes, all 64 sensory tests/18 files passed, including the added regression.
- All three typechecks, lint, Foundry build and dashboard build passed (the existing
  gridless unused-`clearance` lint warning remains).
- Independent Astra review closed both findings; the primary reviewed production changes.
- Deployed commit `0ebcd97`; backup
  `/home/ubuntu/codex-composable-sensory-backup-20260925-NTSXAn/dist/`.
  Root manifest preserved. Local/remote module.js, module.css and en.json hashes match.
  JavaScript SHA-256: `b90c3b35e120970f279e657a2f4ab5682f58cf171e786a532b4ef94dcbb54afb`.
- GM client reloaded to run migration. Browser controls then timed out, so migration
  persistence and the revised native UI are not yet visually confirmed. Player acceptance remains manual.

### Manual acceptance

1. Reload the GM and player clients. Open Nakondis Particles → Rules: confirm the
   three Codex rules, gold colour, hearing threshold 1, perception threshold 2/range 30.
2. In Testing Scene, apply the Effect to a PC and set its native counter to 1,
   then 2. As its owner, select it: rank 1 hears matching private ambient broadcasts;
   rank 2 also perceives matching glows. Deselect it: both stop. Selecting multiple
   owned eligible tokens combines their capabilities. Selecting non-owned tokens grants nothing.
3. Edit the world rules and confirm existing applications follow the edit without
   changing their counters. Keep Unidentified checked to hide the application in native player UI.
4. On a crystal tile, add Nakondis Particles plus its rank under Sensory Effects.
   Test the glow across walls/floors within 30 feet, with an existing clipping region/hole.
5. Separately set tile Conditional artwork to an Effect and minimum rank. Any selected
   owned PC with that active Effect qualifies; an NPC, expired application, insufficient
   rank, or deselection does not. Losing the last qualifier hides art immediately.
   Qualification must not reveal art through ordinary walls/fog or another floor;
   native hidden state, clipping, and light/weather restrictions stay effective.
6. On an Ambient Sound, check Private sensory sound and enter `nakondis-particles`.
   Retain its native file/radius/walls/volume. Verify owner-only hearing and same-file
   ordinary sound independence. Uncheck to restore ordinary ambient behavior.

## Original implementation acceptance (before this revision)

Deployed through `4b0f7a4`. Configuration, ownership, cross-floor rendering,
private audio, Unidentified visibility, and fog comparison passed on real clients.

## Environment and deployment

- Server: `https://foundry.silverholdstudios.com/game`.
- Core: Foundry v14 Stable, build 368. System: **SF2e 1.5.1**.
  The shared Effect/canvas contracts were exercised here; this is not
  PF2e-specific runtime coverage.
- The user authorized disposable artifacts in **Testing Scene** and the
  existing **Alpha** and **Omega** accounts. GM used the in-app browser;
  Alpha used Chrome and Omega used Firefox.
- The user approved backup and SSH sync, including the existing movement
  updates in this checkout. The installed root manifest was preserved;
  no Foundry process restart was needed.
- Backup: `/home/ubuntu/codex-sensory-backup-20260925-vhYjaU/dist/`.
  Installed module: `/home/ubuntu/foundryuserdata/Data/modules/codex-foundry`.
- After the latest build, remote and local SHA-256 values matched for
  `module.js`, `module.css`, and `lang/en.json`. JavaScript SHA-256:
  `b5db03b15d8e238df8c27e4a8d958c5f2a8c0901fb5bf55887bede31729df3eb`.
- QA macros call native APIs against the deployed feature. They do not inject
  the feature bundle. Fixtures are isolated by the `Codex sensory QA —`
  prefix and recorded IDs. Existing movement fixtures were preserved.
- Cleanup restored custom rules to true, Testing Scene token vision to false,
  and **Mining Site - Depths** as the active scene. Alpha retained Bob as its
  assigned character; Omega returned to no assigned character. All three
  clients reloaded with the restored settings. Chrome's prior site-mute
  preference was restored.
- The eight QA actors, two world Effects, thirteen macros, three levels and
  their recorded scene fixtures/flags were removed. Only this workflow's
  three uploaded QA helpers were removed from `test-surfaces/`; the installed
  module build and backup remain.

## Local verification

- Baseline: 643 tests; focused Flying and tile-clipping tests: 22 passed.
- Latest gate: all three typechecks passed; **672 tests in 59 files passed**
  with `npm test -- --no-file-parallelism`; Foundry and dashboard builds passed.
  No assertion or performance threshold was relaxed.
- `npm run verify` was executed. Parallel runs hit the existing 150 ms
  clearance benchmark at 281.7–304.9 ms under contention. The unchanged
  isolated test and full serial suite passed. The dashboard build initially
  hit its sandboxed automatic vault copy, then passed with normal escalation.
- Lint retains one existing unused-`clearance` warning in
  `src/rulesets/sf2e/gridless/routing.ts`. No unrelated movement code or tests
  were changed for this feature.
- New behavioral regressions were observed failing before their fixes.
  Mocks establish the adapter contracts; the native evidence below establishes
  actual engine behavior.

## Review and runtime fixes

A fresh GPT-6 Astra reviewer inspected the branch and native source contracts.
The primary implementer personally read every changed production line.
No reviewer finding was deferred. Reproduced and fixed:

- Native world drops serialize without `addSource`. World serialization now
  captures the chosen definition UUID; embedded copies retain their link.
- Tagging a playing sound reconciles ordinary sources with no fade tail and
  cancels a former node's gain ramp, including when already stopping. An
  eligible ordinary source on the same file retains its native manager.
- Untagging while changing file leaves ordinary acquisition to the native
  handler, preserving the destination file's existing singleton.
- A clipped tile's directional cue remains visible outside the fill mask,
  including when the tile center lies inside a clipping hole.
- Native autosave needs Boolean dtype on valued checkboxes. Without it,
  strings/null invalidated the persisted definition and reset the form.
- Native level inference filters out unrendered levels. Private geometry now
  resolves elevation against stored levels, preserving native interior and
  boundary rules without granting floor visibility.

## Observed native results

| Scenario | Evidence |
|---|---|
| Native configuration persistence | World Effect autosave/reopen and badge rerender retained settings. Tile rank 4→5 survived reopening; removing the last binding persisted an empty list; restoring rank 4 preserved clipping. Ambient Sound assignment and None both saved/reopened. |
| Native Effect application | Real native sheet drop handler produced the chosen world UUID, independent counter 2, and `unidentified: true`. Pointer drag automation did not produce a sheet application; the native handler was exercised from the authorized QA macro. |
| Selection and ownership | Alpha rank 2: three glows and positive private playback. Rank 1: hearing only. Both selected: three glows and the strongest eligible audio listener. Neither selected: no output. Omega could not control Alpha tokens; its own token produced three glows and positive private playback. |
| Cross-floor geometry | Above/below token and tile placeables were absent on the viewed floor, but three private signals rendered. QA upper/lower floors remained absent from player navigation. The actual sound source resolved to its stored upper floor. |
| Strength, clipping, range and walls | Native fill alphas were 0.6, 0.4 and 0.64; the tile had its central hole and directional cue. Range 19.9 excluded a source 20 units overhead; range 20 included it. Sight walls reduced three signals to one; ignoring walls restored three. Hidden emitters were excluded. |
| Shared settings and ranks | Shared threshold/channel edits changed existing output without changing application rank 2 or tile rank 4. Counter changes, real native expiration/removal, and deleted emitter definition closed output. |
| Native audio | Positive private gain/gate and running audio context observed on both players. Native wall muffling added a low-pass filter; blocking walls, vertical radius and darkness suppressed playback. Disabling easing produced configured gain 0.1. Path changes loaded the new private file while ordinary playback continued. |
| Same-file isolation | Deselecting stopped/detached private voices while the ordinary same-file singleton continued. Four native transition checks passed: baseline playback, tagging the sole ordinary source, tagging with an ordinary companion, and untagging onto an already-playing destination file. |
| Channels | Two selected owned channels on one file used distinct native Sound objects. Releasing one listener closed only its channel. Deleting the receiver definition closed private sound and glow. Three checks passed. |
| Pending work and revocation | Holding real native load/start operations, then deselecting, left the gate at zero and playback stopped after release. Ownership loss during held load also stayed silent when no other eligible selected listener remained. |
| GM and lifecycle | Gameplay obeyed selection even for GM. Explicit native GM sound preview played; normal refresh ended it. Level transitions cleared the former listener and native scene unview removed private sources. Client reload and operation with custom rules disabled passed. |
| Invalid assignments | A malformed/deleted definition contributed nothing. A tagged sound with an invalid UUID remained private and silent while ordinary playback stayed positive. |
| Hidden applications | Alpha's native Effects tab was visibly empty. The rank-2 Unidentified application produced zero player token-effect icons; the world template was not visible. Three glows and playing private audio with gate 1 remained. |
| Fog and ordinary vision | An independent native texture extractor compared 12,000,000 fog bytes before/after disabling the private glow. Every byte and all vision-source IDs were unchanged; the private glow count changed from three to zero. |

The advanced GM workflow passed **24/24** checks, ordinary transitions **4/4**,
and channel isolation **3/3**. Player observations were recorded on the
disposable actors; GM results were recorded on Testing Scene before cleanup.

An apparent ownership-revocation failure was traced to Foundry automatically
selecting Alpha's other owned rank-1 token. Its hearing contribution was valid.
The isolated rerun removed that alternate receiver temporarily and passed;
ownership and the canonical reference were restored.

The first tile fixture used top-left coordinates, whereas native v14 tiles use
anchor coordinates. Correcting the fixture center produced the intended hole.
An invalid fixture artwork path was replaced with the native system Effect
icon. Neither issue required a production change.

## Visual evidence and limits

Native screenshots were captured in the testing conversation: Alpha's empty
Effects tab, then the unobstructed player canvas with a brighter upper-floor
tile, its central hole and up cue, and a dimmer lower-floor token signal with
its down cue. The source artwork remained unrendered. The fog comparison
supplies independent evidence that those markers did not explore the map.

The Mac lock temporarily interrupted player checks; the user unlocked it and
all remaining checks and cleanup completed. Other installed modules still
emit their existing compatibility warnings and a named-encounters tracker
error on reload. No sensory failure was observed in the final client load.

Native pointer drag automation was intercepted or produced no application;
the real system sheet drop handler was verified instead. PF2e-specific runtime
acceptance remains outside the available SF2e test environment. Neither limit
is presented as a successful PF2e pointer-drag test.

## Execution decisions retained from the ledger

These decisions are listed in execution order. No review finding or minor
was deferred.

| Decision | Cost if wrong |
|---|---|
| Extract leaf-task briefs into one master ledger because the index has no task headings. | Bookkeeping repair. |
| Use the user-authorized SF2e Testing Scene for shared native contracts and disclose the actual system. | PF2e-specific integration still needs validation. |
| Batch configuration/glow acceptance after the complete overlay was available, retaining pending status until observed. | Integration defects discovered later in the same implementation run. |
| Respect native lazy audio routing: destination, then environment gain node, then environment destination. | Native audio routing mismatch. |
| Split the spatial audio frame from playback orchestration to keep implementation slices small. | One extra internal import. |
| Supply elevated preview position only from the explicit native GM preview wrapper. | Authoring preview could diverge from gameplay eligibility. |
| Prepare the SSH dry run and review before requesting the deployment authorization excluded by the plan. | Delayed runtime testing. Authorization was subsequently granted. |
| Regrade the clipped directional cue as Important because cross-floor signals require it. | One extra renderer container and boundary regression. |
| Run the unchanged full suite serially after parallel CPU contention failed the existing timing benchmark. | Serial scheduling can miss test-file contention; feature concurrency assertions still execute. |
| Resolve unseen source floors from stored levels instead of native visible-level inference. | Overlapping-level ties could differ from native placement. Native source/wall checks passed. |
| Exercise the real sheet Effect drop handler when pointer automation was intercepted or ineffective. | Pointer integration with other installed modules remains unproved. |
| Use the latest complete 672-test gate for delayed task completion rather than repeat identical tests for ledger formatting. | No repeated per-task completion logs; test execution and native acceptance evidence remain recorded. |
