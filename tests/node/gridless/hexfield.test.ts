import { describe, expect, it } from "vitest";
import { buildClearance, clearSegment, segmentEntersInterior, type NavigationWall } from "../../../src/rulesets/sf2e/gridless/clearance.js";
import { hexAt, hexCentre, hexDistance, hexNeighbour, type Hex } from "../../../src/rulesets/sf2e/gridless/hex.js";
import {
    buildHexField, floodReachable, hexContours, hexFieldBlocked, hexFieldCellCount, hexFieldCost, hexFieldHex,
    hexPull, hexFieldReached, hexRoute, pointInRegionPolygon, hexFieldIndex, blockedFrontier, type HexField,
} from "../../../src/rulesets/sf2e/gridless/hexfield.js";

const bounds = { x: 0, y: 0, width: 1000, height: 1000 };
const SIZE = 10;
/** Hundredths of a movement unit per 6-inch step (half a foot at a 5-foot square). */
const STEP = 50;
const FULL = { width: 100, height: 100 };
const CELL_AREA = Math.sqrt(3) / 2 * SIZE * SIZE;

function field(walls: NavigationWall[] = [], options: Partial<Parameters<typeof buildHexField>[0]> = {}): HexField {
    return buildHexField({ walls, bounds, size: SIZE, step: STEP, full: FULL, cramped: FULL, ...options });
}

function eachCell(target: HexField, visit: (hex: Hex) => void): void {
    for (let index = 0; index < hexFieldCellCount(target); index++) visit(hexFieldHex(target, index));
}

const gapWalls = (gap: number): NavigationWall[] => [
    { a: { x: 500, y: 0 }, b: { x: 500, y: 500 - gap / 2 } },
    { a: { x: 500, y: 500 + gap / 2 }, b: { x: 500, y: 1000 } },
];

/** First passable cell west of the wall's gap, at y ≈ 500. */
function gapCell(target: HexField): Hex {
    let best: Hex | undefined;
    eachCell(target, hex => {
        const point = hexCentre(hex, SIZE);
        if (point.x < 470 || point.x > 497 || Math.abs(point.y - 500) > SIZE) return;
        if (hexFieldBlocked(target, hex)) return;
        if (!best || Math.abs(point.y - 500) < Math.abs(hexCentre(best, SIZE).y - 500)) best = hex;
    });
    if (!best) throw new Error("no gap cell found");
    return best;
}

