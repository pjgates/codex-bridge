import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withSnapshotRollback, writeSnapshot } from "../snapshot-output.js";
import { buildFolders } from "../folders.js";
import type { ParsedEntity } from "../types.js";
import { writeBestiaryPack } from "../bestiary-write.js";
import { writePack } from "../write.js";

async function tempDir(): Promise<string> {
    return mkdtemp(path.join(os.tmpdir(), "sf2e-converter-"));
}

function entityWithType(type: string): ParsedEntity {
    return {
        slug: type,
        frontmatter: {
            title: type,
            type,
            tags: [],
            depth: 0,
            status: "",
            aliases: [],
            creation_date: "",
            campaign: [],
            published: true,
        },
        playerContent: "",
        gmContent: null,
    };
}

describe("writeSnapshot", () => {
    it("replaces stale live output with the planned snapshot", async () => {
        const root = await tempDir();
        const live = path.join(root, "pack");
        await mkdir(live);
        await writeFile(path.join(live, "stale.json"), "stale");

        await writeSnapshot(live, [{ basename: "current.json", content: "current" }], false);

        expect(await readdir(live)).toEqual(["current.json"]);
        expect(await readFile(path.join(live, "current.json"), "utf-8")).toBe("current");
    });

    it("promotes an empty snapshot so stale output cannot ship", async () => {
        const root = await tempDir();
        const live = path.join(root, "pack");
        await mkdir(live);
        await writeFile(path.join(live, "stale.json"), "stale");

        await writeSnapshot(live, [], false);

        expect(await readdir(live)).toEqual([]);
    });

    it("is strictly read-only in dry-run mode", async () => {
        const root = await tempDir();
        const live = path.join(root, "missing-parent", "pack");

        await writeSnapshot(live, [{ basename: "current.json", content: "current" }], true);

        await expect(readdir(path.dirname(live))).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("resolves lazy content only when writing", async () => {
        const root = await tempDir();
        const live = path.join(root, "pack");
        let serializations = 0;
        const content = () => {
            serializations += 1;
            return "current";
        };

        await writeSnapshot(live, [{ basename: "current.json", content }], true);
        expect(serializations).toBe(0);

        await writeSnapshot(live, [{ basename: "current.json", content }], false);
        expect(serializations).toBe(1);
        expect(await readFile(path.join(live, "current.json"), "utf-8")).toBe("current");
    });

    it("rejects unsafe and duplicate basenames before writing", async () => {
        const root = await tempDir();
        const live = path.join(root, "pack");

        await expect(writeSnapshot(live, [{ basename: "../escape.json", content: "no" }], false))
            .rejects.toThrow("Unsafe snapshot basename");
        await expect(writeSnapshot(live, [
            { basename: "same.json", content: "first" },
            { basename: "same.json", content: "second" },
        ], false)).rejects.toThrow("Duplicate snapshot basename");
        await expect(readdir(root)).resolves.toEqual([]);
    });
});

describe("withSnapshotRollback", () => {
    it("restores every live output when a coordinated promotion fails", async () => {
        const root = await tempDir();
        const first = path.join(root, "first");
        const second = path.join(root, "second");
        await mkdir(first);
        await mkdir(second);
        await writeFile(path.join(first, "old.json"), "first-old");
        await writeFile(path.join(second, "old.json"), "second-old");

        await expect(withSnapshotRollback(async (snapshotWriter) => {
            await snapshotWriter(first, [{ basename: "new.json", content: "first-new" }], false);
            await snapshotWriter(second, [{ basename: "new.json", content: "second-new" }], false);
            expect(await readdir(first)).toEqual(["old.json"]);
            expect(await readdir(second)).toEqual(["old.json"]);
            const secondStage = (await readdir(root)).find((filename) => filename.startsWith(".second.stage-"));
            if (!secondStage) throw new Error("missing second staging directory");
            await rm(path.join(root, secondStage), { recursive: true });
        })).rejects.toMatchObject({ code: "ENOENT" });

        expect(await readdir(first)).toEqual(["old.json"]);
        expect(await readdir(second)).toEqual(["old.json"]);
    });

    it("keeps a committed promotion successful when backup cleanup fails", async () => {
        const root = await tempDir();
        const live = path.join(root, "pack");
        const cleanupError = new Error("cleanup denied");
        let retainedBackup = "";
        let warning: { backupDir: string; error: unknown } | undefined;
        await mkdir(live);
        await writeFile(path.join(live, "old.json"), "old");

        await expect(withSnapshotRollback(async (snapshotWriter) => {
            await snapshotWriter(live, [{ basename: "new.json", content: "new" }], false);
        }, undefined, {
            removeBackup: async (backupDir) => {
                retainedBackup = backupDir;
                throw cleanupError;
            },
            onBackupCleanupError: (backupDir, error) => {
                warning = { backupDir, error };
            },
        })).resolves.toBeUndefined();

        expect(await readFile(path.join(live, "new.json"), "utf-8")).toBe("new");
        expect(await readFile(path.join(retainedBackup, "old.json"), "utf-8")).toBe("old");
        expect(warning).toEqual({ backupDir: retainedBackup, error: cleanupError });
    });
});

describe("buildFolders", () => {
    it("assigns numeric fallback sorts to Object prototype type names", () => {
        const folders = buildFolders([entityWithType("constructor"), entityWithType("__proto__")]);

        expect(folders.map(({ name, sort }) => [name, sort])).toEqual([
            ["__proto__s", 1000000],
            ["constructors", 1100000],
        ]);
    });
});

describe("writePack", () => {
    it("names source files from deterministic document and folder ids", async () => {
        const root = await tempDir();
        const live = path.join(root, "pack");

        await writePack(live, [{ slug: "display-slug", json: { _id: "1234567890abcdef" } }], [{
            _id: "fedcba0987654321",
            _key: "!folders!fedcba0987654321",
            name: "Display Name That Must Not Become A Path",
            type: "JournalEntry",
            sort: 100000,
        }], false);

        expect(await readdir(live)).toEqual(["1234567890abcdef.json", "folder-fedcba0987654321.json"]);
    });

    it("does not serialize journal documents during dry-run", async () => {
        const root = await tempDir();
        const live = path.join(root, "pack");
        const json = {
            _id: "1234567890abcdef",
            toJSON(): never {
                throw new Error("serialized");
            },
        };

        await expect(writePack(live, [{ slug: "display-slug", json }], [], true)).resolves.toBeUndefined();
    });
});

describe("writeBestiaryPack", () => {
    it("does not serialize actor documents during dry-run", async () => {
        const root = await tempDir();
        const live = path.join(root, "pack");
        const json = {
            _id: "1234567890abcdef",
            toJSON(): never {
                throw new Error("serialized");
            },
        };

        await expect(writeBestiaryPack(live, [{ slug: "display-slug", json }], true)).resolves.toBeUndefined();
    });
});
