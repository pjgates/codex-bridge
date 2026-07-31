import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPayload } from "./build-payload.js";

let vault: string;

beforeEach(async () => {
    vault = await mkdtemp(path.join(os.tmpdir(), "forge-sync-"));
    await mkdir(path.join(vault, "codex/the-forge/entities"), { recursive: true });
    await mkdir(path.join(vault, "codex/the-forge/bestiary"), { recursive: true });
    await mkdir(path.join(vault, "codex/assets"), { recursive: true });
    await writeFile(path.join(vault, "codex/assets/randall-20260726.webp"), "fake-webp");
});

afterEach(async () => {
    await rm(vault, { recursive: true, force: true });
});

const MINIMAL_CREATURE = `---
statblock: true
name: Minimal Creature
level: 1
ac: 15
hp: 20
attributes: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }
modifier: 0
saves: { fort: 0, ref: 0, will: 0 }
speed: 0
---
# Minimal
`;
const DUST_MANTA = MINIMAL_CREATURE
    .replace("name: Minimal Creature", "name: Dust Manta")
    .replace("level: 1", "level: 3")
    .replace("# Minimal", "# Dust Manta");

describe("buildPayload", () => {
    it("mints missing syncIds, writes them back, and extracts portraits", async () => {
        await writeFile(path.join(vault, "codex/the-forge/entities/randall.md"), `---
title: Randall
type: Character
portrait: "[[randall-20260726.webp]]"
published: false
---
# Randall

A companion of [[Wren-kadau]].
`);
        await writeFile(path.join(vault, "codex/the-forge/entities/wren-kadau.md"), `---
title: Wren Kadau
type: Character
syncId: fs-wren0001
published: false
---
# Wren Kadau

The ally.
`);

        const result = await buildPayload({ vaultPath: vault, campaign: "the-forge" });
        const randall = result.payload.entities.find((entry) => entry.slug === "randall")!;

        expect(randall.syncId).toMatch(/^fs-[a-z0-9]{8}$/);
        expect(randall.portrait).toBe(`art/${randall.syncId}.webp`);
        expect(randall.playerHtml).toContain("@ForgeSync[fs-wren0001]");
        expect(result.mintedFiles).toEqual([path.join(vault, "codex/the-forge/entities/randall.md")]);
        expect(await readFile(result.mintedFiles[0], "utf-8")).toContain(`syncId: ${randall.syncId}`);
        expect(result.artFiles.get(path.join(vault, "codex/assets/randall-20260726.webp"))).toBe(`art/${randall.syncId}.webp`);
        expect(result.warnings.some((warning) => warning.includes("wren-kadau"))).toBe(true);
    });

    it("hard-fails on duplicate syncIds naming both files", async () => {
        const duplicate = `---
title: A
type: Character
syncId: fs-same0000
published: false
---
\n`;
        await writeFile(path.join(vault, "codex/the-forge/entities/a.md"), duplicate);
        await writeFile(path.join(vault, "codex/the-forge/entities/b.md"), duplicate.replace("title: A", "title: B"));

        await expect(buildPayload({ vaultPath: vault, campaign: "the-forge" })).rejects.toThrow(/a\.md.*b\.md|b\.md.*a\.md/);
    });

    it("hard-fails when a referenced portrait asset is missing", async () => {
        await writeFile(path.join(vault, "codex/the-forge/entities/ghost.md"), `---
title: Ghost
type: Character
portrait: "[[missing.webp]]"
published: true
---
`);

        await expect(buildPayload({ vaultPath: vault, campaign: "the-forge" })).rejects.toThrow(/missing\.webp/);
    });

    it("includes unpublished entities because published is visibility, not inclusion", async () => {
        await writeFile(path.join(vault, "codex/the-forge/entities/secret.md"), `---
title: Secret
type: Location
published: false
---
# Hidden

Secret XYZ\n%%Secret%%\nGM only
`);

        const result = await buildPayload({ vaultPath: vault, campaign: "the-forge" });
        const secret = result.payload.entities.find((entry) => entry.slug === "secret")!;

        expect(secret.published).toBe(false);
        expect(secret.gmHtml).toContain("GM only");
    });

    it("carries creature statblocks as domain data", async () => {
        await writeFile(path.join(vault, "codex/the-forge/bestiary/dust-manta.md"), DUST_MANTA);

        const result = await buildPayload({ vaultPath: vault, campaign: "the-forge" });

        expect(result.payload.creatures[0]?.name).toBe("Dust Manta");
        expect(result.payload.creatures[0]?.statblock.level).toBe(3);
    });
});
