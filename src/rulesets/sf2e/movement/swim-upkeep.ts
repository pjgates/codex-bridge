import { MODULE_ID } from "../../../constants.js";
import { selectSupport, supportsAt } from "../../../canvas/regions/index.js";
import { isFlying } from "../flying/index.js";
import { movementFeatureEnabled, movementOutcomeMode } from "./settings.js";
import { waterAtHeight } from "./swim.js";
import { hasEnvironmentalAir } from "./environmental-air.js";
import type { RuleToken } from "./resolution.js";
import type { Waypoint } from "./transitions.js";

interface Encounter {uuid:string;round:number;turn:number}
interface Upkeep {key:string;tokenUuid:string;movementId:string;origin:Waypoint;combatUuid:string;round:number;turn:number;state:string}
interface Message {uuid:string;author:{isGM:boolean}|null;flags:Record<string,{swimUpkeep?:Upkeep}>;update(data:object):Promise<unknown>}
const chat=()=>(globalThis as unknown as {ChatMessage:{create(data:object):Promise<Message>}}).ChatMessage;
const busy=new Set<string>();

export function swimConsequenceDestination(token:RuleToken,choice:"sink"|"current",current?:{distance:number;direction:number}):Waypoint|null {
    const origin=token._source,scene=token.parent!;
    const destination={...origin,action:"codex-forced",checkpoint:false};
    if(choice==="sink") {
        destination.elevation-=10;
        const floor=selectSupport(supportsAt(scene,token.getMovementOrigin(origin)),origin.elevation,origin.level);
        if(floor.kind==="surface" && floor.support.elevation>=destination.elevation) {
            destination.elevation=floor.support.elevation;destination.level=floor.level;
        }
    } else {
        if(!current || !Number.isFinite(current.distance) || current.distance<=0 || ![0,45,90,135,180,225,270,315].includes(current.direction))return null;
        const grid=(scene as typeof scene&{grid:{size:number;distance:number}}).grid;
        const pixels=current.distance*grid.size/grid.distance,angle=current.direction*Math.PI/180;
        destination.x=Math.round(origin.x+Math.sin(angle)*pixels);destination.y=Math.round(origin.y-Math.cos(angle)*pixels);
    }
    const point=token.getMovementOrigin(destination),floor=selectSupport(supportsAt(scene,point),destination.elevation,destination.level);
    return waterAtHeight(scene,point,destination.elevation) || (floor.kind==="surface" && Math.abs(floor.support.elevation-destination.elevation)<0.01)?destination:null;
}

export async function resolveSwimUpkeep(message:Message,choice:"sink"|"current"|"none",current?:{distance:number;direction:number}):Promise<void> {
    const data=message.flags[MODULE_ID]?.swimUpkeep;
    if(!game.user?.isGM || game.users?.activeGM?.id!==game.user.id || !message.author?.isGM || !data || data.state!=="pending" || busy.has(message.uuid))return;
    const token=fromUuidSync(data.tokenUuid) as unknown as RuleToken|null,combat=fromUuidSync(data.combatUuid) as unknown as Encounter|null;
    const unchanged=()=>!!token && token.movement.id===data.movementId && !["pending","paused"].includes(token.movement.state) &&
        (["x","y","elevation","level"] as const).every(k=>token._source[k]===data.origin[k]) && combat?.round===data.round && combat?.turn===data.turn;
    const finish=(state:string,text:string)=>message.update({[`flags.${MODULE_ID}.swimUpkeep.state`]:state,content:`<p>${foundry.utils.escapeHTML(text)}</p>`});
    busy.add(message.uuid);
    try {
        if(!unchanged() || !movementFeatureEnabled("swimming")) {await finish("stale","Swimming position or turn changed. Reassess the consequence.");return;}
        if(choice==="none") {await finish("resolved",`${token!.name}: no swimming consequence (GM ruling).`);return;}
        const destination=swimConsequenceDestination(token!,choice,current);
        if(!destination) {await finish("pending","The destination needs a mapped water volume or landing. Adjust the current or resolve manually.");return;}
        if(movementOutcomeMode()!=="apply") {await finish("resolved",`${token!.name}: ${choice==="sink"?"sink up to 10 ft":"move with the current"}. Advisory: apply manually.`);return;}
        await finish("resolving",`${token!.name}: resolving swimming consequence…`);
        if(!unchanged() || !movementFeatureEnabled("swimming") || movementOutcomeMode()!=="apply") {await finish("stale","Movement or settings changed during resolution.");return;}
        const completed=await token!.move([destination],{id:foundry.utils.randomID(),codexMovementPlanned:true,constrainOptions:{ignoreWalls:false,ignoreCost:true}});
        const distance=choice==="sink"?`${Math.max(0,data.origin.elevation-token!._source.elevation)} ft`:"with the current";
        await finish("resolved",`${token!.name}: ${completed?`moved ${distance}`:"movement blocked before the destination"}.`);
    } catch(error) {
        await finish("recovery","Swimming consequence interrupted. Inspect the token before resolving manually.");
        console.error(`${MODULE_ID} | Swimming upkeep`,error);
    } finally {busy.delete(message.uuid);}
}

