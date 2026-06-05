import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync } from "node:fs";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, rm, unlink } from "node:fs/promises";
import path from "node:path";

export interface SnapshotFile {
    basename: string;
    content: string | (() => string);
}

export type SnapshotWriter = (outputDir: string, files: readonly SnapshotFile[], dryRun: boolean) => Promise<void>;

export interface SnapshotParentTrust {
    readonly parentDir: string;
    readonly canonicalParentDir: string;
    readonly identity: string;
}

export interface SnapshotPromotionOptions {
    trustedParent?: SnapshotParentTrust;
    removeBackup?: (backupDir: string) => Promise<void>;
    onBackupCleanupError?: (backupDir: string, error: unknown) => void;
}

interface StagedSnapshot {
    liveDir: string;
    stageDir: string;
}

interface PromotionRecord {
    liveBasename: string;
    stageBasename: string;
    backupBasename: string;
    hadLive: boolean;
    moved: boolean;
    promoted: boolean;
}

interface PromotionJournal {
    version: 1;
    transaction: string;
    committed: boolean;
    entries: PromotionRecord[];
}

const JOURNAL_FILE = ".source-snapshot-promotion.json";
const JOURNAL_TEMP_FILE = ".source-snapshot-promotion.json.tmp";
const MAX_JOURNAL_BYTES = 64 * 1024;
const MAX_JOURNAL_ENTRIES = 256;
const TRANSACTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Bind snapshot operations to the current non-symlink parent directory object. */
export async function establishSnapshotParentTrust(parentDir: string): Promise<SnapshotParentTrust> {
    const resolved = path.resolve(parentDir);
    const metadata = await lstat(resolved, { bigint: true });
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error(`Snapshot parent is not a trusted directory: ${resolved}`);
    return Object.freeze({ parentDir: resolved, canonicalParentDir: await realpath(resolved), identity: identity(metadata) });
}

/** Recover a converter promotion interrupted by process death. Must be called while holding the shared build lock. */
export async function recoverSourceSnapshotPromotion(sourceRoot: string): Promise<void> {
    const resolvedRoot = path.resolve(sourceRoot);
    if (!await pathExists(resolvedRoot)) return;
    const trust = await establishSnapshotParentTrust(resolvedRoot);
    const journalPath = path.join(resolvedRoot, JOURNAL_FILE);
    if (!await pathExists(journalPath)) {
        await removeTemporaryJournal(trust);
        return;
    }
    const journal = await readAndValidateJournal(journalPath);

    if (journal.committed) {
        for (const entry of journal.entries) {
            await removeTrustedChild(trust, entry.backupBasename);
            await removeTrustedChild(trust, entry.stageBasename);
        }
    } else {
        for (const entry of [...journal.entries].reverse()) await rollbackEntry(trust, entry);
    }
    await assertSnapshotParentTrust(trust);
    await rm(journalPath);
    await syncDirectory(resolvedRoot);
    await removeTemporaryJournal(trust);
}

/** Synchronous companion used by the synchronous pack compiler while it owns the shared build lock. */
export function recoverSourceSnapshotPromotionSync(sourceRoot: string): void {
    const resolvedRoot = path.resolve(sourceRoot);
    if (!pathExistsSync(resolvedRoot)) return;
    const trust = establishSnapshotParentTrustSync(resolvedRoot);
    const journalPath = path.join(resolvedRoot, JOURNAL_FILE);
    if (!pathExistsSync(journalPath)) {
        removeTemporaryJournalSync(trust);
        return;
    }
    const metadata = lstatSync(journalPath);
    if (!metadata.isFile() || metadata.size > MAX_JOURNAL_BYTES) throw new Error(`Refusing invalid source snapshot promotion journal: ${journalPath}`);
    let candidate: unknown;
    try {
        candidate = JSON.parse(readFileSync(journalPath, "utf-8"));
    } catch (error) {
        throw new Error(`Refusing invalid source snapshot promotion journal: ${journalPath}`, { cause: error });
    }
    const journal = validatePromotionJournal(candidate, journalPath);

    if (journal.committed) {
        for (const entry of journal.entries) {
            removeTrustedChildSync(trust, entry.backupBasename);
            removeTrustedChildSync(trust, entry.stageBasename);
        }
    } else {
        for (const entry of [...journal.entries].reverse()) rollbackEntrySync(trust, entry);
    }
    assertSnapshotParentTrustSync(trust);
    rmSync(journalPath);
    syncDirectorySync(resolvedRoot);
    removeTemporaryJournalSync(trust);
}

