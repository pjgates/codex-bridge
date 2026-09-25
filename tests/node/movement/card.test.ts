// @vitest-environment happy-dom
import {afterEach,expect,it,vi} from 'vitest';
import {renderMovementCard, reactionGlyph} from '../../../src/rulesets/sf2e/movement/card.js';
import {activateMovementDecisions} from '../../../src/rulesets/sf2e/movement/decisions.js';
afterEach(()=>vi.unstubAllGlobals());
const transition={reason:'fall',safe:{elevation:20},after:{elevation:20},landing:{kind:'surface',support:{elevation:0}},intent:{kind:'voluntary'},sourceRegionId:'ledge'};
it('explains a fall, renders the native reaction glyph and escapes character text',()=>{
 vi.stubGlobal('foundry',{utils:{escapeHTML:(s:string)=>s.replaceAll('<','&lt;').replaceAll('>','&gt;')}});
 const html=renderMovementCard('<Bob>',{state:'pending',transition} as never);
 document.body.innerHTML=html;
 expect(document.querySelector('h3')?.textContent).toBe('Fall from the ledge');
 expect(document.body.textContent).toContain('20 ft');
 expect(document.body.textContent).toContain('<Bob>');expect(document.querySelector('bob')).toBeNull();
 document.body.innerHTML=reactionGlyph();
 expect(document.querySelector('.action-glyph')?.textContent).toBe('R');
 expect(document.querySelector('[aria-label="Reaction"]')).not.toBeNull();
});
it('replaces choices with the recorded result and explains stale requests',()=>{
 vi.stubGlobal('foundry',{utils:{escapeHTML:(s:string)=>s}});
 document.body.innerHTML=renderMovementCard('Bob',{state:'resolved',transition,outcome:'Caught the edge. No damage.'} as never);
 expect(document.body.textContent).toContain('Caught the edge. No damage.');
 expect(document.body.textContent).not.toContain('Movement is paused');
 document.body.innerHTML=renderMovementCard('Bob',{state:'stale',transition} as never);
 expect(document.body.textContent).toContain('This route has changed');
});
it('keeps private choice receipts out of the chat UI without suppressing native rolls',()=>{
 const hooks:Record<string,Function>={};vi.stubGlobal('Hooks',{on:(name:string,fn:Function)=>hooks[name]=fn});
 activateMovementDecisions();const html=document.createElement('li');
 hooks.renderChatMessageHTML({flags:{'codex-foundry':{movementResponse:{action:'climb'}}}},html);
 expect(html.hidden).toBe(true);
 const roll=document.createElement('li');hooks.renderChatMessageHTML({flags:{pf2e:{context:{type:'skill-check'}}}},roll);
 expect(roll.hidden).toBe(false);
});
