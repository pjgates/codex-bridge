/** SF2e Automation pays a charge when activating this effect, so zero spare
 * charges does not mean the current oxygen supply is exhausted. */
export function hasEnvironmentalAir(actor:{items:Iterable<{type:string;system:{slug?:string|null;expired?:boolean}}> }):boolean {
    return [...actor.items].some(item=>item.type==="effect" && item.system.slug==="environmental-protection-on" && item.system.expired!==true);
}
