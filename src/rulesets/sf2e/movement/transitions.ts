import { faceBetween, isFloorType, supportsAt, selectSupport, traceContacts, type ContactWaypoint, type SupportSelection, type SurfaceScene, type SurfaceRegion } from "../../../canvas/regions/index.js";
import { FALL_CONDITIONS, isFlying, setFlying } from "../flying/index.js";
import type { StatusActor } from "./status.js";
import { forcedIntent, forcedMovementHeld } from "./forced.js";
import { movementFeatureEnabled, movementOutcomeMode } from "./settings.js";
import { terrainChecksRequired } from "./policy.js";
import { contactSupports, movementSupports, waterAtHeight, swimmingTransition } from "./swim.js";

export interface Waypoint extends ContactWaypoint { action: string; checkpoint?: boolean; explicit?: boolean; snapped?: boolean }
export type MovementIntent = {kind:"voluntary"} | {kind:"forced"; danger:"unknown"|"allowed"|"forbidden"} | {kind:"placement"};
export interface TransitionRef { tokenUuid:string; movementId:string; checkpoint:number }
export interface Transition {
    ref: TransitionRef; reason:"climb"|"fall"|"swim"|"ruling";
    safe: Waypoint; after: Waypoint; landing: SupportSelection;
    initiatorId:string; intent:MovementIntent;
    sourceRegionId?:string; faceRegionId?:string; cause?:"support-loss";
}
export interface MovementToken {
    uuid:string; name:string; parent:SurfaceScene|null; actor:(StatusActor & NonNullable<Parameters<typeof isFlying>[0]> & {system?:{movement?:{speeds?:Partial<Record<"climb"|"swim"|"fly",{value:number}|null>>}}})|null;
    _source:Waypoint;
    movement:{id:string;chain?:string[];state:string;user?:{id:string;active:boolean};pending?:{waypoints:Waypoint[]}};
    getMovementOrigin(position: ContactWaypoint): {x:number;y:number};
    move(waypoints:Waypoint[], options:Record<string,unknown>): unknown;
    pauseMovement(key:string): unknown;
    stopMovement():unknown;
}
interface Operation {
    id:string; chain?:string[]; origin:Waypoint; passed:{waypoints:Waypoint[]}; pending:{waypoints:Waypoint[]};
    showRuler?:boolean;autoRotate?:boolean;method?:string;constrainOptions?:object;terrainOptions?:object;measureOptions?:object;
}
const PLANNED="codexMovementPlanned";
const scheduled=new Map<string,Transition>();
interface OwnedPath { id:string; awaiting:boolean; transition?:Transition; notified:boolean; travelFlight?:boolean }
const ownedPaths=new WeakMap<MovementToken,Map<string,OwnedPath>>();
const latestPath=new WeakMap<MovementToken,string>();
function supersede(token:MovementToken,id:string):void {
    const paths=ownedPaths.get(token),previous=paths?.get(latestPath.get(token)!);
    if(previous && !previous.awaiting) paths!.delete(previous.id);
    latestPath.set(token,id);
    scheduled.delete(token.uuid);
}
function ownPath(token:MovementToken,id:string,transition?:Transition):OwnedPath {
    supersede(token,id);
    const paths=ownedPaths.get(token)??new Map<string,OwnedPath>();
    ownedPaths.set(token,paths);
    const path={id,awaiting:true,transition,notified:false};paths.set(id,path);
    if(transition) scheduled.set(token.uuid,transition);
    return path;
}
function ownedPath(token:MovementToken,operation:Operation):OwnedPath|undefined {
    const paths=ownedPaths.get(token);
    return paths?.get(operation.id)??operation.chain?.map(id=>paths?.get(id)).find(Boolean);
}
const fallRequests=new Map<string,string>();
export const transitionKey=(ref:TransitionRef):string=>`codex-foundry:${ref.movementId}:${ref.checkpoint}`;

/** Special Speeds waive ordinary checks; unspecified/custom or hazardous terrain stays a GM choice. */
function ordinarySpeed(token:MovementToken,action:"climb"|"swim",region:SurfaceRegion|undefined):boolean {
    if(!(token.actor?.system?.movement?.speeds?.[action]?.value))return false;
    const data=[...(region?.behaviors??[])].find(b=>!b.disabled && b.type.endsWith(action==="climb"?".setElevation":".water"))?.system;
    return action==="climb" ? data?.climbDC==null && ["untrained","trained","expert"].includes(data?.climbPreset??"") :
        data?.swimDC==null && ["calm","flowing"].includes(data?.swimPreset??"");
}

