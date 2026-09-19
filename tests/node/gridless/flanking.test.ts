import { Polygon, Rectangle } from "@pixi/math";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activateFlankingGuide, sampleFlankingSectors } from "../../../src/rulesets/sf2e/gridless/flanking.js";
import { activateTokenGeometry } from "../../../src/rulesets/sf2e/gridless/tokens.js";
import { hexAt, hexCentre } from "../../../src/rulesets/sf2e/gridless/hex.js";

afterEach(() => vi.unstubAllGlobals());

describe("filled flanking direction sectors", () => {
    const center = { x: 0, y: 0 };
    const inReach = (x: number, y: number) => Math.hypot(x, y) <= 100;

    it("fills valid directions toward the center without marking the wrong side or out-of-reach space", () => {
        const bands = sampleFlankingSectors(center, 150, inReach, (x) => x < 0).map(points => new Polygon(points));
        expect(bands.some(band => band.contains(-95, 2))).toBe(true);
        expect(bands.some(band => band.contains(95, 2))).toBe(false);
        expect(bands.some(band => band.contains(-105, 2))).toBe(false);
        expect(bands.some(band => band.contains(-50, 2))).toBe(true);
    });

    it("omits obstructed positions and shows nothing without an eligible flanking position", () => {
        const bands = sampleFlankingSectors(center, 150, inReach, (x, y) => x < 0 && y < -20).map(points => new Polygon(points));
        expect(bands.some(band => band.contains(-67, -67))).toBe(true);
        expect(bands.some(band => band.contains(-95, 2))).toBe(false);
        expect(bands.some(band => band.contains(-5, -5))).toBe(true);
        expect(sampleFlankingSectors(center, 150, inReach, () => false)).toEqual([]);
    });
});

function guideFixture(width = 1, wallX?: number) {
    const callbacks: Record<string, (...args: unknown[]) => void> = {};
    let frame: (() => void) | undefined;
    let mode = "hex";
    const drawn: number[][] = [];
    const edge = { type: "wall", move: 1, direction: 0, a: { x: wallX ?? 0, y: 0 }, b: { x: wallX ?? 0, y: 1000 } };
    const scene = { regions: [], dimensions: { size: 100, distance: 5, distancePixels: 20,
        rect: { x: 0, y: 0, width: 1000, height: 1000 } },
        levels: new Map([["floor", { edges: new Map(wallX === undefined ? [] : [["wall", edge]]) }]]) };
    const creatures: NativeToken[] = [];
    class NativeToken {
        scene = scene;
        isVisible = true;
        layer = { placeables: creatures };
        actor: { size: string; system: object; dimensions: { height: number }; team: string; canAttack: boolean;
            flankable: boolean; gangUp: boolean; isOfType(): boolean; getReach(): number; isAllyOf(other: { team: string }): boolean };
        document: Readonly<{ x: number; y: number; hidden: boolean; elevation: number; isLinked: boolean; movementAction: string;
            _source: { x: number; y: number; width: number; height: number; depth: number; shape: number; elevation: number; level: string } }>;
        constructor(public id: string, x: number, y: number, size = 1, team = "friendly") {
            this.actor = { size: size > 1 ? "lg" : "med", system: {}, dimensions: { height: 5 }, team,
                canAttack: true, flankable: true, gangUp: false,
                isOfType: () => true, getReach: () => 5,
                isAllyOf: (other: { team: string }) => other !== this.actor && other.team === team };
            this.document = Object.freeze({ x, y, hidden: false, elevation: 0, isLinked: false,
                movementAction: "walk", _source: { x, y, width: size, height: size, depth: 1, shape: 4, elevation: 0, level: "floor" } });
        }
        get x() { return this.document.x; }
        get y() { return this.document.y; }
        get w() { return this.document._source.width * 100; }
        get h() { return this.document._source.height * 100; }
        get center() { return { x: this.x + this.w / 2, y: this.y + this.h / 2 }; }
        get mechanicalBounds() { return new Rectangle(this.x, this.y, this.w, this.h); }
        distanceTo(target: NativeToken) { return Math.hypot(this.center.x - target.center.x, this.center.y - target.center.y) / 20; }
        isAdjacentTo(target: NativeToken) { return this.distanceTo(target) <= 5; }
        canFlank(target: NativeToken, { reach = 5 } = {}) {
            return this.actor.canAttack && target.actor.flankable && !this.actor.isAllyOf(target.actor) && this.distanceTo(target) <= reach;
        }
        onOppositeSides(a: NativeToken, b: NativeToken, target: NativeToken) {
            const bounds = target.mechanicalBounds;
            const ax = a.document.x + a.mechanicalBounds.width / 2, bx = b.document.x + b.mechanicalBounds.width / 2;
            return ax <= bounds.left && bx >= bounds.right || bx <= bounds.left && ax >= bounds.right;
        }
        isFlanking(target: NativeToken, context = {}) {
            return this.canFlank(target, context) && this.layer.placeables.some(other =>
                other.actor.isAllyOf(this.actor) && other.canFlank(target)
                && (this.actor.gangUp || this.onOppositeSides(this, other, target)));
        }
        checkCollision(to: { x: number }, { origin }: { origin: { x: number } }) {
            return wallX !== undefined && (origin.x - wallX) * (to.x - wallX) < 0;
        }
    }
    class Graphics {
        parent: { removeChild(child: Graphics): void } | null = null;
        clear() { drawn.length = 0; return this; }
        beginFill() { return this; }
        lineStyle() { return this; }
        drawPolygon(points: number[]) { drawn.push(points); return this; }
        endFill() { return this; }
        destroy() { drawn.length = 0; }
    }
    const attacker = new NativeToken("attacker", 200, 400, width);
    const target = new NativeToken("target", 550, 450, 1, "enemy");
    const ally = new NativeToken("ally", 650, 450);
    creatures.push(attacker, target, ally);
    const user = { isGM: true, targets: new Set([target]) };
    vi.stubGlobal("PIXI", { Rectangle, Graphics });
    vi.stubGlobal("CONFIG", { Token: { objectClass: NativeToken } });
    vi.stubGlobal("game", { user, system: { id: "pf2e" },
        settings: { get: (_namespace: string, key: string) => key === "movementLattice" ? mode : true } });
    vi.stubGlobal("canvas", { ready: true, grid: { isGridless: true, size: 100, distance: 5 },
        dimensions: scene.dimensions, stage: { scale: { x: 1 } }, tokens: { controlled: [attacker], placeables: creatures },
        visibility: { tokenVision: true, testVisibility: () => false }, fog: { isPointExplored: (p: { x: number }) => p.x < 650 },
        interface: { addChild: (graphics: Graphics) => { graphics.parent = { removeChild() {} }; return graphics; } } });
    vi.stubGlobal("Hooks", { on: (name: string, callback: (...args: unknown[]) => void) => { callbacks[name] = callback; } });
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { frame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => { frame = undefined; });
    activateTokenGeometry();
    activateFlankingGuide();
    const render = () => { const pending = frame; frame = undefined; pending?.(); return drawn.map(points => [...points]); };
    return { attacker, target, ally, user, callbacks, render,
        continuous: () => { mode = "continuous"; callbacks.updateSetting?.({ key: "codex-foundry.movementLattice" }); } };
}

