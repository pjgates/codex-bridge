import type { Bounds, Point } from "./geometry.js";
import { buildClearance, clearSegment, obstructedFraction, rayClearance, type Clearance, type NavigationWall } from "./clearance.js";
import { navigationPath, reachablePolygons, searchNavigation, type NavigationMap } from "./navigation.js";
import { isGridlessActive, movementLatticeMode } from "./settings.js";
import { activateGridlessTerrainCosts } from "./terrain.js";
import { hexAt, hexCentre } from "./hex.js";
import { blockedFrontier, buildHexField, floodReachable, hexContours, hexPull, hexRoute, modeArrays, type FrontierRim, type HexClearanceMode, type HexField, type HexRegion } from "./hexfield.js";
import { snapshotMovementDebug, type MovementDebugData, type MovementDebugRegion } from "./debug.js";
import { CLIMB_ACTIONS } from "./elevation.js";
import { climbsEnforced, SET_ELEVATION_TYPE } from "./floors.js";
import type { HexFloor } from "./hexfield.js";

// Foundry 14's terrain/level additions are not yet represented by fvtt-types.
interface Waypoint extends Point {
    elevation: number; width: number; height: number; depth: number; shape: number;
    level: string; action: string; intermediate?: boolean; terrain?: unknown; explicit?: boolean; snapped?: boolean; checkpoint?: boolean;
}
interface PathOptions {
    preview?: boolean;
    terrainOptions?: Record<string, unknown>;
    measureOptions?: Record<string, unknown>;
    constrainOptions?: { ignoreWalls?: boolean; ignoreCost?: boolean; history?: unknown; [key: string]: unknown };
}
interface ConstraintOptions extends Record<string, unknown> { preview?: boolean; ignoreWalls?: boolean; measureOptions?: Record<string, unknown> }
interface Job<T> { result?: T | null; promise: Promise<T | null>; cancel(): void }
interface NativeEdge {
    a: Point; b: Point; type: string; direction: number; move: number;
    orientPoint(point: Point): number;
}
interface NativeRegion extends MovementDebugRegion {
    polygons: { points: number[] }[];
    behaviors: (MovementDebugRegion["behaviors"][number] & {
        system: { _getTerrainEffects(token: unknown, segment: unknown, options: unknown): unknown[] };
    })[];
}
interface NativeToken {
    actor: { system: object; size?: string } | null;
    scene: { regions: Iterable<NativeRegion>; levels: Map<string, { edges: Map<string, NativeEdge> }>;
        dimensions: { size: number; distance: number; distancePixels: number; rect: Bounds };
        flags?: Record<string, { environmentTypes?: string[] }> };
    document: { _source: Omit<Waypoint, "action">; movementAction: string; getCenterPoint(point: Partial<Waypoint>): Point };
    createTerrainMovementPath(points: Partial<Waypoint>[], options?: object): Waypoint[];
    measureMovementPath(points: unknown[], options?: object): { cost: number };
    constrainMovementPath(points: Waypoint[], options?: ConstraintOptions): [Waypoint[], boolean];
    findMovementPath(points: Partial<Waypoint>[], options?: PathOptions): Job<Waypoint[]>;
}

export interface MovementFrontier { size: number; rims: FrontierRim[] }
export type MovementAreaJob = Job<number[][]> & { debug?: MovementDebugData; frontier?: MovementFrontier };
let revision = 0;
let maps = new WeakMap<NativeToken, { key: string; actor: object | undefined; map: NavigationMap; base: Waypoint; pivot: Point }>();
let areas = new WeakMap<NativeToken, { key: string; map: object; job: MovementAreaJob }>();
let hexFields = new WeakMap<NativeToken, { key: string; actor: object | undefined; field: HexField }>();
let clearances = new WeakMap<NativeToken, { key: string; actor: object | undefined; solid: Clearance; clearance: Clearance;
    walls: NavigationWall[]; full: Point; cramped: Point }>();
/** Last path a token's ruler asked to find, captured before routing resolves. */
export const dragPaths = new WeakMap<object, Partial<TokenDocument.MeasuredMovementWaypoint>[]>();

