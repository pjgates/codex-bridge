import {reportMovement} from "./card.js";
import { MODULE_ID } from "../../../constants.js";
import { terrainDC, selectSupport, supportsAt, waterLanding } from "../../../canvas/regions/index.js";
import { resolveLanding } from "./landing.js";
import { edgeCatch, edgeImpact } from "./reactions.js";
import { setClimbing } from "./climbing-state.js";
import { climbProgress } from "./climb.js";
import { verifiedDegree } from "./checks.js";
import { requestFall, prepareTransition, type Transition } from "./transitions.js";
import type { DecisionData, DecisionMessage, DecisionResolver, DecisionToken } from "./decisions.js";
import { movementFeatureEnabled, movementOutcomeMode } from "./settings.js";
import { terrainChecksRequired } from "./policy.js";
import { resolveSwim } from "./swim-resolution.js";
import { waterAtHeight } from "./swim.js";
import { assertMovementUnchanged } from "./guard.js";

type RuleActor = NonNullable<DecisionToken["actor"]> & {
    id:string; uuid:string; handsFree?:number;
    system:{attributes?:{handsFree?:number};movement?:{speeds?:Record<string,{value:number}|null>}};
    increaseCondition(slug:string):Promise<unknown>;
};
export type RuleToken = DecisionToken & {actor:RuleActor;id:string};
export const checkMarker=(message:DecisionMessage,action:string):string=>`codex-check:${message.uuid}:${action}`;

