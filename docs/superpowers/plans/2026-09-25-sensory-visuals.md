# Scene-wide Sensory Geometry and Glows

Read the [plan index](2026-09-25-sensory-effects.md), [definitions plan](2026-09-25-sensory-definitions.md), and [approved spec](../specs/2026-09-25-sensory-effects-design.md). Their exact types, constraints and checks apply. These tasks consume production definitions and viewers; they do not grant ordinary sight.

## Task 5: Emission and three-dimensional detection

**Files:** create `S/geometry.ts`, `S/frame.ts`, `T/frame.test.ts`; extend `S/types.ts`, `S/index.ts`, `T/fixtures.ts`; add public geometry exports to `src/canvas/clip-tiles/index.ts`.

**Interfaces:** consume `resolveApplications`, `selectedObservers`, `readTileBindings`, and `DefinitionLookup`. Produce:

```ts
type SensoryWallTest = (viewer: SensoryObserver, emitter: SensoryEmitter) => boolean;
function collectEmitters(scene: SensoryScene, lookup: DefinitionLookup): SensoryEmitter[];
function detectGlows(observers: readonly SensoryObserver[], emitters: readonly SensoryEmitter[],
    distancePixels: number, wallBlocks: SensoryWallTest): SensoryGlow[];
function nativeSensoryWallBlocks(viewer: SensoryObserver, emitter: SensoryEmitter): boolean;
```

`SensoryScene` supplies `tokens`, `tiles`, `regions`, and its distance scale. `SensoryTokenDocument` supplies document geometry from task 2, `getSize()`, `hidden`, and actor items. `SensoryTileDocument` supplies `uuid`, `hidden`, `elevation`, `levels`, `flags`, and prepared `shape.center`/`shape.polygonTree`. `SensoryRing` is structurally compatible with the existing clipping rings. Export `clipRings`, `clipRegionId`, and their `Ring`/`TreeNode` types through the clipping barrel; do not move the clipping implementation.

- [ ] Add an off-level source extraction regression. Build a scene fixture with a rank-3 actor token on `upper`, `object: null`, and an empty rendered-placeables collection. Its native center is `(100, 0, 20)`. Supply a tile on `lower` with no rendered object and a valid Effect binding. Assert `collectEmitters` returns both UUIDs with their stored absolute elevations. Hide the token and assert it is omitted. The fixture only supplies geometry; it does not pre-filter emissions. This protects document extraction that the later range test cannot reach.

- [ ] Add the combined-viewer range contract with independently written expected results:

```ts
it("uses a qualifying viewer's complete 3D range, including unrendered floors", () => {
    const lookup = () => definition(); // 25 scene units
    const views = selectedObservers([token("Token.viewer", { rank: 2 })], owner, lookup);
    const above: SensoryEmitter = {
        documentUuid: "Token.upper", channel: "alpha",
        position: { x: 150, y: 0, elevation: 20, levelId: "upper" },
        strength: 3, colour: "#aabbcc", rings: [],
    };
    const result = detectGlows(views, [above], 10, () => false);
    expect(result.map(glow => [glow.emitter.documentUuid, glow.direction]))
        .toEqual([["Token.upper", 1]]); // sqrt(15^2 + 20^2) = 25
    expect(detectGlows(views, [{ ...above,
        position: { ...above.position, elevation: 20.1 } }], 10, () => false)).toEqual([]);
});
```

Extend the same detector table with a directly overhead source at 20, a directly overhead source outside range, a lower source, a non-matching channel, and a viewer at rank 1 alongside a rank-2 viewer outside range. The last case must detect nothing; ownership/rank from one token cannot borrow the other's nearby position. Add equal-distance eligible viewers in reversed input order and assert stable UUID cue selection.

At these same production boundaries, add a receive-only viewer and emit-only target on a shared channel. Give the target rank-derived strength 3 and fixed strength 5; assert its single winning emission has strength 5 and the fixed definition's colour. Reverse application order and verify the result is unchanged. An emitter must not detect itself, but another eligible selected viewer can detect it. Use a native-tree fixture containing an outer polygon and a hole for a clipped tile; assert both rings reach the frame, and a missing referenced region contributes no footprint. The fixture supplies the native intersection result rather than implementing clipping.

