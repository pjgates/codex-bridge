# Sensory Effects verification

## Status

The implementation is deployed from `peterg-sensory-effects`, through commit
`4b0f7a4`. Configuration, ownership, cross-floor rendering, and private audio
checks passed on real clients. Player-facing Unidentified visibility and the
fog texture comparison also passed. Native acceptance is complete for the
authorized SF2e environment described below.

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
