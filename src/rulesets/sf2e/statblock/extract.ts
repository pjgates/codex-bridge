/**
 * Statblock source extraction — shared by the Node vault converter (strict)
 * and the runtime paste importer (lenient). Browser-safe: js-yaml only.
 *
 * A creature file declares its statblocks in frontmatter — `creatures: [id, …]`
 * — and provides one ```statblock fence per id in the body. Identity fields
 * (`id`, `syncId`, `portrait`, `subject`) live inside the fence; everything else is a
 * Pathfinder 2e Creature Layout field passed through to normaliseStatblock.
 */
import { load } from "js-yaml";

export interface ExtractedCreature {
    /** Fence `id` — the creature's slug everywhere downstream. */
    id: string;
    /** Fence `syncId`, if already minted. */
    syncId?: string;
    /** Bare art filename from the fence `portrait` field, if present. */
    portrait?: string;
    /** Bare transparent token art filename from the fence `subject` field, if present. */
    subject?: string;
    /** Normaliser input: every fence field except id/syncId/portrait/subject. */
    data: Record<string, unknown>;
    /** Fence-body character offsets in the raw file, for syncId write-back. */
    span: { start: number; end: number };
}

export interface ExtractedStatblocks {
    /** Creatures in frontmatter declaration order. */
    creatures: ExtractedCreature[];
    /** Markdown body with every statblock fence removed (prose only). */
    body: string;
}

const ENVELOPE_RE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const FENCE_RE = /^```statblock[ \t]*\r?\n([\s\S]*?)^```[ \t]*\r?$/gm;

function loadYamlObject(yaml: string, filename: string, where: string): Record<string, unknown> {
    let data: unknown;
    try {
        data = load(yaml);
    } catch (error) {
        throw new Error(`${filename}: ${where}: invalid YAML — ${error instanceof Error ? error.message : String(error)}`);
    }
    if (data == null || typeof data !== "object" || Array.isArray(data)) {
        throw new Error(`${filename}: ${where}: expected a YAML mapping`);
    }
    return data as Record<string, unknown>;
}

function stripWikilink(value: string): string {
    const match = /^\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]$/.exec(value.trim());
    return (match ? match[1] : value).trim();
}

/**
 * Extract declared creatures from a markdown file.
 *
 * Returns null when the file has no `creatures` frontmatter array (not a
 * creature file). Throws on every malformed state in between — a declared id
 * with no fence, a fence with no matching declaration, duplicates, bad YAML.
 */
export function extractStatblocks(filename: string, raw: string): ExtractedStatblocks | null {
    const envelope = ENVELOPE_RE.exec(raw);
    const frontmatter = envelope ? loadYamlObject(envelope[1], filename, "frontmatter") : {};

    if (frontmatter.statblock !== undefined) {
        throw new Error(
            `${filename}: statblock: old frontmatter format — move the creature into a \`\`\`statblock block and declare creatures: [id]`,
        );
    }
    const declared = frontmatter.creatures;
    if (declared == null) return null;
    if (!Array.isArray(declared) || declared.length === 0 || declared.some((id) => typeof id !== "string" || !id.trim())) {
        throw new Error(`${filename}: creatures: expected a non-empty array of creature ids`);
    }
    const declaredIds = (declared as string[]).map((id) => id.trim());
    const duplicate = declaredIds.find((id, index) => declaredIds.indexOf(id) !== index);
    if (duplicate) throw new Error(`${filename}: creatures: duplicate id "${duplicate}"`);

    const bodyStart = envelope ? envelope[0].length : 0;
    const byId = new Map<string, ExtractedCreature>();
    for (const match of raw.matchAll(FENCE_RE)) {
        if (match.index < bodyStart) continue;
        const yaml = match[1];
        const start = raw.indexOf("\n", match.index) + 1;
        const record = loadYamlObject(yaml, filename, "statblock block");
        for (const key of Object.keys(record)) {
            if (key === "statblock" || key === "creatures") {
                throw new Error(`${filename}: ${key}: belongs in frontmatter, not the statblock block`);
            }
        }

        const id = record.id;
        if (typeof id !== "string" || !id.trim()) throw new Error(`${filename}: statblock block: id: expected a non-empty string`);
        const trimmedId = id.trim();
        if (byId.has(trimmedId)) throw new Error(`${filename}: statblock block "${trimmedId}": duplicate fence for this id`);
        if (!declaredIds.includes(trimmedId)) {
            throw new Error(`${filename}: statblock block "${trimmedId}": not declared in the frontmatter creatures array`);
        }

        const { id: _id, syncId, portrait, subject, ...data } = record;
        if (syncId !== undefined && typeof syncId !== "string") throw new Error(`${filename}: ${trimmedId}: syncId: expected a string`);
        if (portrait !== undefined && typeof portrait !== "string") {
            throw new Error(`${filename}: ${trimmedId}: portrait: expected a string`);
        }
        if (subject !== undefined && typeof subject !== "string") {
            throw new Error(`${filename}: ${trimmedId}: subject: expected a string`);
        }
        byId.set(trimmedId, {
            id: trimmedId,
            syncId: syncId as string | undefined,
            portrait: portrait === undefined ? undefined : stripWikilink(portrait as string),
            subject: subject === undefined ? undefined : stripWikilink(subject as string),
            data,
            span: { start, end: start + yaml.length },
        });
    }

    const missing = declaredIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
        throw new Error(`${filename}: creatures: no \`\`\`statblock block found for: ${missing.join(", ")}`);
    }

    const body = raw.slice(bodyStart).replace(FENCE_RE, "").replace(/\n{3,}/g, "\n\n").trim();
    return { creatures: declaredIds.map((id) => byId.get(id)!), body };
}
