import { afterEach, expect, it, vi } from "vitest";
import { activateGridlessRouting, getMovementArea, measureProposedMovement } from "../../../src/rulesets/sf2e/gridless/routing.js";
import { buildClearance, clearSegment } from "../../../src/rulesets/sf2e/gridless/clearance.js";

afterEach(() => vi.unstubAllGlobals());

function setup() {
    const callbacks: Record<string, () => void> = {};
    const edge = { a: { x: 500, y: 300 }, b: { x: 500, y: 700 }, move: 1, direction: 0, type: "wall" };
    let geometryReads = 0;
    const edges = new Map([["wall", edge]]);
    const level = { id: "floor", get edges() { geometryReads++; return edges; } };
    const scene = { id: "scene", regions: [], levels: new Map([["floor", level]]),
        dimensions: { size: 100, distancePixels: 20, rect: { x: 0, y: 0, width: 1000, height: 1000 } } };
    type Waypoint = { x: number; y: number; elevation: number; width: number; height: number; depth: number; shape: number; level: string; action: string; cost?: number; intermediate?: boolean; terrain?: { difficulty: number } | null; checkpoint?: boolean };
    type Exemption = { environment: string; feature: string };
    class TerrainData {
        static getMovementCostFunction(_token: unknown, _options?: unknown) {
            return (_from: { i: number; j: number; k?: number }, _to: { i: number; j: number; k?: number }, distance: number, segment: Waypoint) => distance * (segment.terrain?.difficulty ?? 1);
        }
    }
    class Token {
        actor = { size: "med", system: { movement: { terrain: { difficult: { ignored: [] as Exemption[] }, greater: { ignored: [] as Exemption[] } } } } };
        scene = scene;
        w = 100;
        h = 100;
        nativeCalls = 0;
        document = { _source: { x: 250, y: 450, elevation: 0, width: 1, height: 1, depth: 1, shape: 4, level: "floor", action: "walk" },
            movementAction: "walk", movementHistory: [], parent: scene, object: this,
            actor: this.actor,
            getCenterPoint: (point: { x: number; y: number; width?: number; height?: number }) => ({
                x: point.x + (point.width ?? this.document._source.width) * scene.dimensions.size / 2,
                y: point.y + (point.height ?? this.document._source.height) * scene.dimensions.size / 2,
            }) };
        createTerrainMovementPath(points: Partial<Waypoint>[]) {
            let previous: Waypoint = { ...this.document._source };
            return points.map(point => previous = { ...previous, ...point });
        }
        measureMovementPath(points: Waypoint[], options?: { preview?: boolean }) {
            const cost = TerrainData.getMovementCostFunction(this.document, options);
            const offset = (point: Waypoint) => ({ i: point.y, j: point.x, k: point.elevation * 20 });
            return { cost: points.slice(1).reduce((sum, point, i) => sum + (point.cost ??
                cost(offset(points[i]), offset(point), Math.hypot(point.x - points[i].x, point.y - points[i].y) / 20, point)), 0) };
        }
        constrainMovementPath(points: Waypoint[], _options?: { preview?: boolean; ignoreWalls?: boolean }): [Waypoint[], boolean] { return [points, false]; }
        findMovementPath(points: Partial<Waypoint>[], _options?: unknown) {
            this.nativeCalls++;
            const result = this.createTerrainMovementPath(points);
            return { result, promise: Promise.resolve(result), cancel() {} };
        }
    }
    let enabled = true;
    vi.stubGlobal("CONFIG", { Token: { objectClass: Token, movement: { TerrainData, actions: { walk: { walls: "move" }, blink: { walls: null, teleport: true } } } } });
    vi.stubGlobal("game", { system: { id: "pf2e" }, settings: { get: () => enabled }, user: { isGM: true } });
    vi.stubGlobal("canvas", { ready: true, scene, grid: { isGridless: true }, dimensions: scene.dimensions,
        visibility: { tokenVision: false }, tokens: { controlled: [] } });
    vi.stubGlobal("Hooks", { on: (name: string, callback: () => void) => { callbacks[name] = callback; } });
    activateGridlessRouting();
    const token = new Token();
    return { token, edge, callbacks, TerrainData, geometryReads: () => geometryReads, disable: () => { enabled = false; } };
}

