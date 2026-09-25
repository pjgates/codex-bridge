import {afterEach,expect,it,vi} from 'vitest';
import {statusAtRest} from '../../../src/rulesets/sf2e/movement/status-lifecycle.js';
afterEach(()=>vi.unstubAllGlobals());
const floor={id:'ground',levels:new Set(['ground']),behaviors:[{type:'codex-foundry.setElevation',system:{elevation:0}}],polygonTree:{testPoint:()=>true}};
function token(z:number){return {uuid:'Scene.s.Token.t',actor:{items:[]},parent:{regions:[floor]},_source:{x:10,y:10,elevation:z,level:'ground'},getMovementOrigin:(p:object)=>p};}
it('shows Climbing only while suspended, and clears it on reaching ground or falling',()=>{
 const t=token(5);expect(statusAtRest(t as never,'climb')).toBe('climbing');t._source.elevation=0;expect(statusAtRest(t as never,'climb')).toBe(null);
 t._source.elevation=5;expect(statusAtRest(t as never,'codex-fall')).toBe(null);
});
it('shows Swimming in water but clears it on dry support and flight',()=>{
 const t=token(5);t.parent.regions.push({id:'water',levels:new Set(['ground']),elevation:{bottom:0,top:10},behaviors:[{type:'codex-foundry.water',system:{}}],polygonTree:{testPoint:()=>true}} as never);
 expect(statusAtRest(t as never,'swim')).toBe('swimming');expect(statusAtRest(t as never,'fly')).toBe(null);
 t._source.elevation=0;expect(statusAtRest(t as never,'walk')).toBe(null);
});
