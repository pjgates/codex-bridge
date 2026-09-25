import { MODULE_ID } from "../constants.js";
import { resolveHtmlRoot } from "../shared/html.js";

const groups: Record<string, string[]> = {
    rules: ["enableCustomRules", "enableTargetHelper", "playersRollAllDice", "pradStrictDCs", "heroicRerolls"],
    movement: ["promptMovementChecks", "enableClimbing", "climbOutsideCombat", "enableSwimming", "swimOutsideCombat", "explorationMovementNotices", "enableFalling", "enableFlightUpkeep", "enableForcedMovement", "movementOutcomeMode"],
    gridless: ["gridlessCombat", "movementPreview", "movementLattice"],
    utilities: ["surfaceFading", "coveredTokenOutlines", "enableCodexSync", "codexSyncPassphrase", "enableStatblockImporter"],
    diagnostics: ["movementDebug"],
};

export function settingDependencies(values: Readonly<Record<string, boolean>>): Record<string, boolean> {
    const off = !values.enableCustomRules;
    return {
        enableTargetHelper: off, heroicRerolls: off,
        enableClimbing: off, climbOutsideCombat: off, enableSwimming: off, swimOutsideCombat: off, enableFalling: off, enableForcedMovement: off,
        enableFlightUpkeep: off || !values.enableFalling, movementOutcomeMode: off, explorationMovementNotices: off,
        playersRollAllDice: off || !values.enableTargetHelper,
        pradStrictDCs: off || !values.enableTargetHelper || !values.playersRollAllDice,
    };
}

const presentations = new WeakMap<HTMLElement, AbortController>();
export function presentSettings(root: HTMLElement): void {
    presentations.get(root)?.abort();
    const controller = new AbortController(); presentations.set(root, controller);
    const sections: { heading: HTMLElement; rows: HTMLElement[] }[] = [];
    root.querySelectorAll("[data-codex-settings-heading]").forEach(node => node.remove());
    const anchor = document.createComment("Codex settings");
    const first = root.querySelector(`[name^="${MODULE_ID}."]`)?.closest(".form-group");
    if (!first) return;
    first.before(anchor);
    for (const [group, keys] of Object.entries(groups)) {
        const rows = keys.map(key => root.querySelector(`[name="${MODULE_ID}.${key}"]`)?.closest(".form-group")).filter(row => !!row);
        if (!rows.length) continue;
        const heading = document.createElement("h3");
        heading.dataset.codexSettingsHeading = group;
        heading.textContent = game.i18n!.localize(`${MODULE_ID}.settings.groups.${group}`);
        anchor.before(heading);
        for (const row of rows) anchor.before(row);
        sections.push({ heading, rows: rows as HTMLElement[] });
    }
    anchor.remove();
    const search = new MutationObserver(() => {
        for (const { heading, rows } of sections) {
            const hidden = rows.every(row => row.hidden);
            if (heading.hidden !== hidden) heading.hidden = hidden;
        }
    });
    search.observe(root, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
    controller.signal.addEventListener("abort", () => search.disconnect());
    const refresh = (): void => {
        const values: Record<string, boolean> = {};
        for (const key of ["enableCustomRules", "enableTargetHelper", "playersRollAllDice", "enableFalling"] as const) {
            const input = root.querySelector<HTMLInputElement>(`input[name="${MODULE_ID}.${key}"]`);
            values[key] = input?.checked ?? Boolean(game.settings!.get(MODULE_ID, key));
        }
        for (const [key, disabled] of Object.entries(settingDependencies(values))) {
            const input = root.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${MODULE_ID}.${key}"]`);
            if (!input) continue;
            input.disabled = disabled;
            input.closest(".form-group")?.classList.toggle("disabled", disabled);
            input.title = disabled ? game.i18n!.localize(`${MODULE_ID}.settings.dependencyHint`) : "";
        }
    };
    root.addEventListener("change", refresh, { signal: controller.signal });
    refresh();
}

export function activateSettingsPresentation(): void {
    Hooks.on("renderSettingsConfig", (_app: object, html: HTMLElement) => {
        const root = html instanceof HTMLElement ? html : resolveHtmlRoot(html);
        if (root) presentSettings(root);
    });
}