describe("hex field rasterisation", () => {
    it("blocks exactly the cells whose centre fails tolerant whole-token clearance", () => {
        const walls = [{ a: { x: 500, y: 300 }, b: { x: 500, y: 700 } }];
        const clearance = buildClearance(walls, bounds, FULL.width, FULL.height, -SIZE / 2);
        const target = field(walls);
        let blocked = 0, checked = 0;
        eachCell(target, hex => {
            const point = hexCentre(hex, SIZE);
            checked++;
            const solid = !clearSegment(clearance, point, point);
            expect(hexFieldBlocked(target, hex)).toBe(solid);
            if (solid) blocked++;
        });
        expect(checked).toBeGreaterThan(9000);
        expect(blocked).toBeGreaterThan(100);
    });

    it("blocks a strict subset of the untolerated footprint's cells", () => {
        const walls = [{ a: { x: 500, y: 300 }, b: { x: 500, y: 700 } }];
        const strict = buildClearance(walls, bounds, FULL.width, FULL.height, 0);
        const target = field(walls);
        let opened = 0;
        eachCell(target, hex => {
            const point = hexCentre(hex, SIZE);
            const strictBlocked = !clearSegment(strict, point, point);
            if (hexFieldBlocked(target, hex)) {
                expect(strictBlocked).toBe(true);
            } else if (strictBlocked) opened++;
        });
        // The half-cell tolerance keeps exactly-fitting geometry passable.
        expect(opened).toBeGreaterThan(50);
    });

    it("keeps an exactly fitting doorway open without a surcharge", () => {
        const target = field(gapWalls(100));
        const cell = gapCell(target);
        expect(hexFieldBlocked(target, cell)).toBe(false);
        floodReachable(target, { q: cell.q - 6, r: cell.r }, 2000);
        expect(hexFieldCost(target, cell)).toBe(6 * STEP);
    });

    it("charges the passage fee where only the cramped footprint fits", () => {
        const gap = gapWalls(50);
        const target = buildHexField({ walls: gap, bounds, size: SIZE, step: STEP, full: FULL,
            cramped: { width: 50, height: 50 } });
        const cell = gapCell(target);
        expect(hexFieldBlocked(target, cell)).toBe(false);
        floodReachable(target, { q: cell.q - 6, r: cell.r }, 2000);
        // Four plain half-foot steps, then two difficult half-foot steps: four feet of cost.
        expect(hexFieldCost(target, cell)).toBe(400);
    });

    it("blocks a gap too tight for the cramped footprint", () => {
        const target = buildHexField({ walls: gapWalls(30), bounds, size: SIZE, step: STEP, full: FULL,
            cramped: { width: 50, height: 50 } });
        let passable = 0;
        eachCell(target, hex => {
            const point = hexCentre(hex, SIZE);
            if (point.x > 490 && point.x < 510 && Math.abs(point.y - 500) < 15 && !hexFieldBlocked(target, hex)) passable++;
        });
        expect(passable).toBe(0);
    });

    it("treats unknown cells as blocked for restricted previews", () => {
        const known = (point: { x: number }) => point.x < 500;
        const target = field([], { known });
        const west = { q: 16, r: 58 }, east = { q: 24, r: 58 };
        expect(hexCentre(west, SIZE).x).toBeLessThan(500);
        expect(hexCentre(east, SIZE).x).toBeGreaterThan(500);
        expect(hexFieldBlocked(target, west)).toBe(false);
        expect(hexFieldBlocked(target, east)).toBe(true);
    });
});

describe("hex flood", () => {
    it("reaches exactly the cells within the budget on uniform ground", () => {
        const target = field();
        const start = { q: 21, r: 58 };
        expect(floodReachable(target, start, 4 * STEP)).toBe(1 + 3 * 4 * 5);
        eachCell(target, hex => {
            const steps = hexDistance(start, hex);
            const point = hexCentre(hex, SIZE);
            if (point.x < 0 || point.x > 1000 || point.y < 0 || point.y > 1000) return;
            expect(hexFieldReached(target, hex)).toBe(steps <= 4);
            if (steps <= 4) expect(hexFieldCost(target, hex)).toBe(steps * STEP);
        });
    });

    it("never reports a cost beyond the budget and repeats deterministically", () => {
        const target = field();
        const start = { q: 21, r: 58 };
        floodReachable(target, start, 1400);
        const costs: number[] = [];
        eachCell(target, hex => costs.push(hexFieldCost(target, hex)));
        floodReachable(target, start, 1400);
        const again: number[] = [];
        eachCell(target, hex => again.push(hexFieldCost(target, hex)));
        expect(again).toEqual(costs);
        expect(costs.filter(cost => cost >= 0).length).toBeGreaterThan(1000);
        expect(Math.max(...costs)).toBeLessThanOrEqual(1400);
    });

    it("cannot reach past a wall the budget cannot go around and ignores a start inside one", () => {
        const target = field([{ a: { x: 500, y: 200 }, b: { x: 500, y: 800 } }]);
        const start = { q: 15, r: 58 };
        expect(hexCentre(start, SIZE).x).toBeLessThan(450);
        floodReachable(target, start, 10 * STEP);
        let beyond = 0;
        eachCell(target, hex => {
            const point = hexCentre(hex, SIZE);
            if (point.x > 560 && point.y > 300 && point.y < 700 && hexFieldReached(target, hex)) beyond++;
        });
        expect(beyond).toBe(0);

        const walled = field([{ a: { x: 470, y: 0 }, b: { x: 530, y: 1000 } }]);
        const overlapping = { q: 21, r: 58 };
        expect(hexFieldBlocked(walled, overlapping)).toBe(true);
        expect(floodReachable(walled, overlapping, 3 * STEP)).toBe(0);
        expect(hexFieldReached(walled, hexNeighbour(overlapping, 3))).toBe(false);
    });

    it("charges difficult terrain for every step inside it, not just entry", () => {
        const target = field([], {
            regions: [{ difficulty: 2, polygons: [[505, 0, 1000, 0, 1000, 1000, 505, 1000]] }],
        });
        const start = { q: 20, r: 58 };
        floodReachable(target, start, 2000);
        expect(hexFieldCost(target, hexNeighbour(start, 0))).toBe(50);
        const inside = hexNeighbour(hexNeighbour(start, 0), 0);
        expect(hexFieldCost(target, inside)).toBe(150);
        expect(hexFieldCost(target, hexNeighbour(inside, 0))).toBe(250);
    });

    it("charges nothing for standing still and triples travel through greater difficult terrain", () => {
        const target = field([], { regions: [{ difficulty: 3, polygons: [[0, 0, 1000, 0, 1000, 1000, 0, 1000]] }] });
        const start = { q: 21, r: 58 }, end = { q: 41, r: 58 };
        floodReachable(target, start, 3000);
        expect(hexFieldCost(target, start)).toBe(0);
        expect(hexFieldCost(target, end)).toBe(3000); // Ten feet travelled costs thirty feet.
        floodReachable(target, start, 2999);
        expect(hexFieldReached(target, end)).toBe(false);
        expect(hexPull(target, hexRoute(target, start, end)!)).toHaveLength(2);
    });
});

