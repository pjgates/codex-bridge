import { afterEach, expect, it, vi } from 'vitest';
import { activateMovementTransitions } from '../../../src/rulesets/sf2e/movement/transitions.js';
afterEach(()=>vi.unstubAllGlobals());
it('continues a suspended climb when the next drag uses Travelling',async()=>{
 const {prepareTransition}=await import('../../../src/rulesets/sf2e/movement/transitions.js');
 vi.stubGlobal('game',{settings:{get:(_n:string,k:string)=>k==='movementOutcomeMode'?'apply':true}});
 const region=(id:string,left:number,right:number,z:number)=>({id,levels:new Set(['upper']),behaviors:[{type:'codex-foundry.setElevation',disabled:false,system:{elevation:z}},{type:'codex-foundry.surfaceGeometry',disabled:false,system:{extent:'solid',underside:null,blocksSight:true,blocksLight:true}}],polygonTree:{polygon:{points:[left,-10,right,-10,right,10,left,10]},testPoint:(p:{x:number})=>p.x>=left&&p.x<=right}});
 const origin={x:39,y:0,elevation:10,level:'upper',action:'travel'};
 const token={uuid:'t',actor:{items:[{type:'effect',system:{slug:'codex-climbing'},flags:{'codex-foundry':{climbingToken:'t'}}}]},_source:origin,parent:{regions:[region('low',-100,40,0),region('high',40,200,20)]},getMovementOrigin:(p:object)=>p};
 const result=prepareTransition(token as never,{id:'m',origin,passed:{waypoints:[{...origin,x:100}]},pending:{waypoints:[]}},{kind:'voluntary'});
 expect(result.transition).toMatchObject({reason:'climb',landing:{kind:'surface',support:{elevation:20}}});
});
it('reissues a safe checkpoint, then pauses only the initiator when native pending state exists',async()=>{
 const hooks:Record<string,Function>={};
 vi.stubGlobal('Hooks',{on:(name:string,callback:Function)=>{hooks[name]=callback;}});
 vi.stubGlobal('game',{user:{id:'gm'},system:{id:'sf2e'},settings:{get:()=>true},i18n:{localize:(s:string)=>s}});
 vi.stubGlobal('foundry',{utils:{randomID:()=> 'newMovement'}});
 vi.stubGlobal('ui',{notifications:{warn:vi.fn(),error:vi.fn()}});
 vi.stubGlobal('CONFIG',{Token:{movement:{actions:{walk:{}}}}});
 const region=(id:string,left:number,right:number,elevation:number,level:string)=>({id,levels:new Set([level]),behaviors:[{type:'codex-foundry.setElevation',disabled:false,system:{elevation}}],polygonTree:{polygon:{points:[left,-10,right,-10,right,10,left,10]},testPoint:(p:{x:number})=>p.x>=left&&p.x<=right}});
 const origin={x:0,y:0,elevation:0,level:'upper',width:1,height:1,shape:0};
 const token={uuid:'Scene.s.Token.t',name:'Test',_source:origin,parent:{regions:[region('edge',-100,40,0,'upper'),region('landing',40,200,-20,'lower')]},actor:null,getMovementOrigin:(p:object)=>p,move:vi.fn(),pauseMovement:vi.fn(()=>Promise.resolve(true)),movement:{id:'newMovement',state:'pending'}};
 const notify=vi.fn(); activateMovementTransitions(notify);
 expect(hooks.preMoveToken(token,{id:'old',origin,passed:{waypoints:[{...origin,x:100,action:'walk'}]},pending:{waypoints:[]}},{})).toBe(false);
 await Promise.resolve(); expect(token.move).toHaveBeenCalledTimes(1);
 const [path]=token.move.mock.calls[0]; expect(path[0]).toMatchObject({checkpoint:true,elevation:0}); expect(path[0].x).toBeLessThan(40);
 expect(token.pauseMovement).not.toHaveBeenCalled();
 hooks.moveToken(token,{id:'newMovement',pending:{waypoints:[path[1]]}}, {}, {id:'other'});
 expect(token.pauseMovement).not.toHaveBeenCalled();
 hooks.moveToken(token,{id:'newMovement',pending:{waypoints:[path[1]]}}, {}, {id:'gm'});
 expect(token.pauseMovement).toHaveBeenCalledWith('codex-foundry:newMovement:0'); expect(notify).toHaveBeenCalledTimes(1);
});
it('creates a native stationary checkpoint for flight loss and never invents a landing',async()=>{
 const {requestFall}=await import('../../../src/rulesets/sf2e/movement/transitions.js');
 const user={id:'gm'};vi.stubGlobal('game',{user,users:{activeGM:user},settings:{get:()=>true}});
 vi.stubGlobal('foundry',{utils:{randomID:()=> 'fallMove'}});
 const origin={x:10,y:20,elevation:0,level:'upper'};
 const token={uuid:'Scene.s.Token.loss',actor:{items:[]},getMovementOrigin:(p:object)=>p,_source:origin,parent:{regions:[]},movement:{id:'old',state:'completed'},move:vi.fn(async(..._args:unknown[])=>{})};
 vi.stubGlobal('fromUuidSync',()=>token);
 await requestFall(token.uuid);await requestFall(token.uuid);
 expect(token.move).toHaveBeenCalledTimes(1);
 expect(token.move.mock.calls[0][0]).toEqual([expect.objectContaining({...origin,checkpoint:true}),expect.objectContaining({x:10,y:20,elevation:-0.001})]);
});
it('pauses an explicit vertical wall attempt in mapped terrain instead of granting unchecked height',async()=>{
 const {prepareTransition}=await import('../../../src/rulesets/sf2e/movement/transitions.js');
 vi.stubGlobal('game',{settings:{get:()=>true}});
 const origin={x:10,y:10,elevation:0,level:'upper',action:'walk'};
 const floor={id:'ground',levels:new Set(['upper']),behaviors:[{type:'codex-foundry.setElevation',disabled:false,system:{elevation:0}}],polygonTree:{testPoint:()=>true,polygon:{points:[0,0,100,0,100,100,0,100]}}};
 const token={actor:null,_source:origin,parent:{regions:[floor]},getMovementOrigin:(p:object)=>p};
 const result=prepareTransition(token as never,{id:'move',origin,passed:{waypoints:[{...origin,elevation:20,action:'climb'}]},pending:{waypoints:[]}},{kind:'voluntary'});
 expect(result.transition).toMatchObject({reason:'ruling',safe:{elevation:0}});
 expect(result.waypoints[0]).toMatchObject({checkpoint:true,elevation:0});
});
it('pauses unsupported grounded movement at its current position in a mapped scene',async()=>{
 const {prepareTransition}=await import('../../../src/rulesets/sf2e/movement/transitions.js');
 vi.stubGlobal('game',{settings:{get:()=>true}});
 const origin={x:10,y:10,elevation:10,level:'upper',action:'walk'};
 const floor={id:'ground',levels:new Set(['lower']),behaviors:[{type:'codex-foundry.setElevation',disabled:false,system:{elevation:0}}],polygonTree:{testPoint:()=>true,polygon:{points:[0,0,100,0,100,100,0,100]}}};
 const token={actor:null,_source:origin,parent:{regions:[floor]},getMovementOrigin:(p:object)=>p};
 const plan=prepareTransition(token as never,{id:'m',origin,passed:{waypoints:[{...origin,x:50}]},pending:{waypoints:[]}},{kind:'voluntary'});
 expect(plan.transition).toMatchObject({reason:'fall',safe:{x:10,y:10,elevation:10},landing:{kind:'surface',level:'lower'}});
});
it('does not grant diagonal altitude changes over a flat mapped floor',async()=>{
 const {prepareTransition}=await import('../../../src/rulesets/sf2e/movement/transitions.js');vi.stubGlobal('game',{settings:{get:()=>true}});
 const origin={x:10,y:10,elevation:0,level:'upper',action:'walk'};
 const floor={id:'ground',levels:new Set(['upper']),behaviors:[{type:'codex-foundry.setElevation',disabled:false,system:{elevation:0}}],polygonTree:{testPoint:()=>true,polygon:{points:[0,0,100,0,100,100,0,100]}}};
 const token={actor:null,_source:origin,parent:{regions:[floor]},getMovementOrigin:(p:object)=>p};
 const result=prepareTransition(token as never,{id:'m',origin,passed:{waypoints:[{...origin,x:50,elevation:20}]},pending:{waypoints:[]}},{kind:'voluntary'});
 expect(result.transition).toMatchObject({reason:'ruling',safe:{x:10,elevation:0}});
});
it('lands on the nearest floor even when a deeper floor belongs to the current level',async()=>{
 const {prepareTransition}=await import('../../../src/rulesets/sf2e/movement/transitions.js');vi.stubGlobal('game',{settings:{get:()=>true}});
 const region=(id:string,left:number,right:number,z:number,level:string)=>({id,levels:new Set([level]),behaviors:[{type:'codex-foundry.setElevation',disabled:false,system:{elevation:z}}],polygonTree:{polygon:{points:[left,-10,right,-10,right,10,left,10]},testPoint:(p:{x:number})=>p.x>=left&&p.x<=right}});
 const origin={x:0,y:0,elevation:0,level:'upper',action:'walk'};
 const token={actor:null,_source:origin,parent:{regions:[region('edge',-10,40,0,'upper'),region('deep',40,200,-40,'upper'),region('near',40,200,-20,'lower')]},getMovementOrigin:(p:object)=>p};
 const plan=prepareTransition(token as never,{id:'m',origin,passed:{waypoints:[{...origin,x:100}]},pending:{waypoints:[]}},{kind:'voluntary'});
 expect(plan.transition?.landing).toMatchObject({kind:'surface',support:{regionId:'near',elevation:-20},level:'lower'});
});
it('allows configured exploration climbs while keeping falls paused',async()=>{
 const {prepareTransition}=await import('../../../src/rulesets/sf2e/movement/transitions.js');
 vi.stubGlobal('game',{settings:{get:(_ns:string,k:string)=>k==='climbOutsideCombat'?false:k==='terrainCheckOverride'?'':true}});
 const region=(id:string,left:number,right:number,z:number)=>({id,levels:new Set(['upper']),behaviors:[{type:'codex-foundry.setElevation',disabled:false,system:{elevation:z}},{type:'codex-foundry.surfaceGeometry',disabled:false,system:{extent:'solid',underside:null,blocksSight:true,blocksLight:true}}],polygonTree:{polygon:{points:[left,-10,right,-10,right,10,left,10]},testPoint:(p:{x:number})=>p.x>=left&&p.x<=right}});
 const origin={x:0,y:0,elevation:0,level:'upper',action:'walk'},other=region('high',40,200,20);
 const token={actor:null,_source:origin,parent:{id:'scene',regions:[region('ground',-10,40,0),other]},getMovementOrigin:(p:object)=>p};
 const operation={id:'m',origin,passed:{waypoints:[{...origin,x:100}]},pending:{waypoints:[]}};
 const climb=prepareTransition(token as never,operation,{kind:'voluntary'});expect(climb.transition).toBeUndefined();expect(climb.waypoints.at(-1)?.elevation).toBe(20);
 other.behaviors[0].system.elevation=-20;expect(prepareTransition(token as never,operation,{kind:'forced',danger:'allowed'}).transition?.reason).toBe('fall');
});
it('does not start a second fall after landing at an authored water surface',async()=>{
 const {requestFall}=await import('../../../src/rulesets/sf2e/movement/transitions.js');const gm={id:'gm'};vi.stubGlobal('game',{user:gm,users:{activeGM:gm},settings:{get:(_n:string,k:string)=>k==='movementOutcomeMode'?'apply':true}});
 vi.stubGlobal('foundry',{utils:{randomID:()=> 'waterFall'}});
 const origin={x:10,y:10,elevation:0,level:'water'};const water={id:'pool',levels:new Set(['water']),elevation:{bottom:-20,top:0},behaviors:[{type:'codex-foundry.water',disabled:false,system:{}}],polygonTree:{testPoint:()=>true}};
 const token={uuid:'Scene.s.Token.water',actor:{items:[]},_source:origin,parent:{regions:[water]},getMovementOrigin:(p:object)=>p,movement:{id:'landed',state:'completed'},move:vi.fn()};vi.stubGlobal('fromUuidSync',()=>token);
 await requestFall(token.uuid);expect(token.move).not.toHaveBeenCalled();
});

