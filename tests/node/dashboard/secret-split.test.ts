import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { splitSecret } from "../../../plugin/src/core/secretSplit.js";

const RANDALL_FIXTURE = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "fixtures", "randall.md"),
    "utf8",
);

describe("splitSecret", () => {
    it("extracts the first description paragraph and GM content from a randall-shaped note", () => {
        const result = splitSecret(RANDALL_FIXTURE);

        expect(result.description).toBe(
            "Field Compliance Officer, [[halcyon-recovery-group|Halcyon Recovery Group]], Nakondis remediation site. Red hair, spectacles, a uniform kept immaculate against all field conditions, and a compliance slate he handles the way other people handle weapons. Randall is courteous, tireless, by-the-book to the syllable, and vaguely, genuinely sympathetic — he'll tell you your situation is regrettable and mean it, in the same breath as designating your ship as recoverable salvage and offering you a claim-reference number.",
        );
        expect(result.secret).toContain("## Portrayal Tips");
        expect(result.secret).toContain("## GM Notes");
        expect(result.gmSectionCount).toBe(11);
    });

    it("returns secret null when the marker is absent", () => {
        const fileText = `---
title: Plain
type: Character
---

# Plain

![[plain.webp|200]]

All player-facing prose stays visible.
`;

        expect(splitSecret(fileText)).toEqual({
            description: "All player-facing prose stays visible.",
            secret: null,
            gmSectionCount: 0,
        });
    });

    it("does not treat spaced or lowercased marker variants as a secret split", () => {
        const fileText = `---
title: Variant
type: Character
---

# Variant

Player copy above.

%% secret %%

## Should Not Count
Still visible because the marker did not match.
`;

        expect(splitSecret(fileText)).toEqual({
            description: "Player copy above.",
            secret: null,
            gmSectionCount: 0,
        });
    });

    it("splits only on a line whose trimmed content is exactly %%Secret%%", () => {
        const fileText = `---
title: Exact
type: Character
---

# Exact

Description paragraph.

%%Secret%%

## One Section
GM body
`;

        expect(splitSecret(fileText)).toEqual({
            description: "Description paragraph.",
            secret: "## One Section\nGM body",
            gmSectionCount: 1,
        });
    });
});