/** Replace an output directory with a complete rollback-safe snapshot. */
export async function writeSnapshot(
    outputDir: string,
    files: readonly SnapshotFile[],
    dryRun: boolean,
    promotionOptions?: SnapshotPromotionOptions,
): Promise<void> {
    const snapshot = await stageSnapshot(outputDir, files, dryRun, promotionOptions);
    if (!snapshot) return;
    try {
        await promoteSnapshots([snapshot], promotionOptions);
    } catch (error) {
        if (promotionOptions?.trustedParent) await removeTrustedChild(promotionOptions.trustedParent, path.basename(snapshot.stageDir));
        else await rm(snapshot.stageDir, { recursive: true, force: true });
        throw error;
    }
}

/** Write a complete snapshot without displacing the live directory. */
async function stageSnapshot(
    outputDir: string,
    files: readonly SnapshotFile[],
    dryRun: boolean,
    options: SnapshotPromotionOptions = {},
): Promise<StagedSnapshot | null> {
    validateFiles(files);
    if (dryRun) return null;

    const liveDir = path.resolve(outputDir);
    const parentDir = path.dirname(liveDir);
    const liveBasename = path.basename(liveDir);
    validateBasename(liveBasename);
    await assertExpectedParent(options.trustedParent, parentDir);

    const stageDir = path.join(parentDir, `.${liveBasename}.stage-${randomUUID()}`);
    if (options.trustedParent) await assertSnapshotParentTrust(options.trustedParent);
    else await mkdir(parentDir, { recursive: true });
    await mkdir(stageDir);
    try {
        await assertExpectedParent(options.trustedParent, parentDir);
        for (const file of files) {
            await assertExpectedParent(options.trustedParent, parentDir);
            const filePath = containedPath(stageDir, file.basename);
            await durableWriteFile(filePath, typeof file.content === "function" ? file.content() : file.content);
        }
        await assertExpectedParent(options.trustedParent, parentDir);
        await syncDirectory(stageDir);
        return { liveDir, stageDir };
    } catch (error) {
        if (options.trustedParent) await removeTrustedChild(options.trustedParent, path.basename(stageDir));
        else await rm(stageDir, { recursive: true, force: true });
        throw error;
    }
}

/** Stage several snapshots, then promote them together inside a short rollback boundary. */
export async function withSnapshotRollback(
    operation: (writeSnapshot: SnapshotWriter) => Promise<void>,
    beforePromotion?: () => Promise<void>,
    promotionOptions?: SnapshotPromotionOptions,
): Promise<void> {
    const snapshots: StagedSnapshot[] = [];
    const stage: SnapshotWriter = async (outputDir, files, dryRun) => {
        const snapshot = await stageSnapshot(outputDir, files, dryRun, promotionOptions);
        if (snapshot) snapshots.push(snapshot);
    };

    try {
        await operation(stage);
        if (beforePromotion) await beforePromotion();
        await promoteSnapshots(snapshots, promotionOptions);
    } catch (error) {
        for (const snapshot of snapshots) {
            if (promotionOptions?.trustedParent) await removeTrustedChild(promotionOptions.trustedParent, path.basename(snapshot.stageDir));
            else await rm(snapshot.stageDir, { recursive: true, force: true });
        }
        throw error;
    }
}

