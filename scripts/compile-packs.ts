#!/usr/bin/env tsx
/** Compile configured JSON source packs into live LevelDB directories transactionally. */
import { spawnSync } from "node:child_process";
import { createHash, type Hash } from "node:crypto";
import {
    constants,
    closeSync,
    existsSync,
    fsyncSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readFileSync,
    readdirSync,
    realpathSync,
    renameSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { acquireBuildLock, releaseBuildLock, type BuildLock } from "./build-lock.js";
import { recoverSourceSnapshotPromotionSync } from "./converter/snapshot-output.js";

export interface PackDef {
    name: string;
    type: string;
    path: string;
}

export interface CompileSummary {
    compiled: number;
    skipped: number;
}

export interface CompileDependencies {
    directoryExists(directory: string): boolean;
    ensureDirectory(directory: string): void;
    makeTemporaryDirectory(prefix: string): string;
    moveDirectory(from: string, to: string): void;
    removeDirectory(directory: string): void;
    acquireBuildLock(packsDirectory: string): BuildLock;
    releaseBuildLock(lock: BuildLock): void;
    recoverSourcePromotion(sourceRoot: string): void;
    fingerprintSource(directory: string): string | undefined;
    syncStagedTree(directory: string): void;
    syncDirectory(directory: string): void;
    run(command: string, args: string[], cwd: string): void;
    log(message: string): void;
}

interface StagedPack {
    pack: PackDef;
    stagedDirectory: string;
}

interface PromotionJournalEntry {
    name: string;
    path: string;
    hadLive: boolean;
    backedUp: boolean;
    promoted: boolean;
}

interface PromotionJournal {
    version: 2;
    transaction: string;
    committed: boolean;
    entries: PromotionJournalEntry[];
}

class PromotionRestoreError extends AggregateError {
    constructor(errors: unknown[], readonly backupRoot: string) {
        super(errors, `Pack promotion failed and restoring prior live packs also failed; prior live packs remain under ${backupRoot}`);
        this.name = "PromotionRestoreError";
    }
}
class PromotionRecoveryRequiredError extends Error {
    constructor(readonly backupRoot: string, options: ErrorOptions) {
        super(`Pack promotion commit durability is uncertain; recovery data remains under ${backupRoot}`, options);
        this.name = "PromotionRecoveryRequiredError";
    }
}


const STAGE_PREFIX = ".compile-stage-";
const BACKUP_PREFIX = ".compile-backup-";
const JOURNAL_FILE = ".compile-promotion.json";
const JOURNAL_TEMP_FILE = ".compile-promotion.json.tmp";
const MAX_JOURNAL_BYTES = 64 * 1024;
const MAX_JOURNAL_ENTRIES = 256;
const PORTABLE_PACK_NAME = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const TRANSACTION_NAME = /^[A-Za-z0-9_-]{1,128}$/;
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

const defaultDependencies: CompileDependencies = {
    directoryExists: existsSync,
    ensureDirectory: (directory) => mkdirSync(directory, { recursive: true }),
    makeTemporaryDirectory: mkdtempSync,
    moveDirectory: renameSync,
    removeDirectory: (directory) => rmSync(directory, { recursive: true, force: true }),
    acquireBuildLock,
    releaseBuildLock,
    recoverSourcePromotion: recoverSourceSnapshotPromotionSync,
    fingerprintSource,
    syncDirectory,
    syncStagedTree,
    run: (command, args, cwd) => {
        const result = spawnSync(command, args, { cwd, stdio: "inherit" });
        if (result.error) throw result.error;
        if (result.status !== 0) {
            const detail = result.signal ? `signal ${result.signal}` : `exit code ${String(result.status)}`;
            throw new Error(`${command} failed with ${detail}`);
        }
    },
    log: console.log,
};

export function readConfiguredPacks(rootDirectory: string): PackDef[] {
    const moduleJsonPath = path.join(rootDirectory, "module.json");
    const moduleJson = JSON.parse(readFileSync(moduleJsonPath, "utf-8")) as { packs?: PackDef[] };
    return moduleJson.packs ?? [];
}

export function compileConfiguredPacks({
    rootDirectory = path.resolve(import.meta.dirname, ".."),
    packs,
    dependencies: dependencyOverrides = {},
}: {
    rootDirectory?: string;
    packs?: PackDef[];
    dependencies?: Partial<CompileDependencies>;
} = {}): CompileSummary {
    const dependencies = { ...defaultDependencies, ...dependencyOverrides };
    const packsDirectory = path.join(rootDirectory, "packs");
    const fvttCliPath = path.join(rootDirectory, "node_modules", "@foundryvtt", "foundryvtt-cli", "fvtt.mjs");
    const journalPath = path.join(packsDirectory, JOURNAL_FILE);
    const sourceRoot = path.join(packsDirectory, "_source");

    assertSafePacksDirectory(rootDirectory, packsDirectory);
    dependencies.ensureDirectory(packsDirectory);
    let stagingRoot: string | undefined;
    let backupRoot: string | undefined;
    let lock: BuildLock | undefined;
    let failure: unknown;
    let summary: CompileSummary | undefined;
    let committed = false;

    try {
        lock = dependencies.acquireBuildLock(packsDirectory);
        recoverInterruptedPromotion(packsDirectory, journalPath, dependencies);
        dependencies.recoverSourcePromotion(sourceRoot);
        const configuredPacks = packs ?? readConfiguredPacks(rootDirectory);
        assertSafePackDefinitions(configuredPacks);
        const sourceDirectories = validateSourceDirectories(configuredPacks, sourceRoot, packsDirectory);

        if (configuredPacks.length === 0) {
            dependencies.log("No packs defined in module.json. Nothing to compile.");
            summary = { compiled: 0, skipped: 0 };
        } else {
            stagingRoot = dependencies.makeTemporaryDirectory(path.join(packsDirectory, STAGE_PREFIX));
            const transaction = transactionFromStagingRoot(stagingRoot, packsDirectory);
            backupRoot = path.join(packsDirectory, `${BACKUP_PREFIX}${transaction}`);
            const sourceFingerprints = new Map<string, string | undefined>();
            for (const pack of configuredPacks) {
                const sourceDirectory = sourceDirectories.get(pack.name);
                sourceFingerprints.set(pack.name, sourceDirectory === undefined ? undefined : dependencies.fingerprintSource(sourceDirectory));
            }
            const stagedPacks: StagedPack[] = [];
            let skipped = 0;
            for (const pack of configuredPacks) {
                const sourceDirectory = sourceDirectories.get(pack.name);
                if (sourceDirectory === undefined) {
                    dependencies.log(`  Skip: ${pack.name} (no source at packs/_source/${pack.name}/)`);
                    skipped++;
                    continue;
                }

                dependencies.log(`  Pack: ${pack.name} (${pack.type})`);
                dependencies.run(
                    process.execPath,
                    [fvttCliPath, "package", "pack", pack.name, "--type", "Module", "--in", sourceDirectory, "--out", stagingRoot],
                    rootDirectory,
                );
                const stagedDirectory = path.join(stagingRoot, pack.name);
                assertStagedPackSafe(stagedDirectory, stagingRoot);
                stagedPacks.push({ pack, stagedDirectory });
                dependencies.syncStagedTree(stagedDirectory);
            }

            if (stagedPacks.length > 0) dependencies.syncDirectory(stagingRoot);
            assertSourcesUnchanged(configuredPacks, sourceRoot, packsDirectory, sourceFingerprints, dependencies);
            if (stagedPacks.length > 0) {
                assertExistingLivePacksSafe(stagedPacks, packsDirectory, dependencies);
                dependencies.ensureDirectory(backupRoot);
                assertTransactionRootSafe(backupRoot, packsDirectory);
                promoteStagedPacks(stagedPacks, packsDirectory, stagingRoot, backupRoot, transaction, journalPath, dependencies);
                committed = true;
            }

            summary = { compiled: stagedPacks.length, skipped };
            dependencies.log(`\nCompiled ${summary.compiled} pack(s)${skipped > 0 ? `, ${skipped} skipped` : ""}.`);
        }
    } catch (error) {
        failure = error;
    }

    const cleanupErrors = cleanupTemporaryRoots(
        [failure instanceof PromotionRestoreError || failure instanceof PromotionRecoveryRequiredError ? undefined : backupRoot, stagingRoot],
        packsDirectory,
        dependencies,
    );
    if (committed && cleanupErrors.length === 0) {
        try {
            removeJournal(journalPath, packsDirectory, dependencies);
        } catch (error) {
            cleanupErrors.push(error);
        }
    }
    if (lock) {
        try {
            dependencies.releaseBuildLock(lock);
        } catch (error) {
            cleanupErrors.push(error);
        }
    }
    if (failure !== undefined) {
        if (cleanupErrors.length > 0) throw new AggregateError([failure, ...cleanupErrors], "Pack compilation failed and cleanup also failed");
        throw failure;
    }
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "Temporary-directory cleanup failed after pack compilation");
    return summary!;
}