/** Re-read native pending movement and scene geometry, never a player's claimed landing. */
export function currentTransition(token:DecisionToken,data:DecisionData):Transition|null {
    const pending=token.movement.pending?.waypoints??[];
    if(!pending.length) return null;
    if(data.transition.cause==="support-loss") {
        const safe={...token._source,action:"codex-fall"};
        const landing=selectSupport(supportsAt(token.parent!,token.getMovementOrigin(safe)),safe.elevation,safe.level);
        return {...data.transition,safe,after:safe,landing,reason:landing.kind==="surface"?"fall":"ruling"};
    }
    let intent=data.transition.intent;
    if(intent.kind==="forced" && intent.danger==="unknown" && data.dangerUuid) {
        const ruling=fromUuidSync(data.dangerUuid) as unknown as DecisionMessage|null;
        const danger=ruling?.flags[MODULE_ID]?.movementResponse?.danger;
        if(ruling?.author?.isGM && (danger==="allowed" || danger==="forbidden")) intent={kind:"forced",danger};
    }
    const plan=prepareTransition(token,{id:token.movement.id,origin:token._source,passed:{waypoints:[]},pending:{waypoints:pending}},intent);
    return plan.transition?{...plan.transition,ref:data.transition.ref,initiatorId:token.movement.user!.id}:null;
}
export function transitionDC(token:DecisionToken,data:DecisionData,action:"climb"|"grab-an-edge"|"swim"):number|null {
    const transition=currentTransition(token,data);
    if(!transition) return null;
    const descending=action==="climb" && transition.landing.kind==="surface" && transition.landing.support.elevation<transition.safe.elevation;
    const id=action==="climb" && transition.faceRegionId ? transition.faceRegionId : action!=="grab-an-edge" && !descending && transition.landing.kind==="surface"?transition.landing.support.regionId:transition.sourceRegionId;
    const region=[...(token.parent?.regions??[])].find(region=>region.id===id);
    const authored=terrainDC(region,action,!!(game as unknown as {pf2e?:{settings?:{variants?:{pwol?:{enabled:boolean}}}}}).pf2e?.settings?.variants?.pwol?.enabled);
    if(authored!==null) return authored;
    const ruling=data.rulingUuid?fromUuidSync(data.rulingUuid) as unknown as DecisionMessage:null;
    const response=ruling?.flags[MODULE_ID]?.movementResponse;
    return ruling?.author?.isGM && response?.requestUuid && response.dc!==undefined && Number.isInteger(response.dc) && response.dc>=0 ? response.dc:null;
}
export function transitionWater(token:DecisionToken,transition:Transition) {
    return token.parent && transition.landing.kind==="surface"?waterLanding(token.parent,token.getMovementOrigin(transition.after),transition.safe.elevation,transition.landing.support.elevation):null;
}
export async function movementReport(message:DecisionMessage,text:string):Promise<void> {
    await reportMovement(message,text);
}
export function assertApplication(feature:"climbing"|"falling",token:DecisionToken):void {
    if(!movementFeatureEnabled(feature) || movementOutcomeMode()!=="apply" || (feature==="climbing" && !terrainChecksRequired(token,"climbing"))) throw new Error("Movement settings changed; resolve manually.");
}
export const resolveMovementChoice:DecisionResolver=async(token,data,action,user,message,response)=>{
    if(action==="stop") {await movementReport(message,"Movement stopped here.");return;}
    if(action==="manual") {
        if(!user.isGM)return false;
        const origin={...token._source};
        assertMovementUnchanged(token,data.transition.ref.movementId,origin);
        const path=(token.movement.pending?.waypoints??[]).map(p=>({...p,action:"walk",checkpoint:false}));
        const destination=path.at(-1);
        if(!destination)return false;
        // Keep explicit heights; ordinary drags may have retained the starting
        // height when they paused, so use the authored destination floor if known.
        const point=token.getMovementOrigin(destination);
        if(token.parent && destination.elevation===origin.elevation && !waterAtHeight(token.parent,point,destination.elevation)) {
            const floors=supportsAt(token.parent,point),local=floors.filter(s=>!s.levelIds.length||s.levelIds.includes(destination.level));
            const floor=[...(local.length?local:floors)].sort((a,b)=>Math.abs(a.elevation-destination.elevation)-Math.abs(b.elevation-destination.elevation))[0];
            if(floor) {
                const landing=selectSupport([floor],floor.elevation,destination.level);
                if(landing.kind==="surface")Object.assign(destination,{elevation:floor.elevation,level:landing.level});
            }
        }
        const completed=await token.move(path,{id:foundry.utils.randomID(),codexMovementPlanned:true,codexManualMovement:true,
            constrainOptions:{ignoreWalls:false,ignoreCost:true}});
        await movementReport(message,completed?"GM override: moved to the destination without terrain checks.":"GM override: movement was blocked before the destination.");
        return;
    }
    const choice=response?.flags[MODULE_ID]?.movementResponse;
    if(action==="water") {
        if(user.isGM && choice?.water && ["surface","bed"].includes(choice.water.endpoint) && typeof choice.water.diving==="boolean") {
            await message.update({[`flags.${MODULE_ID}.movementDecision.waterUuid`]:response!.uuid});
        }
        return false;
    }
    if(action==="danger") {
        if(!user.isGM || !["allowed","forbidden"].includes(choice?.danger??"")) return false;
        if(choice!.danger==="forbidden") {await movementReport(message,"This forced effect cannot enter a dangerous destination. Movement stopped.");return;}
        await message.update({[`flags.${MODULE_ID}.movementDecision.dangerUuid`]:response!.uuid});return false;
    }
    if(action==="dc") {
        if(user.isGM && Number.isInteger(choice?.dc) && choice!.dc!>=0) {
            await message.update({[`flags.${MODULE_ID}.movementDecision.rulingUuid`]:response!.uuid});
        }
        return false;
    }
    for(const key of ["rulingUuid","dangerUuid","waterUuid"] as const) {
        const ruling=data[key]?fromUuidSync(data[key]!) as unknown as DecisionMessage:null;
        if(ruling && (!ruling.author?.isGM || ruling.flags[MODULE_ID]?.movementResponse?.requestUuid!==message.uuid)) return false;
    }
    if(data.transition.cause==="support-loss" && !message.author?.isGM) return false;
    if(data.transition.intent.kind==="forced" && !movementFeatureEnabled("forcedMovement")) throw new Error("Forced movement was disabled; resolve manually.");
    const transition=currentTransition(token,data);
    if(transition?.intent.kind==="forced" && transition.intent.danger!=="allowed") return false;
    if(!transition || !token.actor) throw new Error("The paused route changed; inspect the token before reissuing movement.");
    if(transition.reason==="swim" && movementFeatureEnabled("swimming")) return resolveSwim(token as RuleToken,transition,message,action,choice,user.id,transitionDC(token,data,"swim"));
    if(transition.reason==="fall" && movementFeatureEnabled("falling")) {
        const ruling=data.waterUuid?fromUuidSync(data.waterUuid) as unknown as DecisionMessage:null;
        const water=ruling?.flags[MODULE_ID]?.movementResponse?.water;
        if(transitionWater(token,transition) && !water) return false;
        if(action==="fall") {await resolveLanding(token as unknown as Parameters<typeof resolveLanding>[0],transition,message,{water});return;}
        if(!["grab-an-edge","arrest-a-fall"].includes(action) || !choice?.checkUuid) return false;
        const actor=(token as RuleToken).actor;
        if(action==="arrest-a-fall" && !(actor.system.movement?.speeds?.fly?.value)) return false;
        if(action==="grab-an-edge" && !transition.sourceRegionId) return false;
        const dc=action==="arrest-a-fall"?15:transitionDC(token,data,"grab-an-edge");
        if(dc===null) return false;
        if(!["reflex","acrobatics"].includes(choice.statistic??"")) return false;
        const degree=verifiedDegree(fromUuidSync(choice.checkUuid) as never,{userId:user.id,actorId:actor.id,marker:checkMarker(message,action),dc,system:game.system!.id,action,statistic:choice.statistic!});
        if(degree===null) return false;
        const freeHand=(actor.handsFree??actor.system.attributes?.handsFree??0)>0;
        await resolveLanding(token as unknown as Parameters<typeof resolveLanding>[0],transition,message,action==="arrest-a-fall"?{water,arrested:degree>=2}:
            {water,caught:edgeCatch(degree,freeHand),...edgeImpact(0,degree)});
        return;
    }
    if(!["climb","climb-speed"].includes(action) || transition.reason!=="climb" || !movementFeatureEnabled("climbing")) return false;
    const dc=transitionDC(token,data,"climb");
    const actor=(token as RuleToken).actor;
    const ordinarySpeed=action==="climb-speed" && user.isGM && (actor.system.movement?.speeds?.climb?.value??0)>0;
    if(!ordinarySpeed && (dc===null || !choice?.checkUuid)) return false;
    const degree=ordinarySpeed?2:verifiedDegree(fromUuidSync(choice!.checkUuid!) as never,{userId:user.id,actorId:actor.id,marker:checkMarker(message,action),dc:dc!,system:game.system!.id,action:"climb",statistic:"athletics"});
    if(degree===null || transition.landing.kind!=="surface") return false;
    const origin={...token._source}, target=transition.landing.support.elevation;
    const support=selectSupport(supportsAt(token.parent!,token.getMovementOrigin(origin)),origin.elevation,origin.level);
    const result=climbProgress({rise:target-origin.elevation,degree,handsFree:ordinarySpeed?2:actor.handsFree??actor.system.attributes?.handsFree??0,
        speed:actor.system.movement?.speeds?.land?.value??25,climbSpeed:actor.system.movement?.speeds?.climb?.value??0,
        combatClimber:[...actor.items].some(item=>item.type==="feat" && item.system.slug==="combat-climber"),
        quickClimb:!ordinarySpeed && [...actor.items].some(item=>item.type==="feat" && item.system.slug==="quick-climb"),
        stable:support.kind==="surface" && Math.abs(support.support.elevation-origin.elevation)<0.01});
    const assertFace=():void=>{
        const current=currentTransition(token,data);
        if(!current || current.reason!=="climb" || current.faceRegionId!==transition.faceRegionId ||
            current.landing.kind!=="surface" || transition.landing.kind!=="surface" ||
            current.landing.support.elevation!==transition.landing.support.elevation ||
            current.landing.support.regionId!==transition.landing.support.regionId ||
            current.landing.level!==transition.landing.level ||
            current.after.x!==transition.after.x || current.after.y!==transition.after.y ||
            (data.transition.faceRegionId && current.faceRegionId!==data.transition.faceRegionId)) {
            throw new Error("The climb surface changed; reassess this movement.");
        }
    };
    assertFace();
    const remaining=Math.max(0,Math.abs(target-origin.elevation)-result.distance);
    await movementReport(message,`Climb: ${result.distance} ft progress${result.distance?` ${target>origin.elevation?"up":"down"}; ${remaining} ft remaining to the ledge`:""}.${result.prone?" Fall prone.":""}${result.fall?" Fall requires resolution.":""} ${movementOutcomeMode()==="advisory"?"Advisory: apply manually.":""}`);
    if(movementOutcomeMode()!=="apply") return;
    assertMovementUnchanged(token,data.transition.ref.movementId,origin);
    assertApplication("climbing",token);
    assertFace();
    if(result.fall) {await requestFall(token.uuid,target<origin.elevation?transition.sourceRegionId:transition.landing.support.regionId);return;}
    if(result.prone) {assertApplication("climbing",token);await actor.increaseCondition("prone");}
    if(!result.distance) return;
    await message.update({[`flags.${MODULE_ID}.movementDecision.phase`]:"moving"});
    assertApplication("climbing",token);
    assertFace();
    assertMovementUnchanged(token,data.transition.ref.movementId,origin);
    const elevation=origin.elevation+Math.sign(target-origin.elevation)*result.distance;
    const complete=elevation===target;
    const destination={...(complete?transition.after:origin),elevation,level:complete?transition.landing.level:origin.level,action:"climb",checkpoint:false};
    const movementId=foundry.utils.randomID();
    await token.move([destination],{id:movementId,codexMovementPlanned:true});
    if(token._source.elevation!==elevation) throw new Error("Native collision prevented the resolved climb. Inspect the route before continuing.");
    assertMovementUnchanged(token,movementId,{...destination,x:Math.round(destination.x),y:Math.round(destination.y)},"completed");
    assertApplication("climbing",token);await setClimbing(actor,token.uuid,!complete,transition.faceRegionId);
};
