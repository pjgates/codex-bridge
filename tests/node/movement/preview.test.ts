import {afterEach,expect,it,vi} from 'vitest';
import {previewSummary,routeBudget} from '../../../src/rulesets/sf2e/movement/preview.js';
afterEach(()=>vi.unstubAllGlobals());
it('uses separate Speeds for mixed movement and no movement actions for forced movement',()=>{
 const actor={items:[],system:{movement:{speeds:{land:{value:25},climb:{value:10},swim:{value:20},fly:{value:40}}}}};
 expect(routeBudget(actor,[{action:'walk',cost:20},{action:'climb',cost:10},{action:'fly',cost:30}])).toMatchObject({actions:3,remaining:10,estimated:false});
 expect(routeBudget(actor,[{action:'swim',cost:30}])).toMatchObject({actions:2,remaining:10});
 expect(routeBudget(actor,[{action:'codex-forced',cost:50}])).toMatchObject({actions:0});
 expect(routeBudget(actor,[{action:'climb',cost:10},{action:'climb',cost:10}])).toMatchObject({actions:2});
});
it('labels ordinary climbing and swimming budgets as success estimates without special Speeds',()=>{
 const actor={items:[],system:{movement:{speeds:{land:{value:25}}}}};
 expect(routeBudget(actor,[{action:'climb',cost:10}])).toMatchObject({actions:2,estimated:true});
 expect(routeBudget(actor,[{action:'swim',cost:20}])).toMatchObject({actions:2,estimated:true});
 expect(routeBudget(actor,[{action:'fly',cost:20}])).toBeNull();
});
it('distinguishes a fall reaction, forced permission and unknown landing in previews',()=>{
 vi.stubGlobal('game',{});
 const token={actor:null,parent:{regions:[]}};
 const transition={reason:'fall',intent:{kind:'voluntary'},safe:{elevation:20},after:{},sourceRegionId:'edge',landing:{kind:'surface',support:{elevation:0}}};
 expect(previewSummary(token as never,{transition,waypoints:[]} as never)).toMatchObject({label:'Fall ↓ 20 ft',reaction:true,hint:'Pause'});
 expect(previewSummary(token as never,{transition:{...transition,intent:{kind:'forced',danger:'unknown'}},waypoints:[]} as never)).toMatchObject({reaction:false,hint:'GM: effect type'});
 expect(previewSummary(token as never,{transition:{...transition,reason:'ruling',landing:{kind:'none'}},waypoints:[]} as never)).toMatchObject({label:'Landing unknown',reaction:false});
});

it('does not apply check bonuses to automatic special-Speed movement',()=>{
 const actor={items:[{type:'feat',system:{slug:'quick-swim'}},{type:'feat',system:{slug:'quick-climb'}}],system:{movement:{speeds:{land:{value:25},swim:{value:20},climb:{value:10}}}}};
 expect(routeBudget(actor,[{action:'swim',cost:25}])).toMatchObject({actions:2,estimated:false});
 expect(routeBudget(actor,[{action:'climb',cost:15}])).toMatchObject({actions:2,estimated:false});
 expect(routeBudget(actor,[{action:'swim',cost:25,check:true}])).toMatchObject({actions:1,estimated:true});
});
