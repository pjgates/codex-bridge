import {afterEach, expect, it, vi} from 'vitest';
import Clipper from 'clipper-lib';
import {maskRegions, maskContains, combineMask} from '../../../src/canvas/clip-tiles/mask.js';
import type {Ring} from '../../../src/canvas/clip-tiles/rings.js';
afterEach(()=>vi.unstubAllGlobals());
const flags=(data:object)=>({flags:{'codex-foundry':data}});
const rect=(x:number,y:number,w:number,h:number,hole=false):Ring=>({hole,points:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]});
it('reads old masks but lets an explicitly empty new list clear them',()=>{
 expect(maskRegions(flags({clipRegion:'old'}))).toEqual({include:['old'],exclude:[]});
 expect(maskRegions(flags({clipRegion:'old',clipRegions:[],excludeRegions:['cut','cut']}))).toEqual({include:[],exclude:['cut']});
});
it('uses any inclusion, with exclusions winning for artwork coverage',()=>{
 const mask={include:['a','b'],exclude:['cut']};
 expect(maskContains(mask,id=>id==='b')).toBe(true);
 expect(maskContains(mask,id=>id==='b'||id==='cut')).toBe(false);
 expect(maskContains(mask,()=>false)).toBe(false);
 expect(maskContains({include:[],exclude:['cut']},()=>false)).toBe(true);
});
it('unions overlapping regions and subtracts overlapping exclusions without restoring their overlap',()=>{
 vi.stubGlobal('ClipperLib',Clipper);
 const result=combineMask([rect(0,0,10,10),rect(5,0,10,10)],[rect(2,2,5,6),rect(5,2,5,6)]);
 const area=result.reduce((sum,r)=>sum+(r.hole?-1:1)*Math.abs(r.points.reduce((a,p,i)=>{const q=r.points[(i+1)%r.points.length];return a+p.x*q.y-q.x*p.y;},0)/2),0);
 expect(area).toBe(102); // 150 union minus 8x6 exclusion
});
it('preserves a hole unless another included region fills it',()=>{
 vi.stubGlobal('ClipperLib',Clipper);
 expect(combineMask([rect(0,0,20,20),rect(5,5,10,10,true)],[]).filter(r=>r.hole)).toHaveLength(1);
 expect(combineMask([rect(0,0,20,20),rect(5,5,10,10,true),rect(5,5,10,10)],[]).filter(r=>r.hole)).toHaveLength(0);
 expect(combineMask([rect(0,0,10,10)],[rect(-1,-1,12,12)])).toEqual([]);
});
