import {expect,it} from 'vitest';
import {hasEnvironmentalAir} from '../../../src/rulesets/sf2e/movement/environmental-air.js';
it('uses the active environmental effect, including its final already-paid oxygen charge',()=>{
 expect(hasEnvironmentalAir({items:[{type:'effect',system:{slug:'environmental-protection-on',expired:false}}]})).toBe(true);
});
it('does not treat inactive or expired environmental protection as breathable air',()=>{
 for(const system of [{slug:'environmental-protection-off',expired:false},{slug:'environmental-protection-on',expired:true}]) {
  expect(hasEnvironmentalAir({items:[{type:'effect',system}]})).toBe(false);
 }
});
