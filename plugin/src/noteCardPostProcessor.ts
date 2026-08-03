import {
    type App,
    type MarkdownPostProcessorContext,
    Component,
    MarkdownView,
    Plugin,
    TFile,
} from "obsidian";
import { renderCard, type CardRenderContext } from "./card.js";
import type { CardSettings } from "./defaults.js";
import { buildEntityRecord, type EntityIndex } from "./entityIndex.js";
import type { RevealState } from "./revealState.js";

export const CARD_HOST_CLASS = "codex-dashboard-card-host";

export interface NoteCardPostProcessorOptions {
    entityIndex: EntityIndex;
    revealState: RevealState;
    settings: CardSettings;
}

export function registerNoteCardPostProcessor(
    plugin: Plugin,
    options: NoteCardPostProcessorOptions,
): void {
    plugin.registerMarkdownPostProcessor(async (element, ctx) => {
        if (!options.settings.showNoteCards) {
            return;
        }

        if (!isCharacterNote(plugin, ctx)) {
            return;
        }

        const preview = element.closest(".markdown-preview-view") as HTMLElement | null;
        if (!preview) {
            return;
        }

        if (preview.querySelector(`.${CARD_HOST_CLASS}`)) {
            return;
        }

        const firstH1 = preview.querySelector("h1");
        const targetSection =
            firstH1?.closest(".markdown-preview-section") ??
            preview.querySelector(".markdown-preview-section");
        if (!targetSection || element !== targetSection) {
            return;
        }

        const sectionInfo = ctx.getSectionInfo(element);
        if (sectionInfo && firstH1 === null && sectionInfo.lineStart > 0) {
            return;
        }

        const host = preview.createDiv({ cls: CARD_HOST_CLASS });
        targetSection.insertAdjacentElement("beforebegin", host);

        const record = lookupRecord(options.entityIndex, plugin, ctx.sourcePath);
        if (!record) {
            host.remove();
            return;
        }

        const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
        if (!(file instanceof TFile)) {
            host.remove();
            return;
        }

        const cardCtx: CardRenderContext = {
            app: plugin.app,
            file,
            sourcePath: ctx.sourcePath,
            revealState: options.revealState,
            settings: {
                excludeTags: options.settings.excludeTags,
                descriptionLines: options.settings.descriptionLines,
            },
            addChild: (child) => ctx.addChild(child),
            removeChild: (child) => (ctx as unknown as Component).removeChild(child),
        };

        await renderCard(host, record, cardCtx);
    });
}

export function refreshNoteCardPreviews(
    app: App,
    settings: Pick<CardSettings, "showNoteCards">,
): void {
    app.workspace.iterateAllLeaves((leaf) => {
        const view = leaf.view;
        if (!(view instanceof MarkdownView)) {
            return;
        }

        const previewEl = view.containerEl.querySelector(
            ".markdown-preview-view",
        ) as HTMLElement | null;
        if (!previewEl) {
            return;
        }

        previewEl.querySelectorAll(`.${CARD_HOST_CLASS}`).forEach((host) => {
            host.remove();
        });

        if (settings.showNoteCards) {
            view.previewMode.rerender(true);
        }
    });
}

function isCharacterNote(plugin: Plugin, ctx: MarkdownPostProcessorContext): boolean {
    const type =
        ctx.frontmatter?.type ??
        plugin.app.metadataCache.getCache(ctx.sourcePath)?.frontmatter?.type;
    return type === "Character";
}

function lookupRecord(
    entityIndex: EntityIndex,
    plugin: Plugin,
    path: string,
) {
    const indexed = entityIndex.records().find((record) => record.path === path);
    if (indexed) {
        return indexed;
    }

    return buildEntityRecord(path, plugin.app.metadataCache.getCache(path));
}
