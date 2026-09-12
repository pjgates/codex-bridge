import type { Bounds, Point } from "./geometry.js";

export interface NavigationWall {
    a: Point;
    b: Point;
    blocksFrom?: (origin: Point) => boolean;
}

export interface Clearance {
    bounds: Bounds;
    obstacles: { polygon: Point[]; wall: NavigationWall; bounds: Bounds }[];
    vertices: Point[];
}

const EPSILON = 1e-9;

type Obstacle = { polygon: Point[]; wall: NavigationWall; bounds: Bounds };

function cross(ax: number, ay: number, bx: number, by: number): number {
    return ax * by - ay * bx;
}

function edgeCross(a: Point, b: Point, point: Point): number {
    return cross(b.x - a.x, b.y - a.y, point.x - a.x, point.y - a.y);
}

function pointEqual(a: Point, b: Point): boolean {
    return a.x === b.x && a.y === b.y;
}

function convexHull(points: readonly Point[]): Point[] {
    const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    const unique: Point[] = [];
    for (const point of sorted) if (unique.length === 0 || !pointEqual(point, unique[unique.length - 1])) unique.push(point);
    if (unique.length < 3) return unique;

    const lower: Point[] = [];
    for (const point of unique) {
        while (lower.length >= 2 && edgeCross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
        lower.push(point);
    }
    const upper: Point[] = [];
    for (let i = unique.length - 1; i >= 0; i -= 1) {
        const point = unique[i];
        while (upper.length >= 2 && edgeCross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
        upper.push(point);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
}

function signedArea(polygon: readonly Point[]): number {
    let area = 0;
    for (let i = 0; i < polygon.length; i += 1) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length];
        area += a.x * b.y - a.y * b.x;
    }
    return area / 2;
}

function interiorTolerance(c0: number, c1: number): number {
    return EPSILON * Math.max(1, Math.abs(c0), Math.abs(c1));
}
function polygonBounds(polygon: readonly Point[]): Bounds {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of polygon) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function segmentIntersectsBounds(bounds: Bounds, from: Point, to: Point): boolean {
    const minX = Math.min(from.x, to.x), maxX = Math.max(from.x, to.x);
    const minY = Math.min(from.y, to.y), maxY = Math.max(from.y, to.y);
    return maxX >= bounds.x && minX <= bounds.x + bounds.width
        && maxY >= bounds.y && minY <= bounds.y + bounds.height;
}

function rayIntersectsBounds(
    bounds: Bounds,
    origin: Point,
    directionX: number,
    directionY: number,
    limit: number,
): boolean {
    const endX = origin.x + directionX * limit, endY = origin.y + directionY * limit;
    const minX = Math.min(origin.x, endX), maxX = Math.max(origin.x, endX);
    const minY = Math.min(origin.y, endY), maxY = Math.max(origin.y, endY);
    return maxX >= bounds.x && minX <= bounds.x + bounds.width
        && maxY >= bounds.y && minY <= bounds.y + bounds.height;
}

export function pointInStrictInterior(polygon: readonly Point[], point: Point): boolean {
    if (polygon.length < 3) return false;
    const orientation = signedArea(polygon) >= 0 ? 1 : -1;
    for (let i = 0; i < polygon.length; i += 1) {
        const c0 = orientation * edgeCross(polygon[i], polygon[(i + 1) % polygon.length], point);
        if (!(c0 > interiorTolerance(c0, c0))) return false;
    }
    return true;
}

/** Does a finite segment enter a convex polygon? Optionally capture its parameter interval. */
export function segmentEntersInterior(polygon: readonly Point[], from: Point, to: Point, interval?: [number, number]): boolean {
    if (polygon.length < 3) return false;

    const orientation = signedArea(polygon) >= 0 ? 1 : -1;
    let low = 0;
    let high = 1;
    for (let i = 0; i < polygon.length; i += 1) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length];
        const c0 = orientation * edgeCross(a, b, from);
        const c1 = orientation * edgeCross(a, b, to);
        const tolerance = interiorTolerance(c0, c1);
        if (c0 <= tolerance && c1 <= tolerance) return false;
        const delta = c1 - c0;
        if (delta > 0 && c0 <= tolerance) low = Math.max(low, -c0 / delta);
        else if (delta < 0 && c1 <= tolerance) high = Math.min(high, -c0 / delta);
        if (low >= high) return false;
    }
    if (high - low <= EPSILON) return false;
    if (interval) { interval[0] = low; interval[1] = high; }
    return true;
}

