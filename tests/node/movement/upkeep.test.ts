import {expect,it} from 'vitest';
import {needsFlightConfirmation} from '../../../src/rulesets/sf2e/movement/upkeep.js';
it('does not mistake stationary hovering for a missed Fly action',()=>{
 expect(needsFlightConfirmation(true,null)).toBe(true);
 expect(needsFlightConfirmation(true,true)).toBe(false);
 expect(needsFlightConfirmation(false,null)).toBe(false);
 expect(needsFlightConfirmation(true,false)).toBe(false);
});

import {afterEach,vi} from 'vitest';
import {activateFlightUpkeep} from '../../../src/rulesets/sf2e/movement/upkeep.js';
afterEach(()=>vi.unstubAllGlobals());
it('deduplicates turn prompts, accepts hovering, and routes only confirmed missed Fly to a fall',async()=>{
 const hooks:Record<string,Function>={};vi.stubGlobal('Hooks',{on:(n:string,f:Function)=>hooks[n]=f});
 const gm={id:'gm',isGM:true,active:true},owner={id:'owner',isGM:false,active:true};
 const messages:any[]=[];vi.stubGlobal('game',{user:gm,users:{activeGM:gm},settings:{get:()=>true},messages:{contents:messages}});
 vi.stubGlobal('foundry',{utils:{escapeHTML:(s:string)=>s}});
 const create=vi.fn(async(data:any)=>{const message={...data,uuid:'ChatMessage.request',author:gm,update:vi.fn(async(change:any)=>{message.flags['codex-foundry'].flightUpkeep.state=change['flags.codex-foundry.flightUpkeep.state'];})};messages.push(message);return message;});
 vi.stubGlobal('ChatMessage',{create});
 const token={uuid:'Scene.s.Token.t',name:'Bob',actor:{items:[{type:'effect',system:{slug:'codex-flying'}}]},movement:{id:'idle'},canUserModify:()=>true};
 const encounter={uuid:'Combat.c',round:1,turn:0};
 vi.stubGlobal('fromUuidSync',(uuid:string)=>uuid===token.uuid?token:uuid===encounter.uuid?encounter:messages[0]);
 const fall=vi.fn(async()=>{});activateFlightUpkeep(fall);
 hooks['pf2e.endTurn']({id:'combatant',token},encounter,'gm');hooks['pf2e.endTurn']({id:'combatant',token},encounter,'gm');await Promise.resolve();
 expect(create).toHaveBeenCalledTimes(1);
 const response=(used:boolean)=>({author:owner,flags:{'codex-foundry':{flightUse:{requestUuid:'ChatMessage.request',used}}}});
 await hooks.createChatMessage(response(true));expect(fall).not.toHaveBeenCalled();
 messages[0].flags['codex-foundry'].flightUpkeep.state='pending';
 await Promise.all([hooks.createChatMessage(response(false)),hooks.createChatMessage(response(false))]);expect(fall).toHaveBeenCalledTimes(1);
 messages[0].flags['codex-foundry'].flightUpkeep.state='pending';encounter.turn=1;
 await hooks.createChatMessage(response(false));expect(fall).toHaveBeenCalledTimes(1);expect(messages[0].flags['codex-foundry'].flightUpkeep.state).toBe('stale');
});
