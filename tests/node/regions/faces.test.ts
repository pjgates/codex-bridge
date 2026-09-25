import { expect, it } from 'vitest';
import { faceBetween } from '../../../src/canvas/regions/faces.js';
import type { SurfaceRegion } from '../../../src/canvas/regions/support.js';
const box=(left:number,right:number)=>[left,-10,right,-10,right,10,left,10];
function region(id:string,left:number,right:number,top:number,underside:number|null):SurfaceRegion {
 return {id,levels:new Set(['level']),behaviors:[
  {type:'codex-foundry.setElevation',disabled:false,system:{elevation:top}},
  {type:'codex-foundry.surfaceGeometry',disabled:false,system:{extent:underside===null?'solid':'finite',underside,blocksSight:true,blocksLight:true}}
 ],polygonTree:{polygon:{points:box(left,right)},testPoint:p=>p.x>=left&&p.x<=right&&Math.abs(p.y)<=10}};
}
const high={x:39,y:0,elevation:20,level:'upper'},low={x:41,y:0,elevation:0,level:'lower'};
it.each([['thin',18,'gap'],['reaching',0,'face'],['solid',null,'face']] as const)('%s material gives the same face facts in both directions',(_name,underside,kind)=>{
 const scene={regions:[region('ledge',0,40,20,underside),region('ground',40,80,0,null)]};
 expect(faceBetween(scene,high,low)).toMatchObject({kind,regionId:'ledge'});
 expect(faceBetween(scene,low,high)).toEqual(faceBetween(scene,high,low));
});
it('requires unambiguous authored geometry, including overlapping upper surfaces',()=>{
 const ledge=region('ledge',0,40,20,null),ground=region('ground',40,80,0,null);
 ledge.behaviors=[...ledge.behaviors].slice(0,1);
 expect(faceBetween({regions:[ledge,ground]},high,low).kind).toBe('unknown');
 const other=region('other',0,40,20,18);
 expect(faceBetween({regions:[region('ledge',0,40,20,null),other,ground]},high,low).kind).toBe('unknown');
 ledge.behaviors=[...other.behaviors,...other.behaviors];
 expect(faceBetween({regions:[ledge,ground]},high,low).kind).toBe('unknown');
});
it('rejects a long route that crosses a hole before reaching the outer face',()=>{
 const ledge=region('ledge',0,40,20,null);
 ledge.polygonTree.children=[{polygon:{points:box(10,11)},testPoint:p=>p.x>=10&&p.x<=11}];
 ledge.polygonTree.testPoint=p=>p.x>=0&&p.x<=40&&!(p.x>=10&&p.x<=11);
 expect(faceBetween({regions:[ledge,region('ground',40,80,0,null)]},{...high,x:5},low).kind).toBe('unknown');
});
it('does not climb through an intervening slab on the exposed side',()=>{
 const scene={regions:[region('ledge',0,40,20,null),region('ground',40,80,0,null),region('slab',40,80,10,8)]};
 expect(faceBetween(scene,high,low)).toMatchObject({kind:'unknown'});
});
it('rejects an upper destination embedded inside another slab',()=>{
 const scene={regions:[region('ledge',0,40,20,null),region('ground',40,80,0,null),region('overlap',0,40,40,10)]};
 expect(faceBetween(scene,high,low)).toMatchObject({kind:'unknown'});
 scene.regions[2].behaviors=[...scene.regions[2].behaviors,...scene.regions[2].behaviors];
 expect(faceBetween(scene,high,low)).toMatchObject({kind:'unknown'});
});
it('does not treat vertical travel through a slab interior as an exposed face',()=>{
 expect(faceBetween({regions:[region('ledge',0,40,20,18)]},{...low,x:39},high).kind).toBe('unknown');
});
