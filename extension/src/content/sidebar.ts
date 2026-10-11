import type { CompatibilityStatus, DefenseKind } from "../shared/protocol.js";
import type { CreatureRecord, DefenseFact, Evidence, NotebookState } from "../core/types.js";
import { provenanceLabel } from "../shared/provenance.js";
import { SIDEBAR_CSS } from "./styles.js";

export interface Sidebar {
    render(state: NotebookState): void;
    toggle(): void;
    destroy(): void;
}

export const HOST_ID = "pf2e-combat-notebook-host";
const MAX_VISIBLE_EVIDENCE = 20;
const MAX_VISIBLE_DIAGNOSTICS = 5;
type ListKey = "evidence" | "disputed" | "diagnostics";

const DEFENSE_ORDER: DefenseKind[] = ["ac", "fortitude", "reflex", "will", "perception"];

const SHELL_HTML = `
<section class="pcn-panel" aria-label="PF2e Combat Notebook">
    <header class="pcn-header">
        <button type="button" data-action="toggle" aria-expanded="false" aria-controls="pcn-body" aria-label="Toggle notebook" title="Toggle notebook">☰</button>
        <h2 class="pcn-title">Combat Notebook</h2>
    </header>
    <div class="pcn-body" id="pcn-body"></div>
</section>
`;

function statusLabel(status: CompatibilityStatus): string {
    switch (status) {
        case "active":
            return "Active";
        case "fallback":
            return "Fallback mode";
        case "unsupported":
            return "Unsupported";
        default: {
            const unreachable: never = status;
            return unreachable;
        }
    }
}

function defenseLabel(kind: DefenseKind): string {
    switch (kind) {
        case "ac":
            return "AC";
        case "fortitude":
            return "Fortitude modifier";
        case "reflex":
            return "Reflex modifier";
        case "will":
            return "Will modifier";
        case "perception":
            return "Perception modifier";
        default: {
            const unreachable: never = kind;
            return unreachable;
        }
    }
}

function createHost(document: Document): HTMLElement {
    const host = document.createElement("div");
    host.id = HOST_ID;
    (document.body ?? document.documentElement).append(host);
    return host;
}

