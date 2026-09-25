import { afterEach, expect, it, vi } from "vitest";
import { activateSensoryCanvas } from "../../../src/canvas/sensory/lifecycle.js";
import { legacyDefinition as definition, token } from "./fixtures.js";
afterEach(() => vi.unstubAllGlobals());
it("removes actual overlay output on deselection, ownership loss and teardown without reviving queued work", () => {
    class Container {
        children: Container[] = []; parent: Container | null = null; eventMode = "";
        addChild<T extends Container>(child: T): T { this.children.push(child); child.parent = this; return child; }
        removeChild(child: Container) { this.children = this.children.filter(c => c !== child); }
        destroy() { this.parent?.removeChild(this); this.children = []; }
    }
    class Graphics extends Container {
        filters: unknown[] = []; mask: unknown; polygons: number[][] = [];
        beginFill() { return this; } endFill() { return this; } beginHole() { return this; } endHole() { return this; }
        drawPolygon(points: number[]) { this.polygons.push(points); return this; }
        lineStyle() { return this; } moveTo() { return this; } lineTo() { return this; }
    }
    const hooks: Record<string, (...args: any[]) => void> = {};
    let queued: (() => void) | undefined;
    const layer = new Container();
    const viewer = token("Token.viewer"), target = token("Token.upper", { x: 150, elevation: 20, levelId: "upper" });
    Object.assign(viewer.actor, { type: "character" });
    const selected = [{ document: viewer }];
    const mesh = { unoccludedAlpha: 0.8, occludedAlpha: 0.2 };
    const tile = { document: { flags: { "codex-foundry": { sensoryVisibility: { effectUuid: "Item.signal", minRank: 2 } } } }, mesh, renderFlags: { set: vi.fn() } };
    const world = { uuid: "Item.signal", type: "effect", flags: { "codex-foundry": { sensory: definition() } } };
    vi.stubGlobal("PIXI", { Container, Graphics, filters: { BlurFilter: class { destroy() {} } } });
    vi.stubGlobal("Hooks", { on: (name: string, fn: any) => { hooks[name] = fn; } });
    vi.stubGlobal("game", { user: { id: "viewer" }, items: new Map([["signal", world]]), audio: { locked: true } });
    vi.stubGlobal("canvas", { ready: true, tiles: { placeables: [tile] }, interface: layer, tokens: { controlled: selected }, dimensions: { distancePixels: 10 },
        scene: { tokens: [viewer, target], tiles: [], regions: new Map() } });
    vi.stubGlobal("requestAnimationFrame", (fn: () => void) => { queued = fn; return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => { queued = undefined; });
    const flush = () => { const fn = queued; queued = undefined; fn?.(); };
    activateSensoryCanvas(); hooks.controlToken?.(); flush();
    expect(layer.children.flatMap(child => child.children)).toHaveLength(1);
    selected.length = 0; hooks.controlToken();
    expect(mesh.unoccludedAlpha).toBe(0); expect(mesh.occludedAlpha).toBe(0);
    flush();
    expect(layer.children.flatMap(child => child.children)).toHaveLength(0);
    selected.push({ document: viewer }); viewer.actor.testUserPermission = () => false;
    hooks.updateActor(); flush();
    expect(layer.children.flatMap(child => child.children)).toHaveLength(0);
    viewer.actor.testUserPermission = () => true;
    hooks.controlToken(); flush();
    world.flags["codex-foundry"].sensory.channel = ""; hooks.updateItem(); flush();
    expect(layer.children.flatMap(child => child.children)).toHaveLength(0);
    world.flags["codex-foundry"].sensory.channel = "alpha";
    hooks.controlToken(); hooks.canvasTearDown(); flush();
    expect(layer.children).toHaveLength(0);
});