/** Shared by execution and previews. Membership comes from exact polygon contacts. */
export function prepareTransition(token:MovementToken, operation:Operation, intent:MovementIntent): {waypoints:Waypoint[]; transition?:Omit<Transition,"ref"|"initiatorId">; changed:boolean} {
    const climbing=token.actor && [...token.actor.items].find(item=>(item as {flags?:Record<string,{climbingToken?:string}>}).flags?.["codex-foundry"]?.climbingToken===token.uuid);
    const suspended=!!climbing;
    const savedFace=climbing?.flags?.["codex-foundry"]?.climbingFaceRegionId;
    const requested=[...operation.passed.waypoints,...operation.pending.waypoints].map(w=>intent.kind==="forced"?{...w,action:"codex-forced"}:
        suspended && intent.kind==="voluntary" && ["walk","travel"].includes(w.action)?{...w,action:"climb"}:w);
    const unchanged={waypoints:requested,changed:intent.kind==="forced"};
    if (!token.parent || !requested.length || intent.kind==="placement") return unchanged;
    if (intent.kind!=="forced" && requested.some(w=>w.action==="displace" || w.action==="blink" || w.action==="teleport")) return unchanged;
    if (isFlying(token.actor) && (intent.kind==="forced" || requested.every(w=>w.action==="fly"))) return unchanged;
    if (requested.some(w=>w.action==="jump" || w.action==="leap")) return unchanged;
    const origin={...token._source,...operation.origin};
    const travelling=intent.kind==="voluntary" && requested.every(w=>w.action==="travel");
    const adaptive=travelling && movementOutcomeMode()==="apply";
    const uncheckedClimb=movementFeatureEnabled("climbing") && !terrainChecksRequired(token,"climbing");
    const uncheckedSwim=movementFeatureEnabled("swimming") && !terrainChecksRequired(token,"swimming");
    const labelModes=adaptive || (intent.kind==="voluntary" && requested.every(w=>["walk","travel"].includes(w.action)) && (uncheckedClimb || uncheckedSwim));
    const canFly=adaptive && (token.actor?.system?.movement?.speeds?.fly?.value??0)>0 &&
        ![...(token.actor?.items??[])].some(i=>i.type==="condition" && FALL_CONDITIONS.has(i.system.slug??""));
    const footPoint=(point:Waypoint):ContactWaypoint=>{
        const {x,y}=token.getMovementOrigin(point);
        return {...point,x,y};
    };
    const region=(id:string)=>[...token.parent!.regions].find(r=>r.id===id);
    const swims=(water:SurfaceRegion|undefined)=>adaptive && movementFeatureEnabled("swimming") && !!water && ordinarySpeed(token,"swim",water);
    const query=intent.kind==="voluntary"?contactSupports:supportsAt;
    const startWater=intent.kind==="voluntary"?waterAtHeight(token.parent,token.getMovementOrigin(origin),origin.elevation):undefined;
    const flightAt=(point:Waypoint):boolean=>{
        const water=waterAtHeight(token.parent!,token.getMovementOrigin(point),point.elevation);
        return canFly && (!water || point.elevation>=water.elevation!.top!);
    };
    const verticalWater=startWater && requested.some(w=>w.elevation!==origin.elevation);
    if(verticalWater && requested.some(w=>waterAtHeight(token.parent!,token.getMovementOrigin(w),w.elevation)?.id!==startWater.id)) {
        const safe={...origin,checkpoint:true};
        return {waypoints:[safe,...requested],changed:true,transition:{reason:"ruling",safe,after:requested[0],landing:{kind:"none"},intent}};
    }
    if(startWater && movementFeatureEnabled("swimming") && terrainChecksRequired(token,"swimming") && !swims(startWater) && !(flightAt(origin) && !verticalWater)) {
        const transition=swimmingTransition(token,origin,requested[0],startWater);
        if(Math.hypot(transition.after.x-origin.x,transition.after.y-origin.y,transition.after.elevation-origin.elevation)>0.001) {
            return {waypoints:[transition.safe,transition.after,...requested],changed:true,transition};
        }
    }
    if(verticalWater)return swims(startWater) || uncheckedSwim?{waypoints:requested.map(w=>({...w,action:"swim"})),changed:true}:unchanged;
    const mapped=[...token.parent.regions].some(r=>[...r.behaviors].some(b=>!b.disabled && isFloorType(b.type)));
    const declared=requested.find(w=>Math.abs(w.elevation-origin.elevation)>2.5);
    if(declared && mapped && requested.every(w=>w.x===origin.x && w.y===origin.y) &&
        movementFeatureEnabled(declared.elevation>origin.elevation?"climbing":"falling")) {
        const landing=selectSupport(supportsAt(token.parent,token.getMovementOrigin(declared)),declared.elevation,declared.level);
        const safe={...origin,checkpoint:true},after={...declared,checkpoint:false};
        const known=landing.kind==="surface" && Math.abs(landing.support.elevation-declared.elevation)<0.001;
        const descend=declared.elevation<origin.elevation-5 && ["walk","travel"].includes(declared.action) && movementFeatureEnabled("climbing");
        let reason:Transition["reason"]=known?(declared.elevation>origin.elevation || declared.action==="climb" || (descend && intent.kind==="voluntary")?(intent.kind==="forced"?"ruling":"climb"):"fall"):"ruling";
        let faceRegionId:string|undefined;
        if (reason === "climb") {
            const face = faceBetween(token.parent, footPoint(safe), footPoint(after));
            if (face.kind === "face" && (!savedFace || savedFace === face.regionId)) { faceRegionId = face.regionId; }
            else { reason = face.kind === "gap" && after.elevation < safe.elevation ? "fall" : "ruling"; }
        }
        if(reason==="climb" && uncheckedClimb) return {waypoints:requested.map(w=>({...w,action:"climb"})),changed:true};
        const source=selectSupport(supportsAt(token.parent,token.getMovementOrigin(origin)),origin.elevation,origin.level);
        const wall=known?region(declared.elevation<origin.elevation && source.kind==="surface"?source.support.regionId:landing.support.regionId):undefined;
        if(known && adaptive && (canFly || (reason==="climb" && ordinarySpeed(token,"climb",wall))))
            return {waypoints:requested.map(w=>({...w,action:reason==="climb" && ordinarySpeed(token,"climb",wall)?"climb":"fly"})),changed:true};
        return {waypoints:[safe,after,...requested],changed:true,transition:{reason,safe,after,landing,intent,faceRegionId,sourceRegionId:source.kind==="surface"?source.support.regionId:undefined}};
    }
    if(mapped && !startWater && !canFly && requested[0].action!=="climb" && movementFeatureEnabled("falling")) {
        const landing=selectSupport(supportsAt(token.parent,token.getMovementOrigin(origin)),origin.elevation,origin.level);
        if(suspended || landing.kind!=="surface" || origin.elevation-landing.support.elevation>2.5) {
            const safe={...origin,checkpoint:true},after={...origin,checkpoint:false};
            return {waypoints:[safe,...requested],changed:true,transition:{reason:suspended || landing.kind!=="surface"?"ruling":"fall",safe,after,landing,intent}};
        }
    }
    const chain=[origin,...requested.map(w=>({...origin,...w}))];
    const contacts=traceContacts(token.parent,token,chain,query);
    let elevation=origin.elevation,level=origin.level,changed=intent.kind==="forced" || labelModes;
    const startSupport=selectSupport(supportsAt(token.parent,token.getMovementOrigin(origin)),origin.elevation,origin.level);
    let mode=startWater?(swims(startWater)||!flightAt(origin)?"swim":"fly"):canFly && (startSupport.kind!=="surface" || origin.elevation-startSupport.support.elevation>2.5)?"fly":"walk";
    const path:Waypoint[]=[];
    for(let leg=0;leg<chain.length-1;leg++) {
        const a=chain[leg],b=chain[leg+1];
        for(const contact of contacts.filter(c=>c.leg===leg)) {
            const length=Math.hypot(b.x-a.x,b.y-a.y),delta=Math.min(1,1/Math.max(1,length));
            const point=(t:number):Waypoint=>({...b,x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,elevation,level,snapped:false,explicit:false,checkpoint:false});
            const next=contacts.find(c=>c.leg===leg && c.t>contact.t)?.t??1;
            const safe=point(Math.max(0,contact.t-delta)),after=point(Math.min((contact.t+next)/2,contact.t+delta));
            if(labelModes)safe.action=mode;
            const afterSupports=intent.kind==="voluntary"?movementSupports(token.parent,token.getMovementOrigin(after),elevation):supportsAt(token.parent,token.getMovementOrigin(after));
            const local=afterSupports.filter(s=>!s.levelIds.length||s.levelIds.includes(level));
            let landing=selectSupport(local,elevation+2.5,level);
            if(landing.kind==="none" && local.length) {
                const next=[...local].sort((x,y)=>x.elevation-y.elevation)[0];
                landing={kind:"surface",support:next,level};
            }
            if(landing.kind==="none") landing=selectSupport(afterSupports,elevation,level);
            if(landing.kind==="none" && afterSupports.length) {
                // An uphill ledge may belong to the next native level.
                const lowest=Math.min(...afterSupports.map(s=>s.elevation));
                landing=selectSupport(afterSupports,lowest,level);
            }
            if(landing.kind==="surface" && landing.support.elevation<elevation-2.5) landing=selectSupport(afterSupports,elevation,level);
            const rise=landing.kind==="surface" ? landing.support.elevation-elevation : -Infinity;
            // Independently quantized region outlines can leave a subpixel seam. Only bridge
            // it when this same leg immediately regains a floor within walking step height.
            if (rise < -2.5 && contact.before.some(s=>Math.abs(s.elevation-elevation)<=2.5) &&
                contacts.some(c=>c.leg===leg && c.t>contact.t && (c.t-contact.t)*length<1-1e-6 &&
                    c.after.some(s=>[...region(s.regionId)!.behaviors].some(b=>!b.disabled&&isFloorType(b.type)) &&
                        Math.abs(s.elevation-elevation)<=2.5))) continue;
            const descend=Number.isFinite(rise) && rise < -5 && ["walk","travel"].includes(b.action) && movementFeatureEnabled("climbing");
            let reason:Transition["reason"]|undefined=rise>2.5 ? (intent.kind==="forced"?"ruling":"climb") : rise < -2.5 ? ((b.action==="climb" || descend) && intent.kind==="voluntary"?"climb":"fall") : undefined;
            const climbCandidate=reason === "climb";
            let faceRegionId:string|undefined;
            if (climbCandidate && landing.kind === "surface") {
                const face = faceBetween(token.parent, footPoint(safe),
                    {...footPoint(after),elevation:landing.support.elevation});
                if (face.kind === "face" && (!savedFace || savedFace === face.regionId)) { faceRegionId = face.regionId; }
                else { reason = face.kind === "gap" && rise < 0 ? "fall" : "ruling"; }
            }
            const sources=supportsAt(token.parent,token.getMovementOrigin(safe));
            // During a partial descent the ledge is above the token's current height.
            const overhead=suspended && rise<0?sources.filter(s=>s.elevation>=elevation).sort((a,b)=>a.elevation-b.elevation)[0]:undefined;
            const source=selectSupport(overhead?[overhead]:sources,overhead?.elevation??elevation,level);
            const water=intent.kind==="voluntary"?waterAtHeight(token.parent,token.getMovementOrigin(after),elevation):undefined;
            if(adaptive) {
                const wall=landing.kind==="surface" ? region(rise>0?landing.support.regionId:source.kind==="surface"?source.support.regionId:"") : undefined;
                if(reason==="climb" && landing.kind==="surface" && movementFeatureEnabled("climbing") && ordinarySpeed(token,"climb",wall)) {
                    path.push(safe,{...after,elevation:landing.support.elevation,level:landing.level,action:"climb"});
                    elevation=landing.support.elevation;level=landing.level;mode="walk";continue;
                }
                if((reason || (water && !swims(water))) && flightAt(safe) && flightAt(after) && landing.kind!=="ambiguous") {
                    // Keep altitude over a drop; climb in the air only to clear an uphill surface.
                    if(landing.kind==="surface" && rise>0) {elevation=landing.support.elevation;level=landing.level;}
                    path.push(safe,{...after,elevation,level,action:"fly"});mode=rise>0?"walk":"fly";continue;
                }
            }
            if(labelModes) {mode=water?"swim":"walk";after.action=mode;}
            if(water && !reason && movementFeatureEnabled("swimming") && terrainChecksRequired(token,"swimming") && !swims(water)) {
                const transition=swimmingTransition(token,after,{...b,elevation},water);
                transition.safe={...safe,checkpoint:true};
                return {waypoints:[...path,transition.safe,transition.after,...chain.slice(leg+1)],changed:true,transition};
            }
            if(reason==="climb" && landing.kind==="surface" && movementFeatureEnabled("climbing") && !terrainChecksRequired(token,"climbing")) {
                path.push(safe,{...safe,elevation:landing.support.elevation,action:"climb",checkpoint:false});
                elevation=landing.support.elevation;level=landing.level;path.push({...after,elevation,level});changed=true;continue;
            }
            if(reason && movementFeatureEnabled(climbCandidate?"climbing":"falling")) {
                safe.checkpoint=true;
                path.push(safe,after,...chain.slice(leg+1));
                return {waypoints:path,changed:true,transition:{reason:landing.kind==="surface"?reason:"ruling",safe,after,landing,intent,faceRegionId,
                    sourceRegionId:source.kind==="surface"?source.support.regionId:undefined}};
            }
            if(!reason && landing.kind==="surface") {
                if(labelModes && safe.action!==mode)path.push(safe,{...after,action:mode});
                elevation=landing.support.elevation;level=landing.level;
                if(elevation!==a.elevation||level!==a.level) {path.push({...after,elevation,level});changed=true;}
            }
        }
        path.push({...b,elevation,level,...(labelModes?{action:mode}:{})});
    }
    if(mapped && declared && movementFeatureEnabled(declared.elevation>origin.elevation?"climbing":"falling")) {
        const safe={...origin,checkpoint:true},after={...declared,checkpoint:false};
        return {waypoints:[safe,...requested],changed:true,transition:{reason:"ruling",safe,after,landing:{kind:"none"},intent}};
    }
    return {waypoints:path,changed};
}

