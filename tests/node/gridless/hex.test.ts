import { describe, expect, it } from "vitest";
import { hexAt, hexCentre, hexCorners, hexDistance, hexNeighbour, hexRange, type Hex } from "../../../src/rulesets/sf2e/gridless/hex.js";

/** Centre-to-centre distance of neighbouring cells, in scene pixels (6 inches of game distance). */
const SIZE = 10;
const CIRCUMRADIUS = SIZE / Math.sqrt(3);

const cells: Hex[] = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }, { q: 1, r: -1 }, { q: -7, r: 4 }, { q: 23, r: -11 }];

describe("axial hex lattice", () => {
    it("places every neighbour exactly one step from the cell centre", () => {
        const origin = { q: 3, r: -2 };
        const centre = hexCentre(origin, SIZE);
        const bearings = new Set<string>();
        for (let direction = 0; direction < 6; direction++) {
            const neighbour = hexNeighbour(origin, direction);
            const point = hexCentre(neighbour, SIZE);
            expect(Math.hypot(point.x - centre.x, point.y - centre.y)).toBeCloseTo(SIZE, 9);
            expect(hexDistance(origin, neighbour)).toBe(1);
            bearings.add(`${Math.round(Math.atan2(point.y - centre.y, point.x - centre.x) * 1e6)}`);
        }
        expect(bearings.size).toBe(6);
        expect(hexDistance(origin, origin)).toBe(0);
        expect(hexDistance({ q: 0, r: 0 }, { q: 2, r: -1 })).toBe(2);
        expect(hexDistance({ q: 0, r: 0 }, { q: -3, r: 5 })).toBe(5);
    });

    it("round-trips any point to the cell containing it", () => {
        for (const cell of cells) expect(hexAt(hexCentre(cell, SIZE), SIZE)).toEqual(cell);
        for (const point of [{ x: 0, y: 0 }, { x: 7.5, y: 3.25 }, { x: -23.5, y: 61.25 }, { x: 100.4, y: -0.6 }]) {
            const cell = hexAt(point, SIZE);
            const centre = hexCentre(cell, SIZE);
            // A hexagon's farthest interior point is its circumradius from the centre.
            expect(Math.hypot(point.x - centre.x, point.y - centre.y)).toBeLessThanOrEqual(CIRCUMRADIUS + 1e-9);
            expect(hexAt(centre, SIZE)).toEqual(cell);
        }
    });

    it("shares exactly one edge with each neighbour", () => {
        const cell = { q: 5, r: 2 };
        const corners = hexCorners(cell, SIZE);
        expect(corners).toHaveLength(6);
        const centre = hexCentre(cell, SIZE);
        const key = (x: number, y: number) => `${x.toFixed(6)}:${y.toFixed(6)}`;
        for (let index = 0; index < 6; index++) {
            expect(Math.hypot(corners[index].x - centre.x, corners[index].y - centre.y)).toBeCloseTo(CIRCUMRADIUS, 9);
            const next = corners[(index + 1) % 6];
            expect(Math.hypot(next.x - corners[index].x, next.y - corners[index].y)).toBeCloseTo(CIRCUMRADIUS, 9);
        }
        for (let direction = 0; direction < 6; direction++) {
            const neighbour = new Set(hexCorners(hexNeighbour(cell, direction), SIZE).map(point => key(point.x, point.y)));
            const shared = corners.filter(point => neighbour.has(key(point.x, point.y)));
            expect(shared).toHaveLength(2);
        }
    });

    it("covers a scene rectangle with the reported axial range", () => {
        const bounds = { x: -40, y: -15, width: 300, height: 220 };
        const range = hexRange(bounds, SIZE);
        for (const x of [bounds.x, bounds.x + bounds.width]) {
            for (const y of [bounds.y, bounds.y + bounds.height]) {
                const cell = hexAt({ x, y }, SIZE);
                expect(cell.q).toBeGreaterThanOrEqual(range.qMin);
                expect(cell.q).toBeLessThanOrEqual(range.qMax);
                expect(cell.r).toBeGreaterThanOrEqual(range.rMin);
                expect(cell.r).toBeLessThanOrEqual(range.rMax);
            }
        }
        // A cell outside the rectangle's own bounds must not be silently required.
        const inside = hexAt({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, SIZE);
        expect(inside.q).toBeGreaterThan(range.qMin);
        expect(inside.q).toBeLessThan(range.qMax);
    });
});