/** Fraction spent overlapping walls; overlapping footprints charge once, not once per wall. */
export function obstructedFraction(space: Clearance, from: Point, to: Point): number {
    const intervals: [number, number][] = [];
    let interval: [number, number] = [0, 0];
    for (const obstacle of space.obstacles) {
        if (!segmentIntersectsBounds(obstacle.bounds, from, to)) continue;
        if (obstacle.wall.blocksFrom?.(from) === false) continue;
        if (segmentEntersInterior(obstacle.polygon, from, to, interval)) {
            intervals.push(interval);
            interval = [0, 0];
        }
    }
    intervals.sort((a, b) => a[0] - b[0]);
    let end = 0, fraction = 0;
    for (const [low, high] of intervals) {
        fraction += Math.max(0, high - Math.max(low, end));
        end = Math.max(end, high);
    }
    return fraction;
}
function pointOnSegment(point: Point, a: Point, b: Point): boolean {
    const crossValue = edgeCross(a, b, point);
    const tolerance = EPSILON * Math.max(1, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    if (Math.abs(crossValue) > tolerance) return false;
    return point.x >= Math.min(a.x, b.x) - tolerance && point.x <= Math.max(a.x, b.x) + tolerance
        && point.y >= Math.min(a.y, b.y) - tolerance && point.y <= Math.max(a.y, b.y) + tolerance;
}

function addVertex(vertices: Point[], point: Point, bounds: Bounds, obstacles: readonly Obstacle[]): void {
    if (point.x < bounds.x || point.x > bounds.x + bounds.width || point.y < bounds.y || point.y > bounds.y + bounds.height) return;
    for (const obstacle of obstacles) {
        if (!obstacle.wall.blocksFrom && pointInStrictInterior(obstacle.polygon, point)) return;
    }
    for (const existing of vertices) if (pointEqual(existing, point)) return;
    vertices.push(point);
}

function addBoundaryIntersections(
    first: readonly Point[],
    second: readonly Point[],
    bounds: Bounds,
    obstacles: readonly Obstacle[],
    vertices: Point[],
): void {
    for (let i = 0; i < first.length; i += 1) {
        const a = first[i], b = first[(i + 1) % first.length];
        const rx = b.x - a.x, ry = b.y - a.y;
        for (let j = 0; j < second.length; j += 1) {
            const c = second[j], d = second[(j + 1) % second.length];
            const sx = d.x - c.x, sy = d.y - c.y;
            const denominator = cross(rx, ry, sx, sy);
            const qx = c.x - a.x, qy = c.y - a.y;
            const scale = EPSILON * Math.max(1, Math.abs(rx), Math.abs(ry), Math.abs(sx), Math.abs(sy));
            if (Math.abs(denominator) <= scale) {
                if (Math.abs(cross(qx, qy, rx, ry)) <= scale) {
                    for (const point of [a, b, c, d]) {
                        if (pointOnSegment(point, a, b) && pointOnSegment(point, c, d)) addVertex(vertices, point, bounds, obstacles);
                    }
                }
                continue;
            }
            const t = cross(qx, qy, sx, sy) / denominator;
            const u = cross(qx, qy, rx, ry) / denominator;
            if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) continue;
            addVertex(vertices, { x: a.x + t * rx, y: a.y + t * ry }, bounds, obstacles);
        }
    }
}

export function buildClearance(
    walls: readonly NavigationWall[],
    bounds: Bounds,
    width: number,
    height: number,
    padding = 1,
): Clearance {
    const halfWidth = Math.max(0, width / 2 + padding);
    const halfHeight = Math.max(0, height / 2 + padding);
    const insetBounds: Bounds = {
        ...bounds,
        x: bounds.x + halfWidth,
        y: bounds.y + halfHeight,
        width: bounds.width - 2 * halfWidth,
        height: bounds.height - 2 * halfHeight,
    };
    const obstacles: Obstacle[] = [];
    for (const wall of walls) {
        const { a, b } = wall;
        const polygon = convexHull([
            { x: a.x - halfWidth, y: a.y - halfHeight },
            { x: a.x - halfWidth, y: a.y + halfHeight },
            { x: a.x + halfWidth, y: a.y - halfHeight },
            { x: a.x + halfWidth, y: a.y + halfHeight },
            { x: b.x - halfWidth, y: b.y - halfHeight },
            { x: b.x - halfWidth, y: b.y + halfHeight },
            { x: b.x + halfWidth, y: b.y - halfHeight },
            { x: b.x + halfWidth, y: b.y + halfHeight },
        ]);
        obstacles.push({ polygon, wall, bounds: polygonBounds(polygon) });
    }

    const vertices: Point[] = [];
    for (const obstacle of obstacles) for (const point of obstacle.polygon) addVertex(vertices, point, insetBounds, obstacles);
    for (let i = 0; i < obstacles.length; i += 1) {
        for (let j = i + 1; j < obstacles.length; j += 1) {
            addBoundaryIntersections(obstacles[i].polygon, obstacles[j].polygon, insetBounds, obstacles, vertices);
        }
    }
    return { bounds: insetBounds, obstacles, vertices };
}

