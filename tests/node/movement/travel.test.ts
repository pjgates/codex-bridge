import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prepareTransition } from '../../../src/rulesets/sf2e/movement/transitions.js';
afterEach(()=>vi.unstubAllGlobals());
beforeEach(()=>vi.stubGlobal('game',{settings:{get:(_n:string,key:string)=>key==='movementOutcomeMode'?'apply':true}}));
const floor=(id:string,left:number,right:number,elevation:number,level='ground')=>({id,levels:new Set([level]),behaviors:[{type:'codex-foundry.setElevation',system:{elevation,climbPreset:'expert'}},{type:'codex-foundry.surfaceGeometry',disabled:false,system:{extent:'solid',underside:null,blocksSight:true,blocksLight:true}}],polygonTree:{polygon:{points:[left,-10,right,-10,right,10,left,10]},testPoint:(p:{x:number})=>p.x>=left&&p.x<=right}});
function fixture(speeds:Record<string,{value:number}>,destination=floor('high',40,200,10,'upper')) {
 const origin={x:0,y:0,elevation:0,level:'ground',action:'travel'};
 const token={actor:{items:[],system:{movement:{speeds}}},_source:origin,parent:{regions:[floor('low',-10,40,0),destination]},getMovementOrigin:(p:object)=>p};
 const operation={id:'travel',origin,passed:{waypoints:[{...origin,x:100}]},pending:{waypoints:[]}};
 return {token,operation,plan:()=>prepareTransition(token as never,operation,{kind:'voluntary'})};
}
it('travels on foot and climbs an ordinary ledge with its prepared climb Speed',()=>{
 const f=fixture({climb:{value:20},fly:{value:30}});const plan=f.plan();
 expect(plan.transition).toBeUndefined();expect(plan.waypoints.some(p=>p.action==='climb')).toBe(true);
 expect(plan.waypoints.some(p=>p.action==='fly')).toBe(false);
 expect(plan.waypoints.at(-1)).toMatchObject({x:100,elevation:10,level:'upper',action:'walk'});
 const flat=fixture({fly:{value:30}},floor('flat',40,200,0)).plan();expect(flat.waypoints.every(p=>p.action==='walk')).toBe(true);
});
it('keeps checks for no climb Speed, difficult terrain and explicitly chosen movement',()=>{
 expect(fixture({}).plan().transition?.reason).toBe('climb');
 const hard=fixture({climb:{value:20}});hard.token.parent.regions[1].behaviors[0].system.climbPreset='master';expect(hard.plan().transition?.reason).toBe('climb');
 const explicit=fixture({climb:{value:20}});explicit.operation.passed.waypoints[0].action='walk';expect(explicit.plan().transition?.reason).toBe('climb');
 const forced=fixture({climb:{value:20},fly:{value:30}});expect(prepareTransition(forced.token as never,forced.operation,{kind:'forced',danger:'allowed'}).transition?.reason).toBe('ruling');
});
it('uses flight across a real gap but does not grant flight to a non-flyer',()=>{
 const f=fixture({fly:{value:30}},floor('far',80,200,0));const plan=f.plan();expect(plan.transition).toBeUndefined();
 expect(plan.waypoints.some(p=>p.action==='fly')).toBe(true);expect(plan.waypoints.at(-1)).toMatchObject({action:'walk',elevation:0});
 expect(fixture({},floor('far',80,200,0)).plan().transition?.reason).toBe('ruling');
});
it('uses Swim Speed in ordinary water while preserving turbulent-water checks',()=>{
 const f=fixture({swim:{value:20}},floor('shore',200,300,0));
 const water={id:'water',levels:new Set(['ground']),elevation:{bottom:-20,top:0},behaviors:[{type:'codex-foundry.water',system:{swimPreset:'flowing'}},{type:'codex-foundry.surfaceGeometry',disabled:false,system:{extent:'solid',underside:null,blocksSight:true,blocksLight:true}}],polygonTree:{polygon:{points:[40,-10,200,-10,200,10,40,10]},testPoint:(p:{x:number})=>p.x>=40&&p.x<=200}};
 f.token.parent.regions.push(water as never);
 const plan=f.plan();expect(plan.transition).toBeUndefined();expect(plan.waypoints.at(-1)).toMatchObject({action:'swim',elevation:0});
 expect(plan.waypoints[0]).toMatchObject({action:'walk',x:39});
 f.operation.passed.waypoints[0].x=220;expect(f.plan().waypoints.some(p=>p.action==='swim')).toBe(true);expect(f.plan().waypoints.at(-1)?.action).toBe('walk');
 f.operation.passed.waypoints[0].x=100;
 water.behaviors[0].system.swimPreset='stormy';expect(f.plan().transition?.reason).toBe('swim');
});

it('stays airborne at the end of a gap and preserves checks in advisory mode',()=>{
 const f=fixture({fly:{value:30}},floor('far',150,200,0));expect(f.plan().waypoints.at(-1)?.action).toBe('fly');
 vi.stubGlobal('game',{settings:{get:(_n:string,key:string)=>key==='movementOutcomeMode'?'advisory':true}});
 expect(f.plan().transition?.reason).toBe('ruling');
});
it('takes off from a water surface but never flies underwater',()=>{
 const f=fixture({fly:{value:30}},floor('shore',200,300,0));
 const water={id:'water',levels:new Set(['ground']),elevation:{bottom:-20,top:0},behaviors:[{type:'codex-foundry.water',system:{swimPreset:'flowing'}},{type:'codex-foundry.surfaceGeometry',disabled:false,system:{extent:'solid',underside:null,blocksSight:true,blocksLight:true}}],polygonTree:{polygon:{points:[40,-10,200,-10,200,10,40,10]},testPoint:(p:{x:number})=>p.x>=40&&p.x<=200}};
 f.token.parent.regions.push(water as never);f.operation.origin.x=50;
 expect(f.plan().transition).toBeUndefined();expect(f.plan().waypoints.at(-1)?.action).toBe('fly');
 water.elevation.top=10;expect(f.plan().transition?.reason).toBe('swim');
 f.operation.origin.x=0;expect(f.plan().transition?.reason).toBe('swim');
});
