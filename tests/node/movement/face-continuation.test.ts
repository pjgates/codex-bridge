import {afterEach,expect,it,vi} from 'vitest';
import {prepareTransition} from '../../../src/rulesets/sf2e/movement/transitions.js';
import {resolveMovementChoice} from '../../../src/rulesets/sf2e/movement/resolution.js';
afterEach(()=>vi.unstubAllGlobals());
function setup() {
 const gm={id:'gm',isGM:true};
 vi.stubGlobal('game',{user:gm,settings:{get:(_n:string,k:string)=>k==='movementOutcomeMode'?'apply':true},pf2e:{ConditionManager:{conditions:new Map([['off-guard',{uuid:'off-guard'}]])}}});
 vi.stubGlobal('foundry',{utils:{escapeHTML:(s:string)=>s,randomID:()=> 'resolved'}});
 const region=(id:string,left:number,right:number,elevation:number)=>({id,levels:new Set(['level']),behaviors:[
  {type:'codex-foundry.setElevation',disabled:false,system:{elevation,climbDC:20}},
  {type:'codex-foundry.surfaceGeometry',disabled:false,system:{extent:'solid',underside:null as number|null,blocksSight:true,blocksLight:true}}
 ],polygonTree:{polygon:{points:[left,-10,right,-10,right,10,left,10]},testPoint:(p:{x:number})=>p.x>=left&&p.x<=right}});
 const origin={x:39,y:0,elevation:0,level:'level',action:'walk'};
 const actor={id:'a',items:[] as any[],system:{movement:{speeds:{climb:{value:5}}}},createEmbeddedDocuments:vi.fn(async(_type:string,items:any[])=>actor.items.push(...items)),increaseCondition:vi.fn()};
 const token={uuid:'t',actor,_source:{...origin},parent:{regions:[region('ground',-10,40,0),region('ledge',40,100,20)]},getMovementOrigin:(p:object)=>p,
 movement:{id:'m',state:'paused',user:gm,pending:{waypoints:[{...origin,x:80}]}},move:vi.fn(async(path:any[],opts:any)=>{Object.assign(token._source,path[0]);token.movement.id=opts.id;token.movement.state='completed';})};
 const data={transition:{ref:{tokenUuid:'t',movementId:'m',checkpoint:0},faceRegionId:'ledge',intent:{kind:'voluntary'}}};
 return {gm,token,data,geometry:token.parent.regions[1].behaviors[1]};
}
it('revalidates geometry after awaited reporting before applying a successful climb',async()=>{
 const f=setup();let altered=false;
 const message={update:vi.fn(async()=>{if(!altered){altered=true;Object.assign(f.geometry.system,{extent:'finite',underside:18});}})};
 await expect(resolveMovementChoice(f.token as never,f.data as never,'climb-speed',f.gm,message as never)).rejects.toThrow(/surface changed/);
 expect(f.token._source.elevation).toBe(0);expect(f.token.move).not.toHaveBeenCalled();
});
it('rejects a changed landing height even when the same solid face remains valid',async()=>{
 const f=setup();f.token.actor.system.movement.speeds.climb.value=25;
 const message={update:vi.fn(async()=>{f.token.parent.regions[1].behaviors[0].system.elevation=10;})};
 await expect(resolveMovementChoice(f.token as never,f.data as never,'climb-speed',f.gm,message as never)).rejects.toThrow(/surface changed/);
 expect(f.token.move).not.toHaveBeenCalled();
});
it('retains the face locator in a partial climb and rejects disabled or replaced geometry',async()=>{
 const f=setup();await resolveMovementChoice(f.token as never,f.data as never,'climb-speed',f.gm,{update:vi.fn()} as never);
 expect(f.token.actor.items[0].flags['codex-foundry'].climbingFaceRegionId).toBe('ledge');
 const plan=()=>prepareTransition(f.token as never,{id:'next',origin:f.token._source,passed:{waypoints:[{...f.token._source,x:80,action:'travel'}]},pending:{waypoints:[]}},{kind:'voluntary'});
 expect(plan().transition?.reason).toBe('climb');f.geometry.disabled=true;
 expect(plan().transition?.reason).toBe('ruling');f.geometry.disabled=false;f.token.parent.regions[1].id='replacement';
 expect(plan().transition?.reason).toBe('ruling');
});
