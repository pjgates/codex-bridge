import type {DecisionData, DecisionMessage} from "./decisions.js";
import {MODULE_ID} from "../../../constants.js";

/** The system supplies Pathfinder2eActions on PF2e and SF2e, including HTML ruler labels. */
export const reactionGlyph=():string=>'<span class="codex-reaction" role="img" aria-label="Reaction"><span class="action-glyph" aria-hidden="true">R</span></span>';
export function transitionDescription(transition:DecisionData["transition"]):{title:string;description:string;distance:string} {
    const {reason,landing,safe,intent}=transition;
    const distance=landing.kind==="surface"?Math.round(Math.abs(safe.elevation-landing.support.elevation)*100)/100:null;
    const forced=intent.kind==="forced";
    if(reason==="climb") {
        const down=landing.kind==="surface"&&landing.support.elevation<safe.elevation;
        return {title:down?"Climb down":"Climb the ledge",description:down?"The route descends a steep drop. Climb down to continue.":"The route reaches a steep rise. Climb to continue toward the ledge.",distance:`${distance ?? "?"} ft ${down?"descent":"rise"}`};
    }
    if(reason==="swim") return {title:"Swim across",description:"The route enters water. Resolve swimming to continue.",distance:"Water crossing"};
    if(reason==="fall") return {title:"Fall from the ledge",description:forced?"Forced movement takes this creature off the ledge.":"There is no support at this elevation. Resolve the fall before continuing.",distance:`${distance ?? "?"} ft to mapped floor`};
    if(landing.kind==="none") return {title:"Landing unknown",description:"No mapped landing was found for this route. The GM needs to determine how movement continues.",distance:"GM ruling needed"};
    if(landing.kind==="ambiguous") return {title:"Choose a landing",description:"More than one landing is possible. The GM needs to resolve the destination.",distance:"GM ruling needed"};
    return {title:"Review this movement",description:"This transition needs a GM ruling before movement can continue.",distance:"Movement paused"};
}

export function renderMovementCard(name:string,data:DecisionData):string {
    const escape=foundry.utils.escapeHTML;
    const view=transitionDescription(data.transition);
    const status={pending:"Movement paused",resolving:"Resolving…",resolved:"Resolved",stale:"Route changed",recovery:"GM review needed"}[data.state];
    const detail=data.state==="stale"?"This route has changed. Start a new movement to continue.":
        data.state==="recovery"?"Resolution was interrupted. The GM must inspect the token before applying anything else.":
        data.state==="resolved"?(data.outcome??"Movement ended."):view.description;
    return `<section class="codex-movement-card" data-state="${data.state}" aria-label="Movement decision">
        <header><h3>${escape(view.title)}</h3><span class="codex-movement-state" role="status">${status}</span></header>
        <p class="codex-movement-character">${escape(name)}</p>
        <p class="codex-movement-description">${escape(detail)}</p>
        ${data.state==="pending"||data.state==="resolving"?`<div class="codex-movement-facts">${escape(view.distance)}${data.transition.intent.kind==="forced"?' · Forced movement':''}</div>`:""}
        ${data.state==="recovery"&&data.outcome?`<details><summary>Last recorded result</summary><p>${escape(data.outcome)}</p></details>`:""}
        ${data.state==="resolved"?`<details><summary>Movement details</summary><p>${escape(view.distance)}. ${escape(view.description)}</p></details>`:""}
    </section>`;
}

/** Keep the outcome on the original request; receipts are transport, native rolls remain in chat. */
export async function reportMovement(message:DecisionMessage,text:string):Promise<void> {
    await message.update({content:`<p>${foundry.utils.escapeHTML(text)}</p>`,[`flags.${MODULE_ID}.movementDecision.outcome`]:text});
}
