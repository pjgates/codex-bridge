import { expect, it } from "vitest";
import type { TreeNode } from "../../../src/canvas/clip-tiles/rings.js";
import { clipRings, clipRegionId, localRings, regionOptions, tilesClippedBy } from "../../../src/canvas/clip-tiles/rings.js";

const node = (points: number[], isHole: boolean, children: TreeNode[] = []): TreeNode =>
    ({ children, isHole, polygon: points.length ? { points } : null });

it("walks the polygon tree into outer rings and holes, skipping the empty root and degenerate rings", () => {
    const root = node([], true, [
        node([0, 0, 10, 0, 10, 10, 0, 10], false, [node([4, 4, 6, 4, 6, 6, 4, 6], true, [node([5, 5, 5.5, 5, 5.5, 5.5], false)])]),
        node([20, 0, 30, 0], false),
    ]);
    const rings = clipRings(root);
    expect(rings.map((r) => [r.points.length, r.hole])).toEqual([[4, false], [4, true], [3, false]]);
    expect(rings[0].points[2]).toEqual({ x: 10, y: 10 });
});

it("maps rings into mesh space through the supplied transform", () => {
    const rings = localRings([{ hole: false, points: [{ x: 10, y: 20 }] }], (p) => ({ x: p.x - 10, y: p.y / 2 }));
    expect(rings).toEqual([{ hole: false, points: [{ x: 0, y: 10 }] }]);
});

it("reads the clip flag and finds the tiles a region clips", () => {
    const tiles = [
        { id: "a", flags: { "codex-foundry": { clipRegion: "r1" } } },
        { id: "b", flags: { "codex-foundry": { clipRegion: "" } } },
        { id: "c", flags: {} },
        { id: "d", flags: { "codex-foundry": { clipRegion: "r2" } } },
    ];
    expect(clipRegionId(tiles[0], "codex-foundry")).toBe("r1");
    expect(clipRegionId(tiles[1], "codex-foundry")).toBeNull();
    expect(clipRegionId(tiles[2], "codex-foundry")).toBeNull();
    expect(tilesClippedBy(tiles, "r1", "codex-foundry").map((t) => t.id)).toEqual(["a"]);
});

it("offers None first and regions by name with the current one selected", () => {
    const options = regionOptions([{ id: "w", name: "Water 1" }, { id: "f", name: "Floor 0 ft" }, { id: null, name: "unsaved" }], "w", "None");
    expect(options).toEqual([
        { value: "", label: "None", selected: false },
        { value: "f", label: "Floor 0 ft", selected: false },
        { value: "w", label: "Water 1", selected: true },
    ]);
    expect(regionOptions([], null, "None")[0].selected).toBe(true);
});
