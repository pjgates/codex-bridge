import {
    App,
    ItemView,
    TFile,
    WorkspaceLeaf,
    type MarkdownRenderChild,
} from "obsidian";
import { renderCard, type CardRenderContext } from "./card.js";
import { parseCampaigns, slugToLabel, type CampaignRef } from "./core/campaign.js";
import {
    filterRoster,
    sortRoster,
    type EntityRecord,
} from "./core/roster.js";
import type CodexDashboardPlugin from "./main.js";

export const VIEW_TYPE_CODEX_DASHBOARD = "codex-dashboard";

const PANEL_CLASS = "codex-dashboard-panel";
const PORTRAIT_WIKILINK_RE = /^\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]$/;

interface ViewUi {
    root: HTMLElement;
    listView: HTMLElement;
    detailView: HTMLElement;
    campaignSelect: HTMLSelectElement;
    searchInput: HTMLInputElement;
    onstageButton: HTMLButtonElement;
    depthButtons: Map<number, HTMLButtonElement>;
    listEl: HTMLElement;
    footerCountEl: HTMLElement;
    backButton: HTMLButtonElement;
    detailPortraitEl: HTMLElement;
    detailNameEl: HTMLElement;
    cardHostEl: HTMLElement;
}

export class CodexDashboardView extends ItemView {
    private ui: ViewUi | null = null;
    private unsubscribeIndex: (() => void) | null = null;
    private cardChildren: MarkdownRenderChild[] = [];

    private searchQuery = "";
    private campaignKey: string | null = null;
    private campaignInitialized = false;
    private onstageFilter = false;
    private readonly depthFilters = new Set<number>();
    private selectedPath: string | null = null;
    private listScrollTop = 0;

    constructor(
        leaf: WorkspaceLeaf,
        private readonly plugin: CodexDashboardPlugin,
    ) {
        super(leaf);
    }

    getViewType(): string {
        return VIEW_TYPE_CODEX_DASHBOARD;
    }

    getDisplayText(): string {
        return "Codex Dashboard";
    }

    getIcon(): string {
        return "users";
    }

    async onOpen(): Promise<void> {
        this.unsubscribeIndex = this.plugin.entityIndex.onChanged(() => {
            this.refresh();
        });

        this.ui = this.buildUi(this.contentEl);
        this.initializeCampaignDefault();
        this.syncControlsFromState();
        this.refresh();
    }

    async onClose(): Promise<void> {
        this.unsubscribeIndex?.();
        this.unsubscribeIndex = null;
        this.clearCardChildren();
        this.ui = null;
    }

