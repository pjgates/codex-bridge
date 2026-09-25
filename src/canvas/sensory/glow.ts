import type { SensoryGlow, SensoryRing } from "./types.js";
import { createLightAppearance } from "./light-appearance.js";
const appearances: { destroy(): void }[] = [];
let overlay: PIXI.Container | null = null;
const filters: PIXI.Filter[] = [];
function drawRings(graphics: PIXI.Graphics, rings: readonly SensoryRing[]): void {
    for (const ring of rings) {
        if (ring.hole) graphics.beginHole();
        graphics.drawPolygon(ring.points.flatMap(point => [point.x, point.y]));
        if (ring.hole) graphics.endHole();
    }
    graphics.endFill();
}
export function clearSensoryGlows(): void {
    for (const appearance of appearances.splice(0)) appearance.destroy();
    for (const filter of filters.splice(0)) filter.destroy();
    overlay?.destroy({ children: true }); overlay = null;
}
export function renderSensoryGlows(glows: readonly SensoryGlow[]): void {
    clearSensoryGlows();
    if (!glows.length) return;
    overlay = canvas!.interface!.addChild(new PIXI.Container()); overlay.eventMode = "none";
    for (const { emitter, direction } of glows) {
        const group = overlay.addChild(new PIXI.Container());
        const signal = group.addChild(new PIXI.Container());
        const colour = Number.parseInt(emitter.colour.slice(1), 16);
        if (emitter.light) {
            const appearance = createLightAppearance(emitter);
            if (!appearance) continue;
            appearances.push(appearance); signal.addChild(appearance.mesh);
        } else {
            const graphics = signal.addChild(new PIXI.Graphics());
            graphics.beginFill(colour, 0.8 * emitter.strength / (1 + emitter.strength));
            drawRings(graphics, emitter.rings);
            const blur = new PIXI.filters.BlurFilter(3, 2); filters.push(blur); graphics.filters = [blur];
        }
        if (!emitter.light || emitter.tile) {
            const mask = signal.addChild(new PIXI.Graphics()); mask.beginFill(0xffffff);
            drawRings(mask, emitter.rings); signal.mask = mask;
        }
        if (direction) {
            const cue = group.addChild(new PIXI.Graphics());
            const { x, y } = emitter.position;
            cue.lineStyle(2, colour, 1).moveTo(x + 12, y + 4 * direction)
                .lineTo(x + 12, y - 7 * direction).lineTo(x + 8, y - 3 * direction)
                .moveTo(x + 12, y - 7 * direction).lineTo(x + 16, y - 3 * direction);
        }
    }
}