export function isKnownMovementPoint(point: Point): boolean {
    return !!game.user!.isGM || !canvas!.visibility.tokenVision
        || canvas!.fog.isPointExplored(point) || canvas!.visibility.testVisibility(point, { tolerance: 1 });
}

/**
 * PF2e lets a creature use a passage one size smaller as difficult terrain; anything tighter needs Squeeze.
 * Small and Tiny creatures already fit a half space, so a half-space passage costs them nothing.
 */
function passageFootprint(token: NativeToken, base: Waypoint): { full: Point; cramped: Point } {
    const size = token.scene.dimensions.size;
    const half = size / 2;
    const small = token.actor?.size === "sm" || token.actor?.size === "tiny";
    const span = (units: number): number => small && units <= 1 ? half : units * size;
    const full = { x: span(base.width), y: span(base.height) };
    return { full, cramped: { x: Math.max(half, full.x - size), y: Math.max(half, full.y - size) } };
}

function movementClearance(token: NativeToken, base: Waypoint, preview = false) {
    const { width, height, elevation, depth, shape, level, action } = base;
    const restricted = preview && !game.user!.isGM && canvas!.visibility.tokenVision;
    const key = [revision, width, height, elevation, depth, shape, level, action, preview, restricted].join(":");
    const prior = clearances.get(token);
    if (prior?.key === key && prior.actor === token.actor?.system) return prior;
    const walls: NavigationWall[] = [];
    for (const edge of token.scene.levels.get(level)?.edges.values() ?? []) {
        if (edge.type !== "wall" || !edge.move) continue;
        if (restricted && ![edge.a, edge.b, { x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 }].some(isKnownMovementPoint)) continue;
        walls.push({ a: edge.a, b: edge.b,
            blocksFrom: edge.direction ? (origin) => edge.orientPoint(origin) !== edge.direction : undefined });
    }
    const { full, cramped } = passageFootprint(token, base);
    const solid = buildClearance(walls, token.scene.dimensions.rect, full.x, full.y, 0);
    const clearance = full.x === cramped.x && full.y === cramped.y ? solid
        : buildClearance(walls, token.scene.dimensions.rect, cramped.x, cramped.y, 0);
    const entry = { key, actor: token.actor?.system, solid, clearance, walls, full, cramped };
    clearances.set(token, entry);
    return entry;
}

/** Full standing footprint for position guides; no search, budget, or cramped fallback. */
export function getMovementFootprint(token: Token.Implementation): Clearance {
    const native = token as unknown as NativeToken;
    return movementClearance(native, { ...native.document._source, action: native.document.movementAction }, true).solid;
}

