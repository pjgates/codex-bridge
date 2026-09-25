import type { DefinitionLookup, SensoryNativeSoundSource, SensoryObserver, SensoryPlayback, SensoryPlaybackConfig, SensorySoundDocument } from "./types.js";
import { sensoryFlag } from "./definition.js";
export function buildSensoryAudioFrame(documents: Iterable<SensorySoundDocument>, observers: readonly SensoryObserver[], lookup: DefinitionLookup,
    sources: ReadonlyMap<string, SensoryNativeSoundSource>, configurePlayback: (config: SensoryPlaybackConfig) => void,
    preview?: { x: number; y: number; elevation: number }): Map<string, SensoryPlayback> {
    const winners = new Map<string, SensoryPlaybackConfig>();
    for (const document of [...documents].sort((a, b) => a.uuid.localeCompare(b.uuid))) {
        const reference = sensoryFlag(document.flags, "sensoryEffect");
        const definition = typeof reference === "string" ? lookup(reference) : null;
        const channels = new Set(definition?.rules.map(rule => rule.channel));
        const channel = channels.size === 1 ? [...channels][0] : null;
        const source = sources.get(document.uuid);
        if (!channel || !source?.active || source.data.disabled || document.hidden || !document.path || document.radius <= 0) continue;
        const listeners = preview ? [preview] : observers.filter(viewer => viewer.applications.some(app =>
            app.definition.rules.some(rule => rule.key === "CodexHearSignal" && rule.channel === channel
            && app.rank >= rule.minRank))).map(viewer => viewer.listener);
        const key = JSON.stringify([document.path, channel]);
        for (const listener of listeners) {
            const volume = document.volume * source.getVolumeMultiplier(listener, { easing: document.easing });
            if (volume > (winners.get(key)?.volume ?? 0)) winners.set(key, { source, listener, volume, walls: document.walls, muffled: false });
        }
    }
    const result = new Map<string, SensoryPlayback>();
    for (const [key, config] of winners) {
        configurePlayback(config);
        if (config.volume > 0) result.set(key, { source: config.source, volume: config.volume, muffled: config.muffled });
    }
    return result;
}
