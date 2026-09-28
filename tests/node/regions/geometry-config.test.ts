// @vitest-environment happy-dom
import {afterEach,expect,it,vi} from 'vitest';
import {activateGeometryConfig} from '../../../src/canvas/regions/geometry-config.js';
afterEach(()=>{vi.unstubAllGlobals();document.body.innerHTML='';});
it('keeps thickness presets while directing visibility editing to native Define Surface',()=>{
 const hooks=new Map<string,Function>();
 vi.stubGlobal('Hooks',{on:(name:string,fn:Function)=>hooks.set(name,fn)});
 vi.stubGlobal('game',{user:{isGM:true}});
 vi.stubGlobal('ui',{notifications:{warn:(message:string)=>{throw Error(message);}}});
 document.body.innerHTML='<form><section><input name="system.underside" value="17.5"><select name="system.extent"><option value="finite">Finite</option><option value="solid">Solid</option></select><div class="form-group"><input name="system.blocksSight" type="checkbox" checked></div><div class="form-group"><input name="system.blocksLight" type="checkbox" checked></div><footer><button>Update</button></footer></section></form>';
 activateGeometryConfig();
 const app={document:{type:'codex-foundry.surfaceGeometry',parent:{behaviors:[{type:'codex-foundry.setElevation',disabled:false,system:{elevation:20}}]}}};
 expect(()=>hooks.get('renderRegionBehaviorConfig')!(app,document.querySelector('form'))).not.toThrow();
 const thickness=document.querySelector<HTMLInputElement>('[data-thickness]')!;
 expect(thickness.value).toBe('2.5');thickness.value='1.25';
 const preset=document.querySelector<HTMLSelectElement>('[data-preset]')!;preset.value='catwalk';preset.dispatchEvent(new Event('change'));
 expect(document.querySelector<HTMLInputElement>('[name="system.underside"]')!.value).toBe('18.75');
 expect(document.querySelector('[name="system.blocksSight"]')).toBeNull();
 expect(document.querySelector('[name="system.blocksLight"]')).toBeNull();
 expect(document.querySelector('[data-geometry-helper]')!.textContent).toContain('Define Surface');
 expect(document.querySelector('[data-geometry-helper] button')).toBeNull();
});