it('does not replan or release its paused path when Foundry drops custom continuation options',async()=>{
 const hooks:Record<string,Function>={};vi.stubGlobal('Hooks',{on:(n:string,cb:Function)=>hooks[n]=cb});
 vi.stubGlobal('game',{user:{id:'gm'},settings:{get:()=>true}});
 let sequence=0;vi.stubGlobal('foundry',{utils:{randomID:()=>`owned${++sequence}`}});
 const origin={x:10,y:10,elevation:20,level:'upper',action:'walk'};
 const floor={id:'floor',levels:new Set(['upper']),behaviors:[{type:'codex-foundry.setElevation',system:{elevation:0}}],polygonTree:{testPoint:()=>true,polygon:{points:[0,0,100,0,100,100,0,100]}}};
 const token={uuid:'Scene.s.Token.continuation',name:'Test',actor:null,_source:origin,parent:{regions:[floor]},getMovementOrigin:(p:object)=>p,movement:{id:'prior',state:'completed'},move:vi.fn(),stopMovement:vi.fn(),pauseMovement:vi.fn(()=>{token.movement.state='paused';return Promise.resolve(true);})};
 const notify=vi.fn();activateMovementTransitions(notify);
 const request={id:'initial',origin,passed:{waypoints:[{...origin,x:50}]},pending:{waypoints:[]}};
 expect(hooks.preMoveToken(token,request,{})).toBe(false);await Promise.resolve();
 const [path,opts]=token.move.mock.calls[0];token.movement={id:opts.id,state:'pending'};
 hooks.moveToken(token,{id:opts.id,pending:{waypoints:path.slice(1)}},{},{id:'gm'});
 expect(notify).toHaveBeenCalledTimes(1);
 // Native continuation has a new ID and chain ancestry, but no codexMovementPlanned.
 expect(hooks.preMoveToken(token,{...request,id:'nativeNext',chain:[opts.id]},{})).toBe(false);
 await Promise.resolve();expect(token.move).toHaveBeenCalledTimes(1);expect(notify).toHaveBeenCalledTimes(1);
 expect(token.movement.state).toBe('paused');
});