export function mountSidebar(document: Document, onClear: () => void): Sidebar {
    const host = document.getElementById(HOST_ID) ?? createHost(document);
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = SIDEBAR_CSS;
    const template = document.createElement("template");
    template.innerHTML = SHELL_HTML;
    root.replaceChildren(style, template.content.cloneNode(true));

    const panel = root.querySelector(".pcn-panel") as HTMLElement;
    const toggleButton = root.querySelector("[data-action=toggle]") as HTMLButtonElement;
    const body = root.querySelector(".pcn-body") as HTMLElement;

    let collapsed = true;
    let confirmingClear = false;
    let localSelection: string | null = null;
    let lastSelectedTokenUuid: string | null = null;
    let lastState: NotebookState | null = null;
    const listOpen: Record<ListKey, boolean> = { evidence: false, disputed: true, diagnostics: false };

    function isStale(): boolean {
        return !panel.isConnected;
    }

    function element<K extends keyof HTMLElementTagNameMap>(
        tag: K,
        className?: string,
        text?: string,
    ): HTMLElementTagNameMap[K] {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function button(action: string, text: string): HTMLButtonElement {
        const node = element("button", undefined, text);
        node.type = "button";
        node.dataset.action = action;
        return node;
    }

    function applyCollapsed(): void {
        panel.classList.toggle("pcn-collapsed", collapsed);
        toggleButton.setAttribute("aria-expanded", String(!collapsed));
    }

    function toggle(): void {
        if (isStale()) return;
        collapsed = !collapsed;
        applyCollapsed();
    }

    function rerender(): void {
        if (lastState) render(lastState);
    }

    function collapsibleList(key: ListKey, className: string, title: string): HTMLDetailsElement {
        const details = element("details", className);
        details.open = listOpen[key];
        details.addEventListener("toggle", () => {
            listOpen[key] = details.open;
        });
        details.append(element("summary", undefined, title));
        return details;
    }

    function focusClearRequest(): void {
        (root.querySelector("[data-action=request-clear]") as HTMLButtonElement | null)?.focus();
    }

    function evidenceList(key: ListKey, title: string, className: string, entries: Evidence[]): HTMLElement {
        const details = collapsibleList(key, className, title);
        const list = element("ul");
        const newestFirst = [...entries].sort((left, right) => right.timestamp - left.timestamp);
        for (const entry of newestFirst.slice(0, MAX_VISIBLE_EVIDENCE)) {
            list.append(element("li", undefined, entry.summary));
        }
        details.append(list);
        return details;
    }

    function defenseRow(kind: DefenseKind, fact: DefenseFact): HTMLTableRowElement {
        const row = element("tr");
        row.append(element("th", undefined, defenseLabel(kind)));
        row.append(element("td", undefined, fact.display));
        const provenanceCell = element("td");
        provenanceCell.append(element(
            "span",
            `pcn-provenance pcn-prov-${fact.provenance}`,
            provenanceLabel(fact.provenance),
        ));
        row.append(provenanceCell);
        return row;
    }

    function creatureDetails(record: CreatureRecord): HTMLElement {
        const section = element("section", "pcn-creature");
        section.append(element("h3", "pcn-creature-name", record.name));
        const rows = DEFENSE_ORDER.flatMap((kind) => {
            const fact = record.defenses[kind];
            return fact ? [defenseRow(kind, fact)] : [];
        });
        if (rows.length > 0) {
            const table = element("table", "pcn-defenses");
            const tbody = element("tbody");
            tbody.append(...rows);
            table.append(tbody);
            section.append(table);
        } else {
            section.append(element("p", "pcn-empty", "No defenses observed yet."));
        }
        if (record.contradictions.length > 0) {
            section.append(evidenceList("disputed", "Disputed", "pcn-disputed", record.contradictions));
        }
        if (record.evidence.length > 0) {
            section.append(evidenceList(
                "evidence",
                `Evidence (${record.evidence.length})`,
                "pcn-evidence",
                record.evidence,
            ));
        }
        return section;
    }

    function statusSection(state: NotebookState): HTMLElement {
        const status = element("p", `pcn-status pcn-status-${state.compatibility}`, statusLabel(state.compatibility));
        if (state.compatibilityReason) {
            status.append(element("span", "pcn-reason", state.compatibilityReason));
        }
        return status;
    }

    function creaturesSection(state: NotebookState): HTMLElement[] {
        const records = Object.values(state.creatures);
        if (records.length === 0) {
            return [element("p", "pcn-empty", "Target a creature in Foundry and make a check to start taking notes.")];
        }
        const fallbackUuid = state.selectedTokenUuid && state.creatures[state.selectedTokenUuid]
            ? state.selectedTokenUuid
            : records[0]!.tokenUuid;
        const shownUuid = localSelection && state.creatures[localSelection] ? localSelection : fallbackUuid;

        const picker = element("div", "pcn-creatures");
        picker.setAttribute("role", "group");
        picker.setAttribute("aria-label", "Creatures in this scene");
        for (const record of records) {
            const choice = button("select", record.name);
            choice.setAttribute("aria-pressed", String(record.tokenUuid === shownUuid));
            choice.addEventListener("click", () => {
                localSelection = record.tokenUuid;
                rerender();
            });
            picker.append(choice);
        }
        return [picker, creatureDetails(state.creatures[shownUuid]!)];
    }

    function diagnosticsSection(diagnostics: string[]): HTMLElement {
        const details = collapsibleList("diagnostics", "pcn-diagnostics", "Diagnostics");
        const list = element("ul");
        for (const entry of diagnostics.slice(-MAX_VISIBLE_DIAGNOSTICS).reverse()) {
            list.append(element("li", undefined, entry));
        }
        details.append(list);
        return details;
    }

    function actionsSection(): HTMLElement {
        const actions = element("div", "pcn-actions");
        if (!confirmingClear) {
            const request = button("request-clear", "Clear encounter");
            request.addEventListener("click", () => {
                confirmingClear = true;
                rerender();
                (root.querySelector("[data-action=clear]") as HTMLButtonElement | null)?.focus();
            });
            actions.append(request);
            return actions;
        }
        const confirm = button("clear", "Confirm clear");
        confirm.addEventListener("click", () => {
            confirmingClear = false;
            try {
                onClear();
            } catch {
                // The controller records clear failures; the drawer must stay usable.
            }
            rerender();
            focusClearRequest();
        });
        const cancel = button("cancel-clear", "Cancel");
        cancel.addEventListener("click", () => {
            confirmingClear = false;
            rerender();
            focusClearRequest();
        });
        actions.append(element("span", undefined, "Clear all notes?"), confirm, cancel);
        return actions;
    }

    function render(state: NotebookState): void {
        if (isStale()) return;
        if (state.selectedTokenUuid !== lastSelectedTokenUuid) {
            localSelection = null;
            lastSelectedTokenUuid = state.selectedTokenUuid;
        }
        lastState = state;
        const children: HTMLElement[] = [statusSection(state), ...creaturesSection(state)];
        if (state.diagnostics.length > 0) children.push(diagnosticsSection(state.diagnostics));
        children.push(actionsSection());
        body.replaceChildren(...children);
    }

    toggleButton.addEventListener("click", toggle);
    applyCollapsed();

    return {
        render,
        toggle,
        destroy(): void {
            if (isStale()) return;
            host.remove();
        },
    };
}
