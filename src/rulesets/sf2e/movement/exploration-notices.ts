import { MODULE_ID } from "../../../constants.js";
import { terrainChecksRequired } from "./policy.js";
import { movementFeatureEnabled } from "./settings.js";
import type { MovementToken, Waypoint } from "./transitions.js";

export function activateExplorationNotices():void {
    const posted=new Map<string,string>();
    const progress=new Map<string,{key:string;climb:number;swim:number;seen:Set<string>}>();
    const hooks=Hooks as unknown as {on(name:string,fn:(...args:never[])=>unknown):void};
    hooks.on("moveToken",async(token:MovementToken&{hidden?:boolean;measureMovementPath(path:Waypoint[]):{waypoints:{distance:number}[]}},movement:{id:string;chain?:string[];origin:Waypoint;passed:{waypoints:Waypoint[]};pending:{waypoints:Waypoint[]}},options:{codexManualMovement?:boolean},user:{id:string})=>{
        if((game.users?.activeGM?.id??user.id)!==game.user?.id || !token.parent || options.codexManualMovement ||
            !game.settings!.get(MODULE_ID,"explorationMovementNotices") || token.movement.id!==movement.id)return;
        const key=movement.chain?.[0]??movement.id;
        if(posted.get(token.uuid)===key)return;
        const previous=progress.get(token.uuid);
        const totals=previous?.key===key?previous:{key,climb:0,swim:0,seen:new Set<string>()};
        if(!totals.seen.has(movement.id)) {
            const path=[{...movement.origin,action:"displace"},...movement.passed.waypoints];
            const measured=token.measureMovementPath(path).waypoints;
            for(let i=1;i<path.length;i++) {
                const action=path[i].action;
                if(action==="climb" || action==="swim")totals[action]+=Math.max(0,measured[i].distance-measured[i-1].distance);
            }
            totals.seen.add(movement.id);
        }
        progress.set(token.uuid,totals);
        if(movement.pending.waypoints.length)return;
        progress.delete(token.uuid);
        const units=(token.parent as typeof token.parent&{grid:{units:string}}).grid.units;
        const distance=(n:number)=>`${Math.round(n*100)/100} ${units}`;
        const actions=[totals.climb&&movementFeatureEnabled("climbing")&&!terrainChecksRequired(token,"climbing")?`climbs ${distance(totals.climb)}`:"",
            totals.swim&&movementFeatureEnabled("swimming")&&!terrainChecksRequired(token,"swimming")?`swims ${distance(totals.swim)}`:""].filter(Boolean);
        if(!actions.length)return;
        posted.set(token.uuid,key);
        const chat=(globalThis as unknown as {ChatMessage:{create(data:object):Promise<unknown>}}).ChatMessage;
        await chat.create({content:`<p>${foundry.utils.escapeHTML(`${token.name} ${actions.join(" and ")}`)}.</p>`,
            ...(token.hidden?{whisper:game.users!.filter(u=>u.isGM).map(u=>u.id)}:{}),
            flags:{[MODULE_ID]:{terrainNotice:{tokenUuid:token.uuid,movementId:key}}}});
    });
}
