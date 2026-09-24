import {afterEach,expect,it,vi} from 'vitest';
import {applyFallDamage} from '../../../src/rulesets/sf2e/movement/damage.js';
afterEach(()=>vi.unstubAllGlobals());
function setup(applied:number) {
 const hooks:Record<string,Function>={};
 vi.stubGlobal('Hooks',{on:(name:string,fn:Function)=>{hooks[name]=fn;return name;},off:vi.fn()});
 class DamageRoll {constructor(public formula:string){} async evaluate(){return this;}}
 vi.stubGlobal('CONFIG',{Dice:{rolls:[DamageRoll]}});vi.stubGlobal('foundry',{utils:{randomID:()=> 'unique'}});vi.stubGlobal('game',{system:{id:'sf2e'}});
 const token={id:'t',parent:{id:'s'}};
 const actor={uuid:'Actor.a',applyDamage:vi.fn(async(options:{rollOptions:Set<string>})=>{
   if(applied) hooks.updateActor(actor,{}, {damageTaken:applied});
   hooks.createChatMessage({speaker:{scene:'s',token:'t'},flags:{sf2e:{context:{type:'damage-taken',options:[...options.rollOptions]},appliedDamage:applied?{uuid:actor.uuid,updates:[{path:'system.attributes.hp.temp',value:applied}]}:null}}});
 })};
 return {actor,token};
}
it('uses a typed DamageRoll and returns damage absorbed by temporary HP',async()=>{
 const {actor,token}=setup(10);
 expect(await applyFallDamage(actor,token,10,{tokenUuid:'Scene.s.Token.t',movementId:'m',checkpoint:0},()=>{})).toBe(10);
 expect(actor.applyDamage.mock.calls[0][0]).toMatchObject({damage:{formula:'10[bludgeoning]'},token});
 expect(actor.applyDamage.mock.calls[0][0]).not.toHaveProperty('final');
});
it('recognizes full resistance from the correlated system damage message',async()=>{
 const {actor,token}=setup(0);
 expect(await applyFallDamage(actor,token,10,{tokenUuid:'Scene.s.Token.t',movementId:'m',checkpoint:0},()=>{})).toBe(0);
});
