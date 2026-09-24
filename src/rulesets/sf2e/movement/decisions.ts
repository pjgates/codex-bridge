import { reactionGlyph, renderMovementCard, reportMovement } from "./card.js";
import { MODULE_ID } from "../../../constants.js";
import { type MovementToken, type Transition, type TransitionRef } from "./transitions.js";
export interface DecisionUser { id:string; isGM:boolean; active?:boolean }
export interface DecisionData { state:"pending"|"resolving"|"resolved"|"stale"|"recovery"; transition:Transition; rulingUuid?:string; dangerUuid?:string; waterUuid?:string; phase?:string; outcome?:string; tokenName?:string }
export interface DecisionResponse {requestUuid:string;action:string;checkUuid?:string;dc?:number;statistic?:string;danger?:"allowed"|"forbidden";water?:{endpoint:"surface"|"bed";diving:boolean}}
export interface DecisionMessage {
    uuid:string; author:DecisionUser|null;
    flags:Record<string,{movementDecision?:DecisionData; movementResponse?:DecisionResponse}>;
    update(changes:Record<string,unknown>):Promise<unknown>;
}
export type DecisionToken = MovementToken & {canUserModify(user:DecisionUser,action:string):boolean};
export type DecisionResolver = (token:DecisionToken, data:DecisionData, action:string, user:DecisionUser, message:DecisionMessage,response?:DecisionMessage)=>Promise<void|false>;
export interface DecisionControls {
    choices(token:DecisionToken,data:DecisionData):[string,string][];
    choose(action:string,token:DecisionToken,data:DecisionData,message:DecisionMessage):Promise<Partial<DecisionResponse>|null>;
}
const busy=new Set<string>();
export function isCurrentTransition(ref:TransitionRef,token:{uuid:string;movement:{id:string;state:string;user?:{active?:boolean}}}):boolean {
    return token.uuid===ref.tokenUuid && token.movement.id===ref.movementId && token.movement.state==="paused" &&
        ref.checkpoint===0 && token.movement.user?.active!==false;
}
const chat = (): {create(data:object):Promise<DecisionMessage>} => (globalThis as unknown as {ChatMessage:{create(data:object):Promise<DecisionMessage>}}).ChatMessage;
export async function openDecision(token:MovementToken,transition:Transition):Promise<string> {
    const message=await chat().create({
        speaker:{alias:token.name},
        content:renderMovementCard(token.name,{state:"pending",transition}),
        flags:{[MODULE_ID]:{movementDecision:{state:"pending",transition,tokenName:token.name}}},
    });
    if(transition.intent.kind==="forced" && transition.intent.danger==="forbidden") {
        await message.update({[`flags.${MODULE_ID}.movementDecision.state`]:"resolved",[`flags.${MODULE_ID}.movementDecision.outcome`]:"This forced effect cannot enter a dangerous destination. Movement stopped at the safe point."});
    }
    return message.uuid;
}
/** Only the active GM claims a request; persisted state prevents replay after reload. */
export async function resolveDecision(message:DecisionMessage,action:string,user:DecisionUser,resolve:DecisionResolver,response?:DecisionMessage):Promise<void> {
    if(game.users?.activeGM?.id!==game.user?.id || busy.has(message.uuid)) return;
    const data=message.flags[MODULE_ID]?.movementDecision;
    if(!data || data.state!=="pending" || !data.transition?.ref) return;
    const token=fromUuidSync(data.transition.ref.tokenUuid) as unknown as DecisionToken|null;
    if(!token || !user.active || !token.canUserModify(user,"update")) return;
    if(!user.isGM && !["stop","climb","swim","swim-auto","grab-an-edge","arrest-a-fall","fall"].includes(action)) return;
    busy.add(message.uuid);
    try {
        if(!isCurrentTransition(data.transition.ref,token)) {
            await message.update({[`flags.${MODULE_ID}.movementDecision.state`] : "stale"}); return;
        }
        if(message.author?.id!==token.movement.user?.id) return;
        await message.update({[`flags.${MODULE_ID}.movementDecision.state`] : "resolving"});
        if(!isCurrentTransition(data.transition.ref,token)) {
            await message.update({[`flags.${MODULE_ID}.movementDecision.state`]:"stale"});return;
        }
        const result=await resolve(token,data,action,user,message,response);
        await message.update({[`flags.${MODULE_ID}.movementDecision.state`] : result===false?"pending":"resolved"});
    } catch(error) {
        await message.update({[`flags.${MODULE_ID}.movementDecision.state`] : "recovery"});
        console.error(`${MODULE_ID} | Movement decision needs GM recovery`,error);
        ui.notifications!.error("Movement resolution was interrupted. Review the token and request before retrying.");
    } finally { busy.delete(message.uuid); }
}

