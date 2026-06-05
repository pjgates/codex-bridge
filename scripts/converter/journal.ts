import { generateId } from "./ids.js";
import type { ConvertedEntity } from "./types.js";

const MODULE_ID = "sf2e-forge-custom";

/**
 * Build a Foundry VTT JournalEntry document from a converted entity.
 *
 * Produces a single JournalEntry with one or two pages:
 * - Page 1: player-facing content (default ownership: observer)
 * - Page 2: GM-only content (default ownership: none) — only if %%Secret%% was present
 *
 * Metadata from frontmatter is stored in module flags for downstream use.
 */
export function buildJournalEntry(entity: ConvertedEntity): Record<string, unknown> {
    const journalId = entity.id;
    const pages: Record<string, unknown>[] = [];

    // Page 1: Player-facing content
    const playerPageId = generateId(`${entity.slug}-page-player`);
    pages.push({
        _id: playerPageId,
        _key: `!journal.pages!${journalId}.${playerPageId}`,
        name: entity.name,
        type: "text",
        text: {
            content: entity.playerHtml,
            format: 1,
        },
        title: { level: 1, show: true },
        sort: 100000,
        ownership: { default: 2 },
    });

    // Page 2: GM-only content (if %%Secret%% section existed)
    if (entity.gmHtml !== null) {
        const gmPageId = generateId(`${entity.slug}-page-gm`);
        pages.push({
            _id: gmPageId,
            _key: `!journal.pages!${journalId}.${gmPageId}`,
            name: "GM Notes",
            type: "text",
            text: {
                content: entity.gmHtml,
                format: 1,
            },
            title: { level: 1, show: true },
            sort: 200000,
            ownership: { default: 0 },
        });
    }

    return {
        _id: journalId,
        _key: `!journal!${journalId}`,
        name: entity.name,
        pages,
        ownership: { default: 2 },
        folder: entity.folderId,
        flags: {
            [MODULE_ID]: {
                source: "vault",
                type: entity.frontmatter.type,
                depth: entity.frontmatter.depth,
                tags: entity.frontmatter.tags,
                status: entity.frontmatter.status,
                aliases: entity.frontmatter.aliases,
                slug: entity.slug,
            },
        },
    };
}
