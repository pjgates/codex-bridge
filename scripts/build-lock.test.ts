import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireBuildLock, releaseBuildLock, type BuildLockDependencies } from "./build-lock.js";

const temporaryRoots: string[] = [];
const WINDOWS_PROCESS_START = "2026-06-05T12:34:56.1234567Z";

const fsyncKinds = vi.hoisted<Array<"directory" | "file">>(() => []);

vi.mock("node:fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs")>();
    return {
        ...actual,
        fsyncSync: (descriptor: number): void => {
            const kind = actual.fstatSync(descriptor).isDirectory() ? "directory" : "file";
            fsyncKinds.push(kind);
            if (kind === "file" || process.platform !== "win32") actual.fsyncSync(descriptor);
        },
    };
});

beforeEach(() => {
    fsyncKinds.length = 0;
});


afterEach(() => {
    for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("build lock", () => {
    it("publishes the fixed lock atomically with complete owner metadata", () => {
        const packsDirectory = makePacksDirectory();
        const lock = acquireBuildLock(packsDirectory);
        const fixedPath = path.join(packsDirectory, ".compile-lock");
        expect(lstatSync(fixedPath).isFile()).toBe(true);
        expect(JSON.parse(readFileSync(fixedPath, "utf8"))).toEqual(lock.owner);
        expect(lock.owner).toMatchObject({ version: 2, pid: process.pid });
        expect(lock.owner.processStartIdentity).not.toBe("");
        expect(lock.owner.token).not.toBe("");
        expect(lock.owner.acquiredAt).not.toBe("");
        expect(readdirSync(packsDirectory).filter((name) => name.includes("-owner-") || name.endsWith(".tmp"))).toEqual([]);

        releaseBuildLock(lock);
        expect(existsSync(fixedPath)).toBe(false);
    });

    it("ignores an interrupted temporary owner publication and acquires a complete fixed lock", () => {
        const packsDirectory = makePacksDirectory();
        const interrupted = path.join(packsDirectory, ".compile-lock-owner-interrupted.tmp");
        writeFileSync(interrupted, "");

        const lock = acquireBuildLock(packsDirectory);

        expect(JSON.parse(readFileSync(path.join(packsDirectory, ".compile-lock"), "utf8"))).toEqual(lock.owner);
        expect(existsSync(interrupted)).toBe(true);
        releaseBuildLock(lock);
    });

    it("reclaims a dead complete owner before granting exclusive ownership", () => {
        const packsDirectory = makePacksDirectory();
        const fixedPath = path.join(packsDirectory, ".compile-lock");
        writeFileSync(fixedPath, JSON.stringify({
            version: 1,
            pid: 2_147_483_647,
            token: "dead-owner",
            acquiredAt: new Date(0).toISOString(),
        }));

        const lock = acquireBuildLock(packsDirectory);

        expect(lock.owner.token).not.toBe("dead-owner");
        expect(JSON.parse(readFileSync(fixedPath, "utf8"))).toEqual(lock.owner);
        expect(existsSync(path.join(packsDirectory, ".compile-lock-reclaim"))).toBe(false);
        releaseBuildLock(lock);
    });

    it("fails closed when the current process-start identity cannot be established", () => {
        const packsDirectory = makePacksDirectory();

        expect(() => acquireBuildLock(packsDirectory, { processStartIdentity: () => undefined }))
            .toThrow("Cannot establish process-start identity");
        expect(existsSync(path.join(packsDirectory, ".compile-lock"))).toBe(false);
        expect(fsyncKinds).toEqual([]);
    });
    it("acquires and releases a Windows lock with a CIM process-start identity and without directory fsync", () => {
        const packsDirectory = makePacksDirectory();
        const spawnSync = windowsIdentitySpawn(WINDOWS_PROCESS_START);

        const lock = acquireBuildLock(packsDirectory, { platform: "win32", spawnSync });

        expect(lock.owner.processStartIdentity).toBe(`win32:${WINDOWS_PROCESS_START}`);
        expect(spawnSync).toHaveBeenCalledWith(
            "powershell.exe",
            ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", expect.stringContaining("Get-CimInstance -ClassName Win32_Process"), String(process.pid)],
            expect.objectContaining({ encoding: "utf8" }),
        );
        expect(fsyncKinds).toEqual(["file"]);
        releaseBuildLock(lock);
        expect(existsSync(lock.path)).toBe(false);
        expect(fsyncKinds).toEqual(["file"]);
    });

    it.each(["linux", "darwin"] as const)("fsyncs the lock file and containing directory on %s acquisition and release", (platform) => {
        const packsDirectory = makePacksDirectory();
        const lock = acquireBuildLock(packsDirectory, { platform, processStartIdentity: () => `${platform}:current-process` });

        expect(fsyncKinds).toEqual(["file", "directory"]);

        releaseBuildLock(lock);
        expect(fsyncKinds).toEqual(["file", "directory", "directory"]);
    });

    it.each([
        ["missing", ""],
        ["malformed", "2026-06-05 12:34:56"],
    ])("fails closed without publishing when the Windows process identity response is %s", (_label, stdout) => {
        const packsDirectory = makePacksDirectory();

        expect(() => acquireBuildLock(packsDirectory, { platform: "win32", spawnSync: windowsIdentitySpawn(stdout) }))
            .toThrow("Cannot establish process-start identity");
        expect(existsSync(path.join(packsDirectory, ".compile-lock"))).toBe(false);
    });

    it("reclaims a Windows lock when CIM proves its PID was reused", () => {
        const packsDirectory = makePacksDirectory();
        const fixedPath = path.join(packsDirectory, ".compile-lock");
        writeFileSync(fixedPath, JSON.stringify({
            version: 2,
            pid: process.pid,
            processStartIdentity: "win32:2026-06-05T11:00:00.0000000Z",
            token: "prior-windows-process",
            acquiredAt: new Date(0).toISOString(),
        }));

        const lock = acquireBuildLock(packsDirectory, { platform: "win32", spawnSync: windowsIdentitySpawn(WINDOWS_PROCESS_START) });

        expect(lock.owner.processStartIdentity).toBe(`win32:${WINDOWS_PROCESS_START}`);
        expect(lock.owner.token).not.toBe("prior-windows-process");
        releaseBuildLock(lock);
    });

    it("preserves a live Windows lock when CIM cannot establish an unambiguous identity", () => {
        const packsDirectory = makePacksDirectory();
        const fixedPath = path.join(packsDirectory, ".compile-lock");
        const owner = {
            version: 2,
            pid: process.pid,
            processStartIdentity: `win32:${WINDOWS_PROCESS_START}`,
            token: "live-windows-process",
            acquiredAt: new Date(0).toISOString(),
        };
        writeFileSync(fixedPath, JSON.stringify(owner));

        expect(() => acquireBuildLock(packsDirectory, { platform: "win32", spawnSync: windowsIdentitySpawn("ambiguous\nresponse") }))
            .toThrow("Cannot establish process-start identity");
        expect(JSON.parse(readFileSync(fixedPath, "utf8"))).toEqual(owner);
    });


    it("reclaims a stale lock when its PID has been reused by a different process instance", () => {
        const packsDirectory = makePacksDirectory();
        const fixedPath = path.join(packsDirectory, ".compile-lock");
        writeFileSync(fixedPath, JSON.stringify({
            version: 2,
            pid: process.pid,
            processStartIdentity: "prior-process-instance",
            token: "dead-owner",
            acquiredAt: new Date(0).toISOString(),
        }));

        const lock = acquireBuildLock(packsDirectory, { processStartIdentity: () => "current-process-instance" });

        expect(lock.owner.processStartIdentity).toBe("current-process-instance");
        expect(lock.owner.token).not.toBe("dead-owner");
        releaseBuildLock(lock);
    });

    it("preserves a live lock whose PID and process-start identity still match", () => {
        const packsDirectory = makePacksDirectory();
        const dependencies = { processStartIdentity: () => "current-process-instance" };
        const lock = acquireBuildLock(packsDirectory, dependencies);

        expect(() => acquireBuildLock(packsDirectory, dependencies)).toThrow("Build publication appears owned");
        expect(JSON.parse(readFileSync(lock.path, "utf8"))).toEqual(lock.owner);
        releaseBuildLock(lock);
    });

    it("fails closed when a non-file legacy lock cannot be identity-checked", () => {
        const packsDirectory = makePacksDirectory();
        const fixedPath = path.join(packsDirectory, ".compile-lock");
        mkdirSync(fixedPath);

        expect(() => acquireBuildLock(packsDirectory)).toThrow("Cannot safely reclaim non-file build lock");
        expect(lstatSync(fixedPath).isDirectory()).toBe(true);
    });

    it("reclaims a stale authenticated reclaimer before publishing", () => {
        const packsDirectory = makePacksDirectory();
        writeFileSync(path.join(packsDirectory, ".compile-lock-reclaim"), JSON.stringify({
            version: 2,
            pid: process.pid,
            processStartIdentity: "prior-process-instance",
            token: "stale-reclaimer",
            acquiredAt: new Date(0).toISOString(),
        }));

        const lock = acquireBuildLock(packsDirectory, { processStartIdentity: () => "current-process-instance" });

        expect(existsSync(path.join(packsDirectory, ".compile-lock-reclaim"))).toBe(false);
        releaseBuildLock(lock);
    });

    it("does not reclaim a live legacy directory lock", () => {
        const packsDirectory = makePacksDirectory();
        const fixedPath = path.join(packsDirectory, ".compile-lock");
        mkdirSync(fixedPath);
        writeFileSync(path.join(fixedPath, "owner.json"), JSON.stringify({ pid: process.pid }));

        expect(() => acquireBuildLock(packsDirectory)).toThrow("Build publication appears owned");
        expect(lstatSync(fixedPath).isDirectory()).toBe(true);
    });

    it("reclaims a malformed fixed lock left by a failed legacy acquisition", () => {
        const packsDirectory = makePacksDirectory();
        const fixedPath = path.join(packsDirectory, ".compile-lock");
        writeFileSync(fixedPath, "");

        const lock = acquireBuildLock(packsDirectory);

        expect(JSON.parse(readFileSync(fixedPath, "utf8"))).toEqual(lock.owner);
        releaseBuildLock(lock);
    });

    it("does not release a lock whose ownership token changed", () => {
        const packsDirectory = makePacksDirectory();
        const lock = acquireBuildLock(packsDirectory);
        writeFileSync(lock.path, JSON.stringify({ ...lock.owner, token: "replacement-owner" }));

        expect(() => releaseBuildLock(lock)).toThrow("not owned by this process");
        expect(existsSync(lock.path)).toBe(true);
    });
});

function makePacksDirectory(): string {
    const root = mkdtempSync(path.join(os.tmpdir(), "build-lock-test-"));
    temporaryRoots.push(root);
    const packsDirectory = path.join(root, "packs");
    mkdirSync(packsDirectory);
    return packsDirectory;
}

function windowsIdentitySpawn(stdout: string): BuildLockDependencies["spawnSync"] {
    return vi.fn(() => ({ status: 0, stdout }));
}
