import { afterEach, describe, expect, it, vi } from "vitest";
import { onStartTurn } from "../../../src/rulesets/sf2e/flying/reminder.js";
import { heightAbove, landingSurface } from "../../../src/rulesets/sf2e/flying/height.js";

afterEach(() => vi.unstubAllGlobals());

const floor = (elevation: number, minX: number, maxX: number) => ({
    polygonTree: { testPoint: (p: { x: number }) => p.x >= minX && p.x < maxX },
    behaviors: [{ type: "map-workshop-importer.setElevation", disabled: false, system: { elevation } }],
});
const scene = { regions: [floor(0, 0, 100), floor(-15, 100, 200)], levels: { get: () => ({ elevation: { base: -20 } }) } };

describe("height above the surface", () => {
    it("measures against the floor below across levels, else the level base", () => {
        expect(heightAbove(5, -15, -20)).toBe(20);
        expect(heightAbove(5, null, -20)).toBe(25);
    });

    it("finds the floor under the token centre", () => {
        const token = { x: 0, y: 0, elevation: 5, parent: scene, level: "upper", object: { center: { x: 150, y: 0 } } };
        expect(landingSurface(token)).toEqual({ surface: -15, base: -20 });
        expect(landingSurface({ ...token, object: null, x: 300 })).toEqual({ surface: null, base: -20 });
    });
});

describe("turn-start reminder", () => {
    function setup() {
        const created: { content: string }[] = [];
        vi.stubGlobal("game", { user: { id: "me" }, i18n: { format: (_key: string, d: Record<string, string>) => `${d.name}|${d.height}|${d.units}` } });
        vi.stubGlobal("canvas", { grid: { units: "ft" } });
        vi.stubGlobal("ChatMessage", { create: (data: { content: string }) => { created.push(data); return Promise.resolve(); }, getSpeaker: () => ({}) });
        const actor = { items: [{ type: "effect", system: { slug: "codex-flying" }, delete: vi.fn() }], getActiveTokens: () => [], createEmbeddedDocuments: vi.fn() };
        const token = { name: "Wyrm", x: 0, y: 0, elevation: 5, parent: scene, level: "upper", object: { center: { x: 150, y: 0 } } };
        return { created, actor, token };
    }

    it("posts the height above the surface below for a flying combatant", () => {
        const { created, actor, token } = setup();
        onStartTurn({ actor, token }, {}, "me");
        expect(created[0].content).toBe("<p>Wyrm|20|ft</p>");
    });

    it("stays quiet for grounded actors and on other clients", () => {
        const { created, actor, token } = setup();
        onStartTurn({ actor, token }, {}, "other");
        onStartTurn({ actor: { ...actor, items: [] }, token }, {}, "me");
        expect(created).toHaveLength(0);
    });
});
