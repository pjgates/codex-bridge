import { describe, expect, it } from "vitest";
import { buildClearance, clearSegment, pointInStrictInterior, rayClearance, type NavigationWall } from "../../../src/rulesets/sf2e/gridless/clearance.js";

const bounds = { x: 0, y: 0, width: 1000, height: 1000 };

describe("whole-token wall clearance", () => {
    it("blocks a footprint crossing even when its centre misses the wall", () => {
        const space = buildClearance([{ a: { x: 500, y: 300 }, b: { x: 500, y: 700 } }], bounds, 100, 100, 0);
        expect(clearSegment(space, { x: 300, y: 260 }, { x: 700, y: 260 })).toBe(false);
        expect(clearSegment(space, { x: 300, y: 240 }, { x: 700, y: 240 })).toBe(true);
        expect(rayClearance(space, { x: 300, y: 500 }, { x: 1, y: 0 }, 500)).toBeCloseTo(150);
        expect(rayClearance(space, { x: 300, y: 250 }, { x: 1, y: 0 }, 500)).toBe(500);
    });

    it("rejects a gap narrower than the token but permits a fitting gap", () => {
        const walls = (gap: number) => [
            { a: { x: 500, y: 0 }, b: { x: 500, y: 500 - gap / 2 } },
            { a: { x: 500, y: 500 + gap / 2 }, b: { x: 500, y: 1000 } },
        ];
        const from = { x: 300, y: 500 }, to = { x: 700, y: 500 };
        expect(clearSegment(buildClearance(walls(80), bounds, 100, 100, 0), from, to)).toBe(false);
        expect(clearSegment(buildClearance(walls(120), bounds, 100, 100, 0), from, to)).toBe(true);
    });

    it("detects short walls contained inside the swept footprint and the scene boundary", () => {
        const space = buildClearance([{ a: { x: 480, y: 490 }, b: { x: 520, y: 490 } }], bounds, 100, 100, 0);
        expect(clearSegment(space, { x: 300, y: 500 }, { x: 700, y: 500 })).toBe(false);
        expect(clearSegment(space, { x: 100, y: 100 }, { x: 20, y: 100 })).toBe(false);
    });

    it("retains directional passage instead of turning a one-way wall into a solid wall", () => {
        const space = buildClearance([{ a: { x: 500, y: 0 }, b: { x: 500, y: 1000 },
            blocksFrom: (origin) => origin.x < 500 }], bounds, 100, 100, 0);
        expect(clearSegment(space, { x: 300, y: 500 }, { x: 700, y: 500 })).toBe(false);
        expect(clearSegment(space, { x: 700, y: 500 }, { x: 300, y: 500 })).toBe(true);
    });

    it("lets an overlapping token escape without deepening overlap or crossing another wall", () => {
        const walls = [{ a: { x: 500, y: 0 }, b: { x: 500, y: 1000 } }];
        const space = buildClearance(walls, bounds, 200, 200, 0);
        const origin = { x: 420, y: 500 };
        expect(clearSegment(space, origin, { x: 200, y: 500 })).toBe(true);
        expect(clearSegment(space, origin, { x: 700, y: 500 })).toBe(false);
        const another = buildClearance([...walls, { a: { x: 250, y: 0 }, b: { x: 250, y: 1000 } }], bounds, 200, 200, 0);
        expect(clearSegment(another, origin, { x: 100, y: 500 })).toBe(false);
        expect(clearSegment(buildClearance([], bounds, 200, 200, 0), { x: 50, y: 500 }, { x: 200, y: 500 })).toBe(true);
    });
    it("skips directional wall checks outside the segment bounds", () => {
        let checks = 0;
        const walls = [
            ...Array.from({ length: 8 }, (_, index) => ({
                a: { x: 700 + index * 20, y: 0 }, b: { x: 700 + index * 20, y: 100 },
                blocksFrom: () => { checks++; return true; },
            })),
            {
                a: { x: 500, y: 400 }, b: { x: 500, y: 600 },
                blocksFrom: () => { checks++; return true; },
            },
        ];
        const space = buildClearance(walls, bounds, 10, 10, 0);
        expect(clearSegment(space, { x: 100, y: 900 }, { x: 200, y: 900 })).toBe(true);
        expect(checks).toBe(0);
        expect(clearSegment(space, { x: 100, y: 500 }, { x: 900, y: 500 })).toBe(false);
        expect(checks).toBe(1);
    });
});

