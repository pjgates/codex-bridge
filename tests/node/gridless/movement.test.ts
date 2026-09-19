import { Color } from "@pixi/color";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activateMovementRings, movementBudget, registerMovementPreviewKeybind } from "../../../src/rulesets/sf2e/gridless/movement.js";
import { dragPaths } from "../../../src/rulesets/sf2e/gridless/routing.js";
import type { AttackItem, PreparedAttack } from "../../../src/rulesets/sf2e/gridless/reach.js";
import { registerGridlessSetting } from "../../../src/rulesets/sf2e/gridless/settings.js";

interface PreviewBinding { onDown(): boolean; onUp(): boolean }
let releasePreview: (() => boolean) | undefined;
beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout"] }));
afterEach(async () => {
    releasePreview?.(); releasePreview = undefined;
    await vi.runAllTimersAsync();
    vi.useRealTimers(); vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("movement action budget", () => {
    it("starts with one Stride and advances only after its distance is exceeded", () => {
        expect(movementBudget(25, 0)).toEqual({ actions: 1, remaining: 25 });
        expect(movementBudget(25, 10)).toEqual({ actions: 1, remaining: 15 });
        expect(movementBudget(25, 25)).toEqual({ actions: 1, remaining: 0 });
        expect(movementBudget(25, 26)).toEqual({ actions: 2, remaining: 24 });
        expect(movementBudget(25, 51)).toEqual({ actions: 3, remaining: 24 });
    });

    it("uses current Speed without resetting distance already spent", () => {
        expect(movementBudget(30, 20)).toEqual({ actions: 1, remaining: 10 });
    });
});

function setupMovementCanvas() {
    const callbacks: Record<string, (...args: unknown[]) => void> = {};
    class Container {
        children: Container[] = [];
        visible = true;
        position = { x: 0, y: 0, set(x: number, y: number) { this.x = x; this.y = y; } };
        scale = { set() {} };
        addChild(child: Container) { this.children.push(child); return child; }
        removeChild(child: Container) { this.children.splice(this.children.indexOf(child), 1); }
        destroy() { this.children = []; }
    }
    class Graphics extends Container {
        circles: { radius: number; fillAlpha: number; color: number }[] = [];
        polygons: number[][] = [];
        paintedPolygons: { points: number[]; stroke: number; fill: number; alpha: number }[] = [];
        fillColor = 0;
        fillAlpha = 0;
        color = 0;
        get radii() {
            const radii = this.circles.map(circle => circle.radius);
            if (this.polygons.length) radii.push(Math.max(...this.polygons.flatMap(points =>
                points.filter((_point, index) => index % 2 === 0).map((x, index) => Math.hypot(x, points[index * 2 + 1])))));
            return radii;
        }
        clear() { this.circles = []; this.polygons = []; this.paintedPolygons = []; this.fillAlpha = 0; return this; }
        lineStyle(_width = 0, color = 0) { this.color = color; return this; }
        beginFill(color: number, alpha = 1) { this.fillColor = color; this.fillAlpha = alpha; return this; }
        endFill() { this.fillAlpha = 0; return this; }
        drawCircle(_x: number, _y: number, radius: number) {
            this.circles.push({ radius, fillAlpha: this.fillAlpha, color: this.color }); return this;
        }
        drawPolygon(points: number[]) {
            this.polygons.push(points);
            this.paintedPolygons.push({ points, stroke: this.color, fill: this.fillColor, alpha: this.fillAlpha });
            return this;
        }
    }
    class Text extends Container {
        anchor = { set() {} };
        constructor(public text: string, public style: { fontFamily?: string }) { super(); }
    }
    const reaches = new Map<AttackItem, number>();
    const scene = { regions: [], levels: new Map([["floor", { edges: new Map() }]]),
        dimensions: { size: 100, distance: 5, distancePixels: 20, rect: { x: -1000, y: -1000, width: 2000, height: 2000 } } };
    const makeToken = (id: string) => {
        const token = {
            id, controlled: false, isDragged: false, center: { x: 100, y: 200 }, w: 100, h: 100, movementAnimationPromise: null as Promise<void> | null,
            scene,
            actor: {
                system: { actions: [] as PreparedAttack[], movement: { speeds: { land: { value: 25 } } } },
                getReach: ({ weapon }: { weapon: AttackItem }) => reaches.get(weapon) ?? 5,
            },
            document: {
                id, parent: { id: "scene" }, movementHistory: [{ x: 0, y: 0, cost: 0 }],
                _source: { x: 100, y: 200, width: 1, height: 1, depth: 1, shape: 4, elevation: 0, level: "floor" },
                movementAction: "walk",
                getCenterPoint(point: { x: number; y: number }) { return point; },
            },
            renderFlags: { set: (_options?: unknown): void => { callbacks.refreshToken?.(token, {}); } },
            createTerrainMovementPath(points: unknown[]) { return points; },
            measureMovementPath(points: { x: number; y: number; cost?: number; terrain?: { difficulty: number } }[]) {
                return { cost: points.reduce((sum, point, index) => sum + (point.cost
                    ?? (index ? Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) / 20 * (point.terrain?.difficulty ?? 1) : 0)), 0) };
            }
        };
        return token;
    };
    const token = makeToken("token");
    const other = makeToken("other");
    token.controlled = true;
    type MovementTokenFixture = typeof token;
    const controlled = [token];
    class Ruler { constructor(public token: MovementTokenFixture) {} refresh(_data: unknown) {} clear() {} }
    const combatant: { tokenId: string; sceneId: string | null; token: MovementTokenFixture["document"] } = {
        tokenId: "token", sceneId: "scene", token: token.document,
    };
    const combat = { started: true, combatant };
    const bindings = new Map<string, PreviewBinding>();
    const interfaceLayer = new Container();
    vi.stubGlobal("PIXI", { Container, Graphics, Text, Color });
    vi.stubGlobal("ClipperLib", {
        PolyType: { ptSubject: 0 }, ClipType: { ctUnion: 1 }, PolyFillType: { pftNonZero: 1 },
        Clipper: class {
            paths: unknown[] = [];
            static Orientation() { return true; }
            AddPaths(paths: unknown[]) { this.paths = paths; }
            Execute(_operation: number, result: unknown[]) { result.push(...this.paths); }
        },
    });
    vi.stubGlobal("CONFIG", { Token: { rulerClass: Ruler, movement: { actions: { walk: { walls: "move" } } } } });
    vi.stubGlobal("Hooks", { on(name: string, callback: (...args: unknown[]) => void) { callbacks[name] = callback; } });
    const settingValues: Record<string, unknown> = { gridlessCombat: true };
    const registeredSettings = new Map<string, { default: unknown; onChange?: (value: unknown) => void }>();
    vi.stubGlobal("game", { user: { id: "user", isGM: true }, combat, system: { id: "pf2e" },
        settings: {
            register: (_namespace: string, key: string, config: { default: unknown }) => registeredSettings.set(key, config),
            get: (_namespace: string, key: string) => settingValues[key] ?? registeredSettings.get(key)?.default ?? true,
        },
        keybindings: { register: (_namespace: string, key: string, binding: PreviewBinding) => bindings.set(key, binding) },
        i18n: {
            localize: (key: string) => key.endsWith(".reach") ? "Reach" : "Range",
            format: (_key: string, data: { distance: string; attacks?: string }) => data.attacks ? `${data.attacks}: ${data.distance} ft` : `${data.distance} ft left`,
        } });
    vi.stubGlobal("canvas", { ready: true, scene: { id: "scene" }, grid: { isGridless: true, units: "ft", size: 100 },
        dimensions: { distancePixels: 20 }, stage: { scale: { x: 1 } }, interface: interfaceLayer, tokens: { controlled } });
    registerGridlessSetting();
    registerMovementPreviewKeybind();
    const binding = bindings.get("previewMovement")!;
    releasePreview = binding.onUp;
    activateMovementRings();
    const visibleGraphics = () => interfaceLayer.children.flatMap(container => container.children).filter((child): child is Graphics => child instanceof Graphics && child.visible);
    const isBudget = (graphic: Graphics) => (graphic as Graphics & { name?: string }).name === "codex-movement-budget";
    const radii = async () => {
        await vi.runAllTimersAsync();
        return visibleGraphics().filter(isBudget).flatMap(graphic => graphic.radii);
    };
    const attackCircles = () => visibleGraphics().filter(graphic => !isBudget(graphic)).flatMap(graphic => graphic.circles);
    const select = (next: MovementTokenFixture[]) => {
        for (const previous of [...controlled]) {
            if (next.includes(previous)) continue;
            controlled.splice(controlled.indexOf(previous), 1); previous.controlled = false;
            callbacks.controlToken(previous, false);
        }
        for (const selected of next) {
            if (controlled.includes(selected)) continue;
            controlled.push(selected); selected.controlled = true;
            callbacks.controlToken(selected, true);
        }
    };
    return { token, other, callbacks, combat, combatant, binding, radii, attackCircles, reaches,
        polygons: () => visibleGraphics().flatMap(graphic => graphic.polygons),
        debugHexes: () => visibleGraphics().flatMap(graphic => graphic.paintedPolygons).filter(p => p.alpha > 0 && p.points.length === 12),
        frontier: () => {
            const layer = visibleGraphics().find(graphic => (graphic as Graphics & { name?: string }).name === "codex-movement-frontier");
            return { cells: layer?.paintedPolygons ?? [], icons: (layer?.children ?? []).filter((child): child is Text => child instanceof Text).map(icon => icon.text) };
        },
        setSetting: (key: string, value: unknown) => { settingValues[key] = value; registeredSettings.get(key)?.onChange?.(value); },
        budgetPosition: () => visibleGraphics().find(isBudget)?.position,
        budgetOutline: () => {
            const graphic = visibleGraphics().find(isBudget);
            return graphic && { x: graphic.position.x, y: graphic.position.y, polygons: graphic.polygons.map(p => [...p]) };
        }, select, settings: settingValues, ruler: new Ruler(token) };
}

it("retains the movement budget during hold preview, drag cancellation, and turn changes", async () => {
    const { token, callbacks, combat, combatant, binding, radii, ruler, select } = setupMovementCanvas();
    expect(await radii()).toEqual([]);
    binding.onDown();
    expect(await radii()).toEqual([expect.closeTo(500, 1)]);
    token.document.movementHistory.push({ x: 200, y: 0, cost: 10 });
    token.center = { x: 200, y: 0 };
    callbacks.refreshToken(token, {});
    expect(await radii()).toEqual([expect.closeTo(300, 1)]);
    combatant.sceneId = null;
    callbacks.refreshToken(token, {});
    expect(await radii()).toEqual([expect.closeTo(300, 1)]);
    const planned = { history: token.document.movementHistory, foundPath: [{ x: 520, y: 0, cost: 16 }] };
    ruler.refresh({ passedWaypoints: token.document.movementHistory, pendingWaypoints: [], plannedMovement: { user: planned } });
    expect(await radii()).toEqual([expect.closeTo(480, 1)]);
    ruler.refresh({ passedWaypoints: token.document.movementHistory, pendingWaypoints: [], plannedMovement: {} });
    expect(await radii()).toEqual([expect.closeTo(300, 1)]);
    token.document.movementHistory = [];
    callbacks.updateCombat(combat, {});
    expect(await radii()).toEqual([expect.closeTo(500, 1)]);
    token.document.movementHistory = [{ x: 0, y: 0, cost: 0 }, { x: 200, y: 0, cost: 10 }];
    callbacks.refreshToken(token, {});
    expect(await radii()).toEqual([expect.closeTo(300, 1)]);
    vi.stubGlobal("game", { ...game, combat: null });
    callbacks.deleteCombat?.(combat, {});
    expect(await radii()).toEqual([expect.closeTo(500, 1)]);
    select([]);
    expect(await radii()).toEqual([]);
});

it("draws the simple circle from the remaining distance when selected", async () => {
    const { binding, radii, ruler, settings } = setupMovementCanvas();
    settings.movementPreview = "circle";
    binding.onDown();
    expect(await radii()).toEqual([expect.closeTo(500, 1)]);
    const planned = { history: [], foundPath: [{ x: 520, y: 0, cost: 16 }] };
    ruler.refresh({ passedWaypoints: [], pendingWaypoints: [], plannedMovement: { user: planned } });
    expect(await radii()).toEqual([expect.closeTo(180, 1)]);
});

it("hides the movement overlay without touching attack guides when disabled", async () => {
    const { token, binding, callbacks, attackCircles, reaches, radii, settings } = setupMovementCanvas();
    settings.movementPreview = "off";
    binding.onDown();
    expect(await radii()).toEqual([]);
    const sword = { name: "Sword", isMelee: true, range: null };
    reaches.set(sword, 5);
    token.actor.system.actions = [{ label: "Sword", ready: true, item: sword }];
    callbacks.refreshToken(token, {});
    expect(attackCircles().map(circle => circle.radius)).toEqual([100]);
});

it("tracks the dragged waypoint before the routed plan lands", async () => {
    const { binding, radii, ruler, budgetPosition, settings } = setupMovementCanvas();
    settings.movementPreview = "circle";
    binding.onDown();
    await radii();
    ruler.refresh({ passedWaypoints: [], pendingWaypoints: [{ x: 300, y: 200, cost: 10 }], plannedMovement: {} });
    expect(budgetPosition()?.x).toBe(300);
    expect(await radii()).toEqual([expect.closeTo(300, 1)]);
    ruler.refresh({ passedWaypoints: [], pendingWaypoints: [{ x: 500, y: 200, cost: 20 }], plannedMovement: {} });
    expect(budgetPosition()?.x).toBe(500);
    expect(await radii()).toEqual([expect.closeTo(100, 1)]);
});

it("clears a finished drag on an idle ruler refresh without requiring ruler.clear", async () => {
    const { token, ruler, radii, budgetPosition, settings, binding } = setupMovementCanvas();
    settings.movementPreview = "circle";
    settings.movementLattice = "hex";
    token.isDragged = true;
    dragPaths.set(token, [{ x: 700, y: 200, cost: 30 }]);
    const idle = { passedWaypoints: token.document.movementHistory, pendingWaypoints: [], plannedMovement: {} };
    ruler.refresh(idle);
    expect(budgetPosition()?.x).toBe(700);
    expect(await radii()).toEqual([expect.closeTo(400, 1)]);
    token.isDragged = false;
    ruler.refresh(idle);
    expect(await radii()).toEqual([]);
    binding.onDown();
    ruler.refresh(idle);
    expect(budgetPosition()?.x).toBe(100);
    expect(await radii()).toEqual([expect.closeTo(500, 1)]);
});

it("keeps pending movement visible after drop and clears it when the animation finishes", async () => {
    const { token, ruler, radii, budgetPosition, settings } = setupMovementCanvas();
    settings.movementPreview = "circle";
    settings.movementLattice = "hex";
    token.isDragged = true;
    dragPaths.set(token, [{ x: 300, y: 200, cost: 10 }]);
    ruler.refresh({ passedWaypoints: [], pendingWaypoints: [], plannedMovement: {} });
    expect(await radii()).toEqual([expect.closeTo(300, 1)]);
    token.isDragged = false;
    token.movementAnimationPromise = Promise.resolve();
    ruler.refresh({ passedWaypoints: [], pendingWaypoints: [{ x: 500, y: 200, cost: 20 }], plannedMovement: {} });
    expect(budgetPosition()?.x).toBe(500);
    expect(await radii()).toEqual([expect.closeTo(100, 1)]);
    token.movementAnimationPromise = null;
    ruler.refresh({ passedWaypoints: [{ x: 500, y: 200, cost: 20 }], pendingWaypoints: [], plannedMovement: {} });
    expect(await radii()).toEqual([]);
});

it("shows only one selected token while moving or holding the shortcut", async () => {
    const { token, other, callbacks, binding, radii, ruler, select } = setupMovementCanvas();
    expect(await radii()).toEqual([]);
    const planned = { history: token.document.movementHistory, foundPath: [{ x: 200, y: 0, cost: 10 }] };
    ruler.refresh({ passedWaypoints: [], pendingWaypoints: [], plannedMovement: { user: planned } });
    expect(await radii()).toEqual([expect.closeTo(300, 1)]);
    ruler.clear();
    expect(await radii()).toEqual([]);
    token.movementAnimationPromise = Promise.resolve();
    callbacks.refreshToken(token, {});
    expect(await radii()).toEqual([expect.closeTo(500, 1)]);
    token.movementAnimationPromise = null;
    callbacks.refreshToken(token, {});
    expect(await radii()).toEqual([]);
    binding.onDown();
    expect(await radii()).toEqual([expect.closeTo(500, 1)]);
    select([token, other]);
    expect(await radii()).toEqual([]);
    ruler.refresh({ passedWaypoints: [], pendingWaypoints: [], plannedMovement: { user: planned } });
    expect(await radii()).toEqual([]);
    ruler.clear();
    select([token]);
    expect(await radii()).toEqual([expect.closeTo(500, 1)]);
    binding.onUp();
    expect(await radii()).toEqual([]);
    select([]);
    binding.onDown();
    expect(await radii()).toEqual([]);
});

it("renders filled melee reach and unfilled ranged distance without requiring land Speed", async () => {
    const { token, other, binding, callbacks, attackCircles, reaches, radii, select } = setupMovementCanvas();
    const sword = { name: "Sword", isMelee: true, range: null };
    const tail = { name: "Tail", isMelee: true, range: null };
    const rifle = { name: "Rifle", isMelee: false, range: { increment: 60, max: 360 } };
    reaches.set(sword, 5); reaches.set(tail, 10);
    token.actor.system.actions = [
        { label: "Sword", ready: true, item: sword },
        { label: "Tail", ready: true, item: tail },
        { label: "Rifle", ready: true, item: rifle },
    ];
    binding.onDown();
    expect(attackCircles().map(circle => circle.radius)).toEqual([1200, 200, 100]);
    expect(attackCircles()[0].fillAlpha).toBe(0);
    expect(attackCircles().slice(1).every(circle => circle.fillAlpha > 0 && circle.fillAlpha < 1)).toBe(true);
    expect(new Set(attackCircles().map(circle => circle.color)).size).toBe(3);
    token.actor.system.movement.speeds.land.value = 0;
    callbacks.refreshToken(token, {});
    expect(await radii()).toEqual([]);
    expect(attackCircles().map(circle => circle.radius)).toEqual([1200, 200, 100]);
    token.actor.system.actions = [{ label: "Rifle", ready: true, item: rifle }];
    callbacks.refreshToken(token, {});
    expect(attackCircles().map(circle => circle.radius)).toEqual([1200]);
    select([token, other]);
    expect(attackCircles()).toEqual([]);
});

it("anchors the movement area at the committed destination throughout native animation", async () => {
    const { token, callbacks, radii, budgetPosition } = setupMovementCanvas();
    token.document._source.x = 600;
    token.movementAnimationPromise = Promise.resolve();
    token.center = { x: 300, y: 200 };
    callbacks.refreshToken(token, {});
    await radii();
    expect(budgetPosition()?.x).toBe(600);
    token.center = { x: 320, y: 200 };
    callbacks.refreshToken(token, {});
    await radii();
    expect(budgetPosition()?.x).toBe(600);
});

it("finishes outlines during continuous dragging without moving the previous wall-clipped geometry", async () => {
    const { binding, radii, ruler, budgetOutline } = setupMovementCanvas();
    binding.onDown();
    await radii();
    const previous = budgetOutline();
    let time = 0;
    vi.spyOn(performance, "now").mockImplementation(() => time += 10);
    const move = (x: number) => ruler.refresh({ passedWaypoints: [], pendingWaypoints: [],
        plannedMovement: { user: { history: [], foundPath: [{ x, y: 200, cost: 10 }] } } });
    move(300);
    expect(budgetOutline()).toEqual(previous);
    let completedWhileMoving = false;
    for (let i = 0; i < 30; i++) {
        move(310 + i);
        await vi.advanceTimersToNextTimerAsync();
        completedWhileMoving ||= budgetOutline()?.x !== previous?.x;
    }
    expect(completedWhileMoving).toBe(true);
    await radii();
    expect(budgetOutline()?.x).toBe(339);
});

it("keeps normal hex movement free of cell overlays", async () => {
    const { token, settings, binding, polygons, radii } = setupMovementCanvas();
    settings.movementLattice = "hex";
    binding.onDown();
    token.renderFlags.set({ refreshRuler: true });
    await radii();
    expect(polygons().filter(polygon => polygon.length === 12)).toEqual([]);
});

it("shows white normal-cost cells and blue aquatic fills only while local debugging is enabled", async () => {
    const { token, settings, setSetting, debugHexes, radii, select } = setupMovementCanvas();
    settings.movementLattice = "hex";
    settings.movementPreview = "off";
    Object.assign(token.scene, { regions: [{
        hidden: false, includedInLevel: () => true,
        testPoint: (point: { x: number; elevation: number }) => point.x >= 200 && point.elevation === 0,
        polygons: [{ points: [200, -1000, 1000, -1000, 1000, 1000, 200, 1000] }],
        behaviors: [
            { type: "environment", disabled: false, system: { mode: "add", environmentTypes: new Set(["aquatic"]), _getTerrainEffects: () => [] } },
            { disabled: false, system: { _getTerrainEffects: () => [{ difficulty: 2 }] } },
        ],
    }] });
    expect(debugHexes()).toEqual([]);
    setSetting("movementDebug", true);
    await radii();
    const cells = debugHexes();
    const plain = cells.find(cell => cell.points[0] < 180);
    const water = cells.find(cell => cell.points[0] > 220);
    expect(plain?.stroke).toBe(0xffffff);
    expect(plain?.fill).toBe(0xffffff);
    expect(water?.fill).toBe(0x3399ff);
    expect(water?.stroke).toBe(0xffbf47);
    expect(cells.every(cell => cell.alpha <= 0.15)).toBe(true);
    setSetting("movementDebug", false);
    await radii();
    expect(debugHexes()).toEqual([]);
    setSetting("movementDebug", true);
    await radii();
    select([]);
    expect(debugHexes()).toEqual([]);
});

it("paints a red rim with a climb icon along a ledge the token cannot walk up", async () => {
    const { token, settings, radii, frontier, binding } = setupMovementCanvas();
    settings.movementLattice = "hex";
    const floor = (elevation: number, points: number[]) => ({
        hidden: false, includedInLevel: () => true, testPoint: () => false, polygons: [{ points }],
        behaviors: [{ type: "map-workshop-importer.setElevation", disabled: false, system: { elevation, _getTerrainEffects: () => [] } }],
    });
    Object.assign(token.scene, { regions: [floor(0, [-1000, -1000, 300, -1000, 300, 1000, -1000, 1000]), floor(7.5, [300, -1000, 1000, -1000, 1000, 1000, 300, 1000])] });
    token.renderFlags.set({ refreshRuler: true });
    expect(frontier().cells).toEqual([]);
    binding.onDown();
    await radii();
    const { cells, icons } = frontier();
    expect(cells.length).toBeGreaterThan(20);
    expect(cells.every(cell => cell.fill === 0xff4d4d && cell.alpha > 0)).toBe(true);
    expect(cells.every(cell => cell.points[0] > 280)).toBe(true);
    expect(icons).toEqual(["\ue5a9"]);
    binding.onUp();
    await radii();
    expect(frontier().cells).toEqual([]);
});
