import {afterEach,expect,it,vi} from 'vitest';
import {prepareTransition} from '../../../src/rulesets/sf2e/movement/transitions.js';
afterEach(()=>vi.unstubAllGlobals());
function setup(){
 vi.stubGlobal('game',{settings:{get:(_n:string,k:string)=>k==='movementOutcomeMode'?'apply':k==='terrainCheckOverride'?'':!['climbOutsideCombat','swimOutsideCombat'].includes(k)}});
 const region=(id:string,left:number,right:number,type:string,elevation:number)=>({id,levels:new Set(['level']),elevation:{top:0,bottom:-20},behaviors:[{type:`codex-foundry.${type}`,disabled:false,system:{elevation}},{type:'codex-foundry.surfaceGeometry',disabled:false,system:{extent:'solid',underside:null,blocksSight:true,blocksLight:true}}],polygonTree:{polygon:{points:[left,-10,right,-10,right,10,left,10]},testPoint:(p:{x:number})=>p.x>=left&&p.x<right}});
 const origin={x:0,y:0,elevation:0,level:'level',action:'walk'};
 const token={actor:{items:[]},_source:origin,parent:{id:'scene',regions:[region('low',-100,100,'setElevation',0),region('high',100,400,'setElevation',20)]},getMovementOrigin:(p:object)=>p};
 const operation={id:'m',origin,passed:{waypoints:[{...origin,x:300}]},pending:{waypoints:[]}};
 return {token,operation,region};
}
it('retains separate approach, vertical climb and departure without checks',()=>{
 const {token,operation}=setup();const plan=prepareTransition(token as never,operation,{kind:'voluntary'});
 expect(plan.transition).toBeUndefined();
 const climb=plan.waypoints.find(w=>w.action==='climb')!;
 expect(climb).toBeDefined();expect(climb.elevation).toBe(20);
 const before=plan.waypoints[plan.waypoints.indexOf(climb)-1];
 expect(before).toMatchObject({x:climb.x,y:climb.y,elevation:0,action:'walk'});
 expect(plan.waypoints.at(-1)).toMatchObject({action:'walk',elevation:20});
});
it('splits a walk through water into walk/swim/walk even with dry endpoints',()=>{
 const {token,operation,region}=setup();token.parent.regions=[region('left',-100,100,'setElevation',0),region('pool',100,200,'water',0),region('right',200,400,'setElevation',0)];
 const plan=prepareTransition(token as never,operation,{kind:'voluntary'});
 expect(plan.transition).toBeUndefined();
 expect(plan.waypoints.filter((w,i,a)=>!i||w.action!==a[i-1].action).map(w=>w.action)).toEqual(['walk','swim','walk']);
});
it('refuses an unchecked explicit vertical move through material',()=>{
 const {token,operation}=setup();token.parent.regions[1].polygonTree.testPoint=()=>true;
 operation.passed.waypoints=[{...operation.origin,elevation:20}];
 const plan=prepareTransition(token as never,operation,{kind:'voluntary'});
 expect(plan.transition?.reason).toBe('ruling');expect(plan.changed).toBe(true);
 expect(plan.transition?.safe.elevation).toBe(0);
});
