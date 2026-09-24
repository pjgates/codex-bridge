import { expect, it } from 'vitest';
import { segmentParameters, traceContacts } from '../../../src/canvas/regions/contacts.js';
const box=(left:number,right:number)=>[left,-10,right,-10,right,10,left,10];
it('intersects a one-pixel hole exactly and ignores tangent contact',()=>{
 expect(segmentParameters({x:0,y:0},{x:100,y:0},box(40,41))).toEqual([0.4,0.41]);
 expect(segmentParameters({x:0,y:0},{x:0,y:0},box(40,41))).toEqual([]);
});
it('traces both sides of a narrow gap on a long path with token origin offsets',()=>{
 const region=(id:string,left:number,right:number)=>({id,levels:new Set(['level']),behaviors:[{type:'codex-foundry.setElevation',disabled:false,system:{elevation:0}}],polygonTree:{polygon:{points:box(left,right)},testPoint:(p:{x:number})=>p.x>=left&&p.x<=right}});
 const scene={regions:[region('a',0,40),region('b',41,200)]};
 const token={getMovementOrigin:(p:{x:number;y:number})=>({x:p.x+5,y:p.y})};
 const contacts=traceContacts(scene,token,[{x:0,y:0,elevation:0,level:'level'},{x:100,y:0,elevation:0,level:'level'}]);
 expect(contacts.map(c=>[c.t,c.before.map(s=>s.regionId),c.after.map(s=>s.regionId)])).toEqual([[0.35,['a'],[]],[0.36,[],['b']]]);
});
