import { MODULE_ID } from "../../../constants.js";
export type TerrainStatus="climbing"|"swimming";
interface StatusItem {type:string;system:{slug?:string|null};flags?:Record<string,Record<string,unknown>>;delete():Promise<unknown>;update(changes:object):Promise<unknown>}
export interface StatusActor {system?:{movement?:{speeds?:Partial<Record<"climb"|"swim",{value:number}|null>>}};items:Iterable<StatusItem>;createEmbeddedDocuments(type:"Item",data:object[]):Promise<unknown>}
const writes=new WeakMap<StatusActor,Promise<void>>();
const tokenFlag=(status:TerrainStatus):string=>status==="climbing"?"climbingToken":"swimmingToken";
export function terrainStatusData(status:TerrainStatus,tokenUuid:string,hasSpeed=false) {
    const manager=(game as unknown as {pf2e:{ConditionManager:{conditions:Map<string,{uuid:string}>}}}).pf2e.ConditionManager;
    const exceptions=status==="climbing"?["speed:climb","feat:combat-climber"]:["speed:swim","aquatic-combat:not-off-guard"];
    return {
        name:`Effect: ${status==="climbing"?"Climbing":"Swimming"}`,type:"effect",
        img:`modules/${MODULE_ID}/dist/icons/${status}.svg`,flags:{[MODULE_ID]:{[tokenFlag(status)]:tokenUuid,terrainSpeed:hasSpeed,terrainStatusVersion:1}},
        system:{slug:`codex-${status}`,tokenIcon:{show:true},duration:{value:-1,unit:"unlimited",expiry:null,sustained:false},level:{value:1},traits:{value:[]},
            description:{value:`<p>Currently ${status}. Off-Guard applies unless an applicable Speed or feat removes it. This status does not grant a movement Speed.</p>`},
            rules:[{key:"RollOption",option:`self:${status}`},...(hasSpeed?[]:[{key:"GrantItem",uuid:manager.conditions.get("off-guard")!.uuid,inMemoryOnly:true,predicate:[{nor:exceptions}]}])]},
    };
}
/** Native in-memory grants update with actor preparation and never delete unrelated conditions. */
export function setTerrainStatus(actor:StatusActor,tokenUuid:string,status:TerrainStatus,active:boolean|"refresh",faceRegionId?:string):Promise<void> {
    const write=(writes.get(actor)??Promise.resolve()).catch(()=>{}).then(async()=>{
        const owned=[...actor.items].filter(i=>i.flags?.[MODULE_ID]?.[tokenFlag(status)]===tokenUuid);
        const effect=owned.find(i=>i.type==="effect" && i.system.slug===`codex-${status}`);
        if(active==="refresh" && !effect)return;
        for(const item of owned)if(!active || item!==effect)await item.delete();
        if(active) {
            // Native in-memory grants run before the system prepares special Speeds.
            const speed=(actor.system?.movement?.speeds?.[status==="climbing"?"climb":"swim"]?.value??0)>0;
            if(!effect) {
                const data=terrainStatusData(status,tokenUuid,speed);
                if(status==="climbing" && faceRegionId)Object.assign(data.flags[MODULE_ID],{climbingFaceRegionId:faceRegionId});
                await actor.createEmbeddedDocuments("Item",[data]);
            }
            else if(effect.flags?.[MODULE_ID]?.terrainSpeed!==speed || effect.flags?.[MODULE_ID]?.terrainStatusVersion!==1)await effect.update({"system.rules":terrainStatusData(status,tokenUuid,speed).system.rules,[`flags.${MODULE_ID}.terrainSpeed`]:speed,[`flags.${MODULE_ID}.terrainStatusVersion`]:1});
            if(effect && status==="climbing" && faceRegionId && effect.flags?.[MODULE_ID]?.climbingFaceRegionId!==faceRegionId) {
                await effect.update({[`flags.${MODULE_ID}.climbingFaceRegionId`]:faceRegionId});
            }
        }
    });
    writes.set(actor,write);return write;
}
export function hasTerrainStatus(actor:StatusActor,tokenUuid:string,status:TerrainStatus):boolean {
    return [...actor.items].some(i=>i.flags?.[MODULE_ID]?.[tokenFlag(status)]===tokenUuid);
}

/** Reconcile after native actor preparation, including feat- or spell-granted speed changes. */
export async function refreshTerrainSpeeds(actor:StatusActor):Promise<void> {
    const states=[...actor.items].filter(i=>i.type==="effect").flatMap(i=>(["climbing","swimming"] as const).flatMap(status=>{
        const uuid=i.flags?.[MODULE_ID]?.[tokenFlag(status)];return typeof uuid==="string"?[{status,uuid}]:[];
    }));
    await Promise.all(states.map(({status,uuid})=>setTerrainStatus(actor,uuid,status,"refresh")));
}
