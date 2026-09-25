import { isFloorType } from "./types.js";
export interface Point { x: number; y: number }
export interface PolygonNode {
    testPoint(point: Point): boolean;
    children?: readonly PolygonNode[];
    polygon?: { points: readonly number[] } | null;
}
export interface SurfaceRegion {
    id: string;
    elevation?:{bottom:number|null;top:number|null};
    flags?:Record<string,Record<string,unknown>>;
    levels: ReadonlySet<string>;
    behaviors: Iterable<{ type: string; disabled: boolean; system: { extent?:string; underside?:number|null; blocksSight?:boolean; blocksLight?:boolean; elevation?: number; climbDC?: number | null; grabEdgeDC?: number | null; climbPreset?:string; swimPreset?:string; swimDC?:number|null } }>;
    polygonTree: PolygonNode;
}
export interface SurfaceScene { id?:string; regions: Iterable<SurfaceRegion> }
export interface Support { regionId: string; elevation: number; levelIds: readonly string[] }
export type SupportSelection = {kind: "surface"; support: Support; level: string} | {kind: "none"} | {kind: "ambiguous"; candidates: readonly Support[]};

export function supportsAt(scene: SurfaceScene, point: Point): Support[] {
    const supports: Support[] = [];
    for (const region of scene.regions) {
        if (!region.polygonTree.testPoint(point)) continue;
        const behavior = [...region.behaviors].find(b => !b.disabled && isFloorType(b.type));
        if (behavior && Number.isFinite(behavior.system.elevation)) {
            supports.push({regionId: region.id, elevation: behavior.system.elevation!, levelIds: [...region.levels]});
        }
    }
    return supports;
}
export function selectSupport(candidates: readonly Support[], elevation: number, currentLevel: string): SupportSelection {
    const below = candidates.filter(s => s.elevation <= elevation + 1e-6);
    if (!below.length) return {kind: "none"};
    const highest = Math.max(...below.map(s => s.elevation));
    const winners = below.filter(s => s.elevation === highest);
    const current = winners.find(s => !s.levelIds.length || s.levelIds.includes(currentLevel));
    if (current) return {kind: "surface", support: current, level: currentLevel};
    const levels = new Set(winners.flatMap(s => s.levelIds));
    if (levels.size !== 1) return {kind: "ambiguous", candidates: winners};
    return {kind: "surface", support: winners[0], level: [...levels][0]};
}
