import {reportMovement} from "./card.js";
import { terrainChecksRequired } from "./policy.js";
import { MODULE_ID } from "../../../constants.js";
import { isWaterType, selectSupport, supportsAt } from "../../../canvas/regions/index.js";
import { verifiedDegree } from "./checks.js";
import { assertMovementUnchanged } from "./guard.js";
import { movementFeatureEnabled, movementOutcomeMode } from "./settings.js";
import { swimProgress, waterAtHeight } from "./swim.js";
import type { DecisionMessage, DecisionResponse } from "./decisions.js";
import type { RuleToken } from "./resolution.js";
import type { Transition } from "./transitions.js";
import { hasEnvironmentalAir } from "./environmental-air.js";

export function isCalmSwim(token:RuleToken,transition:Transition):boolean {
    if(transition.landing.kind!=="surface")return false;
    const id=transition.landing.support.regionId;
    const data=[...([...token.parent!.regions].find(r=>r.id===id)?.behaviors??[])].find(b=>!b.disabled&&isWaterType(b.type))?.system;
    return data?.swimPreset==="calm" && data.swimDC==null;
}
export async function resolveSwim(token:RuleToken,transition:Transition,message:DecisionMessage,action:string,choice:DecisionResponse|undefined,userId:string,dc:number|null):Promise<void|false> {
    const automatic=action==="swim-auto" && isCalmSwim(token,transition);
    if(!automatic && (action!=="swim" || !choice?.checkUuid || dc===null))return false;
    const degree=automatic?3:verifiedDegree(fromUuidSync(choice!.checkUuid!) as never,{userId,actorId:token.actor.id,marker:`codex-check:${message.uuid}:swim`,dc:dc!,system:game.system!.id,action:"swim",statistic:"athletics"});
    if(degree===null)return false;
    const origin={...token._source};
    const grid=(token.parent as unknown as {grid:{size:number;distance:number}}).grid;
    const pixelsPerFoot=grid.size/grid.distance;
    const requested=Math.hypot((transition.after.x-origin.x)/pixelsPerFoot,(transition.after.y-origin.y)/pixelsPerFoot,transition.after.elevation-origin.elevation);
    const swimSpeed=token.actor.system.movement?.speeds?.swim?.value??0;
    const distance=automatic&&swimSpeed?Math.min(requested,swimSpeed):swimProgress(token.actor.system.movement?.speeds?.land?.value??25,degree,requested,swimSpeed,[...token.actor.items].some(item=>item.type==="feat" && item.system.slug==="quick-swim"));
    const air=degree===0?(hasEnvironmentalAir(token.actor)?" Active environmental protection supplies air; no breath round lost.":" If holding your breath, lose 1 round of air; track this on your sheet."):"";
    const report=`Swim: ${distance.toFixed(1)} ft progress.${air}${degree<2?" Sinking/current is resolved at turn end if required.":""}${movementOutcomeMode()==="advisory"?" Advisory: apply manually.":""}`;
    await reportMovement(message,report);
    if(!distance || movementOutcomeMode()!=="apply")return;
    const guard=():void=>{assertMovementUnchanged(token,transition.ref.movementId,origin);if(!movementFeatureEnabled("swimming")||movementOutcomeMode()!=="apply"||!terrainChecksRequired(token,"swimming"))throw Error("Swimming settings changed; resolve manually.");};
    guard();await message.update({[`flags.${MODULE_ID}.movementDecision.phase`]:"moving"});guard();
    const ratio=distance/requested;
    const destination={...origin,x:Math.round(origin.x+(transition.after.x-origin.x)*ratio),y:Math.round(origin.y+(transition.after.y-origin.y)*ratio),elevation:origin.elevation+(transition.after.elevation-origin.elevation)*ratio,level:ratio===1?transition.after.level:origin.level,action:"swim",checkpoint:false};
    const point=token.getMovementOrigin(destination),shore=selectSupport(supportsAt(token.parent!,point),destination.elevation,destination.level);
    if(!waterAtHeight(token.parent!,point,destination.elevation) && !(shore.kind==="surface" && shore.support.elevation===destination.elevation && shore.level===destination.level))throw Error("The swimming destination changed; resolve manually.");
    const id=foundry.utils.randomID();await token.move([destination],{id,codexMovementPlanned:true});
    assertMovementUnchanged(token,id,destination,"completed");
}
