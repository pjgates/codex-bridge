export interface SensoryDefinition {
    channel: string;
    emission: { enabled: boolean; strength: "rank" | "fixed"; fixed: number; colour: string };
    glow: { enabled: boolean; minRank: number; range: number; walls: boolean };
    hearing: { enabled: boolean; minRank: number };
}
export interface SensoryApplication { definitionUuid: string; rank: number; definition: SensoryDefinition }
export interface SensoryPosition { x: number; y: number; elevation: number; levelId: string }
export interface SensoryRing { points: readonly { x: number; y: number }[]; hole: boolean }
export interface SensoryObserver {
    tokenUuid: string; position: SensoryPosition; listener: SensoryPosition;
    applications: readonly SensoryApplication[];
}
export interface SensoryEmitter {
    documentUuid: string; channel: string; position: SensoryPosition;
    strength: number; colour: string; rings: readonly SensoryRing[];
}
export interface SensoryGlow { emitter: SensoryEmitter; viewerUuid: string; direction: -1 | 0 | 1 }
export type DefinitionLookup = (uuid: string) => SensoryDefinition | null;
export interface SensoryItem {
    type: string; flags: unknown; sourceId?: string | null; isExpired?: boolean;
    badge?: { type: string; value?: unknown } | null;
}
export interface SensoryUser { id: string }
export interface SensoryTokenDocument {
    uuid: string; level: string; hidden: boolean;
    actor: { items: Iterable<SensoryItem>; testUserPermission(user: SensoryUser, permission: "OWNER"): boolean } | null;
    getCenterPoint(): { x: number; y: number; elevation: number };
    getListenerPosition(): { x: number; y: number; elevation: number };
    getSize(): { width: number; height: number };
}
export interface SensorySoundDocument {
    uuid: string; flags: unknown; path: string | null; x: number; y: number; elevation: number; levels: Set<string>;
    radius: number; shape: { radius: number }; volume: number; walls: boolean; easing: boolean; hidden: boolean;
    darkness: { min: number; max: number }; effects: object;
}
export interface SensoryManagedSound {
    src: string; context: AudioContext & { gainNode?: GainNode }; destination?: AudioNode;
    load(options: { autoplay: boolean }): Promise<unknown>;
    stop(options: { volume: number; fade: number }): Promise<unknown>;
}
export interface SensoryPlaybackSource {
    sound: SensoryManagedSound | null;
    sync(audible: boolean, volume: number, options: { muffled: boolean }): Promise<unknown>;
}
export interface SensoryPlayback { source: SensoryPlaybackSource; volume: number; muffled: boolean }
export interface SensoryVoice { sync(playback: SensoryPlayback | null): Promise<void>; destroy(): Promise<void> }
