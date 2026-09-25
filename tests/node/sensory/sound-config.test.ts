// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { hasSensorySoundAssignment, registerSensorySoundConfig } from "../../../src/canvas/sensory/sound-config.js";
afterEach(() => vi.unstubAllGlobals());
it("keeps malformed assignments private and clears a native form reference deliberately", () => {
    const hooks: Record<string, (...args: any[]) => void> = {};
    vi.stubGlobal("Hooks", { on: (name: string, callback: any) => { hooks[name] = callback; } });
    vi.stubGlobal("game", { items: { contents: [] }, i18n: { localize: (key: string) => key } });
    registerSensorySoundConfig();
    for (const value of ["Item.deleted", null, 17]) expect(hasSensorySoundAssignment({ flags: { "codex-foundry": { sensoryEffect: value } } })).toBe(true);
    for (const flags of [{}, { "codex-foundry": { sensoryEffect: "" } }]) expect(hasSensorySoundAssignment({ flags })).toBe(false);
    const root = document.createElement("form");
    root.innerHTML = '<input name="path" value="hum.ogg"><input name="volume" value="0.5"><input name="elevation" value="20">';
    const app = { document: { flags: { "codex-foundry": { sensoryEffect: "Item.deleted" } } } };
    hooks.renderAmbientSoundConfig?.(app, root);
    const select = root.querySelector<HTMLSelectElement>('[name="flags.codex-foundry.sensoryEffect"]')!;
    expect(select).not.toBeNull();
    expect(select.value).toBe("Item.deleted");
    select.value = ""; select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(Object.fromEntries(new FormData(root))).toEqual({ path: "hum.ogg", volume: "0.5", elevation: "20", "flags.codex-foundry.sensoryEffect": "" });
});
