import { buildClearance, clearSegment, pointInStrictInterior, type Clearance, type NavigationWall } from "./clearance.js";
import type { Bounds, Point } from "./geometry.js";
import { STEP_FEET } from "./elevation.js";
import { hexAt, hexCentre, hexCorners, hexDistance, hexNeighbour, hexRange, HEX_DIRECTIONS, type Hex } from "./hex.js";

const ROOT_THREE_OVER_TWO = Math.sqrt(3) / 2;
const EPSILON = 1e-9;
const VERTEX_PRECISION = 1e4;

export interface HexRegion {
    /** Terrain difficulty inside this region (1 = nothing, 2 = difficult, 3 = greater difficult). */
    difficulty: number;
    /** Flat polygon rings in scene pixels. */
    polygons: readonly (readonly number[])[];
}

export interface HexFloor {
    /** Floor height in feet. */
    floor: number;
    /** Flat polygon rings in scene pixels. */
    polygons: readonly (readonly number[])[];
}

export interface HexFieldOptions {
    walls: readonly NavigationWall[];
    bounds: Bounds;
    /** Centre-to-centre step in scene pixels (`dimensions.size / 10`). */
    size: number;
    /** Step length in hundredths of a movement unit (`dimensions.distance * 10`). */
    step: number;
    full: { width: number; height: number };
    cramped: { width: number; height: number };
    /** Per-step costs in hundredths, indexed by terrain difficulty (0 and 1 are plain). */
    stepCosts?: readonly number[];
    regions?: readonly HexRegion[];
    /** Map-workshop floor heights; a step up of more than one 2.5 ft tread needs `climb`. */
    floors?: readonly HexFloor[];
    /** The movement action may take any rise, or climbs are not enforced. */
    climb?: boolean;
    /** Footprint a Squeeze could still pass; gaps it fits but the cramped footprint does not are marked, not blocked. */
    squeeze?: { width: number; height: number };
    /** Restricted previews: cells whose centre is unknown are blocked. */
    known?: (point: Point) => boolean;
    /**
     * Footprint overlap tolerated at the lattice's own precision (default: half a cell).
     * Without it, exactly fitting doorways and passages have zero-width centre bands
     * and would silently disappear from the lattice.
     */
    tolerance?: number;
}

export type HexClearanceMode = "full" | "cramped" | "squeeze";

export interface HexField {
    size: number;
    step: number;
    qMin: number;
    qMax: number;
    rMin: number;
    rMax: number;
    qSpan: number;
    rSpan: number;
    /** 1 = the centre cannot hold the footprint, even cramped, within tolerance. */
    blocked: Uint8Array;
    /** 0 = plain ground, else 1..3 with cramped passages as difficult terrain. */
    difficulty: Uint8Array;
    /** Normal movement never enters cells where the full footprint overlaps walls or bounds. */
    fullBlocked: Uint8Array;
    /** Floor height per cell in feet, NaN where no floor region applies. */
    floor: Float32Array;
    climb: boolean;
    /** 1 = even the squeeze footprint overlaps walls; equals `blocked` when no squeeze footprint applies. */
    squeezeBlocked: Uint8Array;
    /** Tolerant clearance of the squeeze footprint; equals `space` when no squeeze footprint applies. */
    squeezeSpace: Clearance;
    canSqueeze: boolean;
    fullSpace: Clearance;
    canCramp: boolean;
    /** Per-step costs in hundredths, indexed by terrain difficulty. */
    stepCosts: number[];
    /** Cheapest possible step in hundredths: an admissible heuristic factor. */
    minimum: number;
    /** Index offsets of the six neighbours, or an out-of-range index when guarded. */
    steps: Int32Array;
    /** Flood scratch: cost in hundredths per reached cell. */
    costs: Int32Array;
    /** Flood scratch: generation stamps, so repeated floods need no clearing. */
    generation: Uint32Array;
    stamp: number;
    /** Routing scratch: best known cost in hundredths per cell. */
    routeCosts: Int32Array;
    routeGeneration: Uint32Array;
    routeFrom: Int32Array;
    routeStamp: number;
    /** Tolerant clearance the block raster came from; pulled legs are checked against it. */
    space: Clearance;
    /** Bucket queue ring, sized to the dearest edge. */
    queue: number[][];
    queueSize: number;
}

