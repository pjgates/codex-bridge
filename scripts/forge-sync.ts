#!/usr/bin/env tsx
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { encryptPayload } from "../src/sync/crypto.js";
import { buildPayload } from "./sync/build-payload.js";
import { deploy, stageSyncOut, type RemoteConfig } from "./sync/deploy.js";

interface Config { vaultPath: string; campaign: string; remote: RemoteConfig; }

async function loadDotEnv(dir: string): Promise<void> {
    try {
        for (const line of (await readFile(path.join(dir, ".env"), "utf-8")).split("\n")) {
            const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
            if (match && !(match[1] in process.env)) process.env[match[1]] = match[2];
        }
    } catch { /* no .env — env var may be set directly */ }
}

const program = new Command();
program.command("push").option("--dry-run", "build and report; no encrypt, no rsync").action(async (opts: { dryRun?: boolean }) => {
    const rootDir = path.resolve(import.meta.dirname, "..");
    await loadDotEnv(rootDir);
    const config = JSON.parse(await readFile(path.join(rootDir, "forge-sync.config.json"), "utf-8")) as Config;
    const result = await buildPayload({ vaultPath: config.vaultPath, campaign: config.campaign });
    for (const warning of result.warnings) console.warn(`  warn: ${warning}`);
    console.log(`Entities: ${result.payload.entities.length}  Creatures: ${result.payload.creatures.length}  Art: ${result.artFiles.size}  Minted syncIds: ${result.mintedFiles.length}`);
    if (opts.dryRun) return;
    const passphrase = process.env.FORGE_SYNC_PASSPHRASE;
    if (!passphrase) throw new Error("FORGE_SYNC_PASSPHRASE is not set (put it in .env)");
    const blob = await encryptPayload(result.payload, passphrase);
    const outDir = path.join(rootDir, "sync-out");
    await stageSyncOut(result, blob, outDir);
    await deploy(outDir, config.remote);
    console.log(`Pushed manifest ${result.payload.manifestHash} to ${config.remote.host}:${config.remote.dataPath}/forge-sync/`);
});
await program.parseAsync();
