import type { Point } from "./geometry.js";
import { allFloors, surfaceBelow, type Floor } from "./floors.js";
import { onAbsoluteElevationChange } from "./elevation-key.js";
import { currentReference, type TooltipToken } from "./tooltip.js";

// Foundry 14 level shapes not yet represented by fvtt-types.
type ProbeScene = Parameters<typeof allFloors>[0] & { levels: Iterable<{ id: string; isVisible: boolean }> };
interface LevelledRegion { includedInLevel(levelId: string): boolean }

/** Floors on the levels the viewer can see, so the probe reads the surface actually drawn under the cursor. */
export function visibleFloors(scene: ProbeScene): Floor[] {
    const visible = Array.from(scene.levels).filter(level => level.isVisible).map(level => level.id);
    return allFloors(scene).filter(({ region }) => visible.some(id => (region as unknown as LevelledRegion).includedInLevel(id)));
}

const round = (value: number): number => Math.round(value * 100) / 100;
const signed = (value: number): string => (value > 0 ? "+" : "") + String(value);

/** "-15 ft · 20 ft below you": the top floor under the point, absolute, then relative to the reference token. */
export function probeText(floors: readonly Floor[], point: Point, reference: Pick<TooltipToken, "document"> | null, units: string): string | null {
    const surface = surfaceBelow(floors, point);
    if (surface === null) return null;
    const absolute = `${signed(round(surface))} ${units}`.trim();
    if (!reference) return absolute;
    const difference = round(reference.document.elevation - surface);
    const key = difference > 0 ? "probeBelow" : difference < 0 ? "probeAbove" : "probeLevel";
    return `${absolute} · ${game.i18n!.format(`codex-foundry.gridless.${key}`, { distance: String(Math.abs(difference)), units })}`;
}

const PROBE_OFFSET = 12;

/** While the absolute-elevation key is held, a label at the cursor reads the floor height beneath it, whatever level it is on. */
export function activateFloorProbe(): void {
    let label: PIXI.Text | null = null;
    const update = (): void => {
        if (!label || !canvas?.ready) return;
        const scene = canvas.scene as unknown as ProbeScene;
        const point = canvas.mousePosition!;
        const text = probeText(visibleFloors(scene), point, currentReference(), canvas.grid!.units);
        label.visible = text !== null;
        if (text === null) return;
        label.text = text;
        label.position.set(point.x, point.y - PROBE_OFFSET);
    };
    const show = (): void => {
        if (label || !canvas?.ready || !allFloors(canvas.scene as unknown as ProbeScene).length) return;
        const style = CONFIG.canvasTextStyle.clone();
        style.fontSize = 24;
        const PreciseText = (foundry.canvas.containers as unknown as { PreciseText: new (text: string, style: PIXI.TextStyle) => PIXI.Text }).PreciseText;
        label = canvas.interface!.addChild(new PreciseText("", style));
        label.anchor.set(0.5, 1);
        const scale = (canvas.dimensions as unknown as { uiScale: number }).uiScale;
        label.scale.set(scale, scale);
        label.zIndex = 2;
        label.eventMode = "none";
        canvas.stage!.on("pointermove", update);
        update();
    };
    const hide = (): void => {
        if (!label) return;
        canvas?.stage?.off("pointermove", update);
        label.parent?.removeChild(label);
        label.destroy();
        label = null;
    };
    onAbsoluteElevationChange(held => held ? show() : hide());
    Hooks.on("canvasTearDown", hide);
}
