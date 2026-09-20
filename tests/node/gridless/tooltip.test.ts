import { afterEach, describe, expect, it, vi } from "vitest";
import { activateElevationTooltip, referenceToken, tooltipElevation } from "../../../src/rulesets/sf2e/gridless/tooltip.js";
import { setAbsoluteElevationHeld } from "../../../src/rulesets/sf2e/gridless/elevation-key.js";

afterEach(() => { setAbsoluteElevationHeld(false); vi.unstubAllGlobals(); });

// Upper level: terrace at 10 ft over x 100..300. Lower level: cave floor at 0 ft everywhere, pit at -15 ft past 300.
const floor = (level: string, elevation: number, minX: number, maxX: number) => ({
    levels: new Set([level]), polygonTree: { testPoint: (p: { x: number }) => p.x >= minX && p.x < maxX },
    behaviors: [{ type: "map-workshop-importer.setElevation", disabled: false, system: { elevation } }],
});
const regions = [floor("upper", 10, 100, 300), floor("lower", 0, -Infinity, 300), floor("lower", -15, 300, Infinity)];
const floors = regions.map(region => ({ region, floor: region.behaviors[0].system.elevation }));

const tok = (id: string, x: number, elevation: number) => ({ id, center: { x, y: 0 }, document: { elevation } });

describe("tooltipElevation", () => {
    const dragon = tok("dragon", 200, 20);
    const goblin = tok("goblin", 50, 5);

    it("shows the reference token's height above the surface below it, across levels", () => {
        // 20 ft up over the terrace (10 ft): the terrace is beneath, not the cave floor.
        expect(tooltipElevation(dragon, floors, dragon, false)).toBe(10);
        // 5 ft up over the cave floor.
        expect(tooltipElevation(goblin, floors, goblin, false)).toBe(5);
        // Without a reference every token reads against its own floor.
        expect(tooltipElevation(dragon, floors, null, false)).toBe(10);
    });

    it("shows other tokens relative to the reference token", () => {
        expect(tooltipElevation(dragon, floors, goblin, false)).toBe(15);
        expect(tooltipElevation(goblin, floors, dragon, false)).toBe(-15);
    });

    it("shows scene-absolute elevation while the key is held", () => {
        expect(tooltipElevation(dragon, floors, goblin, true)).toBe(20);
        expect(tooltipElevation(goblin, floors, goblin, true)).toBe(5);
    });

    it("falls back to native when there is no floor under a floor-relative token", () => {
        const flyer = tok("flyer", 200, -20);
        expect(tooltipElevation(flyer, floors, flyer, false)).toBeNull();
        expect(tooltipElevation(flyer, [], flyer, false)).toBeNull();
    });
});

describe("referenceToken", () => {
    it("prefers the single controlled token, then the user's character on the scene", () => {
        const a = tok("a", 0, 0), b = tok("b", 0, 0);
        expect(referenceToken([a], [b])).toBe(a);
        expect(referenceToken([a, b], [b])).toBe(b);
        expect(referenceToken([], [b])).toBe(b);
        expect(referenceToken([], [])).toBeNull();
        expect(referenceToken([a, b], [])).toBeNull();
    });
});

describe("patched Token#_getTooltipText", () => {
    function setup(options: { floors?: boolean } = {}) {
        class Token {
            id: string; center: { x: number; y: number }; document: { elevation: number; parent: object };
            actor: object | null = null;
            renderFlags = { set: vi.fn() };
            constructor(id: string, x: number, elevation: number, scene: object) {
                this.id = id; this.center = { x, y: 0 }; this.document = { elevation, parent: scene };
            }
            _getTooltipText(): string { return `native ${this.document.elevation}`; }
        }
        const scene = { regions: options.floors === false ? [] : regions };
        const dragon = new Token("dragon", 200, 20, scene);
        const goblin = new Token("goblin", 50, 5, scene);
        const hooks: Record<string, (...args: any[]) => unknown> = {};
        vi.stubGlobal("Hooks", { on: (name: string, callback: (...args: any[]) => unknown) => { hooks[name] = callback; } });
        vi.stubGlobal("CONFIG", { Token: { objectClass: Token } });
        const controlled: Token[] = [];
        vi.stubGlobal("canvas", { ready: true, grid: { units: "ft" }, tokens: { controlled, placeables: [dragon, goblin] } });
        vi.stubGlobal("game", { user: { character: null } });
        activateElevationTooltip();
        return { dragon, goblin, controlled, hooks };
    }

    it("formats the relative height with the grid units and hides zero", () => {
        const { dragon, goblin, controlled } = setup();
        controlled.push(goblin);
        expect(goblin._getTooltipText()).toBe("+5 ft");
        expect(dragon._getTooltipText()).toBe("+15 ft");
        controlled.splice(0, 1, dragon);
        expect(goblin._getTooltipText()).toBe("-15 ft");
        expect(dragon._getTooltipText()).toBe("+10 ft");
        dragon.document.elevation = 10;
        expect(dragon._getTooltipText()).toBe("");
    });

    it("keeps the native text on scenes without floors and where no floor lies below", () => {
        const { dragon } = setup({ floors: false });
        expect(dragon._getTooltipText()).toBe("native 20");
    });

    it("refreshes every tooltip when control, elevation, or the key changes", () => {
        const { dragon, goblin, hooks } = setup();
        hooks.controlToken();
        hooks.updateToken({}, { elevation: 3 });
        hooks.updateToken({}, { x: 3 });
        setAbsoluteElevationHeld(true);
        expect(dragon.renderFlags.set).toHaveBeenCalledTimes(3);
        expect(goblin.renderFlags.set).toHaveBeenCalledWith({ refreshTooltip: true });
        expect(dragon._getTooltipText()).toBe("+20 ft");
    });
});
