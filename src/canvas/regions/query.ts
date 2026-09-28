import { segmentParameters } from "./contacts.js";
import type { Point, PolygonNode, SurfaceRegion, SurfaceScene } from "./support.js";
import { isFloorType, isWaterType } from "./types.js";

/** Exact geometry queries shared across searches; discard this view when scene data changes. */
export function prepareSurfaceQueries(scene: SurfaceScene, size: number): SurfaceScene {
    const regions = [...scene.regions], membership = new Map<string, readonly SurfaceRegion[]>();
    interface Edge { points: number[]; left: number; right: number; top: number; bottom: number }
    const buckets = new Map<string, Edge[]>();
    const index = (node: PolygonNode): void => {
        const points = node.polygon?.points ?? [];
        for (let n = 0; n < points.length; n += 2) {
            const next = (n + 2) % points.length;
            const edge = { points: [points[n], points[n + 1], points[next], points[next + 1]],
                left: Math.min(points[n], points[next]), right: Math.max(points[n], points[next]),
                top: Math.min(points[n + 1], points[next + 1]), bottom: Math.max(points[n + 1], points[next + 1]) };
            for (let i = Math.floor(edge.top / size); i <= Math.floor(edge.bottom / size); i++) {
                for (let j = Math.floor(edge.left / size); j <= Math.floor(edge.right / size); j++) {
                    const key = `${i}:${j}`, bucket = buckets.get(key);
                    if (bucket) bucket.push(edge); else buckets.set(key, [edge]);
                }
            }
        }
        for (const child of node.children ?? []) index(child);
    };
    for (const region of regions) if ([...region.behaviors].some(b => !b.disabled && (isFloorType(b.type) || isWaterType(b.type)))) index(region.polygonTree);
    return { id: scene.id, regions,
        regionsAt(point) {
            const key = `${point.x}:${point.y}`;
            let found = membership.get(key);
            if (!found) {
                found = regions.filter(region => region.polygonTree.testPoint(point));
                membership.set(key, found);
            }
            return found;
        },
        segmentParameters(a: Point, b: Point) {
            const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x);
            const top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y), edges = new Set<Edge>();
            for (let i = Math.floor(top / size); i <= Math.floor(bottom / size); i++) {
                for (let j = Math.floor(left / size); j <= Math.floor(right / size); j++) {
                    for (const edge of buckets.get(`${i}:${j}`) ?? []) {
                        if (edge.left <= right && edge.right >= left && edge.top <= bottom && edge.bottom >= top) edges.add(edge);
                    }
                }
            }
            return [...edges].flatMap(edge => segmentParameters(a, b, edge.points));
        },
    };
}
