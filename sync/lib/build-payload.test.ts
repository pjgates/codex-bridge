import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPayload } from "./build-payload.js";

let vault: string;

beforeEach(async () => {
    vault = await mkdtemp(path.join(os.tmpdir(), "codex-sync-"));
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
creatures: [minimal-creature]
---
# Minimal

\`\`\`statblock
id: minimal-creature
name: Minimal Creature
level: 1
ac: 15
hp: 20
attributes: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }
modifier: 0
saves: { fort: 0, ref: 0, will: 0 }
speed: 0
\`\`\`
`;
const DUST_MANTA = MINIMAL_CREATURE
    .replace("name: Minimal Creature", "name: Dust Manta")
    .replace("level: 1", "level: 3")
    .replace("# Minimal", "# Dust Manta")
    .replaceAll("minimal-creature", "dust-manta");

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

    it("mints a missing creature syncId into the statblock fence, not the frontmatter", async () => {
        const filePath = path.join(vault, "codex/the-forge/bestiary/dust-manta.md");
        await writeFile(filePath, DUST_MANTA);

        const result = await buildPayload({ vaultPath: vault, campaign: "the-forge" });

        const syncId = result.payload.creatures[0]?.syncId;
        expect(syncId).toMatch(/^fs-/);
        const rewritten = await readFile(filePath, "utf-8");
        const fenceStart = rewritten.indexOf("```statblock");
        expect(rewritten.indexOf(`syncId: ${syncId}`)).toBeGreaterThan(fenceStart);
        expect(rewritten.slice(0, fenceStart)).not.toContain("syncId");
        expect(result.mintedFiles).toContain(filePath);
    });

    it("carries every declared creature from a shared file", async () => {
        const twoRats = `---
creatures: [big-rat, small-rat]
---
# Rats

\`\`\`statblock
id: small-rat
name: Small Rat
level: 1
ac: 10
hp: 8
attributes: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }
modifier: 0
saves: { fort: 0, ref: 0, will: 0 }
speed: 0
\`\`\`

\`\`\`statblock
id: big-rat
syncId: fs-bigrat01
name: Big Rat
level: 2
ac: 12
hp: 20
attributes: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }
modifier: 0
saves: { fort: 0, ref: 0, will: 0 }
speed: 0
\`\`\`
`;
        await writeFile(path.join(vault, "codex/the-forge/bestiary/rats.md"), twoRats);

        const result = await buildPayload({ vaultPath: vault, campaign: "the-forge" });

        expect(result.payload.creatures.map((creature) => creature.slug)).toEqual(["big-rat", "small-rat"]);
        expect(result.payload.creatures[0]?.syncId).toBe("fs-bigrat01");
        expect(result.payload.creatures[1]?.syncId).toMatch(/^fs-/);
        expect(result.payload.creatures[0]?.name).toBe("Big Rat");
        expect(result.payload.creatures[1]?.name).toBe("Small Rat");
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

        expect(randall.playerHtml).toContain('<img src="codex-sync/art/');
        expect(randall.playerHtml).not.toMatch(/(?<!<img src="codex-sync\/art\/[^"]*")randall-20260726\.webp/);
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
        expect(guide.playerHtml).toContain('src="codex-sync/art/town-map.webp"');
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

    it("hard-fails when a referenced subject asset is missing", async () => {
        await writeFile(path.join(vault, "codex/the-forge/entities/ghost.md"), `---
title: Ghost
type: Character
subject: "[[missing-subject.png]]"
published: true
---
`);

        await expect(buildPayload({ vaultPath: vault, campaign: "the-forge" })).rejects.toThrow(/missing-subject\.png/);
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
        await writeFile(path.join(vault, "codex/the-forge/entities/hero-no-subject.md"), `---
title: Hero
type: Character
published: false
syncId: fs-hero0002
---
# Hero
`);
        await writeFile(path.join(vault, "codex/the-forge/entities/twin-a.md"), `---
title: Twin
type: Character
subject: "[[hero-subject.png]]"
published: false
syncId: fs-twina001
---
# Twin
`);
        await writeFile(path.join(vault, "codex/the-forge/entities/twin-b.md"), `---
title: Twin
type: Character
subject: "[[hero-subject.png]]"
published: false
syncId: fs-twinb001
---
# Twin
`);

        const result = await buildPayload({ vaultPath: vault, campaign: "the-forge" });
        const hero = result.payload.entities.find((entry) => entry.slug === "hero")!;
        const heroNoSubject = result.payload.entities.find((entry) => entry.slug === "hero-no-subject")!;
        const twinA = result.payload.entities.find((entry) => entry.slug === "twin-a")!;
        const twinB = result.payload.entities.find((entry) => entry.slug === "twin-b")!;

        expect(hero.subject).toBe("art/fs-hero0001-subject.png");
        expect(heroNoSubject.subject).toBeNull();
        expect(result.artFiles.get(path.join(vault, "codex/assets/hero-subject.png"))).toBe("art/fs-hero0001-subject.png");
        expect(hero.contentHash).not.toBe(heroNoSubject.contentHash);
        expect(twinA.contentHash).toBe(twinB.contentHash);
    });

    it("dedupes subject art with a matching prose embed", async () => {
        await writeFile(path.join(vault, "codex/assets/shared-subject.png"), "fake-subject");
        await writeFile(path.join(vault, "codex/the-forge/entities/ring.md"), `---
title: Ring
type: Character
subject: "[[shared-subject.png]]"
published: false
syncId: fs-ring0001
---
# Ring

![[shared-subject.png]]
`);

        const result = await buildPayload({ vaultPath: vault, campaign: "the-forge" });
        const ring = result.payload.entities.find((entry) => entry.slug === "ring")!;
        expect(ring.subject).toBe("art/fs-ring0001-subject.png");
        expect(result.artFiles.get(path.join(vault, "codex/assets/shared-subject.png"))).toBe("art/fs-ring0001-subject.png");
        expect(ring.playerHtml).toContain('src="codex-sync/art/fs-ring0001-subject.png"');
        expect(result.artFiles.size).toBe(1);
    });
});
