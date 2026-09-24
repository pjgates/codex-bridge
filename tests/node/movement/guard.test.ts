import { expect, it } from 'vitest';
import { assertMovementUnchanged } from '../../../src/rulesets/sf2e/movement/guard.js';

it('accepts completed native segments descended from the resolved root, only at the expected position',()=>{
 const position={x:10,y:20,elevation:0,level:'floor'};
 const token={_source:position,movement:{id:'segment',chain:['resolvedRoot'],state:'completed'}};
 expect(()=>assertMovementUnchanged(token as never,'resolvedRoot',position,'completed')).not.toThrow();
 expect(()=>assertMovementUnchanged(token as never,'unrelatedRoot',position,'completed')).toThrow('Movement changed');
 expect(()=>assertMovementUnchanged(token as never,'resolvedRoot',{...position,x:11},'completed')).toThrow('Movement changed');
});
