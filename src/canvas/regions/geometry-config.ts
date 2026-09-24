import { floorTop, geometryPreset, validateGeometry } from './geometry.js';
import type { SurfaceRegion } from './support.js';
import { isGeometryType } from './types.js';
import {openSurfaceVisibility} from './visibility-config.js';

type GeometryDocument = {
    id:string;type:string;disabled:boolean;system:Record<string,unknown>;
    parent:SurfaceRegion;toObject():{type:string;disabled:boolean;system:Record<string,unknown>};
};

/** Native fields remain the persistence authority; helpers only fill the unsaved form. */
export function activateGeometryConfig(): void {
    Hooks.on('renderRegionBehaviorConfig', (app, element) => {
        const doc = app.document as unknown as GeometryDocument;
        if (!game.user?.isGM || !isGeometryType(doc.type) || element.querySelector('[data-geometry-helper]')) { return; }
        const top = floorTop(doc.parent);
        const helper = document.createElement('fieldset');
        helper.dataset.geometryHelper = '';
        helper.innerHTML = `<legend>Surface presets</legend><p class="hint">Floor top: ${top ?? 'missing or ambiguous'} ft. Thickness changes only the underside.</p>
            <div class="form-group"><label>Preset</label><div class="form-fields"><select data-preset>
            <option value="">Custom</option><option value="solid">Solid terrain</option>
            <option value="deck">Solid bridge / balcony</option><option value="catwalk">Grated catwalk</option></select></div></div>
            <div class="form-group"><label>Thickness (ft)</label><div class="form-fields"><input data-thickness type="number" min="0" step="any"></div></div>`;
        const thickness = helper.querySelector<HTMLInputElement>('[data-thickness]')!;
        const preset = helper.querySelector<HTMLSelectElement>('[data-preset]')!;
        const underside = element.querySelector<HTMLInputElement>('[name="system.underside"]');
        if (top !== null && underside?.value) { thickness.value = String(top - Number(underside.value)); }
        const fill = () => {
            if (!preset.value) { return; }
            try {
                const bottom = top !== null && thickness.value !== '' ? top - Number(thickness.value) : null;
                const data = geometryPreset(preset.value as 'solid'|'deck'|'catwalk', bottom);
                validateGeometry(data, top);
                for (const [key, value] of Object.entries(data)) {
                    const input = element.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="system.${key}"]`);
                    if (!input) { continue; }
                    if (input instanceof HTMLInputElement && input.type === 'checkbox') { input.checked = Boolean(value); }
                    else { input.value = value === null ? '' : String(value); }
                }
            } catch (error) { ui.notifications?.warn((error as Error).message); }
        };
        preset.addEventListener('change', fill);
        thickness.addEventListener('change', () => {
            if (preset.value) { fill(); }
            else if (top !== null && underside && thickness.value !== '' && Number(thickness.value) > 0) {
                underside.value = String(top - Number(thickness.value));
            }
        });
        const form = element.matches('form') ? element : element.querySelector('form');
        const footer = form?.querySelector('footer');
        if (footer) { footer.before(helper); }
        else { form?.append(helper); }
        const visibility=document.createElement('button');visibility.type='button';visibility.textContent='Configure native visibility…';
        visibility.addEventListener('click',()=>void openSurfaceVisibility((doc.parent as SurfaceRegion&{uuid:string}).uuid));
        helper.append(visibility);
    });
    const validate = (doc:GeometryDocument, change:Record<string,unknown>) => {
        const next = foundry.utils.mergeObject(doc.toObject(), foundry.utils.expandObject(change), {inplace:false});
        if (!isGeometryType(next.type) || next.disabled) { return; }
        try {
            validateGeometry(next.system, floorTop(doc.parent));
            const others = [...doc.parent.behaviors].filter(b => !b.disabled && isGeometryType(b.type) && b !== doc);
            if (others.length) { throw new Error('Only one enabled Surface Geometry behaviour is allowed per floor.'); }
        } catch (error) {
            ui.notifications?.warn((error as Error).message);
            return false;
        }
    };
    Hooks.on('preCreateRegionBehavior', (doc, change) => validate(doc as unknown as GeometryDocument, change as unknown as Record<string,unknown>));
    Hooks.on('preUpdateRegionBehavior', (doc, change) => validate(doc as unknown as GeometryDocument, change as unknown as Record<string,unknown>));
}
