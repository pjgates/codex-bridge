/**
 * Pure geometry for clipping a tile to a region: walk the region's polygon
 * tree into outer rings and holes, expressed in the tile mesh's local space.
 * No Foundry or PIXI globals, so the logic is unit-testable.
 */

export interface Point { readonly x: number; readonly y: number }

/** The parts of Foundry's PolygonTreeNode this feature reads. */
export interface TreeNode {
    readonly children: readonly TreeNode[];
    readonly isHole: boolean;
    readonly polygon: { readonly points: readonly number[] } | null;
}

export interface Ring { readonly points: Point[]; readonly hole: boolean }

/** Every ring below the root, outermost first, marked hole or solid. */
export function clipRings(root: TreeNode): Ring[] {
    const rings: Ring[] = [];
    const walk = (node: TreeNode): void => {
        for (const child of node.children) {
            const flat = child.polygon?.points ?? [];
            const points: Point[] = [];
            for (let i = 0; i + 1 < flat.length; i += 2) points.push({ x: flat[i], y: flat[i + 1] });
            if (points.length >= 3) rings.push({ points, hole: child.isHole });
            walk(child);
        }
    };
    walk(root);
    return rings;
}

/** Map every ring point through `toLocal` (scene space to mesh space). */
export function localRings(rings: readonly Ring[], toLocal: (point: Point) => Point): Ring[] {
    return rings.map((ring) => ({ hole: ring.hole, points: ring.points.map(toLocal) }));
}

/** The tiles of a scene whose clip flag names `regionId`. */
export function tilesClippedBy<T extends { readonly flags?: Record<string, unknown> }>(
    tiles: Iterable<T>, regionId: string, moduleId: string,
): T[] {
    return [...tiles].filter((tile) => clipRegionId(tile, moduleId) === regionId);
}

export function clipRegionId(tile: { readonly flags?: Record<string, unknown> }, moduleId: string): string | null {
    const flags = tile.flags?.[moduleId];
    const id = flags && typeof flags === "object" ? (flags as { clipRegion?: unknown }).clipRegion : undefined;
    return typeof id === "string" && id ? id : null;
}

/** Options for the config-sheet select: "None" first, then regions by name. */
export function regionOptions(
    regions: Iterable<{ readonly id: string | null; readonly name: string }>, current: string | null, noneLabel: string,
): { value: string; label: string; selected: boolean }[] {
    const sorted = [...regions].filter((r) => r.id).sort((a, b) => a.name.localeCompare(b.name));
    return [{ value: "", label: noneLabel, selected: !current },
        ...sorted.map((r) => ({ value: r.id!, label: r.name, selected: r.id === current }))];
}