function recoverInterruptedPromotion(
    packsDirectory: string,
    journalPath: string,
    dependencies: CompileDependencies,
): void {
    if (!pathExistsWithLstat(journalPath)) {
        removeTemporaryJournal(packsDirectory, dependencies);
        return;
    }

    const journal = readAndValidateJournal(journalPath, packsDirectory);
    const stagingRoot = path.join(packsDirectory, `${STAGE_PREFIX}${journal.transaction}`);
    const backupRoot = path.join(packsDirectory, `${BACKUP_PREFIX}${journal.transaction}`);
    const cleanupErrors = journal.committed
        ? cleanupTemporaryRoots([backupRoot, stagingRoot], packsDirectory, dependencies)
        : (() => {
            assertRecoveryOffline(journal, stagingRoot, backupRoot, packsDirectory, dependencies);
            const restoreErrors = restoreJournalEntries(journal, stagingRoot, backupRoot, packsDirectory, dependencies);
            if (restoreErrors.length > 0) throw new PromotionRestoreError(restoreErrors, backupRoot);
            return cleanupTemporaryRoots([backupRoot, stagingRoot], packsDirectory, dependencies);
        })();
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "Interrupted promotion cleanup failed");
    removeJournal(journalPath, packsDirectory, dependencies);
}

function assertRecoveryOffline(
    journal: PromotionJournal,
    stagingRoot: string,
    backupRoot: string,
    packsDirectory: string,
    dependencies: CompileDependencies,
): void {
    const changesLive = journal.entries.some(({ name, hadLive }) => {
        const live = path.join(packsDirectory, name);
        const backup = path.join(backupRoot, name);
        const staged = path.join(stagingRoot, name);
        return dependencies.directoryExists(backup) || (!hadLive && dependencies.directoryExists(live) && !dependencies.directoryExists(staged));
    });
    if (changesLive && process.env.SF2E_FOUNDRY_OFFLINE !== "1") throw offlineError();
}

