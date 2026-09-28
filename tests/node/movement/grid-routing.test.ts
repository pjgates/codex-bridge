import { afterEach, expect, it, vi } from "vitest";
import { activateGridlessRouting } from "../../../src/rulesets/sf2e/gridless/routing.js";
import { movementCellStatus } from "../../../src/rulesets/sf2e/movement/preview.js";
import type { MovementToken, Waypoint } from "../../../src/rulesets/sf2e/movement/transitions.js";
import { prepareTransition } from "../../../src/rulesets/sf2e/movement/transitions.js";
import { findGridMovementStatuses } from "../../../src/rulesets/sf2e/movement/grid-routing.js";

afterEach(() => vi.unstubAllGlobals());

function setup(kind: "square" | "hex" = "square") {
    const center = ({ i, j }: { i: number; j: number }) => kind === "square"
        ? { x: j * 100 + 50, y: i * 100 + 50 } : { x: (j + i / 2) * 100 + 50, y: i * Math.sqrt(3) * 50 + 50 };
    const offset = ({ x, y }: { x: number; y: number }) => {
        const i = Math.round((y - 50) / (kind === "square" ? 100 : Math.sqrt(3) * 50));
        return { i, j: Math.round((x - 50) / 100 - (kind === "hex" ? i / 2 : 0)) };
    };
    const grid = { isGridless: false, isSquare: kind === "square", size: 100, distance: 5,
        getOffset: offset, getCenterPoint: center,
        measurePath: (points: { x: number; y: number }[]) => {
            const a = offset(points[0]), b = offset(points[1]);
            const di = b.i - a.i, dj = b.j - a.j;
            return { cost: 5 * (kind === "hex" ? Math.max(Math.abs(di), Math.abs(dj), Math.abs(di + dj))
                : Math.max(Math.abs(di), Math.abs(dj)) + Math.floor(Math.min(Math.abs(di), Math.abs(dj)) / 2)) };
        },
        getAdjacentOffsets: ({ i, j }: { i: number; j: number }) => (kind === "square"
            ? [[0, 1], [0, -1], [1, 0], [-1, 0]] : [[0, 1], [0, -1], [1, 0], [-1, 0], [1, -1], [-1, 1]])
            .map(([di, dj]) => ({ i: i + di, j: j + dj })),
        getVertices: (cell: { i: number; j: number }) => { const p = center(cell); return [
            { x: p.x - 40, y: p.y - 40 }, { x: p.x + 40, y: p.y - 40 },
            { x: p.x + 40, y: p.y + 40 }, { x: p.x - 40, y: p.y + 40 }]; },
    };
    const rectangle = (left: number, top: number, right: number, bottom: number) => ({
        polygon: { points: [left, top, right, top, right, bottom, left, bottom] },
        testPoint: ({ x, y }: { x: number; y: number }) => x >= left && x < right && y >= top && y < bottom,
    });
    const floor = (id: string, left: number, right: number, elevation = 0, extent = "solid") => ({
        id, levels: new Set(["floor"]), polygonTree: rectangle(left, 0, right, 400),
        behaviors: [
            { type: "codex-foundry.setElevation", disabled: false, system: { elevation } },
            { type: "codex-foundry.surfaceGeometry", disabled: false,
                system: { extent, underside: extent === "finite" ? elevation - 2 : null, blocksSight: true, blocksLight: true } },
        ],
    });
    const regions: unknown[] = [floor("ground", 0, 600)];
    const scene = { id: "scene", regions, grid, levels: new Map(),
        dimensions: { size: 100, distance: 5, distancePixels: 20, rect: { x: 0, y: 0, width: 600, height: 400 } } };
    type Point = Waypoint & { width: number; height: number; depth: number; shape: number; intermediate?: boolean };
    class Token {
        destroyed = false;
        dropped: Point[] = [];
        interaction = { cancelled: false, dropped: false, released: false, contexts: {} as Record<string,
            { searching: boolean; foundPath: Point[]; clonedToken: { destroyed: boolean } }> };
        _shouldPreventDragLeftDrop() { return false; }
        _onDragLeftDrop(_event: unknown) { this.interaction.dropped = true; this.dropped = this.interaction.contexts.token.foundPath; }
        _triggerDragLeftDrop() { this._onDragLeftDrop({ interactionData: this.interaction, preventDefault() {} }); }
        actor = { items: [], system: { movement: { speeds: { land: { value: 25 } } } } };
        scene = scene;
        document = { uuid: "token", name: "Bob", parent: scene, actor: this.actor,
            _source: { ...center({ i: 1, j: 0 }), elevation: 0, level: "floor", action: "walk", width: 1, height: 1, depth: 1, shape: 4 },
            movementAction: "walk", movementHistory: [], getCenterPoint: (p: Waypoint) => p, getMovementOrigin: (p: Waypoint) => p };
        createTerrainMovementPath(points: Partial<Point>[]) {
            let prior = { ...this.document._source };
            return points.map(p => prior = { ...prior, ...p });
        }
        constrainMovementPath(points: Point[]): [Point[], boolean] { return [points, false]; }
        measureMovementPath(points: Point[]) {
            return { diagonals: 0, cost: points.slice(1).reduce((sum, p, i) => sum +
                Math.hypot(p.x - points[i].x, p.y - points[i].y, (p.elevation - points[i].elevation) * 20) / 20, 0) };
        }
        findMovementPath(points: Partial<Point>[]) {
            const result = this.createTerrainMovementPath(points);
            return { result, promise: Promise.resolve(result) as Promise<Point[] | null>, cancel() {} };
        }
    }
    let enabled = true;
    vi.stubGlobal("game", { system: { id: "sf2e" }, user: { isGM: true }, settings: { get: (_module: string, key: string) =>
        key === "terrainCheckOverride" ? "" : key === "movementOutcomeMode" ? "apply" : key === "gridPathfinding" ? enabled : true } });
    vi.stubGlobal("canvas", { ready: true, scene, grid, dimensions: scene.dimensions, visibility: { tokenVision: false } });
    vi.stubGlobal("CONFIG", { Token: { objectClass: Token,
        movement: { TerrainData: { getMovementCostFunction: () => (_from: unknown, _to: unknown, distance: number) => distance },
            actions: { walk: { walls: "move" }, climb: { walls: "move" }, swim: { walls: "move" }, blink: { walls: null, teleport: true } } } } });
    vi.stubGlobal("Hooks", { on() {}, callAll() {} });
    activateGridlessRouting();
    const token = new Token();
    const water = (full = false) => {
        const p = center({ i: 1, j: 2 });
        const hole = rectangle(p.x - 48, full ? 0 : p.y - 48, p.x + 48, full ? 400 : p.y + 48);
        const outer = rectangle(0, 0, 600, 400);
        Object.assign(regions[0]!, { polygonTree: { ...outer, children: [hole],
            testPoint: (p: { x: number; y: number }) => outer.testPoint(p) && !hole.testPoint(p) } });
        regions.push({ id: "water", levels: new Set(["floor"]), polygonTree: hole, elevation: { top: 0, bottom: -20 },
            behaviors: [{ type: "codex-foundry.water", disabled: false, system: {} }] });
    };
    return { token, scene, center, floor, water, disable: () => { enabled = false; },
        route: (action = "walk") => token.findMovementPath([{ ...token.document._source }, { ...center({ i: 1, j: 4 }), action }]) };
}

