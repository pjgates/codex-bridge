// @vitest-environment happy-dom

const REVISION = "11111111-1111-4111-8111-111111111111";

import { beforeEach, describe, expect, it } from "vitest";
import { buildTooltipHtml, escapeTooltipText, onRenderTargetHelper, reserveTargetRowsWrapper } from "../../../src/rulesets/sf2e/target-helper/render.js";
import { encodeTargetUuidSaveKey } from "../../../src/rulesets/sf2e/target-helper/result-validation.js";

beforeEach(() => {
    Object.assign(globalThis, {
        game: { user: { isGM: true }, i18n: { localize: (key: string) => key } },
        foundry: { applications: { handlebars: { renderTemplate: async () => "<span></span>" } } },
        fromUuidSync: () => null,
    });
});

describe("reserveTargetRowsWrapper", () => {
    it("reserves the target rows container synchronously", () => {
        const parent = document.createElement("div");

        const firstWrapper = reserveTargetRowsWrapper(parent);
        const secondWrapper = reserveTargetRowsWrapper(parent);

        expect(firstWrapper).not.toBeNull();
        expect(secondWrapper).toBeNull();
        expect(parent.querySelectorAll(".th-target-rows")).toHaveLength(1);
    });
});

describe("target-helper tooltips", () => {
    it("escapes every HTML-significant character", () => {
        expect(escapeTooltipText(`<img src="x" onerror='alert(1)'>&`)).toBe("&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;");
    });

    it("does not interpolate modifier labels as HTML", () => {
        const tooltip = buildTooltipHtml("reflex", 20, {
            value: 21,
            die: 14,
            success: "success",
            modifiers: [{ label: '<img src=x onerror="alert(1)">', modifier: 7 }],
            private: false,
            statistic: "reflex",
        }, true);

        expect(tooltip).not.toContain("<img");
        expect(tooltip).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    });
});

