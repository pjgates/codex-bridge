import { isGridlessActive } from "./settings.js";
import type { Point } from "./geometry.js";

type Exemption = { environment: string; feature: string };
interface TerrainToken {
    actor: { system: { movement?: { terrain?: { difficult: { ignored: Exemption[] }; greater: { ignored: Exemption[] } } } } } | null;
}
type TerrainCost = (from: Point, to: Point, distance: number, segment: { terrain?: { difficulty: number } | null }) => number;

/** PF2e/SF2e currently apply these prepared exemptions only on square grids. */
export function activateGridlessTerrainCosts(): void {
    const data = CONFIG.Token.movement.TerrainData as unknown as {
        getMovementCostFunction(token: TerrainToken, options?: object): TerrainCost;
    };
    const original = data.getMovementCostFunction;
    data.getMovementCostFunction = function (token, options): TerrainCost {
        const cost = original.call(this, token, options);
        if (!isGridlessActive()) return cost;
        const terrain = token.actor?.system.movement?.terrain;
        if (!terrain) return cost;
        const universal = (entry: Exemption) => entry.environment === "all" && entry.feature === "all";
        const difficult = terrain.difficult.ignored.some(universal);
        const greater = terrain.greater.ignored.some(universal);
        if (!difficult && !greater) return cost;
        return (from, to, distance, segment) => {
            const measured = cost(from, to, distance, segment);
            const difficulty = segment.terrain?.difficulty ?? 1;
            if (difficulty === 2 && difficult) return measured / 2;
            if (difficulty === 3) return greater ? measured / 3 : difficult ? measured * 2 / 3 : measured;
            return measured;
        };
    };
}