async function promoteSnapshots(snapshots: readonly StagedSnapshot[], options: SnapshotPromotionOptions = {}): Promise<void> {
    if (snapshots.length === 0) return;
    const transaction = randomUUID();
    const parentDir = path.dirname(snapshots[0]!.liveDir);
    await assertExpectedParent(options.trustedParent, parentDir);
    const records: PromotionRecord[] = [];
    for (const { liveDir, stageDir } of snapshots) {
        if (path.dirname(liveDir) !== parentDir || path.dirname(stageDir) !== parentDir) throw new Error("Cannot coordinate snapshots from different parent directories");
        const liveBasename = path.basename(liveDir);
        const stageBasename = path.basename(stageDir);
        validateBasename(liveBasename);
        validateTransientBasename(stageBasename, liveBasename, "stage");
        records.push({
            liveBasename,
            stageBasename,
            backupBasename: `.${liveBasename}.backup-${transaction}`,
            hadLive: await trustedChildExists(options.trustedParent, parentDir, liveBasename),
            moved: false,
            promoted: false,
        });
    }
    if (new Set(records.map(({ liveBasename }) => liveBasename)).size !== records.length) throw new Error("Cannot promote multiple snapshots for the same output directory");

    if (records.length > MAX_JOURNAL_ENTRIES) throw new Error(`Cannot promote more than ${MAX_JOURNAL_ENTRIES} snapshots in one transaction`);
    const journal: PromotionJournal = { version: 1, transaction, committed: false, entries: records };
    const journalPath = path.join(parentDir, JOURNAL_FILE);
    if (options.trustedParent && await pathExists(journalPath)) throw new Error(`Unresolved source snapshot promotion journal: ${journalPath}`);
    if (options.trustedParent) await writeJournal(options.trustedParent, journal);

    let promotionCommitted = false;
    try {
        for (const record of records) {
            if (!record.hadLive) continue;
            await renameTrustedChild(options.trustedParent, parentDir, record.liveBasename, record.backupBasename);
            record.moved = true;
            if (options.trustedParent) await writeJournal(options.trustedParent, journal);
        }
        for (const record of records) {
            await renameTrustedChild(options.trustedParent, parentDir, record.stageBasename, record.liveBasename);
            record.promoted = true;
            if (options.trustedParent) await writeJournal(options.trustedParent, journal);
        }
        await syncDirectory(parentDir);
        journal.committed = true;
        if (options.trustedParent) await writeJournal(options.trustedParent, journal);
        promotionCommitted = true;
    } catch (promotionError) {
        const restoreErrors: unknown[] = [];
        if (options.trustedParent) {
            try {
                await recoverSourceSnapshotPromotion(parentDir);
            } catch (error) {
                restoreErrors.push(error);
            }
        } else {
            for (const record of [...records].reverse()) {
                try {
                    const liveDir = path.join(parentDir, record.liveBasename);
                    if (record.promoted) await rm(liveDir, { recursive: true, force: true });
                    if (record.moved) await rename(path.join(parentDir, record.backupBasename), liveDir);
                } catch (error) {
                    restoreErrors.push(error);
                }
            }
        }
        if (restoreErrors.length > 0) throw new AggregateError([promotionError, ...restoreErrors], "Failed to restore snapshot outputs after promotion failure");
        throw promotionError;
    } finally {
        if (promotionCommitted) {
            await removeCommittedBackups(records, parentDir, options);
            if (options.trustedParent) {
                try {
                    await assertSnapshotParentTrust(options.trustedParent);
                    await rm(journalPath);
                    await syncDirectory(parentDir);
                } catch (error) {
                    reportBackupCleanupError(journalPath, error);
                }
            }
        } else if (!options.trustedParent) {
            for (const record of records) await rm(path.join(parentDir, record.stageBasename), { recursive: true, force: true });
        }
    }
}

async function removeCommittedBackups(records: readonly PromotionRecord[], parentDir: string, options: SnapshotPromotionOptions): Promise<void> {
    const removeBackup = options.removeBackup ?? removeBackupDirectory;
    const onError = options.onBackupCleanupError ?? reportBackupCleanupError;
    for (const record of records) {
        if (!record.moved) continue;
        const backupDir = path.join(parentDir, record.backupBasename);
        try {
            await assertExpectedParent(options.trustedParent, parentDir);
            await removeBackup(backupDir);
        } catch (error) {
            try {
                onError(backupDir, error);
            } catch {
                reportBackupCleanupError(backupDir, error);
            }
        }
    }
}

