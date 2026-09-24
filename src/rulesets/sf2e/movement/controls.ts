import { isCalmSwim } from "./swim-resolution.js";
import { movementCheck } from "./checks.js";
import type { DecisionControls } from "./decisions.js";
import { checkMarker, currentTransition, transitionWater, transitionDC, type RuleToken } from "./resolution.js";
import { movementFeatureEnabled } from "./settings.js";
import { reactionStatistics } from "./reactions.js";

export const movementControls:DecisionControls={
    choices(token,data) {
        const transition=currentTransition(token,data)??data.transition;
        if(transition?.intent.kind==="forced" && transition.intent.danger!=="allowed") {
            return game.user?.isGM?[["danger","Resolve forced movement permission"]]:[];
        }
        if(transition?.reason==="swim" && movementFeatureEnabled("swimming")) {
            if(isCalmSwim(token as RuleToken,transition))return [["swim-auto","Swim in calm water (no roll)"]];
            const dc=transitionDC(token,data,"swim");
            return dc===null?(game.user?.isGM?[["dc","Set Swim DC"]]:[]):[["swim",`Swim (DC ${dc})`]];
        }
        if(transition?.reason==="fall" && movementFeatureEnabled("falling")) {
            if(transitionWater(token,transition) && !data.waterUuid) return game.user?.isGM?[["water","Set water landing / dive"]]:[];
            const choices:[string,string][]=[["fall","Decline reactions and fall"]];
            if((token as RuleToken).actor?.system.movement?.speeds?.fly?.value) choices.push(["arrest-a-fall","Arrest a Fall (DC 15)"]);
            if(data.transition.sourceRegionId) {
                const dc=transitionDC(token,data,"grab-an-edge");
                if(dc!==null) choices.push(["grab-an-edge",`Grab an Edge (DC ${dc})`]);
                else if(game.user?.isGM) choices.push(["dc","Set edge DC"]);
            }
            return choices;
        }
        if(transition?.reason!=="climb" || !movementFeatureEnabled("climbing")) return [];
        const dc=transitionDC(token,data,"climb");
        const choices:[string,string][]=dc===null?(game.user?.isGM?[["dc","Set terrain DC"]]:[]):[["climb",`Climb (DC ${dc})`]];
        if(game.user?.isGM && (token as RuleToken).actor?.system.movement?.speeds?.climb?.value) choices.push(["climb-speed","Use climb Speed (GM)"]);
        return choices;
    },
    async choose(action,token,data,message) {
        if(action==="climb-speed") {
            const allowed=await foundry.applications.api.DialogV2.confirm({window:{title:"Climb Speed"},content:"<p>Confirm this is an ordinary climb requiring no check, and the creature meets its hand or anatomical requirements.</p>",rejectClose:false});
            return allowed?{}:null;
        }
        if(action==="water") {
            const transition=currentTransition(token,data);
            const water=transition && transitionWater(token,transition);
            if(!water || water.depth===null) {ui.notifications!.warn("Author the local water depth or resolve this landing manually.");return null;}
            const result=await foundry.applications.api.DialogV2.prompt({window:{title:"Water landing"},
                content:`<p>Local depth: ${water.depth} ft. Choose a supported endpoint for this creature.</p><label>Endpoint <select name="endpoint"><option value="surface">Swimming at the surface</option><option value="bed">Bed below the surface</option></select></label><label><input name="diving" type="checkbox"> Intentionally dove into the water</label>`,
                ok:{label:"Confirm landing",callback:(_event:Event,button:HTMLButtonElement)=>({endpoint:(button.form!.elements.namedItem("endpoint") as HTMLSelectElement).value,diving:(button.form!.elements.namedItem("diving") as HTMLInputElement).checked})},rejectClose:false}) as {endpoint:"surface"|"bed";diving:boolean}|null;
            return result?{water:result}:null;
        }
        if(action==="danger") {
            const danger=await foundry.applications.api.DialogV2.prompt({window:{title:"Forced movement"},
                content:'<p>Can this effect force the creature into danger?</p><label>Effect <select name="danger"><option value="allowed">Push/pull, or explicitly permits danger</option><option value="forbidden">Other forced movement: dangerous destination forbidden</option></select></label>',
                ok:{label:"Confirm effect",callback:(_event:Event,button:HTMLButtonElement)=>(button.form!.elements.namedItem("danger") as HTMLSelectElement).value},rejectClose:false}) as "allowed"|"forbidden"|null;
            return danger?{danger}:null;
        }
        if(action==="dc") {
            const dc=await foundry.applications.api.DialogV2.prompt({window:{title:"Terrain DC"},
                content:'<label>DC <input name="dc" type="number" min="0" step="1" required></label>',
                ok:{label:"Set DC",callback:(_event:Event,button:HTMLButtonElement)=>(button.form!.elements.namedItem("dc") as HTMLInputElement).valueAsNumber},rejectClose:false}) as number|null;
            return dc!==null && Number.isInteger(dc) && dc>=0?{dc}:null;
        }
        if(action==="fall" || action==="swim-auto") return {};
        if(action==="arrest-a-fall" || action==="grab-an-edge") {
            const dc=action==="arrest-a-fall"?15:transitionDC(token,data,"grab-an-edge");
            if(dc===null || !token.actor) return null;
            const options=reactionStatistics(token.actor as unknown as Parameters<typeof reactionStatistics>[0],action)
                .map(s=>`<option value="${s.slug}"${s.selected?" selected":""}>${s.label}${Number.isFinite(s.bonus)?` (${s.bonus>=0?"+":""}${s.bonus})`:""}</option>`).join("");
            const statistic=await foundry.applications.api.DialogV2.prompt({window:{title:action==="arrest-a-fall"?"Arrest a Fall":"Grab an Edge"},
                content:'<p>Confirm you can use your reaction'+(action==="grab-an-edge"?' and reach a solid edge or handhold':'')+`. This spends the reaction; track its use on your sheet.</p><label>Check <select name="statistic">${options}</select></label>`,
                ok:{label:"Use reaction",callback:(_event:Event,button:HTMLButtonElement)=>(button.form!.elements.namedItem("statistic") as HTMLSelectElement).value},rejectClose:false}) as string|null;
            if(!statistic) return null;
            const result=await movementCheck(token.actor,action,statistic,dc,checkMarker(message,action));
            return result?.message?{checkUuid:result.message.uuid,statistic}:null;
        }
        if(action==="climb" || action==="swim") {
            const dc=transitionDC(token,data,action);
            if(dc===null || !token.actor) return null;
            const result=await movementCheck(token.actor,action,"athletics",dc,checkMarker(message,action));
            return result?.message?{checkUuid:result.message.uuid,statistic:"athletics"}:null;
        }
        return null;
    },
};