it.each(["square", "hex"] as const)("prefers a dry detour to swimming on %s grids", async kind => {
    const { token, route, water } = setup(kind); water();
    const path = (await route().promise)!;
    expect(path.at(-1)!.x).toBe(token.scene.grid.getCenterPoint({ i: 1, j: 4 }).x);
    expect(path.length).toBeGreaterThan(2);
    expect(path.slice(1).every((point, i) => movementCellStatus(token.document as unknown as MovementToken, path[i], point).kind === "walk")).toBe(true);
});

it.each(["square", "hex"] as const)("colors a walkable bridge detour as Walk on %s grids", async kind => {
    const {token, scene, center, water, floor} = setup(kind); water();
    // A finite deck has a gap with a known lower landing, while its dry detour stays connected.
    (scene.regions[0] as ReturnType<typeof floor>).behaviors[1].system =
        {extent: "finite", underside: -2, blocksSight: true, blocksLight: true};
    scene.regions[1] = floor("lower", 0, 600, -20);
    const destination = {...token.document._source, ...center({i: 1, j: 4})};
    expect(movementCellStatus(token.document as unknown as MovementToken, token.document._source, destination).kind).toBe("fall");
    const statuses = (await findGridMovementStatuses(token as never, token.document._source).promise)!;
    expect(statuses.get("1:4")).toMatchObject({kind: "walk", label: "Walk"});
    expect(token.document._source.elevation).toBe(0);
});

it("bounds terrain preprocessing to local edges rather than repeated route histories", async () => {
    const { token } = setup();
    const original = token.createTerrainMovementPath.bind(token);
    let points = 0;
    token.createTerrainMovementPath = path => { points += path.length; return original(path); };
    const field = (await findGridMovementStatuses(token as never, token.document._source).promise)!;
    expect(field.size).toBe(24);
    expect([...field.values()].every(status => status.kind === "walk")).toBe(true);
    // 24 cells × four neighbors × two endpoints, with room for the initial waypoint.
    expect(points).toBeLessThan(200);
});