function promoteStagedPacks(
    stagedPacks: StagedPack[],
    packsDirectory: string,
    stagingRoot: string,
    backupRoot: string,
    transaction: string,
    journalPath: string,
    dependencies: CompileDependencies,
): void {
    if (stagedPacks.length > MAX_JOURNAL_ENTRIES) throw new Error(`Cannot promote more than ${MAX_JOURNAL_ENTRIES} packs in one transaction`);
    const journal: PromotionJournal = {
        version: 2,
        transaction,
        committed: false,
        entries: stagedPacks.map(({ pack }) => ({
            name: pack.name,
            path: pack.path,
            hadLive: dependencies.directoryExists(path.join(packsDirectory, pack.name)),
            backedUp: false,
            promoted: false,
        })),
    };
    writeJournal(journalPath, journal, packsDirectory, dependencies);

    try {
        for (let index = 0; index < stagedPacks.length; index++) {
            const { pack, stagedDirectory } = stagedPacks[index];
            const entry = journal.entries[index];
            const liveDirectory = path.join(packsDirectory, pack.name);
            const backupDirectory = path.join(backupRoot, pack.name);
            assertStagedPackSafe(stagedDirectory, stagingRoot);
            if (entry.hadLive) {
                dependencies.moveDirectory(liveDirectory, backupDirectory);
                entry.backedUp = true;
                syncTransition([packsDirectory, backupRoot], journalPath, journal, dependencies);
            }
            assertStagedPackSafe(stagedDirectory, stagingRoot);
            dependencies.moveDirectory(stagedDirectory, liveDirectory);
            entry.promoted = true;
            syncTransition([packsDirectory, stagingRoot], journalPath, journal, dependencies);
        }
    } catch (error) {
        const restoreErrors = restoreJournalEntries(journal, stagingRoot, backupRoot, packsDirectory, dependencies);
        if (restoreErrors.length > 0) throw new PromotionRestoreError([error, ...restoreErrors], backupRoot);
        removeJournal(journalPath, packsDirectory, dependencies);
        throw error;
    }

    journal.committed = true;
    try {
        writeJournal(journalPath, journal, packsDirectory, dependencies);
    } catch (error) {
        throw new PromotionRecoveryRequiredError(backupRoot, { cause: error });
    }
}