export function activateSwimUpkeep():void {
    const hooks=Hooks as unknown as {on(name:string,fn:(...args:never[])=>unknown):void};
    const record=async(tokenUuid:string):Promise<void>=>{
        if(game.users?.activeGM?.id!==game.user?.id)return;
        for(const combat of game.combats??[]) if(combat.started && combat.combatant?.token?.uuid===tokenUuid) {
            await combat.combatant.setFlag(MODULE_ID,"swimSuccessRound",combat.round);
        }
    };
    hooks.on("moveToken",(token:RuleToken,movement:{origin:Waypoint;passed:{waypoints:Waypoint[]}})=>{
        if(movement.passed.waypoints.some(w=>w.action==="swim" && (w.x!==movement.origin.x||w.y!==movement.origin.y||w.elevation!==movement.origin.elevation)))void record(token.uuid);
    });
    hooks.on("createChatMessage",(message:{speaker:{actor?:string};author:User|null;flags:Record<string,{context?:{outcome?:string;options?:string[];type?:string}}>})=>{
        const context=message.flags[game.system!.id]?.context;
        if(context?.type!=="skill-check" || !["success","criticalSuccess"].includes(context.outcome??"") || !context.options?.includes("action:swim") || !message.author)return;
        for(const combat of game.combats??[]) {
            const token=combat.combatant?.token;
            if(token && token.actor?.id===message.speaker.actor && token.canUserModify(message.author,"update"))void record(token.uuid);
        }
    });
    hooks.on("pf2e.endTurn",async(combatant:{id:string;token:RuleToken|null;flags:Record<string,Record<string,unknown>>},encounter:Encounter)=>{
        const token=combatant.token;
        if(game.users?.activeGM?.id!==game.user?.id || !movementFeatureEnabled("swimming") || !token?.actor || !token.parent || isFlying(token.actor) || !waterAtHeight(token.parent,token.getMovementOrigin(token._source),token._source.elevation))return;
        const ended=combatant.flags[game.system!.id]?.roundOfLastTurnEnd;
        if(combatant.flags[MODULE_ID]?.swimSuccessRound===ended && typeof ended==="number")return;
        const key=`${encounter.uuid}:${ended}:${combatant.id}`,messages=game.messages as unknown as {contents:Message[]};
        if(busy.has(key)||messages.contents.some(m=>m.flags[MODULE_ID]?.swimUpkeep?.key===key))return;
        busy.add(key);
        try {
            await chat().create({whisper:game.users!.filter(u=>u.isGM).map(u=>u.id),
                content:`<p>${foundry.utils.escapeHTML(token.name)}: no successful Swim recorded this turn. Choose sinking, current movement, or no consequence (including entering water as the last action).${hasEnvironmentalAir(token.actor)?" Environmental protection supplies air; it does not prevent sinking.":""}</p>`,
                flags:{[MODULE_ID]:{swimUpkeep:{key,tokenUuid:token.uuid,movementId:token.movement.id,origin:{...token._source},combatUuid:encounter.uuid,round:encounter.round,turn:encounter.turn,state:"pending"}}}});
        } finally {busy.delete(key);}
    });
    hooks.on("renderChatMessageHTML",(message:Message,html:HTMLElement)=>{
        if(message.flags[MODULE_ID]?.swimUpkeep?.state!=="pending" || game.users?.activeGM?.id!==game.user?.id || html.querySelector(".codex-swim-upkeep"))return;
        const controls=document.createElement("div");controls.className="codex-swim-upkeep";
        for(const [choice,label] of [["sink","Sink up to 10 ft"],["current","Moved by current"],["none","No consequence"]] as const) {
            const button=document.createElement("button");button.type="button";button.textContent=label;
            button.addEventListener("click",async()=>{
                button.disabled=true;
                try {
                    let current:{distance:number;direction:number}|undefined;
                    if(choice==="current") {
                        const result=await foundry.applications.api.DialogV2.prompt({window:{title:"Water current"},content:'<label>Distance (ft) <input name="distance" type="number" min="0.1" step="any" value="10" required></label><label>Direction <select name="direction"><option value="0">North</option><option value="45">Northeast</option><option value="90">East</option><option value="135">Southeast</option><option value="180">South</option><option value="225">Southwest</option><option value="270">West</option><option value="315">Northwest</option></select></label>',ok:{label:"Move with current",callback:(_e:Event,b:HTMLButtonElement)=>({distance:(b.form!.elements.namedItem("distance") as HTMLInputElement).valueAsNumber,direction:Number((b.form!.elements.namedItem("direction") as HTMLSelectElement).value)})},rejectClose:false}) as typeof current|null;
                        if(!result)return;current=result;
                    }
                    await resolveSwimUpkeep(message,choice,current);
                } finally {button.disabled=false;}
            });controls.append(button);
        }
        (html.querySelector(".message-content")??html).append(controls);
    });
}
