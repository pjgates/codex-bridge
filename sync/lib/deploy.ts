import { execFile } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { BuildResult } from "./build-payload.js";

const execFileAsync = promisify(execFile);
export type RunCommand = (cmd: string, args: string[]) => Promise<void>;
export interface RemoteConfig { host: string; dataPath: string; }

const defaultRun: RunCommand = async (cmd, args) => { await execFileAsync(cmd, args); };

export async function stageSyncOut(result: BuildResult, blob: string, outDir: string): Promise<void> {
    await rm(outDir, { recursive: true, force: true });
    await mkdir(path.join(outDir, "art"), { recursive: true });
    for (const [source, relative] of result.artFiles) {
        await cp(source, path.join(outDir, relative));
    }
    await writeFile(path.join(outDir, "payload.enc"), blob);
}

export async function deploy(outDir: string, remote: RemoteConfig, run: RunCommand = defaultRun): Promise<void> {
    const target = `${remote.dataPath}/codex-sync`;
    await run("ssh", [remote.host, "mkdir", "-p", `${target}/art`]);
    // Art first, payload last — a client never sees a payload referencing missing art.
    await run("rsync", ["-az", "--delete", `${outDir}/art/`, `${remote.host}:${target}/art/`]);
    await run("rsync", ["-az", `${outDir}/payload.enc`, `${remote.host}:${target}/payload.enc`]);
}