export function activateMovementDecisions(resolve:DecisionResolver=async()=>{},uiControls?:DecisionControls):void {
    const hooks=Hooks as unknown as {on(name:string,callback:(...args:never[])=>unknown):void};
    hooks.on("renderChatMessageHTML",(message:DecisionMessage,html:HTMLElement)=>{
        if(message.flags[MODULE_ID]?.movementResponse) {html.hidden=true;html.style.display="none";return;}
        const data=message.flags[MODULE_ID]?.movementDecision;
        if(!data || html.querySelector(".codex-movement-decisions")) return;
        const token=fromUuidSync(data.transition.ref.tokenUuid) as unknown as DecisionToken|null;
        const content=html.querySelector<HTMLElement>(".message-content")??html;
        content.innerHTML=renderMovementCard(token?.name??data.tokenName??"Creature",data);
        if(!token || !game.user || !token.canUserModify(game.user,"update")) return;
        const controls=document.createElement("div"); controls.className="codex-movement-decisions";
        const gm=document.createElement("details");gm.className="codex-movement-gm";
        const summary=document.createElement("summary");summary.textContent="GM controls";gm.append(summary);
        const choices=data.state==="pending"?(uiControls?.choices(token,data)??[]).sort(([a],[b])=>Number(a==="fall")-Number(b==="fall")):[];
        if(data.state==="pending" && !choices.length) {
            const waiting=document.createElement("p");waiting.className="codex-movement-waiting";waiting.textContent="Waiting for a GM ruling.";controls.append(waiting);
        }
        const gmActions=new Set(["manual","dc","danger","water","climb-speed"]);
        if(data.state==="pending") for(const [action,label] of [...choices,["stop","Stop here"],...(game.user.isGM?[["manual","Resolve manually"]]:[])]) {
            const button=document.createElement("button"); button.type="button";button.textContent=label;
            if(action==="grab-an-edge" || action==="arrest-a-fall") button.insertAdjacentHTML("afterbegin",reactionGlyph()+" ");
            const gmOnly=gmActions.has(action);
            if(action!=="stop" && !gmOnly && action!=="fall") button.classList.add("codex-movement-primary");
            button.addEventListener("click",async()=>{
                button.disabled=true;
                try {
                    if(action==="stop" && token.movement.user?.id===game.user?.id && !game.users?.activeGM) {
                        if(isCurrentTransition(data.transition.ref,token)) token.stopMovement();
                        if(message.author?.id===game.user.id) {await reportMovement(message,"Movement stopped here.");await message.update({[`flags.${MODULE_ID}.movementDecision.state`]:"resolved"});}
                        return;
                    }
                    const extra=uiControls && !["stop","manual"].includes(action)?await uiControls.choose(action,token,data,message):{};
                    if(extra===null) return;
                    await chat().create({whisper:[...new Set([game.user!.id,game.users?.activeGM?.id].filter(Boolean))],content:`Movement choice: ${foundry.utils.escapeHTML(label)}.`,flags:{[MODULE_ID]:{movementResponse:{...extra,requestUuid:message.uuid,action}}}});
                } finally {button.disabled=false;}
            });
            (gmOnly && choices.some(([choice])=>!gmActions.has(choice))?gm:controls).append(button);
        }
        if(gm.children.length>1) controls.append(gm);
        content.querySelector(".codex-movement-card")!.append(controls);
    });
    hooks.on("updateChatMessage",(message:DecisionMessage)=>{
        const data=message.flags[MODULE_ID]?.movementDecision;
        if(data?.state!=="resolved") return;
        const token=fromUuidSync(data.transition.ref.tokenUuid) as unknown as DecisionToken|null;
        if(token && token.movement.user?.id===game.user?.id && message.author?.id===game.user?.id && isCurrentTransition(data.transition.ref,token)) token.stopMovement();
    });
    hooks.on("createChatMessage",(response:DecisionMessage)=>{
        const request=response.flags[MODULE_ID]?.movementResponse;
        if(!request || !response.author || !/^ChatMessage\.[A-Za-z0-9]+$/.test(request.requestUuid) ||
            !["stop","manual","dc","danger","water","climb","climb-speed","swim","swim-auto","grab-an-edge","arrest-a-fall","fall"].includes(request.action)) return;
        const message=fromUuidSync(request.requestUuid) as unknown as DecisionMessage|null;
        if(message) void resolveDecision(message,request.action,response.author,resolve,response);
    });
}
