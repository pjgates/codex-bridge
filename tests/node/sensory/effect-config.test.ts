// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { registerSensoryEffectConfig } from "../../../src/canvas/sensory/effect-config.js";
import { registerSensoryTileConfig } from "../../../src/canvas/sensory/tile-config.js";
import { registerSensorySoundConfig } from "../../../src/canvas/sensory/sound-config.js";
import { definition, effect } from "./fixtures.js";
afterEach(() => vi.unstubAllGlobals());
function setup() {
    const hooks: Record<string, (...args: any[]) => void> = {};
    const world = { uuid: "Item.signal", name: "<Signal>", type: "effect", isEmbedded: false, pack: null,
        isOwner: true, flags: { "codex-foundry": { sensory: definition() } }, sheet: { render: vi.fn() } };
    vi.stubGlobal("Hooks", { on: (name: string, callback: any) => { hooks[name] = callback; } });
    vi.stubGlobal("game", { items: new Map([["signal", world]]), i18n: { localize: (key: string) => key } });
    class Item {
        type = "effect"; isEmbedded = false; pack = null;
        constructor(public uuid: string, public flags: object, public sourceId?: string) {}
        toObject() { return { flags: structuredClone(this.flags) }; }
    }
    vi.stubGlobal("CONFIG", { Item: { documentClass: Item } });
    registerSensoryEffectConfig();
    return { hooks, world, Item };
}
it("submits sensory settings once and retains disabled capability values", () => {
    const { hooks, world } = setup();
    const root = document.createElement("form");
    const app = { item: world, isEditable: true };
    hooks.renderItemSheet?.(app, root);
    const channel = root.querySelector<HTMLInputElement>('[name="flags.codex-foundry.sensory.channel"]');
    expect(channel).not.toBeNull();
    channel!.value = "beta";
    const enabled = root.querySelector<HTMLInputElement>('[name="flags.codex-foundry.sensory.glow.enabled"]')!;
    enabled.checked = false;
    enabled.dispatchEvent(new Event("change", { bubbles: true }));
    const submitted = Object.fromEntries(new FormData(root));
    expect(submitted["flags.codex-foundry.sensory.channel"]).toBe("beta");
    expect(submitted["flags.codex-foundry.sensory.glow.range"]).toBe("25");
    expect(submitted).not.toHaveProperty("system.badge");
    hooks.renderItemSheet(app, root);
    expect(root.querySelectorAll('[data-codex-sensory="effect"]')).toHaveLength(1);
});
it("captures the chosen world identity through native serialization regardless of older provenance", () => {
    const { hooks, world, Item } = setup();
    for (const [uuid, sourceId, reference] of [
        ["Item.fresh", undefined, undefined],
        ["Item.imported", "Compendium.pack.Item.original", undefined],
        ["Item.duplicate", "Item.signal", "Item.signal"],
    ]) {
        const flags = { "codex-foundry": { sensory: definition(), ...(reference ? { sensoryDefinition: reference } : {}) } };
        const chosen = new Item(uuid!, flags, sourceId);
        game.items!.set(uuid!.slice(5), { ...world, uuid, flags } as any);
        // PF2e serializes the world item, then constructs/clones data without addSource.
        const copied = new Item("Item.unsaved", chosen.toObject().flags, sourceId).toObject();
        expect(copied.flags).toMatchObject({ "codex-foundry": { sensoryDefinition: uuid } });
        const updateSource = vi.fn();
        hooks.preCreateItem({ ...effect(3), flags: copied.flags, sourceId, actor: {}, updateSource });
        expect(updateSource).toHaveBeenCalledWith({ "flags.codex-foundry.sensoryDefinition": uuid });
    }
    const applied = new Item("Actor.a.Item.copy", { "codex-foundry": { sensoryDefinition: "Item.signal" } });
    applied.isEmbedded = true;
    expect(applied.toObject().flags).toMatchObject({ "codex-foundry": { sensoryDefinition: "Item.signal" } });
});
it("links embedded applications to the definition and stamps native provenance without changing rank", () => {
    const { hooks } = setup();
    const updateSource = vi.fn();
    const item = { ...effect(3), flags: {}, actor: {}, isEmbedded: true, updateSource };
    hooks.preCreateItem?.(item);
    expect(updateSource).toHaveBeenCalledWith({ "flags.codex-foundry.sensoryDefinition": "Item.signal" });
    const root = document.createElement("form");
    hooks.renderItemSheet({ item, isEditable: true }, root);
    expect(root.querySelector('input[name*="sensory."]')).toBeNull();
    expect(root.querySelector('[data-uuid="Item.signal"]')?.textContent).toContain("<Signal>");
    expect(item.badge.value).toBe(3);
});
it("registers native configuration hooks once and rejects non-world application links", () => {
    const { hooks } = setup();
    const on = vi.spyOn(Hooks, "on");
    registerSensoryEffectConfig();
    registerSensoryTileConfig(); registerSensoryTileConfig();
    registerSensorySoundConfig(); registerSensorySoundConfig();
    expect(on.mock.calls.map(([name]) => name)).toEqual(["renderTileConfig", "renderAmbientSoundConfig"]);
    const root = document.createElement("form");
    const item = { ...effect(3), flags: {}, sourceId: "Actor.signal", isEmbedded: true };
    hooks.renderItemSheet({ item, isEditable: true }, root);
    expect(root.querySelector("a")?.textContent).toContain("sensory.missing");
});