function restoreJournalEntries(
    journal: PromotionJournal,
    stagingRoot: string,
    backupRoot: string,
    packsDirectory: string,
    dependencies: CompileDependencies,
): unknown[] {
    const errors: unknown[] = [];
    for (const entry of [...journal.entries].reverse()) {
        const live = path.join(packsDirectory, entry.name);
        const backup = path.join(backupRoot, entry.name);
        const staged = path.join(stagingRoot, entry.name);
        try {
            if (dependencies.directoryExists(backup)) {
                assertRealDirectoryTree(backup, backupRoot, "backup pack");
                if (dependencies.directoryExists(live) || isSymbolicLink(live)) dependencies.removeDirectory(live);
                dependencies.moveDirectory(backup, live);
                dependencies.syncDirectory(packsDirectory);
                dependencies.syncDirectory(backupRoot);
            } else if (!entry.hadLive && dependencies.directoryExists(live) && !dependencies.directoryExists(staged)) {
                dependencies.removeDirectory(live);
                dependencies.syncDirectory(packsDirectory);
            } else if (entry.hadLive && !dependencies.directoryExists(live)) {
                throw new Error(`Cannot recover pack ${entry.name}: prior live pack is unavailable`);
            }
        } catch (error) {
            errors.push(error);
        }
    }
    return errors;
}

function syncTransition(directories: string[], journalPath: string, journal: PromotionJournal, dependencies: CompileDependencies): void {
    for (const directory of directories) dependencies.syncDirectory(directory);
    writeJournal(journalPath, journal, path.dirname(journalPath), dependencies);
}

function writeJournal(journalPath: string, journal: PromotionJournal, packsDirectory: string, dependencies: CompileDependencies): void {
    const serialized = JSON.stringify(journal);
    if (Buffer.byteLength(serialized) > MAX_JOURNAL_BYTES) throw new Error("Promotion journal exceeds safe size limit");
    const temporaryPath = path.join(packsDirectory, JOURNAL_TEMP_FILE);
    const descriptor = openSync(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
        writeFileSync(descriptor, serialized);
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
    renameSync(temporaryPath, journalPath);
    dependencies.syncDirectory(packsDirectory);
}

function removeJournal(journalPath: string, packsDirectory: string, dependencies: CompileDependencies): void {
    removeTemporaryJournal(packsDirectory, dependencies);
    rmSync(journalPath, { force: true });
    dependencies.syncDirectory(packsDirectory);
}

function removeTemporaryJournal(packsDirectory: string, dependencies: CompileDependencies): void {
    const temporaryPath = path.join(packsDirectory, JOURNAL_TEMP_FILE);
    let metadata;
    try {
        metadata = lstatSync(temporaryPath);
    } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") return;
        throw error;
    }
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`Refusing invalid promotion temporary journal file: ${temporaryPath}`);
    rmSync(temporaryPath);
    dependencies.syncDirectory(packsDirectory);
}