it('stops a superseded in-flight path without replacing the newer movement decision',async()=>{
 const hooks:Record<string,Function>={};vi.stubGlobal('Hooks',{on:(n:string,cb:Function)=>hooks[n]=cb});
 vi.stubGlobal('game',{user:{id:'gm'},settings:{get:()=>true}});
 let sequence=0;vi.stubGlobal('foundry',{utils:{randomID:()=>`overlap${++sequence}`}});
 const origin={x:10,y:10,elevation:20,level:'upper',action:'walk'};
 const floor={id:'floor',levels:new Set(['upper']),behaviors:[{type:'codex-foundry.setElevation',system:{elevation:0}}],polygonTree:{testPoint:()=>true,polygon:{points:[0,0,100,0,100,100,0,100]}}};
 let finishMove!:()=>void;const pendingMove=new Promise<void>(resolve=>finishMove=resolve);
 const token={uuid:'Scene.s.Token.overlap',name:'Test',actor:null,_source:origin,parent:{regions:[floor]},getMovementOrigin:(p:object)=>p,movement:{id:'prior',state:'completed'},move:vi.fn(()=>pendingMove),stopMovement:vi.fn(()=>token.movement.state='stopped'),pauseMovement:vi.fn(()=>{token.movement.state='paused';return Promise.resolve(true);})};
 const notify=vi.fn();activateMovementTransitions(notify);
 const request={id:'initial',origin,passed:{waypoints:[{...origin,x:50}]},pending:{waypoints:[]}};
 hooks.preMoveToken(token,request,{});await Promise.resolve();
 hooks.preMoveToken(token,{...request,id:'second'},{});await Promise.resolve();
 const first=token.move.mock.calls[0] as unknown as [unknown[],{id:string}],second=token.move.mock.calls[1] as unknown as [unknown[],{id:string}];
 token.movement={id:first[1].id,state:'pending'};hooks.moveToken(token,{id:first[1].id,pending:{waypoints:first[0].slice(1)}},{},{id:'gm'});
 expect(token.stopMovement).toHaveBeenCalledTimes(1);expect(notify).not.toHaveBeenCalled();
 token.movement={id:second[1].id,state:'pending'};hooks.moveToken(token,{id:second[1].id,pending:{waypoints:second[0].slice(1)}},{},{id:'gm'});
 expect(notify).toHaveBeenCalledTimes(1);expect(token.movement.state).toBe('paused');finishMove();
});

