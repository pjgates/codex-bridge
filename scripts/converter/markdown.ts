import { Marked } from "marked";
import { sanitizeFoundryHtml } from "./sanitize.js";

/**
 * A pre-configured Marked instance for converting vault markdown to HTML.
 *
 * Foundry expects clean HTML with standard elements (h2, h3, p, table, etc.).
 * The Marked defaults handle this well — we just need to ensure the @UUID
 * compendium link syntax (injected by the wikilink resolver) passes through
 * the renderer untouched.
 */
const marked = new Marked({
    gfm: true,
    breaks: false,
});

/**
 * Convert markdown content to HTML.
 *
 * Wikilinks should already be resolved to @UUID syntax or plain text
 * before calling this function — the markdown renderer treats them as
 * inline text and passes them through.
 */
export function markdownToHtml(markdown: string): string {
    const html = marked.parse(markdown);
    if (typeof html !== "string") {
        throw new Error("Unexpected async result from marked.parse()");
    }
    return sanitizeFoundryHtml(html.trim());
}
