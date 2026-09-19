import type { Point } from "./geometry.js";
import { hexCentre, type Hex } from "./hex.js";
import type { HexField } from "./hexfield.js";

// Aquatic takes visual priority over broad tags such as Underground. These colours do not alter movement.
export const TERRAIN_COLORS = {
    aquatic: 0x3399ff, arctic: 0x99e5ff, desert: 0xe7c477, forest: 0x72bf78,
    mountain: 0xa8adb5, plains: 0xb4cf79, swamp: 0x51b8a2, underground: 0xb898dc,
    urban: 0xd0c2b1, none: 0xffffff,
} as const;
export type DebugTerrain = keyof typeof TERRAIN_COLORS;
const terrains = Object.keys(TERRAIN_COLORS) as DebugTerrain[];
const terrainBits = new Map<string, number>(terrains.map((terrain, index) => [terrain, 1 << index]));

export interface MovementDebugRegion {
    hidden: boolean;
    includedInLevel(level: string): boolean;
    testPoint(point: Point & { elevation: number }): boolean;
    behaviors: { disabled: boolean; type?: string;
        system: { environmentTypes?: Iterable<string>; mode?: string } }[];
}
export interface MovementDebugCell extends Hex {
    cost: number;
    multiplier: number;
    terrain: DebugTerrain;
}
export interface MovementDebugData { size: number; cells: MovementDebugCell[] }

function mask(types: Iterable<string>): number {
    let value = 0;
    for (const type of types) value |= terrainBits.get(type) ?? 0;
    return value;
}

/** Snapshot before the next flood reuses its scratch arrays. Never inspect or classify unreached cells. */
export function snapshotMovementDebug(field: HexField, regions: Iterable<MovementDebugRegion>, level: string,
    elevation: number, sceneTypes: Iterable<string>): MovementDebugData {
    const sources = Array.from(regions).filter(region => !region.hidden && region.includedInLevel(level))
        .map(region => ({ region, operations: region.behaviors
            .filter(behavior => !behavior.disabled && behavior.type === "environment")
            .map(({ system }) => ({ mode: system.mode, mask: mask(system.environmentTypes ?? []) })) }))
        .filter(source => source.operations.length);
    const baseline = mask(sceneTypes);
    const cells: MovementDebugCell[] = [];
    let index = 0;
    for (let q = field.qMin; q <= field.qMax; q++) {
        for (let r = field.rMin; r <= field.rMax; r++, index++) {
            if (field.generation[index] !== field.stamp || field.costs[index] < 0 || field.blocked[index]) continue;
            const cell: MovementDebugCell = { q, r, cost: field.costs[index] / 100,
                multiplier: field.stepCosts[field.difficulty[index]] / field.step, terrain: "none" };
            let added = baseline, removed = 0;
            if (sources.length) {
                const point = { ...hexCentre(cell, field.size), elevation };
                for (const { region, operations } of sources) {
                    if (!region.testPoint(point)) continue;
                    // Match the system's add/remove/override precedence; removal wins until an override resets it.
                    for (const operation of operations) {
                        if (operation.mode === "add") added |= operation.mask;
                        else if (operation.mode === "remove") removed |= operation.mask;
                        else if (operation.mode === "override") { added = operation.mask; removed = 0; }
                    }
                }
            }
            const resolved = added & ~removed;
            if (resolved) cell.terrain = terrains[31 - Math.clz32(resolved & -resolved)];
            cells.push(cell);
        }
    }
    return { size: field.size, cells };
}
