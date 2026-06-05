import type { SlugMap } from "./types.js";

const MODULE_ID = "sf2e-forge-custom";
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?\|?([^\]]*)\]\]/g;

export interface ResolveWikilinkOptions {
    knownDraftSlugs?: ReadonlySet<string>;
    source?: string;
}

/** Resolve included wikilinks to JournalEntry compendium UUIDs and preserve ordinary unresolved text fallback. */
export function resolveWikilinks(
    markdown: string,
    includedSlugMap: SlugMap,
    packName: string,
    options: ResolveWikilinkOptions = {},
): string {
    return markdown.replace(WIKILINK_RE, (_match, rawTarget: string, displayText: string) => {
        const targetSlug = (rawTarget.trim().split("/").pop() ?? rawTarget.trim()).replace(/\.md$/i, "");
        const display = displayText.trim() || targetSlug;
        const id = includedSlugMap.get(targetSlug);
        if (id) return `@UUID[Compendium.${MODULE_ID}.${packName}.JournalEntry.${id}]{${display}}`;
        if (options.knownDraftSlugs?.has(targetSlug)) {
            throw new Error(`${options.source ?? "Published entity"}: wikilink targets unpublished entity ${JSON.stringify(targetSlug)}; publish it or run with --include-unpublished`);
        }
        return display;
    });
}