describe("hex area contours", () => {
    const area = (polygon: number[]): number => {
        let total = 0;
        for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
            total += polygon[j] * polygon[i + 1] - polygon[i] * polygon[j + 1];
        }
        return Math.abs(total / 2);
    };

    it("outlines the reached cells as one closed loop of cell corners", () => {
        const target = field();
        const reached = floodReachable(target, { q: 21, r: 58 }, 6 * STEP);
        const contours = hexContours(target);
        expect(contours).toHaveLength(1);
        expect(contours[0].length % 2).toBe(0);
        expect(contours[0].length).toBeGreaterThan(30);
        expect(area(contours[0])).toBeCloseTo(reached * CELL_AREA, 6);
    });

    it("keeps a hole around unreached ground and wraps a blocking wall", () => {
        const target = field([{ a: { x: 420, y: 480 }, b: { x: 580, y: 480 } }]);
        floodReachable(target, { q: 21, r: 62 }, 40 * STEP);
        const contours = hexContours(target);
        expect(contours.length).toBeGreaterThanOrEqual(2);
        const span = (polygon: number[], offset: number) => polygon.reduce(
            ([low, high], value, index) => index % 2 === offset ? [Math.min(low, value), Math.max(high, value)] : [low, high],
            [Infinity, -Infinity]);
        // The hole is the wall's own footprint: as long as the wall, no taller than its band.
        const hole = contours.reduce((smallest, polygon) => area(polygon) < area(smallest) ? polygon : smallest);
        const [xMin, xMax] = span(hole, 0), [yMin, yMax] = span(hole, 1);
        expect(xMax - xMin).toBeGreaterThan(100);
        expect(xMax - xMin).toBeLessThan(300);
        expect(yMin).toBeGreaterThan(400);
        expect(yMax).toBeLessThan(560);
    });
});

