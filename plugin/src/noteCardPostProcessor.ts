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

        // Post-processors receive .el-* render chunks that are NOT yet attached
        // to the preview tree — ancestor traversal is useless here. Inject into
        // the first chunk (source line 0: the frontmatter chunk when frontmatter
        // exists, else the first content chunk); afterbegin lands the card at
        // the top of the note content, below Obsidian's title/properties chrome
        // and above the H1. Exactly one chunk has lineStart 0, so this is also
        // the per-render dedupe.
        const info = ctx.getSectionInfo(element);
        if (!info || info.lineStart !== 0) {
            return;
        }

        const record = lookupRecord(options.entityIndex, plugin, ctx.sourcePath);
        if (!record) {
            return;
        }

        const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
        if (!(file instanceof TFile)) {
            return;
        }

        const host = element.createDiv({ cls: CARD_HOST_CLASS });
        element.insertAdjacentElement("afterbegin", host);

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

        // renderCard treats a disconnected host as stale — defer until Obsidian
        // has attached the chunk; the isConnected check also covers host
        // removal (settings refresh) racing the deferred render.
        setTimeout(() => {
            if (!host.isConnected) {
                console.error("codex-dashboard: card host never attached", ctx.sourcePath);
                return;
            }
            renderCard(host, record, cardCtx).catch((error: unknown) => {
                console.error("codex-dashboard: renderCard threw", ctx.sourcePath, error);
            });
        }, 0);
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
