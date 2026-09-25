import {reportMovement} from "./card.js";
import { selectSupport, supportsAt, waterLanding } from "../../../canvas/regions/index.js";
import { MODULE_ID } from "../../../constants.js";
import { fallOutcome, fallProfile, setFlying, type ProfileActor } from "../flying/index.js";
import { setClimbing } from "./climbing-state.js";
import { applyFallDamage } from "./damage.js";
import { movementFeatureEnabled, movementOutcomeMode } from "./settings.js";
import type { DecisionMessage } from "./decisions.js";
import type { MovementToken, Transition } from "./transitions.js";
import { assertMovementUnchanged } from "./guard.js";

type LandingToken=MovementToken & {id:string;parent:NonNullable<MovementToken["parent"]>&{id:string};
    actor:NonNullable<MovementToken["actor"]>&ProfileActor&Parameters<typeof applyFallDamage>[0]&{increaseCondition(slug:string):Promise<unknown>}};
export interface WaterChoice {endpoint:"surface"|"bed";diving:boolean}
export function softLandingReduction(depth:number,diving:boolean):number {return Math.min(Math.max(0,depth),diving?30:20);}
export interface FallReaction {water?:WaterChoice;arrested?:boolean;caught?:boolean;reduction?:number;additional?:number}
// Rule text checked against the PF2e/SF2e system packs; expired effects are filtered by fallProfile.
const unconditional=new Set(["cat-fall","superhero-landing","wind-pillow","plumekith","rubbery-body","land-on-your-feet",
    "unbreakable-er-goblin","current-rider","basic-insectile-flight","bouncy-orb-bantrid","spell-effect-ash-form","arrest-a-fall"]);
export function requiresMitigationRuling(profile:ReturnType<typeof fallProfile>):boolean {
    return [...profile.abilities.keys()].some(slug=>!unconditional.has(slug)) ||
        (profile.abilities.has("rubbery-body") && ["cat-fall","superhero-landing","wind-pillow"].some(slug=>profile.abilities.has(slug)));
}
/** The request is claimed before this function; uncertain phases are never automatically retried. */
export async function resolveLanding(token:LandingToken,transition:Transition,message:DecisionMessage,reaction:FallReaction={}):Promise<void> {
    let movementId=transition.ref.movementId,position={...token._source},state="paused";
    if(transition.landing.kind!=="surface") throw new Error("No unambiguous mapped landing; the GM must supply a ruling.");
    const actual=token.getMovementOrigin({...transition.after,x:Math.round(transition.after.x),y:Math.round(transition.after.y)});
    const support=selectSupport(supportsAt(token.parent,actual),transition.safe.elevation,transition.safe.level);
    if(support.kind!=="surface" || support.support.regionId!==transition.landing.support.regionId || support.support.elevation!==transition.landing.support.elevation) {
        throw new Error("The support changed or native coordinate rounding leaves this narrow surface. Resolve the landing manually.");
    }
    const profile=fallProfile(token.actor);
    if(requiresMitigationRuling(profile)) throw new Error("Conditional fall mitigation requires a GM ruling.");
    const water=waterLanding(token.parent,token.getMovementOrigin(transition.after),transition.safe.elevation,transition.landing.support.elevation);
    if(water && !reaction.caught && (water.depth===null || !reaction.water)) throw new Error("Water depth or the swimming/bed endpoint needs a GM ruling.");
    const distance=Math.max(0,transition.safe.elevation-(water?.surface??transition.landing.support.elevation));
    const waterReduction=water?.depth!==null && water?.depth!==undefined?softLandingReduction(water.depth,!!reaction.water?.diving):0;
    if(distance>500) throw new Error("This fall spans rounds; the GM must resolve its timing.");
    const outcome=fallOutcome(Math.max(0,(reaction.caught?0:distance)-(reaction.reduction??0)-waterReduction),profile);
    const damage=reaction.arrested?0:outcome.damage+(reaction.additional??0);
    if(!reaction.caught && !await foundry.applications.api.DialogV2.confirm({window:{title:"Confirm ordinary fall"},
        content:"<p>Does this fall use normal gravity and have a clear landing, with no creature collision or other exceptional rule? Confirm to resolve the ordinary fall. Otherwise cancel for a GM ruling.</p>",rejectClose:false})) {
        await reportMovement(message,"Fall requires a GM ruling. No automatic consequences applied.");return;
    }
    const advisory=movementOutcomeMode()==="advisory";
    const report=`${reaction.caught?"Caught the edge":`Fall ${distance} ft`}: ${damage} bludgeoning before resistances.${advisory?" Advisory: apply manually.":""}`;
    await reportMovement(message,report);
    if(advisory) return;
    const guard=():void=>{
        assertMovementUnchanged(token,movementId,position,state);
        if(!movementFeatureEnabled("falling") || movementOutcomeMode()!=="apply" ||
            (transition.intent?.kind==="forced" && !movementFeatureEnabled("forcedMovement"))) throw new Error("Movement settings changed; resolve manually.");
    };
    guard();await message.update({[`flags.${MODULE_ID}.movementDecision.phase`]:"landing"});
    if(!reaction.caught) {
        const elevation=water && reaction.water?.endpoint==="surface"?water.surface:transition.landing.support.elevation;
        let level=transition.landing.level;
        if(water && reaction.water?.endpoint==="surface" && water.levelIds.length) {
            if(water.levelIds.includes(transition.safe.level)) level=transition.safe.level;
            else if(water.levelIds.length===1) level=water.levelIds[0];
            else throw new Error("The water surface belongs to ambiguous levels; resolve the landing manually.");
        }
        guard();movementId=foundry.utils.randomID();state="completed";
        position={...transition.after,x:Math.round(transition.after.x),y:Math.round(transition.after.y),elevation,level};
        await token.move([{...transition.after,elevation,level,action:"codex-fall",checkpoint:false}],{id:movementId,codexMovementPlanned:true});
        if(token._source.elevation!==elevation || token._source.level!==level || token._source.x!==Math.round(transition.after.x) || token._source.y!==Math.round(transition.after.y)) {
            if(token.movement.state==="pending" && token.movement.user?.id===game.user!.id) token.stopMovement();
            throw new Error("Native movement did not reach the landing. Check walls and other region behaviours before applying damage.");
        }
    }
    guard();await setFlying(token.actor,false);
    guard();await setClimbing(token.actor,token.uuid,!!reaction.caught);
    guard();await message.update({[`flags.${MODULE_ID}.movementDecision.phase`]:"damage"});
    guard();const applied=await applyFallDamage(token.actor,token,damage,transition.ref,guard);
    if(outcome.prone && applied>0 && !reaction.caught) {guard();await token.actor.increaseCondition("prone");}
    await reportMovement(message,`${report} Actual damage: ${applied}.${outcome.prone && applied>0 && !reaction.caught?" Prone applied.":""}`);
    await message.update({[`flags.${MODULE_ID}.movementDecision.phase`]:"complete"});
}
