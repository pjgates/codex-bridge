import {afterEach,expect,it,vi} from 'vitest';
import {prepareTransition} from '../../../src/rulesets/sf2e/movement/transitions.js';
import {previewSummary} from '../../../src/rulesets/sf2e/movement/preview.js';
import {currentTransition,transitionDC} from '../../../src/rulesets/sf2e/movement/resolution.js';
afterEach(()=>vi.unstubAllGlobals());
function fixture(drop=20,action='travel',checks=true){
 vi.stubGlobal('game',{settings:{get:(_n:string,k:string)=>k==='movementOutcomeMode'?'apply':k==='climbOutsideCombat'?checks:k==='terrainCheckOverride'?'':true}});
 const floor=(id:string,left:number,right:number,elevation:number,level:string,dc:number)=>({id,levels:new Set([level]),behaviors:[{type:'codex-foundry.setElevation',system:{elevation,climbDC:dc}},{type:'codex-foundry.surfaceGeometry',disabled:false,system:{extent:'solid',underside:null,blocksSight:true,blocksLight:true}}],polygonTree:{testPoint:(p:{x:number})=>p.x>=left&&p.x<=right,polygon:{points:[left,-10,right,-10,right,10,left,10]}}});
 const origin={x:0,y:0,elevation:20,level:'upper',action};
 const token={uuid:'t',actor:{items:[]},_source:origin,parent:{id:'scene',regions:[floor('ledge',-10,40,20,'upper',20),floor('bottom',40,200,20-drop,'lower',10)]},getMovementOrigin:(p:object)=>p,movement:{id:'m',user:{id:'gm'},pending:{waypoints:[{...origin,x:100}]}}};
 const operation={id:'m',origin,passed:{waypoints:token.movement.pending.waypoints},pending:{waypoints:[]}};
 return {token,operation};
}
it('defaults a cross-level descent to Climb and uses the upper ledge DC',()=>{
 const {token,operation}=fixture();
 const plan=prepareTransition(token as never,operation,{kind:'voluntary'});
 expect(plan.transition).toMatchObject({reason:'climb',sourceRegionId:'ledge',landing:{kind:'surface',level:'lower'}});
 const data={transition:{...plan.transition,ref:{movementId:'m'},intent:{kind:'voluntary'}}};
 expect(transitionDC(token as never,data as never,'climb')).toBe(20);
 expect(previewSummary(token as never,plan).label).toBe('Climb ↓ 20 ft · DC 20');
 // A partially completed descent must keep the same upper wall DC.
 token._source={...token._source,x:39,elevation:15};
 token.actor.items.push({flags:{'codex-foundry':{climbingToken:'t'}}} as never);
 expect(currentTransition(token as never,data as never)?.reason).toBe('climb');
 expect(transitionDC(token as never,data as never,'climb')).toBe(20);
});
it('keeps the strict five-foot boundary, forced falls and deliberate falls',()=>{
 const {token,operation}=fixture(5,'walk');
 expect(prepareTransition(token as never,operation,{kind:'voluntary'}).transition?.reason).toBe('fall');
 const deep=fixture(20,'walk');
 expect(prepareTransition(deep.token as never,deep.operation,{kind:'forced',danger:'allowed'}).transition?.reason).toBe('fall');
 const falling=fixture(20,'codex-fall');
 expect(prepareTransition(falling.token as never,falling.operation,{kind:'voluntary'}).transition?.reason).toBe('fall');
 deep.token.parent.regions.pop();
 expect(prepareTransition(deep.token as never,deep.operation,{kind:'voluntary'}).transition?.reason).toBe('ruling');
});
it('descends freely when exploration climbing checks are disabled',()=>{
 const {token,operation}=fixture(20,'walk',false);
 const plan=prepareTransition(token as never,operation,{kind:'voluntary'});
 expect(plan.transition).toBeUndefined();
 expect(plan.waypoints.at(-1)).toMatchObject({elevation:0,level:'lower'});
});

it('requires a ruling for a declared descent through a slab interior',()=>{
 const {token,operation}=fixture();
 token.parent.regions[1].polygonTree.testPoint=()=>true;
 operation.passed.waypoints=[{...token._source,elevation:0,level:'lower'}];
 const plan=prepareTransition(token as never,operation,{kind:'voluntary'});
 expect(plan.transition).toMatchObject({reason:'ruling',sourceRegionId:'ledge'});
});
