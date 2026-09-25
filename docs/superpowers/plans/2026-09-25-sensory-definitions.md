# Sensory Definitions and Configuration

Read the [plan index](2026-09-25-sensory-effects.md) and [approved spec](../specs/2026-09-25-sensory-effects-design.md) first. Inherit their constraints, types, check commands and review requirements. `S/` and `T/` use the index's exact path aliases. Each numbered task is one reviewable slice.

## Task 1: Shared definitions and application ranks

**Files:** create `S/types.ts`, `S/definition.ts`, `S/index.ts`, `T/fixtures.ts`, `T/definition.test.ts`.

**Interfaces:** produce `readDefinition(raw: unknown): SensoryDefinition | null`, `resolveApplications(items: Iterable<SensoryItem>, lookup: DefinitionLookup): SensoryApplication[]`, and `lookupWorldDefinition(uuid: string): SensoryDefinition | null`. `SensoryItem` reads `type`, `flags`, `sourceId`, `isExpired`, and `badge`; only a counter badge's numeric value is a rank, otherwise rank is 1. `lookupWorldDefinition` accepts only a matching unembedded world Effect, then parses its sensory flag. It is the production adapter passed to later functions.

- [ ] Write independently authored fixtures with these values, not copies of production defaults:

```ts
export const owner = { id: "viewer" };
export function definition(): SensoryDefinition {
    return {
        channel: "alpha",
        emission: { enabled: true, strength: "rank", fixed: 1, colour: "#aabbcc" },
        glow: { enabled: true, minRank: 2, range: 25, walls: false },
        hearing: { enabled: true, minRank: 1 },
    };
}
export function effect(rank: number, uuid = "Item.signal") {
    return {
        type: "effect", sourceId: uuid, isExpired: false,
        flags: { "codex-foundry": { sensoryDefinition: uuid } },
        badge: { type: "counter", value: rank },
    };
}
```

- [ ] Add the shared-edit regression at the application-resolution boundary:

```ts
it("reads edited definitions without changing ranks or reviving deleted sources", () => {
    const item = effect(3);
    const definitions = new Map([["Item.signal", definition()]]);
    const lookup = (uuid: string) => definitions.get(uuid) ?? null;
    expect(resolveApplications([item], lookup)[0].rank).toBe(3);
    definitions.set("Item.signal", { ...definition(), channel: "beta" });
    expect(resolveApplications([item], lookup)[0].definition.channel).toBe("beta");
    definitions.clear();
    expect(resolveApplications([item], lookup)).toEqual([]);
});
```

Add a table-driven boundary case accepting the valid fixture and rejecting an enabled glow with range 0, a missing channel, and a malformed emission field. Add an expired item case and a non-counter item yielding rank 1. These protect the flag/persistence contract; no existing tests cover sensory definitions.

- [ ] Run `npm test -- tests/node/sensory/definition.test.ts`. Introduce typed empty exports if needed to get beyond missing-module setup, then confirm the valid/shared-edit assertions fail before behaviour is added.
- [ ] Implement explicit flag decoding: booleans stay booleans; channel must be non-empty; enabled thresholds are positive integers; enabled range and fixed strength are finite positive numbers; colour is a six-digit hex value. Disabled numeric controls retain their values and need not satisfy an enabled capability's range requirement. Invalid definitions return null, never a partially active receiver.

```ts
const uuid = item.flags?.[MODULE_ID]?.sensoryDefinition;
const reference = uuid === undefined ? item.sourceId : uuid;
// An explicit bad reference is not permission to use copied settings or provenance instead.
if (item.type !== "effect" || item.isExpired || typeof reference !== "string") continue;
const definition = lookup(reference);
if (!definition) continue;
const rank = item.badge?.type === "counter" ? item.badge.value : 1;
if (rank > 0) applications.push({ definitionUuid: reference, definition, rank });
```

The decoder returns typed module flags; do not use unchecked nested casts on persisted input. Use `game.items` and document identity for the runtime lookup; reject actor-owned and compendium-only references. A world template's duration does not expire its definition; expiry applies to embedded applications.

- [ ] Run focused green tests and the index's common checks. Read the staged diff and commit only this slice as `feat: resolve shared sensory definitions and ranks`.

## Task 2: Selected owned viewpoints

**Files:** create `S/observers.ts`, `T/observers.test.ts`; extend `S/types.ts`, `S/index.ts`, `T/fixtures.ts`.

**Interfaces:** consume task 1's `resolveApplications`; produce `selectedObservers(selected: Iterable<SensoryTokenDocument>, user: SensoryUser, lookup: DefinitionLookup): SensoryObserver[]`. A token document provides `uuid`, `level`, `actor`, `getCenterPoint()`, and `getListenerPosition()`. The actor provides `items` and `testUserPermission(user, "OWNER")`. The caller supplies `canvas.tokens.controlled.map(token => token.document)`, not all owned scene tokens.

