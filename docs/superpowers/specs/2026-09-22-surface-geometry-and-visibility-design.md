# Surface geometry and deck visibility

Status: design and [implementation plan](../plans/2026-09-22-surface-geometry.md) approved and implemented on 2026-09-22. GM runtime verification is recorded in [surface visibility testing](../../testing/surface-visibility.md); player acceptance remains user-owned. This extends the [regions and movement design](2026-09-21-regions-movement/README.md).

## Outcome

Codex must distinguish a climbable solid ledge from a suspended deck with empty space underneath. A lower floor is a possible landing, not evidence of a connecting wall. Map Workshop must preserve the physical extent of its authored surfaces through export and import. GMs can configure equivalent surfaces directly in Foundry.

A grated catwalk supports creatures while permitting sight and light through the deck. Physical support, sight, light and artwork visibility are independent properties. A bridge is an authoring preset, not a separate traversal algorithm.

The acceptance example is Tessa on the Mining Site bridge: the deck is at +5 ft and a nearby lower floor is at −17.5 ft. The existing 22.5 ft climb is an invented connection. The actual underside is not yet authored; this design does not assign the campaign bridge a thickness.

## Confirmed scope and constraints

- Codex owns region geometry interpretation and PF2e/SF2e movement. Workshop owns its authored span map, rendering and export. The importer remains optional and imports without Codex.
- Preserve existing floor and water behaviour names, IDs, DCs and unrelated data. Add geometry independently of the existing floor-height field.
- Keep the approved ground-first movement preference. Automatic Climb down for drops greater than 5 ft requires a continuous eligible face; explicit Climb attempts need a valid face too.
- Existing Climb/Swim checks, exploration switches, temporary override, outcome mode, forced-movement controls, statuses, reactions and compact previews remain applicable.
- Disabling checks waives checks, never missing physical support. Speed and feats cannot create a wall across open air.
- Offer Solid terrain, Solid bridge/balcony and Grated catwalk presets; sight and light remain individually editable. Sound remains separately configurable, without a new acoustic simulation.
- Include native vision/light and deck-artwork visibility verification. Automatic cover, attacks through grates, rails, ladders, ropes, ceiling traversal and full 3D collision simulation are outside this change.
- Use the current checkouts, preserve existing uncommitted work, and do not commit or publish PRs as part of this design stage.
- Runtime testing uses only Testing Scene and the built-in GM browser. The user owns player-client testing; PF2e runtime is waived. Do not modify Tessa, campaign geometry or campaign visibility settings during tests.

## Evidence and boundaries

Workshop's `spans.js`, `span-map.js` and `span-projection.js` represent open intervals from floor to ceiling; separated intervals have solid material between them. `foundry-export.js:heightLoops` currently merges surface cells solely by top height, and `foundry-geometry.js:floorRegion` exports a zero-height floor plane. The exporter consequently discards the underside information needed here.

Codex's `canvas/regions/support.ts` returns region identity, height and level. `movement/transitions.ts` currently classifies changes primarily by height difference. `movement/preview.ts` and execution share that plan; the new geometry query must feed both rather than introduce a second preview-only rule.

