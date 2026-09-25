import { hasSensorySoundAssignment } from "./sound-config.js";
interface GuardSound { _manager?: unknown; stop(options: { volume: number; fade: number }): unknown }
interface GuardSource { sourceId: string; sound?: GuardSound | null; object?: GuardAmbient | null }
interface GuardAmbient {
    document: { flags: unknown; path: string | null }; sound: GuardSound | null;
    source?: GuardSource; layer: SensorySoundsLayer;
    _createSound(): GuardSound | null; _onUpdate(...args: unknown[]): unknown;
}
export interface SensorySoundsLayer {
    sources: Map<string, GuardSource>;
    _syncPositions(...args: unknown[]): unknown; getListenerPositions(): unknown[];
}
const installed = new WeakSet<object>();
export function withOrdinarySources(layer: SensorySoundsLayer, operation: () => void): void {
    const all = layer.sources;
    const ordinary = [...all.entries()].filter(([, source]) => !source.sourceId.startsWith("codex-foundry.sensory:")
        && (!source.object || !hasSensorySoundAssignment(source.object.document)));
    layer.sources = new foundry.utils.Collection(ordinary) as unknown as typeof all;
    try { operation(); } finally { layer.sources = all; }
}
/** Partition before native singleton aggregation; retain any previously installed wrappers. */
export function installSensoryAudioGuard(): void {
    const configuration = CONFIG as unknown as {
        Canvas: { layers: { sounds: { layerClass: { prototype: SensorySoundsLayer } } } };
        AmbientSound: { objectClass: { prototype: GuardAmbient } };
    };
    const layer = configuration.Canvas.layers.sounds.layerClass.prototype;
    if (installed.has(layer)) return;
    installed.add(layer);
    const sync = layer._syncPositions;
    layer._syncPositions = function (...args) {
        let result: unknown;
        withOrdinarySources(this, () => { result = sync.apply(this, args); });
        return result;
    };
    const ambient = configuration.AmbientSound.objectClass.prototype;
    const create = ambient._createSound, update = ambient._onUpdate;
    const privateObjects = new WeakSet<GuardAmbient>();
    ambient._createSound = function () {
        if (!hasSensorySoundAssignment(this.document)) return create.call(this);
        privateObjects.add(this);
        return game.audio!.create({ src: this.document.path!, context: game.audio!.environment, singleton: false }) as unknown as GuardSound;
    };
    ambient._onUpdate = function (...args) {
        const assigned = hasSensorySoundAssignment(this.document);
        if (assigned && !privateObjects.has(this)) {
            const former = this.sound;
            const source = this.source;
            this.sound = null; if (source) source.sound = null;
            this.layer._syncPositions(this.layer.getListenerPositions(), {});
            if (former && (!former._manager || former._manager === source)) former.stop({ volume: 0, fade: 0 });
            privateObjects.add(this);
        } else if (!assigned && privateObjects.has(this)) {
            this.sound?.stop({ volume: 0, fade: 0 });
            this.sound = null; if (this.source) this.source.sound = null;
            privateObjects.delete(this);
            this.sound = create.call(this);
        }
        return update.apply(this, args);
    };
}
