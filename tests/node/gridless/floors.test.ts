import { afterEach, describe, expect, it, vi } from "vitest";
import { activateFloorElevation, allFloors, allWater, floorRegions, surfaceBelow, waterAt } from "../../../src/rulesets/sf2e/gridless/floors.js";

afterEach(() => vi.unstubAllGlobals());

type Hook = (...args: any[]) => unknown;

function setup(options: { enforceClimb?: boolean } = {}) {
    const hooks: Record<string, Hook> = {};
    const warnings: string[] = [];
    vi.stubGlobal("Hooks", { on: (name: string, callback: Hook) => { hooks[name] = callback; } });
    vi.stubGlobal("CONST", { REGION_MOVEMENT_SEGMENTS: { ENTER: 1, MOVE: 0, EXIT: -1 } });
    vi.stubGlobal("game", { settings: { get: () => options.enforceClimb ?? true }, i18n: { format: (key: string, data: Record<string, string>) => `${key}:${data.rise}` } });
    vi.stubGlobal("ui", { notifications: { warn: (message: string) => warnings.push(message) } });
    // Non-overlapping floors along x on the token's level: 0 ft below 100, a 2.5 ft step to 300, a 7.5 ft ledge beyond.
    const floor = (elevation: number, minX: number, maxX: number) => ({
        levels: new Set(["floor"]), polygonTree: { polygon: { points: [Math.max(-100000,minX),-100000,Math.min(100000,maxX),-100000,Math.min(100000,maxX),100000,Math.max(-100000,minX),100000] }, testPoint: (p: { x: number }) => p.x >= minX && p.x < maxX },
        behaviors: [{ type: "map-workshop-importer.setElevation", disabled: false, system: { elevation } }], minX,
    });
    const regions = [floor(0, -Infinity, 100), floor(2.5, 100, 300), floor(7.5, 300, Infinity)];
    const scene = { regions, initialLevel: { id: "floor" }, _source: { initialLevel: "floor" } };
    const moves: { waypoints: any[]; options: Record<string, unknown> }[] = [];
    const token = {
        name: "Aspect-12", parent: scene,
        _source: { x: 0, y: 0, level: "floor", width: 1, height: 1, depth: 1, shape: 4 },
        getMovementOrigin: (p: { x: number; y: number }) => ({ x: p.x + 50, y: p.y + 50 }),
        move(waypoints: any[], options: Record<string, unknown>) { moves.push({ waypoints, options }); },
        updateSource: vi.fn(),
    };
    activateFloorElevation();
    return { hooks, token, moves, warnings };
}


describe("floor regions", () => {
    it("reads enabled setElevation behaviours on the token's level only", () => {
        const { token } = setup();
        expect(floorRegions(token.parent as any, "floor").map(f => f.floor)).toEqual([0, 2.5, 7.5]);
        expect(floorRegions(token.parent as any, "other")).toEqual([]);
    });


});

describe("surfaces across levels", () => {
    // Upper level: a terrace at 10 ft over x 100..300. Lower level: a 0 ft cave floor spanning everything, with a -15 ft pit past 300.
    const floor = (level: string, elevation: number, minX: number, maxX: number) => ({
        levels: new Set([level]), polygonTree: { polygon: { points: [Math.max(-100000,minX),-100000,Math.min(100000,maxX),-100000,Math.min(100000,maxX),100000,Math.max(-100000,minX),100000] }, testPoint: (p: { x: number }) => p.x >= minX && p.x < maxX },
        behaviors: [{ type: "map-workshop-importer.setElevation", disabled: false, system: { elevation } }],
    });
    const other = { levels: new Set(["upper"]), polygonTree: { testPoint: () => true }, behaviors: [{ type: "environment", disabled: false, system: {} }] };
    const scene = { regions: [floor("upper", 10, 100, 300), floor("lower", 0, -Infinity, 300), floor("lower", -15, 300, Infinity), other] };

    it("reads setElevation floors on every level", () => {
        expect(allFloors(scene as any).map(f => f.floor)).toEqual([10, 0, -15]);
    });

    it("picks the highest floor under the point at or below the elevation", () => {
        const floors = allFloors(scene as any);
        expect(surfaceBelow(floors, { x: 200, y: 0 }, 10)).toBe(10);
        // Hovering 5 ft above the cave floor, under the terrace's height: the cave floor is the surface below.
        expect(surfaceBelow(floors, { x: 200, y: 0 }, 5)).toBe(0);
        expect(surfaceBelow(floors, { x: 400, y: 0 }, 5)).toBe(-15);
        // Below every floor: nothing is beneath.
        expect(surfaceBelow(floors, { x: 200, y: 0 }, -1)).toBeNull();
    });

    it("reads marked water regions from their elevation band", () => {
        const pool = { levels: new Set(["lower"]), polygonTree: { testPoint: (p: { x: number }) => p.x >= 300 }, elevation: { bottom: -15, top: -10 },
            behaviors: [{ type: "map-workshop-importer.water", disabled: false, system: {} }] };
        const unmarked = { ...pool, behaviors: [{ type: "modifyMovementCost", disabled: false, system: {} }] };
        const open = { ...pool, elevation: { bottom: -15, top: Infinity } };
        const water = allWater({ regions: [...scene.regions, pool, unmarked, open] } as any);
        expect(water).toEqual([{ region: pool, surface: -10, bed: -15 }]);
        expect(waterAt(water, { x: 400, y: 0 })).toBe(water[0]);
        expect(waterAt(water, { x: 100, y: 0 })).toBeNull();
    });

    it("ignores elevation when asked for the top floor at a point", () => {
        const floors = allFloors(scene as any);
        expect(surfaceBelow(floors, { x: 200, y: 0 })).toBe(10);
        expect(surfaceBelow(floors, { x: 50, y: 0 })).toBe(0);
        expect(surfaceBelow([], { x: 50, y: 0 })).toBeNull();
    });
});

describe("preCreateToken", () => {
    it("drops a new token onto the floor under it", () => {
        const { hooks, token } = setup();
        token._source.x = 150;
        hooks.preCreateToken(token, { elevation: 0 });
        expect(token.updateSource).toHaveBeenCalledWith({ elevation: 2.5 });
    });
});
it('registers placement only; the shared movement owner handles paths',()=>{
 const {hooks}=setup();expect(hooks.preMoveToken).toBeUndefined();expect(hooks.preCreateToken).toBeTypeOf('function');
});
