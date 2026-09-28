import { Color } from "@pixi/color";
import { Polygon } from "@pixi/math";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activateMovementRings, movementBudget, registerMovementPreviewKeybind } from "../../../src/rulesets/sf2e/gridless/movement.js";
import { dragPaths } from "../../../src/rulesets/sf2e/gridless/routing.js";
import type { AttackItem, PreparedAttack } from "../../../src/rulesets/sf2e/gridless/reach.js";
import { registerGridlessSetting } from "../../../src/rulesets/sf2e/gridless/settings.js";
import { registerMovementSettings } from "../../../src/rulesets/sf2e/movement/settings.js";

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
        paintedPolygons: { points: number[]; stroke: number; width: number; strokeAlpha: number; fill: number; alpha: number }[] = [];
        paintedSegments: { from: number[]; to: number[]; stroke: number; width: number; fillAlpha: number }[] = [];
        pen = [0, 0];
        fillColor = 0;
        fillAlpha = 0;
        color = 0;
        lineWidth = 0;
        lineAlpha = 1;
        get radii() {
            const radii = this.circles.map(circle => circle.radius);
            if (this.polygons.length) radii.push(Math.max(...this.polygons.flatMap(points =>
                points.filter((_point, index) => index % 2 === 0).map((x, index) => Math.hypot(x, points[index * 2 + 1])))));
            return radii;
        }
        clear() { this.circles = []; this.polygons = []; this.paintedPolygons = []; this.paintedSegments = []; this.fillAlpha = 0; return this; }
        moveTo(x: number, y: number) { this.pen = [x, y]; return this; }
        lineTo(x: number, y: number) {
            this.paintedSegments.push({from: this.pen, to: [x, y], stroke: this.color, width: this.lineWidth, fillAlpha: this.fillAlpha});
            this.pen = [x, y]; return this;
        }
        lineStyle(width = 0, color = 0, alpha = 1) { this.lineWidth = width; this.color = color; this.lineAlpha = alpha; return this; }
        beginFill(color: number, alpha = 1) { this.fillColor = color; this.fillAlpha = alpha; return this; }
        endFill() { this.fillAlpha = 0; return this; }
        drawCircle(_x: number, _y: number, radius: number) {
            this.circles.push({ radius, fillAlpha: this.fillAlpha, color: this.color }); return this;
        }
        drawPolygon(points: number[]) {
            this.polygons.push(points);
            this.paintedPolygons.push({ points, stroke: this.color, width: this.lineWidth, strokeAlpha: this.lineAlpha,
                fill: this.fillColor, alpha: this.fillAlpha });
            return this;
        }
    }
    class Text extends Container {
        anchor = { set() {} };
        constructor(public text: string, public style: { fontFamily?: string }) { super(); }
    }
    class Sprite extends Container {
        anchor = { set() {} };
        width = 0; height = 0;
        src = "";
        texture = { valid: true, baseTexture: { once() {} } };
        static from(src: string) { const sprite = new Sprite(); sprite.src = src; return sprite; }
    }
    const reaches = new Map<AttackItem, number>();
    const scene = { regions: [], levels: new Map([["floor", { edges: new Map() }]]),
        dimensions: { size: 100, distance: 5, distancePixels: 20, rect: { x: -1000, y: -1000, width: 2000, height: 2000 } } };
    const makeToken = (id: string) => {
        const token = {
            id, controlled: false, isDragged: false, center: { x: 100, y: 200 }, w: 100, h: 100, movementAnimationPromise: null as Promise<void> | null,
            scene,
            actor: {
                uuid: `Actor.${id}`,
                items: [],
                system: { actions: [] as PreparedAttack[], movement: { speeds: { land: { value: 25 } } } },
                getReach: ({ weapon }: { weapon: AttackItem }) => reaches.get(weapon) ?? 5,
            },
            document: {
                id, uuid: id, parent: scene, actor: null as unknown,
                getMovementOrigin(point: { x: number; y: number }) { return { x: point.x + 50, y: point.y + 50 }; },
                movementHistory: [{ x: 0, y: 0, cost: 0 }],
                _source: { x: 100, y: 200, width: 1, height: 1, depth: 1, shape: 4, elevation: 0, level: "floor" },
                movementAction: "walk",
                movement: { origin: {x: 100, y: 200, width: 1, height: 1, depth: 1, shape: 4, elevation: 0, level: "floor"}, state: "completed" },
                getCenterPoint(point: { x: number; y: number }) { return point; },
                getOccupiedGridSpaceOffsets(_point?: unknown) { return [{ i: 2, j: 1 }]; },
            },
            renderFlags: { set: (_options?: unknown): void => { callbacks.refreshToken?.(token, {}); } },
            createTerrainMovementPath(points: unknown[]) { return points; },
            constrainMovementPath(points: { x: number; y: number }[]): [typeof points, boolean] { return [points, false]; },
            measureMovementPath(points: { x: number; y: number; cost?: number; terrain?: { difficulty: number } }[]) {
                return { cost: points.reduce((sum, point, index) => sum + (point.cost
                    ?? (index ? Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) / 20 * (point.terrain?.difficulty ?? 1) : 0)), 0) };
            }
        };
        token.document.actor = token.actor;
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
    vi.stubGlobal("PIXI", { Container, Graphics, Text, Sprite, Color, Polygon });
    vi.stubGlobal("foundry", { canvas: { rendering: { filters: { VisionMaskFilter: { create: () => ({}) } } },
        borders: { drawBorder(graphic: Graphics, shape: Polygon, options: { color: number; clear: boolean }) {
            if (options.clear !== false) graphic.clear();
            const width = CONFIG.Canvas.objectBorderThickness * (canvas!.dimensions as unknown as { uiScale: number }).uiScale;
            graphic.lineStyle(width, 0x000000).drawPolygon(shape.points);
            graphic.lineStyle(width / 2, options.color).drawPolygon(shape.points);
        } },
    } });
    vi.stubGlobal("ClipperLib", {
        PolyType: { ptSubject: 0 }, ClipType: { ctUnion: 1 }, PolyFillType: { pftNonZero: 1 },
        Clipper: class {
            paths: unknown[] = [];
            static Orientation() { return true; }
            AddPaths(paths: unknown[]) { this.paths = paths; }
            Execute(_operation: number, result: unknown[]) { result.push(...this.paths); }
        },
    });
    vi.stubGlobal("CONFIG", { Canvas: { objectBorderThickness: 4 },
        Token: { rulerClass: Ruler, movement: { actions: { walk: { walls: "move" } } } } });
    vi.stubGlobal("Hooks", {
        on(name: string, callback: (...args: unknown[]) => void) {
            const previous = callbacks[name];
            callbacks[name] = (...args) => { previous?.(...args); callback(...args); };
        },
        callAll(name: string, ...args: unknown[]) { callbacks[name]?.(...args); },
    });
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
    vi.stubGlobal("canvas", { ready: true, scene: { id: "scene" }, grid: { isGridless: true, units: "ft", size: 100,
        measurePath: (points: {x: number; y: number}[]) => ({cost: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) / 20}) },
        dimensions: { distance: 5, distancePixels: 20, uiScale: 1 }, stage: { scale: { x: 1 },
            on(name: string, callback: (...args: unknown[]) => void) { callbacks[name] = callback; }, off() {} },
        interface: interfaceLayer, tokens: { controlled } });
    registerGridlessSetting();
    registerMovementSettings();
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
        hazards: () => visibleGraphics().filter(graphic => (graphic as Graphics & { name?: string }).name === "codex-movement-hazards")
            .flatMap(graphic => graphic.paintedPolygons),
        hazardSegments: () => visibleGraphics().filter(graphic => (graphic as Graphics & { name?: string }).name === "codex-movement-hazards")
            .flatMap(graphic => graphic.paintedSegments),
        visibleLabels: () => interfaceLayer.children.flatMap(container => container.children)
            .filter((child): child is Text => child instanceof Text && child.visible).map(label => label.text),
        hazardLabels: () => interfaceLayer.children.filter(container => container.children.some(child =>
            (child as Graphics & { name?: string }).name === "codex-movement-hazards")).flatMap(container => container.children)
            .filter((child): child is Text => child instanceof Text && child.visible).map(label => label.text),
        debugHexes: () => visibleGraphics().flatMap(graphic => graphic.paintedPolygons).filter(p => p.alpha > 0 && p.points.length === 12),
        frontier: () => {
            const layer = visibleGraphics().find(graphic => (graphic as Graphics & { name?: string }).name === "codex-movement-frontier");
            return { cells: layer?.paintedPolygons ?? [],
                icons: (layer?.children ?? []).map(holder => holder.children[0]).map(child => child instanceof Text ? child.text : child instanceof Sprite ? `${child.src}@${child.width}` : "?") };
        },
        setSetting: (key: string, value: unknown) => { settingValues[key] = value; registeredSettings.get(key)?.onChange?.(value); },
        budgetPosition: () => visibleGraphics().find(isBudget)?.position,
        budgetOutline: () => {
            const graphic = visibleGraphics().find(isBudget);
            return graphic && { x: graphic.position.x, y: graphic.position.y, polygons: graphic.polygons.map(p => [...p]) };
        }, select, settings: settingValues, ruler: new Ruler(token) };
}

