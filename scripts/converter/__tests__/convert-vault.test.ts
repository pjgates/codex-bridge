import { mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalizeCampaignDir, convertVault } from "../../convert-vault.js";

const OPTIONS = { campaign: "campaign", includeUnpublished: false, dryRun: false };

async function tempRoot(): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), "sf2e-convert-vault-"));
    await mkdir(path.join(root, "vault", "codex", "campaign", "entities"), { recursive: true });
    return root;
}

function journal(title: string, published: boolean, content: string): string {
    return `---\ntitle: ${title}\ntype: Location\npublished: ${published}\n---\n# ${title}\n\n${content}\n`;
}

async function seedLiveOutputs(root: string): Promise<{ journalOutput: string; bestiaryOutput: string }> {
    const journalOutput = path.join(root, "packs", "_source", "the-forge-entities");
    const bestiaryOutput = path.join(root, "packs", "_source", "the-forge-bestiary");
    await mkdir(journalOutput, { recursive: true });
    await mkdir(bestiaryOutput, { recursive: true });
    await writeFile(path.join(journalOutput, "stale.json"), "stale journal");
    await writeFile(path.join(bestiaryOutput, "stale.json"), "stale bestiary");
    return { journalOutput, bestiaryOutput };
}

async function expectLiveOutputsPreserved(journalOutput: string, bestiaryOutput: string): Promise<void> {
    await expect(readFile(path.join(journalOutput, "stale.json"), "utf-8")).resolves.toBe("stale journal");
    await expect(readFile(path.join(bestiaryOutput, "stale.json"), "utf-8")).resolves.toBe("stale bestiary");
}

describe("canonicalizeCampaignDir", () => {
    it("keeps campaign paths beneath vault/codex", () => {
        expect(canonicalizeCampaignDir("/repo", "nested/campaign")).toBe(path.resolve("/repo/vault/codex/nested/campaign"));
    });

    it("rejects absolute and escaping campaign paths", () => {
        expect(() => canonicalizeCampaignDir("/repo", "/tmp/campaign")).toThrow("Invalid --campaign");
        expect(() => canonicalizeCampaignDir("/repo", "../campaign")).toThrow("outside vault/codex");
        expect(() => canonicalizeCampaignDir("/repo", ".")).toThrow("outside vault/codex");
        expect(() => canonicalizeCampaignDir("/repo", "..")).toThrow("outside vault/codex");
    });
});