export function hexFieldIndex(field: HexField, hex: Hex): number {
    if (hex.q < field.qMin || hex.q > field.qMax || hex.r < field.rMin || hex.r > field.rMax) return -1;
    return (hex.q - field.qMin) * field.rSpan + (hex.r - field.rMin);
}

export function hexFieldHex(field: HexField, index: number): Hex {
    const offset = index % field.rSpan;
    return { q: (index - offset) / field.rSpan + field.qMin, r: offset + field.rMin };
}

export function hexFieldCellCount(field: HexField): number {
    return field.blocked.length;
}

export function hexFieldBlocked(field: HexField, hex: Hex): boolean {
    const index = hexFieldIndex(field, hex);
    return index >= 0 && !!field.blocked[index];
}

function reachedIndex(field: HexField, index: number): boolean {
    return index >= 0 && field.generation[index] === field.stamp && field.costs[index] >= 0;
}

export function hexFieldReached(field: HexField, hex: Hex): boolean {
    return reachedIndex(field, hexFieldIndex(field, hex));
}

/** Cost in hundredths of a movement unit, or -1 when the last flood did not reach the cell. */
export function hexFieldCost(field: HexField, hex: Hex): number {
    const index = hexFieldIndex(field, hex);
    return reachedIndex(field, index) ? field.costs[index] : -1;
}