it('allows safe resolved continuations through native checkpoints without repeating terrain checks',()=>{
 const hooks:Record<string,Function>={};vi.stubGlobal('Hooks',{on:(n:string,cb:Function)=>hooks[n]=cb});
 vi.stubGlobal('game',{user:{id:'gm'},settings:{get:()=>true}});
 const token={uuid:'Scene.s.Token.resolved',movement:{id:'resolved',state:'pending'},stopMovement:vi.fn(),pauseMovement:vi.fn(),move:vi.fn()};
 activateMovementTransitions(vi.fn());
 const initial={id:'resolved',passed:{waypoints:[]},pending:{waypoints:[{}]}};
 expect(hooks.preMoveToken(token,initial,{codexMovementPlanned:true})).toBe(true);
 hooks.moveToken(token,initial,{},{id:'gm'});
 expect(hooks.preMoveToken(token,{...initial,id:'next',chain:['resolved']},{})).toBe(true);
 expect(token.move).not.toHaveBeenCalled();expect(token.pauseMovement).not.toHaveBeenCalled();
});

it('rejects an old continuation already in flight when a newer path supersedes its root',()=>{
 const hooks:Record<string,Function>={};vi.stubGlobal('Hooks',{on:(n:string,cb:Function)=>hooks[n]=cb});
 vi.stubGlobal('game',{user:{id:'gm'},settings:{get:()=>true}});
 const token={uuid:'Scene.s.Token.late',movement:{id:'oldRoot',state:'pending'},move:vi.fn(),stopMovement:vi.fn()};
 activateMovementTransitions(vi.fn());
 const operation={id:'oldRoot',passed:{waypoints:[]},pending:{waypoints:[{}]}};
 hooks.preMoveToken(token,operation,{codexMovementPlanned:true});hooks.moveToken(token,operation,{},{id:'gm'});
 hooks.preMoveToken(token,{...operation,id:'newRoot'},{codexMovementPlanned:true});
 expect(hooks.preMoveToken(token,{...operation,id:'oldContinuation',chain:['oldRoot']},{})).toBe(false);
 token.movement.id='oldContinuation';
 hooks.moveToken(token,{...operation,id:'oldContinuation',chain:['oldRoot']},{},{id:'gm'});
 expect(token.stopMovement).toHaveBeenCalledTimes(1);
 expect(token.move).not.toHaveBeenCalled();
});

