import { afterEach, expect, it, vi } from "vitest";
import { movementCellStatus } from "../../../src/rulesets/sf2e/movement/preview.js";
import type { MovementToken, Waypoint } from "../../../src/rulesets/sf2e/movement/transitions.js";

afterEach(() => vi.unstubAllGlobals());

function fixture(checks = true) {
    vi.stubGlobal("game", { settings: { get: (_namespace: string, key: string) =>
        key === "terrainCheckOverride" ? "" : key === "movementOutcomeMode" ? "apply" :
            ["climbOutsideCombat", "swimOutsideCombat"].includes(key) ? checks : true } });
    const floor = (id: string, left: number, right: number, elevation: number, deck = false) => ({
        id, levels: new Set(["level"]),
        behaviors: [
            { type: "codex-foundry.setElevation", disabled: false, system: { elevation } },
            { type: "codex-foundry.surfaceGeometry", disabled: false,
                system: { extent: deck ? "finite" : "solid", underside: deck ? elevation - 2 : null, blocksSight: true, blocksLight: true } },
        ],
        polygonTree: { polygon: { points: [left, -50, right, -50, right, 50, left, 50] },
            testPoint: (point: { x: number }) => point.x >= left && point.x < right },
    });
    const origin: Waypoint = { x: 0, y: 0, elevation: 0, level: "level", action: "walk" };
    const scene = { id: "scene", regions: [floor("start", -100, 100, 0)] };
    const token = { uuid: "token", actor: { items: [] }, _source: origin, parent: scene,
        getMovementOrigin: (point: Waypoint) => point } as unknown as MovementToken;
    return { token, origin, scene, floor, destination: { ...origin, x: 200 } };
}

it.each([true, false])("shows climb and swim terrain with checks enabled=%s", checks => {
    const { token, origin, destination, scene, floor } = fixture(checks);
    scene.regions.push(floor("higher", 100, 300, 20));
    expect(movementCellStatus(token, origin, destination)).toMatchObject({ kind: "climb" });
    scene.regions = [floor("start", -100, 100, 0), {
        ...floor("water", 100, 300, 0), elevation: { top: 0, bottom: -20 },
        behaviors: [{ type: "codex-foundry.water", disabled: false, system: {} }],
    } as never];
    expect(movementCellStatus(token, origin, destination)).toMatchObject({ kind: "swim" });
});

it("distinguishes a known fall, an unknown landing and missing face geometry", () => {
    const { token, origin, destination, scene, floor } = fixture();
    expect(movementCellStatus(token, origin, destination)).toMatchObject({ kind: "unknown", label: "Landing unknown" });
    scene.regions[0] = floor("start", -100, 100, 0, true);
    scene.regions.push(floor("lower", 100, 300, -20));
    expect(movementCellStatus(token, origin, destination)).toMatchObject({ kind: "fall", label: "Fall ↓ 20 ft" });
    scene.regions[0].behaviors.pop();
    expect(movementCellStatus(token, origin, destination)).toMatchObject({ kind: "ruling", label: "GM ruling needed" });
});

it("uses the live preview elevation and flight mode without changing token state", () => {
    const { token, origin, destination, scene, floor } = fixture();
    scene.regions.push(floor("lower", 100, 300, -20));
    expect(movementCellStatus(token, { ...origin, x: 150, elevation: -20 }, { ...destination, elevation: -20 })).toMatchObject({ kind: "walk" });
    token.actor!.items = [{ type: "effect", system: { slug: "codex-flying" } }] as never;
    expect(movementCellStatus(token, { ...origin, action: "fly" }, { ...destination, action: "fly" })).toMatchObject({ kind: "fly" });
    expect(token._source).toEqual(origin);
});

it("does not flag ordinary unmapped scenes as missing landings", () => {
    const { token, origin, destination, scene } = fixture();
    scene.regions = [];
    expect(movementCellStatus(token, origin, destination)).toMatchObject({ kind: "walk" });
});
