/** Frontmatter fields extracted from a vault entity markdown file. */
export interface EntityFrontmatter {
    title: string;
    type: string;
    tags: string[];
    depth: number;
    status: string;
    aliases: string[];
    creation_date: string;
    campaign: string[];
    published: boolean;
    syncId?: string;
    /** Bare art filename extracted from a [[...]] wikilink */
    portrait?: string;
    /** Bare ring-subject art filename extracted from a [[...]] wikilink */
    subject?: string;
}

/** A parsed entity before markdown-to-HTML conversion. */
export interface ParsedEntity {
    /** Filename-derived slug (e.g. "calix-deroan") */
    slug: string;
    /** Parsed frontmatter */
    frontmatter: EntityFrontmatter;
    /** Player-facing markdown content (above %%Secret%%) */
    playerContent: string;
    /** GM-only markdown content (below %%Secret%%), or null if no marker */
    gmContent: string | null;
}

/** A fully converted entity ready for JSON serialisation. */
export interface ConvertedEntity {
    slug: string;
    id: string;
    name: string;
    frontmatter: EntityFrontmatter;
    /** HTML for player-facing page */
    playerHtml: string;
    /** HTML for GM-only page, or null if no secret section */
    gmHtml: string | null;
    /** Folder ID this entity belongs to (based on type) */
    folderId: string;
}

/** Map from entity slug to its deterministic Foundry ID. */
export type SlugMap = Map<string, string>;

/** CLI options for the converter. */
export interface ConverterOptions {
    /** Campaign subfolder name (default: "the-forge") */
    campaign: string;
    /** Include entities with published: false */
    includeUnpublished: boolean;
    /** Print what would be converted without writing files */
    dryRun: boolean;
}

/** A Foundry compendium folder entry. */
export interface CompendiumFolder {
    _id: string;
    _key: string;
    name: string;
    type: "JournalEntry";
    sort: number;
}
