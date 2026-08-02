import { describe, expect, it } from "vitest";
import { deploy } from "./deploy.js";

describe("deploy", () => {
    it("rsyncs art before the payload blob, art with --delete", async () => {
        const calls: string[][] = [];
        await deploy("/tmp/sync-out", { host: "gm@vm", dataPath: "/srv/foundry/Data" },
            async (cmd, args) => { calls.push([cmd, ...args]); });
        expect(calls).toEqual([
            ["ssh", "gm@vm", "mkdir", "-p", "/srv/foundry/Data/codex-sync/art"],
            ["rsync", "-az", "--delete", "/tmp/sync-out/art/", "gm@vm:/srv/foundry/Data/codex-sync/art/"],
            ["rsync", "-az", "/tmp/sync-out/payload.enc", "gm@vm:/srv/foundry/Data/codex-sync/payload.enc"],
        ]);
    });
});