describe("dense wall scenes", () => {
    type Point = { x: number; y: number };
    const EPSILON = 1e-9;
    const cross = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;
    const onSegment = (p: Point, a: Point, b: Point): boolean => {
        const tolerance = EPSILON * Math.max(1, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        if (Math.abs(cross(b.x - a.x, b.y - a.y, p.x - a.x, p.y - a.y)) > tolerance) return false;
        return p.x >= Math.min(a.x, b.x) - tolerance && p.x <= Math.max(a.x, b.x) + tolerance
            && p.y >= Math.min(a.y, b.y) - tolerance && p.y <= Math.max(a.y, b.y) + tolerance;
    };

    /** Every pairwise polygon boundary intersection, with no spatial pruning: the specification. */
    function bruteForceVertices(space: ReturnType<typeof buildClearance>): Point[] {
        const { obstacles, bounds: inset } = space;
        const vertices: Point[] = [];
        const add = (point: Point): void => {
            if (point.x < inset.x || point.x > inset.x + inset.width || point.y < inset.y || point.y > inset.y + inset.height) return;
            if (obstacles.some(o => !o.wall.blocksFrom && pointInStrictInterior(o.polygon, point))) return;
            if (vertices.some(v => v.x === point.x && v.y === point.y)) return;
            vertices.push(point);
        };
        for (const obstacle of obstacles) for (const point of obstacle.polygon) add(point);
        for (let i = 0; i < obstacles.length; i++) for (let j = i + 1; j < obstacles.length; j++) {
            const first = obstacles[i].polygon, second = obstacles[j].polygon;
            for (let p = 0; p < first.length; p++) {
                const a = first[p], b = first[(p + 1) % first.length], rx = b.x - a.x, ry = b.y - a.y;
                for (let q = 0; q < second.length; q++) {
                    const c = second[q], d = second[(q + 1) % second.length], sx = d.x - c.x, sy = d.y - c.y;
                    const denominator = cross(rx, ry, sx, sy), qx = c.x - a.x, qy = c.y - a.y;
                    const scale = EPSILON * Math.max(1, Math.abs(rx), Math.abs(ry), Math.abs(sx), Math.abs(sy));
                    if (Math.abs(denominator) <= scale) {
                        if (Math.abs(cross(qx, qy, rx, ry)) <= scale) {
                            for (const point of [a, b, c, d]) if (onSegment(point, a, b) && onSegment(point, c, d)) add(point);
                        }
                        continue;
                    }
                    const t = cross(qx, qy, sx, sy) / denominator, u = cross(qx, qy, rx, ry) / denominator;
                    if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) continue;
                    add({ x: a.x + t * rx, y: a.y + t * ry });
                }
            }
        }
        return vertices;
    }

    /** Deterministic cave-like scene: short chained segments wandering across a large map. */
    function denseWalls(count: number, seed = 7): { a: Point; b: Point; blocksFrom?: (origin: Point) => boolean }[] {
        let state = seed;
        const random = (): number => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state / 0x7fffffff; };
        const walls: NavigationWall[] = [];
        let x = 1000, y = 1000;
        for (let i = 0; i < count; i++) {
            if (i % 40 === 0) { x = 200 + random() * 3000; y = 200 + random() * 3000; }
            const nx = Math.round(x + (random() - 0.5) * 80), ny = Math.round(y + (random() - 0.5) * 80);
            const wall: (typeof walls)[number] = { a: { x, y }, b: { x: nx, y: ny } };
            if (i % 97 === 0) wall.blocksFrom = () => true;
            walls.push(wall);
            x = nx; y = ny;
        }
        return walls;
    }

    const sceneBounds = { x: 0, y: 0, width: 3600, height: 3800 };

    it("finds exactly the brute-force vertex set, in the same order", () => {
        const space = buildClearance(denseWalls(300), sceneBounds, 100, 100, 0);
        expect(space.vertices.length).toBeGreaterThan(200);
        expect(space.vertices).toEqual(bruteForceVertices(space));
    });

    it("builds thousands of walls without quadratic pair checks", () => {
        const walls = denseWalls(4000);
        const started = performance.now();
        const space = buildClearance(walls, sceneBounds, 100, 100, 0);
        const elapsed = performance.now() - started;
        expect(space.obstacles).toHaveLength(4000);
        // The 4,244-wall scene took 11.6s at O(n²); a bounds-pruned build stays far below one second.
        expect(elapsed).toBeLessThan(1500);
    });
});

describe("lazy outline vertices", () => {
    it("defers the vertex phase until the continuous search asks for it", () => {
        const walls: NavigationWall[] = [];
        for (let i = 0; i < 4000; i++) walls.push({ a: { x: 100 + (i % 60) * 55, y: 100 + Math.floor(i / 60) * 55 }, b: { x: 130 + (i % 60) * 55, y: 140 + Math.floor(i / 60) * 55 } });
        const started = performance.now();
        const space = buildClearance(walls, { x: 0, y: 0, width: 4000, height: 4000 }, 100, 100, 0);
        expect(space.obstacles).toHaveLength(4000);
        expect(clearSegment(space, { x: 50, y: 50 }, { x: 60, y: 50 })).toBe(true);
        expect(performance.now() - started).toBeLessThan(150);
        const first = space.vertices;
        expect(first.length).toBeGreaterThan(0);
        expect(space.vertices).toBe(first);
    });
});
