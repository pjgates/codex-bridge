import {configureSurfaceVisibility} from './visibility.js';

/** Explicit native blocker adoption; all values are re-read after the dialog. */
export async function openSurfaceVisibility(regionUuid:string):Promise<void> {
    const region=fromUuidSync(regionUuid) as unknown as {flags:Record<string,Record<string,unknown>>;parent:{regions:Iterable<{flags:Record<string,Record<string,unknown>>;behaviors:Iterable<{type:string;flags:Record<string,Record<string,unknown>>}>}>};behaviors:Iterable<{type:string;uuid:string;id:string;name:string;flags:Record<string,Record<string,unknown>>}>};
    const escape=foundry.utils.escapeHTML;
    const preview=await configureSurfaceVisibility({regionUuids:[regionUuid]});
    if(!preview.ok){ui.notifications?.warn(preview.error.message);return;}
    const native=[...region.behaviors].filter(b=>b.type==='defineSurface'&&!b.flags['codex-foundry']?.surfaceOwner);
    const key=region.flags['map-workshop']?.surfaceKey;
    const companion=[...region.parent.regions].find(r=>r.flags['codex-foundry']?.surfaceSource===regionUuid||key!==undefined&&r.flags['codex-foundry']?.surfaceSourceKey===key);
    const fading=[...companion?.behaviors??[]].find(b=>b.type==='defineSurface')?.flags['codex-foundry']?.surfaceOcclusion??'inherit';
    const content=`<p>Apply native sight/light at the floor plane across levels. Save geometry edits before using this action.</p>
        <div class="form-group"><label>Artwork fading</label><div class="form-fields"><select name="fading">${Object.entries({inherit:'Module default',off:'Off',on:'On'}).map(([key,label])=>`<option value="${key}" ${key===fading?'selected':''}>${label}</option>`).join('')}</select></div></div>
        <p>Native companion Occlusion edits save the same override. Sight and light blocking are independent.</p>
        <p>Adopt only existing surfaces that should follow this geometry. Sound settings are preserved.</p>
        ${native.map(b=>`<label class="checkbox"><input type="checkbox" name="adopt" value="${escape(b.uuid)}">${escape(b.name||b.id)} (${escape(b.uuid)})</label>`).join('')}
        <h3>Proposed changes</h3><ul>${preview.changes.map(c=>`<li>${escape(c.operation)} ${escape(c.documentUuid??'new companion region')}</li>`).join('')}</ul>
        <h3>Remaining blockers</h3><ul>${preview.conflicts.map(c=>`<li>${escape(c)}</li>`).join('')}</ul>`;
    const adopted=await foundry.applications.api.DialogV2.wait({window:{title:'Configure surface visibility'},content,
        buttons:[{action:'apply',label:'Apply',callback:(_event:Event,button:HTMLButtonElement)=>({adopt:Array.from(button.form!.querySelectorAll<HTMLInputElement>('[name="adopt"]:checked')).map(e=>e.value),fading:button.form!.querySelector<HTMLSelectElement>('[name="fading"]')!.value})},
            {action:'cancel',label:'Cancel',callback:()=>null}],close:()=>null}) as {adopt:string[];fading:'inherit'|'on'|'off'}|null;
    if(adopted===null)return;
    const result=await configureSurfaceVisibility({regionUuids:[regionUuid],adoptBehaviorUuids:adopted.adopt,fading:adopted.fading,apply:true});
    if(!result.ok){ui.notifications?.warn(result.error.message);return;}
    ui.notifications?.info(`Applied ${result.changes.length} native visibility changes.`);
    for(const conflict of result.conflicts)ui.notifications?.warn(conflict);
}