interface RollbackPlan {
    removeLive: boolean;
    restoreBackup: boolean;
}

function planRollbackEntry(entry: PromotionRecord, backupExists: boolean, liveExists: boolean): RollbackPlan {
    if (entry.hadLive) {
        if (backupExists) return { removeLive: liveExists, restoreBackup: true };
        if (!liveExists) throw new Error(`Cannot recover source snapshot ${entry.liveBasename}: prior live snapshot is unavailable`);
        return { removeLive: false, restoreBackup: false };
    }
    return { removeLive: liveExists, restoreBackup: false };
}

async function rollbackEntry(trust: SnapshotParentTrust, entry: PromotionRecord): Promise<void> {
    const plan = planRollbackEntry(
        entry,
        await trustedChildExists(trust, trust.parentDir, entry.backupBasename),
        await trustedChildExists(trust, trust.parentDir, entry.liveBasename),
    );
    if (plan.removeLive) await removeTrustedChild(trust, entry.liveBasename);
    if (plan.restoreBackup) await renameTrustedChild(trust, trust.parentDir, entry.backupBasename, entry.liveBasename);
    await removeTrustedChild(trust, entry.stageBasename);
}

function rollbackEntrySync(trust: SnapshotParentTrust, entry: PromotionRecord): void {
    const plan = planRollbackEntry(entry, trustedChildExistsSync(trust, entry.backupBasename), trustedChildExistsSync(trust, entry.liveBasename));
    if (plan.removeLive) removeTrustedChildSync(trust, entry.liveBasename);
    if (plan.restoreBackup) renameTrustedChildSync(trust, entry.backupBasename, entry.liveBasename);
    removeTrustedChildSync(trust, entry.stageBasename);
}

async function removeTemporaryJournal(trust: SnapshotParentTrust): Promise<void> {
    await assertSnapshotParentTrust(trust);
    const temporaryPath = path.join(trust.parentDir, JOURNAL_TEMP_FILE);
    let metadata;
    try {
        metadata = await lstat(temporaryPath);
    } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") return;
        throw error;
    }
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`Refusing invalid source snapshot promotion temporary journal: ${temporaryPath}`);
    await assertSnapshotParentTrust(trust);
    await unlink(temporaryPath);
    await syncDirectory(trust.parentDir);
}

function removeTemporaryJournalSync(trust: SnapshotParentTrust): void {
    assertSnapshotParentTrustSync(trust);
    const temporaryPath = path.join(trust.parentDir, JOURNAL_TEMP_FILE);
    let metadata;
    try {
        metadata = lstatSync(temporaryPath);
    } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") return;
        throw error;
    }
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`Refusing invalid source snapshot promotion temporary journal: ${temporaryPath}`);
    assertSnapshotParentTrustSync(trust);
    unlinkSync(temporaryPath);
    syncDirectorySync(trust.parentDir);
}

async function readAndValidateJournal(journalPath: string): Promise<PromotionJournal> {
    const metadata = await lstat(journalPath);
    if (!metadata.isFile() || metadata.size > MAX_JOURNAL_BYTES) throw new Error(`Refusing invalid source snapshot promotion journal: ${journalPath}`);
    let candidate: unknown;
    try {
        candidate = JSON.parse(await readFile(journalPath, "utf-8"));
    } catch (error) {
        throw new Error(`Refusing invalid source snapshot promotion journal: ${journalPath}`, { cause: error });
    }
    return validatePromotionJournal(candidate, journalPath);
}

