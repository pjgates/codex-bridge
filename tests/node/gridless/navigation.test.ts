import { describe, expect, it } from "vitest";
import { buildClearance, clearSegment, segmentEntersInterior } from "../../../src/rulesets/sf2e/gridless/clearance.js";
import { navigationPath, reachablePolygons, searchNavigation, type NavigationMap } from "../../../src/rulesets/sf2e/gridless/navigation.js";
import type { Point } from "../../../src/rulesets/sf2e/gridless/geometry.js";

const bounds = { x: 0, y: 0, width: 1000, height: 1000 };
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const contains = (polygon: number[], point: Point) => {
    let inside = false;
    for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
        const ax = polygon[j], ay = polygon[j + 1], bx = polygon[i], by = polygon[i + 1];
        if ((ay > point.y) !== (by > point.y) && point.x < (bx - ax) * (point.y - ay) / (by - ay) + ax) inside = !inside;
    }
    return inside;
};

describe("continuous weighted navigation", () => {
    it("routes a whole footprint around a wall without snapping either endpoint", async () => {
        const clearance = buildClearance([{ a: { x: 500, y: 300 }, b: { x: 500, y: 700 } }], bounds, 100, 100);
        const map: NavigationMap = {
            clearance,
            points: clearance.vertices, cost: distance,
        };
        const from = { x: 300.25, y: 500 }, destination = { x: 700.75, y: 500 };
        const result = (await searchNavigation(map, from, { destination }))!;
        const path = navigationPath(result, result.points.length - 1)!;
        expect(path[0]).toEqual(from);
        expect(path.at(-1)).toEqual(destination);
        expect(path.some(point => point.y < 250 || point.y > 750)).toBe(true);
        expect(path.slice(1).every((point, i) => clearSegment(map.clearance, path[i], point))).toBe(true);
        expect(result.costs.at(-1)).toBeGreaterThan(400);
    });

    it("chooses a longer geometric route when difficult terrain makes it cheaper", async () => {
        // A slow horizontal strip spans y=400..600. Its endpoints and crossing costs are hand-derived.
        const terrainCost = (a: Point, b: Point) => {
            const dy = b.y - a.y;
            const fraction = dy === 0 ? (a.y > 400 && a.y < 600 ? 1 : 0)
                : Math.max(0, Math.min(1, Math.max((400 - a.y) / dy, (600 - a.y) / dy))
                    - Math.max(0, Math.min((400 - a.y) / dy, (600 - a.y) / dy)));
            return distance(a, b) * (1 + 2 * fraction);
        };
        const map: NavigationMap = { clearance: buildClearance([], bounds, 0, 0, 0),
            points: [{ x: 300, y: 390 }, { x: 700, y: 390 }], cost: terrainCost, minimumCostPerPixel: 1 };
        const from = { x: 300, y: 500 }, destination = { x: 700, y: 500 };
        const result = (await searchNavigation(map, from, { destination }))!;
        const path = navigationPath(result, result.points.length - 1)!;
        expect(path).toEqual([from, { x: 300, y: 390 }, { x: 700, y: 390 }, destination]);
        expect(result.costs.at(-1)).toBeCloseTo(1020);
    });
    it("uses the proven lower bound for destination ordering and probe pruning", async () => {
        const clearance = buildClearance([], bounds, 0, 0, 0);
        const points = Array.from({ length: 64 }, (_, index) => ({ x: 40, y: 501 + index }));
        const from = { x: 0, y: 500 }, destination = { x: 100, y: 500 };
        let aStarCalls = 0;
        const aStarMap: NavigationMap = {
            clearance, points, minimumCostPerPixel: 1,
            cost: (a, b) => { aStarCalls++; return distance(a, b); },
        };
        const aStar = (await searchNavigation(aStarMap, from, { destination }))!;
        expect(navigationPath(aStar, aStar.points.length - 1)).toEqual([from, destination]);
        expect(aStar.costs.at(-1)).toBe(100);

        let dijkstraCalls = 0;
        const dijkstra = (await searchNavigation({
            clearance, points, cost: (a, b) => { dijkstraCalls++; return distance(a, b); },
        }, from, { destination }))!;
        expect(navigationPath(dijkstra, dijkstra.points.length - 1)).toEqual([from, destination]);
        expect(dijkstra.costs.at(-1)).toBe(100);
        // Without the bound the search re-probes pairs the bound proves useless.
        expect(dijkstraCalls).toBeGreaterThan(aStarCalls * 4);

        // Budget searches stay heuristic-free; the bound still keeps their probes near A*.
        let budgetCalls = 0;
        const budget = (await searchNavigation({
            ...aStarMap, cost: (a, b) => { budgetCalls++; return distance(a, b); },
        }, from, { budget: 100, destination }))!;
        expect(navigationPath(budget, budget.points.length - 1)).toEqual([from, destination]);
        expect(budget.costs.at(-1)).toBe(100);
        expect(budgetCalls).toBeLessThan(aStarCalls * 2);
    });

    it("does not return a route across a sealed wall or beyond the budget", async () => {
        const clearance = buildClearance([{ a: { x: 500, y: 0 }, b: { x: 500, y: 1000 } }], bounds, 100, 100);
        const map: NavigationMap = { clearance, points: clearance.vertices, cost: distance };
        const result = (await searchNavigation(map, { x: 300, y: 500 }, { destination: { x: 700, y: 500 } }))!;
        expect(navigationPath(result, result.points.length - 1)).toBeNull();
        const limited = (await searchNavigation({ ...map, clearance: buildClearance([], bounds, 0, 0, 0) },
            { x: 300, y: 500 }, { budget: 100, destination: { x: 700, y: 500 } }))!;
        expect(navigationPath(limited, limited.points.length - 1)).toBeNull();
    });

    it("shows reachable ground around a wall without filling through the blocking footprint", async () => {
        const clearance = buildClearance([{ a: { x: 500, y: 300 }, b: { x: 500, y: 700 } }], bounds, 100, 100);
        const map: NavigationMap = { clearance, points: clearance.vertices, cost: distance };
        const result = (await searchNavigation(map, { x: 300, y: 500 }, { budget: 1000 }))!;
        const polygons = (await reachablePolygons(map, result, 1000))!;
        expect(polygons.some(polygon => contains(polygon, { x: 700, y: 500 }))).toBe(true);
        expect(polygons.some(polygon => contains(polygon, { x: 500, y: 500 }))).toBe(false);
    });

    it("does not draw reachable ground through an impassable terrain silhouette between sampled rays", async () => {
        const terrain = [{ x: 450, y: 300 }, { x: 800, y: 300 }, { x: 800, y: 499.5 }, { x: 450, y: 499.5 }];
        const map: NavigationMap = { clearance: buildClearance([], bounds, 0, 0, 0), points: terrain,
            cost: (a, b) => segmentEntersInterior(terrain, a, b) ? Infinity : distance(a, b) };
        const result = (await searchNavigation(map, { x: 300, y: 500 }, { budget: 300 }))!;
        const polygons = (await reachablePolygons(map, result, 300))!;
        expect(polygons.some(polygon => contains(polygon, { x: 451, y: 490 }))).toBe(false);
        expect(polygons.some(polygon => contains(polygon, { x: 550, y: 520 }))).toBe(true);
    });

    it("cancels obsolete searches and area generation", async () => {
        const map: NavigationMap = { clearance: buildClearance([], bounds, 0, 0, 0), points: [], cost: distance };
        expect(await searchNavigation(map, { x: 200, y: 200 }, { cancelled: () => true })).toBeNull();
        const result = (await searchNavigation(map, { x: 200, y: 200 }))!;
        expect(await reachablePolygons(map, result, 100, () => true)).toBeNull();
    });
});
