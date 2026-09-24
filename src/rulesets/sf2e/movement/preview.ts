import {terrainDC} from "../../../canvas/regions/index.js";
import {climbProgress} from "./climb.js";
import {swimProgress} from "./swim.js";
import type {MovementToken, prepareTransition} from "./transitions.js";

export type MovementPlan=ReturnType<typeof prepareTransition>;
export interface PreviewSummary {label:string;hint:string;reaction:boolean;paused:boolean}
export function previewSummary(token:MovementToken,plan:MovementPlan):PreviewSummary {
    const t=plan.transition;
    if(!t) {
        const modes=plan.waypoints.map(w=>w.action).filter((mode,i,all)=>i===0||mode!==all[i-1]);
        const names:Record<string,string>={walk:"Walk",travel:"Walk",climb:"Climb",swim:"Swim",fly:"Fly","codex-forced":"Forced"};
        return {label:modes.map(m=>names[m]??m).join(" → "),hint:"",reaction:false,paused:false};
    }
    const distance=t.landing.kind==="surface"?Math.round(Math.abs(t.safe.elevation-t.landing.support.elevation)*100)/100:null;
    const descending=t.reason==="climb" && t.landing.kind==="surface" && t.landing.support.elevation<t.safe.elevation;
    const id=t.reason==="climb" && t.faceRegionId ? t.faceRegionId : t.reason==="fall" || descending?t.sourceRegionId:t.landing.kind==="surface"?t.landing.support.regionId:undefined;
    const region=[...(token.parent?.regions??[])].find(r=>r.id===id);
    const action=t.reason==="swim"?"swim":t.reason==="fall"?"grab-an-edge":"climb";
    const pwol=!!(game as unknown as {pf2e?:{settings?:{variants?:{pwol?:{enabled:boolean}}}}}).pf2e?.settings?.variants?.pwol?.enabled;
    const dc=terrainDC(region,action,pwol);
    const reaction=t.reason==="fall" && (!!t.sourceRegionId || (token.actor?.system?.movement?.speeds?.fly?.value??0)>0);
    const label=t.reason==="climb"?`Climb ${t.landing.kind==="surface"&&t.landing.support.elevation<t.safe.elevation?"↓":"↑"} ${distance} ft`:
        t.reason==="swim"?"Swim":t.reason==="fall"?`Fall ↓ ${distance} ft`:t.landing.kind==="none"?"Landing unknown":"GM ruling needed";
    if(t.intent.kind==="forced" && t.intent.danger!=="allowed") return {label,hint:t.intent.danger==="forbidden"?"Blocked":"GM: effect type",reaction:false,paused:true};
    return {label:label+(dc!==null&&["climb","swim"].includes(t.reason)?` · DC ${dc}`:""),
        hint:t.reason==="ruling"?"GM ruling":reaction?"Pause":dc===null?"GM sets DC":"Check",
        reaction,paused:true};
}

interface BudgetActor {system:{movement?:{speeds?:Record<string,{value:number;crawl?:number;step?:number}|null>}};items?:Iterable<{type:string;system:{slug?:string|null}}>}
export interface BudgetLeg {action:string;cost:number;check?:boolean}
/** Count contiguous actions separately when the movement mode changes. No action resources are spent here. */
export function routeBudget(actor:BudgetActor,legs:readonly BudgetLeg[]):{actions:number;remaining:number;estimated:boolean}|null {
    const speeds=actor.system.movement?.speeds??{},land=speeds.land?.value??0;
    const feats=new Set([...(actor.items??[])].filter(i=>i.type==="feat").map(i=>i.system.slug));
    let actions=0,remaining=0,estimated=false,mode="",cost=0,speed=0;
    const finish=():void=>{if(cost>0) {const count=Math.ceil((cost-1e-8)/speed);actions+=count;remaining=Math.max(0,count*speed-cost);}cost=0;};
    for(const leg of legs) {
        if(leg.cost<=0 || ["codex-forced","codex-fall","displace","teleport","blink"].includes(leg.action))continue;
        const action=leg.action==="travel"?"walk":leg.action;
        let next=action==="walk"?land:action==="crawl"?(speeds.land?.crawl??5):action==="step"?(speeds.land?.step??5):speeds[action]?.value??0;
        if(action==="climb" && (!next || leg.check)) next=climbProgress({rise:Infinity,degree:2,handsFree:2,climbSpeed:next,speed:land,quickClimb:feats.has("quick-climb")}).distance;
        if(action==="swim" && (!next || leg.check)) next=swimProgress(land,2,Infinity,next,feats.has("quick-swim"));
        if(!(next>0) || !Number.isFinite(leg.cost))return null;
        estimated ||= !!leg.check || (["climb","swim"].includes(action)&&!speeds[action]?.value);
        if(mode!==action || speed!==next) {finish();mode=action;speed=next;}
        cost+=leg.cost;
    }
    finish();return {actions,remaining,estimated};
}
