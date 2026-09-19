import { afterEach, describe, expect, it, vi } from "vitest";
import { activateMovementLabel } from "../../../src/rulesets/sf2e/gridless/label.js";

let squeezedLegs: boolean[] = [];
vi.mock("../../../src/rulesets/sf2e/gridless/routing.js", () => ({ isSqueezedLeg: () => squeezedLegs.shift() ?? false }));

afterEach(() => vi.unstubAllGlobals());

type Waypoint = Record<string, any>;

function setup(options: { gridless?: boolean; floors?: boolean; enforceClimb?: boolean; speed?: number; history?: number } = {}) {
    const { gridless = true, floors = false, enforceClimb = true, speed = 25, history = 0 } = options;
    class Ruler {
        static WAYPOINT_LABEL_TEMPLATE = "systems/pf2e/waypoint-label.hbs";
        token: any;
        constructor(token: any) { this.token = token; }
        _getWaypointLabelContext(waypoint: Waypoint, _state: object): Record<string, any> | undefined {
            if (!waypoint.previous && !waypoint.next) return undefined;
            return { cssClass: "", units: "ft", cost: { total: String(waypoint.measurement.cost), units: "ft" },
                elevation: { total: "+0", icon: "fa-solid fa-arrows-up-down", hidden: true } };
        }
    }
    // Floors along x: 0 ft below 100, 2.5 ft to 300, 7.5 ft beyond; centres are +50.
    const floor = (elevation: number, minX: number, maxX: number) => ({
        levels: new Set(["floor"]), minX, polygonTree: { testPoint: (p: { x: number }) => p.x >= minX && p.x < maxX },
        behaviors: [{ type: "map-workshop-importer.setElevation", disabled: false, system: { elevation } }],
    });
    const scene = { regions: floors ? [floor(0, -Infinity, 100), floor(2.5, 100, 300), floor(7.5, 300, Infinity)] : [] };
    const token = {
        actor: { system: { movement: { speeds: { land: { value: speed } } } } },
        document: { parent: scene, level: "floor", movementHistory: [],
            getMovementOrigin: (p: { x: number; y: number }) => ({ x: p.x + 50, y: p.y + 50 }) },
        measureMovementPath: () => ({ cost: history }),
    };
    vi.stubGlobal("CONFIG", { Token: { rulerClass: Ruler, movement: { actions: { climb: { icon: "fa-solid fa-person-through-window" } } } } });
    vi.stubGlobal("CONST", { REGION_MOVEMENT_SEGMENTS: { ENTER: 1, MOVE: 0, EXIT: -1 } });
    vi.stubGlobal("game", { system: { id: "pf2e" }, combat: { started: true, combatant: { token: token.document } },
        settings: { get: (_ns: string, key: string) => key === "enforceClimb" ? enforceClimb : true },
        i18n: { format: (_key: string, data: { distance: string; units: string }) => `${data.distance} ${data.units} left` } });
    vi.stubGlobal("canvas", { ready: true, grid: { isGridless: gridless }, level: { elevation: { base: 0 } } });
    activateMovementLabel();
    const ruler = new Ruler(token);
    /** Build a linked chain of ruler waypoints from top-left positions with cumulative measurements. */
    const chain = (points: { x: number; distance?: number; cost?: number; action?: string }[]): Waypoint[] => {
        const waypoints: Waypoint[] = points.map((p, index) => ({ x: p.x, y: 0, elevation: 0, action: p.action ?? "walk", snapped: false,
            explicit: false, checkpoint: false, cost: p.cost ?? 0,
            measurement: { distance: p.distance ?? 0, cost: p.cost ?? p.distance ?? 0, backward: { distance: index ? (p.distance ?? 0) - (points[index - 1].distance ?? 0) : 0 } } }));
        waypoints.forEach((w, i) => { w.previous = waypoints[i - 1]; w.next = waypoints[i + 1]; });
        return waypoints;
    };
    const labels = (waypoints: Waypoint[]) => { const state = {}; return waypoints.map(w => ruler._getWaypointLabelContext(w, state)); };
    return { Ruler, ruler, chain, labels };
}

