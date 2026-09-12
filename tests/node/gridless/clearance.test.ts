import { describe, expect, it } from "vitest";
import { buildClearance, clearSegment, rayClearance } from "../../../src/rulesets/sf2e/gridless/clearance.js";

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
