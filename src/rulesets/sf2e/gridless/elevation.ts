import type { Point } from "./geometry.js";
/** Workshop stairs retain their authored 2.5 ft tread convention. */
export const STEP_FEET = 2.5;
export interface ElevationWaypoint extends Point {
    elevation:number; action:string; snapped:boolean; explicit:boolean; checkpoint:boolean;
}
