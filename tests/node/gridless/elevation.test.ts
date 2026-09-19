import { describe, expect, it } from "vitest";
import {
    CLIMB_ACTIONS, MIN_TRAVERSE, STEP_FEET, decideElevation, pathParam, planElevationPath, type ElevationWaypoint,
} from "../../../src/rulesets/sf2e/gridless/elevation.js";

const wp = (x: number, y: number, extra: Partial<ElevationWaypoint> = {}): ElevationWaypoint =>
    ({ x, y, elevation: 0, action: "walk", snapped: false, explicit: false, checkpoint: false, ...extra });
const heights = (plan: ReturnType<typeof planElevationPath>) => plan!.waypoints.map(w => [w.x, w.y, w.elevation]);

describe("decideElevation", () => {
    it("treats one step up or any descent as free for a walking token", () => {
        expect(decideElevation(0, 2.5, "walk")).toBe("move");
        expect(decideElevation(0, STEP_FEET, "walk")).toBe("move");
        expect(decideElevation(25, 0, "walk")).toBe("move");
        expect(decideElevation(10, 7.5, "crawl")).toBe("move");
    });
    it("does nothing at the current height", () => {
        expect(decideElevation(7.5, 7.5, "walk")).toBe("none");
        expect(decideElevation(7.5, 7.5000001, "walk")).toBe("none");
    });
    it("blocks a rise above one step for walking-type actions", () => {
        for (const action of ["walk", "crawl", "swim", "jump", undefined]) expect(decideElevation(0, 5, action)).toBe("block");
    });
    it("lets climbing, flying, blinking and displacement take any rise", () => {
        for (const action of CLIMB_ACTIONS) expect(decideElevation(0, 25, action)).toBe("move");
        expect([...CLIMB_ACTIONS].sort()).toEqual(["blink", "climb", "displace", "fly"]);
    });
});

describe("pathParam", () => {
    it("measures distance along a polyline to a point on it", () => {
        const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }];
        expect(pathParam(points, { x: 40, y: 0 })).toBe(40);
        expect(pathParam(points, { x: 100, y: 20 })).toBe(120);
        expect(pathParam(points, { x: 100, y: 0.4 })).toBe(100.4);
        expect(pathParam(points, { x: 500, y: 500 })).toBeNull();
    });
});

