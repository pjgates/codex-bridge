import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseCreature } from "../converter/bestiary-parse.js";
import { markdownToHtml } from "../converter/markdown.js";
import { parseEntity } from "../converter/parse.js";
import type { ParsedEntity } from "../converter/types.js";
import { insertFrontmatterField, mintSyncId } from "./frontmatter.js";
import { PAYLOAD_FORMAT_VERSION, type SyncCreature, type SyncEntity, type SyncPayload } from "../../src/sync/payload-types.js";

export interface BuildPayloadOptions {
    vaultPath: string;
    campaign: string;
    assetsDir?: string;
}

export interface BuildResult {
    payload: SyncPayload;
    /** Absolute source path -> payload-relative art path ("art/<syncId>.webp") */
    artFiles: Map<string, string>;
    /** Vault files rewritten with a freshly minted syncId */
    mintedFiles: string[];
    warnings: string[];
}

function hash(value: string): string {
    return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/** [[slug|Display]] in markdown resolves to @ForgeSync[syncId]{Display} when the slug is a synced entity, else plain display text. */
export function resolveLinkPlaceholders(markdown: string, syncIdBySlug: Map<string, string>): string {
    return markdown.replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_all, slug: string, display?: string) => {
        const text = display?.trim() || slug.trim();
        const syncId = syncIdBySlug.get(slug.trim().toLowerCase());
        return syncId ? `@ForgeSync[${syncId}]{${text}}` : text;
    });
}

async function listMarkdown(directory: string): Promise<string[]> {
    try {
        return (await readdir(directory)).filter((entry) => entry.endsWith(".md")).sort();
    } catch (error: unknown) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
        throw error;
    }
}

export async function buildPayload(options: BuildPayloadOptions): Promise<BuildResult> {
    const assetsDir = options.assetsDir ?? path.join(options.vaultPath, "codex", "assets");
    const campaignDir = path.join(options.vaultPath, "codex", options.campaign);
    const warnings: string[] = [];
    const mintedFiles: string[] = [];
    const artFiles = new Map<string, string>();
    const syncIdOwners = new Map<string, string>();

    async function ensureSyncId(filePath: string, existing: string | undefined): Promise<string> {
        let syncId = existing;
        if (!syncId) {
            syncId = mintSyncId();
            const raw = await readFile(filePath, "utf-8");
            await writeFile(filePath, insertFrontmatterField(raw, "syncId", syncId));
            mintedFiles.push(filePath);
        }

        const owner = syncIdOwners.get(syncId);
        if (owner) throw new Error(`Duplicate syncId ${syncId} in ${owner} and ${filePath}`);
        syncIdOwners.set(syncId, filePath);
        return syncId;
    }

    async function stageArt(portraitFile: string | undefined, syncId: string, sourceLabel: string): Promise<string | null> {
        if (!portraitFile) return null;
        const sourcePath = path.join(assetsDir, portraitFile);
        try {
            await stat(sourcePath);
        } catch {
            throw new Error(`${sourceLabel}: portrait asset not found: ${sourcePath}`);
        }
        const relative = `art/${syncId}${path.extname(portraitFile)}`;
        artFiles.set(sourcePath, relative);
        return relative;
    }

    // Entities
    const entitiesDir = path.join(campaignDir, "entities");
    const parsed: { filePath: string; entity: ParsedEntity; syncId: string }[] = [];
    for (const filename of await listMarkdown(entitiesDir)) {
        const filePath = path.join(entitiesDir, filename);
        const entity = parseEntity(filename, await readFile(filePath, "utf-8"));
        const syncId = await ensureSyncId(filePath, entity.frontmatter.syncId);
        parsed.push({ filePath, entity, syncId });
    }

    const syncIdBySlug = new Map(parsed.map(({ entity, syncId }) => [entity.slug.toLowerCase(), syncId]));
    const entities: SyncEntity[] = [];
    for (const { filePath, entity, syncId } of parsed) {
        const portrait = await stageArt(entity.frontmatter.portrait, syncId, filePath);
        if (entity.frontmatter.type === "Character" && !portrait) warnings.push(`${entity.slug}: character has no portrait — journal syncs, no actor created`);
        const playerHtml = markdownToHtml(resolveLinkPlaceholders(entity.playerContent, syncIdBySlug));
        const gmHtml = entity.gmContent === null ? null : markdownToHtml(resolveLinkPlaceholders(entity.gmContent, syncIdBySlug));
        entities.push({
            syncId,
            slug: entity.slug,
            name: entity.frontmatter.title,
            type: entity.frontmatter.type,
            published: entity.frontmatter.published,
            playerHtml,
            gmHtml,
            portrait,
            contentHash: hash(JSON.stringify({ title: entity.frontmatter.title, type: entity.frontmatter.type, playerHtml, gmHtml, portrait, published: entity.frontmatter.published })),
        });
    }

    // Creatures
    const bestiaryDir = path.join(campaignDir, "bestiary");
    const creatures: SyncCreature[] = [];
    for (const filename of await listMarkdown(bestiaryDir)) {
        const filePath = path.join(bestiaryDir, filename);
        const raw = await readFile(filePath, "utf-8");
        const creature = parseCreature(filename, raw);
        if (!creature) continue;
        const frontmatter = parseEntity(filename, raw).frontmatter;
        const syncId = await ensureSyncId(filePath, frontmatter.syncId);
        const portrait = await stageArt(frontmatter.portrait, syncId, filePath);
        creatures.push({
            syncId,
            slug: creature.slug,
            name: creature.statblock.name,
            statblock: creature.statblock,
            portrait,
            contentHash: hash(JSON.stringify({ statblock: creature.statblock, portrait })),
        });
    }

    const manifestHash = hash(JSON.stringify([
        ...entities.map((entity) => [entity.syncId, entity.contentHash]),
        ...creatures.map((creature) => [creature.syncId, creature.contentHash]),
    ]));

    return {
        payload: {
            formatVersion: PAYLOAD_FORMAT_VERSION,
            generatedAt: new Date().toISOString(),
            manifestHash,
            entities,
            creatures,
        },
        artFiles,
        mintedFiles,
        warnings,
    };
}