it("renders per-cell native flanking positions on the shared lattice, retaining continuous wedges", () => {
    const { attacker, target, callbacks, render, continuous } = guideFixture();
    const polygons = render();
    expect(polygons.length).toBeGreaterThan(0);
    expect(polygons.every(points => points.length === 12)).toBe(true);
    for (const points of polygons) {
        const centre = { x: points.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b) / 6,
            y: points.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b) / 6 };
        expect(centre.x).toBeLessThanOrEqual(550);
        expect(Math.hypot(centre.x - 600, centre.y - 500)).toBeLessThanOrEqual(100.001);
        const snapped = hexCentre(hexAt(centre, 10), 10);
        expect(Math.hypot(snapped.x - centre.x, snapped.y - centre.y)).toBeLessThan(0.001);
    }
    continuous();
    expect(render().every(points => points.length === 6)).toBe(true);
    target.isVisible = false;
    callbacks.refreshToken(target, { refreshVisibility: true });
    expect(render()).toEqual([]);
    expect(attacker.document.x).toBe(200);
});

it("checks whole-token wall clearance instead of accepting a clear centre ray", () => {
    const medium = guideFixture(1, 420);
    const point = hexCentre(hexAt({ x: 510, y: 500 }, 10), 10);
    expect(medium.render().some(points => new Polygon(points).contains(point.x, point.y))).toBe(true);
    const large = guideFixture(2, 420);
    const polygons = large.render();
    expect(polygons.some(points => new Polygon(points).contains(point.x, point.y))).toBe(false);
    expect(polygons.length).toBeGreaterThan(0);
});

it("preserves native Gang Up and immunity checks without exposing unknown cells", () => {
    const { attacker, target, ally, user, callbacks, render } = guideFixture();
    render();
    attacker.actor.gangUp = true;
    callbacks.updateActor();
    const ganged = render();
    expect(ganged.some(points => points.some((x, i) => i % 2 === 0 && x > 650))).toBe(true);
    user.isGM = false;
    callbacks.visibilityRefresh?.();
    expect(render().every(points => points.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b) / (points.length / 2) < 650)).toBe(true);
    target.actor.flankable = false;
    callbacks.updateActor();
    expect(render()).toEqual([]);
    target.actor.flankable = true;
    ally.actor.canAttack = false;
    callbacks.updateActor();
    expect(render()).toEqual([]);
});