function polygonBounds(points: readonly number[]): Bounds {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < points.length; i += 2) {
        minX = Math.min(minX, points[i]); maxX = Math.max(maxX, points[i]);
        minY = Math.min(minY, points[i + 1]); maxY = Math.max(maxY, points[i + 1]);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function rasterise(field: HexField, bounds: Bounds, inside: (x: number, y: number) => boolean, mark: (index: number) => void): void {
    const range = hexRange(bounds, field.size);
    const qMin = Math.max(field.qMin, range.qMin), qMax = Math.min(field.qMax, range.qMax);
    const rMin = Math.max(field.rMin, range.rMin), rMax = Math.min(field.rMax, range.rMax);
    for (let r = rMin; r <= rMax; r++) {
        const y = ROOT_THREE_OVER_TWO * field.size * r;
        for (let q = qMin; q <= qMax; q++) {
            if (!inside(field.size * (q + r / 2), y)) continue;
            mark((q - field.qMin) * field.rSpan + (r - field.rMin));
        }
    }
}

/** Even-odd point-in-polygon for arbitrary (concave) region rings given as flat scene pixels. */
export function pointInRegionPolygon(polygon: readonly number[], x: number, y: number): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
        const xi = polygon[i], yi = polygon[i + 1], xj = polygon[j], yj = polygon[j + 1];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

function rasteriseRegion(field: HexField, polygon: readonly number[], mark: (index: number) => void): void {
    if (polygon.length < 6) return;
    rasterise(field, polygonBounds(polygon), (x, y) => pointInRegionPolygon(polygon, x, y), mark);
}

function rasteriseClearance(field: HexField, space: Clearance, mark: (index: number) => void): void {
    for (const obstacle of space.obstacles) {
        const { polygon } = obstacle;
        rasterise(field, obstacle.bounds, (x, y) => pointInStrictInterior(polygon, { x, y }), mark);
    }
}

export function buildHexField(options: HexFieldOptions): HexField {
    // ponytail: fields cover the scene; crop them if very large scenes make builds expensive.
    const { walls, bounds, size, step } = options;
    const range = hexRange(bounds, size);
    const qSpan = range.qMax - range.qMin + 1, rSpan = range.rMax - range.rMin + 1;
    const count = qSpan * rSpan;
    const stepCosts = [step, step, options.stepCosts?.[2] ?? 2 * step, options.stepCosts?.[3] ?? 3 * step];
    const dearest = Math.max(...stepCosts);
    const tolerance = options.tolerance ?? size / 2;
    const space = buildClearance(walls, bounds, options.cramped.width, options.cramped.height, -tolerance);
    const fullSpace = buildClearance(walls, bounds, options.full.width, options.full.height, 0);
    const canCramp = options.cramped.width !== options.full.width || options.cramped.height !== options.full.height;
    const field: HexField = {
        size, step, ...range, qSpan, rSpan, space, fullSpace, canCramp,
        blocked: new Uint8Array(count), difficulty: new Uint8Array(count), fullBlocked: new Uint8Array(count),
        floor: new Float32Array(count).fill(NaN), climb: !!options.climb,
        squeezeBlocked: new Uint8Array(count), squeezeSpace: space, canSqueeze: !!options.squeeze,
        stepCosts, minimum: step,
        steps: Int32Array.from(HEX_DIRECTIONS.map(({ q, r }) => q * rSpan + r)),
        costs: new Int32Array(count).fill(-1), generation: new Uint32Array(count), stamp: 0,
        routeCosts: new Int32Array(count).fill(-1), routeGeneration: new Uint32Array(count),
        routeFrom: new Int32Array(count).fill(-1), routeStamp: 0,
        queueSize: dearest + 1, queue: Array.from({ length: dearest + 1 }, () => [] as number[]),
    };
    rasteriseClearance(field, space, index => { field.blocked[index] = 1; });
    rasteriseClearance(field, fullSpace, index => { field.fullBlocked[index] = 1; });
    if (options.squeeze) {
        // Keep the effective squeeze footprint wider than one cell: at exactly one cell, cells either
        // side of a wall are both passable and adjacent, so pockets would walk straight through walls.
        const squeezeTolerance = Math.max(0, Math.min(tolerance, (Math.min(options.squeeze.width, options.squeeze.height) - size - 2) / 2));
        field.squeezeSpace = buildClearance(walls, bounds, options.squeeze.width, options.squeeze.height, -squeezeTolerance);
        rasteriseClearance(field, field.squeezeSpace, index => { field.squeezeBlocked[index] = 1; });
    } else {
        field.squeezeBlocked = field.blocked;
    }
    if (canCramp && walls.length) {
        const feeSpace = buildClearance(walls, bounds, options.full.width, options.full.height, -tolerance);
        rasteriseClearance(field, feeSpace, index => { if (field.difficulty[index] < 2) field.difficulty[index] = 2; });
    }
    // A squeezed stretch is greater difficult terrain; only squeeze-mode routes ever enter these cells.
    if (options.squeeze) for (let index = 0; index < count; index++) if (field.blocked[index] && !field.squeezeBlocked[index]) field.difficulty[index] = 3;
    // Scene regions are arbitrary rings, often concave; the convex clearance test does not apply to them.
    for (const region of options.regions ?? []) {
        for (const polygon of region.polygons) {
            rasteriseRegion(field, polygon, index => { if (field.difficulty[index] < region.difficulty) field.difficulty[index] = region.difficulty; });
        }
    }
    for (const { floor, polygons } of options.floors ?? []) {
        for (const polygon of polygons) rasteriseRegion(field, polygon, index => { field.floor[index] = floor; });
    }
    if (options.floors?.length) fillFloors(field);
    // Cells whose centre leaves the standable bounds are unusable, exactly as clearSegment requires.
    const limits = [[space.bounds, field.blocked], [fullSpace.bounds, field.fullBlocked], [space.bounds, field.squeezeBlocked]] as const;
    for (let index = 0; index < count; index++) {
        const hex = hexFieldHex(field, index);
        const x = size * (hex.q + hex.r / 2), y = ROOT_THREE_OVER_TWO * size * hex.r;
        for (const [limit, blocked] of limits) {
            if (x < limit.x - EPSILON * Math.max(1, Math.abs(x)) || x > limit.x + limit.width + EPSILON * Math.max(1, Math.abs(x))
                || y < limit.y - EPSILON * Math.max(1, Math.abs(y)) || y > limit.y + limit.height + EPSILON * Math.max(1, Math.abs(y))) {
                blocked[index] = 1;
            }
        }
        if (options.known && !options.known({ x, y })) field.blocked[index] = field.fullBlocked[index] = field.squeezeBlocked[index] = 1;
    }
    return field;
}


/**
 * Cell centres exactly on a floor boundary fail the strict interior test and would otherwise
 * bridge two heights for free. Give every unassigned cell the floor of its nearest floored
 * neighbour, so each boundary cell belongs to one side.
 */
function fillFloors(field: HexField): void {
    const { floor, rSpan, qSpan } = field;
    const queue: number[] = [];
    for (let index = 0; index < floor.length; index++) if (!Number.isNaN(floor[index])) queue.push(index);
    for (let head = 0; head < queue.length; head++) {
        const index = queue[head];
        const offset = index % rSpan, q = (index - offset) / rSpan, r = offset;
        for (let direction = 0; direction < 6; direction++) {
            const nextQ = q + HEX_DIRECTIONS[direction].q, nextR = r + HEX_DIRECTIONS[direction].r;
            if (nextQ < 0 || nextQ >= qSpan || nextR < 0 || nextR >= rSpan) continue;
            const next = index + field.steps[direction];
            if (!Number.isNaN(floor[next])) continue;
            floor[next] = floor[index];
            queue.push(next);
        }
    }
}

/** A step between neighbouring cells may descend freely or rise one tread; higher rises need climbing. */
export function canStep(field: HexField, from: number, to: number): boolean {
    const a = field.floor[from], b = field.floor[to];
    if (field.climb || Number.isNaN(a) || Number.isNaN(b)) return true;
    return b - a <= STEP_FEET + EPSILON;
}

/**
 * Dijkstra over the fixed lattice with a bucket queue, from `start` within `budget`
 * hundredths. Costs stay on the field, so callers must read them before the next flood.
 */
export function floodReachable(field: HexField, start: Hex, budget: number): number {
    const startIndex = hexFieldIndex(field, start);
    // ponytail: a footprint overlapping a wall gets no lattice ring or route; letting it
    // step through blocked cells to escape would allow phasing through thin walls.
    if (startIndex < 0 || budget < 0 || field.blocked[startIndex]) return 0;
    const { costs, generation, blocked, queue, queueSize } = field;
    const stamp = ++field.stamp;
    let reached = 0;
    const push = (index: number, cost: number): void => {
        queue[cost % queueSize].push(index);
    };
    costs[startIndex] = 0;
    generation[startIndex] = stamp;
    push(startIndex, 0);
    for (let distance = 0; distance <= budget; distance++) {
        const bucket = queue[distance % queueSize];
        while (bucket.length) {
            const index = bucket.pop()!;
            if (generation[index] !== stamp || costs[index] !== distance) continue;
            reached++;
            const offset = index % field.rSpan;
            const q = (index - offset) / field.rSpan, r = offset;
            for (let direction = 0; direction < 6; direction++) {
                const nextQ = q + HEX_DIRECTIONS[direction].q, nextR = r + HEX_DIRECTIONS[direction].r;
                if (nextQ < 0 || nextQ >= field.qSpan || nextR < 0 || nextR >= field.rSpan) continue;
                const next = index + field.steps[direction];
                if (blocked[next] || !canStep(field, index, next)) continue;
                const cost = distance + field.stepCosts[field.difficulty[next]];
                if (cost > budget) continue;
                if (generation[next] === stamp && costs[next] <= cost) continue;
                costs[next] = cost;
                generation[next] = stamp;
                push(next, cost);
            }
        }
    }
    // Entries dearer than the budget remain in the ring; the ring is small, so clear it whole.
    for (const bucket of queue) bucket.length = 0;
    return reached;
}

export type FrontierReason = "climb" | "squeeze";
export interface FrontierRim {
    reason: FrontierReason;
    /** True when the token can go there with a check: a climb that is not refused, or any squeeze. */
    passable: boolean;
    cells: Hex[];
    centre: Point;
}

function forEachNeighbour(field: HexField, index: number, visit: (next: number) => void): void {
    const offset = index % field.rSpan, q = (index - offset) / field.rSpan, r = offset;
    for (let direction = 0; direction < 6; direction++) {
        const nextQ = q + HEX_DIRECTIONS[direction].q, nextR = r + HEX_DIRECTIONS[direction].r;
        if (nextQ < 0 || nextQ >= field.qSpan || nextR < 0 || nextR >= field.rSpan) continue;
        visit(index + field.steps[direction]);
    }
}

/**
 * Every cell joined to the last flood's reach by cramped-passable ground, ignoring floors and
 * budget. A ledge is not a squeeze destination, so this deliberately ignores the step rule.
 */
function wallConnected(field: HexField): Uint8Array {
    const connected = new Uint8Array(field.blocked.length);
    const queue: number[] = [];
    for (let index = 0; index < connected.length; index++) if (reachedIndex(field, index)) { connected[index] = 1; queue.push(index); }
    while (queue.length) {
        const index = queue.pop()!;
        forEachNeighbour(field, index, next => {
            if (connected[next] || field.blocked[next]) return;
            connected[next] = 1; queue.push(next);
        });
    }
    return connected;
}

/** Does the sealed-off ground reached from these cells hold a cell where the full footprint fits? */
function standableBeyond(field: HexField, seeds: readonly number[], connected: Uint8Array): boolean {
    const seen = new Set<number>(seeds);
    const queue = [...seeds];
    while (queue.length) {
        const index = queue.pop()!;
        if (!field.fullBlocked[index]) return true;
        forEachNeighbour(field, index, next => {
            if (seen.has(next) || field.blocked[next] || connected[next]) return;
            seen.add(next); queue.push(next);
        });
    }
    return false;
}

/** Cells of the rim drawn around a squeeze opening: this many lattice steps from where the pocket meets sealed-off ground. */
const SQUEEZE_RIM_DEPTH = 3;

/**
 * Cells next to the last flood's reach that the token could enter only by climbing a ledge or
 * squeezing through a gap, grouped into contiguous rims per reason with a centroid for an icon.
 * A squeeze rim must lead on: its squeeze-only cells have to connect to ground the token cannot
 * otherwise reach, so the cramped strip along an ordinary wall is never marked.
 */
export function blockedFrontier(field: HexField): FrontierRim[] {
    const { blocked, squeezeBlocked, floor } = field;
    const squeezeOnly = (index: number): boolean => !!blocked[index] && !squeezeBlocked[index];
    const rise = (from: number, to: number): boolean => !Number.isNaN(floor[from]) && !Number.isNaN(floor[to]) && floor[to] - floor[from] > STEP_FEET + EPSILON;
    const reasons = new Map<number, { reason: FrontierReason; passable: boolean }>();
    const squeezeBand = new Set<number>();
    for (let index = 0; index < blocked.length; index++) {
        if (!reachedIndex(field, index)) continue;
        forEachNeighbour(field, index, next => {
            if (reachedIndex(field, next)) {
                // A ledge the flood climbed: still worth marking, since taking it prompts a check.
                if (rise(index, next) && !reasons.has(next)) reasons.set(next, { reason: "climb", passable: true });
                return;
            }
            if (!blocked[next]) { if (!canStep(field, index, next)) reasons.set(next, { reason: "climb", passable: false }); }
            else if (field.canSqueeze && squeezeOnly(next)) squeezeBand.add(next);
        });
    }
    if (squeezeBand.size) {
        const connected = wallConnected(field);
        const seen = new Set<number>();
        for (const seed of squeezeBand) {
            if (seen.has(seed)) continue;
            // Walk the whole squeeze-only pocket and note where it opens onto ground sealed off by walls.
            const queue = [seed];
            seen.add(seed);
            const exits: number[] = [];
            const beyond: number[] = [];
            while (queue.length) {
                const index = queue.pop()!;
                let exit = false;
                forEachNeighbour(field, index, next => {
                    if (squeezeOnly(next)) { if (!seen.has(next)) { seen.add(next); queue.push(next); } return; }
                    if (!blocked[next] && !connected[next]) { exit = true; beyond.push(next); }
                });
                if (exit) exits.push(index);
            }
            // Only ground a full footprint can stand on is worth squeezing towards; slivers between wall chains are not.
            if (!exits.length || !standableBeyond(field, beyond, connected)) continue;
            // Mark only the part of the band near the opening, not the cramped strip along every wall it joins.
            const depth = new Map<number, number>(exits.map(index => [index, 0]));
            const wave = [...exits];
            while (wave.length) {
                const index = wave.shift()!;
                const next = depth.get(index)! + 1;
                if (squeezeBand.has(index)) reasons.set(index, { reason: "squeeze", passable: true });
                if (next > SQUEEZE_RIM_DEPTH) continue;
                forEachNeighbour(field, index, neighbour => {
                    if (!squeezeOnly(neighbour) || depth.has(neighbour)) return;
                    depth.set(neighbour, next); wave.push(neighbour);
                });
            }
        }
    }
    const rims: FrontierRim[] = [];
    const grouped = new Set<number>();
    const same = (a: { reason: FrontierReason; passable: boolean }, b?: { reason: FrontierReason; passable: boolean }): boolean =>
        !!b && a.reason === b.reason && a.passable === b.passable;
    for (const [seed, kind] of reasons) {
        if (grouped.has(seed)) continue;
        const cells: Hex[] = [];
        const queue = [seed];
        grouped.add(seed);
        let sumX = 0, sumY = 0;
        while (queue.length) {
            const index = queue.pop()!;
            const hex = hexFieldHex(field, index);
            cells.push(hex);
            const centre = hexCentre(hex, field.size);
            sumX += centre.x; sumY += centre.y;
            forEachNeighbour(field, index, next => {
                if (grouped.has(next) || !same(kind, reasons.get(next))) return;
                grouped.add(next); queue.push(next);
            });
        }
        rims.push({ ...kind, cells, centre: { x: sumX / cells.length, y: sumY / cells.length } });
    }
    return rims;
}

interface BoundaryEdge {
    from: string;
    to: string;
    ax: number;
    ay: number;
    bx: number;
    by: number;
}

const vertexKey = (x: number, y: number): string => `${Math.round(x * VERTEX_PRECISION) + 0}:${Math.round(y * VERTEX_PRECISION) + 0}`;

/**
 * Closed outlines of the last flood's reachable cells, as flat scene-pixel rings.
 * Hex cells never touch at a single corner, so every boundary vertex joins exactly two
 * edges and the loops trace without any tie-breaking.
 */
export function hexContours(field: HexField): number[][] {
    const edges: BoundaryEdge[] = [];
    const incident = new Map<string, number[]>();
    const add = (edge: BoundaryEdge): void => {
        edges.push(edge);
        for (const key of [edge.from, edge.to]) {
            const list = incident.get(key);
            if (list) list.push(edges.length - 1);
            else incident.set(key, [edges.length - 1]);
        }
    };
    for (let index = 0; index < field.costs.length; index++) {
        if (!reachedIndex(field, index)) continue;
        const hex = hexFieldHex(field, index);
        const corners = hexCorners(hex, field.size);
        for (let direction = 0; direction < 6; direction++) {
            if (hexFieldReached(field, hexNeighbour(hex, direction))) continue;
            const ax = corners[(5 - direction + 6) % 6].x, ay = corners[(5 - direction + 6) % 6].y;
            const bx = corners[(6 - direction) % 6].x, by = corners[(6 - direction) % 6].y;
            add({ from: vertexKey(ax, ay), to: vertexKey(bx, by), ax, ay, bx, by });
        }
    }
    const used = new Uint8Array(edges.length);
    const contours: number[][] = [];
    for (let seed = 0; seed < edges.length; seed++) {
        if (used[seed]) continue;
        const loop: number[] = [];
        let edge = seed;
        let key = edges[seed].from;
        while (edge >= 0 && !used[edge]) {
            used[edge] = 1;
            const current = edges[edge];
            loop.push(current.ax, current.ay);
            key = current.from === key ? current.to : current.from;
            const next = incident.get(key)?.find(candidate => !used[candidate]);
            edge = next ?? -1;
        }
        if (loop.length >= 6) contours.push(loop);
    }
    return contours;
}

export function modeArrays(field: HexField, mode: HexClearanceMode): { space: Clearance; blocked: Uint8Array } {
    if (mode === "full") return { space: field.fullSpace, blocked: field.fullBlocked };
    if (mode === "squeeze") return { space: field.squeezeSpace, blocked: field.squeezeBlocked };
    return { space: field.space, blocked: field.blocked };
}

/**
 * A* between two cells over the lattice, paying terrain cost on every step. Returns the chain of
 * neighbouring cells, or null when an end is blocked or no way through exists.
 */
export function hexRoute(field: HexField, from: Hex, to: Hex, mode: HexClearanceMode = "full"): Hex[] | null {
    const { space, blocked } = modeArrays(field, mode);
    const start = hexFieldIndex(field, from), goal = hexFieldIndex(field, to);
    if (start < 0 || goal < 0 || blocked[start] || blocked[goal]) return null;
    const stamp = ++field.routeStamp;
    const best = field.routeCosts, seen = field.routeGeneration, came = field.routeFrom;
    const scores: number[] = [], totals: number[] = [], nodes: number[] = [];
    const push = (score: number, total: number, index: number): void => {
        let child = scores.length;
        scores.push(score); totals.push(total); nodes.push(index);
        while (child > 0) {
            const parent = (child - 1) >> 1;
            if (scores[parent] <= scores[child]) break;
            [scores[parent], scores[child]] = [scores[child], scores[parent]];
            [totals[parent], totals[child]] = [totals[child], totals[parent]];
            [nodes[parent], nodes[child]] = [nodes[child], nodes[parent]];
            child = parent;
        }
    };
    const pop = (): void => {
        const last = scores.length - 1;
        scores[0] = scores[last]; totals[0] = totals[last]; nodes[0] = nodes[last];
        scores.pop(); totals.pop(); nodes.pop();
        let parent = 0;
        while (true) {
            const left = parent * 2 + 1, right = left + 1;
            let smallest = parent;
            if (left < scores.length && scores[left] < scores[smallest]) smallest = left;
            if (right < scores.length && scores[right] < scores[smallest]) smallest = right;
            if (smallest === parent) break;
            [scores[parent], scores[smallest]] = [scores[smallest], scores[parent]];
            [totals[parent], totals[smallest]] = [totals[smallest], totals[parent]];
            [nodes[parent], nodes[smallest]] = [nodes[smallest], nodes[parent]];
            parent = smallest;
        }
    };
    const heuristic = (index: number): number => {
        const offset = index % field.rSpan;
        return field.step * hexDistance({ q: (index - offset) / field.rSpan + field.qMin, r: offset + field.rMin }, to);
    };
    best[start] = 0; seen[start] = stamp; came[start] = -1;
    push(heuristic(start), 0, start);
    while (scores.length) {
        const popped = nodes[0], poppedTotal = totals[0];
        pop();
        if (poppedTotal !== best[popped]) continue;
        if (popped === goal) {
            const route: Hex[] = [];
            for (let index = popped; index >= 0; index = came[index]) route.push(hexFieldHex(field, index));
            return route.reverse();
        }
        const offset = popped % field.rSpan;
        const q = (popped - offset) / field.rSpan, r = offset;
        const origin = hexCentre(hexFieldHex(field, popped), field.size);
        for (let direction = 0; direction < 6; direction++) {
            const nextQ = q + HEX_DIRECTIONS[direction].q, nextR = r + HEX_DIRECTIONS[direction].r;
            if (nextQ < 0 || nextQ >= field.qSpan || nextR < 0 || nextR >= field.rSpan) continue;
            const next = popped + field.steps[direction];
            if (blocked[next] || !canStep(field, popped, next)) continue;
            const total = poppedTotal + field.stepCosts[field.difficulty[next]];
            if (seen[next] === stamp && best[next] <= total) continue;
            const destination = hexCentre(hexFieldHex(field, next), field.size);
            if (!clearSegment(space, origin, destination)) continue;
            seen[next] = stamp; best[next] = total; came[next] = popped;
            push(total + heuristic(next), total, next);
        }
    }
    return null;
}

/** Straighten within the selected footprint and searched cost budget, without moving corners. */
export function hexPull(field: HexField, cells: readonly Hex[], mode: HexClearanceMode = "full"): Point[] {
    if (!cells.length) return [];
    const { space, blocked } = modeArrays(field, mode);
    const points = cells.map(cell => hexCentre(cell, field.size));
    const costs = new Float64Array(cells.length);
    for (let i = 1; i < cells.length; i++) {
        costs[i] = costs[i - 1] + field.stepCosts[field.difficulty[hexFieldIndex(field, cells[i])]];
    }
    const canShortcut = (from: Point, to: Point, budget: number): boolean => {
        if (!clearSegment(space, from, to)) return false;
        // Integrate terrain at half-cell resolution, retaining fog and footprint gates.
        const distance = Math.hypot(to.x - from.x, to.y - from.y);
        const steps = Math.max(1, Math.ceil(distance / (field.size / 2)));
        const scale = distance / (steps * field.size);
        let cost = 0, previous = hexFieldIndex(field, hexAt(from, field.size));
        for (let i = 0; i < steps; i++) {
            const at = hexFieldIndex(field, hexAt({ x: from.x + (to.x - from.x) * (i + 0.5) / steps,
                y: from.y + (to.y - from.y) * (i + 0.5) / steps }, field.size));
            if (at < 0 || blocked[at] || !canStep(field, previous, at)) return false;
            previous = at;
            cost += field.stepCosts[field.difficulty[at]] * scale;
            if (cost > budget + EPSILON) return false;
        }
        return true;
    };
    const waypoints: Point[] = [points[0]];
    let anchor = 0;
    while (anchor < points.length - 1) {
        let next = anchor + 1;
        for (let candidate = anchor + 2; candidate < points.length; candidate++) {
            if (!canShortcut(points[anchor], points[candidate], costs[candidate] - costs[anchor])) break;
            next = candidate;
        }
        waypoints.push(points[next]);
        anchor = next;
    }
    return waypoints;
}
