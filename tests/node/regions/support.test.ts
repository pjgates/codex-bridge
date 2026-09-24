import { expect, it } from 'vitest';
import { selectSupport, supportsAt } from '../../../src/canvas/regions/support.js';
it('finds the next floor below across levels, excluding an overhead bridge',()=>{
 const low={regionId:'low',elevation:-20,levelIds:['lower']};
 expect(selectSupport([low,{regionId:'bridge',elevation:20,levelIds:['above']}],0,'upper')).toEqual({kind:'surface',support:low,level:'lower'});
 expect(selectSupport([],0,'upper')).toEqual({kind:'none'});
});
it('requires a ruling for ambiguous level membership and prefers current membership',()=>{
 const a={regionId:'a',elevation:0,levelIds:['a']}, b={...a,regionId:'b',levelIds:['b']};
 expect(selectSupport([a,b],0,'c').kind).toBe('ambiguous');
 expect(selectSupport([a,b],0,'b')).toEqual({kind:'surface',support:b,level:'b'});
 expect(selectSupport([{...a,levelIds:[]}],0,'c')).toMatchObject({kind:'surface',level:'c'});
});
it('uses polygon membership and ignores disabled floors',()=>{
 const region={id:'r',levels:new Set(['low']),behaviors:[{type:'codex-foundry.setElevation',disabled:false,system:{elevation:-20}}],polygonTree:{testPoint:(p:{x:number})=>p.x<5}};
 expect(supportsAt({regions:[region]},{x:1,y:0})).toEqual([{regionId:'r',elevation:-20,levelIds:['low']}]);
 expect(supportsAt({regions:[region]},{x:6,y:0})).toEqual([]);
 region.behaviors[0].disabled=true; expect(supportsAt({regions:[region]},{x:1,y:0})).toEqual([]);
});
