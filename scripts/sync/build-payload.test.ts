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
    await writeFile(path.join(vault, "codex/assets/hero-subject.png"), "fake-subject");
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

A compliance officer. See [[wren-kadau|Wren]].
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
        expect(randall.playerHtml).toContain("@ForgeSync[fs-wren0001]{Wren}");
        expect(result.mintedFiles).toEqual([path.join(vault, "codex/the-forge/entities/randall.md")]);
        expect(await readFile(result.mintedFiles[0], "utf-8")).toContain(`syncId: ${randall.syncId}`);
        expect(result.artFiles.get(path.join(vault, "codex/assets/randall-20260726.webp"))).toBe(`art/${randall.syncId}.webp`);
        expect(result.warnings.some((warning) => warning.includes("wren-kadau"))).toBe(true);
    });

    it("dedupes shared portrait sources across entities", async () => {
        await writeFile(path.join(vault, "codex/the-forge/entities/twin-a.md"), `---
title: Twin A
type: Character
portrait: "[[randall-20260726.webp]]"
published: false
syncId: fs-twina001
---
# Twin A
`);
        await writeFile(path.join(vault, "codex/the-forge/entities/twin-b.md"), `---
title: Twin B
type: Character
portrait: "[[randall-20260726.webp]]"
published: false
syncId: fs-twinb001
---
# Twin B
`);

        const result = await buildPayload({ vaultPath: vault, campaign: "the-forge" });
        const twinA = result.payload.entities.find((entry) => entry.slug === "twin-a")!;
        const twinB = result.payload.entities.find((entry) => entry.slug === "twin-b")!;

        expect(twinA.portrait).toBe("art/fs-twina001.webp");
        expect(twinB.portrait).toBe("art/fs-twina001.webp");
        expect(result.artFiles.size).toBe(1);
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

    it("rewrites portrait embeds in prose to img tags without stray embed syntax", async () => {
        await writeFile(path.join(vault, "codex/the-forge/entities/randall.md"), `---
title: Randall
type: Character
portrait: "[[randall-20260726.webp]]"
published: false
syncId: fs-rand0001
---
# Randall

![[randall-20260726.webp|200]]
`);

        const result = await buildPayload({ vaultPath: vault, campaign: "the-forge" });
        const randall = result.payload.entities.find((entry) => entry.slug === "randall")!;

        expect(randall.playerHtml).toContain('<img src="forge-sync/art/');
        expect(randall.playerHtml).not.toMatch(/(?<!<img src="forge-sync\/art\/[^"]*")randall-20260726\.webp/);
        expect(randall.playerHtml).not.toContain("![[");
        expect(randall.playerHtml).not.toMatch(/(?<!<img[^>]*>)\s*!/);
    });

    it("stages non-portrait image embeds and renders img tags", async () => {
        await writeFile(path.join(vault, "codex/assets/town-map.webp"), "fake-map");
        await writeFile(path.join(vault, "codex/the-forge/entities/guide.md"), `---
title: Guide
type: Location
published: true
syncId: fs-guide001
---
# Guide

![[town-map.webp]]
`);

        const result = await buildPayload({ vaultPath: vault, campaign: "the-forge" });
        const guide = result.payload.entities.find((entry) => entry.slug === "guide")!;

        expect(result.artFiles.get(path.join(vault, "codex/assets/town-map.webp"))).toBe("art/town-map.webp");
        expect(guide.playerHtml).toContain('src="forge-sync/art/town-map.webp"');
    });

    it("strips unsupported embeds with a warning", async () => {
        await writeFile(path.join(vault, "codex/assets/notes.md"), "notes");
        await writeFile(path.join(vault, "codex/the-forge/entities/scribe.md"), `---
title: Scribe
type: Location
published: true
syncId: fs-scribe01
---
# Scribe

![[notes.md]]
`);

        const result = await buildPayload({ vaultPath: vault, campaign: "the-forge" });
        const scribe = result.payload.entities.find((entry) => entry.slug === "scribe")!;

        expect(result.warnings.some((warning) => warning.includes("unsupported embed stripped: ![[notes.md]]"))).toBe(true);
        expect(scribe.playerHtml).not.toContain("notes.md");
        expect(scribe.playerHtml).not.toContain("![[");
    });

    it("hard-fails when an embedded image asset is missing", async () => {
        await writeFile(path.join(vault, "codex/the-forge/entities/broken.md"), `---
title: Broken
type: Location
published: true
syncId: fs-broken01
---
# Broken

![[missing.webp]]
`);

        await expect(buildPayload({ vaultPath: vault, campaign: "the-forge" })).rejects.toThrow(/missing\.webp/);
    });
    it("stages subject art and includes subject in payload and contentHash", async () => {
        await writeFile(path.join(vault, "codex/the-forge/entities/hero.md"), `---
title: Hero
type: Character
subject: "[[hero-subject.png]]"
published: false
syncId: fs-hero0001
---
# Hero
`);
        await writeFile(path.join(vault, "codex/the-forge/entities/plain.md"), `---
title: Plain
type: Character
published: false
syncId: fs-plain001
---
# Plain
`);

        const result = await buildPayload({ vaultPath: vault, campaign: "the-forge" });
        const hero = result.payload.entities.find((entry) => entry.slug === "hero")!;
        const plain = result.payload.entities.find((entry) => entry.slug === "plain")!;

        expect(hero.subject).toBe("art/fs-hero0001-subject.png");
        expect(plain.subject).toBeNull();
        expect(result.artFiles.get(path.join(vault, "codex/assets/hero-subject.png"))).toBe("art/fs-hero0001-subject.png");
        expect(hero.contentHash).not.toBe(plain.contentHash);
    });

});

