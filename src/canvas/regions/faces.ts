import { traceContacts, type ContactWaypoint } from './contacts.js';
import { floorTop, readSurfaceGeometry } from './geometry.js';
import { supportsAt, type SurfaceScene } from './support.js';
import {isFloorType} from './types.js';

export type FaceResult =
    | {kind:'face';regionId:string;top:number;bottom:number|null}
    | {kind:'gap';regionId:string}
    | {kind:'unknown';reason:string};

/** A local boundary query, using movement-origin points and absolute feet. */
export function faceBetween(scene:SurfaceScene, from:ContactWaypoint, to:ContactWaypoint):FaceResult {
    const unknown = (reason:string):FaceResult => ({kind:'unknown',reason});
    const [high, low] = from.elevation > to.elevation ? [from,to] : [to,from];
    if (high.elevation <= low.elevation) { return unknown('No vertical interval was requested.'); }
    const candidates = supportsAt(scene,high).filter(s => s.elevation >= high.elevation - 1e-6);
    const nearest = Math.min(...candidates.map(s => s.elevation));
    const owners = candidates.filter(s => s.elevation === nearest);
    if (owners.length !== 1) { return unknown('The upper face has no unique owning floor.'); }
    const upper = [...scene.regions].find(r => r.id === owners[0].regionId)!;
    const geometry = readSurfaceGeometry(upper);
    if (geometry.extent === 'unknown') { return unknown('Surface extent is not authored or is ambiguous.'); }
    if (upper.polygonTree.testPoint(low)) { return unknown('The route is inside material, not beside an exposed face.'); }
    // Reuse exact polygon tracing, including holes. A long route cannot skip an opening.
    const crossings = traceContacts({regions:[upper]}, {getMovementOrigin:p=>p}, [high,low]);
    if (crossings.length !== 1) { return unknown('The route crosses more than one surface boundary.'); }
    for (const outside of scene.regions) {
        if (outside === upper) { continue; }
        const top = floorTop(outside);
        if(top===null&&[...outside.behaviors].some(b=>!b.disabled&&isFloorType(b.type))&&
            (outside.polygonTree.testPoint(high)||outside.polygonTree.testPoint(low))) {
            return unknown('An overlapping floor definition is ambiguous.');
        }
        if (top === null || top <= low.elevation + 1e-6) { continue; }
        const material = readSurfaceGeometry(outside);
        if (top > high.elevation + 1e-6 && outside.polygonTree.testPoint(high) &&
            (material.extent !== 'finite' || material.underside < high.elevation - 1e-6)) {
            return unknown('Another surface contains or obscures the upper destination.');
        }
        if (!outside.polygonTree.testPoint(low)) { continue; }
        if (material.extent === 'unknown') { return unknown('Adjacent material extent is not authored.'); }
        if (material.extent === 'solid' || material.underside < high.elevation - 1e-6) {
            return unknown('Another surface obstructs the exposed side of this face.');
        }
    }
    if (geometry.extent === 'finite' && geometry.underside > low.elevation + 1e-6) {
        return {kind:'gap',regionId:upper.id};
    }
    return {kind:'face',regionId:upper.id,top:nearest,bottom:geometry.underside};
}
