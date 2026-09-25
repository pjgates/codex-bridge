import { MODULE_ID } from '../../constants.js';
import type { Ring } from './rings.js';

export interface MaskRegions { include: string[]; exclude: string[] }

/** Read persisted selections; an explicit empty list overrides the legacy flag. */
export function maskRegions(tile: { readonly flags?: Record<string, unknown> }): MaskRegions {
    const flags = tile.flags?.[MODULE_ID] as Record<string, unknown> | undefined;
    const ids = (value: unknown): string[] => Array.isArray(value)
        ? [...new Set(value.filter((id): id is string => typeof id === 'string' && !!id))] : [];
    const legacy = flags?.clipRegion;
    return {
        include: Array.isArray(flags?.clipRegions) ? ids(flags.clipRegions) : typeof legacy === 'string' && legacy ? [legacy] : [],
        exclude: ids(flags?.excludeRegions),
    };
}

/** Artwork coverage uses exactly the same union/subtraction rule as the stencil. */
export function maskContains(mask: MaskRegions, contains: (id: string) => boolean): boolean {
    return (!mask.include.length || mask.include.some(contains)) && !mask.exclude.some(contains);
}

/** Union inclusions, then subtract the union of exclusions using Foundry's Clipper. */
export function combineMask(include: readonly Ring[], exclude: readonly Ring[]): Ring[] {
    // Retain subpixel precision while satisfying Clipper's integer-coordinate contract.
    const scale = 1000;
    const paths = (rings: readonly Ring[]): ClipperLib.Paths => rings.map(ring => {
        const path = ring.points.map(p => ({ X: Math.round(p.x * scale), Y: Math.round(p.y * scale) }));
        if (ClipperLib.Clipper.Orientation(path) === ring.hole) path.reverse();
        return path;
    });
    const clipper = new ClipperLib.Clipper();
    clipper.AddPaths(paths(include), ClipperLib.PolyType.ptSubject, true);
    clipper.AddPaths(paths(exclude), ClipperLib.PolyType.ptClip, true);
    const tree = new ClipperLib.PolyTree();
    clipper.Execute(ClipperLib.ClipType.ctDifference, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    const rings: Ring[] = [];
    const walk = (node: ClipperLib.PolyNode): void => {
        for (const child of node.Childs()) {
            rings.push({ hole: child.IsHole(), points: child.Contour().map(p => ({ x: p.X / scale, y: p.Y / scale })) });
            walk(child);
        }
    };
    walk(tree);
    return rings;
}
