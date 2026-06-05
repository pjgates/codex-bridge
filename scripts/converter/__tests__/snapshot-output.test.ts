import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recoverSourceSnapshotPromotion, recoverSourceSnapshotPromotionSync } from "../snapshot-output.js";

const temporaryRoots: string[] = [];
const JOURNAL_FILE = ".source-snapshot-promotion.json";
const JOURNAL_TEMP_FILE = `${JOURNAL_FILE}.tmp`;

async function temporarySourceRoot(): Promise<{ root: string; sourceRoot: string }> {
    const root = await mkdtemp(path.join(os.tmpdir(), "sf2e-snapshot-recovery-"));
    temporaryRoots.push(root);
    const sourceRoot = path.join(root, "packs", "_source");
    await mkdir(sourceRoot, { recursive: true });
    return { root, sourceRoot };
}

function journal(transaction: string, stageBasename: string, committed = false): string {
    return JSON.stringify({
        version: 1,
        transaction,
        committed,
        entries: [{
            liveBasename: "alpha",
            stageBasename,
            backupBasename: `.alpha.backup-${transaction}`,
            hadLive: true,
            moved: true,
            promoted: true,
        }],
    });
}

const recoveries: Array<{ name: string; recover: (sourceRoot: string) => Promise<void> }> = [
    { name: "async", recover: recoverSourceSnapshotPromotion },
    { name: "sync", recover: async (sourceRoot) => recoverSourceSnapshotPromotionSync(sourceRoot) },
];

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe.each(recoveries)("$name source snapshot recovery", ({ recover }) => {
    it("removes a lone unpublished temporary journal", async () => {
        const { sourceRoot } = await temporarySourceRoot();
        await writeFile(path.join(sourceRoot, JOURNAL_TEMP_FILE), "interrupted journal publication");

        await recover(sourceRoot);

        expect(await readdir(sourceRoot)).toEqual([]);
    });

    it("resolves the published journal before removing a newer temporary journal", async () => {
        const { sourceRoot } = await temporarySourceRoot();
        const transaction = "11111111-1111-4111-8111-111111111111";
        const stageBasename = ".alpha.stage-22222222-2222-4222-8222-222222222222";
        const live = path.join(sourceRoot, "alpha");
        const backup = path.join(sourceRoot, `.alpha.backup-${transaction}`);
        await mkdir(live);
        await mkdir(backup);
        await mkdir(path.join(sourceRoot, stageBasename));
        await writeFile(path.join(live, "marker"), "new source");
        await writeFile(path.join(backup, "marker"), "old source");
        await writeFile(path.join(sourceRoot, JOURNAL_FILE), journal(transaction, stageBasename));
        await writeFile(
            path.join(sourceRoot, JOURNAL_TEMP_FILE),
            journal("33333333-3333-4333-8333-333333333333", ".alpha.stage-44444444-4444-4444-8444-444444444444", true),
        );

        await recover(sourceRoot);

        expect(await readdir(sourceRoot)).toEqual(["alpha"]);
        expect(await readFile(path.join(live, "marker"), "utf-8")).toBe("old source");
    });

    it("refuses an unsafe temporary journal path", async () => {
        const { root, sourceRoot } = await temporarySourceRoot();
        const outside = path.join(root, "outside");
        await writeFile(outside, "preserve me");
        await symlink(outside, path.join(sourceRoot, JOURNAL_TEMP_FILE), "file");

        await expect(recover(sourceRoot)).rejects.toThrow("Refusing invalid source snapshot promotion temporary journal");

        expect(await readFile(outside, "utf-8")).toBe("preserve me");
        expect(await readdir(sourceRoot)).toEqual([JOURNAL_TEMP_FILE]);
    });

    it("refuses a temporary journal directory", async () => {
        const { sourceRoot } = await temporarySourceRoot();
        await mkdir(path.join(sourceRoot, JOURNAL_TEMP_FILE));

        await expect(recover(sourceRoot)).rejects.toThrow("Refusing invalid source snapshot promotion temporary journal");

        expect(await readdir(sourceRoot)).toEqual([JOURNAL_TEMP_FILE]);
    });
});