describe("hex routes", () => {
    it("chains neighbouring cells around blocked ground", () => {
        const target = field([{ a: { x: 500, y: 200 }, b: { x: 500, y: 800 } }]);
        const from = { q: 15, r: 58 }, to = { q: 28, r: 58 };
        const route = hexRoute(target, from, to)!;
        expect(route[0]).toEqual(from);
        expect(route.at(-1)).toEqual(to);
        for (let i = 1; i < route.length; i++) expect(hexDistance(route[i - 1], route[i])).toBe(1);
        expect(route.length).toBeGreaterThan(hexDistance(from, to));
        expect(route.some(cell => hexFieldBlocked(target, cell))).toBe(false);
    });

    it("refuses a blocked start, a blocked destination, and a sealed room", () => {
        const sealed = field([{ a: { x: 500, y: 0 }, b: { x: 500, y: 1000 } }]);
        expect(hexRoute(sealed, { q: 15, r: 58 }, { q: 28, r: 58 })).toBeNull();
        const centred = field([{ a: { x: 470, y: 0 }, b: { x: 530, y: 1000 } }]);
        expect(hexRoute(centred, { q: 21, r: 58 }, { q: 30, r: 58 })).toBeNull();
        const room = field([{ a: { x: 500, y: 200 }, b: { x: 500, y: 260 } }]);
        expect(hexRoute(room, { q: 21, r: 58 }, { q: 21, r: 58 })).toEqual([{ q: 21, r: 58 }]);
    });
    it("keeps a cheaper terrain detour when straightening the searched route", () => {
        const polygon = [{ x: 400, y: 400 }, { x: 600, y: 400 }, { x: 600, y: 600 }, { x: 400, y: 600 }];
        const target = field([], { regions: [{ difficulty: 2, polygons: [polygon.flatMap(p => [p.x, p.y])] }] });
        const from = hexAt({ x: 200, y: 500 }, SIZE), to = hexAt({ x: 800, y: 500 }, SIZE);
        const route = hexRoute(target, from, to)!;
        const cost = (points: { x: number; y: number }[]) => points.slice(1).reduce((total, b, i) => {
            const a = points[i], interval: [number, number] = [0, 0];
            const fraction = segmentEntersInterior(polygon, a, b, interval) ? interval[1] - interval[0] : 0;
            return total + Math.hypot(b.x - a.x, b.y - a.y) / 20 * (1 + fraction);
        }, 0);
        const searchedCost = cost(route.map(cell => hexCentre(cell, SIZE)));
        expect(searchedCost).toBeLessThan(40); // Direct: 20 ft plain + 10 ft difficult = 40 ft.
        const straightenedCost = cost(hexPull(target, route));
        expect(straightenedCost).toBeLessThan(40);
        expect(straightenedCost).toBeLessThanOrEqual(searchedCost + 0.5);
    });


    it("pulls a route down to its corners and keeps every leg clear", () => {
        const target = field([{ a: { x: 500, y: 300 }, b: { x: 500, y: 700 } }]);
        const straight = hexRoute(target, { q: 30, r: 10 }, { q: 40, r: 10 })!;
        expect(hexPull(target, straight)).toHaveLength(2);
        const around = hexRoute(target, { q: 15, r: 58 }, { q: 28, r: 72 })!;
        const pulled = hexPull(target, around);
        expect(pulled.length).toBeGreaterThanOrEqual(3);
        expect(pulled.length).toBeLessThanOrEqual(around.length);
        for (let i = 1; i < pulled.length; i++) {
            expect(clearSegment(target.space, pulled[i - 1], pulled[i])).toBe(true);
        }
        expect(pulled[0]).toEqual(hexCentre({ q: 15, r: 58 }, SIZE));
        expect(pulled.at(-1)).toEqual(hexCentre({ q: 28, r: 72 }, SIZE));
    });

    it("sends a corridor route down the middle instead of along a wall", () => {
        const target = field([
            { a: { x: 150, y: 400 }, b: { x: 850, y: 400 } },
            { a: { x: 150, y: 600 }, b: { x: 850, y: 600 } },
        ]);
        const route = hexRoute(target, { q: -9, r: 58 }, { q: 51, r: 58 })!;
        const centres = route.map(cell => hexCentre(cell, SIZE));
        // Every row between the walls is equally cheap, but only the middle rows have room,
        // so the route must not drift into the wall-adjacent rows.
        const worst = Math.max(...centres.map(point => Math.abs(point.y - 500)));
        expect(worst).toBeLessThan(6);
        const pulled = hexPull(target, route);
        expect(pulled.length).toBeLessThanOrEqual(3);
        expect(pulled.every(point => Math.abs(point.y - 500) < 6)).toBe(true);
    });

    it.each([100, 200])("keeps a %i-pixel footprint clear on every search and straightened segment", width => {
        const walls = [{ a: { x: 500, y: 250 }, b: { x: 500, y: 750 } }];
        const target = field(walls, { full: { width, height: width }, cramped: { width: 50, height: 50 } });
        const route = hexRoute(target, hexAt({ x: 250, y: 500 }, SIZE), hexAt({ x: 750, y: 500 }, SIZE))!;
        const full = buildClearance(walls, bounds, width, width, 0);
        const searched = route.map(cell => hexCentre(cell, SIZE));
        const pulled = hexPull(target, route);
        for (const points of [searched, pulled]) {
            expect(points.slice(1).every((point, i) => clearSegment(full, points[i], point))).toBe(true);
        }
    });

    it("straightens close corners without adding zigzags or distance", () => {
        const edges = (points: number[][]) => points.slice(1).map((b, i) => ({
            a: { x: points[i][0], y: points[i][1] }, b: { x: b[0], y: b[1] },
        }));
        const walls = [
            ...edges([[100, 0], [100, 350], [400, 350], [400, 600], [550, 600], [550, 1200]]),
            ...edges([[500, 0], [500, 200], [800, 200], [800, 450], [1000, 450], [1000, 1200]]),
        ];
        const target = field(walls, {
            bounds: { x: 0, y: 0, width: 1200, height: 1200 },
            full: { width: 200, height: 200 }, cramped: { width: 100, height: 100 },
        });
        const from = hexAt({ x: 300, y: 150 }, SIZE), to = hexAt({ x: 800, y: 1050 }, SIZE);
        expect(hexRoute(target, from, to)).toBeNull();
        const route = hexRoute(target, from, to, "cramped")!;
        const searched = route.map(cell => hexCentre(cell, SIZE)), pulled = hexPull(target, route, "cramped");
        const length = (points: { x: number; y: number }[]) => points.slice(1)
            .reduce((sum, b, i) => sum + Math.hypot(b.x - points[i].x, b.y - points[i].y), 0);
        expect(length(pulled)).toBeLessThanOrEqual(length(searched) + 1e-7);
        for (let i = 1; i < pulled.length - 1; i++) {
            const a = pulled[i - 1], b = pulled[i], c = pulled[i + 1];
            expect((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)).toBeGreaterThanOrEqual(0);
        }
    });

    it("checks the swept footprint between clear neighbouring cell centres", () => {
        // Neither endpoint is inside the tiny wall's clearance, but the direct step crosses it.
        const walls = [{ a: { x: 295, y: 499 }, b: { x: 295, y: 506 } }];
        const target = field(walls, { full: { width: 2, height: 2 }, cramped: { width: 2, height: 2 }, tolerance: 0 });
        const full = buildClearance(walls, bounds, 2, 2, 0);
        const from = { q: 0, r: 58 }, to = { q: 1, r: 58 };
        const route = hexRoute(target, from, to)!;
        const centres = route.map(cell => hexCentre(cell, SIZE));
        expect(centres.slice(1).every((point, i) => clearSegment(full, centres[i], point))).toBe(true);
    });

    it("uses the smaller passage footprint only when explicitly requested", () => {
        const walls = gapWalls(60);
        const target = field(walls, { cramped: { width: 50, height: 50 } });
        const from = hexAt({ x: 200, y: 500 }, SIZE), to = hexAt({ x: 800, y: 500 }, SIZE);
        expect(hexRoute(target, from, to)).toBeNull();
        const route = hexRoute(target, from, to, "cramped")!;
        expect(route.at(-1)).toEqual(to);
        const pulled = hexPull(target, route, "cramped");
        const passage = buildClearance(walls, bounds, 50, 50, -SIZE / 2);
        expect(pulled.slice(1).every((point, i) => clearSegment(passage, pulled[i], point))).toBe(true);
        const sealed = field(gapWalls(30), { cramped: { width: 50, height: 50 } });
        expect(hexRoute(sealed, from, to, "cramped")).toBeNull();
    });
});

