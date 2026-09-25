import { MODULE_ID } from "../../constants.js";
import { resolveHtmlRoot } from "../../shared/html.js";
import { hasSensorySoundAssignment, resolveSensorySoundChannel } from "./sound-channel.js";
export { hasSensorySoundAssignment } from "./sound-channel.js";
let registered: typeof Hooks | null = null;
export function registerSensorySoundConfig(): void {
    if (registered === Hooks) return;
    registered = Hooks;
    Hooks.on("renderAmbientSoundConfig", (app, html) => {
        const root = resolveHtmlRoot(html);
        if (!root || root.querySelector('[data-codex-sensory="sound"]')) return;
        const section = document.createElement("fieldset"); section.dataset.codexSensory = "sound";
        section.disabled = !app.isEditable;
        const localize = (key: string) => game.i18n!.localize(`${MODULE_ID}.sensory.${key}`);
        const toggleLabel = document.createElement("label"); toggleLabel.className = "form-group";
        const toggleText = document.createElement("span"); toggleText.textContent = localize("soundTitle");
        const enabled = document.createElement("input"); enabled.type = "checkbox";
        enabled.checked = hasSensorySoundAssignment(app.document);
        toggleLabel.append(toggleText, enabled);
        const channelLabel = document.createElement("label"); channelLabel.className = "form-group";
        const channelText = document.createElement("span"); channelText.textContent = localize("channel");
        const channel = document.createElement("input"); channel.type = "text";
        const channelPath = `flags.${MODULE_ID}.sensoryChannel`; channel.pattern = ".*\\S.*";
        channel.value = resolveSensorySoundChannel(app.document) ?? "";
        // Exactly one channel field participates in native form submission; the unchecked value explicitly clears privacy.
        const cleared = document.createElement("input"); cleared.type = "hidden"; cleared.value = "";
        const update = () => {
            channel.name = enabled.checked ? channelPath : "";
            cleared.name = enabled.checked ? "" : channelPath;
            channel.disabled = !enabled.checked; channel.required = enabled.checked; cleared.disabled = enabled.checked;
        };
        enabled.addEventListener("change", update); update();
        channelLabel.append(channelText, channel, cleared);
        const hint = document.createElement("p"); hint.className = "hint"; hint.textContent = localize("soundHint");
        section.append(toggleLabel, channelLabel, hint);
        (root.querySelector("form") ?? root).append(section);
    });
}