function setupHazardCanvas(style: "outline" | "plus" = "outline") {
    const fixture = setupMovementCanvas();
    if (style === "outline") fixture.setSetting("movementHazardStyle", style);
    const points = [-1000, -1000, 300, -1000, 300, 1000, -1000, 1000];
    Object.assign(fixture.token.scene, { regions: [{ id: "floor", levels: new Set(["floor"]),
        hidden: false, includedInLevel: () => true, testPoint: (point: { x: number }) => point.x < 300,
        polygons: [{ points }], polygonTree: { polygon: { points }, testPoint: (point: { x: number }) => point.x < 300 },
        behaviors: [{ type: "codex-foundry.setElevation", disabled: false, system: { elevation: 0, _getTerrainEffects: () => [] } }],
    }] });
    return fixture;
}

it("defaults to centered plus markers, retains whole-cell hover and can switch to outlines", async () => {
    const {binding, hazards, hazardSegments, callbacks, setSetting, hazardLabels, radii} = setupHazardCanvas("plus");
    binding.onDown();
    expect(hazards()).toHaveLength(0);
    expect(hazardSegments().some(line => line.stroke === 0xffffff)).toBe(true);
    expect(hazardSegments().some(line => line.stroke === 0xbb88ff)).toBe(true);
    expect(hazardSegments().every(line => line.fillAlpha === 0)).toBe(true);
    for (const zoom of [1, 0.5]) {
        canvas!.stage!.scale.x = zoom; callbacks.canvasPan();
        const horizontal = hazardSegments().find(line => line.stroke === 0xffffff
            && line.from[1] === 0 && line.to[1] === 0 && line.from[0] === -line.to[0])!;
        expect((horizontal.to[0] - horizontal.from[0]) * zoom).toBeCloseTo(12);
        expect(horizontal.width * zoom).toBe(2);
    }
    await radii();
    Object.assign(canvas!, {mousePosition: {x: 30, y: 20}}); callbacks.pointermove();
    expect(hazardLabels()).toEqual(["Best route: Walk"]);
    setSetting("movementHazardStyle", "outline");
    expect(hazards().length).toBeGreaterThan(0);
    expect(hazardSegments()).toEqual([]);
});

