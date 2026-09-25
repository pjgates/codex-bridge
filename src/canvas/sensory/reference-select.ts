import { MODULE_ID } from "../../constants.js";
import { lookupWorldDefinition } from "./definition.js";
export function sensoryReferenceSelect(currentUuid: string): HTMLSelectElement {
    const select = document.createElement("select");
    const option = (value: string, name: string) => {
        const node = document.createElement("option"); node.value = value; node.textContent = name;
        node.selected = value === currentUuid; select.append(node);
    };
    option("", game.i18n!.localize(`${MODULE_ID}.sensory.none`));
    for (const item of game.items?.contents ?? []) if (lookupWorldDefinition(item.uuid)) option(item.uuid, item.name);
    if (currentUuid && !Array.from(select.options).some(node => node.value === currentUuid)) {
        option(currentUuid, `${game.i18n!.localize(`${MODULE_ID}.sensory.missing`)} (${currentUuid})`);
    }
    return select;
}
