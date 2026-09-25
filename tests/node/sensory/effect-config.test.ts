// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { registerSensoryEffectConfig } from "../../../src/canvas/sensory/effect-config.js";
import { definition, effect } from "./fixtures.js";
afterEach(() => vi.unstubAllGlobals());
function setup() {
    const hooks: Record<string, (...args: any[]) => void> = {};
    const world = { uuid: "Item.signal", name: "<Signal>", type: "effect", isEmbedded: false, pack: null,
        isOwner: true, flags: { "codex-foundry": { sensory: definition() } }, sheet: { render: vi.fn() } };
    vi.stubGlobal("Hooks", { on: (name: string, callback: any) => { hooks[name] = callback; } });
    vi.stubGlobal("game", { items: new Map([["signal", world]]), i18n: { localize: (key: string) => key } });
    registerSensoryEffectConfig();
    return { hooks, world };
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