it("keeps colors anchored to the starting position through waypoints and movement, then resets", async () => {
    const {token, binding, ruler, callbacks, hazardLabels, radii} = setupHazardCanvas("plus");
    const floor = (id: string, left: number, right: number, elevation: number) => {
        const points = [left, -1000, right, -1000, right, 1000, left, 1000];
        return {id, levels: new Set(["floor"]), hidden: false, includedInLevel: () => true,
            polygons: [{points}], polygonTree: {polygon: {points}, testPoint: (p: {x: number}) => p.x >= left && p.x < right},
            behaviors: [{type: "codex-foundry.setElevation", disabled: false, system: {elevation, _getTerrainEffects: () => []}},
                {type: "codex-foundry.surfaceGeometry", disabled: false,
                    system: {extent: "solid", underside: null, blocksSight: true, blocksLight: true, _getTerrainEffects: () => []}}]};
    };
    Object.assign(token.scene, {regions: [floor("low", -1000, 300, 0), floor("high", 300, 1000, 20)]});
    const start = {...token.document._source, action: "walk"};
    const end = {...start, x: 450, elevation: 20};
    const hover = () => {Object.assign(canvas!, {mousePosition: {x: 700, y: 0}}); callbacks.pointermove(); return hazardLabels()[0];};
    binding.onDown();
    await radii();
    expect(hover()).toContain("Best route: Climb");
    token.isDragged = true;
    dragPaths.set(token as never, [start, end] as never);
    ruler.refresh({passedWaypoints: [], pendingWaypoints: [], plannedMovement: {user: {foundPath: [start, end]}}});
    expect(hover()).toContain("Best route: Climb");
    dragPaths.set(token as never, [start, {...end, x: 350, checkpoint: true}, end] as never);
    ruler.refresh({passedWaypoints: [], pendingWaypoints: [end], plannedMovement: {}});
    expect(hover()).toContain("Best route: Climb");
    token.isDragged = false;
    Object.assign(token.document._source, end);
    token.document.movement = {origin: start, state: "pending"};
    token.movementAnimationPromise = Promise.resolve();
    ruler.refresh({passedWaypoints: [], pendingWaypoints: [end], plannedMovement: {}});
    expect(hover()).toContain("Best route: Climb");
    token.movementAnimationPromise = null;
    token.document.movement.state = "completed";
    ruler.refresh({passedWaypoints: [], pendingWaypoints: [], plannedMovement: {}});
    await radii();
    expect(hover()).toBe("Best route: Walk");
});