describe("long floods", () => {
    it("floods a budget spanning more distinct costs than the bucket ring", () => {
        // A 10,000px corridor: a 120ft budget passes through 241 distinct step costs, far more than the 151-slot ring.
        const corridor = buildHexField({ walls: [], bounds: { x: 0, y: 0, width: 10000, height: 300 }, size: SIZE, step: STEP, full: FULL, cramped: FULL });
        const start = hexAt({ x: 150, y: 150 }, SIZE);
        expect(() => floodReachable(corridor, start, 12000)).not.toThrow();
        expect(hexFieldReached(corridor, hexAt({ x: 2400, y: 150 }, SIZE))).toBe(true);
        expect(floodReachable(corridor, start, 3000)).toBeGreaterThan(0);
    });
});

describe("concave regions", () => {
    // A C-shaped ring: the notch at x 400..600, y 300..700 is outside the region.
    const cShape = [200, 200, 800, 200, 800, 300, 400, 300, 400, 700, 800, 700, 800, 800, 200, 800];

    it("classifies points of a concave ring by even-odd containment", () => {
        expect(pointInRegionPolygon(cShape, 300, 500)).toBe(true);
        expect(pointInRegionPolygon(cShape, 500, 500)).toBe(false);
        expect(pointInRegionPolygon(cShape, 700, 250)).toBe(true);
        expect(pointInRegionPolygon(cShape, 900, 500)).toBe(false);
    });

    it("rasterises difficult terrain and floors into concave regions", () => {
        const target = field([], { regions: [{ difficulty: 2, polygons: [cShape] }], floors: [{ floor: 5, polygons: [cShape] }] });
        const inArm = hexFieldIndex(target, hexAt({ x: 300, y: 500 }, SIZE)), inNotch = hexFieldIndex(target, hexAt({ x: 500, y: 500 }, SIZE));
        expect(target.difficulty[inArm]).toBe(2);
        expect(target.difficulty[inNotch]).toBe(0);
        expect(target.floor[inArm]).toBe(5);
    });
});

