# Generic sensory effects

Status: proposed for written-spec review. The user confirmed the shared definition model and selection rules on 2026-09-25. Implementation has not started.

## Goal and confirmed decisions

Codex Foundry supplies generic sensory channels, selective glow rendering, and selective ambient audio. All campaign-specific meaning is configured in an ordinary PF2e Effect item in Foundry. The module contains no built-in contamination status, campaign-specific stage thresholds, colours, named channels, or campaign preset.

- A player contributes a viewpoint only through a selected token whose actor they own. There is no assigned-character or unselected-owned-token fallback.
- When several owned tokens are selected, combine their eligible senses. Evaluate each token's capabilities, position, and range independently.
- Tiles choose the same world Effect item and have their own rank.
- Existing applications follow edits to the world Effect's sensory settings. An actor's effect counter or a tile's rank remains individual.
- Signals can be configured to remain perceptible through walls; material thickness is not modelled.
- Cross-floor perception is required. Read emitters across all levels of the current scene, including levels that are not rendered, and include vertical separation in range.
- The initial visual representation is an indistinct glow. Greater signal strength produces a brighter glow, rather than revealing token or tile artwork.

## Approach

Store a sensory definition on a world PF2e Effect item using module flags, and resolve applications back to that item. Add configuration to the existing Effect, Tile, and Ambient Sound sheets. Render private glows in a separate canvas overlay and filter tagged ambient sounds on each client.

Independent copies of sensory settings would contradict the confirmed shared-edit behaviour. A module-level catalogue would put campaign configuration outside the Effect. Custom PF2e senses alone are also insufficient: PF2e rebuilds native token detection modes from its supported senses, while tiles need the same signal treatment as creatures. Keep the private overlay independent of ordinary sight.

No custom document subtype, arbitrary expression language, separate plugin framework, or additional module dependency is required by this design.

## In-game configuration

Add a **Sensory** section to world Effect sheets. It defines one named channel per Effect; different Effects can use the same channel, and a character can carry several sensory Effects. Emission, visual perception, and audio perception can be enabled independently. This supports emitters, receivers, and Effects that do both.

| Control | Meaning |
|---|---|
| Channel | An opaque, case-sensitive identifier chosen in Foundry. Matching uses this identifier, never the Effect's name or slug. |
| Emit signal | Whether an application emits on the channel. |
| Signal strength | Use the application's rank, or a fixed positive strength configured on the definition. |
| Glow colour | Colour of this definition's emitted glow. |
| Perceive glows | Whether an application perceives matching emitters. |
| Minimum rank for glow perception | Required rank on the viewing token's applied Effect. |
| Glow perception range | Positive distance in scene units, explicitly supplied when enabling this capability. No campaign range is built into code. |
| Walls block glow perception | When enabled, test sight-blocking walls without requiring ordinary illumination; when disabled, ignore walls. |
| Hear channel sounds | Whether an application hears ambient sounds assigned to the channel. |
| Minimum rank for hearing | Required rank on the listening token's applied Effect. |

Sensory behaviour is opt-in. An unconfigured Effect has no sensory contribution. Enabling a capability requires its relevant fields to be complete and valid. The configuration describes these fields in game terms, without requiring scripts or JSON editing.

An applied actor Effect shows its shared definition and the link to edit it when the user has permission. Sensory settings are edited on the world definition, not on an application. Its native counter remains the application's rank. A non-counter Effect has rank 1. Rank 0, an expired Effect, or a removed Effect contributes neither emission nor perception.

A tile has a list of **Sensory Effects**, each containing an Effect picker and a non-negative integer rank. It uses the emission portion of each shared definition. Tiles do not act as player viewpoints. Moving, resizing, rotating, removing, or changing a tile refreshes its signal markers. Existing clip-to-region configuration remains usable.

An Ambient Sound has an optional **Sensory Effect** picker. It associates the sound with the chosen definition's channel; it does not require emission to be enabled on that definition. The selected token's matching hearing capability determines eligibility. Audio file, volume, area/radius, falloff, wall interaction, elevation, and darkness settings remain the sound's native configuration. A tile does not automatically create or play a sound; place an Ambient Sound where the signal should be heard.

