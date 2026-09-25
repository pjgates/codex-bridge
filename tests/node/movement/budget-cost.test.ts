import {afterEach,expect,it,vi} from 'vitest';
import {movementBudgetCost} from '../../../src/rulesets/sf2e/movement/budget-cost.js';
afterEach(()=>vi.unstubAllGlobals());
it('uses terrain costs for Climb/Crawl allowances and preserves native flight ascent',()=>{
 vi.stubGlobal('CONFIG',{Token:{movement:{TerrainData:{getMovementCostFunction:()=> (_a:unknown,_b:unknown,distance:number)=>distance*2}}}});
 const cost=movementBudgetCost({});
 const segment=(action:string,multiplier:number)=>({action,actionConfig:{getCostFunction:()=> (cost:number)=>cost*multiplier}});
 expect(cost({}, {},5,segment('climb',2))).toBe(10);
 expect(cost({}, {},5,segment('crawl',2))).toBe(10);
 expect(cost({}, {},5,segment('fly',2))).toBe(20);
 expect(cost({}, {},5,segment('climb',1))).toBe(10);
});
