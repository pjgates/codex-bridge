import { afterEach, describe, expect, it, vi } from "vitest";
import { activateFloorElevation, floorCrossings, floorRegions } from "../../../src/rulesets/sf2e/gridless/floors.js";

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
        levels: new Set(["floor"]), polygonTree: { testPoint: (p: { x: number }) => p.x >= minX && p.x < maxX },
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

const wp = (x: number, extra: object = {}) => ({ x, y: 0, elevation: 0, action: "walk", snapped: false, explicit: false, checkpoint: false, ...extra });

describe("floor regions", () => {
    it("reads enabled setElevation behaviours on the token's level only", () => {
        const { token } = setup();
        expect(floorRegions(token.parent as any, "floor").map(f => f.floor)).toEqual([0, 2.5, 7.5]);
        expect(floorRegions(token.parent as any, "other")).toEqual([]);
    });

    it("traces floor entries geometrically along the path, ignoring region elevation bands", () => {
        const { token } = setup();
        const floors = floorRegions(token.parent as any, "floor");
        const crossings = floorCrossings(token as any, floors, [{ x: 0, y: 0 }, wp(200)]);
        expect(crossings).toHaveLength(1);
        expect(crossings[0].floor).toBe(2.5);
        // The token's centre crosses x = 100 when its position crosses x = 50, within one sample.
        expect(crossings[0].from.x).toBeLessThan(50);
        expect(crossings[0].to.x).toBeGreaterThanOrEqual(50);
        expect(crossings[0].to.x - crossings[0].from.x).toBeLessThanOrEqual(5);
        expect(crossings[0].exit).toBeUndefined();
        const through = floorCrossings(token as any, floors, [{ x: 0, y: 0 }, wp(400)]);
        expect(through.map(c => c.floor)).toEqual([2.5, 7.5]);
        expect(through[0].exit!.x).toBeGreaterThanOrEqual(250);
    });
});

describe("preMoveToken rewrite", () => {
    it("re-issues the move with the floor height and blocks the original", () => {
        const { hooks, token, moves } = setup();
        const result = hooks.preMoveToken(token, { origin: { x: 0, y: 0, elevation: 0, width: 1, height: 1, shape: 4 },
            passed: { waypoints: [wp(200)] }, showRuler: true, method: "dragging" }, {});
        expect(result).toBe(false);
        expect(moves).toHaveLength(1);
        expect(moves[0].waypoints.map((w: any) => [Math.round(w.x), w.elevation])).toEqual([[45, 2.5], [200, 2.5]]);
        expect(moves[0].options).toMatchObject({ "codex-foundryRewritten": true, showRuler: true, method: "dragging" });
    });

    it("lets its own rewritten move and floorless paths through untouched", () => {
        const { hooks, token, moves } = setup();
        expect(hooks.preMoveToken(token, { origin: { x: 0, y: 0, elevation: 0 }, passed: { waypoints: [wp(200)] } }, { "codex-foundryRewritten": true })).toBe(true);
        expect(hooks.preMoveToken(token, { origin: { x: 0, y: 0, elevation: 0 }, passed: { waypoints: [wp(20)] } }, {})).toBe(true);
        expect(moves).toHaveLength(0);
    });

    it("stops at a refused ledge with a warning, and walks it with climbs unenforced", () => {
        const enforced = setup();
        expect(enforced.hooks.preMoveToken(enforced.token, { origin: { x: 150, y: 0, elevation: 2.5 }, passed: { waypoints: [wp(400, { elevation: 2.5 })] } }, {})).toBe(false);
        expect(enforced.warnings).toEqual(["codex-foundry.floors.climbRefused:5"]);
        expect(enforced.moves[0].waypoints.map((w: any) => [Math.round(w.x), w.elevation])).toEqual([[245, 2.5]]);
        const relaxed = setup({ enforceClimb: false });
        relaxed.hooks.preMoveToken(relaxed.token, { origin: { x: 150, y: 0, elevation: 2.5 }, passed: { waypoints: [wp(400, { elevation: 2.5 })] } }, {});
        expect(relaxed.warnings).toEqual([]);
        expect(relaxed.moves[0].waypoints.map((w: any) => [Math.round(w.x), w.elevation])).toEqual([[245, 7.5], [400, 7.5]]);
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
