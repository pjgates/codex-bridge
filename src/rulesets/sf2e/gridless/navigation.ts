import { clearSegment, pointInStrictInterior, rayClearance, segmentEntersInterior, type Clearance } from "./clearance.js";
import type { Point } from "./geometry.js";

export interface NavigationMap {
    clearance: Clearance;
    /** Complete candidate set supplied by the caller; clearance vertices remain a raw outline silhouette only. */
    points: readonly Point[];
    cost: (a: Point, b: Point) => number;
    /** Proven lower bound used for movement pruning and destination heuristics. */
    minimumCostPerPixel?: number;
}

export interface NavigationSearch {
    points: Point[];
    costs: number[];
    parents: number[];
}

const RAY_SAMPLES = 72;
/** Arc chord between neighbouring ray endpoints; small fans need proportionally fewer rays. */
const MAX_RAY_CHORD = 70;
const MIN_RAY_SAMPLES = 12;
const RAY_ANGLE_EPSILON = 1e-6;
const RAY_SEARCH_STEPS = 20;
const EPSILON = 1e-9;

type Cancelled = (() => boolean) | undefined;

/** Edge costs are deterministic per map instance and consecutive drag searches re-probe
 *  nearly the same pairs; entries live with the map object, so an invalidated map starts empty. */
const edgeCosts = new WeakMap<NavigationMap, Map<string, number>>();

function cachedCost(map: NavigationMap, from: Point, to: Point): number {
    let entries = edgeCosts.get(map);
    if (!entries) { entries = new Map(); edgeCosts.set(map, entries); }
    const key = `${from.x}:${from.y}>${to.x}:${to.y}`;
    const known = entries.get(key);
    if (known !== undefined) return known;
    const cost = map.cost(from, to);
    entries.set(key, cost);
    return cost;
}

function yieldToEventLoop(): Promise<void> {
    // Native continuation scheduling avoids timer throttling during sustained dragging.
    const scheduling = globalThis as typeof globalThis & { scheduler?: { yield(): Promise<void> } };
    if (scheduling.scheduler?.yield) return scheduling.scheduler.yield();
    const { promise, resolve } = (Promise as PromiseConstructor & {
        withResolvers<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void };
    }).withResolvers<void>();
    setTimeout(resolve, 0);
    return promise;
}

function createYieldController(): () => Promise<void> | undefined {
    let work = 0, deadline = performance.now() + 6;
    return () => {
        if (++work % 64 || performance.now() < deadline) return;
        // Waiting for the browser does not consume the next slice's computation allowance.
        return yieldToEventLoop().then(() => { deadline = performance.now() + 6; });
    };
}


function candidatePoints(map: NavigationMap, origin: Point, destination?: Point, budget = Infinity): Point[] {
    const points: Point[] = [{ x: origin.x, y: origin.y }];
    const seen = new Set([`${origin.x}:${origin.y}`]);
    const limit = map.minimumCostPerPixel ? budget / map.minimumCostPerPixel + 2 : Infinity;
    const add = (point: Point): void => {
        const key = `${point.x}:${point.y}`;
        if (seen.has(key) || Math.hypot(point.x - origin.x, point.y - origin.y) > limit) return;
        seen.add(key); points.push(point);
    };
    for (const point of map.points) add(point);
    if (!clearSegment(map.clearance, origin, origin)) {
        const bounds = map.clearance.bounds;
        const clamped = { x: Math.max(bounds.x, Math.min(origin.x, bounds.x + bounds.width)),
            y: Math.max(bounds.y, Math.min(origin.y, bounds.y + bounds.height)) };
        if (clearSegment(map.clearance, origin, clamped)) add(clamped);
        for (const { polygon } of map.clearance.obstacles) {
            if (!pointInStrictInterior(polygon, origin)) continue;
            for (let i = 0; i < polygon.length; i++) {
                const a = polygon[i], b = polygon[(i + 1) % polygon.length];
                const dx = b.x - a.x, dy = b.y - a.y;
                const t = Math.max(0, Math.min(1, ((origin.x - a.x) * dx + (origin.y - a.y) * dy) / (dx * dx + dy * dy)));
                const point = { x: a.x + t * dx, y: a.y + t * dy };
                if (clearSegment(map.clearance, origin, point)) add(point);
            }
        }
    }
    // Keep this as a distinct final node: callers use the last node as the exact destination.
    if (destination) points.push({ x: destination.x, y: destination.y });
    return points;
}

