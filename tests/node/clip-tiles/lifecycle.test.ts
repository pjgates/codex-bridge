import Clipper from 'clipper-lib';
import {afterEach,expect,it,vi} from 'vitest';
import {activateClipTiles} from '../../../src/canvas/clip-tiles/clip.js';
afterEach(()=>vi.unstubAllGlobals());
it('restores saved masks when activated after canvas draw and on subsequent scene loads',()=>{
 vi.stubGlobal('ClipperLib',Clipper);
 const hooks=new Map<string,Function>();vi.stubGlobal('Hooks',{on:(n:string,f:Function)=>hooks.set(n,f)});
 class Graphics {parent:unknown;beginFill(){}drawPolygon(){}endFill(){}destroy(){}}
 vi.stubGlobal('PIXI',{Graphics,Rectangle:class{},Point:class{constructor(public x:number,public y:number){}}});
 const region={id:'r',polygonTree:{children:[{isHole:false,polygon:{points:[0,0,10,0,10,10]},children:[]}]}};
 const scene={id:'s',regions:new Map([['r',region]])};
 const tile=()=>({document:{parent:scene,flags:{'codex-foundry':{clipRegion:'r'}}},mesh:{getLocalBounds:()=>({x:0,y:0,right:10,bottom:10}),mask:null,transform:{updateLocalTransform(){}},localTransform:{a:1,b:0,c:0,d:1,tx:0,ty:0,clone:()=>({invert:()=>({apply:(p:unknown)=>p})})},addChild(g:Graphics){g.parent=this;},removeChild(){}}});
 const first=tile(),second=tile();vi.stubGlobal('canvas',{ready:true,scene,tiles:{placeables:[first]}});
 activateClipTiles();expect(first.mesh.mask).toBeInstanceOf(Graphics);
 (canvas.tiles as any).placeables=[second];hooks.get('canvasReady')!();expect(second.mesh.mask).toBeInstanceOf(Graphics);
});
