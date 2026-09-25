# Sensory Audio and Runtime Acceptance

Read the [plan index](2026-09-25-sensory-effects.md) and [approved spec](../specs/2026-09-25-sensory-effects-design.md). Inherit their types, exact paths, constraints and common checks. Native audio APIs were inspected in the source bundle identified in the index; verify them in the disposable runtime before tasks 8–10. Do not copy native method bodies.

## Task 7: Ambient Sound Effect picker

**Files:** create `S/sound-config.ts`, `T/sound-config.test.ts`; extend `S/index.ts`, `S/lang/en.json`; modify `src/hooks/init.ts`.

**Interfaces:** consume task 3's `sensoryReferenceSelect`. Produce `registerSensorySoundConfig(): void` and `hasSensorySoundAssignment(document: SensorySoundDocument): boolean`. `SensorySoundDocument` reads `uuid`, module `flags`, `path`, `x`, `y`, `elevation`, `levels`, `radius`, `shape.radius`, `volume`, `walls`, `easing`, `hidden`, `darkness`, and `effects`. Absence or an intentionally cleared empty string is ordinary audio; any other assigned-but-invalid value is tagged and must fail silent.

- [ ] Add a real form-boundary test that selects `Item.signal`, collects native form submission, reopens it, and verifies that UUID persists. Clear the select and assert the empty assignment is saved while the path/volume/elevation fields retain their original values. Preserve a deleted source's UUID as an unresolved option.

```ts
const select = root.querySelector<HTMLSelectElement>(
    'select[name="flags.codex-foundry.sensoryEffect"]')!;
select.value = "Item.signal";
select.dispatchEvent(new Event("change", { bubbles: true }));
expect(submitted["flags.codex-foundry.sensoryEffect"]).toBe("Item.signal");
```

The native-submit fixture records fields, rather than pretending to be the real Foundry database. `root` is its real form; `submitted` is the field map collected after the select's change/submit event. The actual save/reload is part of the runtime check.

- [ ] Run `npm test -- tests/node/sensory/sound-config.test.ts` and confirm the save regression fails before adding controls.
- [ ] Register `renderAmbientSoundConfig`, normalize its HTML root, and add a **Sensory Effect** select with `flags.codex-foundry.sensoryEffect` as its name. It uses the shared world-Effect picker, permits None, and adds a short hint that selected owners with matching hearing capability are its listeners. Do not add a sound radius, file, wall, or volume editor that duplicates native controls.

```ts
const value = document.getFlag(MODULE_ID, "sensoryEffect");
const assigned = value !== undefined && value !== "";
```

Treat null, non-string and otherwise malformed assignments as tagged-inactive rather than ordinary. No definition lookup failure may change `assigned` to false. Add the control once per render and retain native GM edit permissions.

- [ ] Run green tests and common checks. In Foundry save/reload the association, repair an unresolved source, clear it, and verify unrelated native sound fields survive. Commit `feat: associate ambient sounds with sensory Effects`.

## Task 8: Exclude tagged sources before native aggregation

**Files:** create `S/audio-guard.ts`, `T/audio-guard.test.ts`; extend `S/index.ts`; modify `src/hooks/init.ts`.

**Interfaces:** consume `hasSensorySoundAssignment`. Produce `installSensoryAudioGuard(): void` and `withOrdinarySources(layer: SensorySoundsLayer, operation: () => void): void`. `SensorySoundsLayer` provides `sources`, `_syncPositions`, `_configurePlayback`, and `getListenerPositions`; the guard wraps the currently configured v14 methods once. A source is private if its AmbientSound document is assigned, or its `sourceId` begins with `codex-foundry.sensory:`. Door/other object-less native sources remain ordinary.

- [ ] Create the aggregation-boundary regression with an ordinary source and a tagged source whose data paths are identical. Invoke the installed native wrapper with a layer fixture that records the source collection received by the original native operation. Assert only the ordinary source reaches that operation, and assert the original full collection is restored after it returns or throws. This tests the protocol boundary before grouping, not a private filtering predicate.

```ts
withOrdinarySources(layer, () => {
    expect([...layer.sources.keys()]).toEqual(["ordinary"]);
});
expect([...layer.sources.keys()].sort()).toEqual(["ordinary", "private"]);
```

Extend the runtime-entry test with an already-playing ordinary source that becomes private while another ordinary source shares its Sound. The ordinary source must retain control of the shared node, while the private object is detached from it. Assert the same scenario through native lifecycle callbacks, not a fixture that pre-detaches the node.

