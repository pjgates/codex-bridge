import { sensoryLevelAtElevation, type SensoryLevel } from "./levels.js";
import { createSensoryVoice } from "./audio-voice.js";
import { buildSensoryAudioFrame } from "./audio-frame.js";
import { lookupWorldDefinition } from "./definition.js";
import { selectedObservers } from "./observers.js";
import { hasSensorySoundAssignment } from "./sound-config.js";
import type { SensoryNativeSoundSource, SensoryPlaybackConfig, SensorySoundDocument, SensoryTokenDocument, SensoryUser, SensoryVoice } from "./types.js";
interface NativeAudioCanvas {
    ready: boolean; scene: { sounds: Iterable<SensorySoundDocument>; levels: { values(): IterableIterator<SensoryLevel> } } | null; darknessLevel: number;
    tokens: { controlled: { document: SensoryTokenDocument }[] }; level: { id: string; elevation: { base: number } };
    sounds: { _configurePlayback(config: SensoryPlaybackConfig): void; previewSound(position: { x: number; y: number; elevation?: number }): unknown };
}
const sources = new Map<string, SensoryNativeSoundSource>();
const voices = new Map<string, SensoryVoice>();
export function clearSensoryAudio(): void {
    for (const voice of voices.values()) void voice.destroy(); voices.clear();
    for (const source of sources.values()) { source.sound = null; source.destroy(); } sources.clear();
}
function refreshAt(preview?: { x: number; y: number; elevation: number }): void {
    const native = canvas as unknown as NativeAudioCanvas | undefined;
    if (!native?.ready || !native.scene || !game.user || game.audio!.locked) { clearSensoryAudio(); return; }
    const documents = [...native.scene.sounds].filter(hasSensorySoundAssignment);
    const ids = new Set(documents.map(document => document.uuid));
    for (const [id, source] of sources) if (!ids.has(id)) { source.sound = null; source.destroy(); sources.delete(id); }
    const configuration = CONFIG.Canvas as unknown as { soundSourceClass: new (options: { sourceId: string }) => SensoryNativeSoundSource };
    for (const document of documents) {
        let source = sources.get(document.uuid);
        if (!source) { source = new configuration.soundSourceClass({ sourceId: `codex-foundry.sensory:${document.uuid}` }); sources.set(document.uuid, source); }
        const levelId = sensoryLevelAtElevation(native.scene.levels.values(), document.elevation, document.levels, native.level.id);
        if (JSON.stringify(source.data.effects) !== JSON.stringify(document.effects)) source.resetEffects();
        source.initialize({ x: document.x, y: document.y, elevation: document.elevation, level: levelId,
            radius: document.shape.radius, walls: document.walls, path: document.path,
            volume: document.volume, easing: document.easing, effects: foundry.utils.deepClone(document.effects), preview: false,
            disabled: document.hidden || !document.path || document.radius <= 0
                || native.darknessLevel < document.darkness.min || native.darknessLevel > document.darkness.max });
        source.add();
    }
    const observers = selectedObservers(native.tokens.controlled.map(token => token.document), game.user as SensoryUser, lookupWorldDefinition);
    const frame = buildSensoryAudioFrame(documents, observers, lookupWorldDefinition, sources,
        config => native.sounds._configurePlayback(config), preview);
    for (const [key, voice] of voices) if (!frame.has(key)) { void voice.destroy(); voices.delete(key); }
    for (const [key, playback] of frame) {
        let voice = voices.get(key);
        if (!voice) { voice = createSensoryVoice(JSON.parse(key)[0]); voices.set(key, voice); }
        void voice.sync(playback);
    }
}
export function refreshSensoryAudio(): void { refreshAt(); }
const installed = new WeakSet<object>();
export function installSensoryAudioPreview(): void {
    const configuration = CONFIG.Canvas as unknown as { layers: { sounds: { layerClass: { prototype: NativeAudioCanvas["sounds"] } } } };
    const layer = configuration.layers.sounds.layerClass.prototype;
    if (installed.has(layer)) return; installed.add(layer);
    const preview = layer.previewSound;
    layer.previewSound = function (position) {
        const result = preview.call(this, position);
        if (game.user?.isGM) {
            const native = canvas as unknown as NativeAudioCanvas;
            refreshAt({ ...position, elevation: position.elevation ?? native.level.elevation.base });
        }
        return result;
    };
}
