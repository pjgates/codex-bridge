import {afterEach,expect,it,vi} from 'vitest';
import {swimConsequenceDestination,activateSwimUpkeep,resolveSwimUpkeep} from '../../../src/rulesets/sf2e/movement/swim-upkeep.js';
afterEach(()=>vi.unstubAllGlobals());
function token(){
 const water={id:'water',levels:new Set(['upper']),elevation:{top:0,bottom:-30},behaviors:[{type:'codex-foundry.water',disabled:false,system:{}}],polygonTree:{testPoint:()=>true}};
 const bed={id:'bed',levels:new Set(['lower']),behaviors:[{type:'codex-foundry.setElevation',disabled:false,system:{elevation:-6}}],polygonTree:{testPoint:()=>true}};
 return {uuid:'Scene.s.Token.t',name:'Bob',actor:{id:'a',items:[]},_source:{x:0,y:0,elevation:0,level:'upper',action:'swim'},parent:{grid:{size:100,distance:5},regions:[water,bed]},movement:{id:'idle',state:'completed'}};
}
it('sinks only to a mapped bed and converts a current from scene units',()=>{
 const t={...token(),getMovementOrigin:(p:object)=>p};
 expect(swimConsequenceDestination(t as never,'sink')).toMatchObject({elevation:-6,level:'lower'});
 expect(swimConsequenceDestination(t as never,'current',{distance:10,direction:90})).toMatchObject({x:200,elevation:0});
});
it('applies a GM sink once and rejects a later request after movement changed',async()=>{
 const gm={id:'gm',isGM:true};vi.stubGlobal('game',{user:gm,users:{activeGM:gm},settings:{get:(_n:string,k:string)=>k==='movementOutcomeMode'?'apply':true}});
 vi.stubGlobal('foundry',{utils:{escapeHTML:(s:string)=>s,randomID:()=> 'sink'}});
 const t={...token(),getMovementOrigin:(p:object)=>p,move:vi.fn(async(path:any[])=>{Object.assign(t._source,path.at(-1));t.movement.id='sink';return true;})};
 const combat={uuid:'Combat.c',round:1,turn:1};
 const data={key:'k',state:'pending',tokenUuid:t.uuid,movementId:'idle',origin:{...t._source},combatUuid:combat.uuid,round:1,turn:1};
 const message={uuid:'ChatMessage.req',author:gm,flags:{'codex-foundry':{swimUpkeep:data}},update:vi.fn(async(change:any)=>{data.state=change['flags.codex-foundry.swimUpkeep.state'];})};
 vi.stubGlobal('fromUuidSync',(id:string)=>id===t.uuid?t:combat);
 await resolveSwimUpkeep(message as never,'sink');await resolveSwimUpkeep(message as never,'sink');
 expect(t.move).toHaveBeenCalledTimes(1);expect(t._source.elevation).toBe(-6);
 expect(t.move).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({constrainOptions:{ignoreWalls:false,ignoreCost:true}}));
 data.state='pending';await resolveSwimUpkeep(message as never,'sink');expect(data.state).toBe('stale');expect(t.move).toHaveBeenCalledTimes(1);
});
it('prompts once at turn end unless a Swim success was recorded for that turn',async()=>{
 const hooks:Record<string,Function>={},messages:any[]=[];
 vi.stubGlobal('Hooks',{on:(k:string,f:Function)=>hooks[k]=f});
 const gm={id:'gm',isGM:true};vi.stubGlobal('game',{user:gm,users:{activeGM:gm,filter:()=>[gm]},system:{id:'sf2e'},settings:{get:()=>true},messages:{contents:messages}});
 vi.stubGlobal('foundry',{utils:{escapeHTML:(s:string)=>s}});
 const create=vi.fn(async(data:any)=>{messages.push(data);return data;});vi.stubGlobal('ChatMessage',{create});
 const t={...token(),getMovementOrigin:(p:object)=>p};
 const c={id:'c',token:t,flags:{sf2e:{roundOfLastTurnEnd:1},'codex-foundry':{swimSuccessRound:1}}};
 const encounter={uuid:'Combat.c',round:1,turn:1};activateSwimUpkeep();
 await hooks['pf2e.endTurn'](c,encounter,'gm');expect(create).not.toHaveBeenCalled();
 c.flags['codex-foundry'].swimSuccessRound=0;
 await hooks['pf2e.endTurn'](c,encounter,'gm');await hooks['pf2e.endTurn'](c,encounter,'gm');expect(create).toHaveBeenCalledTimes(1);
});
