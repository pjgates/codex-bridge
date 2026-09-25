import { afterEach, expect, it, vi } from 'vitest';
import { isCurrentTransition, resolveDecision } from '../../../src/rulesets/sf2e/movement/decisions.js';
afterEach(()=>vi.unstubAllGlobals());
it('rejects stale, cancelled and disconnected movement',()=>{
 const ref={tokenUuid:'Scene.s.Token.t',movementId:'move',checkpoint:0};
 const token={uuid:ref.tokenUuid,movement:{id:'move',state:'paused',user:{active:true}}};
 expect(isCurrentTransition(ref,token)).toBe(true);
 expect(isCurrentTransition({...ref,movementId:'old'},token)).toBe(false);
 expect(isCurrentTransition(ref,{...token,movement:{...token.movement,state:'stopped'}})).toBe(false);
 expect(isCurrentTransition(ref,{...token,movement:{...token.movement,user:{active:false}}})).toBe(false);
});
it('only the active GM resolves and a repeated or concurrent response cannot execute twice',async()=>{
 const user={id:'gm',isGM:true,active:true};
 vi.stubGlobal('game',{user,users:{activeGM:user}});
 const token={uuid:'Scene.s.Token.t',movement:{id:'move',state:'paused',user},canUserModify:()=>true};
 vi.stubGlobal('fromUuidSync',()=>token);
 const data={state:'pending',transition:{ref:{tokenUuid:token.uuid,movementId:'move',checkpoint:0}}};
 const message={uuid:'ChatMessage.request',author:user,flags:{'codex-foundry':{movementDecision:data}},update:vi.fn(async(changes:Record<string,unknown>)=>{data.state=changes['flags.codex-foundry.movementDecision.state'] as string;})};
 const apply=vi.fn(async()=>{});
 await Promise.all([resolveDecision(message as never,'manual',user,apply),resolveDecision(message as never,'manual',user,apply)]);
 await resolveDecision(message as never,'manual',user,apply);
 expect(apply).toHaveBeenCalledTimes(1); expect(data.state).toBe('resolved');
});
it('cancels only on the original initiator client after the GM resolves the request',async()=>{
 const {activateMovementDecisions}=await import('../../../src/rulesets/sf2e/movement/decisions.js');
 const hooks:Record<string,Function>={}; vi.stubGlobal('Hooks',{on:(name:string,fn:Function)=>{hooks[name]=fn;}});
 const user={id:'player',isGM:false,active:true}; vi.stubGlobal('game',{user});
 const token={uuid:'Scene.s.Token.t',movement:{id:'move',state:'paused',user},stopMovement:vi.fn()}; vi.stubGlobal('fromUuidSync',()=>token);
 const message={author:user,flags:{'codex-foundry':{movementDecision:{state:'resolved',transition:{ref:{tokenUuid:token.uuid,movementId:'move',checkpoint:0}}}}}};
 activateMovementDecisions(); hooks.updateChatMessage(message); expect(token.stopMovement).toHaveBeenCalledTimes(1);
 (game as unknown as {user:object}).user={id:'gm',isGM:true}; hooks.updateChatMessage(message); expect(token.stopMovement).toHaveBeenCalledTimes(1);
});
it('resolves forbidden forced destinations as a safe stop without an outcome choice',async()=>{
 const {openDecision}=await import('../../../src/rulesets/sf2e/movement/decisions.js');
 const message={uuid:'ChatMessage.request',update:vi.fn()};
 vi.stubGlobal('foundry',{utils:{escapeHTML:(s:string)=>s}});vi.stubGlobal('ChatMessage',{create:vi.fn(async()=>message)});
 await openDecision({name:'Bob'} as never,{intent:{kind:'forced',danger:'forbidden'},reason:'fall',safe:{elevation:20},landing:{kind:'surface',support:{elevation:0}}} as never);
 expect(message.update).toHaveBeenCalledWith(expect.objectContaining({'flags.codex-foundry.movementDecision.state':'resolved'}));
});
it('marks a previous initiator request stale after another user replaces the native movement',async()=>{
 const user={id:'gm',isGM:true,active:true};vi.stubGlobal('game',{user,users:{activeGM:user}});
 const token={uuid:'Scene.s.Token.t',movement:{id:'new',state:'paused',user},canUserModify:()=>true};vi.stubGlobal('fromUuidSync',()=>token);
 const message={uuid:'ChatMessage.old',author:{id:'player'},flags:{'codex-foundry':{movementDecision:{state:'pending',transition:{ref:{tokenUuid:token.uuid,movementId:'old',checkpoint:0}}}}},update:vi.fn()};
 const apply=vi.fn();await resolveDecision(message as never,'manual',user,apply);
 expect(apply).not.toHaveBeenCalled();expect(message.update).toHaveBeenCalledWith({'flags.codex-foundry.movementDecision.state':'stale'});
});
