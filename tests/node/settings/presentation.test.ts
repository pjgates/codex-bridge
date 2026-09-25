// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { presentSettings, settingDependencies } from "../../../src/settings/presentation.js";
afterEach(() => vi.unstubAllGlobals());
function form(keys: string[]) {
    vi.stubGlobal("game", { i18n: { localize: (key: string) => key }, settings: { get: () => true } });
    const root = document.createElement("form");
    root.innerHTML = keys.map(key => `<div class="form-group"><label>${key}</label><input type="checkbox" name="codex-foundry.${key}" checked></div>`).join("");
    return root;
}
it("updates unsaved dependencies without clearing child preferences", () => {
    const root = form(["enableCustomRules", "enableTargetHelper", "playersRollAllDice", "pradStrictDCs"]);
    presentSettings(root);
    const inputs = root.querySelectorAll("input");
    inputs[1].checked = false; inputs[1].dispatchEvent(new Event("change", { bubbles: true }));
    expect(inputs[2].disabled).toBe(true); expect(inputs[3].disabled).toBe(true);
    expect(inputs[2].checked).toBe(true);
    expect(new FormData(root).has(inputs[2].name)).toBe(false);
    inputs[1].checked = true; inputs[1].dispatchEvent(new Event("change", { bubbles: true }));
    expect(inputs[2].disabled).toBe(false); expect(inputs[3].disabled).toBe(false);
});
it("groups only present settings and preserves native rows and sync buttons on repeat renders", () => {
    const root = form(["enableCodexSync", "movementDebug"]);
    const row = root.querySelector(".form-group")!;
    const button = document.createElement("button"); row.append(button);
    presentSettings(root); presentSettings(root);
    expect(root.querySelectorAll("h3")).toHaveLength(2);
    expect(row.querySelector("button")).toBe(button);
    expect(root.querySelectorAll(".form-group")).toHaveLength(2);
    expect(root.querySelector('[name="codex-foundry.movementDebug"]')).not.toBeNull();
});
it("disables strict DCs when Target Helper is off even when PRAD is saved on", () => {
    expect(settingDependencies({enableCustomRules:true,enableTargetHelper:false,playersRollAllDice:true}).pradStrictDCs).toBe(true);
});
it("hides empty headings when native search hides their rows", async () => {
    const root = form(["enableCodexSync", "movementDebug"]);
    presentSettings(root);
    root.querySelector<HTMLElement>(".form-group")!.hidden = true;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(root.querySelector<HTMLElement>("h3")!.hidden).toBe(true);
});
it('orders groups consistently despite feature registration order',()=>{
    const root=form(['enableCustomRules','gridlessCombat','movementDebug','enableFalling','enableCodexSync']);
    presentSettings(root);
    expect([...root.querySelectorAll<HTMLElement>('h3')].map(h=>h.dataset.codexSettingsHeading)).toEqual(['rules','movement','gridless','utilities','diagnostics']);
});
