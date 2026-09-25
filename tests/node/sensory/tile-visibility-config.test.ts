// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { registerSensoryTileVisibilityConfig } from "../../../src/canvas/sensory/tile-visibility-config.js";

afterEach(() => vi.unstubAllGlobals());

it("submits artwork assignment and explicit clearing through the native form without changing clipping or tile fields", () => {
    const callbacks: ((...args: any[]) => void)[] = [];
    vi.stubGlobal("Hooks", { on: (_name: string, callback: any) => callbacks.push(callback) });
    const world = { uuid: "Item.signal", name: "Ordinary Effect", type: "effect", system: { rules: [] } };
    vi.stubGlobal("game", { items: { contents: [world], get: (id: string) => id === "signal" ? world : undefined },
        i18n: { localize: (key: string) => key } });
    registerSensoryTileVisibilityConfig(); registerSensoryTileVisibilityConfig();
    const root = document.createElement("form");
    root.innerHTML = '<input name="texture.src" value="pool.webp"><input name="flags.codex-foundry.clipRegion" value="pool">'
        + '<input name="flags.other.kept" value="yes"><div class="tab" data-tab="appearance"></div>';
    const app = { isEditable: true, document: { flags: { "codex-foundry": {
        sensoryVisibility: { effectUuid: "Item.deleted", minRank: 3 }, clipRegion: "pool" } } } };
    for (const render of callbacks) { render(app, root); render(app, root); }
    const selects = root.querySelectorAll<HTMLSelectElement>('[name="flags.codex-foundry.sensoryVisibility.effectUuid"]');
    expect(selects).toHaveLength(1);
    const select = selects[0], rank = root.querySelector<HTMLInputElement>('[name="flags.codex-foundry.sensoryVisibility.minRank"]')!;
    expect(select.closest('.tab[data-tab="appearance"]')).not.toBeNull();
    expect(select.value).toBe("Item.deleted");
    expect(rank.value).toBe("3");
    select.value = "Item.signal"; rank.value = "2";
    const retained = { "texture.src": "pool.webp", "flags.codex-foundry.clipRegion": "pool", "flags.other.kept": "yes" };
    expect(Object.fromEntries(new FormData(root))).toEqual({ ...retained,
        "flags.codex-foundry.sensoryVisibility.effectUuid": "Item.signal", "flags.codex-foundry.sensoryVisibility.minRank": "2" });
    select.value = "";
    expect(Object.fromEntries(new FormData(root))).toEqual({ ...retained,
        "flags.codex-foundry.sensoryVisibility.effectUuid": "", "flags.codex-foundry.sensoryVisibility.minRank": "2" });
    const readonlyRoot = document.createElement("form");
    for (const render of callbacks) render({ ...app, isEditable: false }, readonlyRoot);
    expect(readonlyRoot.querySelector("fieldset")?.disabled).toBe(true);
});
