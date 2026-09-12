import { MODULE_ID } from "../../../constants.js";

export function registerGridlessSetting(): void {
    game.settings!.register(MODULE_ID, "gridlessCombat", {
        name: "codex-foundry.settings.gridlessCombat.name",
        hint: "codex-foundry.settings.gridlessCombat.hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        requiresReload: true,
    });

    game.settings!.register(MODULE_ID, "movementPreview", {
        name: "codex-foundry.settings.movementPreview.name",
        hint: "codex-foundry.settings.movementPreview.hint",
        scope: "world",
        config: true,
        type: String,
        choices: {
            off: "codex-foundry.settings.movementPreview.choices.off",
            circle: "codex-foundry.settings.movementPreview.choices.circle",
            ring: "codex-foundry.settings.movementPreview.choices.ring",
        },
        default: "ring",
    });
}

export type MovementPreviewMode = "off" | "circle" | "ring";

/** Read at render time so switching the overlay mode needs no reload. */
export function movementPreviewMode(): MovementPreviewMode {
    return game.settings!.get(MODULE_ID, "movementPreview");
}

export function isGridlessActive(): boolean {
    return !!canvas?.ready && canvas.grid!.isGridless
        && ["pf2e", "sf2e"].includes(game.system!.id)
        && game.settings!.get(MODULE_ID, "enableCustomRules")
        && game.settings!.get(MODULE_ID, "gridlessCombat");
}
