// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { registerSensoryTileConfig } from "../../../src/canvas/sensory/tile-config.js";
afterEach(() => vi.unstubAllGlobals());
it("saves edited tile rows without shifting references or retaining a removed last row", () => {
    const hooks: Record<string, (...args: any[]) => void> = {};
    vi.stubGlobal("Hooks", { on: (name: string, callback: any) => { hooks[name] = callback; } });
    vi.stubGlobal("game", { items: { contents: [] }, i18n: { localize: (key: string) => key } });
    registerSensoryTileConfig();
    const app = { document: { flags: { "codex-foundry": { sensoryEffects: [
        { effectUuid: "Item.signal", rank: 1 }, { effectUuid: "Item.missing", rank: 4 } ] } } },
        _processFormData: (_event: unknown, _form: unknown, data: { object: any }) => data.object };
    const root = document.createElement("form");
    hooks.renderTileConfig?.(app, root);
    expect(root.querySelectorAll('[data-codex-sensory-row]')).toHaveLength(2);
    root.querySelector<HTMLButtonElement>('[data-action="remove-sensory"]')!.click();
    const fields = Object.fromEntries(new FormData(root));
    expect(fields["flags.codex-foundry.sensoryEffects.0.effectUuid"]).toBe("Item.missing");
    expect(fields["flags.codex-foundry.sensoryEffects.0.rank"]).toBe("4");
    const saved = app._processFormData(null, root, { object: { flags: { "codex-foundry": {
        clipRegion: "pool", sensoryEffects: { "0": { effectUuid: fields["flags.codex-foundry.sensoryEffects.0.effectUuid"], rank: 4 } } } } } });
    expect(saved.flags["codex-foundry"]).toEqual({ clipRegion: "pool", sensoryEffects: [{ effectUuid: "Item.missing", rank: 4 }] });
    hooks.renderTileConfig(app, root);
    expect(root.querySelectorAll('[data-codex-sensory="tile"]')).toHaveLength(1);
    root.querySelector<HTMLButtonElement>('[data-action="remove-sensory"]')!.click();
    expect(app._processFormData(null, root, { object: { flags: { "codex-foundry": { clipRegion: "pool" } } } })
        .flags["codex-foundry"].sensoryEffects).toEqual([]);
});