- [ ] Run `npm test -- tests/node/sensory/audio-guard.test.ts` and confirm both partition and transition regressions fail before wrapping.
- [ ] Wrap `_syncPositions` so the native operation sees an ordinary-only collection synchronously. Capture the original method and collection, construct a native Collection containing the ordinary entries, call the original method with its original listeners/options, and restore in `finally`. No private voice is driven by this operation.

```ts
const all = layer.sources;
layer.sources = new foundry.utils.Collection(ordinaryEntries);
try { operation(); }
finally { layer.sources = all; }
```

Keep the temporary change scoped to the verified synchronous native operation. Do not replace the entire SoundsLayer implementation or permanently change its collections. Preserve any previously installed method wrapper and its `this` binding. Record a compatibility failure if the supported operation no longer has the inspected synchronous contract.

- [ ] Wrap the configured AmbientSound `_createSound` so an assigned object's incidental native Sound is non-singleton: `game.audio.create({ src: document.path, context: game.audio.environment, singleton: false })`. Do not use native singleton nodes for private output. At the configured AmbientSound `_onUpdate` boundary, before its path-change code runs, detach a newly tagged object/source from its former shared Sound. Drive the remaining ordinary sources through the native operation first; stop the former node with fade 0 only if it is still managed by that now-private source. Clear the private object's references without stopping a node adopted by an ordinary source. Removing an assignment retires its private node and allows native ordinary playback to reacquire the normal singleton.
- [ ] Check this boundary in real v14 objects. Tag a playing source, tag and change its path in one update, remove the association, and delete a tagged object while an ordinary same-file source remains audible. Verify native `_onUpdate` ordering and source manager transfer before considering the guard complete. If this exceeds 400 changed lines with its tests, split transition handling from initial exclusion; both parts remain required.
- [ ] Run green tests and common checks, personally read the diff, and commit `feat: isolate sensory sounds from ordinary audio aggregation`.

## Task 9: Private voices with an output gate

**Files:** create `S/audio-voice.ts`, `T/audio-voice.test.ts`; extend `S/types.ts`, `S/index.ts`.

**Interfaces:** produce `createSensoryVoice(path: string): SensoryVoice`. A voice has `sync(playback: SensoryPlayback | null): Promise<void>` and `destroy(): Promise<void>`. `SensoryPlayback` contains a native sound source, final volume and muffled state. `SensoryVoice` owns one non-singleton Sound and a downstream GainNode in the existing environment context. It does not decide actor eligibility or compute spatial volume; task 10 supplies the newest valid request.

- [ ] Use a dependency-boundary fixture with deferred `Sound.load()` and `source.sync()`. The fixture reports gain/playback state and never performs eligibility checks. Test a valid request, revoke before load resolves, then resolve load: output must stay at gain 0. Test revocation during native start, then resolve start: the obsolete completion must not reopen the gate. Include one positive completed request with gain 1, so the negative case cannot pass simply because all playback is broken.

```ts
const pending = voice.sync(playback);
await voice.sync(null);
loading.resolve();
await pending;
expect(outputGate.gain.value).toBe(0);
expect(nativeStarts).toBe(0);
```

The production voice is used by reconciliation, and its Sound/GainNode are real external playback boundaries. Do not add test-only lifecycle exports or test an internal epoch number.

- [ ] Run `npm test -- tests/node/sensory/audio-voice.test.ts` and confirm the positive playback and deferred-revocation assertions fail before implementation.
- [ ] Create a separate Sound and insert its own gate into that Sound's existing routing, preserving the original destination:

```ts
const sound = game.audio.create({ src: path, context: game.audio.environment, singleton: false });
const output = sound.destination;
const gate = sound.context.createGain();
gate.gain.value = 0;
gate.connect(output);
sound.destination = gate;
```

Keep the gate closed during preload; use `sound.load({ autoplay: false })`. Each sync updates an incrementing request generation and the latest requested playback. Revocation/destroy closes the gate synchronously before awaiting `sound.stop({ volume: 0, fade: 0 })`. This also keeps late native start/fade work inaudible; stopping alone is insufficient.

```ts
const playback = requestedPlayback;
const current = ++generation;
await sound.load({ autoplay: false });
if (current !== generation || !playback) return;
playback.source.sound = sound;
await playback.source.sync(true, playback.volume,
    { muffled: playback.muffled });
if (current === generation && requestedPlayback) gate.gain.value = 1;
```

