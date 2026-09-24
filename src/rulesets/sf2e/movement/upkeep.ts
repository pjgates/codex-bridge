import { MODULE_ID } from "../../../constants.js";
import { isFlying } from "../flying/index.js";
import { movementFeatureEnabled } from "./settings.js";
import type { DecisionToken, DecisionUser } from "./decisions.js";
export function needsFlightConfirmation(airborne:boolean,flyUsed:boolean|null):boolean {return airborne && flyUsed===null;}
interface Upkeep {key:string;tokenUuid:string;combatUuid:string;round:number;turn:number;movementId:string;state:"pending"|"resolved"|"stale"|"resolving"|"recovery"}
interface UpkeepMessage {
    uuid:string;author:DecisionUser|null;flags:Record<string,{flightUpkeep?:Upkeep;flightUse?:{requestUuid:string;used:boolean}}>;
    update(changes:object):Promise<unknown>;
}
interface Encounter {uuid:string;round:number;turn:number}
const chat=():{create(data:object):Promise<UpkeepMessage>}=>(globalThis as unknown as {ChatMessage:{create(data:object):Promise<UpkeepMessage>}}).ChatMessage;
const busy=new Set<string>();

/** PF2e/SF2e emits pf2e.endTurn(combatant, encounter, userId) on the advancing client. */
export function activateFlightUpkeep(requestFall:(tokenUuid:string)=>Promise<void>):void {
    const hooks=Hooks as unknown as {on(name:string,callback:(...args:never[])=>unknown):void};
    hooks.on("pf2e.endTurn",(combatant:{id:string;token:DecisionToken|null},encounter:Encounter,userId:string)=>{
        if(userId!==game.user?.id || !movementFeatureEnabled("flightUpkeep")) return;
        const token=combatant.token;
        if(!token || !needsFlightConfirmation(isFlying(token.actor),null)) return;
        const key=`${encounter.uuid}:${encounter.round}:${encounter.turn}:${combatant.id}`;
        const messages=game.messages as unknown as {contents:UpkeepMessage[]};
        if(busy.has(key) || messages.contents.some(m=>m.flags[MODULE_ID]?.flightUpkeep?.key===key)) return;
        busy.add(key);
        void chat().create({content:`<p>${foundry.utils.escapeHTML(token.name)}: did you use Fly this turn, including hovering without moving?</p>`,
            flags:{[MODULE_ID]:{flightUpkeep:{key,tokenUuid:token.uuid,combatUuid:encounter.uuid,round:encounter.round,turn:encounter.turn,movementId:token.movement.id,state:"pending"}}}})
            .finally(()=>busy.delete(key));
    });
    hooks.on("renderChatMessageHTML",(message:UpkeepMessage,html:HTMLElement)=>{
        const data=message.flags[MODULE_ID]?.flightUpkeep;
        if(!data || html.querySelector(".codex-flight-upkeep")) return;
        const token=fromUuidSync(data.tokenUuid) as unknown as DecisionToken|null;
        if(!token || !game.user || !token.canUserModify(game.user,"update")) return;
        const controls=document.createElement("div");controls.className="codex-flight-upkeep";
        const status=document.createElement("p");status.textContent=`Flight upkeep: ${data.state}`;controls.append(status);
        if(data.state==="pending") for(const [used,label] of [[true,"Used Fly / hovered"],[false,"Missed Fly: resolve fall"]] as const) {
            const button=document.createElement("button");button.type="button";button.textContent=label;
            button.addEventListener("click",async()=>{button.disabled=true;try {
                await chat().create({content:`Flight upkeep choice: ${label}.`,flags:{[MODULE_ID]:{flightUse:{requestUuid:message.uuid,used}}}});
            } finally {button.disabled=false;}});controls.append(button);
        }
        html.append(controls);
    });
    hooks.on("createChatMessage",async(response:UpkeepMessage)=>{
        const choice=response.flags[MODULE_ID]?.flightUse;
        if(!choice || typeof choice.used!=="boolean" || !/^ChatMessage\.[A-Za-z0-9]+$/.test(choice.requestUuid) || game.users?.activeGM?.id!==game.user?.id) return;
        const message=fromUuidSync(choice.requestUuid) as unknown as UpkeepMessage|null;
        const data=message?.flags[MODULE_ID]?.flightUpkeep;
        if(!message || !data || data.state!=="pending" || busy.has(message.uuid)) return;
        const token=fromUuidSync(data.tokenUuid) as unknown as DecisionToken|null;
        if(!token || !response.author?.active || !token.canUserModify(response.author,"update") || !message.author || !token.canUserModify(message.author,"update")) return;
        const combat=fromUuidSync(data.combatUuid) as unknown as Encounter|null;
        busy.add(message.uuid);
        try {
            if(!movementFeatureEnabled("flightUpkeep") || !isFlying(token.actor) || token.movement.id!==data.movementId || combat?.round!==data.round || combat.turn!==data.turn) {
                await message.update({[`flags.${MODULE_ID}.flightUpkeep.state`]:"stale"});return;
            }
            await message.update({[`flags.${MODULE_ID}.flightUpkeep.state`]:"resolving"});
            if(!choice.used) await requestFall(token.uuid);
            await message.update({[`flags.${MODULE_ID}.flightUpkeep.state`]:"resolved"});
        } catch(error) {
            await message.update({[`flags.${MODULE_ID}.flightUpkeep.state`]:"recovery"});
            console.error(`${MODULE_ID} | Flight upkeep needs GM recovery`,error);
        } finally {busy.delete(message.uuid);}
    });
}