## Persistent data and shared definitions

- World Effect: `flags.codex-foundry.sensory` contains the channel, emission settings, and receiver settings.
- Applied actor Effect: `flags.codex-foundry.sensoryDefinition` identifies the canonical world Effect UUID. Rank comes from the applied item's native badge.
- Tile: `flags.codex-foundry.sensoryEffects` contains `{ effectUuid, rank }` bindings.
- Ambient Sound: `flags.codex-foundry.sensoryEffect` contains the chosen world Effect UUID. Absence means an ordinary ambient sound.

When a configured world Effect is applied through the native PF2e workflow, establish its canonical reference using the source item's identity and native copy provenance. Resolve the reference to a world Effect rather than relying on copied sensory flags. A source definition must be usable by the client; the configuration should expose missing or inaccessible references clearly.

Changing a definition refreshes all affected views and sounds without copying new settings into every application or resetting ranks. Changing a rank updates that application's behaviour immediately. Deleting a definition or clearing its channel makes its bindings inactive; each capability toggle disables only that capability. Do not substitute stale copied settings, another Effect with a similar name, or ordinary audio playback. Keep unresolved bindings visible in their configuration so the GM can repair or remove them.

Validate form input and persisted module flags at their boundaries. Keep the internal resolved model typed and simple. Canonical references do not change native PF2e duration, rule elements, permissions, conditions, or effect-copy semantics outside the sensory fields.

## Observer eligibility and combination

A viewpoint requires all of the following on the current client:

1. The token is selected on the current canvas.
2. Its actor exists and the current user has Foundry OWNER permission on that actor.
3. The actor has an active application whose shared definition enables the relevant capability and whose rank meets its threshold.

Do not infer eligibility from token visibility, assigned character, Observer permission, or an Effect carried by some other owned actor. Apply the same selection requirement to the GM's gameplay view; GM privileges do not automatically enable all signals or audio. Foundry's native permission rules determine ownership for a GM. The explicit native sound-configuration preview is a separate authoring operation described below.

For visual perception, test each eligible viewpoint against each matching emitter across the current scene's levels. A signal is perceptible if at least one viewpoint qualifies for that emitter's position. Draw an emitter's glow once; multiple viewpoints do not add brightness. Never combine one token's eligibility with another token's position or longer range.

For tagged sounds, use only the eligible matching listeners in the native spatial audio calculation. Retain listener elevation and native level context; do not flatten listeners onto the viewed floor. Several listeners do not multiply volume or start duplicate playback. Ordinary ambient sounds keep their native listeners and playback behaviour.

Deselecting a token, changing ownership, removing or expiring an Effect, lowering a rank, disabling a capability, changing a definition, or leaving the scene removes the affected contribution. Moving or changing elevation/level recomputes range and directional cues. Viewing another floor refreshes the projected overlay without granting a viewpoint; tokens that are no longer selected contribute nothing. Recheck eligibility before applying asynchronous results so an earlier eligible state cannot restore a glow or sound after revocation.

## Visual contract

The glow marks a signal's location and relative strength. It carries no actor name, token portrait, tile texture, health information, hover sheet, or automatic target selection. It must remain visible when ordinary sight is blocked, if its receiver capability ignores walls, including over unexplored fog. It never reveals the underlying map or changes fog exploration.

An observer does not see its own token's emission through this overlay. Another selected token can perceive that token's emission if independently eligible. Duplicate applications on one object for the same channel use the strongest emission instead of summing; a stable definition identity breaks ties when colours differ. Different channels remain independently detectable.

Strength maps monotonically to brightness with a bounded display intensity. It does not enlarge perception range or illuminate surrounding terrain. Use a diffuse marker at a token's occupied position or a tile's transformed footprint, without exposing its artwork. Respect a tile's configured region clipping when shaping the glow.

### Cross-floor geometry and presentation

