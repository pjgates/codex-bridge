import { MODULE_ID } from "../../../constants.js";
import type { MovementIntent } from "./transitions.js";
import { movementFeatureEnabled } from "./settings.js";
let held=false;
export function forcedIntent(value:boolean):MovementIntent {return value?{kind:"forced",danger:"unknown"}:{kind:"voluntary"};}
export function forcedMovementHeld():boolean {return held && movementFeatureEnabled("forcedMovement");}
function setHeld(value:boolean):void {
    held=value;
    if(canvas?.ready) for(const token of canvas.tokens!.controlled) token.renderFlags.set({refreshRuler:true});
}
export function registerForcedMovement():void {
    for(const [key,label] of [["codex-forced","forced"],["codex-fall","falling"]]) {
        Object.assign(CONFIG.Token.movement.actions,{[key]:{label:`${MODULE_ID}.movement.${label}`,icon:"fa-solid fa-arrows-up-down",
            canSelect:()=>false,teleport:false,walls:"move",getCostFunction:()=>()=>0,deriveTerrainDifficulty:()=>1}});
    }
    game.keybindings!.register(MODULE_ID,"forcedMovement",{
        name:`${MODULE_ID}.movement.forcedName`,hint:`${MODULE_ID}.movement.forcedHint`,editable:[{key:"KeyF"}],
        onDown:()=>{if(!movementFeatureEnabled("forcedMovement")) return false;setHeld(true);return true;},
        onUp:()=>{const previous=held;setHeld(false);return previous;},
    });
    window.addEventListener("blur",()=>setHeld(false));
    window.addEventListener("keydown",event=>{if(event.key==="Escape")setHeld(false);});
}
/** The native template already renders an action label when no icon is supplied. */
export function activateForcedPreview():void {
    const ruler=CONFIG.Token.rulerClass as unknown as {prototype:{_getWaypointLabelContext:(...args:unknown[])=>{action?:object;actionCost?:object;remaining?:string;budgetLabel?:string;budgetKnown?:boolean;budgetDescription?:string;movementLabel?:string}|undefined}};
    const original=ruler.prototype._getWaypointLabelContext;
    ruler.prototype._getWaypointLabelContext=function(...args) {
        const context=original.apply(this,args);
        if(context && forcedMovementHeld()) {
            context.action={label:`${MODULE_ID}.movement.forced`};delete context.actionCost;delete context.remaining;delete context.budgetLabel;
            context.movementLabel="Forced";context.budgetKnown=true;context.budgetDescription="Forced movement: 0 movement actions";
        }
        return context;
    };
}
