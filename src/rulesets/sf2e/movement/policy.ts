import { MODULE_ID } from "../../../constants.js";
import type { MovementToken } from "./transitions.js";

function overrideFor(sceneId:string):boolean {
    const [owner,id]=game.settings!.get(MODULE_ID,"terrainCheckOverride").split(":");
    const user=game.users?.get(owner);
    return id===sceneId && !!user?.isGM && !!user.active;
}
export function terrainChecksRequired(token:Pick<MovementToken,"parent">,feature:"climbing"|"swimming"):boolean {
    const id=token.parent?.id;
    const inCombat=[...(game.combats??[])].some(combat=>combat.started && (combat.scene?.id===id ||
        (!combat.scene && combat.combatants.some(combatant=>combatant.token?.parent?.id===id))));
    return inCombat || !!(id && overrideFor(id)) || game.settings!.get(MODULE_ID,feature==="climbing"?"climbOutsideCombat":"swimOutsideCombat")!==false;
}
export async function clearTerrainOverride():Promise<void> {
    if(game.user?.isGM && game.settings!.get(MODULE_ID,"terrainCheckOverride").startsWith(`${game.user.id}:`)) {
        await game.settings!.set(MODULE_ID,"terrainCheckOverride","");
    }
}
export function registerTerrainPolicy():void {
    for(const key of ["climbOutsideCombat","swimOutsideCombat"] as const) game.settings!.register(MODULE_ID,key,{
        name:`${MODULE_ID}.settings.${key}.name`,hint:`${MODULE_ID}.settings.${key}.hint`,scope:"world",config:true,type:Boolean,default:true,
    });
    const refresh=():void=>{
        const controls=ui.controls as unknown as {controls?:Record<string,{tools:Record<string,{active:boolean}>}>;render(options:object):unknown};
        const tool=controls?.controls?.tokens?.tools.codexTerrainChecks;
        if(tool){tool.active=!!canvas?.scene && overrideFor(canvas.scene.id);controls.render({force:true});}
    };
    game.settings!.register(MODULE_ID,"terrainCheckOverride",{scope:"world",config:false,type:String,default:"",onChange:refresh});
    const hooks=Hooks as unknown as {on(name:string,callback:(...args:never[])=>unknown):void};
    hooks.on("getSceneControlButtons",(controls:Record<string,{tools:Record<string,unknown>}>)=>{
        if(!game.user?.isGM || !controls.tokens)return;
        controls.tokens.tools.codexTerrainChecks={name:"codexTerrainChecks",title:"Require terrain checks this scene session",icon:"fa-solid fa-person-hiking",toggle:true,
            active:!!canvas?.scene && overrideFor(canvas.scene.id),
            onChange:async(_event:Event,active:boolean)=>{await game.settings!.set(MODULE_ID,"terrainCheckOverride",active && canvas?.scene?`${game.user!.id}:${canvas.scene.id}`:"");}};
    });
    hooks.on("canvasTearDown",()=>{void clearTerrainOverride();});
    hooks.on("canvasReady",refresh);
}