export function activateMovementTransitions(onPause:(token:MovementToken,transition:Transition)=>unknown = (token,transition)=> {
    ui.notifications!.warn(`${token.name}: ${transition.reason}. Movement paused; use Stop Movement to cancel.`);
}):void {
    const hooks=Hooks as unknown as {on(name:string,callback:(...args:never[])=>unknown):void};
    hooks.on("preMoveToken",(token:MovementToken,operation:Operation,options:Record<string,unknown>={})=>{
        const latest=latestPath.get(token);
        if(operation.chain?.length && latest && operation.id!==latest && !operation.chain.includes(latest))return false;
        const owned=ownedPath(token,operation);
        if(owned) {
            // Foundry drops custom options on continuation. An unresolved hazard
            // must never restart its remainder or generate another decision.
            return latestPath.get(token)===owned.id && (operation.id===owned.id || !owned.transition);
        }
        if(options[PLANNED]) {ownPath(token,operation.id);return true;}
        supersede(token,operation.id);
        if(!game.settings!.get("codex-foundry","enableCustomRules")) return true;
        const forcedPath=[...operation.passed.waypoints,...operation.pending.waypoints].some(w=>w.action==="codex-forced");
        const intent:MovementIntent=(movementFeatureEnabled("forcedMovement") && options.codexMovementIntent as MovementIntent) || forcedIntent(forcedMovementHeld() || forcedPath);
        const plan=prepareTransition(token,operation,intent);
        if(!plan.changed) return true;
        const id=foundry.utils.randomID();
        const planned=ownPath(token,id,plan.transition?{...plan.transition,ref:{tokenUuid:token.uuid,movementId:id,checkpoint:0},initiatorId:game.user!.id}:undefined);
        planned.travelFlight=intent.kind==="voluntary" && [...operation.passed.waypoints,...operation.pending.waypoints].every(w=>w.action==="travel");
        // Reissue after this rejected pre-update completes, with a native checkpoint.
        queueMicrotask(()=>{if(latestPath.get(token)!==id) {ownedPaths.get(token)?.delete(id);return;}
            void token.move(plan.waypoints,{id,[PLANNED]:true,showRuler:operation.showRuler,autoRotate:operation.autoRotate,
            method:operation.method,constrainOptions:operation.constrainOptions,terrainOptions:operation.terrainOptions,measureOptions:operation.measureOptions});});
        return false;
    });
    hooks.on("moveToken",(token:MovementToken,operation:Operation,_options:object,user:{id:string})=>{
        if(user.id!==game.user!.id) return;
        const path=ownedPath(token,operation);
        const latest=latestPath.get(token);
        if(latest && operation.id!==latest && !operation.chain?.includes(latest)) {
            if(token.movement.id===operation.id)token.stopMovement();
            if(path)ownedPaths.get(token)?.delete(path.id);return;
        }
        if(!path)return;
        path.awaiting=false;
        if(path.travelFlight && token.actor && movementOutcomeMode()==="apply") {
            const last=operation.passed.waypoints.at(-1);
            if(last)void setFlying(token.actor,last.action==="fly",true);
        }
        if(!operation.pending.waypoints.length) {ownedPaths.get(token)?.delete(path.id);scheduled.delete(token.uuid);return;}
        const transition=path.transition;
        if(!transition || path.notified)return;
        transition.ref.movementId=operation.id;
        if(token.pauseMovement(transitionKey(transition.ref))===null) return;
        path.notified=true;scheduled.delete(token.uuid);
        void onPause(token,transition);
    });
}

