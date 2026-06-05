import { spawnSync as spawnProcessSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
    closeSync,
    fsyncSync,
    linkSync,
    lstatSync,
    openSync,
    readFileSync,
    rmSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";

const BUILD_LOCK_NAME = ".compile-lock";
const RECLAIM_LOCK_NAME = ".compile-lock-reclaim";
const LEGACY_OWNER_FILE = "owner.json";
const OWNER_VERSION = 2;
const MAX_OWNER_BYTES = 4 * 1024;
const PROCESS_IDENTITY_ENV = { ...process.env, LC_ALL: "C", TZ: "UTC" };
const DARWIN_PROCESS_START_SCRIPT = String.raw`
import ctypes, sys
class ProcBsdInfo(ctypes.Structure):
    _fields_ = [
        ("pbi_flags", ctypes.c_uint32), ("pbi_status", ctypes.c_uint32), ("pbi_xstatus", ctypes.c_uint32),
        ("pbi_pid", ctypes.c_uint32), ("pbi_ppid", ctypes.c_uint32), ("pbi_uid", ctypes.c_uint32),
        ("pbi_gid", ctypes.c_uint32), ("pbi_ruid", ctypes.c_uint32), ("pbi_rgid", ctypes.c_uint32),
        ("pbi_svuid", ctypes.c_uint32), ("pbi_svgid", ctypes.c_uint32), ("rfu_1", ctypes.c_uint32),
        ("pbi_comm", ctypes.c_char * 16), ("pbi_name", ctypes.c_char * 32), ("pbi_nfiles", ctypes.c_uint32),
        ("pbi_pgid", ctypes.c_uint32), ("pbi_pjobc", ctypes.c_uint32), ("e_tdev", ctypes.c_uint32),
        ("e_tpgid", ctypes.c_uint32), ("pbi_nice", ctypes.c_int32), ("pbi_start_tvsec", ctypes.c_uint64),
        ("pbi_start_tvusec", ctypes.c_uint64),
    ]
pid = int(sys.argv[1])
libproc = ctypes.CDLL("/usr/lib/libproc.dylib")
libproc.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
libproc.proc_pidinfo.restype = ctypes.c_int
info = ProcBsdInfo()
size = ctypes.sizeof(info)
if libproc.proc_pidinfo(pid, 3, 0, ctypes.byref(info), size) == size and info.pbi_pid == pid:
    print(f"{info.pbi_start_tvsec}:{info.pbi_start_tvusec}")
`;
const WINDOWS_PROCESS_START_SCRIPT = String.raw`$instance = @(Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId = ' + $args[0]) -ErrorAction Stop); if ($instance.Count -eq 1 -and $null -ne $instance[0].CreationDate) { [Console]::Out.Write($instance[0].CreationDate.ToUniversalTime().ToString("o", [Globalization.CultureInfo]::InvariantCulture)) }`;
const WINDOWS_PROCESS_START_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{7}Z$/;


export interface BuildLockOwner {
    version: 2;
    pid: number;
    processStartIdentity: string;
    token: string;
    acquiredAt: string;
}
export interface BuildLockDependencies {
    processStartIdentity(pid: number): string | undefined;
    platform: NodeJS.Platform;
    spawnSync(command: string, args: string[], options: { encoding: "utf8"; env: NodeJS.ProcessEnv }): { status: number | null; stdout: string };
}

type ResolvedBuildLockDependencies = Pick<BuildLockDependencies, "platform" | "processStartIdentity">;

export interface BuildLock {
    path: string;
    owner: BuildLockOwner;
    /** Set by acquireBuildLock so release uses the same durability semantics; optional for injected locks. */
    platform?: NodeJS.Platform;
}

export function acquireBuildLock(packsDirectory: string, dependencyOverrides: Partial<BuildLockDependencies> = {}): BuildLock {
    const platform = dependencyOverrides.platform ?? process.platform;
    const identitySpawn: BuildLockDependencies["spawnSync"] = dependencyOverrides.spawnSync ?? spawnProcessSync;
    const dependencies: ResolvedBuildLockDependencies = {
        platform,
        processStartIdentity: dependencyOverrides.processStartIdentity ?? ((pid) => processStartIdentity(pid, platform, identitySpawn)),
    };
    const lockPath = path.join(packsDirectory, BUILD_LOCK_NAME);
    for (;;) {
        refuseActiveReclaimer(packsDirectory, dependencies);
        const lock = tryPublishLock(lockPath, dependencies);
        if (lock) {
            if (!pathExists(path.join(packsDirectory, RECLAIM_LOCK_NAME))) return lock;
            releaseBuildLock(lock);
            continue;
        }
        reclaimStaleBuildLock(packsDirectory, lockPath, dependencies);
    }
}

export function releaseBuildLock(lock: BuildLock): void {
    const current = readLockOwner(lock.path);
    if (!current || current.token !== lock.owner.token) {
        throw new Error(`Refusing to release build lock not owned by this process: ${lock.path}`);
    }
    unlinkSync(lock.path);
    syncDirectory(path.dirname(lock.path), lock.platform ?? process.platform);
}


function reclaimStaleBuildLock(packsDirectory: string, lockPath: string, dependencies: ResolvedBuildLockDependencies): void {
    const claimPath = path.join(packsDirectory, RECLAIM_LOCK_NAME);
    const claim = tryPublishLock(claimPath, dependencies);
    if (!claim) {
        const livePid = liveLockOwnerPid(claimPath, dependencies);
        if (livePid !== undefined) throw activeOwnerError("Build-lock reclamation", claimPath, livePid);
        removeStaleLockConditionally(claimPath, dependencies);
        return;
    }

    try {
        if (!lockIsOwnedBy(claim)) return;
        const livePid = liveLockOwnerPid(lockPath, dependencies);
        if (livePid !== undefined) throw activeOwnerError("Build publication", lockPath, livePid);
        if (!lockIsOwnedBy(claim)) return;
        removeStaleLockConditionally(lockPath, dependencies);
    } finally {
        if (lockIsOwnedBy(claim)) releaseBuildLock(claim);
    }
}

function refuseActiveReclaimer(packsDirectory: string, dependencies: ResolvedBuildLockDependencies): void {
    const claimPath = path.join(packsDirectory, RECLAIM_LOCK_NAME);
    for (;;) {
        if (!pathExists(claimPath)) return;
        const livePid = liveLockOwnerPid(claimPath, dependencies);
        if (livePid !== undefined) throw activeOwnerError("Build-lock reclamation", claimPath, livePid);
        if (removeStaleLockConditionally(claimPath, dependencies)) return;
    }
}

function tryPublishLock(lockPath: string, dependencies: ResolvedBuildLockDependencies): BuildLock | undefined {
    const currentProcessIdentity = dependencies.processStartIdentity(process.pid);
    if (currentProcessIdentity === undefined) throw new Error(`Cannot establish process-start identity for build-lock owner PID ${process.pid}`);
    const owner: BuildLockOwner = {
        version: OWNER_VERSION,
        pid: process.pid,
        processStartIdentity: currentProcessIdentity,
        token: randomUUID(),
        acquiredAt: new Date().toISOString(),
    };
    const temporaryPath = path.join(path.dirname(lockPath), `${path.basename(lockPath)}-owner-${owner.token}.tmp`);
    let descriptor: number | undefined;
    let published = false;
    try {
        descriptor = openSync(temporaryPath, "wx", 0o600);
        writeFileSync(descriptor, JSON.stringify(owner));
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = undefined;
        try {
            linkSync(temporaryPath, lockPath);
            published = true;
        } catch (error) {
            if ((error as { code?: unknown }).code === "EEXIST") return undefined;
            throw error;
        }
        unlinkSync(temporaryPath);
        syncDirectory(path.dirname(lockPath), dependencies.platform);
        return { path: lockPath, owner, platform: dependencies.platform };
    } catch (error) {
        if (published) {
            try {
                const current = readLockOwner(lockPath);
                if (current?.token === owner.token) unlinkSync(lockPath);
                syncDirectory(path.dirname(lockPath), dependencies.platform);
            } catch (cleanupError) {
                throw new AggregateError([error, cleanupError], `Atomic build-lock publication failed and cleanup also failed: ${lockPath}`);
            }
        }
        throw error;
    } finally {
        if (descriptor !== undefined) closeSync(descriptor);
        rmSync(temporaryPath, { force: true });
    }
}

function readLockOwner(lockPath: string): BuildLockOwner | undefined {
    try {
        const lockStat = lstatSync(lockPath);
        const ownerPath = lockStat.isDirectory() ? path.join(lockPath, LEGACY_OWNER_FILE) : lockPath;
        const ownerStat = lockStat.isDirectory() ? lstatSync(ownerPath) : lockStat;
        if ((!lockStat.isDirectory() && !lockStat.isFile()) || ownerStat.isSymbolicLink() || !ownerStat.isFile() || ownerStat.size > MAX_OWNER_BYTES) {
            return undefined;
        }
        const value = JSON.parse(readFileSync(ownerPath, "utf8")) as Partial<BuildLockOwner>;
        return value.version === OWNER_VERSION && typeof value.pid === "number" && Number.isSafeInteger(value.pid) && value.pid > 0 &&
            typeof value.processStartIdentity === "string" && value.processStartIdentity.length > 0 &&
            typeof value.token === "string" && value.token.length > 0 && typeof value.acquiredAt === "string" && value.acquiredAt.length > 0
            ? value as BuildLockOwner
            : undefined;
    } catch {
        return undefined;
    }
}

function liveLockOwnerPid(lockPath: string, dependencies: ResolvedBuildLockDependencies): number | undefined {
    const current = readLockOwner(lockPath);
    if (current) return ownerIsAlive(current, dependencies) ? current.pid : undefined;

    // Pre-v2 directory locks do not carry a process-start identity. Preserve a
    // reachable legacy owner, but never publish another unauthenticated lock.
    try {
        const lockStat = lstatSync(lockPath);
        const legacyOwnerPath = lockStat.isDirectory() ? path.join(lockPath, LEGACY_OWNER_FILE) : lockPath;
        const legacyStat = lockStat.isDirectory() ? lstatSync(legacyOwnerPath) : lockStat;
        if ((!lockStat.isDirectory() && !lockStat.isFile()) || legacyStat.isSymbolicLink() || !legacyStat.isFile() || legacyStat.size > MAX_OWNER_BYTES) return undefined;
        const legacy = JSON.parse(readFileSync(legacyOwnerPath, "utf8")) as { pid?: unknown };
        if (typeof legacy.pid !== "number" || !Number.isSafeInteger(legacy.pid) || legacy.pid <= 0) return undefined;
        return pidExists(legacy.pid) ? legacy.pid : undefined;
    } catch {
        return undefined;
    }
}

function ownerIsAlive(owner: Pick<BuildLockOwner, "pid" | "processStartIdentity">, dependencies: ResolvedBuildLockDependencies): boolean {
    if (processIsZombie(owner.pid)) return false;
    const currentIdentity = dependencies.processStartIdentity(owner.pid);
    if (currentIdentity !== undefined) return currentIdentity === owner.processStartIdentity;
    return pidExists(owner.pid);
}

function pidExists(pid: number): boolean {
    if (processIsZombie(pid)) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as { code?: unknown }).code === "EPERM";
    }
}

