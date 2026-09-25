import { isWaterType, selectSupport, supportsAt, traceContacts, type Point, type SurfaceScene, type SurfaceRegion, type Support } from "../../../canvas/regions/index.js";
import type { MovementToken, Transition, Waypoint } from "./transitions.js";

export function swimProgress(speed:number,degree:0|1|2|3,distance:number,swimSpeed=0,quickSwim=false):number {
    if(degree<2)return 0;
    const ordinary=10+Math.max(0,Math.floor((speed-20)/20))*5;
    const maximum=(swimSpeed||ordinary)+(degree===3?5:0);
    return Math.min(distance,quickSwim?Math.max(maximum,Math.min(speed,maximum+(degree===3?10:5))):maximum);
}
export function waterAtHeight(scene:SurfaceScene,point:Point,elevation:number):SurfaceRegion|undefined {
    if(supportsAt(scene,point).some(s=>Math.abs(s.elevation-elevation)<0.001))return;
    return [...scene.regions].find(r=>r.polygonTree.testPoint(point) && [...r.behaviors].some(b=>!b.disabled&&isWaterType(b.type)) &&
        typeof r.elevation?.top==="number" && elevation<=r.elevation.top && (r.elevation.bottom===null || r.elevation.bottom===undefined || elevation>r.elevation.bottom));
}
export function movementSupports(scene:SurfaceScene,point:Point,elevation:number):Support[] {
    const floors=supportsAt(scene,point),water=waterAtHeight(scene,point,elevation);
    return water?[...floors,{regionId:water.id,elevation,levelIds:[...water.levels]}]:floors;
}
/** Include all water boundaries when tracing; occupancy is evaluated at the evolving path height. */
export function contactSupports(scene:SurfaceScene,point:Point):Support[] {
    return [...supportsAt(scene,point),...[...scene.regions].filter(r=>r.polygonTree.testPoint(point) && typeof r.elevation?.top==="number" &&
        [...r.behaviors].some(b=>!b.disabled&&isWaterType(b.type))).map(r=>({regionId:r.id,elevation:r.elevation!.top!,levelIds:[...r.levels]}))];
}
/** One Swim action ends inside this water body; a later move resolves the next terrain transition. */
export function swimmingTransition(token:MovementToken,safe:Waypoint,target:Waypoint,region:SurfaceRegion):Omit<Transition,"ref"|"initiatorId"> {
    const contacts=traceContacts(token.parent!,token,[safe,target],(scene,point)=>movementSupports(scene,point,safe.elevation));
    const exit=contacts.find(c=>c.before.some(s=>s.regionId===region.id)&&!c.after.some(s=>s.regionId===region.id));
    const length=Math.hypot(target.x-safe.x,target.y-safe.y);
    const shore=exit?selectSupport(exit.after,safe.elevation,safe.level):null;
    const dryExit=shore?.kind==="surface" && shore.support.elevation===safe.elevation;
    const t=exit?Math.min(1,Math.max(0,exit.t+(dryExit?1:-1)*Math.min(1,1/Math.max(1,length)))):1;
    const after={...target,x:safe.x+(target.x-safe.x)*t,y:safe.y+(target.y-safe.y)*t,elevation:safe.elevation+(target.elevation-safe.elevation)*t,level:dryExit?shore.level:safe.level,action:"swim",checkpoint:false};
    return {reason:"swim",safe:{...safe,checkpoint:true},after,intent:{kind:"voluntary"},landing:{kind:"surface",support:{regionId:region.id,elevation:safe.elevation,levelIds:[...region.levels]},level:safe.level}};
}
