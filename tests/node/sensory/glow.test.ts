import { afterEach, expect, it, vi } from "vitest";
import { clearSensoryGlows, renderSensoryGlows } from "../../../src/canvas/sensory/glow.js";
afterEach(() => { clearSensoryGlows(); vi.unstubAllGlobals(); });
it("keeps the floor-direction cue visible when the clipped footprint has a hole at its center", () => {
    class Container {
        children: Container[] = []; parent: Container | null = null; mask: Graphics | null = null;
        addChild<T extends Container>(child: T): T { this.children.push(child); child.parent = this; return child; }
        destroy() { this.children = []; }
    }
    class Graphics extends Container {
        rings: { bounds: number[]; hole: boolean }[] = []; hole = false; lines: number[][] = [];
        beginFill() { return this; } endFill() { return this; }
        beginHole() { this.hole = true; } endHole() { this.hole = false; }
        drawPolygon(points: number[]) { this.rings.push({ bounds: [points[0], points[1], points[4], points[5]], hole: this.hole }); }
        lineStyle() { return this; } moveTo(x: number, y: number) { this.lines.push([x, y]); return this; }
        lineTo(x: number, y: number) { this.lines.push([x, y]); return this; }
        contains(x: number, y: number) {
            return this.rings.reduce((inside, { bounds: [left, top, right, bottom], hole }) =>
                x >= left && x <= right && y >= top && y <= bottom ? !hole : inside, false);
        }
    }
    const layer = new Container();
    vi.stubGlobal("canvas", { rendered: layer });
    vi.stubGlobal("PIXI", { Container, Graphics, filters: { BlurFilter: class { destroy() {} } } });
    const ring = (left: number, right: number, hole: boolean) => ({ hole, points: [
        { x: left, y: left }, { x: right, y: left }, { x: right, y: right }, { x: left, y: right } ] });
    renderSensoryGlows([{ viewerUuid: "Token.viewer", direction: 1, emitter: {
        documentUuid: "Tile.upper", channel: "alpha", strength: 2, colour: "#abcdef",
        position: { x: 50, y: 50, elevation: 20, levelId: "upper" }, rings: [ring(0, 100, false), ring(30, 70, true)] } }]);
    const descendants = (node: Container): Container[] => [node, ...node.children.flatMap(descendants)];
    const cue = descendants(layer).find(node => node instanceof Graphics && node.lines.length) as Graphics;
    const visible = cue.lines.every(([x, y]) => {
        for (let node: Container | null = cue; node; node = node.parent) if (node.mask && !node.mask.contains(x, y)) return false;
        return true;
    });
    expect(visible).toBe(true);
    const masks = descendants(layer).flatMap(node => node.mask ? [node.mask] : []);
    expect(masks.some(mask => !mask.contains(50, 50) && mask.contains(10, 10))).toBe(true);
});
