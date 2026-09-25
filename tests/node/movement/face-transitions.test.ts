import {afterEach,expect,it,vi} from 'vitest';
import {prepareTransition} from '../../../src/rulesets/sf2e/movement/transitions.js';
import {previewSummary} from '../../../src/rulesets/sf2e/movement/preview.js';
afterEach(()=>vi.unstubAllGlobals());
function fixture(underside:number|null, action:string, descending:boolean, checks:boolean, speed=0) {
 vi.stubGlobal('game',{settings:{get:(_n:string,k:string)=>k==='movementOutcomeMode'?'apply':k==='terrainCheckOverride'?'':k==='climbOutsideCombat'?checks:true}});
 const floor=(id:string,left:number,right:number,elevation:number)=>({id,levels:new Set(['level']),behaviors:[
  {type:'codex-foundry.setElevation',disabled:false,system:{elevation,climbPreset:'expert'}},
  {type:'codex-foundry.surfaceGeometry',disabled:false,system:{extent:underside===null?'solid':'finite',underside,blocksSight:true,blocksLight:true}}
 ],polygonTree:{testPoint:(p:{x:number})=>p.x>=left&&p.x<=right,polygon:{points:[left,-10,right,-10,right,10,left,10]}}});
 const origin={x:descending?0:80,y:0,elevation:descending?20:0,level:'level',action};
 const token={actor:{items:[],system:{movement:{speeds:{climb:{value:speed}}}}},_source:origin,parent:{id:'scene',regions:[floor('ledge',-10,40,20),floor('ground',40,100,0)]},getMovementOrigin:(p:object)=>p};
 token.parent.regions[1].behaviors.pop(); // The landing need not assert material above itself.
 const operation={id:'m',origin,passed:{waypoints:[{...origin,x:descending?80:0}]},pending:{waypoints:[]}};
 return {token,operation,plan:()=>prepareTransition(token as never,operation,{kind:'voluntary'})};
}
it.each(['walk','travel','climb'])('%s cannot climb through air even without checks or with a Climb Speed',action=>{
 for(const checks of [true,false]) for(const speed of [0,20]) for(const descending of [true,false]) {
  const f=fixture(18,action,descending,checks,speed),plan=f.plan();
  expect(plan.transition?.reason).toBe(descending?'fall':'ruling');
  expect(plan.transition?.safe.elevation).toBe(descending?20:0);
  expect(plan.waypoints.some(w=>w.action==='climb'&&w.elevation!==(descending?20:0))).toBe(false);
  expect(previewSummary(f.token as never,plan).label).toBe(descending?'Fall ↓ 20 ft':'GM ruling needed');
 }
});
it('authored solid material retains the checked and unchecked climb flows',()=>{
 const checked=fixture(null,'walk',true,true).plan();
 expect(checked.transition).toMatchObject({reason:'climb',faceRegionId:'ledge'});
 const free=fixture(null,'walk',false,false).plan();
 expect(free.transition).toBeUndefined();expect(free.waypoints.at(-1)?.elevation).toBe(20);
});
it('unknown legacy geometry asks for a ruling, while forced movement remains a fall',()=>{
 const f=fixture(null,'walk',true,false);f.token.parent.regions[0].behaviors.pop();
 expect(f.plan().transition?.reason).toBe('ruling');
 expect(prepareTransition(f.token as never,f.operation,{kind:'forced',danger:'allowed'}).transition?.reason).toBe('fall');
});
it('uses token foot elevation when the native movement origin adds a body-height offset',()=>{
 const f=fixture(18,'walk',true,false);
 f.token.getMovementOrigin=(p:any)=>({...p,elevation:p.elevation+2.5});
 expect(f.plan().transition?.reason).toBe('fall');
 const cliff=fixture(null,'walk',true,true);
 cliff.token.getMovementOrigin=(p:any)=>({...p,elevation:p.elevation+2.5});
 expect(cliff.plan().transition?.reason).toBe('climb');
});
