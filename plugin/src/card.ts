import {
    App,
    MarkdownRenderChild,
    MarkdownRenderer,
    TFile,
    setIcon,
} from "obsidian";
import { clampDescriptionLines, type CardSettings } from "./defaults.js";
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
    removeChild: (child: MarkdownRenderChild) => void;
    onRevealChange?: () => void;
    suppressPortrait?: boolean;
}

const CARD_CLASS = "codex-dashboard-card";
const PORTRAIT_WIKILINK_RE = /^\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]$/;

interface CardRuntimeState {
    generation: number;
    secretChild: MarkdownRenderChild | null;
    descChild: MarkdownRenderChild | null;
}

const cardRuntime = new WeakMap<HTMLElement, CardRuntimeState>();

function getCardRuntime(el: HTMLElement): CardRuntimeState {
    let runtime = cardRuntime.get(el);
    if (!runtime) {
        runtime = { generation: 0, secretChild: null, descChild: null };
        cardRuntime.set(el, runtime);
    }
    return runtime;
}

function bumpCardGeneration(el: HTMLElement): number {
    const runtime = getCardRuntime(el);
    runtime.generation += 1;
    return runtime.generation;
}

function isCardRenderStale(el: HTMLElement, generation: number): boolean {
    if (!el.isConnected) {
        return true;
    }

    const runtime = cardRuntime.get(el);
    return !runtime || runtime.generation !== generation;
}

function unloadSecretRenderChild(el: HTMLElement, ctx: CardRenderContext): void {
    const runtime = cardRuntime.get(el);
    if (!runtime?.secretChild) {
        return;
    }

    runtime.secretChild.unload();
    ctx.removeChild(runtime.secretChild);
    runtime.secretChild = null;
}

function unloadDescRenderChild(el: HTMLElement, ctx: CardRenderContext): void {
    const runtime = cardRuntime.get(el);
    if (!runtime?.descChild) {
        return;
    }

    runtime.descChild.unload();
    ctx.removeChild(runtime.descChild);
    runtime.descChild = null;
}

export async function renderCard(
    el: HTMLElement,
    record: EntityRecord,
    ctx: CardRenderContext,
): Promise<void> {
    const generation = bumpCardGeneration(el);
    unloadSecretRenderChild(el, ctx);
    unloadDescRenderChild(el, ctx);
    el.empty();
    el.addClass(CARD_CLASS);
    if (ctx.suppressPortrait) {
        el.addClass(`${CARD_CLASS}--no-portrait`);
    }

    const fileText = await ctx.app.vault.cachedRead(ctx.file);
    if (isCardRenderStale(el, generation)) {
        return;
    }

    const split = splitSecret(fileText);
    const revealed = ctx.revealState.isRevealed(ctx.sourcePath);
    const hasSecret = split.secret !== null;

    if (!ctx.suppressPortrait) {
        const portraitEl = el.createDiv({ cls: `${CARD_CLASS}__portrait` });
        renderPortrait(portraitEl, record, ctx);
    }

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

    const descEl = bodyEl.createDiv({ cls: `${CARD_CLASS}__desc` });
    descEl.style.setProperty(
        "-webkit-line-clamp",
        String(clampDescriptionLines(ctx.settings.descriptionLines)),
    );
    descEl.style.setProperty("display", "-webkit-box");
    descEl.style.setProperty("-webkit-box-orient", "vertical");
    descEl.style.setProperty("overflow", "hidden");

    const descChild = new MarkdownRenderChild(descEl);
    getCardRuntime(el).descChild = descChild;
    ctx.addChild(descChild);
    await MarkdownRenderer.renderMarkdown(split.description, descEl, ctx.sourcePath, descChild);
    if (isCardRenderStale(el, generation)) {
        unloadDescRenderChild(el, ctx);
        return;
    }

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
            const opGeneration = bumpCardGeneration(el);
            ctx.revealState.setRevealed(ctx.sourcePath, next);

            if (isCardRenderStale(el, opGeneration)) {
                return;
            }

            syncRevealUi();

            if (next && split.secret) {
                await renderSecretBlock(el, secretEl, split.secret, ctx, setRevealed);
            } else {
                unloadSecretRenderChild(el, ctx);
                if (!isCardRenderStale(el, opGeneration)) {
                    secretEl.empty();
                }
            }
        };

        revealBtn.addEventListener("click", () => {
            void setRevealed(!ctx.revealState.isRevealed(ctx.sourcePath));
        });

        syncRevealUi();
        if (revealed && split.secret) {
            await renderSecretBlock(el, secretEl, split.secret, ctx, setRevealed);
            if (isCardRenderStale(el, generation)) {
                return;
            }
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

export function resolvePortraitTarget(portrait: string | undefined): string | undefined {
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
    cardEl: HTMLElement,
    secretEl: HTMLElement,
    secretMarkdown: string,
    ctx: CardRenderContext,
    setRevealed: (next: boolean) => Promise<void>,
): Promise<void> {
    const generation = bumpCardGeneration(cardEl);
    unloadSecretRenderChild(cardEl, ctx);
    secretEl.empty();

    if (isCardRenderStale(cardEl, generation)) {
        return;
    }

    const headerEl = secretEl.createDiv({ cls: `${CARD_CLASS}__secret-header` });
    headerEl.createSpan({ text: "GM ONLY — REVEALED" });

    const hideBtn = headerEl.createEl("button", {
        cls: `${CARD_CLASS}__secret-hide`,
        type: "button",
    });
    setIcon(hideBtn.createSpan(), "eye-off");
    hideBtn.createSpan({ text: "Hide" });
    hideBtn.addEventListener("click", () => {
        void setRevealed(false);
    });

    const bodyEl = secretEl.createDiv({ cls: `${CARD_CLASS}__secret-body` });
    const renderChild = new MarkdownRenderChild(bodyEl);
    getCardRuntime(cardEl).secretChild = renderChild;
    ctx.addChild(renderChild);

    await MarkdownRenderer.renderMarkdown(secretMarkdown, bodyEl, ctx.sourcePath, renderChild);
    if (isCardRenderStale(cardEl, generation)) {
        unloadSecretRenderChild(cardEl, ctx);
        return;
    }

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
