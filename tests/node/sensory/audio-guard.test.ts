import { afterEach, expect, it, vi } from "vitest";
import { installSensoryAudioGuard } from "../../../src/canvas/sensory/audio-guard.js";
afterEach(() => vi.unstubAllGlobals());
function setup() {
    const heard: string[][] = [];
    const singleton = { _manager: null as any, stop: vi.fn() };
    class Source { sourceId: string; object: any; sound = singleton; constructor(id: string, object?: any) { this.sourceId = id; this.object = object; } }
    class Layer {
        sources = new Map<string, Source>();
        fail = false;
        getListenerPositions() { return [{ x: 0, y: 0, elevation: 0 }]; }
        _syncPositions() {
            heard.push([...this.sources.keys()]);
            for (const source of this.sources.values()) singleton._manager = source;
            if (this.fail) throw new Error("native failure");
        }
    }
    const layer = new Layer();
    class Ambient {
        document = { flags: {} as any, path: "hum.ogg" }; sound: any = singleton;
        source = new Source("native", this); layer = layer;
        _createSound() { return singleton; }
        _onUpdate(changed: object) { if ("path" in changed) { this.sound?.stop(); this.sound = this._createSound(); } }
    }
    vi.stubGlobal("CONFIG", { Canvas: { layers: { sounds: { layerClass: Layer } } }, AmbientSound: { objectClass: Ambient } });
    vi.stubGlobal("foundry", { utils: { Collection: Map } });
    vi.stubGlobal("game", { audio: { environment: {}, create: vi.fn(() => ({ stop: vi.fn() })) } });
    installSensoryAudioGuard();
    return { Ambient, layer, heard, singleton };
}
it("excludes private sources before native aggregation and restores the full collection on failure", () => {
    const { Ambient, layer, heard } = setup();
    const privateObject = new Ambient(); privateObject.document.flags = { "codex-foundry": { sensoryEffect: "Item.deleted" } };
    layer.sources.set("private", privateObject.source);
    layer.sources.set("ordinary", new Ambient().source);
    layer.sources.set("programmatic", { sourceId: "codex-foundry.sensory:test" } as any);
    layer._syncPositions();
    expect(heard).toEqual([["ordinary"]]);
    expect([...layer.sources.keys()]).toEqual(["private", "ordinary", "programmatic"]);
    layer.fail = true;
    expect(() => layer._syncPositions()).toThrow("native failure");
    expect([...layer.sources.keys()]).toEqual(["private", "ordinary", "programmatic"]);
});
it("detaches a newly private shared node before native path changes and preserves its ordinary manager", () => {
    const { Ambient, layer, singleton } = setup();
    const tagged = new Ambient(), ordinary = new Ambient();
    layer.sources.set("tagged", tagged.source); layer.sources.set("ordinary", ordinary.source);
    singleton._manager = tagged.source;
    tagged.document.flags = { "codex-foundry": { sensoryEffect: "Item.signal" } };
    tagged._onUpdate({ path: "changed.ogg" });
    expect(singleton._manager).toBe(ordinary.source);
    expect(singleton.stop).not.toHaveBeenCalled();
    expect(tagged.source.sound).toBeNull();
    expect(tagged.sound).not.toBe(singleton);
});
