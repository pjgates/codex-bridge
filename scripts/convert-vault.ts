#!/usr/bin/env tsx
import { lstat, mkdir, open, readdir, realpath, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Command } from "commander";
import { acquireBuildLock, releaseBuildLock } from "./build-lock.js";
import { buildActorDocument } from "./converter/bestiary-actor.js";
import { parseCreature } from "./converter/bestiary-parse.js";
import type { ParsedCreature } from "./converter/bestiary-types.js";
import { writeBestiaryPack } from "./converter/bestiary-write.js";
import { buildFolders, getFolderId } from "./converter/folders.js";
import { generateId } from "./converter/ids.js";
import { buildJournalEntry } from "./converter/journal.js";
import { resolveWikilinks } from "./converter/links.js";
import { markdownToHtml } from "./converter/markdown.js";
import { parseEntity } from "./converter/parse.js";
import type { ConvertedEntity, ConverterOptions, ParsedEntity, SlugMap } from "./converter/types.js";
import { establishSnapshotParentTrust, recoverSourceSnapshotPromotion, withSnapshotRollback, type SnapshotWriter } from "./converter/snapshot-output.js";
import { writePack } from "./converter/write.js";

const ENTITIES_PACK = "the-forge-entities";
const BESTIARY_PACK = "the-forge-bestiary";
const DEFAULT_ROOT_DIR = path.resolve(import.meta.dirname, "..");

export async function convertVault(options: ConverterOptions, rootDir = DEFAULT_ROOT_DIR): Promise<void> {
    const campaignDir = canonicalizeCampaignDir(rootDir, options.campaign);
    if (options.dryRun) {
        const sourceTrust = await establishSourceTrust(rootDir, campaignDir);
        const bestiaryPlan = await prepareBestiaryPlan(options, rootDir, sourceTrust);
        await convertEntities(options, rootDir, sourceTrust);
        await writeBestiaryPlan(bestiaryPlan, true);
        return;
    }
    const packsDirectory = path.join(rootDir, "packs");
    const sourceRoot = path.join(packsDirectory, "_source");
    await assertSafeOutputAncestor(rootDir, sourceRoot);
    await mkdir(packsDirectory, { recursive: true });
    const buildLock = acquireBuildLock(packsDirectory);
    try {
        await assertSafeOutputAncestor(rootDir, sourceRoot);
        await recoverSourceSnapshotPromotion(sourceRoot);
        await mkdir(sourceRoot, { recursive: true });
        await assertSafeOutputAncestor(rootDir, sourceRoot);
        const outputTrust = await establishSnapshotParentTrust(sourceRoot);
        const sourceTrust = await establishSourceTrust(rootDir, campaignDir);
        const bestiaryPlan = await prepareBestiaryPlan(options, rootDir, sourceTrust);
        let entitiesSnapshot: SourceSnapshot | undefined;
        await withSnapshotRollback(async (snapshotWriter) => {
            entitiesSnapshot = await convertEntities(options, rootDir, sourceTrust, snapshotWriter);
            await writeBestiaryPlan(bestiaryPlan, false, snapshotWriter);
        }, async () => {
            if (!entitiesSnapshot) throw new Error("Entities source snapshot was not captured before promotion");
            await assertSourceSnapshotAvailable(entitiesSnapshot, "Entities");
            await assertBestiarySourceAvailable(bestiaryPlan);
        }, { trustedParent: outputTrust });
    } finally {
        releaseBuildLock(buildLock);
    }
}

