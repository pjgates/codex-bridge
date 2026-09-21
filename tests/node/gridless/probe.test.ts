import { afterEach, describe, expect, it, vi } from "vitest";
import { probeText, visibleFloors } from "../../../src/rulesets/sf2e/gridless/probe.js";

afterEach(() => vi.unstubAllGlobals());

const floor = (level: string, elevation: number, minX: number, maxX: number) => ({
    levels: new Set([level]), includedInLevel: (id: string) => id === level,
    polygonTree: { testPoint: (p: { x: number }) => p.x >= minX && p.x < maxX },
    behaviors: [{ type: "map-workshop-importer.setElevation", disabled: false, system: { elevation } }],
});
// Upper level: terrace at 10 ft over x 100..300. Lower level: cave floor at 0 ft to 300, pit at -15 ft beyond.
const regions = [floor("upper", 10, 100, 300), floor("lower", 0, -Infinity, 300), floor("lower", -15, 300, Infinity)];
const floors = regions.map(region => ({ region, floor: region.behaviors[0].system.elevation }));
const i18n = { format: (key: string, data: Record<string, string>) => `${key.split(".").pop()}:${data.distance ?? data.depth}` };
const pool = { region: { polygonTree: { testPoint: (p: { x: number }) => p.x >= 500 } }, surface: -10, bed: -15 } as any;

describe("visibleFloors", () => {
    it("keeps floors on the levels the viewer can currently see", () => {
        const scene = { regions, levels: [{ id: "upper", isVisible: true }, { id: "lower", isVisible: false }] };
        expect(visibleFloors(scene as any).map(f => f.floor)).toEqual([10]);
        scene.levels[1].isVisible = true;
        expect(visibleFloors(scene as any).map(f => f.floor)).toEqual([10, 0, -15]);
    });
});

describe("probeText", () => {
    it("reads the top visible floor under the cursor, absolute and relative to the reference", () => {
        vi.stubGlobal("game", { i18n });
        expect(probeText(floors, [], { x: 400, y: 0 }, { document: { elevation: 5 } }, "ft")).toEqual({ text: "-15 ft · probeBelow:20", water: false });
        expect(probeText(floors, [], { x: 200, y: 0 }, { document: { elevation: 5 } }, "ft")!.text).toBe("+10 ft · probeAbove:5");
        expect(probeText(floors, [], { x: 50, y: 0 }, { document: { elevation: 0 } }, "ft")!.text).toBe("0 ft · probeLevel:0");
    });

    it("reads the water surface and depth over a pool", () => {
        vi.stubGlobal("game", { i18n });
        expect(probeText(floors, [pool], { x: 600, y: 0 }, { document: { elevation: 5 } }, "ft")).toEqual({ text: "-10 ft · probeDepth:5 · probeBelow:15", water: true });
        expect(probeText(floors, [pool], { x: 600, y: 0 }, null, "ft")!.text).toBe("-10 ft · probeDepth:5");
        expect(probeText(floors, [pool], { x: 400, y: 0 }, null, "ft")!.water).toBe(false);
    });

    it("measures depth to the floor under the point and yields to a floor above the water", () => {
        vi.stubGlobal("game", { i18n });
        // The region's bottom is the lowest cell of its whole patch; the pit floor at -15 is what is actually under this point.
        const deepBand = { ...pool, bed: -25 };
        expect(probeText(floors, [deepBand], { x: 600, y: 0 }, null, "ft")!.text).toBe("-10 ft · probeDepth:5");
        const shelf = { region: floor("upper", -5, 300, Infinity), floor: -5 };
        expect(probeText([...floors, shelf], [pool], { x: 600, y: 0 }, null, "ft")).toEqual({ text: "-5 ft", water: false });
    });

    it("shows only the absolute height without a reference, and nothing off the floors", () => {
        vi.stubGlobal("game", { i18n });
        expect(probeText(floors, [], { x: 400, y: 0 }, null, "ft")!.text).toBe("-15 ft");
        expect(probeText([], [], { x: 400, y: 0 }, null, "ft")).toBeNull();
    });
});