describe("floors", () => {
    // Three floors along x: ground below 400, a 2.5 ft step to 700, a 7.5 ft ledge beyond.
    const floors = [
        { floor: 0, polygons: [[0, 0, 400, 0, 400, 1000, 0, 1000]] },
        { floor: 2.5, polygons: [[400, 0, 700, 0, 700, 1000, 400, 1000]] },
        { floor: 7.5, polygons: [[700, 0, 1000, 0, 1000, 1000, 700, 1000]] },
    ];
    const cellAt = (x: number) => hexAt({ x, y: 500 }, SIZE);

    it("floods up one tread and down any drop, but not up a ledge on foot", () => {
        const walking = field([], { floors });
        floodReachable(walking, cellAt(250), 100_000);
        expect(hexFieldReached(walking, cellAt(550))).toBe(true);
        expect(hexFieldReached(walking, cellAt(850))).toBe(false);
        floodReachable(walking, cellAt(850), 100_000);
        expect(hexFieldReached(walking, cellAt(250))).toBe(true);
    });

    it("lets a climbing action or unenforced climbs take the ledge", () => {
        const climbing = field([], { floors, climb: true });
        floodReachable(climbing, cellAt(250), 100_000);
        expect(hexFieldReached(climbing, cellAt(850))).toBe(true);
    });

    it("routes around a ledge only when the action can climb it", () => {
        const walking = field([], { floors });
        expect(hexRoute(walking, cellAt(250), cellAt(850))).toBeNull();
        expect(hexRoute(walking, cellAt(850), cellAt(250))).not.toBeNull();
        const climbing = field([], { floors, climb: true });
        const route = hexRoute(climbing, cellAt(250), cellAt(850))!;
        expect(route).not.toBeNull();
        expect(hexPull(climbing, route).length).toBeGreaterThanOrEqual(2);
    });

    it("keeps floorless scenes exactly as before", () => {
        const plain = field([]);
        expect(plain.floor.every(Number.isNaN)).toBe(true);
        floodReachable(plain, cellAt(250), 100_000);
        expect(hexFieldReached(plain, cellAt(850))).toBe(true);
    });
});