function validatePromotionJournal(candidate: unknown, journalPath: string): PromotionJournal {
    if (!isRecord(candidate) || candidate.version !== 1 || typeof candidate.transaction !== "string" || !TRANSACTION_ID.test(candidate.transaction)
        || typeof candidate.committed !== "boolean" || !Array.isArray(candidate.entries) || candidate.entries.length === 0
        || candidate.entries.length > MAX_JOURNAL_ENTRIES) {
        throw new Error(`Refusing invalid source snapshot promotion journal: ${journalPath}`);
    }
    const liveNames = new Set<string>();
    for (const value of candidate.entries) {
        if (!isRecord(value) || typeof value.liveBasename !== "string" || typeof value.stageBasename !== "string"
            || typeof value.backupBasename !== "string" || typeof value.hadLive !== "boolean" || typeof value.moved !== "boolean"
            || typeof value.promoted !== "boolean") throw new Error(`Refusing invalid source snapshot promotion journal entry: ${journalPath}`);
        validateBasename(value.liveBasename);
        validateTransientBasename(value.stageBasename, value.liveBasename, "stage");
        if (value.backupBasename !== `.${value.liveBasename}.backup-${candidate.transaction}` || liveNames.has(value.liveBasename)
            || (!value.hadLive && value.moved) || (value.hadLive && value.promoted && !value.moved)
            || (candidate.committed && !value.promoted)) {
            throw new Error(`Refusing invalid source snapshot promotion journal entry: ${journalPath}`);
        }
        liveNames.add(value.liveBasename);
    }
    return candidate as unknown as PromotionJournal;
}

async function writeJournal(trust: SnapshotParentTrust, journal: PromotionJournal): Promise<void> {
    const serialized = JSON.stringify(journal);
    if (Buffer.byteLength(serialized) > MAX_JOURNAL_BYTES) throw new Error("Source snapshot promotion journal exceeds safe size limit");
    await assertSnapshotParentTrust(trust);
    const temporaryPath = path.join(trust.parentDir, JOURNAL_TEMP_FILE);
    const journalPath = path.join(trust.parentDir, JOURNAL_FILE);
    await durableWriteFile(temporaryPath, serialized, 0o600);
    await assertSnapshotParentTrust(trust);
    await rename(temporaryPath, journalPath);
    await syncDirectory(trust.parentDir);
}

async function renameTrustedChild(trust: SnapshotParentTrust | undefined, parentDir: string, fromBasename: string, toBasename: string): Promise<void> {
    validateChildBasename(fromBasename);
    validateChildBasename(toBasename);
    await assertExpectedParent(trust, parentDir);
    await rename(path.join(parentDir, fromBasename), path.join(parentDir, toBasename));
    await syncDirectory(parentDir);
}

async function removeTrustedChild(trust: SnapshotParentTrust, basename: string): Promise<void> {
    validateChildBasename(basename);
    await assertSnapshotParentTrust(trust);
    await rm(path.join(trust.parentDir, basename), { recursive: true, force: true });
    await syncDirectory(trust.parentDir);
}

async function trustedChildExists(trust: SnapshotParentTrust | undefined, parentDir: string, basename: string): Promise<boolean> {
    validateChildBasename(basename);
    await assertExpectedParent(trust, parentDir);
    return pathExists(path.join(parentDir, basename));
}

async function assertExpectedParent(trust: SnapshotParentTrust | undefined, parentDir: string): Promise<void> {
    if (!trust) return;
    if (path.resolve(parentDir) !== trust.parentDir) throw new Error(`Snapshot output is outside trusted parent: ${parentDir}`);
    await assertSnapshotParentTrust(trust);
}

async function assertSnapshotParentTrust(trust: SnapshotParentTrust): Promise<void> {
    const metadata = await lstat(trust.parentDir, { bigint: true });
    if (metadata.isSymbolicLink() || !metadata.isDirectory() || identity(metadata) !== trust.identity || await realpath(trust.parentDir) !== trust.canonicalParentDir) {
        throw new Error(`Snapshot parent identity changed: ${trust.parentDir}`);
    }
}

function establishSnapshotParentTrustSync(parentDir: string): SnapshotParentTrust {
    const resolved = path.resolve(parentDir);
    const metadata = lstatSync(resolved, { bigint: true });
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error(`Snapshot parent is not a trusted directory: ${resolved}`);
    return Object.freeze({ parentDir: resolved, canonicalParentDir: realpathSync(resolved), identity: identity(metadata) });
}

