import { MODULE_ID } from "../../../constants.js";

/** One held key shared by the elevation tooltip and the floor probe: absolute heights while down. */
let held = false;
const listeners = new Set<(held: boolean) => void>();

export function absoluteElevationHeld(): boolean {
    return held;
}

export function onAbsoluteElevationChange(listener: (held: boolean) => void): void {
    listeners.add(listener);
}

export function setAbsoluteElevationHeld(value: boolean): void {
    if (held === value) return;
    held = value;
    for (const listener of listeners) listener(held);
}

export function registerAbsoluteElevationKeybind(): void {
    game.keybindings!.register(MODULE_ID, "absoluteElevation", {
        name: "codex-foundry.gridless.absoluteElevationName",
        hint: "codex-foundry.gridless.absoluteElevationHint",
        editable: [{ key: "KeyH" }],
        onDown: () => { setAbsoluteElevationHeld(true); return true; },
        onUp: () => { setAbsoluteElevationHeld(false); return true; },
    });
}