it("routes native drag waypoints around a blocking wall and reacts when the door opens", async () => {
    const { token, edge, callbacks } = setup();
    const waypoints = [{ x: 250, y: 450 }, { x: 650, y: 450 }];
    const path = (await token.findMovementPath(waypoints).promise)!;
    expect(path[0].x).toBe(250);
    expect(path.at(-1)?.x).toBe(650);
    expect(path.some(point => point.y <= 250 || point.y >= 750)).toBe(true);
    edge.move = 0;
    callbacks.updateWall();
    const direct = await token.findMovementPath(waypoints).promise;
    expect(direct).toHaveLength(2);
});

function gap(token: { scene: { levels: Map<string, { edges: Map<string, unknown> }> } }, width: number, callbacks: Record<string, () => void>) {
    const edges = token.scene.levels.get("floor")!.edges;
    edges.clear();
    edges.set("lower", { a: { x: 500, y: 0 }, b: { x: 500, y: 500 - width / 2 }, move: 1, direction: 0, type: "wall" });
    edges.set("upper", { a: { x: 500, y: 500 + width / 2 }, b: { x: 500, y: 1000 }, move: 1, direction: 0, type: "wall" });
    callbacks.updateWall();
}

it("charges a Medium creature difficult terrain for a half-space passage and blocks anything tighter", async () => {
    const { token, callbacks } = setup();
    const waypoints = [{ x: 250, y: 450 }, { x: 650, y: 450 }];
    gap(token, 50, callbacks);
    const cramped = await token.findMovementPath(waypoints).promise;
    expect(cramped.at(-1)?.x).toBe(650);
    // Twenty feet of travel; only the five feet across the doorway are cramped.
    expect(token.measureMovementPath(cramped).cost).toBeCloseTo(25);
    expect(measureProposedMovement(token as unknown as Token.Implementation, cramped)).toBeCloseTo(25);
    gap(token, 40, callbacks);
    expect((await token.findMovementPath(waypoints).promise).at(-1)?.x).toBe(250);
});

it("does not charge a Small creature for a half-space passage", async () => {
    const { token, callbacks } = setup();
    token.actor.size = "sm";
    gap(token, 50, callbacks);
    const path = await token.findMovementPath([{ x: 250, y: 450 }, { x: 650, y: 450 }]).promise;
    expect(path.at(-1)?.x).toBe(650);
    expect(measureProposedMovement(token as unknown as Token.Implementation, path)).toBe(20);
});

it("charges a Large creature difficult terrain for a full-space passage", async () => {
    const { token, callbacks } = setup();
    token.actor.size = "lg";
    token.document._source.width = token.document._source.height = 2;
    gap(token, 100, callbacks);
    const path = await token.findMovementPath([{ x: 200, y: 400 }, { x: 700, y: 400 }]).promise;
    expect(path.at(-1)?.x).toBe(700);
    expect(token.measureMovementPath(path).cost).toBeCloseTo(35);
    expect(measureProposedMovement(token as unknown as Token.Implementation, path)).toBeCloseTo(35);
});