export async function searchNavigation(
    map: NavigationMap,
    origin: Point,
    options: { budget?: number; destination?: Point; cancelled?: Cancelled } = {},
): Promise<NavigationSearch | null> {
    const cancelled = options.cancelled;
    if (cancelled?.()) return null;
    const points = candidatePoints(map, origin, options.destination, options.budget);
    const costs = points.map(() => Infinity);
    const parents = points.map(() => -1);
    const settled = points.map(() => false);
    const budget = options.budget ?? Infinity;
    const destinationIndex = options.destination ? points.length - 1 : -1;
    const lowerBound = map.minimumCostPerPixel ?? 0;
    const hasLowerBound = Number.isFinite(lowerBound) && lowerBound > 0;
    // Budget searches intentionally stay Dijkstra; only unconstrained destination searches use A*.
    const heuristic = destinationIndex >= 0 && options.budget === undefined && hasLowerBound
        ? points.map(point => lowerBound * Math.hypot(
            options.destination!.x - point.x, options.destination!.y - point.y,
        ))
        : undefined;
    const tick = createYieldController();
    costs[0] = 0;

    while (true) {
        if (cancelled?.()) return null;
        let current = -1;
        let priority = Infinity;
        for (let index = 0; index < points.length; index++) {
            if (cancelled?.()) return null;
            const pause = tick(); if (pause) await pause;
            const estimate = costs[index] + (heuristic ? heuristic[index] : 0);
            if (!settled[index] && estimate < priority) {
                current = index;
                priority = estimate;
            }
        }
        const currentCost = current < 0 ? Infinity : costs[current];
        if (current < 0 || currentCost > budget) break;
        settled[current] = true;
        if (current === destinationIndex) break;
        for (let next = 0; next < points.length; next++) {
            if (cancelled?.()) return null;
            const pause = tick(); if (pause) await pause;
            if (settled[next]) continue;
            const from = points[current], to = points[next];
            if (hasLowerBound) {
                // Edge cost never falls below the proven per-pixel bound, so a probe that
                // cannot improve the incumbent, or fit the remaining budget, is rejected
                // before clearance and the (often native) cost evaluation.
                const best = costs[next];
                const ceiling = Number.isFinite(best) ? best : budget;
                const slack = Number.isFinite(ceiling) ? EPSILON * Math.max(1, Math.abs(ceiling)) : 0;
                const optimistic = currentCost + lowerBound * Math.hypot(to.x - from.x, to.y - from.y);
                if (optimistic >= ceiling + slack) continue;
            }
            if (!clearSegment(map.clearance, from, to)) continue;
            const edge = cachedCost(map, from, to);
            if (!Number.isFinite(edge) || edge < 0) continue;
            const total = currentCost + edge;
            if (!Number.isFinite(total) || total > budget || total >= costs[next]) continue;
            costs[next] = total;
            parents[next] = current;
        }
    }
    return { points, costs, parents };
}

export function navigationPath(result: NavigationSearch, index: number): Point[] | null {
    if (index < 0 || index >= result.points.length || !Number.isFinite(result.costs[index])) return null;
    const path: Point[] = [];
    for (let current = index; current >= 0; current = result.parents[current]) path.push(result.points[current]);
    return path.reverse();
}

function normalizeAngle(angle: number): number {
    const normalized = angle % (Math.PI * 2);
    return normalized < 0 ? normalized + Math.PI * 2 : normalized;
}

function rayAngles(map: NavigationMap, origin: Point, limit: number): number[] {
    const angles: number[] = [];
    const samples = Math.max(MIN_RAY_SAMPLES, Math.min(RAY_SAMPLES, Math.ceil(Math.PI * 2 * limit / MAX_RAY_CHORD)));
    const step = Math.PI * 2 / samples;
    for (let index = 0; index < samples; index++) angles.push(index * step);
    for (const vertex of [...map.clearance.vertices, ...map.points]) {
        const dx = vertex.x - origin.x, dy = vertex.y - origin.y, distance = Math.hypot(dx, dy);
        if (distance <= EPSILON || distance > limit) continue;
        if (rayClearance(map.clearance, origin, { x: dx, y: dy }, distance) < distance - EPSILON) continue;
        const bearing = Math.atan2(dy, dx);
        angles.push(normalizeAngle(bearing - RAY_ANGLE_EPSILON));
        angles.push(normalizeAngle(bearing + RAY_ANGLE_EPSILON));
    }
    angles.sort((a, b) => a - b);
    const unique: number[] = [];
    for (const angle of angles) if (!unique.length || angle - unique.at(-1)! > EPSILON) unique.push(angle);
    if (unique.length > 1 && unique[0] + Math.PI * 2 - unique.at(-1)! <= EPSILON) unique.pop();
    return unique;
}

function pointAt(origin: Point, direction: Point, distance: number): Point {
    return { x: origin.x + direction.x * distance, y: origin.y + direction.y * distance };
}

