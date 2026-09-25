import {afterEach,expect,it,vi} from 'vitest';
import {configureSurfaceVisibility,activateSurfaceVisibility} from '../../../src/canvas/regions/visibility.js';
afterEach(()=>vi.unstubAllGlobals());
it('limits surface fading to suspended decks while solid terrain still blocks sight and light',async()=>{
 const {source,scene}=setup();
 const geometry=source.behaviors[1].system;
 geometry.blocksSight=geometry.blocksLight=true;
 await configureSurfaceVisibility({regionUuids:[source.uuid],apply:true});
 const native=scene.regions[1].behaviors[0];
 expect(native.system).toMatchObject({occlusion:false,sight:true,light:true});
 await configureSurfaceVisibility({regionUuids:[source.uuid],apply:true,fading:'on'});
 expect(native.system.occlusion).toBe(true);
 await configureSurfaceVisibility({regionUuids:[source.uuid],apply:true,fading:'inherit'});
 Object.assign(geometry,{extent:'solid',underside:null});
 await configureSurfaceVisibility({regionUuids:[source.uuid],apply:true});
 expect(native.system).toMatchObject({occlusion:false,sight:true,light:true});
 Object.assign(geometry,{extent:'finite',underside:7.5});
 await configureSurfaceVisibility({regionUuids:[source.uuid],apply:true});
 expect(native.system.occlusion).toBe(false);
});
function setup(){
 const docs=new Map<string,any>(),hooks=new Map<string,Function>();
 const scene:any={regions:[],createEmbeddedDocuments:vi.fn(async(_t:string,data:any[])=>data.map(d=>makeRegion(d,'companion')))};
 function makeBehavior(data:any,parent:any){const b:any={id:data._id??'native',uuid:`${parent.uuid}.RegionBehavior.${data._id??'native'}`,disabled:false,flags:{},...data,parent,
 update:vi.fn(async(p:any)=>{for(const [k,v] of Object.entries(p)){const parts=k.split('.');let o=b;for(const part of parts.slice(0,-1))o=o[part]??={};o[parts.at(-1)!]=v;}return b;})};docs.set(b.uuid,b);return b;}
 function makeRegion(data:any,id:string){const r:any={documentName:'Region',id,uuid:`Scene.s.Region.${id}`,flags:{},shapes:[],levels:new Set(),bounds:{left:0,top:0,right:100,bottom:100},...data,parent:scene,
 update:vi.fn(async(p:any)=>{for(const[k,v]of Object.entries(p)){if(k==='flags.codex-foundry.surfaceVisibility')r.flags['codex-foundry']={...r.flags['codex-foundry'],surfaceVisibility:v};else r[k]=v;}return r;}),
 delete:vi.fn(async()=>{scene.regions=scene.regions.filter((x:any)=>x!==r);docs.delete(r.uuid);}),
 toObject:()=>({shapes:r.shapes,elevation:r.elevation})};
 r.behaviors=(data.behaviors??[]).map((b:any)=>makeBehavior(b,r));scene.regions.push(r);docs.set(r.uuid,r);return r;}
 const source=makeRegion({shapes:[{type:'rectangle',x:0,y:0,width:100,height:100}],behaviors:[
 {_id:'floor',type:'codex-foundry.setElevation',system:{elevation:10}},
 {_id:'geometry',type:'codex-foundry.surfaceGeometry',system:{extent:'finite',underside:7.5,blocksSight:false,blocksLight:false}},
 {_id:'old',type:'defineSurface',system:{placement:'bottom',sight:true,light:true,sound:true,occlusion:false},flags:{custom:{keep:1}}},
 {_id:'unrelated',type:'defineSurface',system:{sight:true,light:true,sound:false}}
 ]},'source');
 const gm={id:'gm',isGM:true,active:true};vi.stubGlobal('game',{user:gm,users:{activeGM:gm},scenes:[scene],settings:{get:()=>false}});
 vi.stubGlobal('fromUuidSync',(uuid:string)=>docs.get(uuid));vi.stubGlobal('Hooks',{on:(n:string,f:Function)=>hooks.set(n,f)});
 return {source,scene,hooks,gm,makeRegion};
}
it('previews without writing, adopts only selected blockers and applies idempotently',async()=>{
 const {source,scene}=setup(),request={regionUuids:[source.uuid],adoptBehaviorUuids:[source.behaviors[2].uuid]};
 const preview=await configureSurfaceVisibility(request);expect(preview).toMatchObject({ok:true,applied:false});
 expect(source.update).not.toHaveBeenCalled();expect(scene.createEmbeddedDocuments).not.toHaveBeenCalled();
 const result=await configureSurfaceVisibility({...request,apply:true});expect(result).toMatchObject({ok:true,applied:true});
 expect(source.behaviors[2].system).toMatchObject({sight:false,light:false,sound:true});expect(source.behaviors[2].flags.custom).toEqual({keep:1});
 expect(source.behaviors[3].system.sight).toBe(true);expect('conflicts'in result&&result.conflicts.join()).toContain('unrelated');
 expect(scene.regions[1]).toMatchObject({levels:[],elevation:{bottom:10,top:10}});
 expect(await configureSurfaceVisibility({...request,apply:true})).toMatchObject({changes:[]});
 source.behaviors[1].disabled=true;await configureSurfaceVisibility({regionUuids:[source.uuid],apply:true});expect(scene.regions).toHaveLength(1);
});
it('only the active GM reconciles edits and removed geometry cleans its companion',async()=>{
 const {source,scene,hooks}=setup();await configureSurfaceVisibility({regionUuids:[source.uuid],apply:true});activateSurfaceVisibility();
 (game as any).user={id:'other',isGM:true};source.behaviors=source.behaviors.filter((b:any)=>b.type!=='codex-foundry.surfaceGeometry');
 await hooks.get('updateRegion')!(source);expect(scene.regions).toHaveLength(2);
 (game as any).user=(game as any).users.activeGM;await hooks.get('updateRegion')!(source);expect(scene.regions).toHaveLength(1);
});
it('recognizes an exported companion by its scene-scoped surface key',async()=>{
 const {source,scene}=setup();source.flags['map-workshop']={surfaceKey:'export-key'};
 await configureSurfaceVisibility({regionUuids:[source.uuid],apply:true});
 const companion=scene.regions[1];delete companion.flags['codex-foundry'].surfaceSource;companion.flags['codex-foundry'].surfaceSourceKey='export-key';
 expect(await configureSurfaceVisibility({regionUuids:[source.uuid],apply:true})).toMatchObject({changes:[]});
});
it('moves owned sight/light restrictions off a stale source plane while preserving sound',async()=>{
 const {source,scene}=setup();source.elevation={bottom:10,top:10};source.behaviors[0].system.elevation=20;
 source.behaviors[1].system.blocksSight=source.behaviors[1].system.blocksLight=true;
 await configureSurfaceVisibility({regionUuids:[source.uuid],adoptBehaviorUuids:[source.behaviors[2].uuid],apply:true});
 expect(source.behaviors[2].system).toMatchObject({sight:false,light:false,sound:true,occlusion:false});
 expect(scene.regions[1]).toMatchObject({elevation:{bottom:20,top:20}});
 expect(scene.regions[1].behaviors[0].system.sight).toBe(true);
});
it('reconciles a geometry edit that arrives during an awaited native write',async()=>{
 const {source,scene,hooks}=setup();activateSurfaceVisibility();
 const original=source.update.getMockImplementation();let edited=false;
 source.update.mockImplementation(async(p:any)=>{await original(p);if(!edited){edited=true;source.behaviors[1].system.blocksSight=true;await hooks.get('updateRegion')!(source);}});
 await configureSurfaceVisibility({regionUuids:[source.uuid],apply:true});
 expect(scene.regions[1].behaviors[0].system.sight).toBe(true);
});
it('reports an overlapping opaque region without modifying it',async()=>{
 const {source,makeRegion}=setup();source.behaviors=source.behaviors.slice(0,2);
 const other=makeRegion({shapes:source.shapes,behaviors:[{type:'defineSurface',system:{sight:true,light:true}}]},'overlap');
 const result=await configureSurfaceVisibility({regionUuids:[source.uuid],apply:true});
 expect('conflicts'in result&&result.conflicts.join()).toContain(other.behaviors[0].uuid);
 expect(other.behaviors[0].update).not.toHaveBeenCalled();
});

it('preserves manual companion occlusion edits across reconciliation',async()=>{
 const {source,scene,hooks}=setup();await configureSurfaceVisibility({regionUuids:[source.uuid],apply:true});activateSurfaceVisibility();
 const native=scene.regions[1].behaviors[0];
 const on={'system.occlusion':true};hooks.get('preUpdateRegionBehavior')!(native,on,{});await native.update(on);
 await configureSurfaceVisibility({regionUuids:[source.uuid],apply:true});
 expect(native.system.occlusion).toBe(true);
 const off={'system.occlusion':false};hooks.get('preUpdateRegionBehavior')!(native,off,{});await native.update(off);
 (game as any).settings.get=()=>true;
 await configureSurfaceVisibility({regionUuids:[source.uuid],apply:true});
 expect(native.system.occlusion).toBe(false);
});
