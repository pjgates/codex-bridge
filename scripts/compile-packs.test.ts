import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireBuildLock, releaseBuildLock, type BuildLock } from "./build-lock.js";
import { compileConfiguredPacks, type PackDef } from "./compile-packs.js";
import { establishSnapshotParentTrust, writeSnapshot } from "./converter/snapshot-output.js";

const temporaryRoots: string[] = [];
const packs: PackDef[] = [
    { name: "alpha", path: "packs/alpha", type: "JournalEntry" },
    { name: "beta", path: "packs/beta", type: "Actor" },
];
const originalFoundryOffline = process.env.SF2E_FOUNDRY_OFFLINE;

afterEach(() => {
    for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
    if (originalFoundryOffline === undefined) delete process.env.SF2E_FOUNDRY_OFFLINE;
    else process.env.SF2E_FOUNDRY_OFFLINE = originalFoundryOffline;
});

describe("compileConfiguredPacks", () => {
    it("leaves every live pack untouched when a later compilation fails", () => {
        const root = makeRoot();
        seedSource(root, "alpha");
        seedSource(root, "beta");
        seedLive(root, "alpha", "old alpha");
        seedLive(root, "beta", "old beta");

        expect(() =>
            compileConfiguredPacks({
                rootDirectory: root,
                packs,
                dependencies: {
                    run: (_command, args) => {
                        const name = packName(args);
                        if (name === "beta") throw new Error("compile failed");
                        writeCompiledPack(args, `new ${name}`);
                    },
                    log: () => undefined,
                },
            }),
        ).toThrow("compile failed");

        expect(readLive(root, "alpha")).toBe("old alpha");
        expect(readLive(root, "beta")).toBe("old beta");
        expect(transientRoots(root)).toEqual([]);
    });

    it("restores every prior live pack in reverse order when promotion fails", () => {
        const root = makeRoot();
        seedSource(root, "alpha");
        seedSource(root, "beta");
        seedLive(root, "alpha", "old alpha");
        seedLive(root, "beta", "old beta");
        process.env.SF2E_FOUNDRY_OFFLINE = "1";
        const restoreOrder: string[] = [];

        expect(() =>
            compileConfiguredPacks({
                rootDirectory: root,
                packs,
                dependencies: {
                    run: (_command, args) => writeCompiledPack(args, `new ${packName(args)}`),
                    moveDirectory: (from, to) => {
                        if (from.includes(".compile-stage-") && from.endsWith(`${path.sep}beta`)) {
                            throw new Error("promotion failed");
                        }
                        if (from.includes(".compile-backup-")) restoreOrder.push(path.basename(from));
                        renameSync(from, to);
                    },
                    log: () => undefined,
                },
            }),
        ).toThrow("promotion failed");

        expect(readLive(root, "alpha")).toBe("old alpha");
        expect(readLive(root, "beta")).toBe("old beta");
        expect(restoreOrder).toEqual(["beta", "alpha"]);
        expect(transientRoots(root)).toEqual([]);
        expect(existsSync(path.join(root, "packs", ".compile-lock"))).toBe(false);
    });

    it("retains backups for manual recovery when automatic restoration fails", () => {
        const root = makeRoot();
        seedSource(root, "alpha");
        seedSource(root, "beta");
        seedLive(root, "alpha", "old alpha");
        seedLive(root, "beta", "old beta");
        process.env.SF2E_FOUNDRY_OFFLINE = "1";

        expect(() =>
            compileConfiguredPacks({
                rootDirectory: root,
                packs,
                dependencies: {
                    run: (_command, args) => writeCompiledPack(args, `new ${packName(args)}`),
                    moveDirectory: (from, to) => {
                        if (from.includes(".compile-stage-") && from.endsWith(`${path.sep}beta`)) {
                            throw new Error("promotion failed");
                        }
                        renameSync(from, to);
                    },
                    removeDirectory: (directory) => {
                        if (directory === path.join(root, "packs", "alpha")) throw new Error("restore removal failed");
                        rmSync(directory, { recursive: true, force: true });
                    },
                    log: () => undefined,
                },
            }),
        ).toThrow("prior live packs remain under");

        const remainingRoots = transientRoots(root);
        expect(remainingRoots).toHaveLength(1);
        const [backupRoot] = remainingRoots;
        expect(backupRoot).toMatch(/^\.compile-backup-/);
        expect(readFileSync(path.join(root, "packs", backupRoot, "alpha", "marker"), "utf-8")).toBe("old alpha");
        expect(existsSync(path.join(root, "packs", ".compile-lock"))).toBe(false);
    });

    it("refuses to compile while another process owns the atomic build lock", () => {
        const root = makeRoot();
        const packsDirectory = path.join(root, "packs");
        seedSource(root, "alpha");
        seedLive(root, "alpha", "old alpha");
        const activeLock = acquireBuildLock(packsDirectory);
        let compiled = false;

        expect(() =>
            compileConfiguredPacks({
                rootDirectory: root,
                packs: [packs[0]],
                dependencies: {
                    run: () => { compiled = true; },
                    log: () => undefined,
                },
            }),
        ).toThrow("Build publication appears owned");

        expect(compiled).toBe(false);
        expect(readLive(root, "alpha")).toBe("old alpha");
        expect(transientRoots(root)).toEqual([]);
        expect(existsSync(path.join(root, "packs", ".compile-lock"))).toBe(true);
        releaseBuildLock(activeLock);
    });

    it("recovers a seeded interrupted multi-pack promotion while owning the reclaimed build lock", () => {
        const root = makeRoot();
        const packsDirectory = path.join(root, "packs");
        const stagingRoot = path.join(packsDirectory, ".compile-stage-seeded");
        const backupRoot = path.join(packsDirectory, ".compile-backup-seeded");
        seedLive(root, "alpha", "new alpha");
        mkdirSync(path.join(stagingRoot, "beta"), { recursive: true });
        writeFileSync(path.join(stagingRoot, "beta", "marker"), "new beta");
        mkdirSync(path.join(backupRoot, "alpha"), { recursive: true });
        mkdirSync(path.join(backupRoot, "beta"), { recursive: true });
        writeFileSync(path.join(backupRoot, "alpha", "marker"), "old alpha");
        writeFileSync(path.join(backupRoot, "beta", "marker"), "old beta");
        writeFileSync(path.join(packsDirectory, ".compile-lock"), JSON.stringify({
            version: 2,
            pid: 2_147_483_647,
            processStartIdentity: "dead-process",
            token: "dead-owner",
            acquiredAt: new Date(0).toISOString(),
        }));
        writeFileSync(path.join(packsDirectory, ".compile-promotion.json"), JSON.stringify({
            version: 2,
            transaction: "seeded",
            committed: false,
            entries: [
                { name: "alpha", path: "packs/alpha", hadLive: true, backedUp: true, promoted: true },
                { name: "beta", path: "packs/beta", hadLive: true, backedUp: true, promoted: false },
            ],
        }));
        process.env.SF2E_FOUNDRY_OFFLINE = "1";

        expect(compileConfiguredPacks({ rootDirectory: root, packs, dependencies: { log: () => undefined } }))
            .toEqual({ compiled: 0, skipped: 2 });

        expect(readLive(root, "alpha")).toBe("old alpha");
        expect(readLive(root, "beta")).toBe("old beta");
        expect(transientRoots(root)).toEqual([]);
        expect(existsSync(path.join(packsDirectory, ".compile-promotion.json"))).toBe(false);
        expect(existsSync(path.join(packsDirectory, ".compile-lock"))).toBe(false);
    });

    it("recovers a compiler promotion before reading a malformed current manifest", () => {
        const root = makeRoot();
        const packsDirectory = path.join(root, "packs");
        const stagingRoot = path.join(packsDirectory, ".compile-stage-seeded");
        const backupRoot = path.join(packsDirectory, ".compile-backup-seeded");
        seedLive(root, "alpha", "new alpha");
        mkdirSync(path.join(stagingRoot, "alpha"), { recursive: true });
        mkdirSync(path.join(backupRoot, "alpha"), { recursive: true });
        writeFileSync(path.join(backupRoot, "alpha", "marker"), "old alpha");
        writeFileSync(path.join(packsDirectory, ".compile-promotion.json"), JSON.stringify({
            version: 2,
            transaction: "seeded",
            committed: false,
            entries: [{ name: "alpha", path: "packs/alpha", hadLive: true, backedUp: true, promoted: true }],
        }));
        writeFileSync(path.join(root, "module.json"), "{ malformed");
        process.env.SF2E_FOUNDRY_OFFLINE = "1";

        expect(() => compileConfiguredPacks({ rootDirectory: root, dependencies: { log: () => undefined } })).toThrow();

        expect(readLive(root, "alpha")).toBe("old alpha");
        expect(existsSync(path.join(packsDirectory, ".compile-promotion.json"))).toBe(false);
        expect(transientRoots(root)).toEqual([]);
        expect(existsSync(path.join(packsDirectory, ".compile-lock"))).toBe(false);
    });

    it("removes an interrupted converter journal publication before compilation", () => {
        const root = makeRoot();
        const sourceRoot = path.join(root, "packs", "_source");
        const temporaryJournal = path.join(sourceRoot, ".source-snapshot-promotion.json.tmp");
        mkdirSync(sourceRoot);
        writeFileSync(temporaryJournal, "interrupted journal publication");

        expect(compileConfiguredPacks({ rootDirectory: root, packs: [], dependencies: { log: () => undefined } }))
            .toEqual({ compiled: 0, skipped: 0 });

        expect(existsSync(temporaryJournal)).toBe(false);
    });

    it("recovers a split converter source generation before compilation can proceed", () => {
        const root = makeRoot();
        const sourceRoot = path.join(root, "packs", "_source");
        const transaction = "11111111-1111-4111-8111-111111111111";
        const stageId = "22222222-2222-4222-8222-222222222222";
        const live = path.join(sourceRoot, "alpha");
        const backup = path.join(sourceRoot, `.alpha.backup-${transaction}`);
        const stage = path.join(sourceRoot, `.alpha.stage-${stageId}`);
        mkdirSync(live, { recursive: true });
        mkdirSync(backup, { recursive: true });
        mkdirSync(stage, { recursive: true });
        writeFileSync(path.join(live, "marker"), "new source");
        writeFileSync(path.join(backup, "marker"), "old source");
        writeFileSync(path.join(sourceRoot, ".source-snapshot-promotion.json"), JSON.stringify({
            version: 1,
            transaction,
            committed: false,
            entries: [{ liveBasename: "alpha", stageBasename: path.basename(stage), backupBasename: path.basename(backup), hadLive: true, moved: true, promoted: true }],
        }));

        expect(compileConfiguredPacks({ rootDirectory: root, packs: [], dependencies: { log: () => undefined } }))
            .toEqual({ compiled: 0, skipped: 0 });

        expect(readFileSync(path.join(live, "marker"), "utf8")).toBe("old source");
        expect(existsSync(backup)).toBe(false);
        expect(existsSync(stage)).toBe(false);
        expect(existsSync(path.join(sourceRoot, ".source-snapshot-promotion.json"))).toBe(false);
    });

    it("finishes source recovery after a prior recovery already restored the backup", () => {
        const root = makeRoot();
        const sourceRoot = path.join(root, "packs", "_source");
        const transaction = "11111111-1111-4111-8111-111111111111";
        const stageId = "22222222-2222-4222-8222-222222222222";
        const live = path.join(sourceRoot, "alpha");
        const stage = path.join(sourceRoot, `.alpha.stage-${stageId}`);
        mkdirSync(live, { recursive: true });
        mkdirSync(stage, { recursive: true });
        writeFileSync(path.join(live, "marker"), "restored old source");
        writeFileSync(path.join(sourceRoot, ".source-snapshot-promotion.json"), JSON.stringify({
            version: 1,
            transaction,
            committed: false,
            entries: [{ liveBasename: "alpha", stageBasename: path.basename(stage), backupBasename: `.alpha.backup-${transaction}`, hadLive: true, moved: true, promoted: true }],
        }));

        expect(compileConfiguredPacks({ rootDirectory: root, packs: [], dependencies: { log: () => undefined } }))
            .toEqual({ compiled: 0, skipped: 0 });

        expect(readFileSync(path.join(live, "marker"), "utf8")).toBe("restored old source");
        expect(existsSync(stage)).toBe(false);
        expect(existsSync(path.join(sourceRoot, ".source-snapshot-promotion.json"))).toBe(false);
    });

    it("refuses to compile while a source promotion journal is invalid and unresolved", () => {
        const root = makeRoot();
        seedSource(root, "alpha");
        writeFileSync(path.join(root, "packs", "_source", ".source-snapshot-promotion.json"), "{ malformed");
        let compiled = false;

        expect(() => compileConfiguredPacks({
            rootDirectory: root,
            packs: [packs[0]],
            dependencies: { run: () => { compiled = true; }, log: () => undefined },
        })).toThrow("Refusing invalid source snapshot promotion journal");

        expect(compiled).toBe(false);
        expect(existsSync(path.join(root, "packs", "_source", ".source-snapshot-promotion.json"))).toBe(true);
    });

    it("cleans a directly staged snapshot when an unresolved source journal refuses promotion", async () => {
        const root = makeRoot();
        const sourceRoot = path.join(root, "packs", "_source");
        mkdirSync(sourceRoot);
        writeFileSync(path.join(sourceRoot, ".source-snapshot-promotion.json"), "{}");
        const trust = await establishSnapshotParentTrust(sourceRoot);

        await expect(writeSnapshot(
            path.join(sourceRoot, "alpha"),
            [{ basename: "entry.json", content: "{}" }],
            false,
            { trustedParent: trust },
        )).rejects.toThrow("Unresolved source snapshot promotion journal");

        expect(readdirSync(sourceRoot)).toEqual([".source-snapshot-promotion.json"]);
    });

    it("never lets a concurrent recovery contender restore without owning the build lock", () => {
        const root = makeRoot();
        const packsDirectory = path.join(root, "packs");
        const stagingRoot = path.join(packsDirectory, ".compile-stage-seeded");
        const backupRoot = path.join(packsDirectory, ".compile-backup-seeded");
        seedLive(root, "alpha", "new alpha");
        mkdirSync(path.join(stagingRoot, "beta"), { recursive: true });
        writeFileSync(path.join(stagingRoot, "beta", "marker"), "new beta");
        mkdirSync(path.join(backupRoot, "alpha"), { recursive: true });
        mkdirSync(path.join(backupRoot, "beta"), { recursive: true });
        writeFileSync(path.join(backupRoot, "alpha", "marker"), "old alpha");
        writeFileSync(path.join(backupRoot, "beta", "marker"), "old beta");
        writeFileSync(path.join(packsDirectory, ".compile-promotion.json"), JSON.stringify({
            version: 2,
            transaction: "seeded",
            committed: false,
            entries: [
                { name: "alpha", path: "packs/alpha", hadLive: true, backedUp: true, promoted: true },
                { name: "beta", path: "packs/beta", hadLive: true, backedUp: true, promoted: false },
            ],
        }));
        process.env.SF2E_FOUNDRY_OFFLINE = "1";
        let contenderAttempted = false;

        const result = compileConfiguredPacks({
            rootDirectory: root,
            packs: [],
            dependencies: {
                acquireBuildLock: (directory) => {
                    const lock = acquireBuildLock(directory);
                    expect(() => compileConfiguredPacks({ rootDirectory: root, packs: [], dependencies: { log: () => undefined } }))
                        .toThrow("Build publication appears owned");
                    contenderAttempted = true;
                    expect(readLive(root, "alpha")).toBe("new alpha");
                    expect(existsSync(path.join(root, "packs", "beta"))).toBe(false);
                    return lock;
                },
                log: () => undefined,
            },
        });

        expect(contenderAttempted).toBe(true);
        expect(result).toEqual({ compiled: 0, skipped: 0 });
        expect(readLive(root, "alpha")).toBe("old alpha");
        expect(readLive(root, "beta")).toBe("old beta");
    });

    it("recovers a valid prior transaction after journaled packs are removed or renamed in the manifest", () => {
        const root = makeRoot();
        const packsDirectory = path.join(root, "packs");
        const stagingRoot = path.join(packsDirectory, ".compile-stage-prior-manifest");
        const backupRoot = path.join(packsDirectory, ".compile-backup-prior-manifest");
        seedLive(root, "alpha", "new alpha");
        mkdirSync(path.join(stagingRoot, "beta"), { recursive: true });
        writeFileSync(path.join(stagingRoot, "beta", "marker"), "new beta");
        mkdirSync(path.join(backupRoot, "alpha"), { recursive: true });
        mkdirSync(path.join(backupRoot, "beta"), { recursive: true });
        writeFileSync(path.join(backupRoot, "alpha", "marker"), "old alpha");
        writeFileSync(path.join(backupRoot, "beta", "marker"), "old beta");
        writeFileSync(path.join(packsDirectory, ".compile-promotion.json"), JSON.stringify({
            version: 2,
            transaction: "prior-manifest",
            committed: false,
            entries: [
                { name: "alpha", path: "packs/alpha", hadLive: true, backedUp: true, promoted: true },
                { name: "beta", path: "packs/beta", hadLive: true, backedUp: true, promoted: false },
            ],
        }));
        process.env.SF2E_FOUNDRY_OFFLINE = "1";

        expect(compileConfiguredPacks({
            rootDirectory: root,
            packs: [{ name: "renamed-pack", path: "packs/renamed-pack", type: "Actor" }],
            dependencies: { log: () => undefined },
        })).toEqual({ compiled: 0, skipped: 1 });

        expect(readLive(root, "alpha")).toBe("old alpha");
        expect(readLive(root, "beta")).toBe("old beta");
        expect(existsSync(path.join(packsDirectory, ".compile-promotion.json"))).toBe(false);
    });

    it("rejects a recovery journal whose persisted pack mapping is not exact", () => {
        const root = makeRoot();
        const packsDirectory = path.join(root, "packs");
        writeFileSync(path.join(packsDirectory, ".compile-promotion.json"), JSON.stringify({
            version: 2,
            transaction: "unsafe-mapping",
            committed: false,
            entries: [
                { name: "alpha", path: "packs/beta", hadLive: true, backedUp: false, promoted: false },
            ],
        }));

        expect(() => compileConfiguredPacks({ rootDirectory: root, packs: [], dependencies: { log: () => undefined } }))
            .toThrow("Refusing invalid promotion journal entry");
        expect(existsSync(path.join(packsDirectory, ".compile-lock"))).toBe(false);
    });

    it("retains an interrupted journal when its prior live pack is unavailable", () => {
        const root = makeRoot();
        const packsDirectory = path.join(root, "packs");
        writeFileSync(path.join(packsDirectory, ".compile-promotion.json"), JSON.stringify({
            version: 2,
            transaction: "missing-prior-live",
            committed: false,
            entries: [{ name: "alpha", path: "packs/alpha", hadLive: true, backedUp: true, promoted: true }],
        }));

        expect(() => compileConfiguredPacks({ rootDirectory: root, packs: [], dependencies: { log: () => undefined } }))
            .toThrow("prior live packs remain under");
        expect(existsSync(path.join(packsDirectory, ".compile-promotion.json"))).toBe(true);
    });

    it("refuses a dangling compiler promotion journal before reading the manifest", () => {
        const root = makeRoot();
        const packsDirectory = path.join(root, "packs");
        symlinkSync(path.join(root, "missing-journal"), path.join(packsDirectory, ".compile-promotion.json"), "file");
        writeFileSync(path.join(root, "module.json"), "{ malformed");

        expect(() => compileConfiguredPacks({ rootDirectory: root, dependencies: { log: () => undefined } }))
            .toThrow("Refusing invalid promotion journal file");
    });

    it("does not follow a symlink at the compiler journal temporary path", () => {
        const root = makeRoot();
        const packsDirectory = path.join(root, "packs");
        const outside = path.join(root, "outside-journal-target");
        let compiled = false;
        seedSource(root, "alpha");
        writeFileSync(outside, "do not truncate");
        symlinkSync(outside, path.join(packsDirectory, ".compile-promotion.json.tmp"), "file");

        expect(() => compileConfiguredPacks({
            rootDirectory: root,
            packs: [packs[0]],
            dependencies: { run: () => { compiled = true; }, log: () => undefined },
        })).toThrow("Refusing invalid promotion temporary journal file");

        expect(compiled).toBe(false);
        expect(readFileSync(outside, "utf8")).toBe("do not truncate");
    });

    it("refuses a non-file compiler journal temporary path before compilation", () => {
        const root = makeRoot();
        const temporaryJournal = path.join(root, "packs", ".compile-promotion.json.tmp");
        let compiled = false;
        seedSource(root, "alpha");
        mkdirSync(temporaryJournal);

        expect(() => compileConfiguredPacks({
            rootDirectory: root,
            packs: [packs[0]],
            dependencies: { run: () => { compiled = true; }, log: () => undefined },
        })).toThrow("Refusing invalid promotion temporary journal file");

        expect(compiled).toBe(false);
        expect(lstatSync(temporaryJournal).isDirectory()).toBe(true);
    });

    it("recovers a regular compiler journal temporary file before compiling and promoting", () => {
        const root = makeRoot();
        const packsDirectory = path.join(root, "packs");
        const temporaryJournal = path.join(packsDirectory, ".compile-promotion.json.tmp");
        let recoverySynced = false;
        seedSource(root, "alpha");
        writeFileSync(temporaryJournal, "interrupted journal publication");

        expect(compileConfiguredPacks({
            rootDirectory: root,
            packs: [packs[0]],
            dependencies: {
                syncDirectory: (directory) => { if (directory === packsDirectory) recoverySynced = true; },
                run: (_command, args) => {
                    expect(existsSync(temporaryJournal)).toBe(false);
                    expect(recoverySynced).toBe(true);
                    writeCompiledPack(args, "new alpha");
                },
                log: () => undefined,
            },
        })).toEqual({ compiled: 1, skipped: 0 });

        expect(readLive(root, "alpha")).toBe("new alpha");
        expect(existsSync(temporaryJournal)).toBe(false);
    });

    it("cleans a newer regular temporary journal after recovering a published journal", () => {
        const root = makeRoot();
        const packsDirectory = path.join(root, "packs");
        const journal = path.join(packsDirectory, ".compile-promotion.json");
        const temporaryJournal = path.join(packsDirectory, ".compile-promotion.json.tmp");
        seedLive(root, "alpha", "new alpha");
        writeFileSync(journal, JSON.stringify({
            version: 2,
            transaction: "committed-with-newer-temp",
            committed: true,
            entries: [{ name: "alpha", path: "packs/alpha", hadLive: false, backedUp: false, promoted: true }],
        }));
        writeFileSync(temporaryJournal, "newer interrupted journal publication");

        expect(compileConfiguredPacks({ rootDirectory: root, packs: [], dependencies: { log: () => undefined } }))
            .toEqual({ compiled: 0, skipped: 0 });

        expect(readLive(root, "alpha")).toBe("new alpha");
        expect(existsSync(journal)).toBe(false);
        expect(existsSync(temporaryJournal)).toBe(false);
    });

    it("holds the compiler-wide lock while invoking the compiler", () => {
        const root = makeRoot();
        seedSource(root, "alpha");
        let lockHeld = false;
        const fakeLock: BuildLock = {
            path: path.join(root, "packs", ".compile-lock"),
            owner: { version: 2, pid: process.pid, processStartIdentity: "test-process", token: "test-owner", acquiredAt: new Date(0).toISOString() },
        };

        compileConfiguredPacks({
            rootDirectory: root,
            packs: [packs[0]],
            dependencies: {
                acquireBuildLock: () => { lockHeld = true; return fakeLock; },
                releaseBuildLock: () => { lockHeld = false; },
                run: (_command, args) => {
                    expect(lockHeld).toBe(true);
                    writeCompiledPack(args, "new alpha");
                },
                log: () => undefined,
            },
        });

        expect(lockHeld).toBe(false);
    });

    it("rejects staged output when an injected source fingerprint changes during compilation", () => {
        const root = makeRoot();
        seedSource(root, "alpha");
        seedLive(root, "alpha", "old alpha");
        let fingerprintCalls = 0;

        expect(() => compileConfiguredPacks({
            rootDirectory: root,
            packs: [packs[0]],
            dependencies: {
                fingerprintSource: () => fingerprintCalls++ === 0 ? "generation-one" : "generation-two",
                run: (_command, args) => writeCompiledPack(args, "stale alpha"),
                log: () => undefined,
            },
        })).toThrow("Source pack changed during compilation: alpha");

        expect(readLive(root, "alpha")).toBe("old alpha");
        expect(transientRoots(root)).toEqual([]);
    });

    it("keeps converter source publication excluded through final fingerprinting and live promotion", () => {
        const root = makeRoot();
        const packsDirectory = path.join(root, "packs");
        seedSource(root, "alpha");
        let fingerprintCalls = 0;
        let excludedDuringFinalFingerprint = false;
        let excludedDuringPromotion = false;

        compileConfiguredPacks({
            rootDirectory: root,
            packs: [packs[0]],
            dependencies: {
                fingerprintSource: () => {
                    fingerprintCalls++;
                    if (fingerprintCalls === 2) {
                        expect(() => acquireBuildLock(packsDirectory)).toThrow("Build publication appears owned");
                        excludedDuringFinalFingerprint = true;
                    }
                    return "stable-generation";
                },
                run: (_command, args) => writeCompiledPack(args, "new alpha"),
                moveDirectory: (from, to) => {
                    if (from.includes(".compile-stage-")) {
                        expect(() => acquireBuildLock(packsDirectory)).toThrow("Build publication appears owned");
                        excludedDuringPromotion = true;
                    }
                    renameSync(from, to);
                },
                log: () => undefined,
            },
        });

        expect(excludedDuringFinalFingerprint).toBe(true);
        expect(excludedDuringPromotion).toBe(true);
        expect(readLive(root, "alpha")).toBe("new alpha");
    });

    it("replaces all live packs only after every compilation succeeds and Foundry is explicitly confirmed offline", () => {
        const root = makeRoot();
        seedSource(root, "alpha");
        seedSource(root, "beta");
        seedLive(root, "alpha", "old alpha");
        seedLive(root, "beta", "old beta");
        process.env.SF2E_FOUNDRY_OFFLINE = "1";
        const stagingRoots: string[] = [];

        const summary = compileConfiguredPacks({
            rootDirectory: root,
            packs,
            dependencies: {
                run: (_command, args) => {
                    stagingRoots.push(args[args.indexOf("--out") + 1]);
                    writeCompiledPack(args, `new ${packName(args)}`);
                },
                log: () => undefined,
            },
        });

        expect(summary).toEqual({ compiled: 2, skipped: 0 });
        expect(readLive(root, "alpha")).toBe("new alpha");
        expect(readLive(root, "beta")).toBe("new beta");
        expect(transientRoots(root)).toEqual([]);
        expect(new Set(stagingRoots).size).toBe(1);
        expect(path.dirname(stagingRoots[0])).toBe(path.join(root, "packs"));
        expect(existsSync(path.join(root, "packs", ".compile-lock"))).toBe(false);
    });

    it("deliberately skips a configured pack with no source and preserves its live output", () => {
        const root = makeRoot();
        seedLive(root, "alpha", "old alpha");
        const calls: string[][] = [];
        const messages: string[] = [];

        const summary = compileConfiguredPacks({
            rootDirectory: root,
            packs: [packs[0]],
            dependencies: {
                run: (_command, args) => calls.push(args),
                log: (message) => messages.push(message),
            },
        });

        expect(summary).toEqual({ compiled: 0, skipped: 1 });
        expect(calls).toEqual([]);
        expect(messages).toContain("  Skip: alpha (no source at packs/_source/alpha/)");
        expect(readLive(root, "alpha")).toBe("old alpha");
        expect(transientRoots(root)).toEqual([]);
    });

    it("compiles an ordinary clean pack and passes the CLI entry and pack name as separate argv values", () => {
        const root = makeRoot();
        const name = "alpha-one";
        seedSource(root, name);
        let invocation: { command: string; args: string[]; cwd: string } | undefined;

        compileConfiguredPacks({
            rootDirectory: root,
            packs: [{ name, path: `packs/${name}`, type: "JournalEntry" }],
            dependencies: {
                run: (command, args, cwd) => {
                    invocation = { command, args, cwd };
                    writeCompiledPack(args, "compiled");
                },
                log: () => undefined,
            },
        });

        expect(invocation).toEqual({
            command: process.execPath,
            args: [
                path.join(root, "node_modules", "@foundryvtt", "foundryvtt-cli", "fvtt.mjs"),
                "package",
                "pack",
                name,
                "--type",
                "Module",
                "--in",
                path.join(root, "packs", "_source", name),
                "--out",
                expect.stringContaining(`${path.sep}.compile-stage-`),
            ],
            cwd: root,
        });
        expect(readLive(root, name)).toBe("compiled");
    });

    it("rejects pack names that could escape the packs directory", () => {
        const root = makeRoot();

        expect(() =>
            compileConfiguredPacks({
                rootDirectory: root,
                packs: [{ name: "../outside", path: "packs/../outside", type: "Actor" }],
                dependencies: { log: () => undefined },
            }),
        ).toThrow("Invalid pack name");
        expect(existsSync(path.join(root, "outside"))).toBe(false);
    });

    it.each(["_source", "_SOURCE", ".COMPILE-STAGE-alias", ".COMPILE-BACKUP-alias"])(
        "rejects reserved source and transient directory alias %s as a pack name",
        (name) => {
            const root = makeRoot();

            expect(() =>
                compileConfiguredPacks({
                    rootDirectory: root,
                    packs: [{ name, path: `packs/${name}`, type: "Actor" }],
                    dependencies: { log: () => undefined },
                }),
            ).toThrow("Invalid pack name");
        },
    );

    it.each(["con", "PRN", "aux", "nul", "COM1", "lpt9"])("rejects Windows device name %s as a pack name", (name) => {
        const root = makeRoot();

        expect(() =>
            compileConfiguredPacks({
                rootDirectory: root,
                packs: [{ name, path: `packs/${name}`, type: "Actor" }],
                dependencies: { log: () => undefined },
            }),
        ).toThrow("Invalid pack name");
    });

    it("rejects a manifest path alias before touching filesystem output", () => {
        const root = makeRoot();

        expect(() =>
            compileConfiguredPacks({
                rootDirectory: root,
                packs: [{ name: "alpha", path: "packs/alias", type: "Actor" }],
                dependencies: { log: () => undefined },
            }),
        ).toThrow("Invalid pack path for alpha: expected packs/alpha");
        expect(transientRoots(root)).toEqual([]);
    });

    it("rejects case-folded duplicate portable pack names and paths before touching filesystem output", () => {
        const root = makeRoot();

        expect(() =>
            compileConfiguredPacks({
                rootDirectory: root,
                packs: [
                    { name: "alpha", path: "packs/alpha", type: "Actor" },
                    { name: "ALPHA", path: "packs/ALPHA", type: "Actor" },
                ],
                dependencies: { log: () => undefined },
            }),
        ).toThrow("Duplicate pack path");
    });

    it("refuses to clean a temporary directory outside packs", () => {
        const root = makeRoot();
        const outside = path.join(root, "outside", ".compile-stage-sentinel");
        mkdirSync(outside, { recursive: true });

        expect(() =>
            compileConfiguredPacks({
                rootDirectory: root,
                packs: [packs[0]],
                dependencies: {
                    makeTemporaryDirectory: () => outside,
                    log: () => undefined,
                },
            }),
        ).toThrow("Pack compilation failed and cleanup also failed");
        expect(existsSync(outside)).toBe(true);
    });

    it("requires an explicit offline assertion before replacing an existing live pack", () => {
        const root = makeRoot();
        seedSource(root, "alpha");
        seedLive(root, "alpha", "old alpha");
        delete process.env.SF2E_FOUNDRY_OFFLINE;

        expect(() => compileConfiguredPacks({
            rootDirectory: root,
            packs: [packs[0]],
            dependencies: { run: (_command, args) => writeCompiledPack(args, "new alpha"), log: () => undefined },
        })).toThrow("Close Foundry and set SF2E_FOUNDRY_OFFLINE=1");
        expect(readLive(root, "alpha")).toBe("old alpha");
    });

    it("refuses a redirected live pack directory without mutating its target", () => {
        const root = makeRoot();
        const outside = path.join(root, "outside-live-pack");
        seedSource(root, "alpha");
        mkdirSync(outside);
        writeFileSync(path.join(outside, "marker"), "do not mutate");
        symlinkSync(outside, path.join(root, "packs", "alpha"), "dir");

        expect(() => compileConfiguredPacks({
            rootDirectory: root,
            packs: [packs[0]],
            dependencies: { run: (_command, args) => writeCompiledPack(args, "new alpha"), log: () => undefined },
        })).toThrow("Refusing redirected live pack directory");
        expect(readFileSync(path.join(outside, "marker"), "utf8")).toBe("do not mutate");
    });

    it("refuses a dangling symlink at a live pack path", () => {
        const root = makeRoot();
        const outside = path.join(root, "missing-live-pack");
        const livePack = path.join(root, "packs", "alpha");
        seedSource(root, "alpha");
        symlinkSync(outside, livePack, "dir");

        expect(() => compileConfiguredPacks({
            rootDirectory: root,
            packs: [packs[0]],
            dependencies: { run: (_command, args) => writeCompiledPack(args, "new alpha"), log: () => undefined },
        })).toThrow("Refusing redirected live pack directory");
        expect(lstatSync(livePack).isSymbolicLink()).toBe(true);
    });

    it("rejects a redirected source root before fingerprinting or compiling", () => {
        const root = makeRoot();
        const outside = path.join(root, "outside-source");
        mkdirSync(path.join(outside, "alpha"), { recursive: true });
        symlinkSync(outside, path.join(root, "packs", "_source"), "dir");
        let compiled = false;

        expect(() => compileConfiguredPacks({
            rootDirectory: root,
            packs: [packs[0]],
            dependencies: { run: () => { compiled = true; }, log: () => undefined },
        })).toThrow("Snapshot parent is not a trusted directory");

        expect(compiled).toBe(false);
        expect(readdirSync(outside)).toEqual(["alpha"]);
    });

    it("rejects a dangling symlink at a configured source-pack path instead of skipping it", () => {
        const root = makeRoot();
        const sourceRoot = path.join(root, "packs", "_source");
        mkdirSync(sourceRoot);
        symlinkSync(path.join(root, "missing-source"), path.join(sourceRoot, "alpha"), "dir");

        expect(() => compileConfiguredPacks({ rootDirectory: root, packs: [packs[0]], dependencies: { log: () => undefined } }))
            .toThrow("Refusing invalid source pack directory");
    });

    it("rejects a non-directory configured source pack", () => {
        const root = makeRoot();
        const sourceRoot = path.join(root, "packs", "_source");
        mkdirSync(sourceRoot);
        writeFileSync(path.join(sourceRoot, "alpha"), "not a pack directory");

        expect(() => compileConfiguredPacks({ rootDirectory: root, packs: [packs[0]], dependencies: { log: () => undefined } }))
            .toThrow("Refusing invalid source pack directory");
    });

    it("makes the staged pack tree and staging root durable before the first promotion rename", () => {
        const root = makeRoot();
        seedSource(root, "alpha");
        const events: string[] = [];

        compileConfiguredPacks({
            rootDirectory: root,
            packs: [packs[0]],
            dependencies: {
                run: (_command, args) => writeCompiledPack(args, "new alpha"),
                syncStagedTree: (directory) => {
                    expect(readFileSync(path.join(directory, "marker"), "utf8")).toBe("new alpha");
                    events.push("tree");
                },
                syncDirectory: (directory) => {
                    if (path.basename(directory).startsWith(".compile-stage-")) events.push("root");
                },
                moveDirectory: (from, to) => {
                    events.push("move");
                    renameSync(from, to);
                },
                log: () => undefined,
            },
        });

        expect(events.slice(0, 3)).toEqual(["tree", "root", "move"]);
    });

    it("rejects a symlink staged at the expected pack root", () => {
        const root = makeRoot();
        const outside = path.join(root, "outside-staged-pack");
        seedSource(root, "alpha");
        mkdirSync(outside);

        expect(() => compileConfiguredPacks({
            rootDirectory: root,
            packs: [packs[0]],
            dependencies: {
                run: (_command, args) => symlinkSync(outside, path.join(args[args.indexOf("--out") + 1], "alpha"), "dir"),
                log: () => undefined,
            },
        })).toThrow("Refusing invalid staged pack directory");
        expect(transientRoots(root)).toEqual([]);
    });

    it("rejects a staged pack containing a symlink descendant", () => {
        const root = makeRoot();
        const outside = path.join(root, "outside-staged-file");
        seedSource(root, "alpha");
        writeFileSync(outside, "outside");

        expect(() => compileConfiguredPacks({
            rootDirectory: root,
            packs: [packs[0]],
            dependencies: {
                run: (_command, args) => {
                    writeCompiledPack(args, "new alpha");
                    symlinkSync(outside, path.join(args[args.indexOf("--out") + 1], "alpha", "redirect"), "file");
                },
                log: () => undefined,
            },
        })).toThrow("staged pack containing redirected path");
        expect(transientRoots(root)).toEqual([]);
    });

    it("rejects a symlinked packs ancestor before writing outside the repository", () => {
        const root = makeRoot();
        const outside = mkdtempSync(path.join(os.tmpdir(), "compile-packs-outside-"));
        temporaryRoots.push(outside);
        rmSync(path.join(root, "packs"), { recursive: true });
        symlinkSync(outside, path.join(root, "packs"), "dir");

        expect(() => compileConfiguredPacks({ rootDirectory: root, packs: [packs[0]], dependencies: { log: () => undefined } }))
            .toThrow("Refusing redirected packs directory");
        expect(readdirSync(outside)).toEqual([]);
    });
});

function makeRoot(): string {
    const root = mkdtempSync(path.join(os.tmpdir(), "compile-packs-test-"));
    temporaryRoots.push(root);
    mkdirSync(path.join(root, "packs"), { recursive: true });
    return root;
}

function seedSource(root: string, name: string): void {
    mkdirSync(path.join(root, "packs", "_source", name), { recursive: true });
}

function seedLive(root: string, name: string, content: string): void {
    const directory = path.join(root, "packs", name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "marker"), content);
}

function writeCompiledPack(args: string[], content: string): void {
    const directory = path.join(args[args.indexOf("--out") + 1], packName(args));
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "marker"), content);
}

function packName(args: string[]): string {
    return args[3];
}

function readLive(root: string, name: string): string {
    return readFileSync(path.join(root, "packs", name, "marker"), "utf-8");
}

function transientRoots(root: string): string[] {
    return readdirSync(path.join(root, "packs")).filter((name) => name.startsWith(".compile-stage-") || name.startsWith(".compile-backup-"));
}
