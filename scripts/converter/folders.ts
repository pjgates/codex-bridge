import { generateId } from "./ids.js";
import type { CompendiumFolder, ParsedEntity } from "./types.js";

/** Canonical sort order for known entity types. Unknown types sort last. */
const TYPE_SORT_ORDER = new Map<string, number>([
    ["Character", 100000],
    ["Location", 200000],
    ["Faction", 300000],
    ["Reference", 400000],
    ["Event", 500000],
    ["Item", 600000],
]);

/**
 * Build compendium folder entries from the distinct entity types.
 *
 * Each unique `type` value in the parsed entities becomes a folder.
 * Folder IDs are deterministic (hashed from the type name) so they
 * remain stable across re-runs.
 */
export function buildFolders(entities: ParsedEntity[]): CompendiumFolder[] {
    const types = new Set(entities.map((e) => e.frontmatter.type));
    let fallbackSort = 900000;

    const folders: CompendiumFolder[] = [];
    for (const type of [...types].sort()) {
        const sort = TYPE_SORT_ORDER.get(type) ?? (fallbackSort += 100000);
        const _id = generateId(`folder-${type}`);
        folders.push({
            _id,
            _key: `!folders!${_id}`,
            name: pluraliseType(type),
            type: "JournalEntry",
            sort,
        });
    }

    return folders;
}

/**
 * Get the folder ID for a given entity type.
 */
export function getFolderId(type: string): string {
    return generateId(`folder-${type}`);
}

/** Simple pluralisation for folder display names. */
function pluraliseType(type: string): string {
    if (type.endsWith("s")) return type;
    if (type.endsWith("y")) return type.slice(0, -1) + "ies";
    return type + "s";
}
