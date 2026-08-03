import { type MarkdownPostProcessorContext, Component, Plugin, TFile } from "obsidian";
import { renderCard, type CardRenderContext } from "./card.js";
import type { CardSettings } from "./defaults.js";
import { buildEntityRecord, type EntityIndex } from "./entityIndex.js";
import type { RevealState } from "./revealState.js";

const CARD_HOST_CLASS = "codex-dashboard-card-host";
const DOC_MARKER_ATTR = "data-codex-dashboard-card-injected";

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

        if (preview.hasAttribute(DOC_MARKER_ATTR) || preview.querySelector(`.${CARD_HOST_CLASS}`)) {
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

        preview.setAttribute(DOC_MARKER_ATTR, "true");

        const host = preview.createDiv({ cls: CARD_HOST_CLASS });
        targetSection.insertAdjacentElement("beforebegin", host);

        const record = lookupRecord(options.entityIndex, plugin, ctx.sourcePath);
        if (!record) {
            host.remove();
            preview.removeAttribute(DOC_MARKER_ATTR);
            return;
        }

        const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
        if (!(file instanceof TFile)) {
            host.remove();
            preview.removeAttribute(DOC_MARKER_ATTR);
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
