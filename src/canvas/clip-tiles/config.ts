/**
 * Adds a "Clip to region" select to the Tile configuration sheet's appearance
 * tab. The field is named as a flag path, so the sheet's normal submit writes it.
 */

import { MODULE_ID } from "../../constants.js";
import { CLIP_FLAG } from "./clip.js";
import { clipRegionId, regionOptions } from "./rings.js";

export function clipRegionField(document: TileDocument.Implementation): HTMLElement {
    const current = clipRegionId(document as { flags?: Record<string, unknown> }, MODULE_ID);
    const options = regionOptions(document.parent?.regions.contents ?? [], current, game.i18n!.localize(`${MODULE_ID}.clipTiles.none`));
    const group = window.document.createElement("div");
    group.className = "form-group";
    const label = window.document.createElement("label");
    label.textContent = game.i18n!.localize(`${MODULE_ID}.clipTiles.label`);
    const fields = window.document.createElement("div");
    fields.className = "form-fields";
    const select = window.document.createElement("select");
    select.name = `flags.${MODULE_ID}.${CLIP_FLAG}`;
    for (const option of options) {
        const el = window.document.createElement("option");
        el.value = option.value; el.textContent = option.label; el.selected = option.selected;
        select.append(el);
    }
    fields.append(select);
    const hint = window.document.createElement("p");
    hint.className = "hint";
    hint.textContent = game.i18n!.localize(`${MODULE_ID}.clipTiles.hint`);
    group.append(label, fields, hint);
    return group;
}

export function activateClipTileConfig(): void {
    Hooks.on("renderTileConfig", (app: { document: TileDocument.Implementation }, element: HTMLElement) => {
        const tab = element.querySelector<HTMLElement>('.tab[data-tab="appearance"]');
        if (!tab || tab.querySelector(`select[name="flags.${MODULE_ID}.${CLIP_FLAG}"]`)) return;
        tab.append(clipRegionField(app.document));
    });
}
