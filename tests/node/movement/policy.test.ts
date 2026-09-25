import {afterEach,expect,it,vi} from 'vitest';
import {terrainChecksRequired} from '../../../src/rulesets/sf2e/movement/policy.js';
afterEach(()=>vi.unstubAllGlobals());
it('keeps combat checks and a live scene override while allowing free exploration',()=>{
 const values:Record<string,unknown>={climbOutsideCombat:false,swimOutsideCombat:false,terrainCheckOverride:''};
 const gm={id:'gm',isGM:true,active:true};const combat={started:false,scene:{id:'scene'}};
 vi.stubGlobal('game',{combat,combats:[combat],settings:{get:(_n:string,key:string)=>values[key]},users:{get:()=>gm}});
 const token={parent:{id:'scene'}};
 expect(terrainChecksRequired(token as never,'climbing')).toBe(false);expect(terrainChecksRequired(token as never,'swimming')).toBe(false);
 combat.started=true;expect(terrainChecksRequired(token as never,'climbing')).toBe(true);
 combat.started=false;values.terrainCheckOverride='gm:scene';expect(terrainChecksRequired(token as never,'climbing')).toBe(true);
 gm.active=false;expect(terrainChecksRequired(token as never,'climbing')).toBe(false);
 gm.active=true;values.terrainCheckOverride='gm:other';expect(terrainChecksRequired(token as never,'climbing')).toBe(false);
});

it('uses shared scene encounters rather than the encounter selected by this client',()=>{
 vi.stubGlobal('game',{combat:{started:false,scene:{id:'other'}},combats:[{started:true,scene:{id:'scene'}}],settings:{get:(_n:string,key:string)=>key==='terrainCheckOverride'?'':false}});
 expect(terrainChecksRequired({parent:{id:'scene'}} as never,'climbing')).toBe(true);
});
