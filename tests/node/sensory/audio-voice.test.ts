import { afterEach, expect, it, vi } from "vitest";
import { createSensoryVoice } from "../../../src/canvas/sensory/audio-voice.js";
afterEach(() => vi.unstubAllGlobals());
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
function fixture() {
    const loading = deferred(), starting = deferred();
    const environmentBus = {}, gate = { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
    const sound = { src: "hum.ogg", destination: undefined, context: { gainNode: environmentBus, createGain: () => gate },
        load: () => loading.promise, stop: vi.fn(async () => {}) };
    vi.stubGlobal("game", { audio: { environment: {}, create: vi.fn(() => sound) } });
    const source = { sound: null as any, sync: vi.fn(() => starting.promise) };
    const playback = { source, volume: 0.5, muffled: true };
    return { loading, starting, environmentBus, gate, sound, source, playback };
}
it("opens an independent downstream gate only after valid playback completes", async () => {
    const f = fixture(); const voice = createSensoryVoice("hum.ogg");
    const pending = voice.sync(f.playback); f.loading.resolve(); f.starting.resolve(); await pending;
    expect(f.gate.gain.value).toBe(1);
    expect(f.gate.connect).toHaveBeenCalledWith(f.environmentBus);
    expect(f.source.sound).toBe(f.sound);
    await voice.destroy(); expect(f.gate.gain.value).toBe(0); expect(f.gate.disconnect).toHaveBeenCalled();
});
it.each(["load", "start"])("revocation during %s cannot reopen output after obsolete work finishes", async phase => {
    const f = fixture(); const voice = createSensoryVoice("hum.ogg");
    const pending = voice.sync(f.playback);
    if (phase === "start") { f.loading.resolve(); await vi.waitFor(() => expect(f.source.sync).toHaveBeenCalled()); }
    await voice.sync(null);
    f.loading.resolve(); f.starting.resolve(); await pending;
    expect(f.gate.gain.value).toBe(0);
    if (phase === "load") expect(f.source.sync).not.toHaveBeenCalled();
});
