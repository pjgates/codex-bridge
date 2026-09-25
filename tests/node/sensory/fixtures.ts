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
export function token(uuid: string, options: {
    owns?: boolean; rank?: number; x?: number; y?: number; elevation?: number; levelId?: string;
} = {}) {
    const { owns = true, rank = 2, x = 0, y = 0, elevation = 0, levelId = "ground" } = options;
    return { uuid, level: levelId, hidden: false, object: null,
        actor: { items: [effect(rank)], testUserPermission: (_user: unknown, permission: string) => owns && permission === "OWNER" },
        getCenterPoint: () => ({ x, y, elevation }),
        getListenerPosition: () => ({ x, y, elevation }), getSize: () => ({ width: 100, height: 100 }) };
}