it("keeps passage cost additive and preserves recorded costs after the door opens", () => {
    const { token, callbacks, disable } = setup();
    gap(token, 50, callbacks);
    const direct = token.createTerrainMovementPath([{ x: 250, y: 450 }, { x: 650, y: 450 }]);
    const split = token.createTerrainMovementPath([{ x: 250, y: 450 }, { x: 450, y: 450 }, { x: 650, y: 450 }]);
    expect(token.measureMovementPath(direct).cost).toBeCloseTo(25);
    expect(token.measureMovementPath(split).cost).toBeCloseTo(25);
    direct[1].terrain = { difficulty: 2 };
    expect(token.measureMovementPath(direct).cost).toBeCloseTo(40);
    token.actor.system.movement.terrain.difficult.ignored.push({ environment: "all", feature: "all" });
    expect(token.measureMovementPath(direct).cost).toBeCloseTo(20);
    direct[1].cost = 25;
    gap(token, 200, callbacks);
    expect(token.measureMovementPath(direct).cost).toBe(25);
    delete direct[1].cost;
    direct[1].terrain = null;
    gap(token, 50, callbacks);
    disable();
    expect(token.measureMovementPath(direct).cost).toBe(20);
});

it("allows an exactly fitting doorway without an artificial clearance margin", async () => {
    const { token, callbacks } = setup();
    const edges = token.scene.levels.get("floor")!.edges;
    edges.clear();
    edges.set("lower", { a: { x: 500, y: 0 }, b: { x: 500, y: 450 }, move: 1, direction: 0, type: "wall" });
    edges.set("upper", { a: { x: 500, y: 550 }, b: { x: 500, y: 1000 }, move: 1, direction: 0, type: "wall" });
    callbacks.updateWall();
    const path = await token.findMovementPath([{ x: 250, y: 450 }, { x: 650, y: 450 }]).promise;
    expect(path.at(-1)?.x).toBe(650);
});

it("keeps cave corners clear after native whole-pixel waypoint rounding", async () => {
    const { token, callbacks } = setup();
    token.actor.size = "sm";
    token.scene.dimensions.size = 79;
    token.scene.dimensions.distancePixels = 15.8;
    token.scene.dimensions.rect.width = 2160;
    token.scene.dimensions.rect.height = 2963;
    const walls = [
        { a: { x: 1292, y: 1184 }, b: { x: 1330, y: 1216 }, move: 20, type: "wall", direction: 0 },
        { a: { x: 1330, y: 1216 }, b: { x: 1332, y: 1180 }, move: 20, type: "wall", direction: 0 },
    ];
    const edges = token.scene.levels.get("floor")!.edges;
    edges.clear(); walls.forEach((wall, i) => edges.set(String(i), wall)); callbacks.updateWall();
    const path = await token.findMovementPath([{ x: 994, y: 1282 }, { x: 1503, y: 1110 }]).promise;
    expect(path.at(-1)?.x).toBe(1503);
    const centers = path.map(p => ({ x: Math.round(p.x) + 39.5, y: Math.round(p.y) + 39.5 }));
    const clearance = buildClearance(walls, token.scene.dimensions.rect, 39.5, 39.5, 0);
    expect(centers.slice(1).every((p, i) => clearSegment(clearance, centers[i], p))).toBe(true);
});

it("preserves native disabled and unconstrained behavior and cancels stale jobs", async () => {
    const { token, disable } = setup();
    const waypoints = [{ x: 250, y: 450 }, { x: 650, y: 450 }];
    expect((await token.findMovementPath(waypoints, { constrainOptions: { ignoreWalls: true } }).promise)).toHaveLength(2);
    const short = token.findMovementPath([{ x: 250, y: 450 }, { x: 300, y: 450 }]);
    expect(short.result?.at(-1)?.x).toBe(300);
    const job = token.findMovementPath(waypoints);
    job.cancel();
    expect(await job.promise).toBeNull();
    expect(job.result).toBeNull();
    disable();
    expect((await token.findMovementPath(waypoints).promise)).toHaveLength(2);
});

it("invalidates cached movement areas when scene geometry changes", async () => {
    const { token, edge, callbacks } = setup();
    const first = getMovementArea(token as unknown as Token.Implementation, { x: 300, y: 500 }, 25);
    const repeated = getMovementArea(token as unknown as Token.Implementation, { x: 300, y: 500 }, 25);
    expect(repeated).toBe(first);
    edge.move = 0;
    callbacks.updateWall();
    const changed = getMovementArea(token as unknown as Token.Implementation, { x: 300, y: 500 }, 25);
    expect(changed).not.toBe(first);
    first.cancel();
    changed.cancel();
    await Promise.all([first.promise, changed.promise]);
});

