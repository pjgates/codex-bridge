import { afterEach, describe, expect, it, vi } from "vitest";
import { mountSidebar } from "../../src/content/sidebar.js";
import { emptyNotebook } from "../../src/core/reducer.js";
import type { CreatureRecord, Evidence, NotebookState } from "../../src/core/types.js";

const HOST = "#pf2e-combat-notebook-host";

function shadow(): ShadowRoot {
    const host = document.querySelector(HOST) as HTMLElement;
    return host.shadowRoot!;
}

function creature(tokenUuid: string, name: string, overrides: Partial<CreatureRecord> = {}): CreatureRecord {
    return {
        tokenUuid,
        actorUuid: null,
        name,
        defenses: {},
        evidence: [],
        contradictions: [],
        ...overrides,
    };
}

function activeState(): NotebookState {
    const state = emptyNotebook();
    state.compatibility = "active";
    state.compatibilityReason = null;
    return state;
}

afterEach(() => {
    document.querySelector(HOST)?.remove();
});

describe("notebook sidebar", () => {
    it("mounts in Shadow DOM and renders facts with textContent", () => {
        const clear = vi.fn();
        const sidebar = mountSidebar(document, clear);
        const state = emptyNotebook();
        state.compatibility = "active";
        state.creatures["Scene.s.Token.t"] = {
            tokenUuid: "Scene.s.Token.t",
            actorUuid: null,
            name: "<img src=x onerror=alert(1)>",
            defenses: {
                ac: {
                    display: "27–28",
                    provenance: "inferred",
                    contextKey: "base",
                    evidenceIds: ["e1"],
                },
            },
            evidence: [{ id: "e1", timestamp: 1, summary: "Strike 27: success" }],
            contradictions: [],
        };
        sidebar.render(state);
        const host = document.querySelector(HOST) as HTMLElement;
        expect(host.shadowRoot).not.toBeNull();
        expect(host.shadowRoot!.textContent).toContain("<img src=x onerror=alert(1)>");
        expect(host.shadowRoot!.querySelector("img")).toBeNull();
        (host.shadowRoot!.querySelector("[data-action=request-clear]") as HTMLButtonElement).click();
        (host.shadowRoot!.querySelector("[data-action=clear]") as HTMLButtonElement).click();
        expect(clear).toHaveBeenCalledOnce();
    });

    it("tears down without leaving a host node", () => {
        const sidebar = mountSidebar(document, vi.fn());
        sidebar.destroy();
        expect(document.querySelector(HOST)).toBeNull();
    });

    it("reuses the existing host when mounted twice", () => {
        mountSidebar(document, vi.fn());
        const second = mountSidebar(document, vi.fn());
        expect(document.querySelectorAll(HOST)).toHaveLength(1);
        second.destroy();
        expect(document.querySelector(HOST)).toBeNull();
    });

    it("keeps styles inside the shadow root", () => {
        const before = document.head.querySelectorAll("style").length;
        mountSidebar(document, vi.fn());
        expect(document.head.querySelectorAll("style")).toHaveLength(before);
        expect(shadow().querySelector("style")?.textContent).toContain(".pcn-");
    });

    it("labels every provenance kind", () => {
        const sidebar = mountSidebar(document, vi.fn());
        const state = activeState();
        state.creatures.t = creature("t", "Goblin", {
            defenses: {
                ac: { display: "18", provenance: "exact-client", contextKey: "base", evidenceIds: [] },
                fortitude: { display: "20", provenance: "observed", contextKey: "base", evidenceIds: [] },
                reflex: { display: "19–21", provenance: "inferred", contextKey: "base", evidenceIds: [] },
                will: { display: "≥ 15", provenance: "possible", contextKey: "base", evidenceIds: [] },
            },
        });
        state.selectedTokenUuid = "t";
        sidebar.render(state);
        const labels = [...shadow().querySelectorAll(".pcn-provenance")].map((node) => node.textContent);
        expect(labels).toEqual(["exact client data", "observed", "inferred", "possible"]);
    });

    it("collapses and expands with aria-expanded, preserving state across renders", () => {
        const sidebar = mountSidebar(document, vi.fn());
        sidebar.render(activeState());
        const toggle = shadow().querySelector("[data-action=toggle]") as HTMLButtonElement;
        const panel = shadow().querySelector(".pcn-panel") as HTMLElement;
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
        toggle.click();
        expect(toggle.getAttribute("aria-expanded")).toBe("false");
        expect(panel.classList.contains("pcn-collapsed")).toBe(true);
        sidebar.render(activeState());
        expect(toggle.getAttribute("aria-expanded")).toBe("false");
        sidebar.toggle();
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
        expect(panel.classList.contains("pcn-collapsed")).toBe(false);
    });

    it("contains errors thrown by the clear callback", () => {
        const clear = vi.fn(() => {
            throw new Error("boom");
        });
        const sidebar = mountSidebar(document, clear);
        sidebar.render(activeState());
        (shadow().querySelector("[data-action=request-clear]") as HTMLButtonElement).click();
        const confirm = shadow().querySelector("[data-action=clear]") as HTMLButtonElement;
        expect(() => confirm.click()).not.toThrow();
        expect(clear).toHaveBeenCalledOnce();
    });

    it("requires a confirmation click before clearing", () => {
        const clear = vi.fn();
        const sidebar = mountSidebar(document, clear);
        sidebar.render(activeState());
        expect(shadow().querySelector("[data-action=clear]")).toBeNull();
        (shadow().querySelector("[data-action=request-clear]") as HTMLButtonElement).click();
        (shadow().querySelector("[data-action=cancel-clear]") as HTMLButtonElement).click();
        expect(shadow().querySelector("[data-action=clear]")).toBeNull();
        expect(clear).not.toHaveBeenCalled();
    });

    it("shows a Disputed section only when contradictions exist", () => {
        const sidebar = mountSidebar(document, vi.fn());
        const state = activeState();
        state.creatures.t = creature("t", "Ogre");
        state.selectedTokenUuid = "t";
        sidebar.render(state);
        expect(shadow().textContent).not.toContain("Disputed");
        state.creatures.t = creature("t", "Ogre", {
            contradictions: [{ id: "c1", timestamp: 2, summary: "AC 20 hit but exact AC is 22" }],
        });
        sidebar.render(state);
        expect(shadow().textContent).toContain("Disputed");
        expect(shadow().textContent).toContain("AC 20 hit but exact AC is 22");
    });

    it("lists evidence newest first and caps it at 20", () => {
        const sidebar = mountSidebar(document, vi.fn());
        const state = activeState();
        const evidence: Evidence[] = Array.from({ length: 25 }, (_, index) => ({
            id: `e${index}`,
            timestamp: index,
            summary: `entry ${index}`,
        }));
        state.creatures.t = creature("t", "Ogre", { evidence });
        state.selectedTokenUuid = "t";
        sidebar.render(state);
        const items = [...shadow().querySelectorAll(".pcn-evidence li")].map((node) => node.textContent);
        expect(items).toHaveLength(20);
        expect(items[0]).toBe("entry 24");
        expect(items[19]).toBe("entry 5");
    });

    it("shows empty-state guidance when there are no creatures", () => {
        const sidebar = mountSidebar(document, vi.fn());
        sidebar.render(activeState());
        expect(shadow().querySelector(".pcn-empty")?.textContent).toMatch(/target/i);
    });

    it("prefers the Foundry-targeted creature and allows a local view selection", () => {
        const sidebar = mountSidebar(document, vi.fn());
        const state = activeState();
        state.creatures.a = creature("a", "Alpha");
        state.creatures.b = creature("b", "Beta");
        state.selectedTokenUuid = "b";
        sidebar.render(state);
        expect(shadow().querySelector(".pcn-creature-name")?.textContent).toBe("Beta");
        const alphaButton = [...shadow().querySelectorAll<HTMLButtonElement>("[data-action=select]")]
            .find((button) => button.textContent === "Alpha")!;
        alphaButton.click();
        expect(shadow().querySelector(".pcn-creature-name")?.textContent).toBe("Alpha");
        const pressed = shadow().querySelector("[data-action=select][aria-pressed=true]");
        expect(pressed?.textContent).toBe("Alpha");
    });

    it("renders compatibility status, reason, and latest diagnostics", () => {
        const sidebar = mountSidebar(document, vi.fn());
        const state = emptyNotebook();
        state.compatibility = "fallback";
        state.compatibilityReason = "PF2e 8.6 is untested";
        state.diagnostics = ["d1", "d2", "d3", "d4", "d5", "d6"];
        sidebar.render(state);
        const status = shadow().querySelector(".pcn-status") as HTMLElement;
        expect(status.classList.contains("pcn-status-fallback")).toBe(true);
        expect(shadow().textContent).toContain("PF2e 8.6 is untested");
        const diagnostics = [...shadow().querySelectorAll(".pcn-diagnostics li")].map((node) => node.textContent);
        expect(diagnostics).toEqual(["d6", "d5", "d4", "d3", "d2"]);
    });
});
