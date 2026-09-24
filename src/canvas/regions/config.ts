import { MODULE_ID } from "../../constants.js";
import { isFloorType, isWaterType } from "./types.js";
import type { SurfaceRegion } from "./support.js";
const dc = (value:unknown):number|null => typeof value==="number" && Number.isInteger(value) && value>=0 ? value : null;
export function regionDC(flags:Record<string,unknown>, action:"climb"|"grab-an-edge"):number|null {
    return (action==="grab-an-edge" ? dc(flags.grabEdgeDC) : null) ?? dc(flags.climbDC);
}
const presets:Record<string,number>={untrained:10,trained:15,expert:20,master:30,legendary:40,calm:10,flowing:15,swift:20,stormy:30,maelstrom:40};
export function terrainDC(region:SurfaceRegion|undefined,action:"climb"|"grab-an-edge"|"swim",withoutLevel=false):number|null {
    const behavior=[...(region?.behaviors??[])].find(b=>!b.disabled && (action==="swim"?isWaterType(b.type):isFloorType(b.type)));
    const data=behavior?.system;
    const custom=action==="swim"?dc(data?.swimDC):(action==="grab-an-edge"?dc(data?.grabEdgeDC):null)??dc(data?.climbDC);
    if(custom!==null)return custom;
    const preset=action==="swim"?data?.swimPreset:data?.climbPreset;
    const value=presets[preset??""];
    if(value!==undefined)return withoutLevel && value>=30?value- (value===30?5:10):value;
    if(action!=="swim" && (!preset || preset==="legacy"))return regionDC(region?.flags?.[MODULE_ID]??{},action);
    return null;
}