function assertSnapshotParentTrustSync(trust: SnapshotParentTrust): void {
    const metadata = lstatSync(trust.parentDir, { bigint: true });
    if (metadata.isSymbolicLink() || !metadata.isDirectory() || identity(metadata) !== trust.identity || realpathSync(trust.parentDir) !== trust.canonicalParentDir) {
        throw new Error(`Snapshot parent identity changed: ${trust.parentDir}`);
    }
}

function trustedChildExistsSync(trust: SnapshotParentTrust, basename: string): boolean {
    validateChildBasename(basename);
    assertSnapshotParentTrustSync(trust);
    return pathExistsSync(path.join(trust.parentDir, basename));
}

function removeTrustedChildSync(trust: SnapshotParentTrust, basename: string): void {
    validateChildBasename(basename);
    assertSnapshotParentTrustSync(trust);
    rmSync(path.join(trust.parentDir, basename), { recursive: true, force: true });
    syncDirectorySync(trust.parentDir);
}

function renameTrustedChildSync(trust: SnapshotParentTrust, fromBasename: string, toBasename: string): void {
    validateChildBasename(fromBasename);
    validateChildBasename(toBasename);
    assertSnapshotParentTrustSync(trust);
    renameSync(path.join(trust.parentDir, fromBasename), path.join(trust.parentDir, toBasename));
    syncDirectorySync(trust.parentDir);
}

function syncDirectorySync(directory: string): void {
    const descriptor = openSync(directory, "r");
    try {
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
}

async function durableWriteFile(filePath: string, content: string, mode = 0o666): Promise<void> {
    const handle = await open(filePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
    try {
        await handle.writeFile(content, "utf-8");
        await handle.sync();
    } finally {
        await handle.close();
    }
}

async function syncDirectory(directory: string): Promise<void> {
    const handle = await open(directory, "r");
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
}

function removeBackupDirectory(backupDir: string): Promise<void> {
    return rm(backupDir, { recursive: true, force: true });
}

function reportBackupCleanupError(backupDir: string, error: unknown): void {
    try {
        console.warn(`Snapshot promotion committed, but backup cleanup failed; backup retained at ${backupDir}`, error);
    } catch {
        // Reporting is also post-commit cleanup and must not reject a committed promotion.
    }
}

function validateFiles(files: readonly SnapshotFile[]): void {
    const basenames = new Set<string>();
    for (const file of files) {
        validateBasename(file.basename);
        if (basenames.has(file.basename)) throw new Error(`Duplicate snapshot basename: ${file.basename}`);
        basenames.add(file.basename);
    }
}

function validateBasename(basename: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(basename) || basename.includes("/") || basename.includes("\\")) {
        throw new Error(`Unsafe snapshot basename: ${JSON.stringify(basename)}`);
    }
}

function validateChildBasename(basename: string): void {
    if (!basename || basename === "." || basename === ".." || basename.includes("/") || basename.includes("\\")) {
        throw new Error(`Unsafe snapshot transaction basename: ${JSON.stringify(basename)}`);
    }
}

function validateTransientBasename(basename: string, liveBasename: string, kind: "stage"): void {
    validateChildBasename(basename);
    const prefix = `.${liveBasename}.${kind}-`;
    if (!basename.startsWith(prefix) || !TRANSACTION_ID.test(basename.slice(prefix.length))) throw new Error(`Unsafe snapshot transaction basename: ${JSON.stringify(basename)}`);
}

function containedPath(directory: string, basename: string): string {
    const candidate = path.resolve(directory, basename);
    const relative = path.relative(directory, candidate);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Snapshot path escapes staging directory: ${JSON.stringify(basename)}`);
    }
    return candidate;
}

function identity(metadata: { dev: bigint; ino: bigint }): string {
    return `${metadata.dev}:${metadata.ino}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function pathExistsSync(filePath: string): boolean {
    try {
        lstatSync(filePath);
        return true;
    } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") return false;
        throw error;
    }
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await lstat(filePath);
        return true;
    } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") return false;
        throw error;
    }
}