Read candidates from the scene's token and tile documents, not only the current canvas placeables. Off-level emitters must work without a rendered token or tile object. Derive token positions from native document geometry, and tile positions and clipping from persistent document geometry. Native level visibility and ordinary line of sight must not suppress a wall-ignoring signal.

Measure glow range as straight-line three-dimensional distance: convert horizontal scene-pixel displacement to scene distance units, then include the difference between absolute document elevations. Do not add a level's base to a token elevation that is already absolute, substitute a level index for elevation, or compare raw pixels with scene units. A signal directly 20 feet above a viewer is 20 feet away, not zero feet away.

Project a detected off-level emitter at its scene x/y position on the current map. Include a small above/below cue so it cannot be mistaken for an object on the viewer's floor; do not reveal a level name, exact height, artwork, or map geometry. For multiple eligible viewpoints, use the nearest qualifying viewpoint for this cue, with stable token UUID ordering to break ties. The range and capability must qualify on that same viewpoint.

Wall-ignoring perception passes through walls, ceilings, and floors. Do not treat a level boundary or background image as an additional barrier. When wall blocking is enabled, use Foundry's cross-level collision semantics; do not invent material thickness or change ordinary sight. The cross-floor overlay does not grant level navigation access or alter Foundry's level visibility configuration.

GM-hidden token and tile documents remain excluded from player-visible glows as a proposed boundary for spec review. This is separate from PF2e Hidden or Undetected conditions; the module does not globally change those conditions. Ordinary blinded/deafened conditions do not automatically suppress a custom channel: its rules are defined by the configured Effect, and existing rule elements can control that Effect. This feature visualises an imprecise signal; per-observer Hidden flat-check and targeting automation are outside its scope.

## Audio contract

A tagged sound can play only when a selected, owned token has matching hearing capability at the required rank and qualifies under the sound's native spatial settings. Players without such a listener hear none of that sound.

Cross-floor tagged audio follows the native sound's configured elevation, level coverage, and wall behaviour. A sound being on an unrendered level is not by itself a reason to omit it: use scene sound documents and native source geometry as needed. This requirement does not make every sound pass through floors or replace its native attenuation with the glow's range rule.

Filter listeners before calculating the sound's spatial playback, rather than merely toggling audibility because some eligible actor exists. A nearby ineligible token must not supply the distance, volume, or wall result for a distant eligible token. Exclude flagged sounds from ungated playback before scheduling their eligible playback; there must be no initial burst or refresh race that exposes them to an ineligible client.

Keep sound instances with distinct gating requirements isolated even when their audio file paths match. Verify shared-file handling against the installed Foundry v14 runtime. A private source must not be activated by an ordinary source using the same file. Removing the sensory assignment intentionally restores ordinary playback; a broken reference does not.

Native GM sound preview remains available for configuring a sound. Normal gameplay playback still obeys selection and ownership. Stopping eligibility silences that source immediately, without an audible fade-out tail; native fading may otherwise be retained while an eligible listener moves.

## Integration and delivery slices

Keep the feature behind the existing `index.ts` import boundaries. `src/canvas/sensory/` owns definitions, resolution, configuration, glow rendering, and tagged audio. The PF2e adapter reads active Effect applications and native counters; the canvas code does not expand PF2e's native sense lists. Integrate registration through `src/hooks/init.ts` and activation through `src/hooks/ready.ts`.

This is an opt-in canvas capability, independent of the custom house-rules master switch, following existing tile clipping. Configuration remains available without altering ordinary effects or untagged scenes. No automatic creation of campaign items, application to existing actors, tagging of live sounds, or deployment is part of implementation.

The detailed implementation plan follows written-spec approval. The delivery order is:

1. Define the shared sensory model and resolve selected owned viewers and application ranks.
2. Add the Effect sensory editor and canonical-reference handling for native application.
3. Add tile Effect bindings and emission resolution.
4. Resolve three-dimensional signal range across scene levels, including off-level document geometry.
5. Render selective glows for tokens and tiles, including above/below cues and scene lifecycle cleanup.
6. Add the Ambient Sound Effect picker.
7. Gate tagged audio using eligible listener positions and handle definition/selection changes.
8. Complete the native workflow documentation and record GM/player runtime evidence.