function processIsZombie(pid: number): boolean {
    if (process.platform === "linux") {
        try {
            const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
            return stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/, 1)[0] === "Z";
        } catch {
            return false;
        }
    }
    if (process.platform === "darwin") {
        const result = spawnProcessSync("ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8", env: PROCESS_IDENTITY_ENV });
        return result.status === 0 && result.stdout.trimStart().startsWith("Z");
    }
    return false;
}

function processStartIdentity(
    pid: number,
    platform: NodeJS.Platform,
    identitySpawn: BuildLockDependencies["spawnSync"],
): string | undefined {
    if (platform === "linux") {
        try {
            const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
            const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
            const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
            const startTime = fields[19];
            return bootId && startTime && /^\d+$/.test(startTime) ? `linux:${bootId}:${startTime}` : undefined;
        } catch {
            return undefined;
        }
    }
    if (platform === "darwin") {
        const started = spawnProcessStart(identitySpawn, "python3", ["-c", DARWIN_PROCESS_START_SCRIPT, String(pid)]);
        return /^\d+:\d+$/.test(started) ? `darwin:${started}` : undefined;
    }
    if (platform === "win32") {
        const started = spawnProcessStart(identitySpawn, "powershell.exe", [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            WINDOWS_PROCESS_START_SCRIPT,
            String(pid),
        ]);
        return WINDOWS_PROCESS_START_PATTERN.test(started) ? `win32:${started}` : undefined;
    }
    return undefined;
}