Use the request captured for this generation, rather than reading a newer mutable request halfway through a start. Detach the old source's Sound reference before transferring a voice to another source; do not stop other voices or native singleton audio. Destroyed voices remain closed, cancel pending requests, stop their Sound, and disconnect their owned gate. Catch and report native load/play failure at this external boundary with the source path; keep failed output closed and do not include campaign secrets or credentials in reports.

- [ ] Run green tests and common checks. In Foundry unlock audio and verify the gate is downstream of native effects/fades, closes instantly on revocation, and does not alter the environment volume bus. Commit `feat: gate private sensory voices through asynchronous playback`.

## Task 10: Eligible native spatial playback and lifecycle

**Files:** create `S/audio.ts`, `T/audio.test.ts`; extend `S/lifecycle.ts`, `S/types.ts`, `S/index.ts`; modify `src/hooks/init.ts`, `src/hooks/ready.ts` only for their owning registration/activation calls.

**Interfaces:** consume selected observers, world lookup, the installed guard, and private voices. Produce `refreshSensoryAudio(): void`, `clearSensoryAudio(): void`, and `buildSensoryAudioFrame(documents: Iterable<SensorySoundDocument>, observers: readonly SensoryObserver[], lookup: DefinitionLookup, sources: ReadonlyMap<string, SensoryNativeSoundSource>, configurePlayback: (config: SensoryPlaybackConfig) => void): Map<string, SensoryPlayback>`. A native source supplies `data`, `origin`, `x`, `y`, `elevation`, `getVolumeMultiplier(listener, { easing })`, `initialize`, `add`, `destroy`, `sound`, and `sync`. `SensoryPlaybackConfig` holds `source`, optional `listener`, `volume`, `walls`, and `muffled`; it is the local shape passed to the native `_configurePlayback` boundary.

- [ ] Add the spatial contract test with a nearby rank-0 token and a distant rank-2 token. The source fixture returns volume multiplier 1 at the near listener and 0.25 at the far elevated listener; the document volume is 1 and its sensory assignment is `Item.sound`. Only the eligible token may supply volume; after it is deselected, the frame is empty even though another owned actor remains. Use distinct world definitions for the sound (`Item.sound`) and receiver (`Item.signal`), initially both on `alpha`. Change only the sound definition to `beta`, delete it, and supply a malformed sound assignment; each case yields no private playback while the guard still treats the sound as assigned. Editing a shared definition used by both sound and receiver would keep their channels matched, so it is not this negative control.

```ts
const definitions = new Map([["Item.signal", definition()], ["Item.sound", definition()]]);
const lookup = (uuid: string) => definitions.get(uuid) ?? null;
const views = selectedObservers([token("Token.near", { rank: 0 }),
    token("Token.far", { rank: 2, x: 300, elevation: 20, levelId: "upper" })], owner, lookup);
const frame = buildSensoryAudioFrame([document], views, lookup, sources, configurePlayback);
expect([...frame.values()].map(playback => playback.volume)).toEqual([0.25]);
expect(buildSensoryAudioFrame([document], [], lookup, sources, configurePlayback).size).toBe(0);
```

Add two same-file/same-channel sources and assert a single winning playback; add a different channel and assert it has its own isolated voice. Existing native audio aggregates by path; grouping by `(path, channel)` preserves the strongest-source behaviour within an identical sensory gate without letting another channel activate it. Confirm the rank-0 token remains selected and owned, so it is excluded specifically for its inactive application rather than another guard.

- [ ] Run `npm test -- tests/node/sensory/audio.test.ts`; confirm the eligible-listener/winning-source assertions fail before implementation.
- [ ] Maintain native point sound sources for assigned scene sound documents across levels, including sources without rendered objects. Use a `codex-foundry.sensory:<document.uuid>` sourceId, `CONFIG.Canvas.soundSourceClass`, and native document data: x/y, absolute elevation, `canvas.inferLevelFromElevation(elevation, { levels })`, prepared pixel radius, walls, path, volume, easing and effects. Initialize and attach these sources for native geometry updates; the guard excludes the private prefix from ordinary playback. Mirror native hidden/path/radius/darkness eligibility, and never substitute current-level rendering visibility for source existence. Remove stale scene sources and voices on document deletion or teardown.

```ts
const level = canvas.inferLevelFromElevation(document.elevation, { levels: document.levels });
const sourceData = {
    x: document.x, y: document.y, elevation: document.elevation, level: level.id,
    radius: document.shape.radius, walls: document.walls, path: document.path,
    volume: document.volume, easing: document.easing,
    effects: foundry.utils.deepClone(document.effects), preview: false,
    disabled: document.hidden || !document.path || document.radius <= 0
        || !canvas.darknessLevel.between(document.darkness.min, document.darkness.max),
};
const source = new CONFIG.Canvas.soundSourceClass({
    sourceId: `codex-foundry.sensory:${document.uuid}`,
});
source.initialize(sourceData);
source.add();
```

