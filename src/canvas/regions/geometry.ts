import type { SurfaceRegion } from './support.js';
import { isFloorType, isGeometryType } from './types.js';

export type SurfaceGeometry =
    | {extent:'unknown';underside:null;blocksSight:boolean;blocksLight:boolean}
    | {extent:'solid';underside:null;blocksSight:boolean;blocksLight:boolean}
    | {extent:'finite';underside:number;blocksSight:boolean;blocksLight:boolean};

export function floorTop(region: SurfaceRegion): number | null {
    const floors = [...region.behaviors].filter(b => !b.disabled && isFloorType(b.type));
    return floors.length === 1 && Number.isFinite(floors[0].system.elevation) ? floors[0].system.elevation! : null;
}

/** Validate persisted data at the document boundary, including the floor-owned top. */
export function validateGeometry(data: Record<string, unknown>, top: number | null): void {
    if (!['unknown', 'solid', 'finite'].includes(String(data.extent)) ||
        typeof data.blocksSight !== 'boolean' || typeof data.blocksLight !== 'boolean') {
        throw new Error('Surface geometry requires an extent and sight/light choices.');
    }
    if (data.extent === 'finite') {
        if (typeof data.underside !== 'number' || !Number.isFinite(data.underside) || top === null || data.underside >= top) {
            throw new Error('A suspended surface needs one floor and an underside below its top.');
        }
    } else if (data.underside !== null) {
        throw new Error('Only finite surfaces have an underside.');
    }
}

export function readSurfaceGeometry(region: SurfaceRegion): SurfaceGeometry {
    const unknown: SurfaceGeometry = {extent:'unknown',underside:null,blocksSight:true,blocksLight:true};
    const definitions = [...region.behaviors].filter(b => !b.disabled && isGeometryType(b.type));
    if (definitions.length !== 1) { return unknown; }
    const data = definitions[0].system;
    try { validateGeometry(data, floorTop(region)); } catch { return unknown; }
    return {extent:data.extent,underside:data.underside,blocksSight:data.blocksSight,blocksLight:data.blocksLight} as SurfaceGeometry;
}

export function geometryPreset(preset: 'solid'|'deck'|'catwalk', underside: number | null): SurfaceGeometry {
    if (preset === 'solid') { return {extent:'solid',underside:null,blocksSight:true,blocksLight:true}; }
    if (underside === null || !Number.isFinite(underside)) { throw new Error('Author an underside for the suspended surface.'); }
    return {extent:'finite',underside,blocksSight:preset !== 'catwalk',blocksLight:preset !== 'catwalk'};
}
