import type { SensoryDefinition } from "../../../src/canvas/sensory/types.js";
export const owner = { id: "viewer" };
export function definition(): SensoryDefinition {
    return { channel: "alpha",
        emission: { enabled: true, strength: "rank", fixed: 1, colour: "#aabbcc" },
        glow: { enabled: true, minRank: 2, range: 25, walls: false },
        hearing: { enabled: true, minRank: 1 } };
}
export function effect(rank: number, uuid = "Item.signal") {
    return { type: "effect", sourceId: uuid, isExpired: false,
        flags: { "codex-foundry": { sensoryDefinition: uuid } },
        badge: { type: "counter", value: rank } };
}
