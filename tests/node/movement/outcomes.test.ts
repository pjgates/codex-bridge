import {afterEach,expect,it,vi} from 'vitest';
import {resolveLanding} from '../../../src/rulesets/sf2e/movement/landing.js';
vi.mock('../../../src/rulesets/sf2e/movement/damage.js',()=>({applyFallDamage:vi.fn(async()=>10)}));
import {applyFallDamage} from '../../../src/rulesets/sf2e/movement/damage.js';
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
function setup(mode:string){
 vi.stubGlobal('game',{settings:{get:(_ns:string,k:string)=>k==='movementOutcomeMode'?mode:true}});
 vi.stubGlobal('foundry',{applications:{api:{DialogV2:{confirm:vi.fn(async()=>true)}}},utils:{escapeHTML:(s:string)=>s,randomID:()=>"landing"}});
 const actor={items:[],skills:{},system:{movement:{speeds:{}}},increaseCondition:vi.fn()};
 const token={id:'t',actor,movement:{id:'m',state:'paused'},parent:{id:'s',regions:[{id:'floor',levels:new Set(['lower']),behaviors:[{type:'codex-foundry.setElevation',disabled:false,system:{elevation:-20}}],polygonTree:{testPoint:()=>true}}]},getMovementOrigin:(p:object)=>p,move:vi.fn(),_source:{x:39,y:0,elevation:0,level:'upper'}};
 token.move.mockImplementation(async(path:any[],options:any)=>{Object.assign(token._source,path.at(-1));token.movement.id=options.id;token.movement.state="completed";});
 const transition={ref:{tokenUuid:'Scene.s.Token.t',movementId:'m',checkpoint:0},safe:{x:39,y:0,elevation:0,level:'upper'},after:{x:41,y:0,elevation:0,level:'upper'},landing:{kind:'surface',support:{elevation:-20,regionId:'floor',levelIds:['lower']},level:'lower'}};
 const message={update:vi.fn()};return {token,transition,message};
}
it('lands on the selected lower level and applies typed damage once then prone',async()=>{
 const {token,transition,message}=setup('apply');
 await resolveLanding(token as never,transition as never,message as never);
 expect(token.move).toHaveBeenCalledWith([expect.objectContaining({elevation:-20,level:'lower'})],expect.anything());
 expect(applyFallDamage).toHaveBeenCalledTimes(1);expect(applyFallDamage).toHaveBeenCalledWith(token.actor,token,10,transition.ref,expect.any(Function));
 expect(token.actor.increaseCondition).toHaveBeenCalledWith('prone');
});
it('advisory and missing landing never mutate the token or actor',async()=>{
 const {token,transition,message}=setup('advisory');
 await resolveLanding(token as never,transition as never,message as never);
 expect(token.move).not.toHaveBeenCalled();expect(applyFallDamage).not.toHaveBeenCalled();
 transition.landing={kind:'none'} as never;
 await expect(resolveLanding(token as never,transition as never,message as never)).rejects.toThrow('landing');
});
it('reduces a water impact by local depth and uses the explicitly chosen swimming endpoint',async()=>{
 const {token,transition,message}=setup('apply');
 const region=(id:string,type:string,elevation?:number)=>({id,levels:new Set(['lower']),elevation:{bottom:-30,top:0},behaviors:[{type,disabled:false,system:{elevation}}],polygonTree:{testPoint:()=>true}});
 token.parent.regions=[region('water','codex-foundry.water'),region('bed','codex-foundry.setElevation',-10)] as never;
 transition.safe.elevation=40;transition.landing.support.elevation=-10;transition.landing.support.regionId='bed';
 await resolveLanding(token as never,transition as never,message as never,{water:{endpoint:'surface',diving:false}});
 expect(token.move).toHaveBeenCalledWith([expect.objectContaining({elevation:0,level:'lower'})],expect.anything());
 expect(applyFallDamage).toHaveBeenCalledWith(token.actor,token,15,transition.ref,expect.any(Function));
});

it('does not apply damage when native collision prevents reaching the landing',async()=>{
 const {token,transition,message}=setup('apply');token.move.mockImplementation(async()=>{});
 await expect(resolveLanding(token as never,transition as never,message as never)).rejects.toThrow('landing');
 expect(applyFallDamage).not.toHaveBeenCalled();
});

it('requires a ruling if native coordinate rounding changes the selected support',async()=>{
 const {token,transition,message}=setup('apply');
 transition.after.x=40.5;
 token.parent.regions.push({id:'bridge',levels:new Set(['upper']),behaviors:[{type:'codex-foundry.setElevation',disabled:false,system:{elevation:0}}],polygonTree:{testPoint:(point:{x:number})=>point.x>=41}} as never);
 await expect(resolveLanding(token as never,transition as never,message as never)).rejects.toThrow('support');
 expect(token.move).not.toHaveBeenCalled();expect(applyFallDamage).not.toHaveBeenCalled();
});
it('rejects a movement replaced while the result report is being persisted',async()=>{
 const {token,transition,message}=setup('apply');
 message.update.mockImplementationOnce(async()=>{(token.movement as any).id='anotherMove';});
 await expect(resolveLanding(token as never,transition as never,message as never)).rejects.toThrow('changed');
 expect(token.move).not.toHaveBeenCalled();expect(applyFallDamage).not.toHaveBeenCalled();
});
it('does not resolve an already pending forced fall after forced movement is disabled',async()=>{
 const {token,transition,message}=setup('apply');(transition as any).intent={kind:'forced',danger:'allowed'};
 (game.settings!.get as any)=(_ns:string,key:string)=>key==='movementOutcomeMode'?'apply':key!=='enableForcedMovement';
 await expect(resolveLanding(token as never,transition as never,message as never)).rejects.toThrow('settings');
 expect(token.move).not.toHaveBeenCalled();expect(applyFallDamage).not.toHaveBeenCalled();
});
it('honours cancellation while preserving the native movement ID and position',async()=>{
 const {token,transition,message}=setup('apply');message.update.mockImplementationOnce(async()=>{token.movement.state='stopped';});
 await expect(resolveLanding(token as never,transition as never,message as never)).rejects.toThrow('changed');
 expect(token.move).not.toHaveBeenCalled();expect(applyFallDamage).not.toHaveBeenCalled();
});
it('leaves exceptional gravity or a creature collision for a GM ruling',async()=>{
 const {token,transition,message}=setup('apply');
 (foundry as any).applications={api:{DialogV2:{confirm:vi.fn(async()=>false)}}};
 await resolveLanding(token as never,transition as never,message as never);
 expect(token.move).not.toHaveBeenCalled();expect(applyFallDamage).not.toHaveBeenCalled();
 expect(message.update).toHaveBeenCalledWith(expect.objectContaining({content:expect.stringContaining('GM ruling')}));
});
