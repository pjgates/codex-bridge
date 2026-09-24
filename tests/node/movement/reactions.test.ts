import {expect,it} from 'vitest';
import {edgeCatch,edgeImpact} from '../../../src/rulesets/sf2e/movement/reactions.js';
it('requires a free hand on success but not critical success',()=>{
 expect(edgeCatch(2,false)).toBe(false);expect(edgeCatch(3,false)).toBe(true);expect(edgeCatch(2,true)).toBe(true);expect(edgeCatch(1,true)).toBe(false);
});
it('reduces distance on a catch and adds impact on a late critical failure',()=>{
 expect(edgeImpact(25,2)).toEqual({reduction:20,additional:0});
 expect(edgeImpact(40,0)).toEqual({reduction:0,additional:20});
});

it('defaults to the highest eligible reaction bonus, including the action’s roll options',async()=>{
 const {reactionStatistics}=await import('../../../src/rulesets/sf2e/movement/reactions.js');
 const actor={getStatistic:(slug:string)=>({withRollOptions:({extraRollOptions}:{extraRollOptions:string[]})=>({mod:slug==='reflex'?14:
  ['action:grab-an-edge','check:type:skill','manipulate','item:trait:manipulate'].every(option=>extraRollOptions.includes(option))?16:12})})};
 expect(reactionStatistics(actor,'grab-an-edge')).toEqual([{slug:'reflex',label:'Reflex',bonus:14,selected:false},{slug:'acrobatics',label:'Acrobatics',bonus:16,selected:true}]);
 expect(reactionStatistics(actor,'arrest-a-fall').find(s=>s.selected)?.slug).toBe('reflex');
});
