/** Region mask selections are saved by the tile sheet's normal form submission. */
import { MODULE_ID } from '../../constants.js';
import { maskRegions } from './mask.js';

export function clipRegionField(document: TileDocument.Implementation): HTMLElement {
    const current = maskRegions(document as { flags?: Record<string, unknown> });
    const container = window.document.createElement('fieldset');
    container.className = 'codex-tile-masks';
    const legend = window.document.createElement('legend');
    legend.textContent = game.i18n!.localize(`${MODULE_ID}.clipTiles.title`);
    container.append(legend);
    const regions = document.parent?.regions.contents ?? [];
    for (const [flag, key, selected] of [
        ['clipRegions', 'include', current.include], ['excludeRegions', 'exclude', current.exclude],
    ] as const) {
        const group = window.document.createElement('div');
        group.className = 'form-group';
        const label = window.document.createElement('label');
        label.textContent = game.i18n!.localize(`${MODULE_ID}.clipTiles.${key}Label`);
        const id = `codex-${document.id}-${flag}`;
        label.htmlFor = id;
        const fields = window.document.createElement('div');
        fields.className = 'form-fields';
        const select = window.document.createElement('multi-select');
        select.setAttribute('name', `flags.${MODULE_ID}.${flag}`);
        select.id = id;
        const choices = new Map(regions.map(r => [r.id!, r.name]));
        for (const missing of selected.filter(id => !choices.has(id))) choices.set(missing, `Missing region (${missing})`);
        for (const [value, text] of [...choices].sort((a, b) => a[1].localeCompare(b[1]))) {
            const option = window.document.createElement('option');
            option.value = value; option.textContent = text; option.selected = selected.includes(value);
            select.append(option);
        }
        fields.append(select);
        const hint = window.document.createElement('p');
        hint.className = 'hint';
        hint.textContent = game.i18n!.localize(`${MODULE_ID}.clipTiles.${key}Hint`);
        group.append(label, fields, hint);
        container.append(group);
    }
    return container;
}

export function activateClipTileConfig(): void {
    Hooks.on('renderTileConfig', (app: { document: TileDocument.Implementation }, element: HTMLElement) => {
        const tab = element.querySelector<HTMLElement>('.tab[data-tab="appearance"]');
        if (!tab || tab.querySelector('.codex-tile-masks')) return;
        tab.append(clipRegionField(app.document));
    });
}
