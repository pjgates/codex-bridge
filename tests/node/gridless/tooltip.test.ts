import { afterEach, describe, expect, it, vi } from "vitest";
import { activateElevationTooltip, GROUND_COLOR, readingText, referenceToken, tooltipReading, WATER_COLOR } from "../../../src/rulesets/sf2e/gridless/tooltip.js";
import { setAbsoluteElevationHeld } from "../../../src/rulesets/sf2e/gridless/elevation-key.js";

afterEach(() => { setAbsoluteElevationHeld(false); vi.unstubAllGlobals(); });

// Upper level: terrace at 10 ft over x 100..300. Lower level: cave floor at 0 ft everywhere, pit at -15 ft past 300.
const floor = (level: string, elevation: number, minX: number, maxX: number) => ({
    levels: new Set([level]), polygonTree: { testPoint: (p: { x: number }) => p.x >= minX && p.x < maxX },
    behaviors: [{ type: "map-workshop-importer.setElevation", disabled: false, system: { elevation } }],
});
const regions = [floor("upper", 10, 100, 300), floor("lower", 0, -Infinity, 300), floor("lower", -15, 300, Infinity)];
const floors = regions.map(region => ({ region, floor: region.behaviors[0].system.elevation }));

// A pool on the lower level past x 300: bed at -15 ft (the pit), surface at -10 ft.
const poolRegion = { levels: new Set(["lower"]), polygonTree: { testPoint: (p: { x: number }) => p.x >= 300 }, elevation: { bottom: -15, top: -10 },
    behaviors: [{ type: "map-workshop-importer.water", disabled: false, system: {} }] };
const water = [{ region: poolRegion, surface: -10, bed: -15 }];
const i18n = { format: (key: string, data: Record<string, string>) => `${data.value}|${key.split(".").pop()}` };

const tok = (id: string, x: number, elevation: number) => ({ id, center: { x, y: 0 }, document: { elevation } });

describe("tooltipReading", () => {
    const dragon = tok("dragon", 200, 20);
    const goblin = tok("goblin", 50, 5);

    it("reads the reference token's height above the surface below it, across levels", () => {
        // 20 ft up over the terrace (10 ft): the terrace is beneath, not the cave floor.
        expect(tooltipReading(dragon, floors, water, dragon, false)).toEqual({ value: 10, kind: "ground" });
        // 5 ft up over the cave floor.
        expect(tooltipReading(goblin, floors, water, goblin, false)).toEqual({ value: 5, kind: "ground" });
        // Without a reference every token reads against its own floor.
        expect(tooltipReading(dragon, floors, water, null, false)).toEqual({ value: 10, kind: "ground" });
    });

    it("reads other tokens relative to the reference token", () => {
        expect(tooltipReading(dragon, floors, water, goblin, false)).toEqual({ value: 15, kind: "relative" });
        expect(tooltipReading(goblin, floors, water, dragon, false)).toEqual({ value: -15, kind: "relative" });
    });

    it("reads scene-absolute elevation while the key is held", () => {
        expect(tooltipReading(dragon, floors, water, goblin, true)).toEqual({ value: 20, kind: "absolute" });
    });

    it("reads against the water surface over a pool", () => {
        const wader = tok("wader", 400, -15);
        expect(tooltipReading(wader, floors, water, wader, false)).toEqual({ value: -5, kind: "waterBelow" });
        const bird = tok("bird", 400, 0);
        expect(tooltipReading(bird, floors, water, bird, false)).toEqual({ value: 10, kind: "waterAbove" });
        // Below the bed the pool is not beneath; the floor lookup takes over and finds nothing.
        expect(tooltipReading(tok("mole", 400, -20), floors, water, null, false)).toBeNull();
    });

    it("defers to native when there is no floor under a floor-relative token", () => {
        const flyer = tok("flyer", 200, -20);
        expect(tooltipReading(flyer, floors, water, flyer, false)).toBeNull();
        expect(tooltipReading(flyer, [], [], flyer, false)).toBeNull();
    });
});

describe("readingText", () => {
    it("words ground and water readings and hides zero", () => {
        vi.stubGlobal("game", { i18n });
        expect(readingText({ value: 20, kind: "ground" }, "ft")).toBe("+20 ft|aboveGround");
        expect(readingText({ value: 10, kind: "waterAbove" }, "ft")).toBe("+10 ft|aboveWater");
        expect(readingText({ value: -5, kind: "waterBelow" }, "ft")).toBe("5 ft|belowSurface");
        expect(readingText({ value: -15, kind: "relative" }, "ft")).toBe("-15 ft");
        expect(readingText({ value: 0, kind: "ground" }, "ft")).toBe("");
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
            tooltip = { style: { fill: "#ffffff" } };
            constructor(id: string, x: number, elevation: number, scene: object) {
                this.id = id; this.center = { x, y: 0 }; this.document = { elevation, parent: scene };
            }
            _getTooltipText(): string { return `native ${this.document.elevation}`; }
            _refreshTooltip(): void { this.tooltip.style.fill = "#ffffff"; }
        }
        const scene = { regions: options.floors === false ? [] : [...regions, poolRegion] };
        const dragon = new Token("dragon", 200, 20, scene);
        const goblin = new Token("goblin", 50, 5, scene);
        const hooks: Record<string, (...args: any[]) => unknown> = {};
        vi.stubGlobal("Hooks", { on: (name: string, callback: (...args: any[]) => unknown) => { hooks[name] = callback; } });
        vi.stubGlobal("CONFIG", { Token: { objectClass: Token } });
        const controlled: Token[] = [];
        vi.stubGlobal("canvas", { ready: true, grid: { units: "ft" }, tokens: { controlled, placeables: [dragon, goblin] } });
        vi.stubGlobal("game", { user: { character: null }, i18n });
        activateElevationTooltip();
        return { dragon, goblin, controlled, hooks };
    }

    it("formats the relative height with the grid units and hides zero", () => {
        const { dragon, goblin, controlled } = setup();
        controlled.push(goblin);
        expect(goblin._getTooltipText()).toBe("+5 ft|aboveGround");
        expect(dragon._getTooltipText()).toBe("+15 ft");
        controlled.splice(0, 1, dragon);
        expect(goblin._getTooltipText()).toBe("-15 ft");
        expect(dragon._getTooltipText()).toBe("+10 ft|aboveGround");
        dragon.document.elevation = 10;
        expect(dragon._getTooltipText()).toBe("");
    });

    it("colours ground and water labels after the native refresh, and leaves the rest white", () => {
        const { dragon, goblin, controlled } = setup();
        controlled.push(dragon);
        dragon._getTooltipText(); dragon._refreshTooltip();
        expect(dragon.tooltip.style.fill).toBe(GROUND_COLOR);
        goblin._getTooltipText(); goblin._refreshTooltip();
        expect(goblin.tooltip.style.fill).toBe("#ffffff");
        dragon.center.x = 400; dragon.document.elevation = -12;
        dragon._getTooltipText(); dragon._refreshTooltip();
        expect(dragon.tooltip.style.fill).toBe(WATER_COLOR);
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
