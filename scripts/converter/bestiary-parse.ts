/**
 * Node-side wrapper: frontmatter extraction via gray-matter feeding the
 * shared statblock normaliser (strict mode — vault content is reviewed).
 */
import matter from "gray-matter";
import { normaliseStatblock } from "../../src/rulesets/sf2e/statblock/parse.js";
import type { ParsedCreature } from "../../src/rulesets/sf2e/statblock/types.js";

export {
    parseSensesString,
    parseSpeedString,
    parseAttackName,
    parseAttackDesc,
    parseDamageString,
} from "../../src/rulesets/sf2e/statblock/parse.js";

/**
 * Parse a bestiary creature markdown file into structured data.
 *
 * The creature's mechanical data lives entirely in the YAML frontmatter
 * using the Pathfinder 2e Creature Layout format. The markdown body is
 * ignored — it's for notes/lore viewed in Obsidian only.
 *
 * Returns null if the file doesn't have `statblock: true` in frontmatter.
 */
export function parseCreature(
    filename: string,
    raw: string,
): ParsedCreature | null {
    const slug = filename.replace(/\.md$/, "");
    const { data } = matter(raw);

    if (data.statblock == null || data.statblock === false) return null;
    if (data.statblock !== true) throw new Error(`${filename}: statblock: expected a boolean`);

    const statblock = normaliseStatblock(data, filename);
    return { slug, statblock };
}
