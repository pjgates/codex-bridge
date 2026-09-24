import type { TransitionRef } from "./transitions.js";
interface DamageRoll { evaluate():Promise<unknown> }
interface DamageActor {uuid:string;applyDamage(options:{damage:DamageRoll;token:object;rollOptions:Set<string>}):Promise<unknown>}
interface DamageMessage {speaker:{scene?:string;token?:string};flags:Record<string,{context?:{type?:string;options?:string[]};appliedDamage?:{uuid:string}|null}>}
/** PF2e/SF2e applyDamage uses numeric damage as a bypass for IWR: always pass a typed roll. */
export async function applyFallDamage(actor:DamageActor,token:{id:string;parent:{id:string}|null},amount:number,ref:TransitionRef,assertCurrent:()=>void):Promise<number> {
    if(amount<=0) return 0;
    const RollClass=(CONFIG.Dice.rolls as unknown as {name:string;new(formula:string):DamageRoll}[]).find(roll=>roll.name==="DamageRoll");
    if(!RollClass) throw new Error("The system DamageRoll is unavailable; resolve this fall manually.");
    const damage=new RollClass(`${amount}[bludgeoning]`);await damage.evaluate();
    const marker=`codex-fall:${ref.movementId}:${ref.checkpoint}:${foundry.utils.randomID()}`;
    const amounts:number[]=[];let message:DamageMessage|undefined;
    const hooks=Hooks as unknown as {on(name:string,callback:(...args:never[])=>unknown):number;off(name:string,id:number):void};
    const actorHook=hooks.on("updateActor",(updated:{uuid:string},_changes:object,options:{damageTaken?:number})=>{
        if(updated.uuid===actor.uuid && typeof options.damageTaken==="number") amounts.push(options.damageTaken);
    });
    const messageHook=hooks.on("createChatMessage",(created:DamageMessage)=>{
        const flags=created.flags[game.system!.id];
        if(flags?.context?.type==="damage-taken" && flags.context.options?.includes(marker) &&
            created.speaker.token===token.id && created.speaker.scene===token.parent?.id) message=created;
    });
    try {
        assertCurrent();
        await actor.applyDamage({damage,token,rollOptions:new Set(["damage:falling",marker])});
        const applied=message?.flags[game.system!.id]?.appliedDamage;
        if(message && applied===null) return 0;
        // Exactly one actor operation plus our correlated system message establishes
        // actual damage, including temporary HP. Concurrent damage requires GM recovery.
        if(applied?.uuid===actor.uuid && amounts.length===1 && amounts[0]>=0) return amounts[0];
        throw new Error("Damage application could not be confirmed. Do not retry automatically; inspect the system damage card.");
    } finally {hooks.off("updateActor",actorHook);hooks.off("createChatMessage",messageHook);}
}
