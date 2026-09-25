import { afterEach, expect, it, vi } from "vitest";
import { renderSensoryGlows, clearSensoryGlows } from "../../../src/canvas/sensory/glow.js";
import type { SensoryGlow } from "../../../src/canvas/sensory/types.js";
afterEach(() => { clearSensoryGlows(); vi.unstubAllGlobals(); });

function setup() {
    class Container {
        children: any[] = []; parent: Container | null = null; alpha = 1; visible = true;
        addChild<T extends Container>(child: T): T { child.parent?.removeChild(child); this.children.push(child); child.parent = this; return child; }
        removeChild(child: Container) { this.children = this.children.filter(c => c !== child); child.parent = null; }
        destroy() { this.parent?.removeChild(this); for (const child of [...this.children]) child.destroy(); }
    }
    class Graphics extends Container {
        beginFill() { return this; } endFill() { return this; } beginHole() {} endHole() {}
        drawPolygon() {} lineStyle() { return this; } moveTo() { return this; } lineTo() { return this; }
    }
    class Mesh extends Container {
        shader = { uniforms: {} as Record<string, unknown> }; destroyed = false;
        scale = { set: vi.fn() }; position = { set: vi.fn() };
        destroy() { this.destroyed = true; super.destroy(); }
    }
    const sceneTexture = {}, ordinarySources = new Map(), sources: NativeSource[] = [];
    // Boundary model: native sources configure only after add(), and animations require all three shader layers.
    class NativeSource {
        static defaultData = {};
        data: any = {}; shape: any; _geometry: any; sourceId: string; ratio = 0;
        layers = Object.fromEntries(["background", "illumination", "coloration"].map(key => {
            const mesh = new Mesh(); return [key, { mesh, shader: mesh.shader, active: true }];
        }));
        constructor({ sourceId }: { sourceId: string }) { this.sourceId = sourceId; sources.push(this); }
        get effectsCollection() { return ordinarySources; }
        initialize(data: object) { this.data = data; this._createShapes(); }
        _createShapes() {}
        _configure() { this._updateGeometry(); for (const layer of Object.values(this.layers)) this._updateCommonUniforms(layer.shader); }
        _updateGeometry() {}
        _updateCommonUniforms(shader: { uniforms: Record<string, unknown> }) { shader.uniforms.primaryTexture = sceneTexture; }
        _drawMesh(key: string) { const mesh = this.layers[key].mesh; mesh.position.set(this.data.x, this.data.y); return mesh; }
        drawMeshes() { return Object.fromEntries(Object.keys(this.layers).map(key => [key, this._drawMesh(key)])); }
        add() { this.effectsCollection.set(this.sourceId, this); this._configure(); }
        animate = vi.fn();
        destroy() { this.effectsCollection.delete(this.sourceId); for (const layer of Object.values(this.layers)) layer.mesh.destroy(); this._geometry?.destroy(); }
    }
    const ticker = { add: vi.fn(), remove: vi.fn() }, layer = new Container();
    const white = {}, black = {}, neutral = { destroy: vi.fn() };
    vi.stubGlobal("PIXI", { Container, Graphics, Texture: { WHITE: white, EMPTY: black, fromBuffer: vi.fn(() => neutral) },
        Geometry: class { destroy = vi.fn(); }, Polygon: class { constructor(public points: number[]) {} getBounds() { return {}; } },
        BLEND_MODES: { NORMAL: 0, SCREEN: 3 }, AlphaFilter: class { constructor(public alpha: number) {} destroy = vi.fn(); },
        filters: { BlurFilter: class { destroy() {} } } });
    vi.stubGlobal("foundry", { utils: { Collection: Map, deepClone: structuredClone },
        data: { LightData: class {
            value: any;
            constructor(value: any) { if (value.dim === -1) throw Error("invalid radius"); this.value = { alpha: 0.5, angle: 360, bright: 0, dim: 0, animation: {}, ...value }; }
            toObject() { return this.value; }
        } },
        canvas: { sources: { BaseLightSource: NativeSource }, geometry: { PolygonMesher: class {
            triangulate(geometry: any) {
                // Native mesher updates buffers on non-null geometry; a bare PIXI.Geometry is invalid.
                if (geometry && !geometry.initialized) throw Error("Missing aVertexPosition buffer");
                return geometry ?? { initialized: true, destroy() {} };
            }
        } } } });
    vi.stubGlobal("canvas", { interface: layer, dimensions: { distancePixels: 10 }, app: { ticker },
        effects: { lightSources: ordinarySources }, primary: { renderTexture: sceneTexture } });
    return { layer, sources, ordinarySources, ticker, white, neutral };
}
const glow = (light: Record<string, unknown>): SensoryGlow => ({ viewerUuid: "Token.pc", direction: 0,
    emitter: { documentUuid: "Token.crystal", channel: "gold", strength: 3, colour: "#ffd700", light,
        position: { x: 20, y: 30, elevation: 40, levelId: "upper" }, rings: [] } });

it("renders animated colour alone with native radii and no access to scenery or ordinary lighting", () => {
    const f = setup();
    renderSensoryGlows([glow({ dim: 10, bright: 4, alpha: 0.8, animation: { type: "torch", speed: 2, intensity: 7 } })]);
    expect(f.sources).toHaveLength(1);
    const source = f.sources[0];
    expect(f.ordinarySources.size).toBe(0);
    expect(source.data).toMatchObject({ dim: 100, bright: 40, color: "#ffd700", vision: false });
    expect(source.data.alpha).toBe(1);
    expect((source.layers.coloration.mesh as any).filters[0].alpha).toBeCloseTo(0.6);
    expect((source.layers.coloration.mesh as any).filters[0].blendMode).toBe(3);
    expect(source.layers.coloration.mesh.scale.set).toHaveBeenCalledWith(100);
    expect(source.layers.coloration.mesh.parent).not.toBeNull();
    expect(source.layers.illumination.mesh.parent).toBeNull();
    expect(source.layers.background.mesh.parent).toBeNull();
    expect(source.layers.coloration.shader.uniforms).toMatchObject({ primaryTexture: f.neutral, computeIllumination: false, globalLight: true });
    const animate = f.ticker.add.mock.calls[0][0]; animate(1);
    expect(source.animate).toHaveBeenCalledWith(1);
    clearSensoryGlows();
    expect(f.ticker.remove).toHaveBeenCalledWith(animate);
    expect(source.layers.coloration.mesh.destroyed).toBe(true);
    expect(f.layer.children).toHaveLength(0);
    expect(f.neutral.destroy).toHaveBeenCalledWith(true);
    expect(f.ordinarySources.size).toBe(0);
});

it("keeps invalid or zero-radius light appearances dark without falling back to the old glow", () => {
    const f = setup();
    renderSensoryGlows([glow({ dim: -1 }), glow({ dim: 0, bright: 0 })]);
    expect(f.sources).toHaveLength(0);
    const descendants = (node: any): any[] => node.children.flatMap((child: any) => [child, ...descendants(child)]);
    expect(descendants(f.layer).some(node => typeof node.drawPolygon === "function")).toBe(false);
});