function movementMap(token: NativeToken, base: Waypoint, options: PathOptions = {}) {
    const { width, height, elevation, depth, shape, level, action } = base;
    const { key, clearance, solid } = movementClearance(token, base, !!options.preview);
    const prior = maps.get(token);
    // Non-default native measurement options belong to this request, not the shared preview cache.
    const cacheable = !Object.keys(options.terrainOptions ?? {}).length && !Object.keys(options.measureOptions ?? {}).length;
    if (cacheable && prior?.key === key && prior.actor === token.actor?.system) return prior;
    const restricted = !!options.preview && !game.user!.isGM && canvas!.visibility.tokenVision;
    const pivot = token.document.getCenterPoint({ ...base, x: 0, y: 0 });
    const size = token.scene.dimensions.size;
    const points: Point[] = [];
    const seen = new Set<string>();
    // Foundry stores waypoints at integer top-left pixels. Only search corners that
    // remain clear at those actual positions, not raw fractional obstacle vertices.
    const addPoint = (vertex: Point): void => {
        for (const x of new Set([Math.floor(vertex.x - pivot.x), Math.ceil(vertex.x - pivot.x)])) {
            for (const y of new Set([Math.floor(vertex.y - pivot.y), Math.ceil(vertex.y - pivot.y)])) {
                const key = `${x}:${y}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const point = { x: x + pivot.x, y: y + pivot.y };
                if (clearSegment(clearance, point, point)) points.push(point);
            }
        }
    };
    for (const vertex of clearance.vertices) addPoint(vertex);
    if (solid !== clearance) for (const vertex of solid.vertices) addPoint(vertex);
    const segment = { width, height, depth, shape, level, action, preview: !!options.preview };
    let minimumMultiplier = 1;
    const terrainOptions = { ...options.terrainOptions, preview: !!options.preview };
    for (const region of token.scene.regions) {
        if (region.hidden || !region.includedInLevel(level)) continue;
        let active = false;
        for (const behavior of region.behaviors) {
            if (behavior.disabled) continue;
            for (const effect of behavior.system._getTerrainEffects(token.document, segment, terrainOptions)) {
                active = true;
                if (effect && typeof effect === "object" && "difficulty" in effect) {
                    minimumMultiplier *= typeof effect.difficulty === "number" ? Math.max(0, Math.min(1, effect.difficulty)) : 0;
                }
            }
        }
        if (!active) continue;
        for (const polygon of region.polygons) {
            const p = polygon.points;
            for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
                const dx = p[i] - p[j], dy = p[i + 1] - p[j + 1], length = Math.hypot(dx, dy);
                if (!length) continue;
                const nx = -dy / length, ny = dx / length;
                const offset = (Math.abs(nx) * width + Math.abs(ny) * height) * size / 2 + 1;
                // ponytail: half-space terrain samples approximate boundary crossing positions, never snap tokens.
                const steps = Math.max(1, Math.ceil(length / (size / 2)));
                for (let k = 0; k < steps; k++) {
                    const x = p[j] + dx * k / steps, y = p[j + 1] + dy * k / steps;
                    for (const side of [-1, 0, 1]) addPoint({ x: x + nx * offset * side, y: y + ny * offset * side });
                }
            }
        }
    }
    const waypoint = (point: Point): Waypoint => ({ x: point.x - pivot.x, y: point.y - pivot.y,
        width, height, elevation, depth, shape, level, action, snapped: false });
    const plainCost = token.measureMovementPath([waypoint({ x: 0, y: 0 }), waypoint({ x: size, y: 0 })],
        { ...options.measureOptions, preview: options.preview }).cost;
    const map: NavigationMap = { clearance, points,
        // A calibration segment touching a wall has a passage surcharge, not a safe lower bound.
        minimumCostPerPixel: Number.isFinite(plainCost) && !obstructedFraction(solid, { x: 0, y: 0 }, { x: size, y: 0 })
            ? plainCost / size * minimumMultiplier : 0, cost: (from, to) => {
        if (restricted) {
            if (!isKnownMovementPoint(from) || !isKnownMovementPoint(to)) return Infinity;
            const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (size / 3)));
            for (let i = 1; i < steps; i++) {
                if (!isKnownMovementPoint({ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps })) return Infinity;
            }
        }
        const path = token.createTerrainMovementPath([waypoint(from), waypoint(to)], { ...options.terrainOptions, preview: options.preview });
        for (let i = 1; i < path.length; i++) {
            const a = token.document.getCenterPoint(path[i - 1]), b = token.document.getCenterPoint(path[i]);
            if (!clearSegment(clearance, a, b)) return Infinity;
        }
        return token.measureMovementPath(path, { ...options.measureOptions, preview: options.preview }).cost;
    } };
    const entry = { key, actor: token.actor?.system, map, base, pivot };
    if (cacheable) maps.set(token, entry);
    return entry;
}

/** Scene regions that raise movement cost, with the difficulty their effects apply. */
function terrainRegions(token: NativeToken, base: Waypoint, preview: boolean): HexRegion[] {
    const { width, height, depth, shape, level, action } = base;
    const segment = { width, height, depth, shape, level, action, preview };
    const regions: HexRegion[] = [];
    for (const region of token.scene.regions) {
        if (region.hidden || !region.includedInLevel(level)) continue;
        let difficulty = 0;
        for (const behavior of region.behaviors) {
            if (behavior.disabled) continue;
            for (const effect of behavior.system._getTerrainEffects(token.document, segment, { preview })) {
                if (!effect || typeof effect !== "object" || !("difficulty" in effect)) continue;
                const value = (effect as { difficulty?: unknown }).difficulty;
                if (typeof value === "number") difficulty = Math.max(difficulty, Math.min(3, Math.round(value)));
            }
        }
        if (difficulty >= 2) regions.push({ difficulty, polygons: region.polygons.map(polygon => polygon.points) });
    }
    return regions;
}

/** Map-workshop floor regions on the token's level, as lattice floor heights. */
function floorHeights(token: NativeToken, level: string): HexFloor[] {
    const floors: HexFloor[] = [];
    for (const region of token.scene.regions) {
        if (region.hidden || !region.includedInLevel(level)) continue;
        const behavior = region.behaviors.find(b => !b.disabled && b.type === SET_ELEVATION_TYPE);
        if (!behavior) continue;
        const floor = (behavior.system as { elevation?: number }).elevation ?? 0;
        floors.push({ floor, polygons: region.polygons.map(polygon => polygon.points) });
    }
    return floors;
}

/** Measure each terrain rate without relying on finding a clear sample inside a scene region. */
function terrainStepCosts(token: NativeToken, base: Waypoint, preview: boolean): number[] {
    const { size, distance } = token.scene.dimensions;
    const step = distance * 10;
    const costs = [step, step, 2 * step, 3 * step];
    const from: Waypoint = { x: 0, y: 0, width: base.width, height: base.height, elevation: base.elevation,
        depth: base.depth, shape: base.shape, level: base.level, action: base.action, terrain: null };
    for (const difficulty of [2, 3]) {
        // Measure a full scene unit, then divide into ten CELLs to avoid subpixel rounding.
        const measured = token.measureMovementPath([from, { ...from, x: size, terrain: { difficulty } }], { preview }).cost;
        if (Number.isFinite(measured)) costs[difficulty] = Math.max(step, Math.round(measured * 10));
    }
    return costs;
}

/** The per-token lattice field, cached on the same key as the continuous clearance. */
function movementHexField(token: NativeToken, base: Waypoint, options: PathOptions) {
    const { key: clearanceKey, walls, full, cramped } = movementClearance(token, base, !!options.preview);
    const climb = CLIMB_ACTIONS.has(base.action) || !climbsEnforced();
    const key = `${clearanceKey}:${climb}`;
    const prior = hexFields.get(token);
    if (prior?.key === key && prior.actor === token.actor?.system) return prior;
    const { rect, size, distance } = token.scene.dimensions;
    const restricted = !!options.preview && !game.user!.isGM && canvas!.visibility.tokenVision;
    const regions = terrainRegions(token, base, !!options.preview);
    const field = buildHexField({
        walls, bounds: rect, size: size / 10, step: distance * 10,
        full: { width: full.x, height: full.y }, cramped: { width: cramped.x, height: cramped.y },
        stepCosts: terrainStepCosts(token, base, !!options.preview),
        regions,
        floors: floorHeights(token, base.level),
        climb,
        // A Squeeze fits half the cramped footprint; Small and Tiny creatures have no cramped footprint to halve.
        squeeze: full.x !== cramped.x || full.y !== cramped.y ? { width: cramped.x / 2, height: cramped.y / 2 } : undefined,
        known: restricted ? isKnownMovementPoint : undefined,
    });
    const entry = { key, actor: token.actor?.system, field };
    hexFields.set(token, entry);
    return entry;
}

/** Does this leg force the token's cramped footprint through walls, i.e. a Squeeze? */
export function isSqueezedLeg(token: Token.Implementation, from: Waypoint, to: Waypoint): boolean {
    const native = token as unknown as NativeToken;
    const { solid, clearance } = movementClearance(native, to, true);
    if (solid === clearance) return false;
    const a = native.document.getCenterPoint({ ...from, width: to.width, height: to.height, shape: to.shape });
    const b = native.document.getCenterPoint(to);
    return obstructedFraction(clearance, a, b) > 0;
}

/** Record and preview the same native terrain costs, including cramped passages. */
export function measureProposedMovement(token: Token.Implementation, points: Partial<Waypoint>[]): number {
    const native = token as unknown as NativeToken;
    return native.measureMovementPath(native.createTerrainMovementPath(points, { preview: true }), { preview: true }).cost;
}

function activatePassageCosts(): void {
    type Offset = { i: number; j: number; k?: number };
    type Segment = Waypoint & { terrain?: { difficulty: number } | null };
    type Cost = (from: Offset, to: Offset, distance: number, segment: Segment) => number;
    const data = CONFIG.Token.movement.TerrainData as unknown as {
        getMovementCostFunction(document: { object: NativeToken | null }, options?: { preview?: boolean }): Cost;
    };
    const original = data.getMovementCostFunction;
    data.getMovementCostFunction = function (document, options) {
        const cost = original.call(this, document, options);
        if (!isGridlessActive() || !document.object) return cost;
        const token = document.object;
        return (from, to, distance, segment) => {
            const measured = cost(from, to, distance, segment);
            const action = CONFIG.Token.movement.actions[segment.action];
            if (!action?.walls || action.teleport || from.k !== to.k || (segment.terrain?.difficulty ?? 1) >= 2) return measured;
            const { solid, clearance } = movementClearance(token, segment, !!options?.preview);
            if (solid === clearance) return measured;
            const a = token.document.getCenterPoint({ ...segment, x: from.j, y: from.i });
            const b = token.document.getCenterPoint({ ...segment, x: to.j, y: to.i });
            const crampedFraction = obstructedFraction(solid, a, b);
            if (!crampedFraction) return measured;
            // Where even the cramped footprint overlaps walls the token is squeezing: greater difficult terrain.
            const squeezedFraction = obstructedFraction(clearance, a, b);
            const cramped = cost(from, to, distance, { ...segment, terrain: { difficulty: 2 } });
            let total = measured + Math.max(0, cramped - measured) * (crampedFraction - squeezedFraction);
            if (squeezedFraction > 0) {
                const greater = cost(from, to, distance, { ...segment, terrain: { difficulty: 3 } });
                total += Math.max(0, greater - measured) * squeezedFraction;
            }
            return total;
        };
    };
}

/** Snap the destination only when the final native legs still clear the full footprint. */
function hexSnapEnd(token: NativeToken, path: Waypoint[], options: PathOptions): Waypoint[] | null {
    const last = path.at(-1)!, previous = path.at(-2);
    const action = CONFIG.Token.movement.actions[last.action];
    let snapped = path;
    if (action?.walls && !action.teleport && previous?.level === last.level && previous.elevation === last.elevation) {
        const destination = token.document.getCenterPoint(last);
        const size = token.scene.dimensions.size / 10;
        const centre = hexCentre(hexAt(destination, size), size);
        const pivot = token.document.getCenterPoint({ ...last, x: 0, y: 0 });
        snapped = [...path.slice(0, -1), { ...last, x: centre.x - pivot.x, y: centre.y - pivot.y }];
    }
    for (let i = 1; i < snapped.length; i++) {
        const from = snapped[i - 1], to = snapped[i], action = CONFIG.Token.movement.actions[to.action];
        if (!action?.walls || action.teleport || from.level !== to.level || from.elevation !== to.elevation) continue;
        const { field } = movementHexField(token, to, options);
        const a = token.document.getCenterPoint({ ...from, width: to.width, height: to.height, shape: to.shape });
        const b = token.document.getCenterPoint(to);
        if (!clearSegment(field.fullSpace, b, b) || !clearSegment(field.fullSpace, a, b)) return null;
    }
    return snapped;
}


/** Route through the lattice: the cells the token steps through, pulled to corner waypoints. */
function hexPathJob(token: NativeToken, points: Waypoint[], options: PathOptions, original: NativeToken["findMovementPath"],
    direct: boolean): Job<Waypoint[]> {
    let cancelled = false;
    let nativeJob: Job<Waypoint[]> | undefined;
    const job: Job<Waypoint[]> = { cancel: () => { cancelled = true; nativeJob?.cancel(); }, promise: Promise.resolve(null) };
    job.promise = (async () => {
        // A clear drag keeps the native straight line; the lattice is only needed to navigate.
        if (direct) {
            nativeJob = original.call(token, points, options);
            const straight = await nativeJob.promise;
            if (cancelled || !straight?.length) return cancelled ? null : straight;
            const snapped = hexSnapEnd(token, straight, options);
            if (snapped) return snapped;
        }
        const routed = [points[0]];
        const actions = CONFIG.Token.movement.actions as unknown as Record<string, { walls: string | null; teleport?: boolean }>;
        for (let i = 1; i < points.length; i++) {
            if (cancelled) return null;
            const from = routed.at(-1)!, to = points[i];
            // Native movement remains authoritative for explicit vertical/level transitions and teleportation.
            if (from.level !== to.level || from.elevation !== to.elevation || !actions[to.action]?.walls || actions[to.action].teleport) {
                routed.push(to);
                continue;
            }
            const { field } = movementHexField(token, { ...to, level: from.level }, options);
            const origin = token.document.getCenterPoint({ ...from, width: to.width, height: to.height, shape: to.shape });
            const destination = token.document.getCenterPoint(to);
            const start = hexAt(origin, field.size), goal = hexAt(destination, field.size);
            let mode: HexClearanceMode = "full";
            let route = hexRoute(field, start, goal, mode);
            if (!route && field.canCramp) {
                mode = "cramped";
                route = hexRoute(field, start, goal, mode);
            }
            // Gaps down to half the cramped footprint are squeezed through as greater difficult terrain.
            if (!route && field.canSqueeze) {
                mode = "squeeze";
                route = hexRoute(field, start, goal, mode);
            }
            if (!route) break;
            const path = hexPull(field, route, mode);
            const { space } = modeArrays(field, mode);
            if (!clearSegment(space, origin, path[0])) break;
            const pivot = token.document.getCenterPoint({ ...to, x: 0, y: 0 });
            for (const point of path) {
                routed.push({ ...to, x: point.x - pivot.x, y: point.y - pivot.y,
                    explicit: false, checkpoint: false, snapped: false });
            }
            const last = routed.at(-1)!;
            last.explicit = to.explicit;
            last.checkpoint = to.checkpoint;
        }
        if (cancelled) return null;
        nativeJob = original.call(token, routed, options);
        const result = await nativeJob.promise;
        return cancelled ? null : result;
    })().then(result => {
        if (cancelled) result = null;
        job.result = result;
        return result;
    });
    return job;
}

export function getMovementArea(token: Token.Implementation, center: Point, budget: number, preview?: Partial<Waypoint>, debug = false): MovementAreaJob {
    const native = token as unknown as NativeToken;
    const source = native.document._source;
    const input = preview;
    const { x = source.x, y = source.y, width = source.width, height = source.height, depth = source.depth,
        shape = source.shape, elevation = source.elevation, level = source.level, action: movement = native.document.movementAction } = input ?? {};
    const base: Waypoint = { x, y, width, height, depth, shape, elevation, level, action: movement };
    const action = CONFIG.Token.movement.actions[base.action];
    if (action.teleport || !action.walls) return { result: [], promise: Promise.resolve([]), cancel() {} };
    const entry = movementLatticeMode() === "hex"
        ? movementHexField(native, base, { preview: true })
        : movementMap(native, base, { preview: true });
    const key = `${center.x}:${center.y}:${budget}:${debug}`;
    const prior = areas.get(native);
    if (prior?.map === entry && prior.key === key) return prior.job;
    prior?.job.cancel();
    let cancelled = false;
    const epoch = revision;
    const isCancelled = () => cancelled || epoch !== revision;
    const job: MovementAreaJob = { cancel: () => {
        cancelled = true;
        if (areas.get(native)?.job === job) areas.delete(native);
    }, promise: Promise.resolve(null) };
    const continuous = "map" in entry ? entry.map : undefined;
    const field = "field" in entry ? entry.field : undefined;
    job.promise = (async () => {
        if (field) {
            const reached = floodReachable(field, hexAt(center, field.size), Math.round(budget * 100));
            if (!reached || isCancelled()) return isCancelled() ? null : [];
            job.frontier = { size: field.size, rims: blockedFrontier(field) };
            if (debug) job.debug = snapshotMovementDebug(field, native.scene.regions, base.level, base.elevation,
                native.scene.flags?.[game.system!.id]?.environmentTypes ?? []);
            return hexContours(field);
        }
        if (!continuous) return null;
        const search = await searchNavigation(continuous, center, { budget, cancelled: isCancelled });
        if (!search || isCancelled()) return null;
        const polygons = await reachablePolygons(continuous, search, budget, isCancelled);
        if (isCancelled()) return null;
        return polygons;
    })().then(result => { job.result = result; return result; });
    areas.set(native, { key, map: entry, job });
    return job;
}

/** Merge overlapping cost fronts so the display has one boundary, including holes. */
export function mergeMovementArea(polygons: number[][]): number[][] {
    if (!polygons.length) return [];
    if (polygons.length === 1) return polygons;
    const paths = polygons.map(points => {
        const path: ClipperLib.Path = [];
        for (let i = 0; i < points.length; i += 2) path.push({ X: Math.round(points[i] * 100), Y: Math.round(points[i + 1] * 100) });
        if (!ClipperLib.Clipper.Orientation(path)) path.reverse();
        return path;
    });
    const clipper = new ClipperLib.Clipper();
    const result: ClipperLib.Paths = [];
    clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
    clipper.Execute(ClipperLib.ClipType.ctUnion, result, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    return result.map(path => path.flatMap(point => [point.X / 100, point.Y / 100]));
}

export function activateGridlessRouting(): void {
    activateGridlessTerrainCosts();
    activatePassageCosts();
    maps = new WeakMap(); areas = new WeakMap(); clearances = new WeakMap(); hexFields = new WeakMap(); revision++;
    const prototype = CONFIG.Token.objectClass.prototype as unknown as NativeToken;
    const originalConstraint = prototype.constrainMovementPath;
    prototype.constrainMovementPath = function (points, options = {}) {
        const [path, constrained] = originalConstraint.call(this, points, options);
        // Hex paths use the footprint selected by their search. Do not re-clamp a passage
        // fallback with a different footprint after routing.
        if (!isGridlessActive() || movementLatticeMode() === "hex" || options.preview || options.ignoreWalls) return [path, constrained];
        for (let i = 1; i < path.length; i++) {
            const from = path[i - 1], to = path[i];
            const action = CONFIG.Token.movement.actions[to.action];
            if (from.level !== to.level || from.elevation !== to.elevation || action.teleport || !action.walls) continue;
            const { map, pivot } = movementMap(this, to, { measureOptions: options.measureOptions });
            const origin = this.document.getCenterPoint({ ...from, width: to.width, height: to.height, shape: to.shape });
            const destination = this.document.getCenterPoint(to);
            if (clearSegment(map.clearance, origin, destination)) continue;
            const dx = destination.x - origin.x, dy = destination.y - origin.y, length = Math.hypot(dx, dy);
            const limit = rayClearance(map.clearance, origin, { x: dx, y: dy }, length);
            const partial = path.slice(0, i);
            for (let distance = limit; distance > 0; distance--) {
                const end = { ...to, x: Math.round(origin.x + dx * distance / length - pivot.x),
                    y: Math.round(origin.y + dy * distance / length - pivot.y), explicit: false, snapped: false, checkpoint: false };
                if (!clearSegment(map.clearance, origin, this.document.getCenterPoint(end))) continue;
                if (end.x !== from.x || end.y !== from.y) partial.push(end);
                break;
            }
            return [partial, true];
        }
        return [path, constrained];
    };
    const original = prototype.findMovementPath;
    prototype.findMovementPath = function (points, options = {}): Job<Waypoint[]> {
        if (!isGridlessActive() || options.constrainOptions?.ignoreWalls || options.constrainOptions?.ignoreCost) {
            return original.call(this, points, options);
        }
        // Captured synchronously so previews can follow the cursor while routing is still running.
        dragPaths.set(this, points as unknown as Partial<TokenDocument.MeasuredMovementWaypoint>[]);
        const nativePoints = this.createTerrainMovementPath(points, { ...options.terrainOptions, preview: options.preview })
            .filter(point => !point.intermediate);
        if (nativePoints.length < 2) return original.call(this, points, options);
        // A clear segment at the minimum possible cost cannot benefit from a detour.
        // Keep this synchronous to avoid Foundry's asynchronous search-animation delay.
        const direct = nativePoints.slice(1).every((to, index) => {
            const from = nativePoints[index], action = CONFIG.Token.movement.actions[to.action];
            if (from.level !== to.level || from.elevation !== to.elevation || action.teleport || !action.walls) return true;
            const { map } = movementMap(this, to, options);
            const a = this.document.getCenterPoint({ ...from, width: to.width, height: to.height, shape: to.shape });
            const b = this.document.getCenterPoint(to);
            if (!clearSegment(map.clearance, a, b)) return false;
            const lower = Math.hypot(b.x - a.x, b.y - a.y) * (map.minimumCostPerPixel ?? 0);
            const cost = map.cost(a, b);
            return Number.isFinite(cost) && cost <= lower + 1e-8;
        });
        if (movementLatticeMode() === "hex") return hexPathJob(this, nativePoints, options, original, direct);
        if (direct) return original.call(this, points, options);
        let cancelled = false;
        const isCancelled = () => cancelled;
        let nativeJob: Job<Waypoint[]> | undefined;
        const job: Job<Waypoint[]> = { cancel: () => { cancelled = true; nativeJob?.cancel(); }, promise: Promise.resolve(null) };
        job.promise = (async () => {
            const routed = [nativePoints[0]];
            const actions = CONFIG.Token.movement.actions as unknown as Record<string, { walls: string | null; teleport?: boolean }>;
            for (let i = 1; i < nativePoints.length; i++) {
                if (isCancelled()) return null;
                const from = routed.at(-1)!, to = nativePoints[i];
                // Native movement remains authoritative for explicit vertical/level transitions and teleportation.
                if (from.level !== to.level || from.elevation !== to.elevation || !actions[to.action]?.walls || actions[to.action].teleport) {
                    routed.push(to); continue;
                }
                const { map, pivot } = movementMap(this, { ...to, level: from.level }, options);
                const origin = this.document.getCenterPoint({ ...from, width: to.width, height: to.height, shape: to.shape });
                const destination = this.document.getCenterPoint(to);
                const search = await searchNavigation(map, origin, { destination, cancelled: isCancelled });
                if (!search || isCancelled()) return null;
                const path = navigationPath(search, search.points.length - 1);
                if (!path) break;
                for (let j = 1; j < path.length; j++) {
                    routed.push({ ...to, x: path[j].x - pivot.x, y: path[j].y - pivot.y,
                        explicit: j === path.length - 1 ? to.explicit : false,
                        checkpoint: j === path.length - 1 ? to.checkpoint : false, snapped: false });
                }
            }
            if (isCancelled()) return null;
            nativeJob = original.call(this, routed, options);
            const result = await nativeJob.promise;
            if (isCancelled()) return null;
            return result;
        })().then(result => { job.result = result; return result; });
        return job;
    };
    const invalidate = () => { revision++; };
    for (const hook of ["createWall", "updateWall", "deleteWall", "createRegion", "updateRegion", "deleteRegion",
        "createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior", "updateScene", "updateActor",
        "createItem", "updateItem", "deleteItem", "canvasReady"] as const) {
        Hooks.on(hook, invalidate);
    }
    Hooks.on("visibilityRefresh", () => { if (!game.user!.isGM && canvas!.visibility.tokenVision) invalidate(); });
    Hooks.on("canvasTearDown", () => { maps = new WeakMap(); areas = new WeakMap(); clearances = new WeakMap(); hexFields = new WeakMap(); revision++; });
}
