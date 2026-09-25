import { expect, it } from "vitest";
import { buildSensoryAudioFrame } from "../../../src/canvas/sensory/audio-frame.js";
import { selectedObservers } from "../../../src/canvas/sensory/observers.js";
import { definition, effect, owner, token } from "./fixtures.js";
function sound(uuid = "Sound.a", reference: unknown = "Item.sound") {
    return { uuid, flags: { "codex-foundry": { sensoryEffect: reference } }, path: "hum.ogg", x: 0, y: 0, elevation: 0,
        levels: new Set(["ground"]), radius: 50, shape: { radius: 500 }, volume: 1, walls: false, easing: true,
        hidden: false, darkness: { min: 0, max: 1 }, effects: {} };
}
function nativeSource(multiplier: (point: { x: number; elevation: number }) => number) {
    return { sourceId: "programmatic", data: { disabled: false, effects: {} }, active: true, origin: { x: 0, y: 0, elevation: 0 }, x: 0, y: 0, elevation: 0,
        sound: null, sync: async () => {}, initialize() {}, add() {}, destroy() {}, resetEffects() {}, getVolumeMultiplier: multiplier };
}
it("uses only a qualifying listener's elevated position and silences broken channel references", () => {
    const definitions = new Map([["Item.sound", definition()], ["Item.signal", definition()]]);
    const lookup = (uuid: string) => definitions.get(uuid) ?? null;
    const views = selectedObservers([token("near", { rank: 0 }), token("far", { x: 300, elevation: 20 })], owner, lookup);
    const document = sound(), sources = new Map([[document.uuid, nativeSource(point => point.x === 300 && point.elevation === 20 ? 0.25 : 1)]]);
    const configure = (config: { muffled: boolean }) => { config.muffled = true; };
    const frame = buildSensoryAudioFrame([document], views, lookup, sources, configure);
    expect([...frame.values()].map(playback => [playback.volume, playback.muffled])).toEqual([[0.25, true]]);
    expect(buildSensoryAudioFrame([document], [], lookup, sources, configure).size).toBe(0);
    definitions.set("Item.sound", definition("beta"));
    expect(buildSensoryAudioFrame([document], views, lookup, sources, configure).size).toBe(0);
    definitions.delete("Item.sound");
    expect(buildSensoryAudioFrame([document], views, lookup, sources, configure).size).toBe(0);
    expect(buildSensoryAudioFrame([sound(document.uuid, null)], views, lookup, sources, configure).size).toBe(0);
});
it("aggregates identical channel/file gates and isolates another channel on the same file", () => {
    const beta = definition("beta");
    const lookup = (uuid: string) => uuid.endsWith("beta") ? beta : definition();
    const viewer = token("viewer"); viewer.actor.items.push(effect(2, "Item.beta"));
    const docs = [sound("Sound.a"), sound("Sound.b"), sound("Sound.c", "Item.beta")];
    const sources = new Map(docs.map((doc, index) => [doc.uuid, nativeSource(() => [0.4, 0.8, 0.3][index])]));
    const result = buildSensoryAudioFrame(docs, selectedObservers([viewer], owner, lookup), lookup, sources, () => {});
    expect([...result.values()].map(playback => playback.volume).sort()).toEqual([0.3, 0.8]);
    expect(buildSensoryAudioFrame(docs, [], lookup, sources, () => {}, { x: 10, y: 0, elevation: 20 }).size).toBe(2);
});

