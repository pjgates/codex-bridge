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