it("does not reclassify continuous flat walking terrain at every edge", async () => {
    const { token, scene } = setup("hex");
    const region = scene.regions[0] as {polygonTree: {testPoint(point: {x: number; y: number}): boolean}};
    const membership = vi.spyOn(region.polygonTree, "testPoint");
    const field = (await findGridMovementStatuses(token as never, token.document._source).promise)!;
    expect([...field.values()].every(status => status.kind === "walk")).toBe(true);
    expect(membership.mock.calls.length).toBeLessThanOrEqual(field.size * 2);
});

it.each(["square", "hex"] as const)("limits the field to the native grid radius on %s", async kind => {
    const { token, center } = setup(kind);
    const measure = token.scene.grid.measurePath;
    token.scene.grid.measurePath = (points: {x: number; y: number; elevation?: number}[]) =>
        points[0].elevation !== undefined && points[1].elevation === undefined ? {cost: NaN} : measure(points);
    const field = (await findGridMovementStatuses(token as never, token.document._source, 5).promise)!;
    expect(field.get("1:1")).toMatchObject({kind: "walk"});
    expect(field.has("1:4")).toBe(false);
    for (const id of field.keys()) {
        const [i, j] = id.split(":").map(Number);
        expect(measure([token.document._source, center({i, j})]).cost).toBeLessThanOrEqual(5);
    }
});

it("reuses local terrain edges from a new origin and rebuilds after scene revisions", async () => {
    const { token, center } = setup("hex");
    const terrain = vi.spyOn(token, "createTerrainMovementPath");
    await findGridMovementStatuses(token as never, token.document._source, Infinity, 0).promise;
    const calls = terrain.mock.calls.length;
    const origin = {...token.document._source, ...center({i: 1, j: 1})};
    origin.x = Math.round(origin.x); origin.y = Math.round(origin.y);
    const field = (await findGridMovementStatuses(token as never, origin, Infinity, 0).promise)!;
    expect([...field.values()].every(status => status.kind === "walk")).toBe(true);
    // A rounded new origin can also expose the six edges of the original subpixel anchor.
    expect(terrain.mock.calls.length - calls).toBeLessThanOrEqual(7);
    const warmCalls = terrain.mock.calls.length;
    await findGridMovementStatuses(token as never, origin, Infinity, 1).promise;
    expect(terrain.mock.calls.length - warmCalls).toBeGreaterThan(7);
});

it("queries only horizontal hex neighbors when native offsets include elevation", async () => {
    const {token} = setup("hex"), grid = token.scene.grid;
    const offset = grid.getOffset, adjacent = grid.getAdjacentOffsets;
    grid.getOffset = (p: {x: number; y: number; elevation?: number}) => ({...offset(p),
        ...(p.elevation === undefined ? {} : {k: Math.floor(p.elevation / 5)})});
    grid.getAdjacentOffsets = (p: {i: number; j: number; k?: number}) => p.k === undefined ? adjacent(p)
        : [-1, 0, 1].flatMap(dk => adjacent(p).map(c => ({...c, k: p.k! + dk})))
            .concat([{i:p.i,j:p.j,k:p.k-1},{i:p.i,j:p.j,k:p.k+1}]);
    const centers = vi.spyOn(grid, "getCenterPoint");
    const field = (await findGridMovementStatuses(token as never, token.document._source).promise)!;
    expect([...field.values()].every(status => status.kind === "walk")).toBe(true);
    expect(centers.mock.calls.length).toBeLessThanOrEqual(field.size * 6);
});

it("bounds native hex measurement work after walking across vertical grid offsets", async () => {
    const {token, scene, floor} = setup("hex");
    scene.regions = [floor("low", 0, 200, 4), floor("high", 200, 600, 5.5)];
    token.document._source.elevation = 4;
    let longest = 0, verticalDiagonals = 0;
    token.measureMovementPath = points => {
        longest = Math.max(longest, points.length);
        let diagonals = 0, cost = 0;
        for (let n = 1; n < points.length; n++) {
            const a = scene.grid.getOffset(points[n-1]), b = scene.grid.getOffset(points[n]);
            const xy = Math.max(Math.abs(b.i-a.i), Math.abs(b.j-a.j), Math.abs(b.i-a.i+b.j-a.j));
            const z = Math.abs(Math.floor(points[n].elevation/5)-Math.floor(points[n-1].elevation/5));
            const prior = diagonals; diagonals += Math.min(xy,z);
            cost += (points[n] as typeof points[number] & {cost?:number}).cost
                ?? 5 * (Math.max(xy,z) + Math.floor(diagonals/2) - Math.floor(prior/2));
        }
        verticalDiagonals += diagonals;
        return {cost,diagonals};
    };
    const field = (await findGridMovementStatuses(token as never, token.document._source).promise)!;
    expect([...field.values()].every(status => status.kind === "walk")).toBe(true);
    expect(verticalDiagonals).toBeGreaterThan(0);
    expect(longest).toBeLessThanOrEqual(8);
});