it("updates markers and hover to the walking route around a gap, and cancels the search on release", async () => {
    const {token, binding, hazardSegments, hazardLabels, callbacks, radii} = setupHazardCanvas("plus");
    const rect = (left: number, top: number, right: number, bottom: number) => ({
        polygon: {points: [left, top, right, top, right, bottom, left, bottom]},
        testPoint: (p: {x: number; y: number}) => p.x >= left && p.x < right && p.y >= top && p.y < bottom,
    });
    const outer = rect(-1000, -1000, 1000, 1000), hole = rect(300, -100, 500, 300);
    const region = {id: "deck", levels: new Set(["floor"]), hidden: false, includedInLevel: () => true,
        polygons: [outer.polygon], polygonTree: {...outer, children: [hole],
            testPoint: (p: {x: number; y: number}) => outer.testPoint(p) && !hole.testPoint(p)},
        behaviors: [{type: "codex-foundry.setElevation", disabled: false, system: {elevation: 0, _getTerrainEffects: () => []}},
            {type: "codex-foundry.surfaceGeometry", disabled: false,
                system: {extent: "finite", underside: -2, blocksSight: true, blocksLight: true, _getTerrainEffects: () => []}}]};
    Object.assign(token.scene, {regions: [region]});
    const hover = () => {Object.assign(canvas!, {mousePosition: {x: 700, y: 0}}); callbacks.pointermove(); return hazardLabels()[0];};
    binding.onDown();
    await radii();
    expect(hover()).toBe("Best route: Walk");
    expect(hazardSegments().some(line => line.stroke === 0xffffff
        && (line.from[0] + line.to[0]) / 2 === 700 && line.from[1] === 0 && line.to[1] === 0)).toBe(true);
    binding.onUp(); binding.onDown(); binding.onUp(); await radii();
    expect(hazardSegments()).toEqual([]);
});

it("reuses a completed field in the same origin cell and invalidates it for terrain edits", async () => {
    const { token, other, binding, radii, callbacks, setSetting } = setupHazardCanvas();
    setSetting("gridlessCombat", false);
    const measure = vi.spyOn(token, "measureMovementPath");
    binding.onDown(); await radii();
    const calls = measure.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    binding.onUp(); binding.onDown(); await radii();
    expect(measure.mock.calls.length).toBe(calls);
    callbacks.visibilityRefresh?.(); await radii();
    expect(measure.mock.calls.length).toBe(calls);
    token.document._source.x += 1;
    callbacks.refreshToken?.(); await radii();
    expect(measure.mock.calls.length).toBe(calls);
    token.document._source.x += 100;
    callbacks.refreshToken?.(); await radii();
    const afterMove = measure.mock.calls.length;
    expect(afterMove).toBeGreaterThan(calls);
    callbacks.updateRegion?.(); await radii();
    expect(measure.mock.calls.length).toBeGreaterThan(afterMove);
    const beforeActorChange = measure.mock.calls.length;
    token.actor = other.actor; token.document.actor = other.actor;
    callbacks.refreshToken?.(); await radii();
    expect(measure.mock.calls.length).toBeGreaterThan(beforeActorChange);
    const beforeRuleChange = measure.mock.calls.length;
    callbacks.updateSetting?.({key: "codex-foundry.climbOutsideCombat"}); await radii();
    expect(measure.mock.calls.length).toBeGreaterThan(beforeRuleChange);
    const beforeStyleChange = measure.mock.calls.length;
    callbacks.updateSetting?.({key: "codex-foundry.movementHazardStyle"}); await radii();
    expect(measure.mock.calls.length).toBe(beforeStyleChange);
});