    private buildUi(container: HTMLElement): ViewUi {
        container.empty();
        const root = container.createDiv({ cls: PANEL_CLASS });

        const listView = root.createDiv({ cls: `${PANEL_CLASS}__list-view` });
        const header = listView.createDiv({ cls: `${PANEL_CLASS}__header` });
        header.createDiv({
            cls: `${PANEL_CLASS}__eyebrow`,
            text: "CODEX DASHBOARD",
        });
        header.createDiv({ cls: `${PANEL_CLASS}__title`, text: "Roster" });

        const campaignSelect = header.createEl("select", {
            cls: `${PANEL_CLASS}__campaign-select`,
        });
        campaignSelect.addEventListener("change", () => {
            this.campaignKey = campaignSelect.value || null;
            this.refresh();
        });

        const searchInput = header.createEl("input", {
            cls: `${PANEL_CLASS}__search`,
            type: "search",
            placeholder: "Search roster…",
        });
        searchInput.addEventListener("input", () => {
            this.searchQuery = searchInput.value;
            this.refresh();
        });

        const filtersEl = header.createDiv({ cls: `${PANEL_CLASS}__filters` });
        const onstageButton = filtersEl.createEl("button", {
            cls: `${PANEL_CLASS}__filter-onstage`,
            type: "button",
            text: "Onstage",
        });
        onstageButton.addEventListener("click", () => {
            this.onstageFilter = !this.onstageFilter;
            this.syncControlsFromState();
            this.refresh();
        });

        const depthGroup = filtersEl.createDiv({ cls: `${PANEL_CLASS}__filter-depths` });
        const depthButtons = new Map<number, HTMLButtonElement>();
        for (const depth of [1, 2, 3] as const) {
            const button = depthGroup.createEl("button", {
                cls: `${PANEL_CLASS}__filter-depth`,
                type: "button",
                text: String(depth),
                attr: { "data-depth": String(depth) },
            });
            button.addEventListener("click", () => {
                if (this.depthFilters.has(depth)) {
                    this.depthFilters.delete(depth);
                } else {
                    this.depthFilters.add(depth);
                }
                this.syncControlsFromState();
                this.refresh();
            });
            depthButtons.set(depth, button);
        }

        header.createDiv({ cls: `${PANEL_CLASS}__divider` });

        const listEl = listView.createDiv({ cls: `${PANEL_CLASS}__list` });
        listEl.addEventListener("scroll", () => {
            this.listScrollTop = listEl.scrollTop;
        });

        const footer = listView.createDiv({ cls: `${PANEL_CLASS}__footer` });
        const footerCountEl = footer.createSpan({ cls: `${PANEL_CLASS}__footer-count` });

        const detailView = root.createDiv({ cls: `${PANEL_CLASS}__detail` });
        detailView.hide();

        const backButton = detailView.createEl("button", {
            cls: `${PANEL_CLASS}__back`,
            type: "button",
        });
        backButton.addEventListener("click", () => {
            this.selectedPath = null;
            this.showListView();
        });

        const detailHero = detailView.createDiv({ cls: `${PANEL_CLASS}__detail-hero` });
        const detailPortraitEl = detailHero.createDiv({ cls: `${PANEL_CLASS}__detail-portrait` });
        const detailNameEl = detailHero.createDiv({ cls: `${PANEL_CLASS}__detail-name` });
        const cardHostEl = detailView.createDiv({ cls: `${PANEL_CLASS}__card-host` });

        return {
            root,
            listView,
            detailView,
            campaignSelect,
            searchInput,
            onstageButton,
            depthButtons,
            listEl,
            footerCountEl,
            backButton,
            detailPortraitEl,
            detailNameEl,
            cardHostEl,
        };
    }

    private initializeCampaignDefault(): void {
        if (this.campaignInitialized) {
            return;
        }

        this.campaignKey = resolveDefaultCampaignKey(this.app);
        this.campaignInitialized = true;
    }

    private syncControlsFromState(): void {
        const ui = this.ui;
        if (!ui) {
            return;
        }

        ui.searchInput.value = this.searchQuery;
        ui.onstageButton.toggleClass(`${PANEL_CLASS}__filter-onstage--active`, this.onstageFilter);

        for (const [depth, button] of ui.depthButtons) {
            button.toggleClass(`${PANEL_CLASS}__filter-depth--active`, this.depthFilters.has(depth));
        }
    }

    private refresh(): void {
        const ui = this.ui;
        if (!ui) {
            return;
        }

        this.renderCampaignOptions(ui.campaignSelect);

        if (this.selectedPath) {
            const record = this.findRecord(this.selectedPath);
            if (!record) {
                this.selectedPath = null;
                this.showListView();
                return;
            }

            void this.renderDetail(record);
            return;
        }

        this.renderList();
    }

    private renderCampaignOptions(select: HTMLSelectElement): void {
        const campaigns = this.plugin.entityIndex.campaigns();
        const previous = select.value;

        select.empty();
        select.createEl("option", { text: "All campaigns", value: "" });

        for (const campaign of campaigns) {
            select.createEl("option", {
                text: campaign.label,
                value: campaign.key,
            });
        }

        const nextValue = this.campaignKey ?? "";
        if (nextValue && campaigns.some((campaign) => campaign.key === nextValue)) {
            select.value = nextValue;
        } else if (previous && campaigns.some((campaign) => campaign.key === previous)) {
            select.value = previous;
            this.campaignKey = previous;
        } else {
            select.value = "";
            this.campaignKey = null;
        }
    }

