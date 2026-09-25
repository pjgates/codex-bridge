import { setTerrainStatus, type StatusActor } from "./status.js";
export const setClimbing=(actor:StatusActor,tokenUuid:string,climbing:boolean,faceRegionId?:string):Promise<void>=>
    setTerrainStatus(actor,tokenUuid,"climbing",climbing,faceRegionId);
