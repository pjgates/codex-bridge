import { Plugin, TFile } from "obsidian";
import { EntityIndex } from "./entityIndex.js";

export default class CodexDashboardPlugin extends Plugin {
    entityIndex!: EntityIndex;

    async onload(): Promise<void> {
        this.entityIndex = new EntityIndex(this.app);

        this.registerIndexMaintenanceEvents();

        const runInitialBuild = (): void => {
            if (this.entityIndex.hasInitialBuild()) {
                return;
            }

            this.entityIndex.markInitialBuildDone();
            this.entityIndex.rebuild();
        };

        this.registerEvent(this.app.metadataCache.on("resolved", runInitialBuild));
        this.app.workspace.onLayoutReady(runInitialBuild);

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