- [ ] Add `token(uuid, options)` to `T/fixtures.ts`. Options are `{ owns?: boolean; rank?: number; x?: number; y?: number; elevation?: number; levelId?: string }`. Default to ownership true, rank 2, position `(0, 0, 0)`, level `ground`; its native geometry methods return those supplied positions, and its actor carries `effect(rank)`. It implements no sensory filtering. Add the contract test:

```ts
it("combines selected owners without borrowing capabilities from another token", () => {
    const lookup = () => definition();
    const selected = [token("Token.a", { rank: 2 }), token("Token.b", { rank: 1 }),
        token("Token.c", { owns: false, rank: 3 })];
    const views = selectedObservers(selected, owner, lookup);
    expect(views.map(view => view.tokenUuid).sort()).toEqual(["Token.a", "Token.b"]);
    expect(views.find(view => view.tokenUuid === "Token.b")!.applications[0].rank).toBe(1);
    expect(selectedObservers([], owner, lookup)).toEqual([]);
});
```

This guards the explicit selection/ownership contract. Test Observer permission as insufficient using the same boundary; assigned character does not enter this function. Keep rank filtering for particular capabilities in their consumers, so the stage-1 token can still hear.

- [ ] Run `npm test -- tests/node/sensory/observers.test.ts`; confirm the positive owner assertion fails before implementation.
- [ ] Resolve actor ownership before reading applications. Preserve separate visual and native listener positions with their elevation and level. Remove actor-less and non-owner tokens; keep each eligible token's own application list. Export through `S/index.ts` for the production orchestrator.

```ts
if (!document.actor || !document.actor.testUserPermission(user, "OWNER")) continue;
const applications = resolveApplications(document.actor.items, lookup);
if (!applications.length) continue;
const position = { ...document.getCenterPoint(), levelId: document.level };
const listener = { ...document.getListenerPosition(), levelId: document.level };
views.push({ tokenUuid: document.uuid, position, listener, applications });
```

- [ ] Run focused green tests, common checks, personal diff review, and commit `feat: resolve sensory viewpoints from selected owners`.

## Task 3: Effect editor and canonical application

**Files:** create `S/effect-config.ts`, `S/reference-select.ts`, `S/lang/en.json`, `T/effect-config.test.ts`; extend `S/index.ts`; modify `src/hooks/init.ts`.

**Interfaces:** consume task 1's decoder and lookup. Produce `registerSensoryEffectConfig(): void` and `sensoryReferenceSelect(currentUuid: string): HTMLSelectElement`. The select is shared by tasks 4 and 7; it lists configured world Effects and retains an explicitly labelled unresolved current reference. Effect registration handles `renderItemSheet` and `preCreateItem`. Normalize HTMLElement/jQuery roots with `src/shared/html.ts`.

- [ ] Use happy-dom for the real form boundary, not a source-string inventory. Register the hooks, invoke `renderItemSheet` with an editable world Effect, fill its sensory controls, and dispatch its native form change/submit workflow. Have the fixture document record submitted updates as an independent persistence boundary. Assert the saved channel and enabled glow range, then render again and assert the user still has a single editable sensory section. Include an embedded Effect with rank 3: its section links to the definition, exposes no copied settings editor, and never writes its badge.

```ts
const field = root.querySelector<HTMLInputElement>(
    'input[name="flags.codex-foundry.sensory.channel"]')!;
field.value = "beta";
field.dispatchEvent(new Event("change", { bubbles: true }));
// Assert the native-submit fixture receives the beta flag, not a change to system.badge.
```

The production form is the owner boundary for these tests; the fixture only collects its submitted fields. Define `root` as the real fixture form and `submitted` as the fields collected from that form, with checkbox and number values following their HTML types; after submission assert `submitted["flags.codex-foundry.sensory.channel"] === "beta"`, the entered positive range is retained, and no `system.badge` key is present. In Foundry verify the native submit separately, since a DOM fixture cannot prove PF2e sheet persistence.

- [ ] Run `npm test -- tests/node/sensory/effect-config.test.ts` and confirm the editable form/persisted-values assertions fail before controls are added.
- [ ] Append a fieldset labelled **Sensory** using DOM-created elements and localized text. Use exact names rooted at `flags.codex-foundry.sensory`: `channel`, `emission.enabled`, `emission.strength`, `emission.fixed`, `emission.colour`, `glow.enabled`, `glow.minRank`, `glow.range`, `glow.walls`, `hearing.enabled`, `hearing.minRank`. Native checkbox/select/number/color controls supply values. Update `required`, `min`, and editability from unsaved toggles; preserve disabled settings rather than replacing them. Keep initial capabilities disabled and require the GM to supply a range before enabling glow perception.

