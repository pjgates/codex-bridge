import matter from "gray-matter";
import type { EntityFrontmatter, ParsedEntity } from "./types.js";

const SECRET_MARKER = "%%Secret%%";

/**
 * Parse a vault entity markdown file into structured data.
 *
 * Extracts frontmatter, splits content on the %%Secret%% marker,
 * and strips the leading # Title heading (redundant with journal entry name).
 */
export function parseEntity(
    filename: string,
    raw: string,
): ParsedEntity {
    const slug = filename.replace(/\.md$/, "");
    const { data, content } = matter(raw);

    const frontmatter = normaliseFrontmatter(filename, data);
    const { playerContent, gmContent } = splitContent(content);

    return {
        slug,
        frontmatter,
        playerContent: stripTitleHeading(playerContent),
        gmContent: gmContent !== null ? stripTitleHeading(gmContent) : null,
    };
}

/**
 * Normalise raw frontmatter data into a typed structure with defaults.
 */
function normaliseFrontmatter(filename: string, data: Record<string, unknown>): EntityFrontmatter {
    const frontmatter: EntityFrontmatter = {
        title: String(data.title ?? "Untitled"),
        type: String(data.type ?? "Unknown"),
        tags: toStringArray(data.tags),
        depth: parseDepth(filename, data.depth),
        status: String(data.status ?? "active"),
        aliases: toStringArray(data.aliases),
        creation_date: String(data.creation_date ?? ""),
        campaign: toStringArray(data.campaign),
        published: parsePublished(filename, data.published),
    };

    if (typeof data.syncId === "string" && data.syncId.length > 0) frontmatter.syncId = data.syncId;
    if (typeof data.portrait === "string" && data.portrait.length > 0) {
        const match = /^\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]$/.exec(data.portrait.trim());
        frontmatter.portrait = (match ? match[1] : data.portrait).trim();
    }

    return frontmatter;
}

function parseDepth(filename: string, value: unknown): number {
    if (value == null) return 1;
    const depth = typeof value === "number" || typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
    if (!Number.isInteger(depth)) throw new Error(`${filename}: depth: expected an integer`);
    return depth;
}

function parsePublished(filename: string, value: unknown): boolean {
    if (value == null) return true;
    if (typeof value !== "boolean") throw new Error(`${filename}: published: expected a boolean`);
    return value;
}

/**
 * Split markdown content on the %%Secret%% marker.
 * Returns player-facing content and GM-only content (or null if no marker).
 */
function splitContent(content: string): {
    playerContent: string;
    gmContent: string | null;
} {
    const markerIndex = content.indexOf(SECRET_MARKER);
    if (markerIndex === -1) {
        return { playerContent: content.trim(), gmContent: null };
    }

    const playerContent = content.slice(0, markerIndex).trim();
    const gmContent = content.slice(markerIndex + SECRET_MARKER.length).trim();

    return {
        playerContent,
        gmContent: gmContent.length > 0 ? gmContent : null,
    };
}

/**
 * Strip the leading `# Title` heading from markdown content.
 * The title is redundant with the journal entry name.
 */
function stripTitleHeading(content: string): string {
    return content.replace(/^#\s+.+\n*/, "").trim();
}

/** Coerce a value to a string array, handling missing/scalar values. */
function toStringArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === "string") return [value];
    return [];
}