`sourceData` is built from native sound fields, not from a glow radius or a clipped tile. Read source data from the native AmbientSound helper when an object exists; build the equivalent typed boundary above when it does not. Private source data has no `object` dependency. Do not require a source to be rendered or a level to be available for player navigation.

- [ ] For each assigned document resolve the shared channel. Filter observers by matching enabled hearing and its minimum rank. Use their native `listener` positions with elevation. Select the greatest positive `document.volume * source.getVolumeMultiplier(listener, { easing: document.easing })`; pass its source/listener/walls config to native `_configurePlayback`. Keep its returned muffled/volume behaviour. Compare candidates within a `(path, channel)` bucket as the native engine does before configuration; retain a stable source UUID to break ties.

```ts
const eligible = observers.filter(viewer => viewer.applications.some(application =>
    application.definition.channel === channel && application.definition.hearing.enabled
    && application.rank >= application.definition.hearing.minRank));
const key = JSON.stringify([document.path, channel]);
```

Drive one private voice for each winning bucket. Voices missing from the next frame receive `sync(null)` immediately before scheduling new asynchronous work. A broken reference never enters an ordinary bucket. Recompute the entire frame after definition changes and selection/ownership revocation instead of applying a stale sound-only predicate.

- [ ] Extend the existing lifecycle with item/actor/user/world-time/combat events, ambient-sound updates/deletions, wall/surface/level changes, native `soundsRefresh`, audio unlock refresh, and canvas teardown. A stopped or locked client recomputes from current state when audio unlocks; pending callbacks do not retain old listeners. Route explicit native GM `previewSound(position)` as an authoring-only preview, preserve its cursor/elevation settings, and cancel that preview contribution when it ends. Gameplay has no GM-all-sounds bypass.
- [ ] Run green tests and common checks. In separate owner/non-owner clients verify native falloff, walls and muffling, darkness, elevation/level coverage, same-file sources, definition edits/deletion, selection/ownership loss while loading, explicit GM preview, scene changes and reloads. Also verify the custom-rules master switch is off. Commit `feat: play sensory audio through eligible elevated listeners`.

## Task 11: Workflow documentation and complete acceptance

**Files:** modify `README.md`; create `docs/testing/sensory-effects.md`. Any executable corrections return to their owning slice and rerun its checks; do not hide a new feature or unrelated cleanup in this documentation slice.

**Interfaces:** document the actual shipped native controls and flag names from tasks 1–10. No new runtime API or campaign preset is introduced.

- [ ] Document creating a world Effect, choosing a channel, configuring emission and receiver thresholds/range, applying it to an actor, adjusting its counter, assigning it to a tile, and associating an Ambient Sound. Explain shared definitions versus individual ranks, selection plus OWNER permission, multiple selected viewpoints, cross-floor 3D range/cues, unresolved source repair, and native sound preview. Use a clearly illustrative in-game channel rather than shipping an automatic campaign item.
- [ ] Record the installed Foundry/PF2e versions and a disposable scene with two owned tokens, another user's token, walls, unexplored fog, a clipped tile with a hole, sources above and below on unrendered floors, and private/ordinary same-file audio. Record actual observations for each scenario, screenshots for glows and audio output/gain observations for private voices. Empty audio because of autoplay lock is not a passing privacy test.
- [ ] Execute the following workflow in the GM and both player sessions: save/reload definition and references; apply the Effect natively; raise/lower ranks; select/deselect one and multiple owned tokens; select a non-owned token where the client permits it; edit/delete the shared definition; expire/remove an application; revoke ownership during loading; change source paths and assignments; change levels/scenes; reload. The owner receives only eligible channels and the non-owner receives none; changing the definition preserves all ranks. Confirm no map/fog/other-floor artwork or level-navigation access is revealed.
- [ ] Run `npm run verify` and `git diff --check`. Read every changed line personally, validate documentation against runtime results, and obtain the independent GPT-6 Astra review required by the chosen execution method. Fix material findings and rerun only affected checks plus the final required gate when code changes warrant it. Do not delegate the primary review.
- [ ] Commit the accurate README and evidence as `docs: explain sensory Effect workflows and record runtime verification`. Report local checks, runtime versions, observed behaviour and any genuine remaining blocker. Do not claim completion if runtime verification remains unavailable or failing.
