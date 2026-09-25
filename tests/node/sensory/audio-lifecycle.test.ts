import { afterEach, expect, it, vi } from "vitest";
import { activateSensoryCanvas } from "../../../src/canvas/sensory/lifecycle.js";
import { legacyDefinition as definition, token } from "./fixtures.js";
afterEach(() => vi.unstubAllGlobals());
it("closes audible output synchronously when real selection callbacks revoke the listener", async () => {
    const hooks: Record<string, (...args: any[]) => void> = {};
    const gate = { gain: { value: 0 }, connect() {}, disconnect() {} };
    const node = { src: "hum.ogg", context: { gainNode: {}, createGain: () => gate },
        load: async () => {}, stop: async () => {}, destination: undefined };
    const sourceCollection = new Map();
    class Source {
        data: any = {}; active = true; sound: any = null; origin = { x: 0, y: 0, elevation: 0 }; x = 0; y = 0; elevation = 0;
        constructor(public options: { sourceId: string }) {}
        initialize(data: object) { this.data = data; } add() { sourceCollection.set(this.options.sourceId, this); }
        destroy() { sourceCollection.delete(this.options.sourceId); } resetEffects() {}
        getVolumeMultiplier() { return 0.5; } async sync() {}
    }
    const viewer = token("Token.viewer"), selected = [{ document: viewer }];
    const world = { uuid: "Item.signal", type: "effect", flags: { "codex-foundry": { sensory: definition() } } };
    const sound = { uuid: "Sound.private", flags: { "codex-foundry": { sensoryEffect: "Item.signal" } }, path: "hum.ogg",
        x: 0, y: 0, elevation: 20, levels: new Set(["upper"]), radius: 50, shape: { radius: 500 }, volume: 1,
        walls: false, easing: true, hidden: false, darkness: { min: 0, max: 1 }, effects: {} };
    vi.stubGlobal("Hooks", { on: (event: string, callback: any) => { hooks[event] = callback; } });
    vi.stubGlobal("CONFIG", { Canvas: { soundSourceClass: Source } });
    vi.stubGlobal("foundry", { utils: { deepClone: structuredClone } });
    vi.stubGlobal("game", { user: { id: "viewer" }, items: new Map([["signal", world]]), audio: { locked: false, environment: {}, create: () => node } });
    vi.stubGlobal("canvas", { ready: true, tiles: { placeables: [] }, scene: { sounds: [sound], levels: new Map([["upper", { id: "upper", elevation: { bottom: 20, top: 40 } }]]) }, tokens: { controlled: selected }, darknessLevel: 0,
        level: { id: "middle" }, inferLevelFromElevation: () => ({ id: "middle" }), sounds: { sources: sourceCollection, _configurePlayback() {} } });
    vi.stubGlobal("requestAnimationFrame", () => 1); vi.stubGlobal("cancelAnimationFrame", () => {});
    activateSensoryCanvas(); hooks.controlToken?.();
    await vi.waitFor(() => expect(gate.gain.value).toBe(1));
    expect([...sourceCollection.values()][0].data.level).toBe("upper");
    selected.length = 0; hooks.controlToken();
    expect(gate.gain.value).toBe(0);
    hooks.canvasTearDown();
    expect(sourceCollection.size).toBe(0);
});
