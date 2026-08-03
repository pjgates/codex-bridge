import {
    App,
    MarkdownRenderChild,
    MarkdownRenderer,
    TFile,
    setIcon,
} from "obsidian";
import type { CardSettings } from "./defaults.js";
import { splitSecret } from "./core/secretSplit.js";
import type { EntityRecord } from "./core/roster.js";
import type { RevealState } from "./revealState.js";

export interface CardRenderContext {
    app: App;
    file: TFile;
    sourcePath: string;
    revealState: RevealState;
    settings: Pick<CardSettings, "excludeTags" | "descriptionLines">;
    addChild: (child: MarkdownRenderChild) => void;
    onRevealChange?: () => void;
}

const CARD_CLASS = "codex-dashboard-card";
const PORTRAIT_WIKILINK_RE = /^\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]$/;

export async function renderCard(
    el: HTMLElement,
    record: EntityRecord,
    ctx: CardRenderContext,
): Promise<void> {
    el.empty();
    el.addClass(CARD_CLASS);

    const fileText = await ctx.app.vault.cachedRead(ctx.file);
    const split = splitSecret(fileText);
    const revealed = ctx.revealState.isRevealed(ctx.sourcePath);
    const hasSecret = split.secret !== null;

    const portraitEl = el.createDiv({ cls: `${CARD_CLASS}__portrait` });
    renderPortrait(portraitEl, record, ctx);

    const bodyEl = el.createDiv({ cls: `${CARD_CLASS}__body` });

    const campaignLabel = record.campaigns[0]?.label ?? "Unknown campaign";
    bodyEl.createDiv({
        cls: `${CARD_CLASS}__eyebrow`,
        text: `CHARACTER · ${campaignLabel}`,
    });

    const nameEl = bodyEl.createDiv({ cls: `${CARD_CLASS}__name` });
    nameEl.createSpan({ cls: `${CARD_CLASS}__name-primary`, text: record.name });
    const alias = record.aliases[0];
    if (alias) {
        nameEl.createSpan({ cls: `${CARD_CLASS}__alias`, text: `"${alias}"` });
    }

    renderChips(bodyEl, record, ctx.settings.excludeTags);

    const descEl = bodyEl.createDiv({ cls: `${CARD_CLASS}__desc`, text: split.description });
    descEl.style.setProperty("-webkit-line-clamp", String(ctx.settings.descriptionLines));
    descEl.style.setProperty("display", "-webkit-box");
    descEl.style.setProperty("-webkit-box-orient", "vertical");
    descEl.style.setProperty("overflow", "hidden");

    if (hasSecret) {
        const footerEl = bodyEl.createDiv({ cls: `${CARD_CLASS}__footer` });
        const revealBtn = footerEl.createEl("button", {
            cls: `${CARD_CLASS}__reveal-btn mod-secondary`,
            type: "button",
        });
        const countEl = footerEl.createDiv({ cls: `${CARD_CLASS}__footer-count` });

        const secretEl = bodyEl.createDiv({
            cls: `${CARD_CLASS}__secret`,
        });
        secretEl.toggle(revealed);

        const syncRevealUi = (): void => {
            const isRevealed = ctx.revealState.isRevealed(ctx.sourcePath);
            revealBtn.empty();
            setIcon(revealBtn.createSpan(), isRevealed ? "eye-off" : "eye");
            revealBtn.createSpan({
                text: isRevealed ? "Hide" : "Reveal",
            });
            countEl.setText(
                isRevealed
                    ? `${split.gmSectionCount} GM sections revealed`
                    : `${split.gmSectionCount} GM sections hidden`,
            );
            secretEl.toggle(isRevealed);
        };

                const setRevealed = async (next: boolean): Promise<void> => {
                    ctx.revealState.setRevealed(ctx.sourcePath, next);
                    syncRevealUi();
                    if (next && split.secret) {
                        await renderSecretBlock(secretEl, split.secret, ctx);
                    } else {
                        secretEl.empty();
                    }
                };

        revealBtn.addEventListener("click", () => {
            void setRevealed(!ctx.revealState.isRevealed(ctx.sourcePath));
        });

        syncRevealUi();
        if (revealed && split.secret) {
            await renderSecretBlock(secretEl, split.secret, ctx);
        }
    }
}

