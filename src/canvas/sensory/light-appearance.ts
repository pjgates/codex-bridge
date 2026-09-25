import type { SensoryEmitter } from "./types.js";

/** Native animation/shader machinery attached to a private collection, never canvas.effects.lightSources. */
export function createLightAppearance(emitter: SensoryEmitter): { mesh: PIXI.Container; destroy(): void } | null {
    let light: ReturnType<foundry.data.LightData["toObject"]>;
    try {
        light = new foundry.data.LightData({ ...emitter.light, color: emitter.colour }).toObject();
    } catch { return null; } // Persisted rule data can be malformed or edited as JSON.
    const pixels = canvas!.dimensions!.distancePixels;
    const radius = Math.max(light.dim, light.bright) * pixels;
    if (!(radius > 0) || light.angle <= 0 || light.alpha <= 0) return null;
    // Mid-grey keeps native burn/absorption techniques meaningful without exposing any map texture.
    const backdrop = PIXI.Texture.fromBuffer(new Uint8Array([128, 128, 128, 255]), 1, 1);
    class AppearanceSource extends foundry.canvas.sources.BaseLightSource {
        declare shape: PIXI.Polygon;
        static override defaultData = { ...super.defaultData, angle: 360 };
        private readonly collection = new foundry.utils.Collection<this>();
        override get effectsCollection() { return this.collection; }
        protected override _createShapes(): void {
            const angle = light.angle * Math.PI / 180;
            const start = ((emitter.rotation ?? 0) + 90) * Math.PI / 180 - angle / 2;
            const steps = Math.max(2, Math.ceil(64 * angle / (2 * Math.PI)));
            const points = angle < Math.PI * 2 ? [0, 0] : [];
            for (let i = 0; i <= steps; i++) points.push(Math.cos(start + angle * i / steps), Math.sin(start + angle * i / steps));
            this.shape = new PIXI.Polygon(points);
        }
        protected override _updateGeometry(): void {
            this._geometry = new foundry.canvas.geometry.PolygonMesher(this.shape, { radius: 1, normalize: true })
                .triangulate(this._geometry!); // Native accepts null to allocate its vertex/index/depth buffers.
            Object.assign(this._geometry, { bounds: this.shape.getBounds() });
        }
        protected override _drawMesh(layerId: "background" | "illumination" | "coloration") {
            // Native vision modes must not suppress a separately granted supernatural sense.
            if (layerId === "coloration") this.layers.coloration.active = true;
            const mesh = super._drawMesh(layerId);
            mesh?.scale.set(radius);
            return mesh;
        }
        protected override _updateCommonUniforms(shader: foundry.canvas.rendering.shaders.AbstractBaseShader): void {
            super._updateCommonUniforms(shader);
            Object.assign(shader.uniforms, {
                // Never sample map pixels or floor masks: the native shader is only a visual pattern here.
                primaryTexture: backdrop, depthTexture: PIXI.Texture.WHITE,
                darknessLevelTexture: PIXI.Texture.WHITE, computeIllumination: false,
                globalLight: true, globalLightThresholds: [0, 1],
            });
        }
    }
    const source = new AppearanceSource({ sourceId: `${emitter.documentUuid}.${emitter.channel}` });
    source.ratio = light.bright * pixels / radius;
    source.initialize({ ...light, x: emitter.position.x, y: emitter.position.y,
        // The view's level supplies native initialization context; geometry and shaders ignore floor visibility.
        dim: light.dim * pixels, bright: light.bright * pixels,
        alpha: 1, vision: false, seed: 0 } as Parameters<typeof source.initialize>[0]);
    source.add();
    const mesh = source.drawMeshes().coloration!;
    // Apply opacity after the shader: some native animations never consume colorationAlpha.
    const opacity = new PIXI.AlphaFilter(light.alpha * emitter.strength / (1 + emitter.strength));
    opacity.blendMode = PIXI.BLEND_MODES.SCREEN;
    mesh.blendMode = PIXI.BLEND_MODES.NORMAL;
    mesh.filters = [opacity];
    const ticker = canvas!.app!.ticker;
    const animate = (delta: number) => source.animate(delta);
    ticker.add(animate);
    return { mesh, destroy() {
        ticker.remove(animate);
        mesh.parent?.removeChild(mesh);
        source.destroy(); opacity.destroy(); backdrop.destroy(true);
    } };
}
