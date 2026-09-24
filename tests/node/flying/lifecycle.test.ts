import {afterEach,expect,it,vi} from 'vitest';
import {activateFalling,endsFlight} from '../../../src/rulesets/sf2e/flying/fall.js';
afterEach(()=>vi.unstubAllGlobals());
it('does not end flight on a forced move and sends condition/effect loss through the shared fall owner',async()=>{
 const hooks:Record<string,Function>={};vi.stubGlobal('Hooks',{on:(name:string,fn:Function)=>hooks[name]=fn});
 vi.stubGlobal('game',{user:{id:'gm'},users:{activeGM:{id:'gm'}}});vi.stubGlobal('CONFIG',{Token:{movement:{actions:{'codex-forced':{},fly:{}}}}});
 const request=vi.fn(async()=>{});activateFalling(request);
 const actor={items:[{type:'effect',system:{slug:'codex-flying'}}],getActiveTokens:()=>[{uuid:'Scene.s.Token.a'},{uuid:'Scene.s.Token.b'}]};
 expect(endsFlight([{action:'codex-forced'}],{})).toBe(false);
 hooks.moveToken({actor,uuid:'Scene.s.Token.a'},{passed:{waypoints:[{action:'codex-forced'}]},pending:{waypoints:[]}}, {}, {id:'gm'});
 expect(request).not.toHaveBeenCalled();
 hooks.createItem({actor,type:'condition',system:{slug:'prone'}},{},'player');
 expect(request).toHaveBeenCalledTimes(2);
 await Promise.resolve();actor.items=[];
 hooks.deleteItem({actor,type:'effect',system:{slug:'codex-flying'}},{},'player');
 expect(request).toHaveBeenCalledTimes(4);
});
it('notices prepared fly Speed lost through an item deletion or update',async()=>{
 const hooks:Record<string,Function>={};vi.stubGlobal('Hooks',{on:(name:string,fn:Function)=>hooks[name]=fn});
 vi.stubGlobal('game',{user:{id:'gm'},users:{activeGM:{id:'gm'}}});const request=vi.fn(async()=>{});activateFalling(request);
 const actor={items:[{type:'effect',system:{slug:'codex-flying'}}],system:{movement:{speeds:{fly:null}}},getActiveTokens:()=>[{uuid:'Scene.s.Token.fly'}]};
 hooks.deleteItem({actor,type:'effect',system:{slug:'fly-spell'}});await Promise.resolve();expect(request).toHaveBeenCalledTimes(1);
 hooks.updateItem({actor,type:'effect',system:{slug:'wings'}});await Promise.resolve();expect(request).toHaveBeenCalledTimes(2);
});