function renderPortrait(portraitEl: HTMLElement, record: EntityRecord, ctx: CardRenderContext): void {
    const portraitTarget = resolvePortraitTarget(record.portrait);
    if (portraitTarget) {
        const dest = ctx.app.metadataCache.getFirstLinkpathDest(portraitTarget, ctx.sourcePath);
        if (dest) {
            const resourcePath = ctx.app.vault.getResourcePath(dest);
            portraitEl.createEl("img", {
                attr: {
                    src: resourcePath,
                    alt: record.name,
                    loading: "lazy",
                },
            });
            return;
        }
    }

    const fallback = portraitEl.createDiv({ cls: `${CARD_CLASS}__portrait-fallback` });
    fallback.setText("⚔");
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

function renderChips(bodyEl: HTMLElement, record: EntityRecord, excludeTags: string[]): void {
    const chipsEl = bodyEl.createDiv({ cls: `${CARD_CLASS}__chips` });
    const excluded = new Set(excludeTags.map((tag) => tag.toLowerCase()));

    if (record.depth !== null) {
        chipsEl.createSpan({
            cls: `${CARD_CLASS}__chip ${CARD_CLASS}__chip--depth`,
            text: `D${record.depth}`,
        });
    }

    if (record.status) {
        chipsEl.createSpan({
            cls: `${CARD_CLASS}__chip ${CARD_CLASS}__chip--status`,
            text: record.status,
        });
    }

    if (record.onstage) {
        const onstageChip = chipsEl.createSpan({
            cls: `${CARD_CLASS}__chip ${CARD_CLASS}__chip--onstage`,
        });
        onstageChip.createSpan({ cls: `${CARD_CLASS}__chip-dot` });
        onstageChip.createSpan({ text: "Onstage" });
    }

    for (const tag of record.tags) {
        if (excluded.has(tag.toLowerCase())) {
            continue;
        }
        chipsEl.createSpan({
            cls: `${CARD_CLASS}__chip ${CARD_CLASS}__chip--tag`,
            text: tag,
        });
    }
}

async function renderSecretBlock(
    secretEl: HTMLElement,
    secretMarkdown: string,
    ctx: CardRenderContext,
): Promise<void> {
    secretEl.empty();

    const headerEl = secretEl.createDiv({ cls: `${CARD_CLASS}__secret-header` });
    headerEl.createSpan({ text: "GM ONLY — REVEALED" });

    const hideBtn = headerEl.createEl("button", {
        cls: `${CARD_CLASS}__secret-hide`,
        type: "button",
    });
    setIcon(hideBtn.createSpan(), "eye-off");
    hideBtn.createSpan({ text: "Hide" });
    hideBtn.addEventListener("click", () => {
        ctx.revealState.setRevealed(ctx.sourcePath, false);
        ctx.onRevealChange?.();
    });

    const bodyEl = secretEl.createDiv({ cls: `${CARD_CLASS}__secret-body` });
    const renderChild = new MarkdownRenderChild(bodyEl);
    ctx.addChild(renderChild);
    await MarkdownRenderer.renderMarkdown(secretMarkdown, bodyEl, ctx.sourcePath, renderChild);

    const footerEl = secretEl.createDiv({ cls: `${CARD_CLASS}__secret-footer` });
    const openLink = footerEl.createEl("a", {
        cls: `${CARD_CLASS}__open-note`,
        text: "Open note ↗",
        href: ctx.file.path,
    });
    openLink.addEventListener("click", (event) => {
        event.preventDefault();
        void ctx.app.workspace.openLinkText(ctx.file.path, "", false);
    });
}
