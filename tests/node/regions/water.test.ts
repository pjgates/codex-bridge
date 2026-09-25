import {expect,it} from 'vitest';
import {waterLanding} from '../../../src/canvas/regions/water.js';
import {softLandingReduction} from '../../../src/rulesets/sf2e/movement/landing.js';
it('uses local bed depth and keeps a dry bridge above water separate',()=>{
 const region=(id:string,type:string,elevation?:number)=>({id,levels:new Set(['lower']),elevation:{bottom:-30,top:0},behaviors:[{type,disabled:false,system:{elevation}}],polygonTree:{testPoint:()=>true}});
 const scene={regions:[region('water','codex-foundry.water'),region('bed','codex-foundry.setElevation',-10)]};
 expect(waterLanding(scene,{x:0,y:0},30,-10)).toMatchObject({surface:0,bed:-10,depth:10});
 expect(waterLanding(scene,{x:0,y:0},30,5)).toBeNull();
 expect(softLandingReduction(10,false)).toBe(10);expect(softLandingReduction(50,true)).toBe(30);
});
it('keeps unknown depth explicit',()=>{
 const scene={regions:[{id:'water',levels:new Set<string>(),elevation:{bottom:null,top:0},behaviors:[{type:'codex-foundry.water',disabled:false,system:{}}],polygonTree:{testPoint:()=>true}}]};
 expect(waterLanding(scene,{x:0,y:0},30,-Infinity)).toMatchObject({depth:null,bed:null});
});