async function affordableRadius(
    map: NavigationMap,
    origin: Point,
    direction: Point,
    limit: number,
    budget: number,
    tick: () => Promise<void> | undefined,
    cancelled: Cancelled,
    standingCost: number,
): Promise<number> {
    const measure = (distance: number): number => {
        const cost = map.cost(origin, pointAt(origin, direction, distance));
        return Number.isFinite(cost) && cost >= 0 ? cost : Infinity;
    };
    let low = 0, high = limit, lowCost = standingCost, highCost = measure(limit);
    const slack = EPSILON * Math.max(1, budget);
    if (cancelled?.()) return 0;
    if (highCost <= budget + slack) return high;
    for (let step = 0; step < RAY_SEARCH_STEPS; step++) {
        if (cancelled?.()) return 0;
        const pause = tick(); if (pause) await pause;
        // Terrain is piecewise linear along a ray: interpolation solves uniform ground in one step.
        let middle = low + (high - low) * (budget - lowCost) / (highCost - lowCost);
        if (!Number.isFinite(middle) || middle <= low + EPSILON || middle >= high - EPSILON) middle = (low + high) / 2;
        const cost = measure(middle);
        if (cost <= budget + slack) {
            low = middle; lowCost = cost;
            if (budget > 0 && Math.abs(budget - cost) <= slack) return low;
        } else { high = middle; highCost = cost; }
    }
    return low;
}

function safeTriangle(space: Clearance, origin: Point, first: Point, second: Point): boolean {
    if (!clearSegment(space, origin, first) || !clearSegment(space, origin, second)) return false;
    const triangle = [origin, first, second];
    const minX = Math.min(origin.x, first.x, second.x), maxX = Math.max(origin.x, first.x, second.x);
    const minY = Math.min(origin.y, first.y, second.y), maxY = Math.max(origin.y, first.y, second.y);
    for (const obstacle of space.obstacles) {
        const { bounds } = obstacle;
        if (maxX < bounds.x || minX > bounds.x + bounds.width
            || maxY < bounds.y || minY > bounds.y + bounds.height) continue;
        if ((obstacle.wall.blocksFrom?.(origin) ?? true)
            && (obstacle.polygon.some(point => pointInStrictInterior(triangle, point))
                || triangle.some((point, index) => segmentEntersInterior(obstacle.polygon, point, triangle[(index + 1) % 3])))) return false;
    }
    return true;
}

export async function reachablePolygons(
    map: NavigationMap,
    result: NavigationSearch,
    budget: number,
    cancelled?: Cancelled,
): Promise<number[][] | null> {
    if (cancelled?.()) return null;
    const tick = createYieldController();
    const polygons: number[][] = [];
    const maxRayDistance = Math.hypot(map.clearance.bounds.width, map.clearance.bounds.height);
    if (!(maxRayDistance > 0) || budget < 0) return polygons;

    for (let sourceIndex = 0; sourceIndex < result.points.length; sourceIndex++) {
        if (cancelled?.()) return null;
        const pause = tick(); if (pause) await pause;
        const source = result.points[sourceIndex];
        const sourceCost = result.costs[sourceIndex];
        if (!Number.isFinite(sourceCost) || sourceCost > budget) continue;
        const remaining = budget - sourceCost;
        // The zero-length cost is ray-independent, so it is measured once per source:
        // an unrecoverable source could only emit null ray endpoints anyway.
        const standing = cachedCost(map, source, source);
        const standingCost = Number.isFinite(standing) && standing >= 0 ? standing : Infinity;
        if (standingCost > remaining + EPSILON * Math.max(1, remaining)) continue;
        const rayLimit = map.minimumCostPerPixel ? Math.min(maxRayDistance, remaining / map.minimumCostPerPixel + 2) : maxRayDistance;
        const endpoints: Array<Point | null> = [];
        for (const angle of rayAngles(map, source, rayLimit)) {
            if (cancelled?.()) return null;
            const pause = tick(); if (pause) await pause;
            const direction = { x: Math.cos(angle), y: Math.sin(angle) };
            const limit = rayClearance(map.clearance, source, direction, rayLimit);
            if (!Number.isFinite(limit) || limit <= EPSILON) {
                endpoints.push(null);
                continue;
            }
            const distance = await affordableRadius(map, source, direction, limit, remaining, tick, cancelled, standingCost);
            endpoints.push(distance > EPSILON ? pointAt(source, direction, distance) : null);
        }
        let fan: number[] | undefined;
        for (let index = 0; index < endpoints.length; index++) {
            if (cancelled?.()) return null;
            const pause = tick(); if (pause) await pause;
            const first = endpoints[index], second = endpoints[(index + 1) % endpoints.length];
            if (first && second && safeTriangle(map.clearance, source, first, second)) {
                fan ??= [source.x, source.y, first.x, first.y];
                fan.push(second.x, second.y);
            } else if (fan) {
                polygons.push(fan); fan = undefined;
            }
        }
        if (fan) polygons.push(fan);
    }
    return polygons;
}
