// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { hasSensorySoundAssignment, registerSensorySoundConfig } from "../../../src/canvas/sensory/sound-config.js";
afterEach(() => vi.unstubAllGlobals());
it("keeps malformed assignments private until repaired or deliberately cleared in the native form", () => {
    const hooks: Record<string, (...args: any[]) => void> = {};
    vi.stubGlobal("Hooks", { on: (name: string, callback: any) => { hooks[name] = callback; } });
    vi.stubGlobal("game", { items: new Map(), i18n: { localize: (key: string) => key } });
    registerSensorySoundConfig();
    for (const value of ["Item.deleted", null, 17]) expect(hasSensorySoundAssignment({ flags: { "codex-foundry": { sensoryEffect: value } } })).toBe(true);
    for (const flags of [{}, { "codex-foundry": { sensoryEffect: "" } }]) expect(hasSensorySoundAssignment({ flags })).toBe(false);
    const root = document.createElement("form");
    root.innerHTML = '<input name="path" value="hum.ogg"><input name="volume" value="0.5"><input name="elevation" value="20">';
    const app = { isEditable: true, document: { flags: { "codex-foundry": { sensoryEffect: "Item.deleted" } } } };
    hooks.renderAmbientSoundConfig?.(app, root);
    const channel = root.querySelector<HTMLInputElement>('input[type="text"]')!;
    const enabled = root.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(enabled.checked).toBe(true);
    expect(channel.required).toBe(true);
    expect(channel.checkValidity()).toBe(false);
    channel.value = "gold";
    // Native FormDataExtended uses namedItem, which returns a RadioNodeList even for disabled duplicates.
    expect(root.elements.namedItem("flags.codex-foundry.sensoryChannel")).toBe(channel);
    expect(Object.fromEntries(new FormData(root))).toEqual({ path: "hum.ogg", volume: "0.5", elevation: "20", "flags.codex-foundry.sensoryChannel": "gold" });
    enabled.checked = false; enabled.dispatchEvent(new Event("change"));
    expect(Object.fromEntries(new FormData(root))).toEqual({ path: "hum.ogg", volume: "0.5", elevation: "20", "flags.codex-foundry.sensoryChannel": "" });
});
it("keeps invalid explicit channels private and honors deliberate clearing over a legacy reference", () => {
    for (const channel of ["gold", " ", null, 23]) {
        expect(hasSensorySoundAssignment({ flags: { "codex-foundry": { sensoryChannel: channel } } })).toBe(true);
    }
    expect(hasSensorySoundAssignment({ flags: { "codex-foundry": { sensoryChannel: "", sensoryEffect: "Item.old" } } })).toBe(false);
});
