import {expect,it,vi} from 'vitest';
import {canOutlineToken} from '../../../src/canvas/covered-tokens.js';
it('requires active PC sight, and never outlines hidden or unseen creatures',()=>{
 const token={hidden:false,filtered:false},source={active:true,pc:true};
 const detects=vi.fn(()=>true);
 expect(canOutlineToken(token,[],detects,()=>true)).toBe(false);
 expect(canOutlineToken(token,[{...source,pc:false}],detects,()=>true)).toBe(false);
 expect(canOutlineToken({...token,hidden:true},[source],detects,()=>true)).toBe(false);
 expect(detects).not.toHaveBeenCalled();
 expect(canOutlineToken(token,[source],()=>false,()=>true)).toBe(false);
 expect(canOutlineToken(token,[source],detects,()=>false)).toBe(false);
 expect(canOutlineToken(token,[source],detects,()=>true)).toBe(true);
});
