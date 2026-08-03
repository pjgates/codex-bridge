import { Plugin, TFile } from "obsidian";
import { DEFAULT_CARD_SETTINGS } from "./defaults.js";
import { EntityIndex } from "./entityIndex.js";
import { registerNoteCardPostProcessor } from "./noteCardPostProcessor.js";
import { SessionRevealState } from "./revealState.js";
import {
    activateCodexDashboard,
    CodexDashboardView,
    VIEW_TYPE_CODEX_DASHBOARD,
} from "./sidebarView.js";

export default class CodexDashboardPlugin extends Plugin {
    entityIndex!: EntityIndex;
    readonly revealState = new SessionRevealState();
    readonly cardSettings = { ...DEFAULT_CARD_SETTINGS };

    async onload(): Promise<void> {
        this.entityIndex = new EntityIndex(this.app);

        this.registerIndexMaintenanceEvents();
        registerNoteCardPostProcessor(this, {
            entityIndex: this.entityIndex,
            revealState: this.revealState,
            settings: this.cardSettings,
        });

        const rebuildIndex = (): void => {
            this.entityIndex.rebuild();
        };

        this.registerEvent(this.app.metadataCache.on("resolved", rebuildIndex));
        // onLayoutReady returns void (not EventRef), so it stays outside registerEvent.
        this.app.workspace.onLayoutReady(rebuildIndex);

        this.registerView(
            VIEW_TYPE_CODEX_DASHBOARD,
            (leaf) => new CodexDashboardView(leaf, this),
        );

        this.addRibbonIcon("users", "Open Codex Dashboard", () => {
            void activateCodexDashboard(this);
        });

        this.addCommand({
            id: "open-codex-dashboard",
            name: "Open Codex Dashboard",
            callback: () => {
                void activateCodexDashboard(this);
            },
        });

        console.info("codex-dashboard: loaded");
    }

    onunload(): void {
        this.entityIndex?.destroy();
    }

    private registerIndexMaintenanceEvents(): void {
        this.registerEvent(
            this.app.metadataCache.on("changed", (file, _data, cache) => {
                if (!(file instanceof TFile) || file.extension !== "md") {
                    return;
                }

                this.entityIndex.upsertFromCache(file.path, cache);
            }),
        );

        this.registerEvent(
            this.app.vault.on("rename", (file, oldPath) => {
                if (!(file instanceof TFile) || file.extension !== "md") {
                    return;
                }

                this.entityIndex.renamePath(oldPath, file);
            }),
        );

        this.registerEvent(
            this.app.vault.on("delete", (file) => {
                if (!(file instanceof TFile)) {
                    return;
                }

                this.entityIndex.removePath(file.path);
            }),
        );
    }
}