function withinBounds(bounds: Bounds, point: Point): boolean {
    const tolerance = EPSILON * Math.max(1, Math.abs(point.x), Math.abs(point.y));
    return point.x >= bounds.x - tolerance && point.x <= bounds.x + bounds.width + tolerance
        && point.y >= bounds.y - tolerance && point.y <= bounds.y + bounds.height + tolerance;
}

/** Recover an already-overlapping footprint without increasing penetration or crossing other walls. */
function escapesInterior(polygon: readonly Point[], from: Point, to: Point): boolean {
    if (!pointInStrictInterior(polygon, from) || pointInStrictInterior(polygon, to)) return false;
    const orientation = signedArea(polygon) >= 0 ? 1 : -1;
    let nearest = Infinity;
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length];
        nearest = Math.min(nearest, orientation * edgeCross(a, b, from) / Math.hypot(b.x - a.x, b.y - a.y));
    }
    return polygon.some((a, i) => {
        const b = polygon[(i + 1) % polygon.length], length = Math.hypot(b.x - a.x, b.y - a.y);
        const start = orientation * edgeCross(a, b, from) / length;
        const end = orientation * edgeCross(a, b, to) / length;
        return start <= nearest + EPSILON && end <= start + EPSILON;
    });
}

export function clearSegment(space: Clearance, from: Point, to: Point): boolean {
    if (!withinBounds(space.bounds, to)) return false;
    for (const obstacle of space.obstacles) {
        if (!segmentIntersectsBounds(obstacle.bounds, from, to)) continue;
        if (obstacle.wall.blocksFrom?.(from) === false) continue;
        if (segmentEntersInterior(obstacle.polygon, from, to) && !escapesInterior(obstacle.polygon, from, to)) return false;
    }
    return true;
}

function rayObstacleDistance(
    polygon: readonly Point[],
    origin: Point,
    directionX: number,
    directionY: number,
    limit: number,
): number {
    if (polygon.length < 3) return Infinity;
    const orientation = signedArea(polygon) >= 0 ? 1 : -1;
    let low = 0;
    let high = limit;
    for (let i = 0; i < polygon.length; i += 1) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length];
        const c0 = orientation * edgeCross(a, b, origin);
        const delta = orientation * cross(b.x - a.x, b.y - a.y, directionX, directionY);
        const cLimit = c0 + delta * limit;
        const tolerance = interiorTolerance(c0, cLimit);
        if (Math.abs(delta) <= tolerance) {
            if (c0 <= tolerance) return Infinity;
        } else if (delta > 0) {
            low = Math.max(low, -c0 / delta);
        } else {
            high = Math.min(high, -c0 / delta);
        }
        if (low > high + EPSILON) return Infinity;
    }
    return high - low > EPSILON ? Math.max(0, low) : Infinity;
}

export function rayClearance(space: Clearance, origin: Point, direction: Point, limit: number): number {
    if (!withinBounds(space.bounds, origin) || !(limit > 0)) return 0;
    const length = Math.hypot(direction.x, direction.y);
    if (!(length > 0) || !Number.isFinite(length)) return 0;
    const directionX = direction.x / length, directionY = direction.y / length;
    let distance = limit;
    if (directionX > 0) distance = Math.min(distance, (space.bounds.x + space.bounds.width - origin.x) / directionX);
    else if (directionX < 0) distance = Math.min(distance, (space.bounds.x - origin.x) / directionX);
    if (directionY > 0) distance = Math.min(distance, (space.bounds.y + space.bounds.height - origin.y) / directionY);
    else if (directionY < 0) distance = Math.min(distance, (space.bounds.y - origin.y) / directionY);
    distance = Math.max(0, distance);
    for (const obstacle of space.obstacles) {
        if (!rayIntersectsBounds(obstacle.bounds, origin, directionX, directionY, distance)) continue;
        if (obstacle.wall.blocksFrom?.(origin) === false) continue;
        distance = Math.min(distance, rayObstacleDistance(obstacle.polygon, origin, directionX, directionY, distance));
    }
    return distance;
}