describe("planElevationPath", () => {
    const start = { x: 0, y: 0, elevation: 0 };

    it("inserts a rise just before each floor entry and carries the height forward", () => {
        const plan = planElevationPath({ start, waypoints: [wp(200, 0, { checkpoint: true })],
            crossings: [{ floor: 2.5, from: { x: 99, y: 0 }, to: { x: 101, y: 0 } }] });
        expect(plan!.blocked).toBeNull();
        expect(plan!.waypoints).toEqual([
            { x: 99, y: 0, elevation: 2.5, action: "walk", snapped: false, explicit: false, checkpoint: false },
            { x: 200, y: 0, elevation: 2.5, action: "walk", snapped: false, explicit: false, checkpoint: true },
        ]);
    });

    it("handles several treads in path order across original segments", () => {
        const plan = planElevationPath({ start, waypoints: [wp(100, 0), wp(100, 100)], crossings: [
            { floor: 5, from: { x: 100, y: 49 }, to: { x: 100, y: 51 } },
            { floor: 2.5, from: { x: 49, y: 0 }, to: { x: 51, y: 0 } },
        ] });
        expect(heights(plan)).toEqual([[49, 0, 2.5], [100, 0, 2.5], [100, 49, 5], [100, 100, 5]]);
    });

    it("truncates at a refused climb and reports the rise", () => {
        const crossings = [{ floor: 7.5, from: { x: 99, y: 0 }, to: { x: 101, y: 0 } }];
        const plan = planElevationPath({ start, waypoints: [wp(200, 0)], crossings });
        expect(plan!.blocked).toEqual({ floor: 7.5, rise: 7.5 });
        expect(heights(plan)).toEqual([[99, 0, 0]]);
        const climbing = planElevationPath({ start, waypoints: [wp(200, 0, { action: "climb" })], crossings });
        expect(climbing!.blocked).toBeNull();
        expect(heights(climbing)).toEqual([[99, 0, 7.5], [200, 0, 7.5]]);
    });

    it("keeps an explicit user elevation change and returns null with no crossings", () => {
        const flying = [wp(100, 0, { elevation: 20, explicit: true, action: "fly" }), wp(200, 0, { elevation: 20, action: "fly" })];
        const plan = planElevationPath({ start, waypoints: flying, crossings: [{ floor: 2.5, from: { x: 149, y: 0 }, to: { x: 151, y: 0 } }] });
        expect(heights(plan)).toEqual([[100, 0, 20], [149, 0, 2.5], [200, 0, 2.5]]);
        expect(planElevationPath({ start, waypoints: [wp(100, 0)], crossings: [] })).toBeNull();
        expect(planElevationPath({ start: { x: 0, y: 0, elevation: 2.5 }, waypoints: [wp(100, 0, { elevation: 2.5 })],
            crossings: [{ floor: 2.5, from: { x: 49, y: 0 }, to: { x: 51, y: 0 } }] })).toBeNull();
    });

    it("settles a token whose stored elevation differs from the floor it stands on", () => {
        const plan = planElevationPath({ start: { x: 0, y: 0, elevation: 7.5 }, waypoints: [wp(200, 0)],
            crossings: [{ floor: 5, from: { x: 99, y: 0 }, to: { x: 101, y: 0 } }], tokenElevation: 0 });
        expect(plan!.blocked).toBeNull();
        expect(heights(plan)).toEqual([[99, 0, 5], [200, 0, 5]]);
        const noCrossings = planElevationPath({ start: { x: 0, y: 0, elevation: 7.5 }, waypoints: [wp(100, 0)], crossings: [], tokenElevation: 0 });
        expect(heights(noCrossings)).toEqual([[100, 0, 7.5]]);
        const deliberate = planElevationPath({ start: { x: 0, y: 0, elevation: 7.5 },
            waypoints: [wp(100, 0, { elevation: 20, explicit: true, action: "fly" })], crossings: [], tokenElevation: 0 });
        expect(heights(deliberate)).toEqual([[100, 0, 20]]);
    });

    it("ignores a brief corner clip of a neighbouring region but not a real entry", () => {
        const start = { x: 0, y: 0, elevation: 2.5 };
        const waypoints = [wp(200, 0, { elevation: 2.5 })];
        const clip = { floor: 7.5, from: { x: 49, y: 0 }, to: { x: 51, y: 0 }, exit: { x: 61, y: 0 } };
        const step = { floor: 5, from: { x: 149, y: 0 }, to: { x: 151, y: 0 } };
        const plan = planElevationPath({ start, waypoints, crossings: [clip, step] });
        expect(plan!.blocked).toBeNull();
        expect(heights(plan)).toEqual([[149, 0, 5], [200, 0, 5]]);
        const real = { ...clip, exit: { x: 51 + MIN_TRAVERSE + 5, y: 0 } };
        expect(planElevationPath({ start, waypoints, crossings: [real, step] })!.blocked).toEqual({ floor: 7.5, rise: 5 });
        expect(planElevationPath({ start, waypoints: [wp(55, 0, { elevation: 2.5 })],
            crossings: [{ floor: 7.5, from: { x: 49, y: 0 }, to: { x: 51, y: 0 } }] })!.blocked).toEqual({ floor: 7.5, rise: 5 });
    });

    it("never blocks with enforceClimb off and still sets floor heights", () => {
        const crossings = [{ floor: 7.5, from: { x: 99, y: 0 }, to: { x: 101, y: 0 } }];
        const plan = planElevationPath({ start, waypoints: [wp(200, 0)], crossings, enforceClimb: false });
        expect(plan!.blocked).toBeNull();
        expect(heights(plan)).toEqual([[99, 0, 7.5], [200, 0, 7.5]]);
    });
});