it("uses Swim when necessary or explicitly selected, while keeping manual routing available", async () => {
    const { token, route, water, disable } = setup(); water();
    const selected = (await route("swim").promise)!;
    expect(selected.some(p => p.x === 250 && p.y === 150)).toBe(true);
    water(true);
    expect((await route().promise)!.some(p => p.action === "swim")).toBe(true);
    disable();
    expect((await route().promise)!).toHaveLength(2);
    expect(token.document._source).toMatchObject({ x: 50, y: 150, elevation: 0 });
});

it("carries the landing elevation through a climb without changing the token", async () => {
    const { token, scene, floor, route } = setup();
    scene.regions = [floor("low", 0, 200), floor("high", 200, 600, 20)];
    const path = (await route().promise)!;
    expect(path.at(-1)).toMatchObject({ x: 450, elevation: 20 });
    expect(movementCellStatus(token.document as unknown as MovementToken, path[0], path[1]).kind).toBe("walk");
    expect(prepareTransition(token.document as unknown as MovementToken, { id: "execute-route", origin: path[0],
        passed: { waypoints: path.slice(1) }, pending: { waypoints: [] } }, { kind: "voluntary" }).transition?.reason).toBe("climb");
    expect(token.document._source.elevation).toBe(0);
});

it("keeps explicit checkpoints and landing elevation when continuing after a climb", async () => {
    const { token, scene, floor } = setup();
    scene.regions = [floor("low", 0, 200), floor("high", 200, 600, 20)];
    const path = (await token.findMovementPath([token.document._source,
        { x: 350, y: 150, explicit: true, checkpoint: true }, { x: 450, y: 250 }]).promise)!;
    expect(path.find(p => p.x === 350 && p.y === 150 && p.checkpoint)).toMatchObject({ elevation: 20, explicit: true });
    expect(path.at(-1)).toMatchObject({ x: 450, y: 250, elevation: 20 });
});

it("supports precise movement within the current cell", async () => {
    const { token } = setup();
    const precise = (await token.findMovementPath([token.document._source, { x: 55, y: 155 }]).promise)!;
    expect(precise.at(-1)).toMatchObject({ x: 55, y: 155 });
});

it("routes around native wall collisions", async () => {
    const { token, route } = setup();
    token.constrainMovementPath = points => [points, points.slice(1).some((to, i) => {
        const from = points[i];
        return (from.x < 300) !== (to.x < 300) && from.y > 100 && to.y > 100 && from.y < 300 && to.y < 300;
    })];
    const path = (await route().promise)!;
    expect(path.at(-1)!.x).toBe(450);
    expect(path.some(p => p.y <= 100 || p.y >= 300)).toBe(true);
});

it.each(["unknown", "fall", "ruling"])("does not route automatically into %s terrain", async kind => {
    const { scene, floor, route } = setup();
    scene.regions = [floor("start", 0, 200, 0, "finite")];
    if (kind !== "unknown") scene.regions.push(floor("destination", 200, 600, kind === "fall" ? -20 : 20, "finite"));
    const path = (await route().promise)!;
    expect(path.at(-1)!.x).toBeLessThan(200);
});

it("cancels superseded grid searches without returning a stale path", async () => {
    const { token, water, route } = setup(); water(true);
    const job = route(); job.cancel();
    expect(await job.promise).toBeNull();
    const field = findGridMovementStatuses(token as never, token.document._source);
    expect(field.statuses.get("1:0")).toMatchObject({kind: "walk"});
    field.cancel();
    expect(await field.promise).toBeNull();
});

it.each([false, true])("waits for native route presentation on release, preserving cancellation (%s)", async cancel => {
    const { token, route, water } = setup(); water();
    token.interaction.contexts.token = { searching: true, foundPath: [], clonedToken: { destroyed: false } };
    const context = token.interaction.contexts.token;
    const search = route();
    search.promise.then(path => setTimeout(() => { context.foundPath = path!; context.searching = false; }, 20));
    token._onDragLeftDrop({ interactionData: token.interaction, preventDefault() {} });
    expect(token.interaction.dropped).toBe(false);
    expect(token.dropped).toHaveLength(0);
    token.interaction.cancelled = cancel;
    await vi.waitFor(() => expect(context.searching).toBe(false));
    if (cancel) expect(token.interaction.dropped).toBe(false);
    else await vi.waitFor(() => expect(token.dropped.at(-1)).toMatchObject({ x: 450, y: 150 }));
});
