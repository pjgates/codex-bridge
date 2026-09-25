import {afterEach,expect,it,vi} from 'vitest';
import {forcedIntent,registerForcedMovement,forcedMovementHeld} from '../../../src/rulesets/sf2e/movement/forced.js';
afterEach(()=>vi.unstubAllGlobals());
it('registers editable F and snapshots intent independently of later release or blur',()=>{
 let binding:any;const listeners:Record<string,Function>={};
 vi.stubGlobal('CONFIG',{Token:{movement:{actions:{}}}});
 vi.stubGlobal('window',{addEventListener:(name:string,fn:Function)=>listeners[name]=fn});
 vi.stubGlobal('canvas',{ready:false});vi.stubGlobal('game',{keybindings:{register:(_ns:string,_name:string,b:object)=>binding=b},settings:{get:()=>true}});
 registerForcedMovement();expect((CONFIG.Token.movement.actions as any)['codex-forced']).toMatchObject({teleport:false,walls:'move'});expect((CONFIG.Token.movement.actions as any)['codex-forced'].getCostFunction()(50)).toBe(0);expect(binding.editable).toEqual([{key:'KeyF'}]);
 binding.onDown();expect(forcedMovementHeld()).toBe(true);const submitted=forcedIntent(true);
 binding.onUp();expect(forcedMovementHeld()).toBe(false);expect(submitted).toEqual({kind:'forced',danger:'unknown'});
 binding.onDown();listeners.blur();expect(forcedMovementHeld()).toBe(false);
 expect(forcedIntent(false)).toEqual({kind:'voluntary'});
});
