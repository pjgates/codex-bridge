import { afterEach, expect, it, vi } from "vitest";
import { activateGridlessRouting, getMovementArea, isSqueezedLeg, measureProposedMovement } from "../../../src/rulesets/sf2e/gridless/routing.js";
import { buildClearance, clearSegment } from "../../../src/rulesets/sf2e/gridless/clearance.js";
import { hexAt, hexCentre } from "../../../src/rulesets/sf2e/gridless/hex.js";

afterEach(() => vi.unstubAllGlobals());

function setup(options: { lattice?: "continuous" | "hex" } = {}) {
    const callbacks: Record<string, () => void> = {};
    const edge = { a: { x: 500, y: 300 }, b: { x: 500, y: 700 }, move: 1, direction: 0, type: "wall" };
    let geometryReads = 0;
    const edges = new Map([["wall", edge]]);
    const level = { id: "floor", get edges() { geometryReads++; return edges; } };
    const scene = { id: "scene", regions: [], levels: new Map([["floor", level]]),
        dimensions: { size: 100, distancePixels: 20, distance: 5, rect: { x: 0, y: 0, width: 1000, height: 1000 } } };
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
    vi.stubGlobal("game", { system: { id: "pf2e" }, settings: {
        get: (_namespace: string, key: string) => key === "movementLattice" ? options.lattice ?? "continuous" : enabled,
    }, user: { isGM: true } });
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

function difficult(token: { scene: { regions: unknown[] } }, from: number, difficulty = 2): void {
    token.scene.regions = [{
        hidden: false,
        polygons: [{ points: [from, 0, 1000, 0, 1000, 1000, from, 1000] }],
        includedInLevel: () => true,
        behaviors: [{ disabled: false, system: { _getTerrainEffects: () => [{ name: "difficulty", difficulty }] } }],
    }];
}

it("stops the hex ring at a wall and opens it when the wall stops blocking", async () => {
    const { token, edge, callbacks } = setup({ lattice: "hex" });
    token.actor.size = "sm";
    const outline = async () => {
        // 12 feet keeps the wall's end out of reach, so only the band itself decides the outline.
        const area = await getMovementArea(token as unknown as Token.Implementation, { x: 300, y: 500 }, 12).promise;
        expect(area!.length).toBeGreaterThan(0);
        const xs = area!.flatMap(polygon => polygon.filter((_value, index) => index % 2 === 0));
        return { min: Math.min(...xs), max: Math.max(...xs) };
    };
    const closed = await outline();
    // The cramped band lets a Small token hug the wall, but never cross it.
    expect(closed.max).toBeLessThan(500);
    expect(closed.min).toBeLessThan(250);
    edge.move = 0;
    callbacks.updateWall();
    const opened = await outline();
    expect(opened.max).toBeGreaterThan(520);
});

it("charges the cramped allowance where a medium token passes a wall band", async () => {
    const { token, edge, callbacks } = setup({ lattice: "hex" });
    const reach = async () => {
        const area = await getMovementArea(token as unknown as Token.Implementation, { x: 300, y: 500 }, 20).promise;
        return Math.max(...area!.flatMap(polygon => polygon.filter((_value, index) => index % 2 === 0)));
    };
    const closed = await reach();
    edge.move = 0;
    callbacks.updateWall();
    const opened = await reach();
    // Hex keeps continuous semantics: a Medium token's cramped footprint passes beside the
    // wall at difficult cost, so the closed door costs distance instead of blocking outright.
    expect(opened).toBeGreaterThan(600);
    expect(closed).toBeLessThan(opened - 50);
});

it("halves difficult-terrain reach and restores it for a creature that ignores the terrain", async () => {
    const { token, edge, callbacks } = setup({ lattice: "hex" });
    edge.move = 0;
    difficult(token, 0);
    callbacks.updateRegion();
    const reach = async () => {
        const area = await getMovementArea(token as unknown as Token.Implementation, { x: 300, y: 500 }, 20).promise;
        return Math.max(...area!.flatMap(polygon => polygon.filter((_value, index) => index % 2 === 0)));
    };
    // Twenty feet of budget allows ten feet (200 pixels) of difficult-terrain travel.
    expect(await reach()).toBeGreaterThanOrEqual(490);
    expect(await reach()).toBeLessThanOrEqual(510);
    token.actor.system.movement.terrain.difficult.ignored.push({ environment: "all", feature: "all" });
    callbacks.updateActor();
    expect(await reach()).toBeGreaterThanOrEqual(690);
    expect(await reach()).toBeLessThanOrEqual(710);
});

it("routes a hex path around a solid wall and finishes exactly where the user asked", async () => {
    const { token } = setup({ lattice: "hex" });
    token.actor.size = "sm";
    const path = await token.findMovementPath([{ x: 250, y: 450 }, { x: 650, y: 450 }]).promise;
    expect(path.length).toBeGreaterThan(2);
    expect(path.length).toBeLessThanOrEqual(12);
    expect(path.some(point => point.y < 350 || point.y > 650)).toBe(true);
    // Foundry flags any requested position the found path misses as unreachable, so the last
    // leg leaves the lattice and ends on the exact request when it fits.
    expect(path.at(-1)).toMatchObject({ x: 650, y: 450 });
});

it("stops a hex route at an unreachable destination instead of crossing the wall", async () => {
    const { token } = setup({ lattice: "hex" });
    token.actor.size = "sm";
    token.scene.levels.get("floor")!.edges.set("sealed", { a: { x: 500, y: 0 }, b: { x: 500, y: 1000 }, move: 1, direction: 0, type: "wall" });
    const path = await token.findMovementPath([{ x: 250, y: 450 }, { x: 650, y: 450 }]).promise;
    expect(path.at(-1)!.x).toBeLessThan(480);
});

it("keeps a clear hex drag on the native straight line to the exact destination", async () => {
    const { token } = setup({ lattice: "hex" });
    const path = await token.findMovementPath([{ x: 150, y: 150 }, { x: 650, y: 150 }]).promise;
    expect(path).toHaveLength(2);
    expect(path.at(-1)).toMatchObject({ x: 650, y: 150 });
});


it("keeps full-footprint clearance even when cramped movement has no cost penalty", async () => {
    const { token, edge, TerrainData } = setup({ lattice: "hex" });
    TerrainData.getMovementCostFunction = () => (_from, _to, distance) => distance;
    // The line clears the reduced footprint at the wall tip, but not the full token.
    const path = await token.findMovementPath([{ x: 250, y: 680 }, { x: 650, y: 680 }]).promise;
    const full = buildClearance([edge], token.scene.dimensions.rect, 100, 100, 0);
    const centres = path.map(point => token.document.getCenterPoint(point));
    expect(centres.slice(1).every((point, i) => clearSegment(full, centres[i], point))).toBe(true);
    expect(path.at(-1)!.x).toBeCloseTo(650, 0);
});

it("uses the cramped-passage fallback only when a full route cannot fit", async () => {
    const { token, callbacks } = setup({ lattice: "hex" });
    gap(token, 60, callbacks);
    const path = await token.findMovementPath([{ x: 250, y: 450 }, { x: 650, y: 450 }]).promise;
    expect(Math.abs(path.at(-1)!.x - 650)).toBeLessThanOrEqual(10);
    const centres = path.map(point => token.document.getCenterPoint(point));
    const walls = [...token.scene.levels.get("floor")!.edges.values()];
    const cramped = buildClearance(walls, token.scene.dimensions.rect, 50, 50, -5);
    const full = buildClearance(walls, token.scene.dimensions.rect, 100, 100, 0);
    expect(centres.slice(1).every((point, i) => clearSegment(cramped, centres[i], point))).toBe(true);
    expect(centres.slice(1).some((point, i) => !clearSegment(full, centres[i], point))).toBe(true);
    expect(measureProposedMovement(token as unknown as Token.Implementation, path)).toBeGreaterThan(20);
});

it("checks walking clearance before a native teleport without moving its destination", async () => {
    const { token, edge, TerrainData } = setup({ lattice: "hex" });
    TerrainData.getMovementCostFunction = () => (_from, _to, distance) => distance;
    const path = await token.findMovementPath([
        { x: 250, y: 680 }, { x: 650, y: 680 }, { x: 803, y: 807, action: "blink" },
    ]).promise;
    const full = buildClearance([edge], token.scene.dimensions.rect, 100, 100, 0);
    expect(path.at(-1)).toMatchObject({ x: 803, y: 807, action: "blink" });
    expect(path.slice(1).every((point, i) => point.action === "blink" ||
        clearSegment(full, token.document.getCenterPoint(path[i]), token.document.getCenterPoint(point)))).toBe(true);
});

it("keeps full hex clearance after native whole-pixel waypoint rounding", async () => {
    const { token, callbacks } = setup({ lattice: "hex" });
    token.actor.size = "sm";
    Object.assign(token.scene.dimensions, { size: 79, distancePixels: 15.8 });
    Object.assign(token.scene.dimensions.rect, { width: 2160, height: 2963 });
    const walls = [
        { a: { x: 1292, y: 1184 }, b: { x: 1330, y: 1216 }, move: 20, type: "wall", direction: 0 },
        { a: { x: 1330, y: 1216 }, b: { x: 1332, y: 1180 }, move: 20, type: "wall", direction: 0 },
    ];
    const edges = token.scene.levels.get("floor")!.edges;
    edges.clear(); walls.forEach((wall, i) => edges.set(String(i), wall)); callbacks.updateWall();
    const path = await token.findMovementPath([{ x: 994, y: 1282 }, { x: 1503, y: 1110 }]).promise;
    expect(Math.hypot(path.at(-1)!.x - 1503, path.at(-1)!.y - 1110)).toBeLessThan(8);
    const centres = path.map(point => ({ x: Math.round(point.x) + 39.5, y: Math.round(point.y) + 39.5 }));
    const full = buildClearance(walls, token.scene.dimensions.rect, 39.5, 39.5, 0);
    expect(centres.slice(1).every((point, i) => clearSegment(full, centres[i], point))).toBe(true);
});

it("snapshots only reachable known debug cells and keeps terrain separate from token cost", async () => {
    const { token, callbacks } = setup({ lattice: "hex" });
    difficult(token, 300);
    const region = token.scene.regions[0];
    Object.assign(region, {
        testPoint: (point: { x: number; elevation: number }) => point.x >= 300 && point.elevation === 0,
        behaviors: [
            { type: "environment", disabled: false, system: { mode: "add", environmentTypes: new Set(["aquatic"]), _getTerrainEffects: () => [] } },
            { disabled: false, system: { _getTerrainEffects: () => [{ difficulty: 2 }] } },
        ],
    });
    vi.stubGlobal("game", { ...game, user: { isGM: false } });
    Object.assign(canvas!, { visibility: { tokenVision: true, testVisibility: (p: { x: number }) => p.x < 340 },
        fog: { isPointExplored: (p: { x: number }) => p.x < 340 } });
    const area = getMovementArea(token as unknown as Token.Implementation, { x: 300, y: 500 }, 5, undefined, true);
    await area.promise;
    expect(area.debug).toBeDefined();
    const cells = area.debug!.cells;
    expect(cells.some(cell => cell.terrain === "aquatic" && cell.multiplier === 2)).toBe(true);
    expect(cells.some(cell => cell.terrain === "none" && cell.multiplier === 1)).toBe(true);
    expect(cells.every(cell => hexCentre(cell, area.debug!.size).x < 340)).toBe(true);
    expect(cells.every(cell => cell.cost <= 5)).toBe(true);
    const saved = structuredClone(cells);
    token.actor.system.movement.terrain.difficult.ignored.push({ environment: "all", feature: "all" });
    callbacks.updateActor();
    const changed = getMovementArea(token as unknown as Token.Implementation, { x: 300, y: 500 }, 10, undefined, true);
    await changed.promise;
    expect(changed.debug!.cells.some(cell => cell.terrain === "aquatic" && cell.multiplier === 1)).toBe(true);
    expect(area.debug!.cells).toEqual(saved);
});

it("honours scene environment inheritance and region remove/override precedence", async () => {
    const { token, callbacks } = setup({ lattice: "hex" });
    Object.assign(token.scene, { flags: { pf2e: { environmentTypes: ["underground"] } } });
    difficult(token, 0);
    const environment = (mode: string, type: string) => ({ type: "environment", disabled: false,
        system: { mode, environmentTypes: new Set([type]), _getTerrainEffects: () => [] } });
    const behaviors = [environment("add", "aquatic"), environment("remove", "aquatic"), environment("add", "aquatic")];
    Object.assign(token.scene.regions[0], { testPoint: () => true, behaviors });
    const types = async () => {
        const area = getMovementArea(token as unknown as Token.Implementation, { x: 300, y: 500 }, 1, undefined, true);
        await area.promise;
        return [...new Set(area.debug!.cells.map(cell => cell.terrain))];
    };
    expect(await types()).toEqual(["underground"]);
    behaviors.push(environment("override", "forest"), environment("add", "aquatic"));
    callbacks.updateRegionBehavior();
    expect(await types()).toEqual(["aquatic"]);
});

it("squeezes a hex route through a gap below the cramped footprint at triple cost", async () => {
    const { token, callbacks } = setup({ lattice: "hex" });
    const waypoints = [{ x: 250, y: 450 }, { x: 650, y: 450 }];
    gap(token, 40, callbacks);
    const path = await token.findMovementPath(waypoints).promise;
    expect(path.at(-1)?.x).toBe(650);
    // Twenty feet of travel: the 100 px wall band is cramped for the full footprint, and its
    // middle 48 px also for the cramped footprint, so 2.6 ft cost double and 2.4 ft cost triple.
    expect(measureProposedMovement(token as unknown as Token.Implementation, path)).toBeCloseTo(27.5, 0);
    gap(token, 8, callbacks);
    expect((await token.findMovementPath(waypoints).promise).at(-1)?.x).toBe(250);
});

it("gives a Small creature a quarter-space cramped tier and squeezes only below it", async () => {
    const { token, callbacks } = setup({ lattice: "hex" });
    token.actor.size = "sm";
    const waypoints = [{ x: 250, y: 450 }, { x: 650, y: 450 }];
    gap(token, 40, callbacks);
    const cramped = await token.findMovementPath(waypoints).promise;
    expect(cramped.at(-1)?.x).toBe(650);
    // Twenty feet; the 50 px band where the half-space footprint overlaps the wall is cramped, not squeezed.
    expect(measureProposedMovement(token as unknown as Token.Implementation, cramped)).toBeCloseTo(22.5, 0);
    expect(cramped.slice(1).some((to, i) => isSqueezedLeg(token as unknown as Token.Implementation, cramped[i], to))).toBe(false);
    gap(token, 12, callbacks);
    const squeezed = await token.findMovementPath(waypoints).promise;
    expect(squeezed.at(-1)?.x).toBe(650);
    expect(squeezed.slice(1).some((to, i) => isSqueezedLeg(token as unknown as Token.Implementation, squeezed[i], to))).toBe(true);
    gap(token, 2, callbacks);
    expect((await token.findMovementPath(waypoints).promise).at(-1)?.x).toBe(250);
});

it("does not treat an exact cramped fit as a squeeze", async () => {
    const { token, callbacks } = setup({ lattice: "hex" });
    // A 51 px gap: the cramped footprint (50 px) fits with a pixel to spare.
    gap(token, 51, callbacks);
    const waypoints = [{ x: 250, y: 450 }, { x: 650, y: 450 }];
    const path = await token.findMovementPath(waypoints).promise;
    expect(path.at(-1)?.x).toBe(650);
    const legs = path.slice(1).map((to, i) => isSqueezedLeg(token as unknown as Token.Implementation, path[i], to));
    expect(legs.some(Boolean)).toBe(false);
    // Cramped surcharge only: 5 ft of the 20 ft path at double cost.
    expect(measureProposedMovement(token as unknown as Token.Implementation, path)).toBeCloseTo(25, 0);
});
