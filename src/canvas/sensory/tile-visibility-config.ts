import { MODULE_ID } from "../../constants.js";
import { resolveHtmlRoot } from "../../shared/html.js";
import { sensoryFlag } from "./definition.js";
import { sensoryReferenceSelect } from "./reference-select.js";

let registered: typeof Hooks | null = null;

/** Flag-path fields use the native Tile form submission and its document permission checks. */
export function registerSensoryTileVisibilityConfig(): void {
    if (registered === Hooks) return;
    registered = Hooks;
    Hooks.on("renderTileConfig", (app, html) => {
        const root = resolveHtmlRoot(html);
        if (!root || root.querySelector('[data-codex-sensory="tile-visibility"]')) return;
        const stored = sensoryFlag(app.document.flags, "sensoryVisibility");
        const condition = stored && typeof stored === "object" && !Array.isArray(stored)
            ? stored as Record<string, unknown> : {};
        // Preserve malformed configured references until the author explicitly chooses None or an Effect.
        const uuid = stored === undefined ? "" : typeof condition.effectUuid === "string" ? condition.effectUuid : "invalid";
        const localize = (key: string) => game.i18n!.localize(`${MODULE_ID}.sensory.${key}`);
        const section = document.createElement("fieldset"); section.dataset.codexSensory = "tile-visibility";
        section.disabled = !app.isEditable;
        const legend = document.createElement("legend"); legend.textContent = localize("tileVisibilityTitle");
        const effectLabel = document.createElement("label"); effectLabel.className = "form-group";
        const effectText = document.createElement("span"); effectText.textContent = localize("definition");
        const select = sensoryReferenceSelect(uuid);
        select.name = `flags.${MODULE_ID}.sensoryVisibility.effectUuid`;
        effectLabel.append(effectText, select);
        const rankLabel = document.createElement("label"); rankLabel.className = "form-group";
        const rankText = document.createElement("span"); rankText.textContent = localize("tileVisibilityMinRank");
        const rank = document.createElement("input"); rank.type = "number"; rank.min = "1"; rank.step = "1";
        rank.required = true; rank.dataset.dtype = "Number"; rank.name = `flags.${MODULE_ID}.sensoryVisibility.minRank`;
        rank.value = typeof condition.minRank === "number" ? String(condition.minRank) : "1";
        rankLabel.append(rankText, rank);
        const hint = document.createElement("p"); hint.className = "hint"; hint.textContent = localize("tileVisibilityHint");
        section.append(legend, effectLabel, rankLabel, hint);
        (root.querySelector('.tab[data-tab="appearance"]') ?? root.querySelector("form") ?? root).append(section);
    });
}
