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
const i18n = { format: (key: string, data: Record<string, string>) => `${key.split(".").pop()}:${data.distance ?? ""}` };

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
        expect(probeText(floors, { x: 400, y: 0 }, { document: { elevation: 5 } }, "ft")).toBe("-15 ft · probeBelow:20");
        expect(probeText(floors, { x: 200, y: 0 }, { document: { elevation: 5 } }, "ft")).toBe("+10 ft · probeAbove:5");
        expect(probeText(floors, { x: 50, y: 0 }, { document: { elevation: 0 } }, "ft")).toBe("0 ft · probeLevel:0");
    });

    it("shows only the absolute height without a reference, and nothing off the floors", () => {
        vi.stubGlobal("game", { i18n });
        expect(probeText(floors, { x: 400, y: 0 }, null, "ft")).toBe("-15 ft");
        expect(probeText([], { x: 400, y: 0 }, null, "ft")).toBeNull();
    });
});