function readAndValidateJournal(journalPath: string, packsDirectory: string): PromotionJournal {
    const journalStat = lstatSync(journalPath);
    if (journalStat.isSymbolicLink() || !journalStat.isFile()) throw new Error("Refusing invalid promotion journal file");
    if (journalStat.size > MAX_JOURNAL_BYTES) throw new Error("Refusing oversized promotion journal");
    const serialized = readFileSync(journalPath, "utf8");
    if (Buffer.byteLength(serialized) > MAX_JOURNAL_BYTES) throw new Error("Refusing oversized promotion journal");
    const value = JSON.parse(serialized) as Partial<PromotionJournal>;
    if (value.version !== 2 || typeof value.transaction !== "string" || !TRANSACTION_NAME.test(value.transaction) ||
        typeof value.committed !== "boolean" || !Array.isArray(value.entries) || value.entries.length === 0 || value.entries.length > MAX_JOURNAL_ENTRIES) {
        throw new Error("Refusing invalid promotion journal");
    }
    const names = new Set<string>();
    for (const entry of value.entries) {
        if (typeof entry !== "object" || entry === null || typeof entry.name !== "string" || typeof entry.path !== "string" ||
            entry.path !== `packs/${entry.name}` || names.has(entry.name.toLowerCase()) ||
            typeof entry.hadLive !== "boolean" || typeof entry.backedUp !== "boolean" || typeof entry.promoted !== "boolean" ||
            (entry.backedUp && !entry.hadLive) || (entry.promoted && entry.hadLive && !entry.backedUp)) {
            throw new Error("Refusing invalid promotion journal entry");
        }
        assertSafePackName(entry.name);
        const live = path.resolve(packsDirectory, entry.name);
        if (path.dirname(live) !== path.resolve(packsDirectory)) throw new Error("Refusing promotion journal path outside packs directory");
        names.add(entry.name.toLowerCase());
    }
    if (value.committed && value.entries.some((entry) => !entry.promoted)) throw new Error("Refusing inconsistent promotion journal");
    return value as PromotionJournal;
}

function transactionFromStagingRoot(stagingRoot: string, packsDirectory: string): string {
    assertTransactionRootSafe(stagingRoot, packsDirectory);
    assertTemporaryRoot(stagingRoot, packsDirectory);
    const basename = path.basename(stagingRoot);
    const transaction = basename.slice(STAGE_PREFIX.length);
    if (!TRANSACTION_NAME.test(transaction)) throw new Error(`Invalid staging transaction name: ${basename}`);
    return transaction;
}

function assertSourcesUnchanged(
    packs: readonly PackDef[],
    sourceRoot: string,
    packsDirectory: string,
    fingerprints: ReadonlyMap<string, string | undefined>,
    dependencies: CompileDependencies,
): void {
    const sourceDirectories = validateSourceDirectories(packs, sourceRoot, packsDirectory);
    for (const pack of packs) {
        const sourceDirectory = sourceDirectories.get(pack.name);
        const current = sourceDirectory === undefined ? undefined : dependencies.fingerprintSource(sourceDirectory);
        if (current !== fingerprints.get(pack.name)) throw new Error(`Source pack changed during compilation: ${pack.name}`);
    }
}