function spawnProcessStart(identitySpawn: BuildLockDependencies["spawnSync"], command: string, args: string[]): string {
    try {
        const result = identitySpawn(command, args, { encoding: "utf8", env: PROCESS_IDENTITY_ENV });
        return result.status === 0 && typeof result.stdout === "string" ? result.stdout.trim() : "";
    } catch {
        return "";
    }
}

function activeOwnerError(label: string, lockPath: string, pid: number): Error {
    return new Error(`${label} appears owned by PID ${pid}: ${lockPath}. If this lock is stale or its process identity is ambiguous, remove it manually only after confirming no converter or compiler process is active.`);
}

function lockIsOwnedBy(lock: BuildLock): boolean {
    return readLockOwner(lock.path)?.token === lock.owner.token;
}

function pathExists(target: string): boolean {
    try {
        lstatSync(target);
        return true;
    } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") return false;
        throw error;
    }
}

function removeStaleLockConditionally(target: string, dependencies: ResolvedBuildLockDependencies): boolean {
    let stat;
    try {
        stat = lstatSync(target);
    } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") return false;
        throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`Cannot safely reclaim non-file build lock; remove it manually after confirming no publisher is active: ${target}`);
    }

    const quarantine = path.join(path.dirname(target), `${path.basename(target)}-owner-stale-${randomUUID()}.tmp`);
    try {
        try {
            linkSync(target, quarantine);
        } catch (error) {
            if ((error as { code?: unknown }).code === "ENOENT") return false;
            throw error;
        }
        const captured = lstatSync(quarantine);
        if (liveLockOwnerPid(quarantine, dependencies) !== undefined) return false;
        let current;
        try {
            current = lstatSync(target);
        } catch (error) {
            if ((error as { code?: unknown }).code === "ENOENT") return false;
            throw error;
        }
        if (current.dev !== captured.dev || current.ino !== captured.ino) return false;
        const capturedToken = readLockOwner(quarantine)?.token;
        const currentToken = readLockOwner(target)?.token;
        if (capturedToken !== currentToken) return false;
        unlinkSync(target);
        syncDirectory(path.dirname(target), dependencies.platform);
        return true;
    } finally {
        rmSync(quarantine, { force: true });
    }
}


function syncDirectory(directory: string, platform: NodeJS.Platform): void {
    if (platform === "win32") return;
    const descriptor = openSync(directory, "r");
    try {
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
}
