// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { registerSensoryEffectConfig } from "../../../src/canvas/sensory/effect-config.js";
import { effect } from "./fixtures.js";
afterEach(() => vi.unstubAllGlobals());
function setup() {
    const hooks: Record<string, (...args: any[]) => void> = {};
    const world = { uuid: "Item.signal", name: "<Signal>", type: "effect", isEmbedded: false, pack: null,
        isOwner: true, system: { rules: [] }, flags: {}, sheet: { render: vi.fn() } };
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
function sheetForm() {
    const root = document.createElement("form");
    root.innerHTML = '<section class="tab" data-tab="details"><input name="system.badge.value" value="3"></section>'
        + '<section class="tab" data-tab="rules"><input name="system.rules.0.channel" value="alpha"></section>';
    return root;
}
it("leaves world Effect editing to native rule forms without adding Details controls", () => {
    const { hooks, world } = setup();
    const root = sheetForm();
    const app = { item: world, isEditable: true };
    hooks.renderItemSheet?.(app, root);
    hooks.renderItemSheet(app, root);
    expect(root.querySelector('[data-codex-sensory="effect"]')).toBeNull();
    expect(Object.fromEntries(new FormData(root))).toEqual({
        "system.badge.value": "3", "system.rules.0.channel": "alpha",
    });
});
it("captures the chosen world identity through native serialization regardless of older provenance", () => {
    const { hooks, world, Item } = setup();
    for (const [uuid, sourceId, reference] of [
        ["Item.fresh", undefined, undefined],
        ["Item.imported", "Compendium.pack.Item.original", undefined],
        ["Item.duplicate", "Item.signal", "Item.signal"],
    ]) {
        const flags = { "codex-foundry": { ...(reference ? { sensoryDefinition: reference } : {}) } };
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
it("links the canonical definition once in Rules while preserving native form controls and rank", () => {
    const { hooks, world } = setup();
    const updateSource = vi.fn();
    const item = { ...effect(3), flags: {}, actor: {}, isEmbedded: true, updateSource };
    hooks.preCreateItem?.(item);
    expect(updateSource).toHaveBeenCalledWith({ "flags.codex-foundry.sensoryDefinition": "Item.signal" });
    const root = sheetForm();
    hooks.renderItemSheet({ item, isEditable: true }, root);
    hooks.renderItemSheet({ item, isEditable: true }, root);
    expect(root.querySelector('input[name*="sensory."]')).toBeNull();
    const link = root.querySelector<HTMLAnchorElement>('.tab[data-tab="rules"] [data-uuid="Item.signal"]');
    expect(link?.textContent).toContain("<Signal>");
    link!.click();
    expect(world.sheet.render).toHaveBeenCalledWith(true);
    expect(root.querySelectorAll('[data-codex-sensory="effect"]')).toHaveLength(1);
    expect(root.querySelector('.tab[data-tab="details"] [data-codex-sensory]')).toBeNull();
    expect(root.querySelector('.tab[data-tab="rules"]')?.textContent).toContain("sensory.sharedRuleHint");
    expect(Object.fromEntries(new FormData(root))).toEqual({
        "system.badge.value": "3", "system.rules.0.channel": "alpha",
    });
    expect(item.badge.value).toBe(3);
});
it("registers native configuration hooks once and rejects non-world application links", () => {
    const { hooks } = setup();
    const on = vi.spyOn(Hooks, "on");
    registerSensoryEffectConfig();
    expect(on).not.toHaveBeenCalled();
    const root = sheetForm();
    const item = { ...effect(3), flags: {}, sourceId: "Actor.signal", isEmbedded: true };
    hooks.renderItemSheet({ item, isEditable: true }, root);
    expect(root.querySelector("a")?.textContent).toContain("sensory.missing");
});
