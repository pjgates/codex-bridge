import { MODULE_ID } from "../../../constants.js";
import { supportsAt } from "../../../canvas/regions/index.js";
import { isFlying } from "../flying/index.js";
import { movementFeatureEnabled, movementOutcomeMode } from "./settings.js";
import { hasTerrainStatus, setTerrainStatus, refreshTerrainSpeeds, type StatusActor, type TerrainStatus } from "./status.js";
import { waterAtHeight } from "./swim.js";
import type { MovementToken } from "./transitions.js";

export function statusAtRest(token:MovementToken,action:string):TerrainStatus|null {
    if(!token.actor || !token.parent || action==="fly" || (action==="codex-forced" && isFlying(token.actor)))return null;
    const point=token.getMovementOrigin(token._source),height=token._source.elevation;
    if(waterAtHeight(token.parent,point,height))return "swimming";
    if(supportsAt(token.parent,point).some(s=>Math.abs(s.elevation-height)<0.01))return null;
    if(action==="climb" || (hasTerrainStatus(token.actor,token.uuid,"climbing") && !["codex-fall","displace","teleport","blink"].includes(action)))return "climbing";
    return null;
}
async function syncStatus(token:MovementToken,action:string):Promise<void> {
    if(!token.actor || movementOutcomeMode()!=="apply")return;
    const status=statusAtRest(token,action);
    await Promise.all((["climbing","swimming"] as const).filter(kind=>movementFeatureEnabled(kind))
        .map(kind=>setTerrainStatus(token.actor!,token.uuid,kind,status===kind)));
}
export function activateTerrainStatuses():void {
    const hooks=Hooks as unknown as {on(name:string,fn:(...args:never[])=>unknown):void};
    hooks.on("moveToken",(token:MovementToken,movement:{id:string;passed:{waypoints:{action:string}[]}})=>{
        if(game.users?.activeGM?.id!==game.user?.id || token.movement.id!==movement.id)return;
        const last=movement.passed.waypoints.at(-1);
        if(last)void syncStatus(token,last.action);
    });
    const refresh=(actor:StatusActor):void=>{if(game.users?.activeGM?.id===game.user?.id)void refreshTerrainSpeeds(actor);};
    for(const actor of game.actors!)refresh(actor as unknown as StatusActor);
    const refreshTokens=():void=>{for(const token of canvas?.tokens?.placeables??[])if(token.actor)refresh(token.actor as unknown as StatusActor);};
    refreshTokens();
    hooks.on("canvasReady",refreshTokens);
    hooks.on("updateActor",refresh);
    for(const event of ["createItem","updateItem","deleteItem"])hooks.on(event,(item:{actor:StatusActor|null})=>{if(item.actor)refresh(item.actor);});
    hooks.on("createItem",(item:{type:string;system:{slug?:string};actor?:{getActiveTokens(linked:boolean,document:boolean):MovementToken[]}})=>{
        if(game.users?.activeGM?.id!==game.user?.id || item.system.slug!=="codex-flying")return;
        for(const token of item.actor?.getActiveTokens(false,true)??[])void syncStatus(token,"fly");
    });
}
export async function ensureTerrainMacros():Promise<void> {
    if(!game.user?.isGM)return;
    const macros=game.macros as unknown as {some(predicate:(m:{getFlag(scope:string,key:string):unknown})=>boolean):boolean};
    const Macro=(globalThis as unknown as {Macro:{create(data:object):Promise<unknown>}}).Macro;
    for(const status of ["climbing","swimming"] as const) {
        if(macros.some(m=>m.getFlag(MODULE_ID,"macro")===`toggle-${status}`))continue;
        await Macro.create({name:`Toggle ${status==="climbing"?"Climbing":"Swimming"}`,type:"script",img:`modules/${MODULE_ID}/dist/icons/${status}.svg`,
            command:`await game.modules.get("${MODULE_ID}").api.movement.toggleStatus({status:"${status}",tokenUuids:canvas.tokens.controlled.map(t=>t.document.uuid)});`,flags:{[MODULE_ID]:{macro:`toggle-${status}`}}});
    }
}