it("shows unknown landings beyond walking reach and clears them after preview or selection ends", async () => {
    const { token, other, binding, hazards, radii, select, ruler, settings, callbacks, visibleLabels, hazardLabels } = setupHazardCanvas();
    expect(hazards()).toEqual([]);
    binding.onDown();
    await radii();
    expect(hazardLabels()).toEqual([]);
    expect(hazards().some(cell => {
        const xs = cell.points.filter((_value, index) => index % 2 === 0);
        const ys = cell.points.filter((_value, index) => index % 2 === 1);
        return Math.abs(xs.reduce((sum, x) => sum + x, 0) / xs.length - 100) < 0.01
            && Math.abs(ys.reduce((sum, y) => sum + y, 0) / ys.length - 173.205) < 0.01;
    })).toBe(false);
    Object.assign(canvas!, { mousePosition: { x: 100, y: 200 } });
    callbacks.pointermove();
    expect(hazardLabels()).toEqual([]);
    expect(hazards().some(cell => cell.stroke === 0xbb88ff && cell.points.some((value, index) => index % 2 === 0 && value > 650))).toBe(true);
    Object.assign(canvas!, { mousePosition: { x: 400, y: 200 } });
    callbacks.pointermove();
    expect(visibleLabels().some(text => text.startsWith("Direct approach: Landing unknown"))).toBe(true);
    binding.onUp();
    expect(hazards()).toEqual([]);
    ruler.refresh({ passedWaypoints: [], pendingWaypoints: [{ x: 180, y: 200 }], plannedMovement: {} });
    expect(hazards().length).toBeGreaterThan(0);
    ruler.clear();
    expect(hazards()).toEqual([]);
    binding.onDown();
    select([]);
    expect(hazards()).toEqual([]);
    select([token]);
    expect(hazards().length).toBeGreaterThan(0);
    callbacks.destroyToken(other);
    expect(hazards().length).toBeGreaterThan(0);
    binding.onUp();
    token.movementAnimationPromise = Promise.resolve();
    callbacks.refreshToken(token, {});
    expect(hazards().length).toBeGreaterThan(0);
    token.movementAnimationPromise = null;
    callbacks.refreshToken(token, {});
    expect(hazards()).toEqual([]);
    binding.onDown();
    settings.enableCustomRules = false;
    token.renderFlags.set({ refreshRuler: true });
    expect(hazards()).toEqual([]);
});

