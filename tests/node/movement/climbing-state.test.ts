import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {setClimbing} from '../../../src/rulesets/sf2e/movement/climbing-state.js';
import {setTerrainStatus,terrainStatusData,refreshTerrainSpeeds} from '../../../src/rulesets/sf2e/movement/status.js';
afterEach(()=>vi.unstubAllGlobals());
beforeEach(()=>vi.stubGlobal('game',{pf2e:{ConditionManager:{conditions:new Map([['off-guard',{uuid:'Compendium.sf2e.conditions.Item.offguard'}]])}}}));
function actor(){const a={items:[] as any[],async createEmbeddedDocuments(_type:string,data:any[]){for(const item of data){item.delete=async()=>{a.items=a.items.filter(i=>i!==item);};a.items.push(item);}}};return a;}
it('keeps a visible climbing effect with speed/feat predicates instead of hiding the status',async()=>{
 const a=actor();await setClimbing(a,'Scene.s.Token.t',true);await setClimbing(a,'Scene.s.Token.t',true);
 expect(a.items).toHaveLength(1);expect(a.items[0]).toMatchObject({type:'effect',system:{slug:'codex-climbing',tokenIcon:{show:true}}});
 expect(a.items[0].system.rules).toContainEqual(expect.objectContaining({key:'GrantItem',inMemoryOnly:true,predicate:[{nor:['speed:climb','feat:combat-climber']}]}));
});
it('removes only its own status and migrates legacy climbing off-guard',async()=>{
 const a=actor();const other={type:'condition',system:{slug:'off-guard'},flags:{},delete:vi.fn()};a.items.push(other);
 const legacy={type:'condition',system:{slug:'off-guard'},flags:{'codex-foundry':{climbingToken:'Scene.s.Token.t'}},delete:async()=>{a.items=a.items.filter(i=>i!==legacy);}};a.items.push(legacy);
 await setClimbing(a,'Scene.s.Token.t',true);expect(a.items).toHaveLength(2);
 await setClimbing(a,'Scene.s.Token.t',false);expect(a.items).toEqual([other]);expect(other.delete).not.toHaveBeenCalled();
});
it('swimming honours prepared swim Speed and the native aquatic-combat feat option',()=>{
 expect(terrainStatusData('swimming','Scene.s.Token.t').system.rules).toContainEqual(expect.objectContaining({uuid:'Compendium.sf2e.conditions.Item.offguard',predicate:[{nor:['speed:swim','aquatic-combat:not-off-guard']}]}));
});
it('serializes entry and exit so a delayed effect write cannot leave stale status',async()=>{
 const a=actor();const create=a.createEmbeddedDocuments;let finish!:()=>void;const delay=new Promise<void>(r=>finish=r);
 a.createEmbeddedDocuments=async(...args)=>{await delay;return create(...args);};
 const entering=setTerrainStatus(a,'Scene.s.Token.t','swimming',true),leaving=setTerrainStatus(a,'Scene.s.Token.t','swimming',false);
 finish();await Promise.all([entering,leaving]);expect(a.items).toHaveLength(0);
});

it('prepared speed changes remove and restore the conditional penalty without removing the status',async()=>{
 const a=actor() as ReturnType<typeof actor> & {system:any};a.system={movement:{speeds:{climb:{value:20}}}};
 await setClimbing(a,'Scene.s.Token.t',true);const effect=a.items[0];expect(effect.system.rules.some((r:any)=>r.key==='GrantItem')).toBe(false);
 effect.update=async(changes:any)=>{effect.system.rules=changes['system.rules'];effect.flags['codex-foundry'].terrainSpeed=changes['flags.codex-foundry.terrainSpeed'];effect.flags['codex-foundry'].terrainStatusVersion=changes['flags.codex-foundry.terrainStatusVersion'];};
 a.system.movement.speeds.climb=null;await refreshTerrainSpeeds(a);expect(effect.system.rules.some((r:any)=>r.key==='GrantItem')).toBe(true);
 a.system.movement.speeds.climb={value:20};await refreshTerrainSpeeds(a);expect(a.items).toHaveLength(1);expect(effect.system.rules.some((r:any)=>r.key==='GrantItem')).toBe(false);
 const leaving=setClimbing(a,'Scene.s.Token.t',false),refresh=refreshTerrainSpeeds(a);await Promise.all([leaving,refresh]);expect(a.items).toHaveLength(0);
});