/** Resolve a campaign beneath vault/codex without allowing absolute or escaping input. */
export function canonicalizeCampaignDir(rootDir: string, campaign: string): string {
    if (!campaign || path.isAbsolute(campaign)) throw new Error(`Invalid --campaign value: ${JSON.stringify(campaign)}`);
    const codexDir = path.resolve(rootDir, "vault", "codex");
    const campaignDir = path.resolve(codexDir, campaign);
    const relative = path.relative(codexDir, campaignDir);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Invalid --campaign value outside vault/codex: ${JSON.stringify(campaign)}`);
    }
    return campaignDir;
}

async function convertEntities(options: ConverterOptions, rootDir: string, trust: SourceTrust, snapshotWriter?: SnapshotWriter): Promise<SourceSnapshot> {
    const entitiesDir = path.join(trust.campaignDir, "entities");
    const outputDir = path.join(rootDir, "packs", "_source", ENTITIES_PACK);
    let filenames: string[];
    let entitiesIdentity: FilesystemIdentity;
    try {
        entitiesIdentity = await assertTrustedPath(trust, entitiesDir, "entities directory");
        filenames = (await readdir(entitiesDir)).filter((filename) => filename.endsWith(".md")).sort();
        await assertTrustedPath(trust, entitiesDir, "entities directory", entitiesIdentity);
    } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") {
            throw new Error(`Entities directory not found: ${entitiesDir}. Make sure the vault submodule is initialised: git submodule update --init`);
        }
        throw error;
    }

    const sourceSnapshot = await captureSourceSnapshot(trust, entitiesDir, "entities directory", filenames, undefined, entitiesIdentity);
    const allParsed: ParsedEntity[] = sourceSnapshot.files.map(({ filename, content }) => parseEntity(filename, content));
    const included = options.includeUnpublished ? allParsed : allParsed.filter((entity) => entity.frontmatter.published);
    const includedSlugMap: SlugMap = new Map(included.map((entity) => [entity.slug, generateId(entity.slug)]));
    const knownDraftSlugs = new Set(allParsed.filter((entity) => !entity.frontmatter.published).map((entity) => entity.slug));
    const converted: ConvertedEntity[] = included.map((entity) => {
        const id = includedSlugMap.get(entity.slug);
        if (!id) throw new Error(`Missing deterministic ID for ${entity.slug}`);
        const linkOptions = { knownDraftSlugs, source: `${entity.slug}.md` };
        return {
            slug: entity.slug,
            id,
            name: entity.frontmatter.title,
            frontmatter: entity.frontmatter,
            playerHtml: markdownToHtml(resolveWikilinks(entity.playerContent, includedSlugMap, ENTITIES_PACK, linkOptions)),
            gmHtml: entity.gmContent === null
                ? null
                : markdownToHtml(resolveWikilinks(entity.gmContent, includedSlugMap, ENTITIES_PACK, linkOptions)),
            folderId: getFolderId(entity.frontmatter.type),
        };
    });
    const folders = buildFolders(included);
    await writePack(outputDir, converted.map((entity) => ({ slug: entity.slug, json: buildJournalEntry(entity) })), folders, options.dryRun, snapshotWriter);

    const skipped = allParsed.length - included.length;
    const skipMsg = skipped > 0 ? ` (${skipped} skipped: unpublished)` : "";
    const modeMsg = options.dryRun ? " [dry-run]" : "";
    console.log(`\nEntities: ${included.length}/${allParsed.length}${skipMsg}${modeMsg}`);
    console.log(`  Pack: ${ENTITIES_PACK}`);
    console.log(`  Folders: ${folders.map((folder) => folder.name).join(", ")}`);
    if (!options.dryRun) console.log(`  Output: ${outputDir}`);
    return sourceSnapshot;
}

interface BestiaryPlan {
    outputDir: string;
    entries: { slug: string; json: Record<string, unknown> }[];
    parsedCount: number;
    trust: SourceTrust;
    sourceDir: string;
    sourceSnapshot: SourceSnapshot | null;
}

async function prepareBestiaryPlan(options: ConverterOptions, rootDir: string, trust: SourceTrust): Promise<BestiaryPlan> {
    const bestiaryDir = path.join(trust.campaignDir, "bestiary");
    const outputDir = path.join(rootDir, "packs", "_source", BESTIARY_PACK);
    const listing = await listOptionalBestiaryFiles(trust, bestiaryDir);
    const sourceSnapshot = listing === null ? null : await captureSourceSnapshot(trust, bestiaryDir, "bestiary directory", listing.filenames, undefined, listing.sourceDirIdentity);
    const allParsed: ParsedCreature[] = [];
    for (const { filename, content } of sourceSnapshot?.files ?? []) {
        const creature = parseCreature(filename, content);
        if (creature) allParsed.push(creature);
    }
    const included = options.includeUnpublished ? allParsed : allParsed.filter((creature) => creature.statblock.published);
    return {
        outputDir,
        trust,
        sourceDir: bestiaryDir,
        sourceSnapshot,
        entries: included.map((creature) => ({ slug: creature.slug, json: buildActorDocument(creature) })),
        parsedCount: allParsed.length,
    };
}

interface SourceListing {
    filenames: string[];
    sourceDirIdentity: FilesystemIdentity;
}

async function listOptionalBestiaryFiles(trust: SourceTrust, bestiaryDir: string): Promise<SourceListing | null> {
    await assertSourceTrustAvailable(trust);
    try {
        await lstat(bestiaryDir);
    } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") return null;
        throw error;
    }
    const sourceDirIdentity = await assertTrustedPath(trust, bestiaryDir, "bestiary directory");
    const filenames = (await readdir(bestiaryDir)).filter((filename) => filename.endsWith(".md")).sort();
    await assertTrustedPath(trust, bestiaryDir, "bestiary directory", sourceDirIdentity);
    return { filenames, sourceDirIdentity };
}

async function assertBestiarySourceAvailable(plan: BestiaryPlan): Promise<void> {
    const listing = await listOptionalBestiaryFiles(plan.trust, plan.sourceDir);
    const snapshot = plan.sourceSnapshot;
    if (snapshot === null) {
        if (listing !== null) throw new Error(`Bestiary source set changed before promotion: directory appeared at ${plan.sourceDir}`);
        return;
    }
    if (listing === null) throw new Error(`Bestiary directory disappeared before promotion: ${plan.sourceDir}`);
    const { filenames } = listing;
    if (filenames.length !== snapshot.filenames.length || filenames.some((filename, index) => filename !== snapshot.filenames[index])) {
        throw new Error(`Bestiary source set changed before promotion: expected ${JSON.stringify(snapshot.filenames)}, found ${JSON.stringify(filenames)}`);
    }
    if (listing.sourceDirIdentity.objectId !== snapshot.sourceDirIdentity.objectId || listing.sourceDirIdentity.canonicalPath !== snapshot.sourceDirIdentity.canonicalPath) {
        throw new Error(`bestiary directory identity changed before promotion`);
    }
    await assertSourceSnapshotAvailable(snapshot, "Bestiary");
}

interface FilesystemIdentity {
    readonly canonicalPath: string;
    readonly objectId: string;
}

interface SourceSnapshot {
    trust: SourceTrust;
    sourceDirLabel: string;
    sourceDir: string;
    sourceDirIdentity: FilesystemIdentity;
    filenames: string[];
    files: { filename: string; identity: FilesystemIdentity; content: string }[];
}

async function captureSourceSnapshot(
    trust: SourceTrust,
    sourceDir: string,
    sourceDirLabel: string,
    filenames: string[],
    expected?: SourceSnapshot,
    expectedSourceDirIdentity?: FilesystemIdentity,
): Promise<SourceSnapshot> {
    const sourceDirIdentity = await assertTrustedPath(trust, sourceDir, sourceDirLabel, expected?.sourceDirIdentity ?? expectedSourceDirIdentity);
    const files = await Promise.all(filenames.map(async (filename, index) => {
        const filePath = path.join(sourceDir, filename);
        const expectedIdentity = expected?.files[index]?.identity;
        const before = await assertTrustedPath(trust, filePath, filename, expectedIdentity);
        assertCanonicalDescendant(sourceDirIdentity.canonicalPath, before.canonicalPath, filename);
        const handle = await open(filePath, "r");
        try {
            const handleIdentity = identity(await handle.stat({ bigint: true }));
            if (handleIdentity !== before.objectId) throw new Error(`${filename} identity changed before read`);
            const content = await handle.readFile("utf-8");
            if (identity(await handle.stat({ bigint: true })) !== handleIdentity) throw new Error(`${filename} identity changed during read`);
            const after = await assertTrustedPath(trust, filePath, filename, before);
            assertCanonicalDescendant(sourceDirIdentity.canonicalPath, after.canonicalPath, filename);
            return { filename, identity: before, content };
        } finally {
            await handle.close();
        }
    }));
    return { trust, sourceDir, sourceDirIdentity, sourceDirLabel, filenames, files };
}

async function assertSourceSnapshotAvailable(snapshot: SourceSnapshot, label: string): Promise<void> {
    await assertTrustedPath(snapshot.trust, snapshot.sourceDir, snapshot.sourceDirLabel, snapshot.sourceDirIdentity);
    const filenames = (await readdir(snapshot.sourceDir)).filter((filename) => filename.endsWith(".md")).sort();
    if (filenames.length !== snapshot.filenames.length || filenames.some((filename, index) => filename !== snapshot.filenames[index])) {
        throw new Error(`${label} source set changed before promotion: expected ${JSON.stringify(snapshot.filenames)}, found ${JSON.stringify(filenames)}`);
    }
    const current = await captureSourceSnapshot(snapshot.trust, snapshot.sourceDir, snapshot.sourceDirLabel, filenames, snapshot);
    const changed = current.files.find(({ content }, index) => content !== snapshot.files[index]?.content);
    if (changed) throw new Error(`${label} source content changed before promotion: ${changed.filename}`);
}

async function writeBestiaryPlan(plan: BestiaryPlan, dryRun: boolean, snapshotWriter?: SnapshotWriter): Promise<void> {
    if (!dryRun) await assertBestiarySourceAvailable(plan);
    await writeBestiaryPack(plan.outputDir, plan.entries, dryRun, snapshotWriter);
    const skipped = plan.parsedCount - plan.entries.length;
    const skipMsg = skipped > 0 ? ` (${skipped} skipped: unpublished)` : "";
    const modeMsg = dryRun ? " [dry-run]" : "";
    console.log(`\nBestiary: ${plan.entries.length}/${plan.parsedCount}${skipMsg}${modeMsg}`);
    console.log(`  Pack: ${BESTIARY_PACK}`);
    if (!dryRun) console.log(`  Output: ${plan.outputDir}`);
}

interface SourceTrust {
    readonly codexDir: string;
    readonly codexIdentity: FilesystemIdentity;
    readonly campaignDir: string;
    readonly campaignIdentity: FilesystemIdentity;
}

async function establishSourceTrust(rootDir: string, campaignDir: string): Promise<SourceTrust> {
    const codexDir = path.resolve(rootDir, "vault", "codex");
    const codexIdentity = await filesystemIdentity(codexDir);
    const campaignIdentity = await filesystemIdentity(campaignDir);
    assertCanonicalDescendant(codexIdentity.canonicalPath, campaignIdentity.canonicalPath, "--campaign");
    const trust: SourceTrust = Object.freeze({ codexDir, codexIdentity, campaignDir, campaignIdentity });
    await assertSourceTrustAvailable(trust);
    return trust;
}

async function assertSourceTrustAvailable(trust: SourceTrust): Promise<void> {
    await assertIdentity(trust.codexDir, "vault/codex", trust.codexIdentity);
    const campaignIdentity = await filesystemIdentity(trust.campaignDir);
    assertCanonicalDescendant(trust.codexIdentity.canonicalPath, campaignIdentity.canonicalPath, "--campaign");
    if (campaignIdentity.canonicalPath !== trust.campaignIdentity.canonicalPath || campaignIdentity.objectId !== trust.campaignIdentity.objectId) {
        throw new Error(`--campaign identity changed: expected ${trust.campaignIdentity.canonicalPath} (${trust.campaignIdentity.objectId}), found ${campaignIdentity.canonicalPath} (${campaignIdentity.objectId})`);
    }
}

async function assertTrustedPath(trust: SourceTrust, candidate: string, label: string, expected?: FilesystemIdentity): Promise<FilesystemIdentity> {
    await assertSourceTrustAvailable(trust);
    const candidateIdentity = await filesystemIdentity(candidate);
    assertCanonicalDescendant(trust.codexIdentity.canonicalPath, candidateIdentity.canonicalPath, label);
    assertCanonicalDescendant(trust.campaignIdentity.canonicalPath, candidateIdentity.canonicalPath, label);
    if (expected != null && (candidateIdentity.canonicalPath !== expected.canonicalPath || candidateIdentity.objectId !== expected.objectId)) {
        throw new Error(`${label} identity changed: expected ${expected.canonicalPath} (${expected.objectId}), found ${candidateIdentity.canonicalPath} (${candidateIdentity.objectId})`);
    }
    return candidateIdentity;
}

async function assertIdentity(candidate: string, label: string, expected: FilesystemIdentity): Promise<FilesystemIdentity> {
    const current = await filesystemIdentity(candidate);
    if (current.canonicalPath !== expected.canonicalPath || current.objectId !== expected.objectId) {
        throw new Error(`${label} identity changed: expected ${expected.canonicalPath} (${expected.objectId}), found ${current.canonicalPath} (${current.objectId})`);
    }
    return current;
}

async function filesystemIdentity(candidate: string): Promise<FilesystemIdentity> {
    const before = identity(await stat(candidate, { bigint: true }));
    const canonicalPath = await realpath(candidate);
    const after = identity(await stat(candidate, { bigint: true }));
    if (after !== before) throw new Error(`Filesystem identity changed while inspecting ${candidate}`);
    return { canonicalPath, objectId: before };
}

function identity(metadata: { dev: bigint; ino: bigint }): string {
    return `${metadata.dev}:${metadata.ino}`;
}

function assertCanonicalDescendant(canonicalParent: string, canonicalCandidate: string, label: string): void {
    const relative = path.relative(canonicalParent, canonicalCandidate);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`${label} resolves outside ${canonicalParent}: ${canonicalCandidate}`);
    }
}

async function assertSafeOutputAncestor(rootDir: string, outputDir: string): Promise<void> {
    const root = path.resolve(rootDir);
    const canonicalRoot = await realpath(root);
    const relative = path.relative(root, path.resolve(outputDir));
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Invalid output directory: ${outputDir}`);
    let current = root;
    for (const segment of relative.split(path.sep)) {
        current = path.join(current, segment);
        try {
            const stats = await lstat(current);
            if (stats.isSymbolicLink()) throw new Error(`Output directory contains a symlink: ${current}`);
            const canonicalCurrent = await realpath(current);
            const canonicalRelative = path.relative(canonicalRoot, canonicalCurrent);
            if (canonicalRelative === ".." || canonicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(canonicalRelative)) throw new Error(`Output directory resolves outside repository: ${canonicalCurrent}`);
        } catch (error) {
            if ((error as { code?: unknown }).code === "ENOENT") return;
            throw error;
        }
    }
}

async function runCli(): Promise<void> {
    const options = new Command()
        .name("convert-vault")
        .description("Convert vault markdown entities and bestiary into Foundry VTT compendium JSON")
        .option("--campaign <name>", "Campaign subfolder name", "the-forge")
        .option("--include-unpublished", "Include entities with published: false", false)
        .option("--dry-run", "Show what would be converted without writing files", false)
        .parse()
        .opts<ConverterOptions>();
    await convertVault(options);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    await runCli();
}
