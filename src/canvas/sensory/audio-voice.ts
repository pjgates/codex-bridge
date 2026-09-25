import { MODULE_ID } from "../../constants.js";
import type { SensoryManagedSound, SensoryPlayback, SensoryPlaybackSource, SensoryVoice } from "./types.js";
export function createSensoryVoice(path: string): SensoryVoice {
    const sound = game.audio!.create({ src: path, context: game.audio!.environment, singleton: false }) as unknown as SensoryManagedSound;
    // Core initializes destination lazily; use its own environment-bus fallback before loading.
    const output = sound.destination ?? sound.context.gainNode ?? sound.context.destination;
    const gate = sound.context.createGain(); gate.gain.value = 0; gate.connect(output); sound.destination = gate;
    let generation = 0, destroyed = false;
    let requested: SensoryPlayback | null = null;
    let attached: SensoryPlaybackSource | null = null;
    let loading: Promise<unknown> | null = null;
    let stopping: Promise<unknown> = Promise.resolve();
    const report = (error: unknown) => console.error(`${MODULE_ID} | Sensory audio failed`,
        path.split(/[?#]/)[0].replace(/\/\/[^/]*@/, "//"), error instanceof Error ? error.name : "Audio error");
    const sync = async (playback: SensoryPlayback | null): Promise<void> => {
        requested = playback; const current = ++generation;
        if (!playback || destroyed) {
            gate.gain.value = 0;
            if (attached) attached.sound = null; attached = null;
            stopping = sound.stop({ volume: 0, fade: 0 }).catch(report);
            await stopping; return;
        }
        try {
            await stopping;
            if (current !== generation || destroyed) return;
            await (loading ??= sound.load({ autoplay: false }));
            if (current !== generation || destroyed) return;
            if (attached && attached !== playback.source) attached.sound = null;
            attached = playback.source; attached.sound = sound;
            await playback.source.sync(true, playback.volume, { muffled: playback.muffled });
            if (current === generation && requested && !destroyed) gate.gain.value = 1;
        } catch (error) {
            if (current === generation) gate.gain.value = 0;
            report(error);
        }
    };
    return { sync, destroy: async () => { destroyed = true; await sync(null); gate.disconnect(); } };
}
