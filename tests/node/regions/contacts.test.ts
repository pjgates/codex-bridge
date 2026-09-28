import { expect, it, vi } from 'vitest';
import { segmentParameters, traceContacts } from '../../../src/canvas/regions/contacts.js';
import { prepareSurfaceQueries } from '../../../src/canvas/regions/query.js';
import { supportsAt } from '../../../src/canvas/regions/support.js';
const box=(left:number,right:number)=>[left,-10,right,-10,right,10,left,10];
it('intersects a one-pixel hole exactly and ignores tangent contact',()=>{
 expect(segmentParameters({x:0,y:0},{x:100,y:0},box(40,41))).toEqual([0.4,0.41]);
 expect(segmentParameters({x:0,y:0},{x:0,y:0},box(40,41))).toEqual([]);
});
it('indexes exact narrow-gap contacts and reuses point membership within a search',()=>{
 const region=(id:string,left:number,right:number)=>({id,levels:new Set(['level']),behaviors:[{type:'codex-foundry.setElevation',disabled:false,system:{elevation:0}}],polygonTree:{polygon:{points:box(left,right)},testPoint:vi.fn((p:{x:number;y:number})=>p.x>=left&&p.x<=right)}});
 const a=region('a',0,40), b=region('b',41,200),scene={regions:[a,b]};
 const indexed=prepareSurfaceQueries(scene,10),point={x:20,y:0};
 expect(supportsAt(indexed,point)).toEqual([{regionId:'a',elevation:0,levelIds:['level']}]);
 supportsAt(indexed,point); expect(a.polygonTree.testPoint).toHaveBeenCalledTimes(1);
 const token={getMovementOrigin:(p:{x:number;y:number})=>({x:p.x+5,y:p.y})};
 const path=[{x:0,y:0,elevation:0,level:'level'},{x:100,y:0,elevation:0,level:'level'}];
 expect(traceContacts(indexed,token,path)).toEqual(traceContacts(scene,token,path));
 expect(traceContacts(indexed,token,[path[1],path[0]])).toEqual(traceContacts(scene,token,[path[1],path[0]]));
 const next=prepareSurfaceQueries(scene,10);supportsAt(next,point);
 expect(a.polygonTree.testPoint.mock.calls.filter(([p])=>p.x===20&&p.y===0)).toHaveLength(2);
});
it('traces both sides of a narrow gap on a long path with token origin offsets',()=>{
 const region=(id:string,left:number,right:number)=>({id,levels:new Set(['level']),behaviors:[{type:'codex-foundry.setElevation',disabled:false,system:{elevation:0}}],polygonTree:{polygon:{points:box(left,right)},testPoint:(p:{x:number})=>p.x>=left&&p.x<=right}});
 const scene={regions:[region('a',0,40),region('b',41,200)]};
 const token={getMovementOrigin:(p:{x:number;y:number})=>({x:p.x+5,y:p.y})};
 const contacts=traceContacts(scene,token,[{x:0,y:0,elevation:0,level:'level'},{x:100,y:0,elevation:0,level:'level'}]);
 expect(contacts.map(c=>[c.t,c.before.map(s=>s.regionId),c.after.map(s=>s.regionId)])).toEqual([[0.35,['a'],[]],[0.36,[],['b']]]);
});
