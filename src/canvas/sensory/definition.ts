import { MODULE_ID } from "../../constants.js";
import type { DefinitionLookup, SensoryApplication, SensoryDefinition, SensoryItem } from "./types.js";

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}
export function sensoryFlag(flags: unknown, key: string): unknown {
    return record(record(flags)[MODULE_ID])[key];
}
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function threshold(value: unknown): value is number { return finite(value) && Number.isInteger(value) && value > 0; }

/** Decode persisted configuration once, at the document boundary. */
export function readDefinition(raw: unknown): SensoryDefinition | null {
    const { channel, emission: rawEmission, glow: rawGlow, hearing: rawHearing } = record(raw);
    const e = record(rawEmission), g = record(rawGlow), h = record(rawHearing);
    if (typeof channel !== "string" || !channel.trim()
        || typeof e.enabled !== "boolean" || (e.strength !== "rank" && e.strength !== "fixed")
        || !finite(e.fixed) || (e.enabled && e.strength === "fixed" && e.fixed <= 0)
        || typeof e.colour !== "string" || !/^#[\da-f]{6}$/i.test(e.colour)
        || typeof g.enabled !== "boolean" || typeof g.walls !== "boolean"
        || !finite(g.minRank) || !finite(g.range) || (g.enabled && (!threshold(g.minRank) || g.range <= 0))
        || typeof h.enabled !== "boolean" || !finite(h.minRank) || (h.enabled && !threshold(h.minRank))) return null;
    return { channel,
        emission: { enabled: e.enabled, strength: e.strength, fixed: e.fixed, colour: e.colour },
        glow: { enabled: g.enabled, minRank: g.minRank, range: g.range, walls: g.walls },
        hearing: { enabled: h.enabled, minRank: h.minRank } };
}

export function resolveApplications(items: Iterable<SensoryItem>, lookup: DefinitionLookup): SensoryApplication[] {
    const applications: SensoryApplication[] = [];
    for (const item of items) {
        const explicit = sensoryFlag(item.flags, "sensoryDefinition");
        const reference = explicit === undefined ? item.sourceId : explicit;
        if (item.type !== "effect" || item.isExpired || typeof reference !== "string") continue;
        const definition = lookup(reference);
        if (!definition) continue;
        const rank = item.badge?.type === "counter" ? item.badge.value : 1;
        if (threshold(rank)) applications.push({ definitionUuid: reference, rank, definition });
    }
    return applications;
}

export function lookupWorldDefinition(uuid: string): SensoryDefinition | null {
    const match = /^Item\.([^.]+)$/.exec(uuid);
    if (!match) return null;
    const item = game.items?.get(match[1]);
    if (!item || item.uuid !== uuid || item.isEmbedded || item.pack || String(item.type) !== "effect") return null;
    return readDefinition(sensoryFlag(item.flags, "sensory"));
}