Pin the optional wall branch with the same in-range emission and a collision boundary that always returns true:

```ts
expect(detectGlows(views, [above], 10, () => true)).toHaveLength(1);
const blockedViews = views.map(view => ({ ...view, applications: view.applications.map(app =>
    ({ ...app, definition: { ...app.definition, glow: { ...app.definition.glow, walls: true } } })) }));
expect(detectGlows(blockedViews, [above], 10, () => true)).toEqual([]);
```

Place this assertion in the range test where `views` and `above` are defined. It tests receiver policy; the actual cross-level native ray remains a runtime check.

- [ ] Run `npm test -- tests/node/sensory/frame.test.ts`; confirm extraction and positive-range assertions fail before implementation.
- [ ] Implement `collectEmitters` from scene document collections. Ignore hidden or empty footprints and inactive applications; tiles emit only. Convert definition strength from rank or fixed strength. Select the greatest strength for each document/channel, breaking ties by definition UUID. Do not merge channels or add strengths.

```ts
const rankStrength = application.definition.emission.strength === "rank";
const strength = rankStrength ? application.rank : application.definition.emission.fixed;
const position = { ...token.getCenterPoint(), levelId: token.level };
```

For a token's indistinct marker, derive a 16-point ellipse centered on that native position with radii half its native `getSize()` width and height. This uses document geometry without exposing a texture or requiring a placeable:

```ts
const { width, height } = token.getSize();
const points = Array.from({ length: 16 }, (_, index) => {
    const angle = index * Math.PI / 8;
    return { x: position.x + Math.cos(angle) * width / 2,
        y: position.y + Math.sin(angle) * height / 2 };
});
const rings = [{ points, hole: false }];
```

Use native prepared tile geometry so rotation and texture anchors remain correct. To clip a rectangle tile, use its native polygon with the referenced region's polygon tree; holes are retained without a new clipping algorithm:

```ts
const tileTree = tile.shape.polygonTree;
const footprint = region
    ? region.polygonTree.intersectPolygon(tileTree.polygons[0])
    : tileTree;
const rings = clipRings(footprint);
```

Skip an empty native tile shape before accessing its polygon. A missing selected clip region suppresses that tile's sensory footprint and is shown as unresolved configuration; do not reveal the full unclipped rectangle. Retain the tile's own absolute elevation and infer its source level with `canvas.inferLevelFromElevation(tile.elevation, { levels: tile.levels })` in the runtime adapter. Source position is the native shape center, not a mesh or a level-base offset.

- [ ] Implement detector eligibility and nearest qualifying cue selection:

```ts
const distance = Math.hypot((emitter.position.x - viewer.position.x) / distancePixels,
    (emitter.position.y - viewer.position.y) / distancePixels,
    emitter.position.elevation - viewer.position.elevation);
const capable = viewer.applications.some(application => {
    const { definition, rank } = application;
    return definition.channel === emitter.channel && definition.glow.enabled
        && rank >= definition.glow.minRank && distance <= definition.glow.range
        && (!definition.glow.walls || !wallBlocks(viewer, emitter));
});
```

Exclude a viewer's own token for that viewer only. Sort qualifying viewers by distance then token UUID, choose the first, and set direction from the sign of emitter elevation minus that viewer's elevation. Return each emitter once. Do not round distances to grid steps or use PF2e attack reach.

- [ ] Implement the native wall adapter with `foundry.canvas.perception.DetectionMode._testCollision`, verified in the inspected v14 bundle. Supply a position-only ray source with `origin`, resolved origin `level`, and priority; pass the emitter point and resolved destination `level`, plus `{ type: "sight", angle: 360 }`. This bypasses the ordinary detection-mode eligibility checks while retaining the native cross-level ray/surface calculation. Verify the structural source contract in the installed runtime before using it; if the backend requires an additional real source field, adapt this local boundary rather than constructing a fake world token or copying collision code. The wall-ignoring branch never invokes this adapter.
- [ ] Run green tests and common checks. In disposable Foundry test the native ray adapter with wall blocking both enabled and disabled and with a source on another level. Commit `feat: detect sensory emissions across scene levels`.

