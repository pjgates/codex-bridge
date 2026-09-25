import {afterEach,expect,it,vi} from 'vitest';
import {prepareTransition} from '../../../src/rulesets/sf2e/movement/transitions.js';
import {swimProgress} from '../../../src/rulesets/sf2e/movement/swim.js';
afterEach(()=>vi.unstubAllGlobals());
it('caps Swim progress by degree, speed and the intended distance',()=>{
 expect(swimProgress(25,2,100)).toBe(10);expect(swimProgress(25,3,100)).toBe(15);expect(swimProgress(40,2,100)).toBe(15);expect(swimProgress(25,0,100)).toBe(0);
});
it('pauses swimming in authored water without mistaking the surface for an unsupported fall',()=>{
 const values:Record<string,unknown>={enableCustomRules:true,enableSwimming:true,enableFalling:true,swimOutsideCombat:true,terrainCheckOverride:''};
 vi.stubGlobal('game',{settings:{get:(_ns:string,k:string)=>values[k]}});
 const water={id:'pool',levels:new Set(['lower']),elevation:{bottom:-20,top:0},behaviors:[{type:'codex-foundry.water',disabled:false,system:{swimPreset:'flowing'}}],polygonTree:{polygon:{points:[0,0,100,0,100,100,0,100]},testPoint:(p:{x:number;y:number})=>p.x>=0&&p.x<=100&&p.y>=0&&p.y<=100}};
 const origin={x:10,y:10,elevation:0,level:'lower',action:'swim'};
 const token={actor:null,_source:origin,parent:{id:'scene',regions:[water]},getMovementOrigin:(p:object)=>p};const operation={id:'m',origin,passed:{waypoints:[{...origin,x:200}]},pending:{waypoints:[]}};
 const plan=prepareTransition(token as never,operation,{kind:'voluntary'});expect(plan.transition?.reason).toBe('swim');expect(plan.transition!.after.x).toBeLessThanOrEqual(100);
 values.swimOutsideCombat=false;expect(prepareTransition(token as never,operation,{kind:'voluntary'}).transition?.reason).toBe('ruling');
});
it('resolves calm-water progress without a roll and keeps advisory movement unapplied',async()=>{
 const {resolveSwim}=await import('../../../src/rulesets/sf2e/movement/swim-resolution.js');let mode='advisory';
 vi.stubGlobal('game',{settings:{get:(_n:string,key:string)=>key==='movementOutcomeMode'?mode:true}});vi.stubGlobal('foundry',{utils:{escapeHTML:(s:string)=>s,randomID:()=> 'swimMove'}});
 const water={id:'pool',levels:new Set(['lower']),elevation:{bottom:-20,top:0},behaviors:[{type:'codex-foundry.water',disabled:false,system:{swimPreset:'calm',swimDC:null}}],polygonTree:{testPoint:()=>true}};
 const origin={x:10,y:10,elevation:0,level:'lower',action:'swim'};
 const token={uuid:'Scene.s.Token.t',actor:{id:'bob',items:[],system:{movement:{speeds:{land:{value:25}}}}},parent:{grid:{size:100,distance:5},regions:[water]},_source:{...origin},movement:{id:'move',state:'paused'},getMovementOrigin:(p:object)=>p,move:vi.fn(async(path:any[],options:any)=>{Object.assign(token._source,path[0]);Object.assign(token.movement,{id:options.id,state:'completed'});})};
 const transition={ref:{movementId:'move'},safe:origin,after:{...origin,x:1000},landing:{kind:'surface',support:{regionId:'pool'}}};const message={uuid:'ChatMessage.req',update:vi.fn()};
 await resolveSwim(token as never,transition as never,message as never,'swim-auto',undefined,'gm',10);expect(token.move).not.toHaveBeenCalled();
 mode='apply';await resolveSwim(token as never,transition as never,message as never,'swim-auto',undefined,'gm',10);expect(token._source.x).toBe(310);
});
it('measures vertical swimming inside the same water body',async()=>{
 const {swimmingTransition}=await import('../../../src/rulesets/sf2e/movement/swim.js');
 const region={id:'pool',levels:new Set(['lower']),elevation:{bottom:-40,top:0},behaviors:[{type:'codex-foundry.water',disabled:false,system:{}}],polygonTree:{testPoint:()=>true}};
 const safe={x:10,y:10,elevation:0,level:'lower',action:'swim'};
 const token={parent:{regions:[region]},getMovementOrigin:(p:object)=>p};
 expect(swimmingTransition(token as never,safe,{...safe,elevation:-10},region as never).after.elevation).toBe(-10);
});
it('can finish a swim onto a same-height shore instead of stopping forever at the last water pixel',async()=>{
 const {swimmingTransition}=await import('../../../src/rulesets/sf2e/movement/swim.js');
 const water={id:'pool',levels:new Set(['lower']),elevation:{bottom:-20,top:0},behaviors:[{type:'codex-foundry.water',disabled:false,system:{swimPreset:'calm'}}],polygonTree:{polygon:{points:[0,0,100,0,100,100,0,100]},testPoint:(p:{x:number})=>p.x<100}};
 const shore={id:'shore',levels:new Set(['lower']),behaviors:[{type:'codex-foundry.setElevation',disabled:false,system:{elevation:0}}],polygonTree:{polygon:{points:[100,0,300,0,300,100,100,100]},testPoint:(p:{x:number})=>p.x>=100}};
 const origin={x:99,y:10,elevation:0,level:'lower',action:'swim'};const token={parent:{regions:[water,shore]},getMovementOrigin:(p:object)=>p};
 expect(swimmingTransition(token as never,origin,{...origin,x:200},water as never).after.x).toBeGreaterThan(100);
});
it('uses the new height when exploration climbing enters an adjacent pool',()=>{
 vi.stubGlobal('game',{settings:{get:(_n:string,k:string)=>k==='terrainCheckOverride'?'':!['climbOutsideCombat','swimOutsideCombat'].includes(k)}});
 const region=(id:string,left:number,right:number,z:number,type='codex-foundry.setElevation')=>({id,levels:new Set(['level']),elevation:{bottom:0,top:20},behaviors:[{type,disabled:false,system:{elevation:z}},{type:'codex-foundry.surfaceGeometry',disabled:false,system:{extent:'solid',underside:null,blocksSight:true,blocksLight:true}}],polygonTree:{polygon:{points:[left,0,right,0,right,100,left,100]},testPoint:(p:{x:number})=>p.x>=left&&p.x<right}});
 const origin={x:10,y:10,elevation:0,level:'level',action:'walk'};
 const token={actor:null,_source:origin,parent:{id:'scene',regions:[region('start',0,40,0),region('bank',40,80,20),region('bed',80,200,0),region('pool',80,200,0,'codex-foundry.water')]},getMovementOrigin:(p:object)=>p};
 const plan=prepareTransition(token as never,{id:'m',origin,passed:{waypoints:[{...origin,x:150}]},pending:{waypoints:[]}},{kind:'voluntary'});
 expect(plan.transition).toBeUndefined();expect(plan.waypoints.at(-1)?.elevation).toBe(20);
});

it('Quick Swim increases progress while respecting land Speed',()=>{
 expect(swimProgress(25,2,100,0,true)).toBe(15);expect(swimProgress(25,3,100,0,true)).toBe(25);
});
it('Quick Swim never reduces a faster existing Swim Speed',()=>{
 expect(swimProgress(25,2,100,40,true)).toBe(40);
});
