import { maskContains, maskRegions } from "./clip-tiles/mask.js";
import {MODULE_ID} from '../constants.js';

interface Observer {active:boolean;pc:boolean}
/** No GM omniscience or fog memory: an active PC must currently see the token. */
export function canOutlineToken<T extends Observer>(token:{hidden:boolean;filtered:boolean},sources:T[],sees:(s:T)=>boolean,covered:()=>boolean):boolean {
    return !token.hidden&&!token.filtered&&sources.some(s=>s.active&&s.pc&&sees(s))&&covered();
}

interface Point {x:number;y:number;elevation:number}
interface Mesh extends PIXI.Sprite {
    elevation:number;containsCanvasPoint(p:Point,threshold?:number):boolean;
    object?:{document:{flags?:Record<string,Record<string,unknown>>}};
}
interface TokenView {
    id:string;isFilteredOut:boolean;mesh:Mesh|null;
    document:{hidden:boolean;elevation:number;level:string;getVisibilityTestPoints():Point[]};
}
interface VisionSource {active:boolean;isBlinded:boolean;object:{actor?:{hasPlayerOwner:boolean};document:{detectionModes:Record<string,unknown>}}}
interface Mode {type:number;testVisibility(source:VisionSource,mode:unknown,config:unknown):boolean}
interface View {
    ready:boolean;stage:PIXI.Container;controls:PIXI.Container;
    tokens:{placeables:TokenView[]};tiles:{placeables:{mesh:Mesh|null}[]};primary:{levelTextures:Mesh[]};
    effects:{visionSources:Iterable<VisionSource>};
    visibility:{_createVisibilityTestConfig(points:Point[],options:object):unknown};
    scene:{grid:{units:string};regions:{get(id:string):{polygonTree:{testPoint(p:Point):boolean}}|undefined}};
    level:{elevation:{base:number}};
}

/** Reuse Foundry's sight tests and alpha-aware artwork bounds; draw only in the local UI layer. */
export function activateCoveredTokenOutlines():void {
    if(!game.settings!.get(MODULE_ID,'coveredTokenOutlines'))return;
    let layer:PIXI.Container|undefined,queued=false;
    const outlines=new Map<string,{sprite:PIXI.Sprite;label:PIXI.Text}>();
    const clear=()=>{layer?.destroy({children:true});layer=undefined;outlines.clear();};
    const refresh=()=>{
        queued=false;
        const view=canvas as unknown as View;
        if(!view.ready)return;
        layer??=view.controls.addChild(new PIXI.Container());layer.name='codex-covered-tokens';layer.eventMode='none';
        for(const {sprite,label} of outlines.values())sprite.visible=label.visible=false;
        const sources=[...view.effects.visionSources].map(source=>({source,active:source.active&&!source.isBlinded,pc:source.object.actor?.hasPlayerOwner===true}));
        const modes=CONFIG.Canvas.detectionModes as unknown as Record<string,Mode>;
        const artwork=[...view.primary.levelTextures,...view.tiles.placeables.flatMap(t=>t.mesh?[t.mesh]:[])];
        const present=new Set(view.tokens.placeables.map(t=>t.id));
        for(const [id,item] of outlines)if(!present.has(id)){item.sprite.destroy();item.label.destroy();outlines.delete(id);}
        for(const token of view.tokens.placeables){
            const mesh=token.mesh;if(!mesh)continue;
            const points=token.document.getVisibilityTestPoints();
            const config=view.visibility._createVisibilityTestConfig(points,{tolerance:0,object:token});
            const visible=canOutlineToken({hidden:token.document.hidden,filtered:token.isFilteredOut},sources,({source})=>
                Object.entries(source.object.document.detectionModes).some(([id,data])=>
                    modes[id]?.type===0&&modes[id].testVisibility(source,data,config)===true),()=>
                artwork.some(art=>art.visible&&art.renderable&&art.alpha>=0.5&&art.elevation>mesh.elevation&&points.some(p=>{
                    const mask=maskRegions({flags:art.object?.document.flags});
                    if(!maskContains(mask,id=>view.scene.regions.get(id)?.polygonTree.testPoint(p)===true))return false;
                    return art.containsCanvasPoint(p,0.5);
                })));
            if(!visible)continue;
            let item=outlines.get(token.id);
            if(!item){
                const sprite=layer.addChild(new PIXI.Sprite(mesh.texture));
                const filter=foundry.canvas.rendering.filters.OutlineOverlayFilter.create({outlineColor:[0.65,0.9,1,1],knockout:true});
                filter.animated=false;sprite.filters=[filter];
                const label=layer.addChild(new PIXI.Text('',{fontFamily:'sans-serif',fontSize:14,fill:0xc4efff,stroke:0x111820,strokeThickness:4}));
                label.anchor.set(0.5,0);item={sprite,label};outlines.set(token.id,item);
            }
            mesh.transform.updateLocalTransform();
            item.sprite.texture=mesh.texture;item.sprite.anchor.copyFrom(mesh.anchor);item.sprite.transform.setFromMatrix(mesh.localTransform);
            const delta=token.document.elevation-view.level.elevation.base;
            item.label.text=`${delta>0?'+':''}${Math.round(delta*10)/10} ${view.scene.grid.units}`;
            item.label.position.set(mesh.position.x,mesh.position.y+Math.abs(mesh.height)/2+4/view.stage.scale.x);
            item.label.scale.set(1/view.stage.scale.x);item.sprite.visible=item.label.visible=true;
        }
    };
    const schedule=()=>{if(!queued){queued=true;requestAnimationFrame(refresh);}};
    for(const event of ['sightRefresh','refreshToken','refreshTile','updateRegion','canvasPan','canvasReady'] as const)Hooks.on(event,schedule);
    Hooks.on('canvasTearDown',clear);
    schedule();
}