describe("merged ruler label", () => {
    it("swaps in the module template only while gridless combat is active", () => {
        expect(setup().Ruler.WAYPOINT_LABEL_TEMPLATE).toBe("modules/codex-foundry/dist/templates/gridless/waypoint-label.hbs");
        vi.unstubAllGlobals();
        expect(setup({ gridless: false }).Ruler.WAYPOINT_LABEL_TEMPLATE).toBe("systems/pf2e/waypoint-label.hbs");
    });

    it("adds the action glyph and remaining budget to the last waypoint only", () => {
        const { chain, labels } = setup({ speed: 25, history: 10 });
        const [, middle, last] = labels(chain([{ x: 0 }, { x: 200, distance: 10 }, { x: 400, distance: 20 }]));
        expect(middle!.actionCost).toBeUndefined();
        expect(middle!.remaining).toBeUndefined();
        expect(last!.actionCost).toEqual({ actions: 2, overage: false });
        expect(last!.remaining).toBe("20 ft left");
    });

    it("shows the cramped or terrain surcharge as an additional cost", () => {
        const { chain, labels } = setup();
        const [, last] = labels(chain([{ x: 0 }, { x: 200, distance: 16.98, cost: 19.12 }]));
        expect(last!.cost.additional).toEqual({ total: 2.14, delta: 2.14 });
        const [, plain] = labels(chain([{ x: 0 }, { x: 200, distance: 10, cost: 10 }]));
        expect(plain!.cost.additional).toBeUndefined();
    });

    it("leaves labels alone off gridless scenes", () => {
        const { chain, labels } = setup({ gridless: false });
        const [, last] = labels(chain([{ x: 0 }, { x: 200, distance: 10, cost: 12 }]));
        expect(last!.actionCost).toBeUndefined();
        expect(last!.cost.additional).toBeUndefined();
    });

    it("previews the planned floor height with its change at each waypoint", () => {
        const { chain, labels } = setup({ floors: true });
        const [, step, further] = labels(chain([{ x: 0 }, { x: 150, distance: 7.5 }, { x: 250, distance: 12.5 }]));
        expect(step!.elevation).toEqual({ total: "+2.5", icon: "fa-solid fa-arrows-up-down", hidden: false, delta: "+2.5" });
        expect(further!.elevation).toEqual({ total: "+2.5", icon: "fa-solid fa-arrows-up-down", hidden: false });
        expect(step!.climbRefused).toBeUndefined();
    });

    it("marks waypoints beyond a refused ledge and holds the height there", () => {
        const enforced = setup({ floors: true });
        const [, onStep, pastLedge] = enforced.labels(enforced.chain([{ x: 0 }, { x: 150, distance: 7.5 }, { x: 400, distance: 20 }]));
        expect(onStep!.climbRefused).toBeUndefined();
        expect(pastLedge!.climbRefused).toBe(true);
        expect(pastLedge!.cssClass).toContain("unreachable");
        expect(pastLedge!.climbIcon).toBe("fa-solid fa-person-through-window");
        expect(pastLedge!.elevation!.total).toBe("+2.5");
        vi.unstubAllGlobals();
        const relaxed = setup({ floors: true, enforceClimb: false });
        const [, , walked] = relaxed.labels(relaxed.chain([{ x: 0 }, { x: 150, distance: 7.5 }, { x: 400, distance: 20 }]));
        expect(walked!.climbRefused).toBeUndefined();
        expect(walked!.elevation).toEqual({ total: "+7.5", icon: "fa-solid fa-arrows-up-down", hidden: false, delta: "+5" });
    });

    it("flags every label from the first squeezed leg onward so the last one shows the compress icon", () => {
        const { chain, labels } = setup();
        // The mocked leg check reports only the second leg as squeezed.
        squeezedLegs = [false, true, false];
        const [, before, squeezedLeg, after] = labels(chain([{ x: 0 }, { x: 100, distance: 5 }, { x: 200, distance: 10, cost: 20 }, { x: 300, distance: 15, cost: 25 }]));
        expect(before!.squeezed).toBeUndefined();
        expect(squeezedLeg!.squeezed).toBe(true);
        expect(after!.squeezed).toBe(true);
    });
});
