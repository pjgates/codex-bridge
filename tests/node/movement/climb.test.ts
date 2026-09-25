import { afterEach,expect,it,vi } from 'vitest';
import {climbDistance,climbProgress} from '../../../src/rulesets/sf2e/movement/climb.js';
import {rollMovementCheck,verifiedDegree} from '../../../src/rulesets/sf2e/movement/checks.js';
afterEach(()=>vi.unstubAllGlobals());
it('caps ordinary climbing by degree and land speed',()=>{
 expect(climbDistance(25,2)).toBe(5);expect(climbDistance(25,3)).toBe(10);expect(climbDistance(25,1)).toBe(0);expect(climbDistance(40,2)).toBe(10);
 expect(climbProgress({rise:20,speed:25,degree:2,handsFree:2,climbSpeed:0})).toEqual({distance:5,fall:false,prone:false});
 expect(climbProgress({rise:20,speed:25,degree:2,handsFree:0,climbSpeed:0})).toEqual({distance:0,fall:false,prone:false});
 expect(climbProgress({rise:20,speed:25,degree:0,handsFree:2,climbSpeed:0,stable:true})).toEqual({distance:0,fall:false,prone:true});
 expect(climbProgress({rise:20,speed:25,degree:0,handsFree:2,climbSpeed:0,stable:false})).toEqual({distance:0,fall:true,prone:false});
});
it('accepts only the matching actor-owner system check and rejects a different DC or marker',()=>{
 const check={author:{id:'owner'},speaker:{actor:'bob'},flags:{sf2e:{context:{type:'skill-check',options:['codex-check:request:climb','action:climb','check:statistic:athletics'],dc:{value:20},outcome:'success'}}}};
 const expected={userId:'owner',actorId:'bob',marker:'codex-check:request:climb',dc:20,system:'sf2e',action:'climb',statistic:'athletics'};
 expect(verifiedDegree(check,expected)).toBe(2);
 expect(verifiedDegree(check,{...expected,dc:10})).toBeNull();
 expect(verifiedDegree(check,{...expected,marker:'other'})).toBeNull();
 expect(verifiedDegree(check,{...expected,userId:'intruder'})).toBeNull();
 expect(verifiedDegree(check,{...expected,statistic:'stealth'})).toBeNull();
});
it('awaits system action results with explicit DC/statistic and treats cancellation as null',async()=>{
 const use=vi.fn().mockResolvedValueOnce([{outcome:'success'}]).mockResolvedValueOnce([]);
 vi.stubGlobal('game',{pf2e:{actions:{get:()=>({use})}}});const actor={};
 expect(await rollMovementCheck(actor,'climb','athletics',20)).toBe(2);
 expect(use).toHaveBeenCalledWith({actors:[actor],statistic:'athletics',difficultyClass:{value:20}});
 expect(await rollMovementCheck(actor,'climb','athletics',20)).toBeNull();
});
it('includes Quick Climb action adjustments without exceeding land Speed',()=>{
 expect(climbProgress({rise:40,speed:25,degree:2,handsFree:2,climbSpeed:0,quickClimb:true} as never).distance).toBe(10);
 expect(climbProgress({rise:40,speed:25,degree:3,handsFree:2,climbSpeed:0,quickClimb:true} as never).distance).toBe(20);
});

it('Combat Climber permits one free hand, and a climb Speed does not require humanoid hands',()=>{
 expect(climbProgress({rise:20,speed:25,degree:2,handsFree:1,climbSpeed:0,combatClimber:true}).distance).toBe(5);
 expect(climbProgress({rise:20,speed:25,degree:2,handsFree:0,climbSpeed:20}).distance).toBe(20);
});