/** Queue a zero-displacement checkpoint before any descent; native movement supplies stale-request identity. */
export async function requestFall(tokenUuid:string,sourceRegionId?:string):Promise<void> {
    if(!movementFeatureEnabled("falling") || game.users?.activeGM?.id!==game.user?.id) return;
    const token=fromUuidSync(tokenUuid) as unknown as MovementToken|null;
    if(!token?.parent || !token.actor || scheduled.has(tokenUuid)) return;
    if(fallRequests.get(tokenUuid)===token.movement.id && ["pending","paused"].includes(token.movement.state)) return;
    const origin={...token._source,action:"codex-fall",snapped:false,explicit:false};
    const landing=selectSupport(supportsAt(token.parent,token.getMovementOrigin(origin)),origin.elevation,origin.level);
    const water=waterAtHeight(token.parent,token.getMovementOrigin(origin),origin.elevation);
    if((landing.kind==="surface" && Math.abs(landing.support.elevation-origin.elevation)<0.001) || water?.elevation?.top===origin.elevation) {
        if(movementOutcomeMode()==="apply") await setFlying(token.actor,false);
        return;
    }
    const id=foundry.utils.randomID(),safe={...origin,checkpoint:true};
    const transition:Transition={ref:{tokenUuid,movementId:id,checkpoint:0},reason:landing.kind==="surface"?"fall":"ruling",safe,after:origin,landing,
        intent:{kind:"voluntary"},initiatorId:game.user!.id,cause:"support-loss",sourceRegionId};
    ownPath(token,id,transition);fallRequests.set(tokenUuid,id);
    try {await token.move([safe,{...origin,elevation:origin.elevation-0.001,checkpoint:false}],{id,[PLANNED]:true});}
    catch(error) {scheduled.delete(tokenUuid);fallRequests.delete(tokenUuid);throw error;}
}

/** Project the executable safe prefix onto the ruler's original waypoint chain. */
export function previewElevations(token:MovementToken,chain:readonly Waypoint[],intent:MovementIntent):{elevations:number[];refusedFrom:number|null;plan?:ReturnType<typeof prepareTransition>} {
    if(!chain.length) return {elevations:[],refusedFrom:null};
    const origin={...token._source,...chain[0]};
    const plan=prepareTransition(token,{id:"preview",origin,passed:{waypoints:chain.slice(1)},pending:{waypoints:[]}},intent);
    const elevations=chain.map(w=>w.elevation);
    if(!plan.changed) return {elevations,refusedFrom:null,plan};
    let next=1;
    for(const point of plan.waypoints) {
        if(point===plan.transition?.safe) break;
        if(next<chain.length && point.x===chain[next].x && point.y===chain[next].y) elevations[next++]=point.elevation;
    }
    if(plan.transition) {
        const refusedFrom=next;
        while(next<chain.length) elevations[next++]=plan.transition.safe.elevation;
        return {elevations,refusedFrom,plan};
    }
    return {elevations,refusedFrom:null,plan};
}