describe("convertVault snapshots", () => {
    it("removes stale journal and bestiary sources when inputs are empty or absent", async () => {
        const root = await tempRoot();
        const journalOutput = path.join(root, "packs", "_source", "the-forge-entities");
        const bestiaryOutput = path.join(root, "packs", "_source", "the-forge-bestiary");
        await mkdir(journalOutput, { recursive: true });
        await mkdir(bestiaryOutput, { recursive: true });
        await writeFile(path.join(journalOutput, "stale.json"), "stale");
        await writeFile(path.join(bestiaryOutput, "stale.json"), "stale");

        await convertVault(OPTIONS, root);

        expect(await readdir(journalOutput)).toEqual([]);
        expect(await readdir(bestiaryOutput)).toEqual([]);
    });

    it("does not mutate stale output during dry-run", async () => {
        const root = await tempRoot();
        const journalOutput = path.join(root, "packs", "_source", "the-forge-entities");
        await mkdir(journalOutput, { recursive: true });
        await writeFile(path.join(journalOutput, "stale.json"), "stale");

        await convertVault({ ...OPTIONS, dryRun: true }, root);

        expect(await readdir(journalOutput)).toEqual(["stale.json"]);
        expect(await readFile(path.join(journalOutput, "stale.json"), "utf-8")).toBe("stale");
        await expect(readdir(path.join(root, "packs", "_source", "the-forge-bestiary"))).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("rejects campaign symlinks that escape vault/codex", async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), "sf2e-convert-vault-"));
        const outside = path.join(root, "outside");
        await mkdir(path.join(root, "vault", "codex"), { recursive: true });
        await mkdir(path.join(outside, "entities"), { recursive: true });
        await symlink(outside, path.join(root, "vault", "codex", "campaign"));

        await expect(convertVault(OPTIONS, root)).rejects.toThrow("--campaign resolves outside");
    });

    it("rejects a campaign directory swapped to an escaping symlink before source reads", async () => {
        const root = await tempRoot();
        const campaign = path.join(root, "vault", "codex", "campaign");
        const original = path.join(root, "vault", "codex", "original-campaign");
        const outside = path.join(root, "outside-campaign");
        await mkdir(path.join(outside, "entities"), { recursive: true });
        await writeFile(path.join(outside, "entities", "outside.md"), journal("Outside", true, "Outside body."));
        const { journalOutput, bestiaryOutput } = await seedLiveOutputs(root);
        let includeUnpublishedReads = 0;
        const options = {
            campaign: "campaign",
            dryRun: false,
            get includeUnpublished(): boolean {
                includeUnpublishedReads += 1;
                if (includeUnpublishedReads === 1) {
                    renameSync(campaign, original);
                    symlinkSync(outside, campaign);
                }
                return false;
            },
        };

        await expect(convertVault(options, root)).rejects.toThrow("--campaign resolves outside");
        await expectLiveOutputsPreserved(journalOutput, bestiaryOutput);
    });

    it("rejects a campaign directory swapped after source capture and preserves live outputs", async () => {
        const root = await tempRoot();
        const campaign = path.join(root, "vault", "codex", "campaign");
        const original = path.join(root, "vault", "codex", "original-campaign");
        const outside = path.join(root, "outside-campaign");
        await writeFile(path.join(campaign, "entities", "entry.md"), journal("Entry", true, "Original body."));
        await mkdir(path.join(outside, "entities"), { recursive: true });
        await writeFile(path.join(outside, "entities", "entry.md"), journal("Entry", true, "Outside body."));
        const { journalOutput, bestiaryOutput } = await seedLiveOutputs(root);
        let includeUnpublishedReads = 0;
        const options = {
            campaign: "campaign",
            dryRun: false,
            get includeUnpublished(): boolean {
                includeUnpublishedReads += 1;
                if (includeUnpublishedReads === 2) {
                    renameSync(campaign, original);
                    symlinkSync(outside, campaign);
                }
                return false;
            },
        };

        await expect(convertVault(options, root)).rejects.toThrow("--campaign resolves outside");
        await expectLiveOutputsPreserved(journalOutput, bestiaryOutput);
    });

    it("rejects a campaign directory replaced at the same path before source reads", async () => {
        const root = await tempRoot();
        const campaign = path.join(root, "vault", "codex", "campaign");
        const original = path.join(root, "vault", "codex", "original-campaign");
        const { journalOutput, bestiaryOutput } = await seedLiveOutputs(root);
        let includeUnpublishedReads = 0;
        const options = {
            campaign: "campaign",
            dryRun: false,
            get includeUnpublished(): boolean {
                includeUnpublishedReads += 1;
                if (includeUnpublishedReads === 1) {
                    renameSync(campaign, original);
                    mkdirSync(path.join(campaign, "entities"), { recursive: true });
                    writeFileSync(path.join(campaign, "entities", "replacement.md"), journal("Replacement", true, "Replacement body."));
                }
                return false;
            },
        };

        await expect(convertVault(options, root)).rejects.toThrow("--campaign identity changed");
        await expectLiveOutputsPreserved(journalOutput, bestiaryOutput);
    });

    it("validates malformed bestiary input before replacing journal output", async () => {
        const root = await tempRoot();
        const journalOutput = path.join(root, "packs", "_source", "the-forge-entities");
        const campaign = path.join(root, "vault", "codex", "campaign");
        await mkdir(path.join(campaign, "bestiary"));
        await mkdir(journalOutput, { recursive: true });
        await writeFile(path.join(journalOutput, "stale.json"), "stale");
        await writeFile(path.join(campaign, "entities", "entry.md"), journal("Entry", true, "New body."));
        await writeFile(path.join(campaign, "bestiary", "broken.md"), "---\nstatblock: true\nname: Broken\nlevel: 1\n---\n");

        await expect(convertVault(OPTIONS, root)).rejects.toThrow("broken.md: attributes");
        expect(await readdir(journalOutput)).toEqual(["stale.json"]);
    });

    it("rejects a dangling optional bestiary directory before replacing journal output", async () => {
        const root = await tempRoot();
        const journalOutput = path.join(root, "packs", "_source", "the-forge-entities");
        const campaign = path.join(root, "vault", "codex", "campaign");
        await mkdir(journalOutput, { recursive: true });
        await writeFile(path.join(journalOutput, "stale.json"), "stale");
        await symlink(path.join(campaign, "missing-bestiary"), path.join(campaign, "bestiary"));

        await expect(convertVault(OPTIONS, root)).rejects.toMatchObject({ code: "ENOENT" });
        expect(await readdir(journalOutput)).toEqual(["stale.json"]);
    });

    it("rejects a dangling bestiary markdown file before replacing journal output", async () => {
        const root = await tempRoot();
        const journalOutput = path.join(root, "packs", "_source", "the-forge-entities");
        const bestiary = path.join(root, "vault", "codex", "campaign", "bestiary");
        await mkdir(bestiary);
        await mkdir(journalOutput, { recursive: true });
        await writeFile(path.join(journalOutput, "stale.json"), "stale");
        await symlink(path.join(bestiary, "missing.md"), path.join(bestiary, "broken.md"));

        await expect(convertVault(OPTIONS, root)).rejects.toMatchObject({ code: "ENOENT" });
        expect(await readdir(journalOutput)).toEqual(["stale.json"]);
    });

    it("rejects an observed bestiary directory that disappears before promotion", async () => {
        const root = await tempRoot();
        const journalOutput = path.join(root, "packs", "_source", "the-forge-entities");
        const campaign = path.join(root, "vault", "codex", "campaign");
        const bestiary = path.join(campaign, "bestiary");
        await mkdir(bestiary);
        await mkdir(journalOutput, { recursive: true });
        await writeFile(path.join(journalOutput, "stale.json"), "stale");
        await writeFile(path.join(campaign, "entities", "entry.md"), journal("Entry", true, "New body."));
        let includeUnpublishedReads = 0;
        const options = {
            campaign: "campaign",
            dryRun: false,
            get includeUnpublished(): boolean {
                includeUnpublishedReads += 1;
                if (includeUnpublishedReads === 2) rmSync(bestiary, { recursive: true });
                return false;
            },
        };

        await expect(convertVault(options, root)).rejects.toThrow("Bestiary directory disappeared before promotion");
        expect(await readdir(journalOutput)).toEqual(["stale.json"]);
    });

    it("rejects a new bestiary markdown source before promotion", async () => {
        const root = await tempRoot();
        const journalOutput = path.join(root, "packs", "_source", "the-forge-entities");
        const campaign = path.join(root, "vault", "codex", "campaign");
        const bestiary = path.join(campaign, "bestiary");
        await mkdir(bestiary);
        await mkdir(journalOutput, { recursive: true });
        await writeFile(path.join(journalOutput, "stale.json"), "stale");
        await writeFile(path.join(campaign, "entities", "entry.md"), journal("Entry", true, "New body."));
        let includeUnpublishedReads = 0;
        const options = {
            campaign: "campaign",
            dryRun: false,
            get includeUnpublished(): boolean {
                includeUnpublishedReads += 1;
                if (includeUnpublishedReads === 2) writeFileSync(path.join(bestiary, "new.md"), "# New\n");
                return false;
            },
        };

        await expect(convertVault(options, root)).rejects.toThrow("Bestiary source set changed before promotion");
        expect(await readdir(journalOutput)).toEqual(["stale.json"]);
    });

    it("rejects a renamed bestiary markdown source before promotion", async () => {
        const root = await tempRoot();
        const journalOutput = path.join(root, "packs", "_source", "the-forge-entities");
        const campaign = path.join(root, "vault", "codex", "campaign");
        const bestiary = path.join(campaign, "bestiary");
        await mkdir(bestiary);
        await mkdir(journalOutput, { recursive: true });
        await writeFile(path.join(journalOutput, "stale.json"), "stale");
        await writeFile(path.join(campaign, "entities", "entry.md"), journal("Entry", true, "New body."));
        await writeFile(path.join(bestiary, "old.md"), "# Old\n");
        let includeUnpublishedReads = 0;
        const options = {
            campaign: "campaign",
            dryRun: false,
            get includeUnpublished(): boolean {
                includeUnpublishedReads += 1;
                if (includeUnpublishedReads === 2) renameSync(path.join(bestiary, "old.md"), path.join(bestiary, "renamed.md"));
                return false;
            },
        };

        await expect(convertVault(options, root)).rejects.toThrow("Bestiary source set changed before promotion");
        expect(await readdir(journalOutput)).toEqual(["stale.json"]);
    });

    it("rejects a deleted bestiary markdown source before promotion", async () => {
        const root = await tempRoot();
        const journalOutput = path.join(root, "packs", "_source", "the-forge-entities");
        const campaign = path.join(root, "vault", "codex", "campaign");
        const bestiary = path.join(campaign, "bestiary");
        const source = path.join(bestiary, "old.md");
        await mkdir(bestiary);
        await mkdir(journalOutput, { recursive: true });
        await writeFile(path.join(journalOutput, "stale.json"), "stale");
        await writeFile(path.join(campaign, "entities", "entry.md"), journal("Entry", true, "New body."));
        await writeFile(source, "# Old\n");
        let includeUnpublishedReads = 0;
        const options = {
            campaign: "campaign",
            dryRun: false,
            get includeUnpublished(): boolean {
                includeUnpublishedReads += 1;
                if (includeUnpublishedReads === 2) rmSync(source);
                return false;
            },
        };

        await expect(convertVault(options, root)).rejects.toThrow("Bestiary source set changed before promotion");
        expect(await readdir(journalOutput)).toEqual(["stale.json"]);
    });

    it("rejects a bestiary markdown source replaced by a broken symlink before promotion", async () => {
        const root = await tempRoot();
        const journalOutput = path.join(root, "packs", "_source", "the-forge-entities");
        const campaign = path.join(root, "vault", "codex", "campaign");
        const bestiary = path.join(campaign, "bestiary");
        const source = path.join(bestiary, "old.md");
        await mkdir(bestiary);
        await mkdir(journalOutput, { recursive: true });
        await writeFile(path.join(journalOutput, "stale.json"), "stale");
        await writeFile(path.join(campaign, "entities", "entry.md"), journal("Entry", true, "New body."));
        await writeFile(source, "# Old\n");
        let includeUnpublishedReads = 0;
        const options = {
            campaign: "campaign",
            dryRun: false,
            get includeUnpublished(): boolean {
                includeUnpublishedReads += 1;
                if (includeUnpublishedReads === 2) {
                    rmSync(source);
                    symlinkSync(path.join(bestiary, "missing.md"), source);
                }
                return false;
            },
        };

        await expect(convertVault(options, root)).rejects.toMatchObject({ code: "ENOENT" });
        expect(await readdir(journalOutput)).toEqual(["stale.json"]);
    });

    it("rejects an optional bestiary directory that appears before promotion", async () => {
        const root = await tempRoot();
        const journalOutput = path.join(root, "packs", "_source", "the-forge-entities");
        const campaign = path.join(root, "vault", "codex", "campaign");
        await mkdir(journalOutput, { recursive: true });
        await writeFile(path.join(journalOutput, "stale.json"), "stale");
        await writeFile(path.join(campaign, "entities", "entry.md"), journal("Entry", true, "New body."));
        let includeUnpublishedReads = 0;
        const options = {
            campaign: "campaign",
            dryRun: false,
            get includeUnpublished(): boolean {
                includeUnpublishedReads += 1;
                if (includeUnpublishedReads === 2) mkdirSync(path.join(campaign, "bestiary"));
                return false;
            },
        };

        await expect(convertVault(options, root)).rejects.toThrow("Bestiary source set changed before promotion");
        expect(await readdir(journalOutput)).toEqual(["stale.json"]);
    });

    it("rejects an overwritten bestiary markdown source before promotion", async () => {
        const root = await tempRoot();
        const campaign = path.join(root, "vault", "codex", "campaign");
        const bestiary = path.join(campaign, "bestiary");
        const source = path.join(bestiary, "old.md");
        await mkdir(bestiary);
        const { journalOutput, bestiaryOutput } = await seedLiveOutputs(root);
        await writeFile(source, "# Old\n");
        let includeUnpublishedReads = 0;
        const options = {
            campaign: "campaign",
            dryRun: false,
            get includeUnpublished(): boolean {
                includeUnpublishedReads += 1;
                if (includeUnpublishedReads === 2) writeFileSync(source, "# Changed\n");
                return false;
            },
        };

        await expect(convertVault(options, root)).rejects.toThrow("Bestiary source content changed before promotion: old.md");
        await expectLiveOutputsPreserved(journalOutput, bestiaryOutput);
    });

    it("rejects an entity directory replaced at the same path before promotion", async () => {
        const root = await tempRoot();
        const entities = path.join(root, "vault", "codex", "campaign", "entities");
        const displaced = path.join(root, "vault", "codex", "campaign", "displaced-entities");
        const { journalOutput, bestiaryOutput } = await seedLiveOutputs(root);
        const content = journal("Entry", true, "Original body.");
        await writeFile(path.join(entities, "entry.md"), content);
        let includeUnpublishedReads = 0;
        const options = {
            campaign: "campaign",
            dryRun: false,
            get includeUnpublished(): boolean {
                includeUnpublishedReads += 1;
                if (includeUnpublishedReads === 2) {
                    renameSync(entities, displaced);
                    mkdirSync(entities);
                    writeFileSync(path.join(entities, "entry.md"), content);
                }
                return false;
            },
        };

        await expect(convertVault(options, root)).rejects.toThrow("entities directory identity changed");
        await expectLiveOutputsPreserved(journalOutput, bestiaryOutput);
    });

    it("rejects an entity markdown source replaced at the same path before promotion", async () => {
        const root = await tempRoot();
        const source = path.join(root, "vault", "codex", "campaign", "entities", "entry.md");
        const displaced = path.join(root, "vault", "codex", "campaign", "entities", "displaced.txt");
        const { journalOutput, bestiaryOutput } = await seedLiveOutputs(root);
        const content = journal("Entry", true, "Original body.");
        await writeFile(source, content);
        let includeUnpublishedReads = 0;
        const options = {
            campaign: "campaign",
            dryRun: false,
            get includeUnpublished(): boolean {
                includeUnpublishedReads += 1;
                if (includeUnpublishedReads === 2) {
                    renameSync(source, displaced);
                    writeFileSync(source, content);
                }
                return false;
            },
        };

        await expect(convertVault(options, root)).rejects.toThrow("entry.md identity changed");
        await expectLiveOutputsPreserved(journalOutput, bestiaryOutput);
    });

    it("rejects an overwritten entity markdown source before promotion", async () => {
        const root = await tempRoot();
        const source = path.join(root, "vault", "codex", "campaign", "entities", "entry.md");
        const { journalOutput, bestiaryOutput } = await seedLiveOutputs(root);
        await writeFile(source, journal("Entry", true, "Original body."));
        let includeUnpublishedReads = 0;
        const options = {
            campaign: "campaign",
            dryRun: false,
            get includeUnpublished(): boolean {
                includeUnpublishedReads += 1;
                if (includeUnpublishedReads === 2) writeFileSync(source, journal("Entry", true, "Changed body."));
                return false;
            },
        };

        await expect(convertVault(options, root)).rejects.toThrow("Entities source content changed before promotion: entry.md");
        await expectLiveOutputsPreserved(journalOutput, bestiaryOutput);
    });

    it.each(["added", "deleted", "renamed"])("rejects an %s entity markdown source before promotion", async (change) => {
        const root = await tempRoot();
        const entities = path.join(root, "vault", "codex", "campaign", "entities");
        const source = path.join(entities, "entry.md");
        const { journalOutput, bestiaryOutput } = await seedLiveOutputs(root);
        await writeFile(source, journal("Entry", true, "Original body."));
        let includeUnpublishedReads = 0;
        const options = {
            campaign: "campaign",
            dryRun: false,
            get includeUnpublished(): boolean {
                includeUnpublishedReads += 1;
                if (includeUnpublishedReads === 2) {
                    if (change === "added") writeFileSync(path.join(entities, "new.md"), journal("New", true, "New body."));
                    if (change === "deleted") rmSync(source);
                    if (change === "renamed") renameSync(source, path.join(entities, "renamed.md"));
                }
                return false;
            },
        };

        await expect(convertVault(options, root)).rejects.toThrow("Entities source set changed before promotion");
        await expectLiveOutputsPreserved(journalOutput, bestiaryOutput);
    });

    it("rejects an entity markdown source replaced by a broken symlink before promotion", async () => {
        const root = await tempRoot();
        const entities = path.join(root, "vault", "codex", "campaign", "entities");
        const source = path.join(entities, "entry.md");
        const { journalOutput, bestiaryOutput } = await seedLiveOutputs(root);
        await writeFile(source, journal("Entry", true, "Original body."));
        let includeUnpublishedReads = 0;
        const options = {
            campaign: "campaign",
            dryRun: false,
            get includeUnpublished(): boolean {
                includeUnpublishedReads += 1;
                if (includeUnpublishedReads === 2) {
                    rmSync(source);
                    symlinkSync(path.join(entities, "missing.md"), source);
                }
                return false;
            },
        };

        await expect(convertVault(options, root)).rejects.toMatchObject({ code: "ENOENT" });
        await expectLiveOutputsPreserved(journalOutput, bestiaryOutput);
    });

    it("rejects an entity directory replaced by an escaping symlink before promotion", async () => {
        const root = await tempRoot();
        const entities = path.join(root, "vault", "codex", "campaign", "entities");
        const outside = path.join(root, "outside-entities");
        const { journalOutput, bestiaryOutput } = await seedLiveOutputs(root);
        await writeFile(path.join(entities, "entry.md"), journal("Entry", true, "Original body."));
        await mkdir(outside);
        await writeFile(path.join(outside, "entry.md"), journal("Entry", true, "Outside body."));
        let includeUnpublishedReads = 0;
        const options = {
            campaign: "campaign",
            dryRun: false,
            get includeUnpublished(): boolean {
                includeUnpublishedReads += 1;
                if (includeUnpublishedReads === 2) {
                    rmSync(entities, { recursive: true });
                    symlinkSync(outside, entities);
                }
                return false;
            },
        };

        await expect(convertVault(options, root)).rejects.toThrow("entities directory resolves outside");
        await expectLiveOutputsPreserved(journalOutput, bestiaryOutput);
    });

    it("rejects the source output parent replaced at the same path after trust is established", async () => {
        const root = await tempRoot();
        const campaign = path.join(root, "vault", "codex", "campaign");
        const sourceRoot = path.join(root, "packs", "_source");
        const originalSourceRoot = path.join(root, "packs", "original-source");
        await writeFile(path.join(campaign, "entities", "entry.md"), journal("Entry", true, "Original body."));
        await seedLiveOutputs(root);
        let includeUnpublishedReads = 0;
        const options = {
            campaign: "campaign",
            dryRun: false,
            get includeUnpublished(): boolean {
                includeUnpublishedReads += 1;
                if (includeUnpublishedReads === 2) {
                    renameSync(sourceRoot, originalSourceRoot);
                    mkdirSync(sourceRoot);
                    writeFileSync(path.join(sourceRoot, "replacement-marker"), "untouched");
                }
                return false;
            },
        };

        await expect(convertVault(options, root)).rejects.toThrow("Snapshot parent identity changed");
        expect(await readFile(path.join(sourceRoot, "replacement-marker"), "utf-8")).toBe("untouched");
        await expectLiveOutputsPreserved(
            path.join(originalSourceRoot, "the-forge-entities"),
            path.join(originalSourceRoot, "the-forge-bestiary"),
        );
    });

    it("recovers an interrupted coordinated source promotion before conversion proceeds", async () => {
        const root = await tempRoot();
        const sourceRoot = path.join(root, "packs", "_source");
        const transaction = "12345678-1234-4123-8123-123456789abc";
        const entityStage = `.the-forge-entities.stage-${transaction}`;
        const bestiaryStage = `.the-forge-bestiary.stage-${transaction}`;
        const entityBackup = `.the-forge-entities.backup-${transaction}`;
        await mkdir(path.join(sourceRoot, entityBackup), { recursive: true });
        await mkdir(path.join(sourceRoot, entityStage));
        await mkdir(path.join(sourceRoot, bestiaryStage));
        await mkdir(path.join(sourceRoot, "the-forge-bestiary"));
        await writeFile(path.join(sourceRoot, entityBackup, "old.json"), "old entities");
        await writeFile(path.join(sourceRoot, entityStage, "new.json"), "new entities");
        await writeFile(path.join(sourceRoot, bestiaryStage, "new.json"), "new bestiary");
        await mkdir(path.join(root, "vault", "codex", "campaign", "bestiary"));
        await writeFile(path.join(root, "vault", "codex", "campaign", "bestiary", "broken.md"), "---\nstatblock: true\nname: Broken\nlevel: 1\n---\n");
        await writeFile(path.join(sourceRoot, ".source-snapshot-promotion.json"), JSON.stringify({
            version: 1,
            transaction,
            committed: false,
            entries: [
                { liveBasename: "the-forge-entities", stageBasename: entityStage, backupBasename: entityBackup, hadLive: true, moved: true, promoted: false },
                { liveBasename: "the-forge-bestiary", stageBasename: bestiaryStage, backupBasename: `.the-forge-bestiary.backup-${transaction}`, hadLive: true, moved: false, promoted: false },
            ],
        }));

        await expect(convertVault(OPTIONS, root)).rejects.toThrow("broken.md: attributes");
        expect(await readFile(path.join(sourceRoot, "the-forge-entities", "old.json"), "utf-8")).toBe("old entities");
        expect(await readdir(sourceRoot)).toEqual(["the-forge-bestiary", "the-forge-entities"]);
    });
    it("refuses unsafe interrupted source promotion journal paths", async () => {
        const root = await tempRoot();
        const sourceRoot = path.join(root, "packs", "_source");
        const transaction = "12345678-1234-4123-8123-123456789abc";
        const { journalOutput, bestiaryOutput } = await seedLiveOutputs(root);
        await writeFile(path.join(root, "outside"), "untouched");
        await writeFile(path.join(sourceRoot, ".source-snapshot-promotion.json"), JSON.stringify({
            version: 1,
            transaction,
            committed: false,
            entries: [{
                liveBasename: "the-forge-entities",
                stageBasename: "../outside",
                backupBasename: `.the-forge-entities.backup-${transaction}`,
                hadLive: true,
                moved: false,
                promoted: false,
            }],
        }));

        await expect(convertVault(OPTIONS, root)).rejects.toThrow("Unsafe snapshot transaction basename");
        expect(await readFile(path.join(root, "outside"), "utf-8")).toBe("untouched");
        await expectLiveOutputsPreserved(journalOutput, bestiaryOutput);
    });

    it("rejects the source output parent swapped to a symlink after trust is established", async () => {
        const root = await tempRoot();
        const campaign = path.join(root, "vault", "codex", "campaign");
        const sourceRoot = path.join(root, "packs", "_source");
        const originalSourceRoot = path.join(root, "packs", "original-source");
        const outside = await mkdtemp(path.join(os.tmpdir(), "sf2e-convert-output-swap-"));
        await writeFile(path.join(campaign, "entities", "entry.md"), journal("Entry", true, "Original body."));
        await seedLiveOutputs(root);
        let includeUnpublishedReads = 0;
        const options = {
            campaign: "campaign",
            dryRun: false,
            get includeUnpublished(): boolean {
                includeUnpublishedReads += 1;
                if (includeUnpublishedReads === 2) {
                    renameSync(sourceRoot, originalSourceRoot);
                    symlinkSync(outside, sourceRoot);
                }
                return false;
            },
        };

        await expect(convertVault(options, root)).rejects.toThrow("Snapshot parent identity changed");
        expect(await readdir(outside)).toEqual([]);
        await expectLiveOutputsPreserved(
            path.join(originalSourceRoot, "the-forge-entities"),
            path.join(originalSourceRoot, "the-forge-bestiary"),
        );
    });


    it("rejects output ancestors symlinked outside the repository", async () => {
        const root = await tempRoot();
        const outside = await mkdtemp(path.join(os.tmpdir(), "sf2e-convert-output-"));
        await mkdir(path.join(root, "packs"));
        await symlink(outside, path.join(root, "packs", "_source"));
        await writeFile(path.join(outside, "stale.json"), "stale");

        await expect(convertVault(OPTIONS, root)).rejects.toThrow("Output directory contains a symlink");
        expect(await readFile(path.join(outside, "stale.json"), "utf-8")).toBe("stale");
    });

    it("rejects output ancestors symlinked elsewhere inside the repository", async () => {
        const root = await tempRoot();
        const unrelated = path.join(root, "unrelated");
        await mkdir(path.join(root, "packs"));
        await mkdir(unrelated);
        await symlink(unrelated, path.join(root, "packs", "_source"));

        await expect(convertVault(OPTIONS, root)).rejects.toThrow("Output directory contains a symlink");
    });

    it("rejects published links to known drafts but resolves them when drafts are included", async () => {
        const root = await tempRoot();
        const entities = path.join(root, "vault", "codex", "campaign", "entities");
        await writeFile(path.join(entities, "published.md"), journal("Published", true, "See [[draft]]."));
        await writeFile(path.join(entities, "draft.md"), journal("Draft", false, "Draft body."));

        await expect(convertVault(OPTIONS, root)).rejects.toThrow('published.md: wikilink targets unpublished entity "draft"');
        await convertVault({ ...OPTIONS, includeUnpublished: true }, root);

        const output = path.join(root, "packs", "_source", "the-forge-entities");
        const files = (await readdir(output)).filter((filename) => !filename.startsWith("folder-"));
        const contents = await Promise.all(files.map((filename) => readFile(path.join(output, filename), "utf-8")));
        expect(contents.join("\n")).toContain("Compendium.sf2e-forge-custom.the-forge-entities.JournalEntry.");
    });
});
