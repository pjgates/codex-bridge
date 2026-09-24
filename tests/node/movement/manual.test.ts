import {afterEach,expect,it,vi} from 'vitest';
import {resolveMovementChoice} from '../../../src/rulesets/sf2e/movement/resolution.js';
afterEach(()=>vi.unstubAllGlobals());
it('moves a GM manual resolution to the requested destination with collision enabled',async()=>{
 vi.stubGlobal('foundry',{utils:{escapeHTML:(s:string)=>s,randomID:()=> 'manual'}});
 const token={uuid:'t',_source:{x:0,y:0,elevation:0,level:'upper'},parent:{regions:[]},getMovementOrigin:(p:object)=>p,
  movement:{id:'paused',state:'paused',pending:{waypoints:[{x:10,y:0,elevation:0,level:'upper',action:'teleport',checkpoint:true}]}},move:vi.fn(async()=>true)};
 const data={transition:{ref:{movementId:'paused'}}},message={update:vi.fn()};
 await resolveMovementChoice(token as never,data as never,'manual',{id:'gm',isGM:true},message as never);
 expect(token.move).toHaveBeenCalledWith([expect.objectContaining({x:10,action:'walk',checkpoint:false})],expect.objectContaining({codexMovementPlanned:true,constrainOptions:{ignoreWalls:false,ignoreCost:true}}));
 expect(message.update).toHaveBeenCalledWith(expect.objectContaining({content:expect.stringContaining('destination')}));
 token.move.mockClear(); await resolveMovementChoice(token as never,data as never,'manual',{id:'p',isGM:false},message as never);
 expect(token.move).not.toHaveBeenCalled();
});
it('reports native collision instead of claiming arrival',async()=>{
 vi.stubGlobal('foundry',{utils:{escapeHTML:(s:string)=>s,randomID:()=> 'manual'}});
 const token={_source:{x:0,y:0,elevation:0,level:'upper'},parent:{regions:[]},getMovementOrigin:(p:object)=>p,
  movement:{id:'paused',state:'paused',pending:{waypoints:[{x:10,y:0,elevation:0,level:'upper'}]}},move:vi.fn(async()=>false)};
 const message={update:vi.fn()};
 await resolveMovementChoice(token as never,{transition:{ref:{movementId:'paused'}}} as never,'manual',{id:'gm',isGM:true},message as never);
 expect(message.update).toHaveBeenCalledWith(expect.objectContaining({content:expect.stringContaining('blocked')}));
});
