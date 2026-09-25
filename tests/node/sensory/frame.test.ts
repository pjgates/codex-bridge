import { afterEach, expect, it, vi } from "vitest";
import { collectEmitters } from "../../../src/canvas/sensory/geometry.js";
import { detectGlows } from "../../../src/canvas/sensory/frame.js";
import { selectedObservers } from "../../../src/canvas/sensory/observers.js";
import { definition, effect, owner, token } from "./fixtures.js";
import type { SensoryEmitter } from "../../../src/canvas/sensory/types.js";
afterEach(() => vi.unstubAllGlobals());
const above: SensoryEmitter = { documentUuid: "Token.upper", channel: "alpha", strength: 3, colour: "#aabbcc",
    position: { x: 150, y: 0, elevation: 20, levelId: "upper" }, rings: [] };
it("measures full diagonal and vertical distance on unrendered floors", () => {
    const views = selectedObservers([token("Token.viewer")], owner, () => definition());
    expect(detectGlows(views, [above], 10, () => true).map(glow => glow.direction)).toEqual([1]);
    for (const [x, elevation, expected] of [[150, 20.1, []], [0, 20, [1]], [0, 26, []], [0, -20, [-1]]] as const) {
        expect(detectGlows(views, [{ ...above, position: { ...above.position, x, elevation } }], 10, () => false)
            .map(glow => glow.direction)).toEqual(expected);
    }
    Object.assign(views[0].applications[0].definition.rules[1], { walls: true });
    expect(detectGlows(views, [above], 10, () => true)).toEqual([]);
});
it("uses capabilities and position from the same viewer and stabilizes cue selection", () => {
    const nearIneligible = token("Token.near", { rank: 1 });
    const farEligible = token("Token.far", { x: 1000 });
    expect(detectGlows(selectedObservers([nearIneligible, farEligible], owner, () => definition()), [above], 10, () => false)).toEqual([]);
    const a = token("Token.a", { elevation: 10 }), b = token("Token.b", { elevation: 30 });
    const target = { ...above, position: { ...above.position, x: 0 } };
    const views = selectedObservers([b, a], owner, () => definition());
    expect(detectGlows(views, [target], 10, () => false)[0]?.viewerUuid).toBe("Token.a");
    expect(detectGlows(views, [{ ...target, channel: "other" }], 10, () => false)).toEqual([]);
    expect(detectGlows(views.slice(1), [{ ...target, documentUuid: "Token.a" }], 10, () => false)).toEqual([]);
    expect(detectGlows(views, [{ ...target, documentUuid: "Token.a" }], 10, () => false)).toHaveLength(1);
});
it("extracts stored off-level geometry, strongest emission and clipped holes without placeables", () => {
    const source = token("Token.upper", { rank: 3, x: 100, elevation: 20, levelId: "upper" });
    source.actor.items.push(effect(1, "Item.fixed"));
    const fixed = definition(); Object.assign(fixed.rules[0], { strength: "fixed", fixed: 5, colour: "#abcdef", appearance: "light", light: { dim: 10 } });
    const lookup = (uuid: string) => uuid === "Item.fixed" ? fixed : definition();
    const tree = { polygon: null, isHole: false, children: [
        { polygon: { points: [0, 0, 100, 0, 100, 100, 0, 100] }, isHole: false, children: [
            { polygon: { points: [20, 20, 40, 20, 40, 40, 20, 40] }, isHole: true, children: [] } ] } ],
        polygons: [{}], intersectPolygon: () => tree };
    const tile = { uuid: "Tile.pool", hidden: false, elevation: -10, levels: new Set(["lower"]),
        flags: { "codex-foundry": { clipRegion: "pool", sensoryEffects: [{ effectUuid: "Item.signal", rank: 2 }] } },
        shape: { center: { x: 50, y: 50 }, polygonTree: tree } };
    vi.stubGlobal("canvas", { level: { id: "middle" }, inferLevelFromElevation: () => ({ id: "middle" }) });
    const scene = { tokens: [source], tiles: [tile], regions: new Map([["pool", { polygonTree: tree }]]),
        levels: new Map([["lower", { id: "lower", elevation: { bottom: -20, top: 0 } }]]) };
    const emissions = collectEmitters(scene, lookup);
    expect(emissions.map(emitter => [emitter.documentUuid, emitter.position.elevation, emitter.strength]))
        .toEqual([["Token.upper", 20, 5], ["Tile.pool", -10, 2]]);
    expect(emissions[0].colour).toBe("#abcdef");
    expect(emissions[0].light).toEqual({ dim: 10 });
    expect(emissions[1].rings.map(ring => ring.hole)).toEqual([false, true]);
    expect(emissions[1].position.levelId).toBe("lower");
    source.actor.items.reverse();
    expect(collectEmitters(scene, lookup)[0].strength).toBe(5);
    source.hidden = true; scene.regions.clear();
    expect(collectEmitters(scene, lookup)).toEqual([]);
});

it("keeps channel rank, range and wall rules independent within one Effect", () => {
    const shared = { rules: [
        { key: "CodexPerceiveSignal" as const, channel: "alpha", minRank: 1, range: 5, walls: false },
        { key: "CodexPerceiveSignal" as const, channel: "beta", minRank: 3, range: 100, walls: true },
    ] };
    const viewer = token("viewer", { rank: 2 });
    const targets = [above, { ...above, channel: "beta" }];
    expect(detectGlows(selectedObservers([viewer], owner, () => shared), targets, 10, () => false)).toEqual([]);
    viewer.actor.items[0].badge.value = 3;
    expect(detectGlows(selectedObservers([viewer], owner, () => shared), targets, 10, () => false)
        .map(glow => glow.emitter.channel)).toEqual(["beta"]);
    expect(detectGlows(selectedObservers([viewer], owner, () => shared), targets, 10, () => true)).toEqual([]);
});
