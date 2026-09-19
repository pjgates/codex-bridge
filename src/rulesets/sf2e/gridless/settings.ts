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

    game.settings!.register(MODULE_ID, "movementLattice", {
        name: "codex-foundry.settings.movementLattice.name",
        hint: "codex-foundry.settings.movementLattice.hint",
        scope: "world",
        config: true,
        type: String,
        choices: {
            continuous: "codex-foundry.settings.movementLattice.choices.continuous",
            hex: "codex-foundry.settings.movementLattice.choices.hex",
        },
        default: "continuous",
    });

    game.settings!.register(MODULE_ID, "movementDebug", {
        name: "codex-foundry.settings.movementDebug.name",
        hint: "codex-foundry.settings.movementDebug.hint",
        scope: "client",
        config: true,
        type: Boolean,
        default: false,
        onChange: () => {
            if (canvas?.ready) for (const token of canvas.tokens!.controlled) token.renderFlags.set({ refreshRuler: true });
        },
    });
}

export type MovementLatticeMode = "continuous" | "hex";

/** Read at render time so switching the lattice needs no reload. */
export function movementLatticeMode(): MovementLatticeMode {
    return game.settings!.get(MODULE_ID, "movementLattice");
}

export type MovementPreviewMode = "off" | "circle" | "ring";

/** Read at render time so switching the overlay mode needs no reload. */
export function movementPreviewMode(): MovementPreviewMode {
    return game.settings!.get(MODULE_ID, "movementPreview");
}

export function movementDebugEnabled(): boolean {
    return game.settings!.get(MODULE_ID, "movementDebug");
}

export function isGridlessActive(): boolean {
    return !!canvas?.ready && canvas.grid!.isGridless
        && ["pf2e", "sf2e"].includes(game.system!.id)
        && game.settings!.get(MODULE_ID, "enableCustomRules")
        && game.settings!.get(MODULE_ID, "gridlessCombat");
}