    private renderList(): void {
        const ui = this.ui;
        if (!ui) {
            return;
        }

        ui.listView.show();
        ui.detailView.hide();

        const allRecords = this.plugin.entityIndex.records();
        const campaignRecords = filterRoster(allRecords, { campaignKey: this.campaignKey });
        const filtered = sortRoster(
            filterRoster(allRecords, {
                campaignKey: this.campaignKey,
                onstage: this.onstageFilter || undefined,
                depths: this.depthFilters.size > 0 ? Array.from(this.depthFilters) : undefined,
                query: this.searchQuery,
            }),
        );

        const campaignLabel = campaignFooterLabel(this.campaignKey, this.plugin.entityIndex.campaigns());
        ui.footerCountEl.setText(`${filtered.length} of ${campaignRecords.length} · ${campaignLabel}`);

        ui.listEl.empty();
        for (const record of filtered) {
            this.appendRow(ui.listEl, record);
        }

        ui.listEl.scrollTop = this.listScrollTop;
    }

    private appendRow(listEl: HTMLElement, record: EntityRecord): void {
        const row = listEl.createDiv({ cls: `${PANEL_CLASS}__row` });
        if (record.path === this.selectedPath) {
            row.addClass(`${PANEL_CLASS}__row--active`);
        }

        const thumb = row.createDiv({ cls: `${PANEL_CLASS}__thumb` });
        this.renderThumb(thumb, record);

        row.createDiv({ cls: `${PANEL_CLASS}__row-name`, text: record.name });

        if (record.depth !== null) {
            const badge = row.createDiv({
                cls: `${PANEL_CLASS}__depth-badge`,
                text: `D${record.depth}`,
            });
            if (record.depth === 3) {
                badge.addClass(`${PANEL_CLASS}__depth-badge--depth-3`);
            }
        }

        row.addEventListener("click", (event) => {
            const mouseEvent = event as MouseEvent;
            if (mouseEvent.metaKey || mouseEvent.ctrlKey) {
                void this.app.workspace.openLinkText(record.path, "");
                return;
            }

            this.listScrollTop = this.ui?.listEl.scrollTop ?? 0;
            this.selectedPath = record.path;
            void this.renderDetail(record);
        });
    }

    private async renderDetail(record: EntityRecord): Promise<void> {
        const ui = this.ui;
        if (!ui) {
            return;
        }

        ui.listView.hide();
        ui.detailView.show();

        const campaignLabel = detailCampaignLabel(record, this.campaignKey);
        ui.backButton.setText(`« ${campaignLabel.toUpperCase()} ROSTER`);

        ui.detailPortraitEl.empty();
        this.renderDetailPortrait(ui.detailPortraitEl, record);
        ui.detailNameEl.setText(record.name);

        this.clearCardChildren();
        ui.cardHostEl.empty();

        const file = this.app.vault.getAbstractFileByPath(record.path);
        if (!(file instanceof TFile)) {
            return;
        }

        const cardCtx: CardRenderContext = {
            app: this.app,
            file,
            sourcePath: record.path,
            revealState: this.plugin.revealState,
            settings: {
                excludeTags: this.plugin.cardSettings.excludeTags,
                descriptionLines: this.plugin.cardSettings.descriptionLines,
            },
            addChild: (child) => {
                this.cardChildren.push(child);
                this.addChild(child);
            },
            removeChild: (child) => {
                this.cardChildren = this.cardChildren.filter((entry) => entry !== child);
                this.removeChild(child);
            },
            onRevealChange: () => {
                void this.renderDetail(record);
            },
        };

        await renderCard(ui.cardHostEl, record, cardCtx);
    }

