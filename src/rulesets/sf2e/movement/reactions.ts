import type { Degree } from "./checks.js";

interface ReactionActor {
    getStatistic(slug:string):{withRollOptions(options:{extraRollOptions:string[]}):{mod:number}}|null;
}
export function reactionStatistics(actor:ReactionActor,action:string):{slug:string;label:string;bonus:number;selected:boolean}[] {
    const options=[["reflex","Reflex"],["acrobatics","Acrobatics"]].map(([slug,label])=>({slug,label,
        bonus:actor.getStatistic(slug)?.withRollOptions({extraRollOptions:[`action:${action}`,`check:statistic:${slug}`,`check:type:${slug==="reflex"?"saving-throw":"skill"}`,
            ...(action==="grab-an-edge"?["manipulate","item:trait:manipulate"]:[])]}).mod??-Infinity,selected:false}));
    const best=options.reduce((best,option)=>option.bonus>best.bonus?option:best);
    best.selected=true;
    return options;
}

export function edgeCatch(degree:Degree,freeHand:boolean):boolean {
    return degree===3 || (degree===2 && freeHand);
}

/** Distance fallen before reaching the attempted handhold, in feet. */
export function edgeImpact(distance:number,degree:Degree):{reduction:number;additional:number} {
    return {reduction:degree===3?30:degree===2?20:0,additional:degree===0?Math.floor(distance/20)*10:0};
}
