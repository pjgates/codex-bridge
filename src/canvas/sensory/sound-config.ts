import type { SensorySoundDocument } from "./types.js";
import { MODULE_ID } from "../../constants.js";
import { resolveHtmlRoot } from "../../shared/html.js";
import { sensoryFlag } from "./definition.js";
import { sensoryReferenceSelect } from "./reference-select.js";
export function hasSensorySoundAssignment(document: Pick<SensorySoundDocument, "flags">): boolean {
    const value = sensoryFlag(document.flags, "sensoryEffect");
    return value !== undefined && value !== "";
}
export function registerSensorySoundConfig(): void {
    Hooks.on("renderAmbientSoundConfig", (app, html) => {
        const root = resolveHtmlRoot(html);
        if (!root || root.querySelector('[data-codex-sensory="sound"]')) return;
        const group = document.createElement("label"); group.className = "form-group"; group.dataset.codexSensory = "sound";
        const label = document.createElement("span"); label.textContent = game.i18n!.localize(`${MODULE_ID}.sensory.soundTitle`);
        const current = sensoryFlag(app.document.flags, "sensoryEffect");
        const select = sensoryReferenceSelect(typeof current === "string" ? current : "");
        if (hasSensorySoundAssignment(app.document) && typeof current !== "string") {
            const invalid = document.createElement("option"); invalid.value = "invalid";
            invalid.textContent = game.i18n!.localize(`${MODULE_ID}.sensory.missing`); select.append(invalid); select.value = "invalid";
        }
        select.name = `flags.${MODULE_ID}.sensoryEffect`;
        group.append(label, select);
        const hint = document.createElement("p"); hint.className = "hint";
        hint.textContent = game.i18n!.localize(`${MODULE_ID}.sensory.soundHint`); group.append(hint);
        (root.querySelector("form") ?? root).append(group);
    });
}