describe("onRenderTargetHelper", () => {
    it("reserves zero-target cards before adding controls so rerenders stay idempotent", async () => {
        const root = document.createElement("div");
        root.innerHTML = '<div class="message-content"><button data-action="spell-save">Native Save</button></div>';
        const message = {
            isAuthor: true,
            flags: { "sf2e-forge-custom": { targetHelper: { type: "spell", targets: [], revision: REVISION, save: { statistic: "reflex", dc: 20, basic: true } } } },
        } as unknown as ChatMessage.Implementation;

        await onRenderTargetHelper(message, root, {});
        await onRenderTargetHelper(message, root, {});

        expect(root.querySelectorAll(".th-target-rows")).toHaveLength(1);
        expect(root.querySelectorAll(".th-buttons")).toHaveLength(1);
    });

    it("removes a failed reservation so a later render can retry", async () => {
        const root = document.createElement("div");
        root.innerHTML = '<div class="message-content"><button data-action="spell-save">Native Save</button></div>';
        const token = { id: "token", name: "Target", actor: { hasPlayerOwner: false } };
        const message = {
            isAuthor: true,
            flags: { "sf2e-forge-custom": { targetHelper: { type: "spell", targets: ["Scene.scene.Token.token"], revision: REVISION, save: { statistic: "reflex", dc: 20, basic: true } } } },
        } as unknown as ChatMessage.Implementation;
        Object.assign(globalThis, {
            fromUuidSync: () => token,
            foundry: { applications: { handlebars: { renderTemplate: async () => { throw new Error("template failed"); } } } },
        });

        await onRenderTargetHelper(message, root, {});
        expect(root.querySelector(".th-target-rows")).toBeNull();

        Object.assign(globalThis, {
            foundry: { applications: { handlebars: { renderTemplate: async () => "<span></span>" } } },
        });
        await onRenderTargetHelper(message, root, {});

        expect(root.querySelectorAll(".th-target-rows")).toHaveLength(1);
        expect(root.querySelectorAll(".th-target-row")).toHaveLength(1);
    });

    it("keeps the native control when inline results cannot be persisted", async () => {
        const root = document.createElement("div");
        root.innerHTML = '<div class="message-content"><button data-action="spell-save">Native Save</button></div>';
        const message = {
            isAuthor: false,
            flags: { "sf2e-forge-custom": { targetHelper: { type: "spell", targets: [], revision: REVISION, save: { statistic: "reflex", dc: 20, basic: true } } } },
        } as unknown as ChatMessage.Implementation;
        Object.assign(globalThis, { game: { user: { isGM: false }, i18n: { localize: (key: string) => key } } });

        await onRenderTargetHelper(message, root, {});

        expect(root.querySelector('button[data-action="spell-save"]')?.classList.contains("hidden")).toBe(false);
        expect(root.querySelector(".th-buttons")).toBeNull();
    });

    it("shows overcome controls to an authored spell card without an explicit caster UUID", async () => {
        const root = document.createElement("div");
        root.innerHTML = '<div class="message-content"><button data-action="spell-save">Native Save</button></div>';
        const message = {
            actor: {},
            isAuthor: true,
            flags: { "sf2e-forge-custom": { targetHelper: {
                type: "spell",
                targets: [],
                revision: REVISION,
                save: { statistic: "reflex", dc: 20, basic: true },
                pradOvercome: true,
            } } },
        } as unknown as ChatMessage.Implementation;
        Object.assign(globalThis, { game: { user: { isGM: false }, i18n: { localize: (key: string) => key } } });

        await onRenderTargetHelper(message, root, {});

        expect(root.querySelector('button[data-action="spell-save"]')?.classList.contains("hidden")).toBe(true);
        expect(root.querySelector(".th-overcome-btn")).not.toBeNull();
    });

    it("renders localized check-button labels as text rather than HTML", async () => {
        const root = document.createElement("div");
        root.innerHTML = '<div class="message-content"><button data-action="spell-save">Native Save</button></div>';
        const malicious = '<img src=x onerror="alert(1)">';
        const message = {
            isAuthor: true,
            flags: { "sf2e-forge-custom": { targetHelper: { type: "check", targets: [], revision: REVISION, save: { statistic: "reflex", dc: 20, basic: true } } } },
        } as unknown as ChatMessage.Implementation;
        Object.assign(globalThis, { game: { user: { isGM: false }, i18n: { localize: () => malicious } } });

        await onRenderTargetHelper(message, root, {});

        const button = root.querySelector(".th-save-btn");
        expect(button?.querySelector("img")).toBeNull();
        expect(button?.textContent).toContain(malicious);
    });

    it("renders private completions as hidden and non-rerollable even for GM viewers", async () => {
        const root = document.createElement("div");
        root.innerHTML = '<div class="message-content"></div>';
        const token = { id: "token", name: "Target", isOwner: true, actor: { hasPlayerOwner: true } };
        let rendered: Record<string, unknown> | undefined;
        Object.assign(globalThis, {
            game: { user: { isGM: true }, i18n: { localize: (key: string) => key } },
            fromUuidSync: () => token,
            foundry: { applications: { handlebars: { renderTemplate: async (_path: string, viewModel: Record<string, unknown>) => {
                rendered = viewModel;
                return '<span data-tooltip-content="true"></span>';
            } } } },
        });
        const message = {
            isAuthor: false,
            flags: { "sf2e-forge-custom": { targetHelper: {
                type: "spell",
                targets: ["Scene.scene.Token.token"],
                revision: REVISION,
                save: { statistic: "reflex", dc: 20, basic: true },
                saves: { [encodeTargetUuidSaveKey("Scene.scene.Token.token", 0, REVISION)]: { value: 27, die: 20, success: "criticalSuccess", modifiers: [], private: true, statistic: "reflex", targetUuid: "Scene.scene.Token.token", generation: 0, revision: REVISION } },
            } } },
        } as unknown as ChatMessage.Implementation;

        await onRenderTargetHelper(message, root, {});

        expect(rendered?.save).toMatchObject({ hasResult: false, isHiddenResult: true, canRoll: false });
        expect(rendered?.save).not.toHaveProperty("value");
        expect(rendered?.save).not.toHaveProperty("die");
        expect(rendered?.save).not.toHaveProperty("success");
        expect(root.querySelector(".th-target-row span")?.getAttribute("data-tooltip")).toBeNull();
    });
});