describe("blocked frontier", () => {
    const cellAt = (x: number, y = 500) => hexAt({ x, y }, SIZE);
    const floors = [
        { floor: 0, polygons: [[0, 0, 400, 0, 400, 1000, 0, 1000]] },
        { floor: 7.5, polygons: [[400, 0, 1000, 0, 1000, 1000, 400, 1000]] },
    ];

    it("marks the ledge as a climb rim only when the action cannot climb it, never as a squeeze", () => {
        const walking = field([], { floors, cramped: { width: 50, height: 50 }, squeeze: { width: 25, height: 25 } });
        floodReachable(walking, cellAt(250), 100_000);
        const rims = blockedFrontier(walking);
        expect(rims.map(r => r.reason)).toEqual(["climb"]);
        expect(rims[0].cells.length).toBeGreaterThan(50);
        expect(rims[0].centre.x).toBeGreaterThan(390);
        expect(rims[0].centre.x).toBeLessThan(420);
        const climbing = field([], { floors, climb: true });
        floodReachable(climbing, cellAt(250), 100_000);
        expect(blockedFrontier(climbing)).toEqual([]);
    });

    it("marks a gap too tight for the cramped footprint but wide enough to squeeze", () => {
        const cramped = { width: 50, height: 50 }, squeeze = { width: 25, height: 25 };
        const narrow = field(gapWalls(40), { cramped, squeeze });
        floodReachable(narrow, cellAt(250), 100_000);
        const rims = blockedFrontier(narrow);
        expect(rims.map(r => r.reason)).toEqual(["squeeze"]);
        expect(Math.abs(rims[0].centre.y - 500)).toBeLessThan(30);
        expect(Math.abs(rims[0].centre.x - 500)).toBeLessThan(30);
        // The rim hugs the opening rather than running along the whole wall.
        expect(rims[0].cells.every(cell => Math.abs(hexCentre(cell, SIZE).y - 500) < 60)).toBe(true);
        const impassable = field(gapWalls(8), { cramped, squeeze });
        floodReachable(impassable, cellAt(250), 100_000);
        expect(blockedFrontier(impassable)).toEqual([]);
        const noSqueeze = field(gapWalls(40), { cramped });
        floodReachable(noSqueeze, cellAt(250), 100_000);
        expect(blockedFrontier(noSqueeze)).toEqual([]);
    });

    it("reports nothing on open ground and groups separate rims apart", () => {
        const open = field([]);
        floodReachable(open, cellAt(500), 100_000);
        expect(blockedFrontier(open)).toEqual([]);
        const twoLedges = field([], { floors: [
            { floor: 0, polygons: [[300, 0, 700, 0, 700, 1000, 300, 1000]] },
            { floor: 7.5, polygons: [[0, 0, 300, 0, 300, 1000, 0, 1000], [700, 0, 1000, 0, 1000, 1000, 700, 1000]] },
        ] });
        floodReachable(twoLedges, cellAt(500), 100_000);
        const rims = blockedFrontier(twoLedges);
        expect(rims).toHaveLength(2);
        expect(rims.map(r => Math.round(r.centre.x / 100)).sort()).toEqual([3, 7]);
    });
});

describe("squeeze routes", () => {
    const cramped = { width: 50, height: 50 }, squeeze = { width: 25, height: 25 };
    const west = hexAt({ x: 250, y: 500 }, SIZE), east = hexAt({ x: 750, y: 500 }, SIZE);

    it("routes through a squeeze-width gap only in squeeze mode, as greater difficult terrain", () => {
        const narrow = field(gapWalls(40), { cramped, squeeze });
        expect(hexRoute(narrow, west, east, "cramped")).toBeNull();
        const route = hexRoute(narrow, west, east, "squeeze")!;
        expect(route).not.toBeNull();
        const gapCells = route.filter(cell => Math.abs(hexCentre(cell, SIZE).x - 500) < 12);
        expect(gapCells.length).toBeGreaterThan(0);
        expect(gapCells.every(cell => narrow.difficulty[hexFieldIndex(narrow, cell)] === 3)).toBe(true);
        expect(hexPull(narrow, route, "squeeze").length).toBeGreaterThanOrEqual(2);
    });

    it("still refuses a gap tighter than the squeeze footprint", () => {
        const sealed = field(gapWalls(8), { cramped, squeeze });
        expect(hexRoute(sealed, west, east, "squeeze")).toBeNull();
    });
});