## Task 6: Private glow rendering and event cleanup

**Files:** create `S/glow.ts`, `S/lifecycle.ts`, `T/lifecycle.test.ts`; extend `S/index.ts`; modify `src/hooks/ready.ts`. The renderer consumes task 5; it does not add another detection model.

**Interfaces:** produce `renderSensoryGlows(glows: readonly SensoryGlow[]): void`, `clearSensoryGlows(): void`, `activateSensoryCanvas(): void`, and `refreshSensoryGlows(): void`. `activateSensoryCanvas` registers event callbacks once, schedules a fresh frame from current documents, and clears the overlay on canvas teardown. Task 10 extends the same lifecycle with audio callbacks.

- [ ] Add a lifecycle test that registers the real feature callbacks and drives selection, ownership, definition deletion, and canvas teardown through them. Inject only the external canvas render boundary and document fixtures via Foundry globals; do not export a test-only renderer. The owned selected state produces an upper-floor marker. The non-owner or deselected state renders an empty frame; after teardown a queued frame cannot restore the former marker.

```ts
hooks.controlToken();
flushAnimationFrame();
expect(rendered.map(glow => glow.emitter.documentUuid)).toEqual(["Token.upper"]);
selected.length = 0;
hooks.controlToken();
flushAnimationFrame();
expect(rendered).toEqual([]);
hooks.canvasTearDown();
flushAnimationFrame();
expect(rendered).toEqual([]);
```

`hooks` captures registrations and `rendered` records frame values, rather than computing sensory eligibility in the fixture. Test the queued-teardown order because it is a lifecycle risk not owned by the detector tests. Inspect the native hooks used by the installed runtime; register through the feature's actual activation function.

- [ ] Run `npm test -- tests/node/sensory/lifecycle.test.ts` and confirm the initial visible marker and teardown regression fail before wiring.
- [ ] Draw private PIXI Graphics in a dedicated non-interactive container under `canvas.interface`, following the existing flanking overlay's canvas integration. Use frame polygons/holes rather than token textures. Apply a small blur to the fill, with a footprint mask after blur so a clipped tile stays within its shape. Map strength monotonically to bounded intensity, for example `0.8 * strength / (1 + strength)`. Draw a small vector up/down cue for nonzero direction; never add names, numeric heights, hover handlers, or targeting handlers.

```ts
const container = canvas.interface.addChild(new PIXI.Container());
container.eventMode = "none";
const graphics = container.addChild(new PIXI.Graphics());
graphics.beginFill(Number.parseInt(glow.emitter.colour.slice(1), 16),
    0.8 * glow.emitter.strength / (1 + glow.emitter.strength));
for (const ring of glow.emitter.rings) {
    if (ring.hole) graphics.beginHole();
    graphics.drawPolygon(ring.points.flatMap(point => [point.x, point.y]));
    if (ring.hole) graphics.endHole();
}
graphics.endFill();
```

Reuse/rebuild only this feature's containers; do not attach filters to native meshes. Destroy graphics, masks and queued animation frames on teardown. The runtime supplies real rings; the detector range fixture's empty rings are not a production geometry shortcut.

- [ ] Refresh on `controlToken`, relevant token/item/actor/tile/region/level updates and deletions, `updateUser`, `updateWorldTime`, `updateCombat`, canvas ready/level change, and teardown. Expiry can change through world time/combat without an Item update, so resolve prepared expiry each frame. Use `refreshToken` position/elevation flags during movement animations; subscribe only to flags that affect the output. Schedule at most one animation frame and always read the newest selection/ownership state when it runs.
- [ ] Activate before `onReady` returns for disabled house rules. Register configuration in `onInit`; world data is not ready there. Keep feature init/ready idempotent and protect against a not-yet-ready canvas at this lifecycle boundary.
- [ ] Run green tests and common checks. In Foundry verify owner versus non-owner, two selected owners, rank changes and shared edits, unexplored fog, a wall, off-level token/tile signals, both vertical cue directions, clipped water holes, scene changes, and reloading. Capture screenshots for low/high ranks and confirm other-floor artwork and fog exploration remain unchanged. Commit `feat: render private sensory glows with lifecycle cleanup`.