it("applies native terrain-ignore abilities to gridless cost without changing gridded behavior", () => {
    const { token, TerrainData } = setup();
    const terrain = token.actor.system.movement.terrain;
    terrain.difficult.ignored.push({ environment: "all", feature: "all" });
    const cost = TerrainData.getMovementCostFunction(token.document);
    const from = { i: 0, j: 0 }, to = { i: 0, j: 200 };
    const segment = token.createTerrainMovementPath([{ x: 200, y: 0 }])[0];
    expect(cost(from, to, 10, { ...segment, terrain: { difficulty: 2 } })).toBe(10);
    expect(cost(from, to, 10, { ...segment, terrain: { difficulty: 3 } })).toBe(20);
    terrain.greater.ignored.push({ environment: "all", feature: "all" });
    expect(TerrainData.getMovementCostFunction(token.document)(from, to, 10, { ...segment, terrain: { difficulty: 3 } })).toBe(10);
    vi.stubGlobal("canvas", { ...canvas, grid: { ...canvas!.grid, isGridless: false } });
    expect(TerrainData.getMovementCostFunction(token.document)(from, to, 10, { ...segment, terrain: { difficulty: 2 } })).toBe(20);
});

it("reuses scene geometry with the empty options objects supplied by native dragging", async () => {
    const { token, geometryReads } = setup();
    const options = { preview: true, terrainOptions: {}, measureOptions: {} };
    await token.findMovementPath([{ x: 250, y: 450 }, { x: 650, y: 450 }], options).promise;
    const reads = geometryReads();
    await token.findMovementPath([{ x: 250, y: 450 }, { x: 680, y: 460 }], options).promise;
    expect(geometryReads()).toBe(reads);
});

it("keeps the user's final checkpoint without turning every routed corner into a stop", async () => {
    const { token } = setup();
    const path = await token.findMovementPath([{ x: 250, y: 450 }, { x: 650, y: 450, checkpoint: true }]).promise;
    expect(path.filter(point => point.checkpoint)).toHaveLength(1);
    expect(path.at(-1)?.checkpoint).toBe(true);
});

it("does not cancel a native route on an actor refresh that does not request a replacement", async () => {
    const { token, callbacks } = setup();
    const job = token.findMovementPath([{ x: 250, y: 450 }, { x: 650, y: 450 }]);
    callbacks.updateActor();
    expect((await job.promise)?.at(-1)?.x).toBe(650);
});

it("does not plan player previews through unexplored ground or reveal an unseen wall", async () => {
    const { token, edge, callbacks } = setup();
    vi.stubGlobal("game", { ...game, user: { isGM: false } });
    const known = (point: { x: number }) => point.x < 450;
    vi.stubGlobal("canvas", { ...canvas, visibility: { tokenVision: true, testVisibility: known },
        fog: { isPointExplored: known } });
    edge.a.x = edge.b.x = 475;
    callbacks.updateWall();
    const path = await token.findMovementPath([{ x: 250, y: 450 }, { x: 650, y: 450 }], { preview: true }).promise;
    expect(path.at(-1)!.x).toBeLessThan(400);
    const area = await getMovementArea(token as unknown as Token.Implementation, { x: 300, y: 500 }, 25).promise;
    expect(Math.max(...area!.flatMap(polygon => polygon.filter((_value, index) => index % 2 === 0)))).toBeCloseTo(450, 1);
});

it("stops a compressed footprint crossing even when its centre misses the wall", () => {
    const { token } = setup();
    const points = token.createTerrainMovementPath([{ x: 250, y: 230 }, { x: 650, y: 230 }]);
    const [path, constrained] = token.constrainMovementPath(points, { preview: false });
    expect(constrained).toBe(true);
    expect(path.at(-1)!.x).toBeLessThanOrEqual(425);
});