    private showListView(): void {
        this.syncControlsFromState();
        this.renderList();
    }

    private findRecord(path: string): EntityRecord | undefined {
        return this.plugin.entityIndex.records().find((record) => record.path === path);
    }

    private renderThumb(thumbEl: HTMLElement, record: EntityRecord): void {
        const portraitTarget = resolvePortraitTarget(record.portrait);
        if (portraitTarget) {
            const dest = this.app.metadataCache.getFirstLinkpathDest(portraitTarget, record.path);
            if (dest) {
                thumbEl.createEl("img", {
                    attr: {
                        src: this.app.vault.getResourcePath(dest),
                        alt: record.name,
                        loading: "lazy",
                    },
                });
                return;
            }
        }

        const initial = record.name.trim().charAt(0).toUpperCase() || "?";
        thumbEl.createDiv({
            cls: `${PANEL_CLASS}__thumb-fallback`,
            text: initial,
        });
    }

    private renderDetailPortrait(portraitEl: HTMLElement, record: EntityRecord): void {
        const portraitTarget = resolvePortraitTarget(record.portrait);
        if (portraitTarget) {
            const dest = this.app.metadataCache.getFirstLinkpathDest(portraitTarget, record.path);
            if (dest) {
                portraitEl.createEl("img", {
                    attr: {
                        src: this.app.vault.getResourcePath(dest),
                        alt: record.name,
                        loading: "lazy",
                    },
                });
                return;
            }
        }

        const fallback = portraitEl.createDiv({ cls: `${PANEL_CLASS}__detail-portrait-fallback` });
        fallback.setText("⚔");
    }

    private clearCardChildren(): void {
        for (const child of this.cardChildren) {
            child.unload();
            this.removeChild(child);
        }
        this.cardChildren = [];
    }
}

export async function activateCodexDashboard(plugin: CodexDashboardPlugin): Promise<void> {
    const { workspace } = plugin.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_CODEX_DASHBOARD)[0];
    if (existing) {
        workspace.revealLeaf(existing);
        return;
    }

    const leaf = workspace.getRightLeaf(false);
    if (!leaf) {
        return;
    }

    await leaf.setViewState({ type: VIEW_TYPE_CODEX_DASHBOARD, active: true });
}

export function resolveDefaultCampaignKey(app: App): string | null {
    const file = app.workspace.getActiveFile();
    if (!file) {
        return null;
    }

    const cache = app.metadataCache.getFileCache(file);
    const campaigns = parseCampaigns(cache?.frontmatter?.campaign);
    if (campaigns.length > 0) {
        return campaigns[0].key;
    }

    return campaignKeyFromPath(file.path);
}

export function campaignKeyFromPath(path: string): string | null {
    const match = /^codex\/([^/]+)\//.exec(path);
    return match?.[1] ?? null;
}

function campaignFooterLabel(campaignKey: string | null, campaigns: CampaignRef[]): string {
    if (!campaignKey) {
        return "All campaigns";
    }

    const match = campaigns.find((campaign) => campaign.key === campaignKey);
    return match?.label ?? slugToLabel(campaignKey);
}

function detailCampaignLabel(record: EntityRecord, campaignKey: string | null): string {
    if (campaignKey) {
        const match = record.campaigns.find((campaign) => campaign.key === campaignKey);
        if (match) {
            return match.label;
        }
        return slugToLabel(campaignKey);
    }

    return record.campaigns[0]?.label ?? "All campaigns";
}

function resolvePortraitTarget(portrait: string | undefined): string | undefined {
    if (!portrait) {
        return undefined;
    }

    const trimmed = portrait.trim();
    const match = PORTRAIT_WIKILINK_RE.exec(trimmed);
    const target = (match?.[1] ?? trimmed).trim();
    return target.length > 0 ? target : undefined;
}

