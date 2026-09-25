import { afterEach, describe, expect, it, vi } from "vitest";
import { activateMovementChecks, movementChecks } from "../../../src/rulesets/sf2e/gridless/checks.js";

let squeezedLegs: boolean[] = [];
vi.mock("../../../src/rulesets/sf2e/gridless/routing.js", () => ({ isSqueezedLeg: () => squeezedLegs.shift() ?? false }));

afterEach(() => vi.unstubAllGlobals());

const wp = (x: number, elevation: number, action = "walk") => ({ x, y: 0, elevation, action, width: 1, height: 1, shape: 4, level: "floor" });

describe("movementChecks", () => {
    it("leaves climbing to the transition owner and prompts only Squeeze", () => {
        vi.stubGlobal("CONFIG", { Token: { movement: { actions: { walk: {}, climb: {}, fly: {}, blink: { teleport: true } } } } });
        expect([...movementChecks([{ from: wp(0, 0), to: wp(100, 2.5, "climb"), squeezed: false }])]).toEqual([]);
        expect([...movementChecks([{ from: wp(0, 0), to: wp(100, 7.5, "climb"), squeezed: false }])]).toEqual([]);
        expect([...movementChecks([{ from: wp(0, 7.5), to: wp(100, 0), squeezed: false }])]).toEqual([]);
        expect([...movementChecks([{ from: wp(0, 0), to: wp(100, 0), squeezed: true }])]).toEqual(["squeeze"]);
        expect([...movementChecks([{ from: wp(0, 0), to: wp(100, 7.5, "fly"), squeezed: true }])]).toEqual([]);
        expect([...movementChecks([{ from: wp(0, 0), to: wp(100, 7.5, "blink"), squeezed: false }])]).toEqual([]);
    });
});

describe("preMoveToken prompt", () => {
    function setup(enabled = true) {
        const hooks: Record<string, (...args: any[]) => unknown> = {};
        const used: string[] = [];
        vi.stubGlobal("Hooks", { on: (name: string, cb: (...args: any[]) => unknown) => { hooks[name] = cb; } });
        vi.stubGlobal("CONFIG", { Token: { movement: { actions: { walk: {}, climb: {} } } } });
        vi.stubGlobal("canvas", { ready: true, grid: { isGridless: true } });
        vi.stubGlobal("game", { system: { id: "pf2e" }, settings: { get: () => enabled },
            pf2e: { actions: { get: (slug: string) => ({ use: async () => { used.push(slug); } }) } } });
        activateMovementChecks();
        const token = { actor: {}, object: {}, _source: { level: "floor" } };
        return { hooks, used, token };
    }

    it("posts only Squeeze; the transition owner resolves climbing before progress", async () => {
        const { hooks, used, token } = setup();
        squeezedLegs = [true, false];
        const result = hooks.preMoveToken(token, { origin: wp(0, 0), passed: { waypoints: [wp(100, 0), wp(200, 7.5, "climb")] } }, {});
        await Promise.resolve();
        expect(result).toBe(true);
        expect(used.sort()).toEqual(["squeeze"]);
    });

    it("stays quiet when the setting is off or the token has no actor", async () => {
        const off = setup(false);
        squeezedLegs = [true];
        off.hooks.preMoveToken(off.token, { origin: wp(0, 0), passed: { waypoints: [wp(100, 7.5, "climb")] } }, {});
        await Promise.resolve();
        expect(off.used).toEqual([]);
        vi.unstubAllGlobals();
        const on = setup();
        on.hooks.preMoveToken({ ...on.token, actor: null }, { origin: wp(0, 0), passed: { waypoints: [wp(100, 7.5, "climb")] } }, {});
        await Promise.resolve();
        expect(on.used).toEqual([]);
    });
});
