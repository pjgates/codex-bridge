import {afterEach,expect,it,vi} from 'vitest';
import {resolveMovementChoice} from '../../../src/rulesets/sf2e/movement/resolution.js';
afterEach(()=>vi.unstubAllGlobals());
it('persists only a GM-authored valid DC ruling and keeps the request pending',async()=>{
 const update=vi.fn(); const message={update}; const response={uuid:'ChatMessage.ruling',flags:{'codex-foundry':{movementResponse:{dc:20}}}};
 expect(await resolveMovementChoice({} as never,{} as never,'dc',{id:'gm',isGM:true},message as never,response as never)).toBe(false);
 expect(update).toHaveBeenCalledWith({'flags.codex-foundry.movementDecision.rulingUuid':'ChatMessage.ruling'});
 update.mockClear();
 await resolveMovementChoice({} as never,{} as never,'dc',{id:'owner',isGM:false},message as never,response as never);
 expect(update).not.toHaveBeenCalled();
});
it('cancellation never rolls, moves or writes consequences',async()=>{
 vi.stubGlobal('foundry',{utils:{escapeHTML:(s:string)=>s}});
 const token={move:vi.fn()};
 await resolveMovementChoice(token as never,{} as never,'stop',{id:'owner',isGM:false},{update:vi.fn()} as never);
 expect(token.move).not.toHaveBeenCalled();
});
it('caps a GM-approved ordinary climb Speed and leaves positive advisory progress unapplied',async()=>{
 const gm={id:'gm',isGM:true,active:true};let mode='advisory';
 vi.stubGlobal('game',{pf2e:{ConditionManager:{conditions:new Map([['off-guard',{uuid:'Compendium.sf2e.conditions.Item.offguard'}]])}},user:gm,settings:{get:(_ns:string,key:string)=>key==='movementOutcomeMode'?mode:true}});
 vi.stubGlobal('foundry',{utils:{escapeHTML:(s:string)=>s,randomID:()=>"climb"}});
 const region=(id:string,min:number,max:number,elevation:number)=>({id,flags:{'codex-foundry':{climbDC:20}},levels:new Set(['upper']),behaviors:[{type:'codex-foundry.setElevation',disabled:false,system:{elevation}},{type:'codex-foundry.surfaceGeometry',disabled:false,system:{extent:'solid',underside:null,blocksSight:true,blocksLight:true}}],polygonTree:{polygon:{points:[min,-10,max,-10,max,10,min,10]},testPoint:(p:{x:number})=>p.x>=min&&p.x<=max}});
 const origin={x:39,y:0,elevation:0,level:'upper',action:'walk'};
 const actor={createEmbeddedDocuments:vi.fn(),id:'a',items:[],handsFree:0,system:{movement:{speeds:{land:{value:25},climb:{value:10}}}}};
 const token={uuid:'Scene.s.Token.t',actor,parent:{regions:[region('low',-100,40,0),region('high',40,200,20)]},_source:{...origin},getMovementOrigin:(p:object)=>p,movement:{id:'m',state:'paused',user:gm,pending:{waypoints:[{...origin,x:100}]}},move:vi.fn(async(path:any[],options:any)=>{Object.assign(token._source,path.at(-1));token.movement.id=options.id;token.movement.state="completed";})};
 const data={transition:{ref:{tokenUuid:token.uuid,movementId:'m',checkpoint:0},intent:{kind:'voluntary'}}};
 const message={update:vi.fn()};
 await resolveMovementChoice(token as never,data as never,'climb-speed',gm,message as never);
 expect(token.move).not.toHaveBeenCalled();expect(message.update).toHaveBeenCalledWith(expect.objectContaining({content:expect.stringContaining('10 ft progress')}));
 mode='apply';await resolveMovementChoice(token as never,data as never,'climb-speed',gm,message as never);
 expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith('Item',[expect.objectContaining({system:expect.objectContaining({slug:'codex-climbing'})})]);
 expect(token._source.elevation).toBe(10);expect(token.move).toHaveBeenCalledTimes(1);
});
