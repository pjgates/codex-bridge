import {afterEach,expect,it,vi} from 'vitest';
const check=vi.hoisted(()=>({degree:2}));
vi.mock('../../../src/rulesets/sf2e/movement/checks.js',()=>({verifiedDegree:()=>check.degree}));
import * as transitions from '../../../src/rulesets/sf2e/movement/transitions.js';
import {resolveMovementChoice} from '../../../src/rulesets/sf2e/movement/resolution.js';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it.each([0,1,2])('resolves degree %s partway up a climb without turning an ordinary failure into a fall',async(degree)=>{
 check.degree=degree;const fall=vi.spyOn(transitions,'requestFall').mockResolvedValue();
 const gm={id:'gm',isGM:true,active:true};
 vi.stubGlobal('game',{user:gm,system:{id:'sf2e'},settings:{get:(_n:string,k:string)=>k==='movementOutcomeMode'?'apply':true},pf2e:{ConditionManager:{conditions:new Map([['off-guard',{uuid:'condition'}]])}}});
 vi.stubGlobal('foundry',{utils:{escapeHTML:(s:string)=>s,randomID:()=> 'resolved'}});
 const region=(id:string,min:number,max:number,elevation:number)=>({id,flags:{'codex-foundry':{climbDC:20}},levels:new Set(['upper']),behaviors:[{type:'codex-foundry.setElevation',disabled:false,system:{elevation}},{type:'codex-foundry.surfaceGeometry',disabled:false,system:{extent:'solid',underside:null,blocksSight:true,blocksLight:true}}],polygonTree:{polygon:{points:[min,-10,max,-10,max,10,min,10]},testPoint:(p:{x:number})=>p.x>=min&&p.x<=max}});
 const origin={x:39,y:0,elevation:10,level:'upper',action:'climb'};
 const actor={id:'a',handsFree:2,items:[],system:{movement:{speeds:{land:{value:25}}}},createEmbeddedDocuments:vi.fn(),increaseCondition:vi.fn()};
 const token={uuid:'t',actor,_source:{...origin},parent:{regions:[region('low',-100,40,0),region('high',40,200,20)]},getMovementOrigin:(p:object)=>p,
  movement:{id:'m',state:'paused',user:gm,pending:{waypoints:[{...origin,x:100}]}},move:vi.fn(async(path:any[],opts:any)=>{Object.assign(token._source,path.at(-1));token.movement.id=opts.id;token.movement.state='completed';})};
 const request={uuid:'ChatMessage.req',update:vi.fn()},data={transition:{ref:{tokenUuid:'t',movementId:'m',checkpoint:0},intent:{kind:'voluntary'}}};
 const response={flags:{'codex-foundry':{movementResponse:{checkUuid:'ChatMessage.check'}}}};
 vi.stubGlobal('fromUuidSync',()=>({}));
 await resolveMovementChoice(token as never,data as never,'climb',gm,request as never,response as never);
 expect(fall).toHaveBeenCalledTimes(degree===0?1:0);
 expect(token.move).toHaveBeenCalledTimes(degree===2?1:0);
 expect(token._source.elevation).toBe(degree===2?15:10);
 if(degree===0)expect(fall).toHaveBeenCalledWith('t','high');
});
