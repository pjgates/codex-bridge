import {afterEach,expect,it,vi} from 'vitest';
import {createRuntimeApi} from '../../../src/api.js';
afterEach(()=>vi.unstubAllGlobals());
it('bounds forced movement input and restricts it to enabled GM calls',async()=>{
 const user={isGM:true};vi.stubGlobal('game',{user,settings:{get:()=>true}});
 const api=createRuntimeApi();
 expect(await api.movement.forceMove({tokenUuid:'Actor.wrong',waypoints:[],danger:'allowed'})).toMatchObject({ok:false,error:{code:'invalid-argument'}});
 const request={tokenUuid:'Scene.s.Token.t',waypoints:[{x:10,y:20}],danger:'allowed' as const};
 user.isGM=false;expect(await api.movement.forceMove(request)).toMatchObject({ok:false,error:{code:'unauthorized'}});
 user.isGM=true;const move=vi.fn();vi.stubGlobal('fromUuidSync',()=>({documentName:'Token',move}));
 expect(await api.movement.forceMove(request)).toEqual({ok:true});expect(move).toHaveBeenCalledWith(request.waypoints,{codexMovementIntent:{kind:'forced',danger:'allowed'}});
 (game.settings!.get as unknown)=()=>false;
 expect(await api.movement.forceMove(request)).toMatchObject({ok:false,error:{code:'disabled'}});
});