function fingerprintSource(directory: string): string | undefined {
    let stat;
    try {
        stat = lstatSync(directory);
    } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") return undefined;
        throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Refusing invalid source pack directory: ${directory}`);
    const hash = createHash("sha256");
    fingerprintEntry(directory, "", hash);
    return hash.digest("hex");
}

function fingerprintEntry(entryPath: string, relative: string, hash: Hash): void {
    const stat = lstatSync(entryPath);
    if (stat.isSymbolicLink()) throw new Error(`Refusing redirected source path: ${entryPath}`);
    hash.update(relative);
    hash.update("\0");
    if (stat.isDirectory()) {
        hash.update("d\0");
        for (const name of readdirSync(entryPath).sort()) fingerprintEntry(path.join(entryPath, name), path.join(relative, name), hash);
    } else if (stat.isFile()) {
        hash.update("f\0");
        hash.update(readFileSync(entryPath));
        hash.update("\0");
    } else {
        throw new Error(`Refusing unsupported source path: ${entryPath}`);
    }
}

function validateSourceDirectories(packs: readonly PackDef[], sourceRoot: string, packsDirectory: string): Map<string, string | undefined> {
    const sources = new Map<string, string | undefined>();
    let rootStat;
    try {
        rootStat = lstatSync(sourceRoot);
    } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") {
            for (const pack of packs) sources.set(pack.name, undefined);
            return sources;
        }
        throw error;
    }
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error(`Refusing invalid source root directory: ${sourceRoot}`);
    const canonicalPacks = realpathSync(packsDirectory);
    const canonicalSourceRoot = realpathSync(sourceRoot);
    if (realpathSync(path.dirname(sourceRoot)) !== canonicalPacks || path.dirname(canonicalSourceRoot) !== canonicalPacks) {
        throw new Error(`Refusing redirected source root directory: ${sourceRoot}`);
    }

    for (const pack of packs) {
        const sourceDirectory = path.join(sourceRoot, pack.name);
        let stat;
        try {
            stat = lstatSync(sourceDirectory);
        } catch (error) {
            if ((error as { code?: unknown }).code === "ENOENT") {
                sources.set(pack.name, undefined);
                continue;
            }
            throw error;
        }
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Refusing invalid source pack directory: ${sourceDirectory}`);
        const canonicalSourceDirectory = realpathSync(sourceDirectory);
        if (path.dirname(canonicalSourceDirectory) !== canonicalSourceRoot || canonicalSourceDirectory !== path.join(canonicalSourceRoot, pack.name)) {
            throw new Error(`Refusing redirected source pack directory: ${sourceDirectory}`);

        }
        sources.set(pack.name, sourceDirectory);
    }
    return sources;
}

function pathExistsWithLstat(file: string): boolean {
    try {
        lstatSync(file);
        return true;
    } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") return false;
        throw error;
    }
}

function syncStagedTree(entryPath: string): void {
    const stat = lstatSync(entryPath);
    if (stat.isSymbolicLink()) throw new Error(`Refusing staged pack containing redirected path: ${entryPath}`);
    if (stat.isDirectory()) {
        for (const name of readdirSync(entryPath)) syncStagedTree(path.join(entryPath, name));
        syncDirectory(entryPath);
        return;
    }
    if (!stat.isFile()) throw new Error(`Refusing staged pack containing unsupported path: ${entryPath}`);
    const descriptor = openSync(entryPath, "r");
    try {
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
}

function assertStagedPackSafe(stagedDirectory: string, stagingRoot: string): void {
    assertRealDirectoryTree(stagedDirectory, stagingRoot, "staged pack");
}
function assertTransactionRootSafe(transactionRoot: string, packsDirectory: string): void {
    assertTemporaryRoot(transactionRoot, packsDirectory);
    const stat = lstatSync(transactionRoot);
    if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(path.dirname(transactionRoot)) !== realpathSync(packsDirectory)) {
        throw new Error(`Refusing redirected transaction root: ${transactionRoot}`);
    }
}


function assertRealDirectoryTree(directory: string, expectedParent: string, label: string): void {
    const parentStat = lstatSync(expectedParent);
    if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) throw new Error(`Refusing redirected transaction root: ${expectedParent}`);
    const stat = lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Refusing invalid ${label} directory: ${directory}`);
    if (realpathSync(path.dirname(directory)) !== realpathSync(expectedParent)) throw new Error(`Refusing ${label} outside transaction root: ${directory}`);
    rejectSymlinkDescendants(directory, label);
}

function rejectSymlinkDescendants(directory: string, label: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`Refusing ${label} containing redirected path: ${entryPath}`);
        if (entry.isDirectory()) rejectSymlinkDescendants(entryPath, label);
    }
}

function assertSafePacksDirectory(rootDirectory: string, packsDirectory: string): void {
    const canonicalRoot = realpathSync(rootDirectory);
    if (existsSync(packsDirectory) && lstatSync(packsDirectory).isSymbolicLink()) throw new Error(`Refusing redirected packs directory: ${packsDirectory}`);
    mkdirSync(packsDirectory, { recursive: true });
    const canonicalPacks = realpathSync(packsDirectory);
    const relative = path.relative(canonicalRoot, canonicalPacks);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Refusing packs directory outside repository: ${canonicalPacks}`);
    }
}