Each slice has one concern, targets roughly 200 changed code/test lines, and splits before exceeding 400. Tests accompany the owning behaviour. Preserve unrelated movement work and existing module features.

## Verification and acceptance

Before executable edits, discover and run the relevant existing baseline checks. Add red/green tests for new behaviour under `tests/node/sensory/`. Use the existing commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and final `npm run verify`. Spec-only review does not claim executable verification.

Focused tests cover:

- Selected owner versus selected non-owner and unselected owner; multiple viewpoints with different ranks, channels, and ranges.
- Shared definition edits with unchanged individual ranks; expired/removed applications and unresolved definitions.
- Emit-only and receive-only Effects sharing a channel; fixed and rank-derived strength; strongest-emission deduplication.
- Tile bindings, transformed/clipped footprints, and wall-blocked versus wall-ignoring glows without ordinary map revelation.
- Above/below emitters on unrendered levels, vertical-only and diagonal range boundaries, absolute elevations, and different nearest qualifying viewers. Native level visibility must not erase eligible signals.
- Correct eligible listener position, ordinary sounds remaining ordinary, same-file private/public sources, and revocation during pending audio work.

Verify end to end in a disposable Foundry v14 PF2e scene using separate GM, owner, and non-owner player clients. Record the installed core and system versions; the local PF2e source checkout is evidence about interfaces, not proof of the installed runtime. Use two owned tokens, another user's token, a wall and unexplored fog, a clipped crystal/water tile, and tagged and ordinary sounds. Include emitters on unrendered levels above and below the viewer, including one directly overhead; verify three-dimensional range and cues without exposing another floor's artwork or granting level navigation. Check cross-floor tagged audio against the native sound's configured elevation/level coverage. Apply the world Effect through the native workflow, change its sensory settings and individual ranks, select/deselect tokens, revoke ownership, expire/remove the Effect, change levels and scenes, and reload clients. Confirm both persistence and immediate removal of private contributions.

Capture screenshots and audio/playback observations with browser console output in `docs/testing/sensory-effects.md` during implementation. Browser autoplay restrictions and disabled audio are reported as test-environment issues, not mistaken for successful gating. Do not mutate live campaign scenes to obtain verification.

The feature is complete only when in-game configuration, actor and tile applications, shared edits, selective glows, and selective audio all pass those workflows. No campaign-specific sensory Effect needs to be shipped in code.

## Source evidence

- Existing module Effect pattern: `src/rulesets/sf2e/flying/effect.ts`.
- Existing module Tile sheet configuration and clipping: `src/canvas/clip-tiles/config.ts` and `clip.ts`.
- Local PF2e implementation: `/Users/peterg/code/pf2e/src/module/item/base/document.ts` records copy provenance; `item/effect/document.ts` provides badges and expiry; `scene/token-document/document.ts` rebuilds native detection modes.
- Foundry v14 [AmbientSound synchronization](https://foundryvtt.com/api/v14/classes/foundry.canvas.placeables.AmbientSound.html#sync), [listener positions and spatial synchronization](https://foundryvtt.com/api/v14/classes/foundry.canvas.layers.SoundsLayer.html), and [document flags and ownership](https://foundryvtt.com/api/v14/classes/foundry.documents.BaseItem.html).
- Foundry v14 [scene level access](https://foundryvtt.com/api/v14/classes/foundry.documents.Scene.html#availableLevels), [Level documents](https://foundryvtt.com/api/v14/classes/foundry.documents.Level.html), and [native token document geometry](https://foundryvtt.com/api/v14/classes/foundry.documents.BaseToken.html#getCenterPoint) distinguish scene-wide stored geometry from the currently rendered level. Existing `src/rulesets/sf2e/flying/height.ts` and `gridless/floors.ts` already query across scene levels.
