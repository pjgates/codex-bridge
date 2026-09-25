import { supportsAt, type Point, type PolygonNode, type Support, type SurfaceScene } from "./support.js";
import { isFloorType, isWaterType } from "./types.js";
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
const unique = (values: number[]): number[] => [...new Set(values.map(t => Math.round(t * 1e12) / 1e12))].sort((a,b) => a-b);
export function segmentParameters(a: Point, b: Point, points: readonly number[]): number[] {
    const r = {x:b.x-a.x,y:b.y-a.y}, length2=r.x*r.x+r.y*r.y;
    if (!length2) return [];
    const hits: number[] = [];
    for (let i=0;i<points.length;i+=2) {
        const j=(i+2)%points.length, c={x:points[i],y:points[i+1]}, d={x:points[j],y:points[j+1]};
        const s={x:d.x-c.x,y:d.y-c.y}, offset={x:c.x-a.x,y:c.y-a.y}, denominator=cross(r,s);
        if (Math.abs(denominator)<1e-10) {
            if (Math.abs(cross(offset,r))>1e-10) continue;
            for (const p of [c,d]) { const t=((p.x-a.x)*r.x+(p.y-a.y)*r.y)/length2; if(t>=0&&t<=1) hits.push(t); }
        } else {
            const t=cross(offset,s)/denominator, u=cross(offset,r)/denominator;
            if(t>=0&&t<=1&&u>=0&&u<=1) hits.push(t);
        }
    }
    return unique(hits);
}
function rings(node: PolygonNode): readonly number[][] {
    const out: number[][]=[];
    if(node.polygon) out.push([...node.polygon.points]);
    for(const child of node.children ?? []) out.push(...rings(child));
    return out;
}
export interface ContactWaypoint extends Point { elevation: number; level: string; width?: number; height?: number; shape?: number; depth?: number }
export interface Contact { leg: number; t: number; before: Support[]; after: Support[] }
export interface OriginToken { getMovementOrigin(position: ContactWaypoint): Point }
const identity = (supports: Support[]): string => supports.map(s=>`${s.regionId}:${s.elevation}`).sort().join("|");
export function traceContacts(scene: SurfaceScene, token: OriginToken, waypoints: readonly ContactWaypoint[], query = supportsAt): Contact[] {
    const polygons=[...scene.regions].filter(r=>[...r.behaviors].some(b=>!b.disabled&&(isFloorType(b.type)||isWaterType(b.type)))).flatMap(r=>rings(r.polygonTree));
    const contacts: Contact[]=[];
    for(let leg=0;leg<waypoints.length-1;leg++) {
        const start=waypoints[leg],end=waypoints[leg+1];
        const a=token.getMovementOrigin(start),b=token.getMovementOrigin({...start,...end});
        const at=(t:number): Point=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
        const parameters=unique([0,1,...polygons.flatMap(p=>segmentParameters(a,b,p))]);
        let before=query(scene,a);
        for(let i=0;i<parameters.length;i++) {
            const t=parameters[i],next=parameters[i+1];
            const after=query(scene,at(next===undefined?t:(t+next)/2));
            if(identity(before)!==identity(after)) contacts.push({leg,t,before,after});
            before=after;
        }
    }
    return contacts;
}