function assertExistingLivePacksSafe(stagedPacks: readonly StagedPack[], packsDirectory: string, dependencies: CompileDependencies): void {
    let replacingLivePack = false;
    for (const { pack } of stagedPacks) {
        const liveDirectory = path.join(packsDirectory, pack.name);
        if (isSymbolicLink(liveDirectory)) throw new Error(`Refusing redirected live pack directory: ${liveDirectory}`);
        if (!dependencies.directoryExists(liveDirectory)) continue;
        const stat = lstatSync(liveDirectory);
        if (!stat.isDirectory()) throw new Error(`Refusing invalid live pack directory: ${liveDirectory}`);
        replacingLivePack = true;
    }
    if (replacingLivePack && process.env.SF2E_FOUNDRY_OFFLINE !== "1") throw offlineError();
}

function offlineError(): Error {
    return new Error("Refusing to replace existing live packs. Close Foundry and set SF2E_FOUNDRY_OFFLINE=1 to assert that Foundry is offline.");
}

function isSymbolicLink(file: string): boolean {
    try {
        return lstatSync(file).isSymbolicLink();
    } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") return false;
        throw error;
    }
}

function cleanupTemporaryRoots(temporaryRoots: Array<string | undefined>, packsDirectory: string, dependencies: CompileDependencies): unknown[] {
    const errors: unknown[] = [];
    for (const temporaryRoot of temporaryRoots) {
        if (temporaryRoot === undefined) continue;
        try {
            assertTemporaryRoot(temporaryRoot, packsDirectory);
            dependencies.removeDirectory(temporaryRoot);
        } catch (error) {
            errors.push(error);
        }
    }
    return errors;
}

function assertTemporaryRoot(temporaryRoot: string, packsDirectory: string): void {
    const relative = path.relative(packsDirectory, temporaryRoot);
    const basename = path.basename(temporaryRoot);
    const hasExpectedPrefix = [STAGE_PREFIX, BACKUP_PREFIX].some((prefix) => basename.startsWith(prefix) && basename.length > prefix.length);
    if (relative.startsWith("..") || path.isAbsolute(relative) || path.dirname(relative) !== "." || !hasExpectedPrefix) {
        throw new Error(`Refusing to remove unsafe temporary directory: ${temporaryRoot}`);
    }
}

function assertSafePackDefinitions(packs: PackDef[]): void {
    const names = new Set<string>();
    const paths = new Set<string>();
    for (const pack of packs) {
        assertSafePackName(pack.name);
        const expectedPath = `packs/${pack.name}`;
        if (pack.path !== expectedPath) throw new Error(`Invalid pack path for ${pack.name}: expected ${expectedPath}`);
        const caseFoldedPath = pack.path.toLowerCase();
        if (paths.has(caseFoldedPath)) throw new Error(`Duplicate pack path: ${pack.path}`);
        paths.add(caseFoldedPath);
        const caseFoldedName = pack.name.toLowerCase();
        if (names.has(caseFoldedName)) throw new Error(`Duplicate pack name: ${pack.name}`);
        names.add(caseFoldedName);
    }
}

function assertSafePackName(packName: string): void {
    const caseFoldedName = packName.toLowerCase();
    if (!PORTABLE_PACK_NAME.test(packName) || packName.length === 0 || packName === "." || packName === ".." || caseFoldedName === "_source" ||
        caseFoldedName.startsWith(STAGE_PREFIX) || caseFoldedName.startsWith(BACKUP_PREFIX) || caseFoldedName === ".compile-lock" || caseFoldedName === ".compile-lock-reclaim" ||
        packName.endsWith(".") || packName.endsWith(" ") || path.basename(packName) !== packName || WINDOWS_DEVICE_NAME.test(packName)) {
        throw new Error(`Invalid pack name: ${packName}`);
    }
}

function syncDirectory(directory: string): void {
    const descriptor = openSync(directory, "r");
    try {
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
}

function isMainModule(): boolean {
    const entryPoint = process.argv[1];
    return entryPoint !== undefined && import.meta.url === pathToFileURL(path.resolve(entryPoint)).href;
}

if (isMainModule()) {
    try {
        compileConfiguredPacks();
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
}