Foundry 14 has independent native [surface restrictions](https://foundryvtt.com/api/classes/foundry.data.regionBehaviors.DefineSurfaceRegionBehaviorType.html) for movement, sight, light and sound. [Tile occlusion modes](https://foundryvtt.com/api/variables/CONST.OCCLUSION_MODES.html) are a separate mechanism. The installed 14.368 source also combines enabled native surface restrictions, so adding a transparent surface does not cancel a pre-existing opaque one.

A read-only campaign audit also found asymmetric level visibility: Lower Region has an empty visible-level list; Upper Region includes Lower Region. Boots is on Lower Region, so upper tokens are excluded before ordinary sight testing. The current exporter already emits mutual other-level visibility, so this live configuration is not evidence of a current export defect. Center-to-center native surface tests also intersect an opaque upper floor between Boots and Tessa/Shellbarrager/Aspect-12; the Boots–Lesath ray has no such surface hit. These surface tests are not full player-vision verification, and no token or scene setting was changed. Cross-level inclusion and physical sight obstruction must be diagnosed separately.

After the user enabled Upper Region in Lower Region, lower-level terrain became obscured by upper artwork. The GM browser was confirmed to be viewing Lower Region. A read-only audit found all four upper floor surfaces with native occlusion=false, and the three exported upper terrace tiles with empty occlusion modes. Their current elevations are all 0 although their exporter height flags are 1, 2 and 3 (normally 2.5, 5 and 7.5 ft). This is current scene data, not proof of how or when it changed. Other decorated tiles have their own occlusion settings; do not bulk overwrite them. Mutual visible-level inclusion must therefore be accepted together with artwork configuration, not offered as a standalone campaign fix.

Workshop's current terrace images include every floor at a given height or above. They cannot be faded wholesale to expose a catwalk without affecting unrelated terrain.

## Region geometry contract

Introduce one additive **Surface Geometry** behaviour on a region that already has a floor behaviour. Codex owns `codex-foundry.surfaceGeometry`; the importer registers an inert compatible `map-workshop-importer.surfaceGeometry` subtype for standalone imports.

Proposed persisted geometry:

| Field | Meaning |
|---|---|
| `extent` | `unknown`, `solid` or `finite` |
| `underside` | Absolute scene elevation in feet for `finite`; null otherwise |
| `blocksSight` | Whether the authored deck obstructs sight through it |
| `blocksLight` | Whether the authored deck obstructs light through it |

The existing floor behaviour remains the sole authority for the top elevation and Climb/Grab an Edge DCs. A finite underside must be below the top. Thickness is an editing convenience calculated as top minus underside, not a second persisted authority. Presets populate these properties; individual edits remain possible.

- **Unknown:** no assertion about solid extent. Missing geometry on legacy regions has this meaning.
- **Solid:** material continues below this floor through the relevant local descent. This is an authored assertion, never inferred just because another floor exists.
- **Finite:** material occupies the interval from underside to floor top. It provides no connecting face below the underside.

Solid terrain and solid deck presets block sight/light. Grated catwalk has finite extent and allows both. Sound is configured on the native surface and is not silently changed by these presets. Geometry does not change water depth, fog permissions or token ownership.

More than one enabled geometry definition for the same floor, contradictory extents, or ambiguous overlapping surfaces must produce an explicit authoring/ruling result. Do not select whichever definition happens to be first. Footprints with differing extents must remain distinct, even if top heights match.

## Traversal contract

At each already-traced boundary, query both support surfaces and the exposed vertical face between the source and destination. The query returns one of: a continuous face covering the required elevation interval; an unsupported gap; or unknown/ambiguous geometry. It reports the owning region for the applicable DC. Geometry facts contain no PF2e policy.

For descent the relevant material is on the upper/source side; for ascent it is on the higher/destination side. Verify that the movement side has open space. Do not climb through another slab or assume every polygon boundary is an exposed face. Continue to use authored footprints and holes across native levels, without inventing support from a level's base.

- A known continuous face uses the existing Climb flow, Speed/feat handling and exploration policy. Retain the relevant face for partial movement and subsequent checks.
- An unsupported gap uses the existing loss-of-support decision, including eligible flight and fall reactions. Ordinary movement stops at the edge for that decision; it does not automatically climb to the underside and then release the creature.
- Unknown geometry asks for a GM ruling. Existing GM Resolve manually remains an explicit bypass with native wall/door collision.
- Forced movement remains forced movement. It is never converted into voluntary climbing.
- A creature below a suspended deck cannot climb up empty space to its top. An explicit route such as a rope is not inferred.
- Falls still find the highest eligible landing and water surface across levels. Face extent does not replace landing selection or environmental-protection rules.

The tooltip, chat card and execution must agree on the classification and required distance. Partial climbs do not acquire extra wall length when the original face ends. Check-free exploration and Climb Speed must pass the same geometry test as checked movement.

## Workshop authoring and export

The span map remains the only authored authority. Derive the underside of an upper floor from the immediately preceding open span's ceiling where one exists in that column. A lowest floor with no lower opening is solid according to Workshop's existing closed-rock model; this inference applies to Workshop source data, not arbitrary Foundry scenes.

Expose the derived extent in the existing surface/span inspector and provide the three presets plus explicit sight/light controls. Geometry edits must update the owning span geometry, with its existing validation and undo/redo, rather than maintain conflicting override geometry beside it. The UI must show which floor/ceiling will change when editing thickness. Preserve the editor's current 2.5 ft geometry units; Foundry-authored regions may use fractional-foot extents. Do not silently round a requested thickness to a different value.

A suspended preset requires an actual finite underside; it cannot manufacture an unbounded open space below a lone span. If no lower opening exists, the editor must identify that missing geometry and require authoring the lower opening before treating the surface as suspended. The Foundry manual authoring workflow can explicitly declare a finite underside without a Workshop source map.

Persist sight/light metadata with the owning surface span; migrate old saves with their current opaque defaults. Bump the Workshop save format and exported scene format with explicit readers for supported older versions. Do not discard unknown unrelated metadata or relax existing document limits.

Group exported physics regions by top height, extent/underside and sight/light properties, using the same traced geometry as the map. Split bridge/catwalk portions from solid terrain at the same height. Keep holes and native level membership. Visual image grouping can differ where necessary, but cannot change physical geometry.

## Native vision and artwork

Use core Define Surface behaviours for through-deck sight/light restrictions; do not replace Foundry's vision engine. Codex geometry remains separate from region elevation bands. Where another physical plane is needed for native restrictions, create an explicitly managed companion region rather than changing an existing floor/water region's band as a storage shortcut.

Fresh exports identify their managed native visibility behaviours and companion regions. Their geometry and sight/light settings are generated from the single authored surface definition. Codex can reconcile those managed documents after a GM changes the definition; disabled/deleted definitions remove only their own generated restrictions. This reconciliation must be idempotent and run under GM authority.

For existing scenes, a GM authoring/migration action previews which existing native visibility behaviour will be adopted or replaced. Never disable unrelated user-authored blockers. Report remaining overlapping blockers when they prevent the requested transparent deck; transparency must not pretend to override an opaque native restriction.

Export catwalk/deck artwork separately from unrelated terrain and remove duplicated opaque pixels from combined backgrounds/terrace images. Use native tile/level visibility and occlusion where they satisfy the above/below cases. A transparent deck must allow an otherwise-visible token below to be seen, while leaving solid surroundings opaque. Fading art must never reveal tokens that native vision rejects. Do not change native permissions, fog or ownership to obtain the effect.

The exact native occlusion configuration is a verification task against the installed Foundry build. If native controls cannot satisfy the representative scenes, record the concrete failure and revisit the rendering design before adding a custom visibility engine or claiming completion.

## Import and compatibility

With Codex available, the importer maps the new subtype to Codex alongside floor/water types. Without it, retain inert geometry metadata and functional native sight/light surfaces, with the existing notice that traversal automation requires Codex. Capability detection must include the new subtype so an older installed Codex does not cause unsupported document creation. If an active older Codex cannot interpret the geometry, reject the new export format with an upgrade-or-disable message; importing inert legacy markers would otherwise let the older engine continue its height-only climbing. Standalone import remains available when Codex is disabled.

Legacy Foundry regions stay at their existing elevations and retain their current vision. No bulk inference marks them solid or assigns a thickness. Their missing face geometry becomes a ruling when a climb requires it; this is the deliberate correction to the false-wall assumption. Provide a scoped preview/apply authoring workflow to classify selected known terrain, preserving document IDs and unrelated behaviours.

Re-export/import is not an update-in-place migration of an existing campaign scene. Do not overwrite manual DCs, repaired shapes or token state. The current cavern bridge needs a separately authored extent before its exact traversal can be configured.

## Acceptance and verification

Use red/green tests around observable contracts and one or two realistic failures per slice. Preserve existing movement regression coverage. Required scenarios:

1. Solid 20 ft ledge: up/down Climb, correct upper-face DC, partial continuation, Speed and waived-check variants.
2. Thin suspended deck over a lower floor: no invented full-height Climb, both ascending and descending; the gap remains consequential with checks disabled.
3. Finite rock slab that reaches the destination: valid climb; slab ending above it: unsupported gap. Multiple openings must not be merged into one continuous wall.
4. Bridge over water: deck support when above, water/bed landing below; no underwater Climb invented from the deck height.
5. Forced movement, explicit flight, unknown geometry and conflicting definitions retain the correct decisions. Square, hex and gridless previews agree with execution.
6. Verify mutual visible-level inclusion independently of sight blockers, and retain it through export/import. Solid and grated decks with identical geometry: same support/traversal, different through-deck sight/light. Test observers and targets above/below, a light source on each side, nearby opaque terrain, and a native blocking wall.
7. Artwork: when viewing Lower Region with Upper Region included, lower terrain remains legible, including the campaign-style overlapping backgrounds and terrace tiles. Verify authored artwork elevations as well as occlusion. A visible lower token is not concealed by duplicated opaque catwalk pixels; hidden or unseen tokens remain hidden. GM omniscience alone is not evidence for player vision.
8. Save/load and undo/redo retain surface properties; export partitions equal-height mixed geometry; standalone and Codex imports preserve data; older saves retain opaque defaults.
9. Existing-scene authoring adoption is scoped and repeatable; unrelated native blockers and user data survive.

Codex: focused Vitest tests, full suite, runtime typecheck, lint and build. Workshop: focused Node tests, full `npm test`, browser editor/save/export verification and importer tests. Record known unrelated warnings separately. Live GM work stays in Testing Scene; provide the user a short player-side above/below vision checklist. Restore fixtures, settings and task-created chat after testing.

## Dependency-ordered delivery slices

Each numbered item is one concern; split an item further in the implementation plan if its diff would exceed the repository's size limits. Complete each slice's normal checks before starting the next.

1. Add the geometry data contract, presets and manual Foundry authoring, without changing traversal.
2. Add pure exposed-face queries with finite/solid/unknown geometry fixtures.
3. Consume face facts in movement planning, previews and partial continuation; remove height-only climb assumptions.
4. Persist and edit Workshop surface visibility and derived extents with save migration.
5. Export/import partitioned geometry and compatible behaviour types with format migration.
6. Reconcile explicitly managed native sight/light surfaces and scoped legacy adoption.
7. Separate deck artwork and configure native occlusion; verify above/below vision and export round-trips.
8. Complete cross-repository runtime acceptance, documentation and restoration evidence.

## Design review

The chosen model covers bridges, balconies and cavern slabs without bridge-specific traversal branches. Top elevation has one owner; thickness has one canonical underside; game checks remain separate from geometry; native vision remains separate from artwork. Existing region bands and unknown legacy geometry are not silently reinterpreted. No implementation code, live-scene edits or deployments are authorized by writing this document alone.
