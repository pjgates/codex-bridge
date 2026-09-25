import { lookupWorldDefinition, readDefinition, sensoryFlag } from "./definition.js";
import type { DefinitionLookup, SensorySoundDocument } from "./types.js";

type SoundFlags = Pick<SensorySoundDocument, "flags">;
export function hasSensorySoundAssignment(document: SoundFlags): boolean {
    const channel = sensoryFlag(document.flags, "sensoryChannel");
    const value = channel === undefined ? sensoryFlag(document.flags, "sensoryEffect") : channel;
    return value !== undefined && value !== "";
}
export function resolveSensorySoundChannel(document: SoundFlags, lookup: DefinitionLookup = lookupWorldDefinition): string | null {
    const channel = sensoryFlag(document.flags, "sensoryChannel");
    if (channel !== undefined) return typeof channel === "string" && channel.trim() ? channel : null;
    const reference = sensoryFlag(document.flags, "sensoryEffect");
    const definition = typeof reference === "string" ? lookup(reference) : null;
    const channels = new Set(definition?.rules.map(rule => rule.channel));
    return channels.size === 1 ? [...channels][0] : null;
}

/** Unresolvable old assignments remain private and silent, never ordinary ambient audio. */
export async function migrateSensorySounds(): Promise<void> {
    if (!game.user?.isGM) return;
    for (const scene of game.scenes ?? []) {
        for (const sound of scene.sounds) {
            const legacy = sensoryFlag(sound.flags, "sensoryEffect");
            if (legacy === undefined) continue;
            const channel = sensoryFlag(sound.flags, "sensoryChannel");
            const source = typeof legacy === "string" && lookupWorldDefinition(legacy) ? game.items?.get(legacy.slice(5)) : null;
            const oldChannel = readDefinition(sensoryFlag(source?.flags, "sensory"))?.channel;
            const broadcast = oldChannel ?? resolveSensorySoundChannel(sound);
            const changes: Record<string, unknown> = {
                ...(channel === undefined ? { "flags.codex-foundry.sensoryChannel": legacy === "" ? "" : broadcast } : {}),
                "flags.codex-foundry.-=sensoryEffect": null,
            };
            await sound.update(changes);
        }
    }
}
