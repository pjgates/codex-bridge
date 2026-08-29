/**
 * Node-side wrapper: statblock extraction via the shared extractor feeding the
 * shared statblock normaliser (strict mode — vault content is reviewed).
 */
import { extractStatblocks } from "../../src/rulesets/sf2e/statblock/extract.js";
import { normaliseStatblock } from "../../src/rulesets/sf2e/statblock/parse.js";
import type { ParsedCreature } from "../../src/rulesets/sf2e/statblock/types.js";

export interface ParsedVaultCreature extends ParsedCreature {
    /** Fence-declared syncId (minted and written back at push time if absent). */
    syncId?: string;
    /** Bare art filename from the fence `portrait` field, if present. */
    portrait?: string;
    /** Bare transparent token art filename from the fence `subject` field, if present. */
    subject?: string;
    /** Fence-body character offsets in the raw file, for syncId write-back. */
    span: { start: number; end: number };
}

/**
 * Parse a bestiary markdown file into one creature per declared id.
 *
 * Creature mechanics live in ```statblock fences declared by the frontmatter
 * `creatures: [id, …]` array; each fence carries its own `id`, `syncId`, and
 * identity fields. The markdown body is prose for Obsidian only.
 *
 * Returns null if the file has no `creatures` array (not a creature file).
 */
export function parseCreature(
    filename: string,
    raw: string,
): ParsedVaultCreature[] | null {
    const extracted = extractStatblocks(filename, raw);
    if (!extracted) return null;
    return extracted.creatures.map((creature) => ({
        slug: creature.id,
        syncId: creature.syncId,
        portrait: creature.portrait,
        subject: creature.subject,
        span: creature.span,
        statblock: normaliseStatblock(creature.data, filename),
    }));
}