it('recognizes an uphill floor on a different native level as a climb destination',async()=>{
 const {prepareTransition}=await import('../../../src/rulesets/sf2e/movement/transitions.js');vi.stubGlobal('game',{settings:{get:()=>true}});
 const floor=(id:string,left:number,right:number,elevation:number,level:string)=>({id,levels:new Set([level]),behaviors:[{type:'codex-foundry.setElevation',disabled:false,system:{elevation}},{type:'codex-foundry.surfaceGeometry',disabled:false,system:{extent:'solid',underside:null,blocksSight:true,blocksLight:true}}],polygonTree:{testPoint:(p:{x:number})=>p.x>=left&&p.x<=right,polygon:{points:[left,-10,right,-10,right,10,left,10]}}});
 const origin={x:0,y:0,elevation:-7.5,level:'lower',action:'travel'};
 const token={actor:null,_source:origin,parent:{regions:[floor('low',-10,40,-7.5,'lower'),floor('high',40,200,2.5,'upper')]},getMovementOrigin:(p:object)=>p};
 const operation={id:'cross-level-climb',origin,passed:{waypoints:[{...origin,x:100}]},pending:{waypoints:[]}};
 expect(prepareTransition(token as never,operation,{kind:'voluntary'}).transition).toMatchObject({reason:'climb',landing:{kind:'surface',support:{regionId:'high',elevation:2.5},level:'upper'}});
 expect(prepareTransition(token as never,operation,{kind:'forced',danger:'allowed'}).transition?.reason).toBe('ruling');
});

it('walks across subpixel floor seams but still stops at authored gaps and real drops',async()=>{
 const {prepareTransition}=await import('../../../src/rulesets/sf2e/movement/transitions.js');
 vi.stubGlobal('game',{settings:{get:()=>true}});
 const floor=(id:string,left:number,right:number,z:number)=>({id,levels:new Set(['upper']),behaviors:[{type:'codex-foundry.setElevation',disabled:false,system:{elevation:z}}],polygonTree:{polygon:{points:[left,-10,right,-10,right,10,left,10]},testPoint:(p:{x:number})=>p.x>=left&&p.x<=right}});
 const origin={x:0,y:0,elevation:5,level:'upper',action:'walk'};
 const plan=(gap:number,z:number,end=100)=>{const token={actor:null,_source:origin,parent:{regions:[floor('a',-10,40,5),floor('b',40+gap,200,z),floor('below',-10,200,-17.5)]},getMovementOrigin:(p:object)=>p};return prepareTransition(token as never,{id:'m',origin,passed:{waypoints:[{...origin,x:end}]},pending:{waypoints:[]}},{kind:'voluntary'});};
 for(const z of [5,2.5]){const result=plan(.82,z);expect(result.transition).toBeUndefined();expect(result.waypoints.at(-1)?.elevation).toBe(z);}
 expect(plan(1,5).transition).toBeDefined();
 expect(plan(.23,-17.5).transition).toBeDefined();
 expect(plan(.82,5,40.4).transition).toBeDefined();
});