```ts
const section = root.querySelector('[data-codex-sensory="effect"]');
if (section) return;
const fieldset = window.document.createElement("fieldset");
fieldset.dataset.codexSensory = "effect";
const input = window.document.createElement("input");
input.name = `flags.${MODULE_ID}.sensory.channel`;
input.type = "text";
input.value = definition?.channel ?? "";
```

Do not use unchecked `innerHTML` for item names or channels. In read-only sheets show a summary. In embedded sheets link to the canonical world item; offer editing only if its native permissions allow it. The reference select uses UUID values and labels from world item names, with a visible repair option for a deleted source.

- [ ] In `preCreateItem`, for an actor-owned Effect with a valid canonical reference or native world-copy provenance, call `item.updateSource({ ["flags.codex-foundry.sensoryDefinition"]: uuid })`. Do not write another document, copy the settings onto the actor, or stamp an actor/compendium item as the canonical definition. Add the creation-boundary regression using the fixture's `sourceId` and verify the reference is recorded while badge rank stays unchanged.
- [ ] Run green tests and common checks. In disposable Foundry create a world Effect, configure it, drag it onto a PC, confirm native rank controls, then edit the world channel and observe application resolution using the new definition. Record core/system versions and successful source provenance. Commit `feat: configure sensory definitions on native Effect sheets`.

## Task 4: Tile Effect bindings

**Files:** create `S/tile-config.ts`, `T/tile-config.test.ts`; extend `S/definition.ts`, `S/index.ts`, `S/lang/en.json`; modify `src/hooks/init.ts`.

**Interfaces:** consume `sensoryReferenceSelect` and `DefinitionLookup`. Produce `readTileBindings(raw: unknown): { effectUuid: string; rank: number }[]` and `registerSensoryTileConfig(): void`. The binding flag is `flags.codex-foundry.sensoryEffects`. Tile bindings supply emission only; a tile never becomes an observer.

- [ ] Register `renderTileConfig` in a happy-dom fixture. Choose two different Effect UUIDs, set ranks 1 and 4, remove the first row, and collect native submitted form data. Assert the remaining binding is the second UUID with rank 4, rather than an index-shifted first UUID. Reopen and preserve a missing source's UUID and rank so the user can repair it. This covers list editing and stored-reference integrity, not a duplicated parser inventory.

```ts
expect(readTileBindings([{ effectUuid: "Item.signal", rank: 4 }]))
    .toEqual([{ effectUuid: "Item.signal", rank: 4 }]);
expect(readTileBindings([{ effectUuid: "Item.signal", rank: -1 }])).toEqual([]);
```

- [ ] Run `npm test -- tests/node/sensory/tile-config.test.ts`; confirm the actual row-edit/save regression fails before implementation.
- [ ] Add a **Sensory Effects** fieldset beside existing tile appearance controls. Add/remove rows with an Effect select and integer rank input, keeping field names at `flags.codex-foundry.sensoryEffects.<index>.effectUuid` and `.rank`. Wrap this augmented TileConfig instance's inherited `_processFormData(event, form, formData)` once: call the original, then normalize its expanded sensory row object to an array before native validation/submission. This is the v14 DocumentSheetV2 boundary inspected in the bundle; confirm its actual return shape in the installed runtime. Preserve unrelated tile flags, especially `clipRegion`.

```ts
const select = sensoryReferenceSelect(binding.effectUuid);
select.name = `flags.${MODULE_ID}.sensoryEffects.${index}.effectUuid`;
const rank = window.document.createElement("input");
rank.name = `flags.${MODULE_ID}.sensoryEffects.${index}.rank`;
rank.type = "number"; rank.min = "0"; rank.step = "1";
rank.value = String(binding.rank);
```

The normalization after the original `_processFormData` call is:

```ts
const flags = (submitData.flags ??= {});
const moduleFlags = (flags[MODULE_ID] ??= {});
const indexed = moduleFlags.sensoryEffects;
moduleFlags.sensoryEffects = indexed ? Object.values(indexed) : [];
```

Only numeric non-negative integer ranks and non-empty world Item UUIDs are accepted as bindings. Rank 0 contributes no emission. Invalid persisted rows stay inactive; the configuration reads the raw stored rows for repair instead of showing only the runtime parser's accepted rows. Add fields once on repeated renders, and rely on native GM tile edit permissions. Removing the last row saves an empty array, rather than omitting the flag and accidentally retaining the previous binding.

- [ ] Run focused green tests and common checks. In Foundry save two rows, reload, remove one, and confirm the other rank/reference survives along with existing clipping. Commit `feat: assign ranked sensory Effects to tiles`.