it.each(["square", "hex"])("uses native %s cells and hides cells the player cannot see", async grid => {
    const { token, binding, hazards, hazardSegments, setSetting, radii, callbacks, hazardLabels } = setupHazardCanvas();
    token.document._source.width = 2;
    token.document.getOccupiedGridSpaceOffsets = () => [{ i: 2, j: 1 }, { i: 2, j: 2 }];
    Object.assign(canvas!.grid!, { isGridless: false, distance: 5,
        getOffset: ({x, y}: {x: number; y: number}) => ({i: Math.floor(y / 100), j: Math.floor(x / 100)}),
        getAdjacentOffsets: ({i, j}: {i: number; j: number}) => [{i, j: j + 1}, {i, j: j - 1}, {i: i + 1, j}, {i: i - 1, j}],
        getOffsetRange: () => [-1, -1, 4, 7],
        getCenterPoint: ({ i, j }: { i: number; j: number }) => ({ x: j * 100 + 50, y: i * 100 + 50 }),
        getVertices: ({ i, j }: { i: number; j: number }) => grid === "hex" ? [
            { x: j * 100 + 50, y: i * 100 }, { x: j * 100 + 100, y: i * 100 + 25 },
            { x: j * 100 + 100, y: i * 100 + 75 }, { x: j * 100 + 50, y: i * 100 + 100 },
            { x: j * 100, y: i * 100 + 75 }, { x: j * 100, y: i * 100 + 25 },
        ] : [
            { x: j * 100, y: i * 100 }, { x: j * 100 + 100, y: i * 100 },
            { x: j * 100 + 100, y: i * 100 + 100 }, { x: j * 100, y: i * 100 + 100 },
        ],
    });
    expect(binding.onDown()).toBe(true);
    await radii();
    expect(hazards().length).toBeGreaterThan(0);
    expect(hazards().every(cell => cell.points.length === (grid === "hex" ? 12 : 8))).toBe(true);
    expect(hazards().some(cell => cell.stroke === 0xffffff)).toBe(true);
    expect(hazards().some(cell => cell.stroke === 0xbb88ff)).toBe(true);
    expect(hazards().every(cell => cell.alpha === 0)).toBe(true);
    expect(hazardLabels()).toEqual([]);
    expect(hazards().some(cell => {
        const xs = cell.points.filter((_value, index) => index % 2 === 0);
        const ys = cell.points.filter((_value, index) => index % 2 === 1);
        const x = xs.reduce((sum, value) => sum + value, 0) / xs.length;
        const y = ys.reduce((sum, value) => sum + value, 0) / ys.length;
        return Math.abs(y - 250) < 0.01 && [150, 250].some(occupiedX => Math.abs(x - occupiedX) < 0.01);
    })).toBe(false);
    for (const zoom of [1, 0.5]) {
        canvas!.stage!.scale.x = zoom;
        callbacks.canvasPan();
        const cell = hazards().find(cell => cell.points.every(value => value >= 0 && value <= 100))!;
        // The fixture's top edge is y=0 (square) or x-2y=50 (hex).
        const inset = grid === "square" ? cell.points[1]
            : Math.abs(cell.points[0] - 2 * cell.points[1] - 50) / Math.sqrt(5);
        expect((inset - cell.width / 2) * zoom).toBeCloseTo(2);
        expect(hazards().some(cell => cell.stroke === 0x000000 && cell.width === 4)).toBe(true);
        expect(hazards().some(cell => cell.stroke === 0xffffff && cell.width === 2 && cell.strokeAlpha === 1)).toBe(true);
    }
    setSetting("movementHazardStyle", "plus");
    expect(hazards()).toHaveLength(0);
    expect(hazardSegments().some(line => line.stroke === 0xffffff
        && (line.from[0] + line.to[0]) / 2 === 50 && (line.from[1] + line.to[1]) / 2 === 50)).toBe(true);
    Object.assign(game.user!, { isGM: false });
    Object.assign(canvas!, { visibility: { tokenVision: true, testVisibility: () => false }, fog: { isPointExplored: () => false } });
    token.renderFlags.set({ refreshRuler: true });
    expect(hazards()).toEqual([]);
    expect(hazardSegments()).toHaveLength(0);
});

it("hides wall-blocked cells and explains the block on hover", async () => {
    const { token, binding, hazards, hazardSegments, setSetting, callbacks, visibleLabels } = setupHazardCanvas();
    Object.assign(canvas!.grid!, { isGridless: false,
        getOffset: ({x}: {x: number}) => ({i: 2, j: Math.floor(x / 100)}),
        getAdjacentOffsets: ({i, j}: {i: number; j: number}) => [{i, j: j + 1}, {i, j: j - 1}],
        getOffsetRange: () => [0, 0, 1, 5],
        getCenterPoint: ({ j }: { j: number }) => ({ x: j * 100 + 50, y: 250 }),
        getVertices: ({ j }: { j: number }) => [
            { x: j * 100, y: 200 }, { x: j * 100 + 100, y: 200 },
            { x: j * 100 + 100, y: 300 }, { x: j * 100, y: 300 },
        ],
    });
    token.constrainMovementPath = points => [points, points.at(-1)!.x >= 300];
    binding.onDown();
    expect(hazards().some(cell => cell.points.some((x, i) => i % 2 === 0 && x > 300))).toBe(false);
    Object.assign(canvas!, { mousePosition: { x: 350, y: 250 } });
    callbacks.pointermove();
    expect(visibleLabels()).toContain("Direct approach: Blocked");
    setSetting("movementHazardStyle", "plus");
    expect(hazardSegments().every(line => [...line.from, ...line.to].filter((_p, i) => i % 2 === 0).every(x => x < 300))).toBe(true);
    token.constrainMovementPath = points => [points, false];
    callbacks.deleteWall();
    expect(hazardSegments().some(line => line.stroke === 0xbb88ff)).toBe(true);
});

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
        id: String(elevation), levels: new Set(["floor"]),
        polygonTree: { polygon: { points }, testPoint: (point: { x: number }) => elevation === 0 ? point.x < 300 : point.x >= 300 },
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
    // With the Climb action carrying an image, as Foundry's default does, the rim shows that image.
    (CONFIG.Token.movement.actions as Record<string, { img?: string; walls?: string }>).climb = { img: "icons/svg/ladder.svg", walls: "move" };
    binding.onDown();
    await radii();
    expect(frontier().icons).toEqual(["icons/svg/ladder.svg@18"]);
    binding.onUp();
});
