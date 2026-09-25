import { isWaterType } from "./types.js";
import { supportsAt, type Point, type SurfaceScene } from "./support.js";
export interface WaterLanding {regionId:string;surface:number;bed:number|null;depth:number|null;levelIds:readonly string[]}
/** A solid bridge wins above water; local floor geometry can make a pool shallower than its band. */
export function waterLanding(scene:SurfaceScene,point:Point,from:number,solid:number):WaterLanding|null {
    const candidates=[...scene.regions].filter(region=>region.polygonTree.testPoint(point) &&
        [...region.behaviors].some(b=>!b.disabled && isWaterType(b.type)) &&
        typeof region.elevation?.top==="number" && Number.isFinite(region.elevation.top) && region.elevation.top<=from && region.elevation.top>solid);
    const region=candidates.sort((a,b)=>b.elevation!.top!-a.elevation!.top!)[0];
    if(!region) return null;
    const surface=region.elevation!.top!;
    const beds=supportsAt(scene,point).filter(s=>s.elevation<=surface).map(s=>s.elevation);
    const bottom=region.elevation?.bottom;
    if(typeof bottom==="number" && Number.isFinite(bottom) && bottom<=surface) beds.push(bottom);
    const bed=beds.length?Math.max(...beds):null;
    return {regionId:region.id,surface,bed,depth:bed===null?null:surface-bed,levelIds:[...region.levels]};
}
