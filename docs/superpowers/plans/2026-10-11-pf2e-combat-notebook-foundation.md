# PF2e Combat Notebook Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build increment 1 of the PF2e Combat Notebook as a player-installed Chrome extension that captures supported Foundry/PF2e observations, infers defenses, and presents evidence in a sidebar plus a calm targeted-token overlay.

**Architecture:** Four independently bundled Manifest V3 entries divide privileges: a service worker owns origin authorization and session persistence, a page-main-world adapter reads Foundry and owns Pixi objects, an isolated content script performs inference and renders the notebook, and a popup controls the current origin. A narrow, schema-validated event protocol connects the page adapter to the content script; all inference and state reduction remain pure TypeScript.

**Tech Stack:** TypeScript 5.7, Vite 6, Vitest 4, happy-dom 20, Chrome Manifest V3, Foundry VTT 14, PF2e 8.5, PixiJS supplied by Foundry.

## Global Constraints

- The deliverable is a Chrome extension only: no Foundry module registration, GM installation, server change, or Foundry document write.
- First-release compatibility is Chromium, Foundry VTT 14, and PF2e 8.5.
- Read only objects already instantiated in the authenticated browser; do not request additional restricted documents.
- Keep notebook data local and session-scoped; use `chrome.storage.session` for reload recovery and clear it at browser-session end.
- Every displayed value must be labeled exact client data, observed, inferred, or possible.
- Unknown message shapes and unsupported versions must not update estimates.
- Main-world failures must never throw into Foundry gameplay.
- Use top-level imports only.
- Use exhaustive `never` checks for switches over unions.
- Add only the latest `@types/chrome` development dependency; do not add a UI framework or runtime dependency.
- This plan covers design increment 1 only. HP/mitigation inference and the full observed-abilities notebook receive separate plans after this foundation is working.

---

## Planned file structure

```text
extension/
  README.md                         unpacked-install and compatibility instructions
  build.ts                          four isolated Vite builds and static artifact copy
  manifest.json                    MV3 permissions, worker, action
  popup.html                       toolbar popup shell
  tsconfig.json                    extension-only strict TypeScript config
  vitest.config.ts                 happy-dom test config
  vitest.smoke.config.ts           built-artifact smoke config
  src/
    background/
      origin.ts                    origin match patterns and script registration
      service-worker.ts            permission, registration, and session messages
    content/
      bridge.ts                    validated page-event listener and command sender
      controller.ts                observation -> state -> storage/UI/overlay orchestration
      dom-fallback.ts              visible PF2e 8.5 chat parser
      sidebar.ts                   Shadow DOM notebook UI
      styles.ts                    sidebar CSS string
      index.ts                     isolated content-script entry
    core/
      defense.ts                   PF2e defense candidate mathematics
      reducer.ts                   pure encounter-state reducer
      types.ts                     fact, evidence, and notebook state types
    main/
      extract.ts                   supported PF2e runtime extraction
      overlay.ts                   Pixi calm-overlay lifecycle
      runtime.ts                   Foundry detection, hook registration, bootstrap
      index.ts                     main-world entry
    popup/
      index.ts                     enable/disable/open controls
    shared/
      extension-messages.ts        popup/worker/content Chrome-message protocol
      protocol.ts                  page bridge protocol and schema validation
  tests/
    background/origin.test.ts
    content/controller.test.ts
    content/dom-fallback.test.ts
    content/sidebar.test.ts
    core/defense.test.ts
    core/reducer.test.ts
    main/extract.test.ts
    main/overlay.test.ts
    main/runtime.test.ts
    shared/protocol.test.ts
    build-artifacts.smoke.ts
```

Existing files modified:

```text
package.json                         extension scripts and verification
package-lock.json                    latest @types/chrome lock entry
eslint.config.js                     extension source lint target and dist ignore
README.md                            link to extension installation instructions
```

## Task 1: Create a reproducible, independently bundled MV3 package

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/popup.html`
- Create: `extension/build.ts`
- Create: `extension/tsconfig.json`
- Create: `extension/vitest.config.ts`
- Create: `extension/tests/manifest.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `eslint.config.js`

**Interfaces:**
- Consumes: Existing root Vite, Vitest, TypeScript, `tsx`, and ESLint installations.
- Produces: `npm run extension:build`, `npm run extension:test`, `npm run extension:typecheck`, and exact build artifacts `service-worker.js`, `content.js`, `main-world.js`, `popup.js`, `popup.html`, and `manifest.json`.

- [ ] **Step 1: Install the one extension type dependency**

Run:

```bash
npm install --save-dev @types/chrome@latest
```

Expected: `package.json` and `package-lock.json` add the current `@types/chrome` release without changing runtime dependencies.

- [ ] **Step 2: Write the failing manifest contract test**

Create `extension/tests/manifest.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("extension manifest", () => {
    const manifest = JSON.parse(
        readFileSync(resolve(import.meta.dirname, "../manifest.json"), "utf8"),
    ) as Record<string, unknown>;

    it("uses MV3 with optional site access and exact entry names", () => {
        expect(manifest.manifest_version).toBe(3);
        expect(manifest.permissions).toEqual(["scripting", "storage", "activeTab"]);
        expect(manifest.optional_host_permissions).toEqual(["http://*/*", "https://*/*"]);
        expect(manifest.background).toEqual({
            service_worker: "service-worker.js",
            type: "module",
        });
        expect(manifest.action).toEqual({
            default_popup: "popup.html",
            default_title: "PF2e Combat Notebook",
        });
        expect(manifest.content_scripts).toBeUndefined();
    });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:

```bash
npx vitest run --config extension/vitest.config.ts extension/tests/manifest.test.ts
```

Expected: FAIL because `extension/vitest.config.ts` and `extension/manifest.json` do not exist.

- [ ] **Step 4: Add the manifest, popup shell, build configuration, and scripts**

Create `extension/manifest.json`:

```json
{
    "manifest_version": 3,
    "name": "PF2e Combat Notebook",
    "description": "A local, encounter-scoped PF2e observation notebook for Foundry VTT.",
    "version": "0.1.0",
    "permissions": ["scripting", "storage", "activeTab"],
    "optional_host_permissions": ["http://*/*", "https://*/*"],
    "background": {
        "service_worker": "service-worker.js",
        "type": "module"
    },
    "action": {
        "default_popup": "popup.html",
        "default_title": "PF2e Combat Notebook"
    }
}
```

Create `extension/popup.html`:

```html
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>PF2e Combat Notebook</title>
</head>
<body>
    <main>
        <strong>PF2e Combat Notebook</strong>
        <p id="status">Checking this site…</p>
        <button id="enable" type="button">Enable this Foundry site</button>
        <button id="disable" type="button">Disable this site</button>
        <button id="open" type="button">Open notebook</button>
    </main>
    <script src="popup.js"></script>
</body>
</html>
```

Create `extension/build.ts`:

```ts
import { copyFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build, type LibraryFormats } from "vite";

const root = import.meta.dirname;
const outDir = resolve(root, "dist");

interface Entry {
    source: string;
    output: string;
    format: LibraryFormats;
    name?: string;
}

const entries: Entry[] = [
    { source: "src/background/service-worker.ts", output: "service-worker.js", format: "es" },
    { source: "src/content/index.ts", output: "content.js", format: "iife", name: "PF2eNotebookContent" },
    { source: "src/main/index.ts", output: "main-world.js", format: "iife", name: "PF2eNotebookMain" },
    { source: "src/popup/index.ts", output: "popup.js", format: "iife", name: "PF2eNotebookPopup" },
];

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const entry of entries) {
    await build({
        configFile: false,
        logLevel: "info",
        build: {
            outDir,
            emptyOutDir: false,
            sourcemap: true,
            lib: {
                entry: resolve(root, entry.source),
                formats: [entry.format],
                name: entry.name,
                fileName: () => entry.output,
            },
        },
    });
}

await Promise.all([
    copyFile(resolve(root, "manifest.json"), resolve(outDir, "manifest.json")),
    copyFile(resolve(root, "popup.html"), resolve(outDir, "popup.html")),
]);
```

Create `extension/tsconfig.json`:

```json
{
    "compilerOptions": {
        "target": "ES2022",
        "module": "ES2022",
        "moduleResolution": "bundler",
        "lib": ["ES2022", "DOM", "DOM.Iterable"],
        "types": ["chrome", "node"],
        "strict": true,
        "noEmit": true,
        "isolatedModules": true,
        "skipLibCheck": true,
        "resolveJsonModule": true
    },
    "include": ["build.ts", "src/**/*.ts", "tests/**/*.ts"]
}
```

Create `extension/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "happy-dom",
        include: ["extension/tests/**/*.test.ts"],
        restoreMocks: true,
    },
});
```

Add these scripts to `package.json`:

```json
{
    "extension:build": "tsx extension/build.ts",
    "extension:test": "vitest run --config extension/vitest.config.ts",
    "extension:typecheck": "tsc --noEmit -p extension/tsconfig.json"
}
```

Add `extension/src/**/*.ts` to a TypeScript ESLint block equivalent to the existing `plugin/src` block, and add `extension/dist/**` to the ignore list in `eslint.config.js`.

Create temporary compilable entry files with only `export {};` at:

```text
extension/src/background/service-worker.ts
extension/src/content/index.ts
extension/src/main/index.ts
extension/src/popup/index.ts
```

- [ ] **Step 5: Run package checks**

Run:

```bash
npm run extension:test
npm run extension:typecheck
npm run extension:build
```

Expected: one passing test, successful typecheck, and all six exact files in `extension/dist/`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json eslint.config.js extension
git commit -m "build: scaffold combat notebook extension"
```

## Task 2: Define and validate the page-event protocol

**Files:**
- Create: `extension/src/shared/protocol.ts`
- Create: `extension/tests/shared/protocol.test.ts`

**Interfaces:**
- Produces: `Observation`, `PageCommand`, `parseObservation(value)`, `parsePageCommand(value)`, `OBSERVATION_EVENT`, and `COMMAND_EVENT`.
- Consumers: Main-world adapter, content bridge, reducer, and overlay.

- [ ] **Step 1: Write failing schema tests**

Create `extension/tests/shared/protocol.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
    PROTOCOL_VERSION,
    parseObservation,
    parsePageCommand,
} from "../../src/shared/protocol.js";

describe("page protocol", () => {
    it("accepts a supported check observation", () => {
        const value = {
            protocol: PROTOCOL_VERSION,
            eventId: "event-1",
            timestamp: 1,
            type: "check-roll",
            payload: {
                checkType: "attack",
                statistic: "ac",
                total: 27,
                natural: 14,
                outcome: "success",
                degreeAdjustment: 0,
                targetTokenUuid: "Scene.s.Token.t",
                contextKey: "base",
            },
        };
        expect(parseObservation(value)).toEqual(value);
    });

    it.each([
        null,
        {},
        { protocol: 99, type: "check-roll" },
        {
            protocol: PROTOCOL_VERSION,
            eventId: "bad",
            timestamp: 1,
            type: "check-roll",
            payload: { total: "<script>" },
        },
    ])("rejects malformed observations %#", (value) => {
        expect(parseObservation(value)).toBeNull();
    });

    it("accepts only constrained overlay commands", () => {
        expect(parsePageCommand({
            protocol: PROTOCOL_VERSION,
            type: "render-overlay",
            payload: {
                tokenUuid: "Scene.s.Token.t",
                name: "Graveknight",
                ac: "27–28",
            },
        })).not.toBeNull();
        expect(parsePageCommand({
            protocol: PROTOCOL_VERSION,
            type: "invoke",
            payload: { method: "fromUuid" },
        })).toBeNull();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run --config extension/vitest.config.ts extension/tests/shared/protocol.test.ts
```

Expected: FAIL because `protocol.ts` does not exist.

- [ ] **Step 3: Implement the closed protocol union and validators**

Create `extension/src/shared/protocol.ts` with these exact public types:

```ts
export const PROTOCOL_VERSION = 1 as const;
export const OBSERVATION_EVENT = "pf2e-combat-notebook:observation";
export const COMMAND_EVENT = "pf2e-combat-notebook:command";

export type Degree = "criticalFailure" | "failure" | "success" | "criticalSuccess";
export type DefenseKind = "ac" | "fortitude" | "reflex" | "will" | "perception";
export type CompatibilityStatus = "active" | "fallback" | "unsupported";

export interface Envelope<TType extends string, TPayload> {
    protocol: typeof PROTOCOL_VERSION;
    eventId: string;
    timestamp: number;
    type: TType;
    payload: TPayload;
}

export type Observation =
    | Envelope<"handshake", {
        status: CompatibilityStatus;
        foundry: string;
        system: string;
        systemVersion: string;
        worldId: string;
        userId: string;
        reason?: string;
    }>
    | Envelope<"scope", { sceneId: string; combatId: string | null }>
    | Envelope<"target", { tokenUuid: string | null }>
    | Envelope<"token-snapshot", {
        tokenUuid: string;
        actorUuid: string | null;
        name: string;
        defenses: Partial<Record<DefenseKind, number>>;
    }>
    | Envelope<"check-roll", {
        checkType: "attack" | "save" | "perception";
        statistic: DefenseKind;
        total: number;
        natural: number;
        outcome: Degree | null;
        degreeAdjustment: number | null;
        targetTokenUuid: string | null;
        rollerTokenUuid?: string;
        exactDc?: number;
        contextKey: string;
    }>
    | Envelope<"unassigned-check", {
        messageId: string;
        total: number;
        outcome: Degree | null;
    }>;

export type PageCommand =
    | {
        protocol: typeof PROTOCOL_VERSION;
        type: "render-overlay";
        payload: { tokenUuid: string; name: string; ac: string; health?: string };
    }
    | {
        protocol: typeof PROTOCOL_VERSION;
        type: "activate" | "clear-overlay" | "teardown";
        payload: Record<string, never>;
    };
```

Implement validators without coercion. Use a `switch` on `type`, validate every required scalar and enum, return the original value typed as the matching union member, and end each union switch with:

```ts
default: {
    const exhaustive: never = type;
    return exhaustive;
}
```

Because untrusted input begins as `unknown`, first reject unknown `type` strings before entering the exhaustive typed switch. Export:

```ts
export function parseObservation(value: unknown): Observation | null;
export function parsePageCommand(value: unknown): PageCommand | null;
```

Require finite totals/DCs, integer naturals from 1 through 20, nonempty bounded strings (IDs: 512 characters, names/reasons: 200 characters), and known enum values.

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
npx vitest run --config extension/vitest.config.ts extension/tests/shared/protocol.test.ts
npm run extension:typecheck
```

Expected: all protocol tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit**

```bash
git add extension/src/shared/protocol.ts extension/tests/shared/protocol.test.ts
git commit -m "feat: define combat notebook event protocol"
```

## Task 3: Implement PF2e defense candidate mathematics

**Files:**
- Create: `extension/src/core/defense.ts`
- Create: `extension/tests/core/defense.test.ts`

**Interfaces:**
- Consumes: `Degree` from `shared/protocol.ts`.
- Produces: `IntegerRange`, `CandidateSet`, `defenseCandidates(input)`, `intersectCandidates(left, right)`, and `formatCandidates(set)`.

- [ ] **Step 1: Write the failing table-driven tests**

Create `extension/tests/core/defense.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
    defenseCandidates,
    formatCandidates,
    intersectCandidates,
} from "../../src/core/defense.js";

describe("defenseCandidates", () => {
    it.each([
        ["success", 12, 0, [{ min: 18, max: 27 }]],
        ["failure", 12, 0, [{ min: 28, max: 36 }]],
        ["criticalSuccess", 12, 0, [{ min: null, max: 17 }]],
        ["criticalFailure", 12, 0, [{ min: 37, max: null }]],
        ["criticalSuccess", 20, 0, [{ min: null, max: 27 }]],
        ["success", 20, 0, [{ min: 28, max: 36 }]],
        ["failure", 20, 0, [{ min: 37, max: null }]],
        ["failure", 1, 0, [{ min: 18, max: 27 }]],
        ["criticalFailure", 1, 0, [{ min: 28, max: null }]],
    ] as const)(
        "%s on natural %i maps total 27 to the correct range",
        (outcome, natural, degreeAdjustment, ranges) => {
            expect(defenseCandidates({
                total: 27,
                natural,
                outcome,
                degreeAdjustment,
            })).toEqual({ ranges, certainty: "inferred" });
        },
    );

    it("reverses a known additional degree adjustment", () => {
        expect(defenseCandidates({
            total: 27,
            natural: 12,
            outcome: "criticalSuccess",
            degreeAdjustment: 1,
        })).toEqual({
            ranges: [{ min: null, max: 27 }],
            certainty: "inferred",
        });
    });

    it("marks candidates possible when the adjustment is unknown", () => {
        expect(defenseCandidates({
            total: 27,
            natural: 12,
            outcome: "success",
            degreeAdjustment: null,
        }).certainty).toBe("possible");
    });

    it("intersects observations and formats bounded results", () => {
        const first = { ranges: [{ min: 20, max: 29 }], certainty: "inferred" as const };
        const second = { ranges: [{ min: 25, max: 34 }], certainty: "inferred" as const };
        const result = intersectCandidates(first, second);
        expect(result).toEqual({
            ranges: [{ min: 25, max: 29 }],
            certainty: "inferred",
        });
        expect(formatCandidates(result)).toBe("25–29");
    });

    it("reports a contradiction instead of inventing a value", () => {
        expect(intersectCandidates(
            { ranges: [{ min: 20, max: 22 }], certainty: "inferred" },
            { ranges: [{ min: 25, max: 27 }], certainty: "inferred" },
        )).toBeNull();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run --config extension/vitest.config.ts extension/tests/core/defense.test.ts
```

Expected: FAIL because `defense.ts` does not exist.

- [ ] **Step 3: Implement range generation and intersection**

Create `extension/src/core/defense.ts`:

```ts
import type { Degree } from "../shared/protocol.js";

export interface IntegerRange {
    min: number | null;
    max: number | null;
}

export interface CandidateSet {
    ranges: IntegerRange[];
    certainty: "inferred" | "possible";
}

interface DefenseInput {
    total: number;
    natural: number;
    outcome: Degree;
    degreeAdjustment: number | null;
}

const DEGREES: Degree[] = ["criticalFailure", "failure", "success", "criticalSuccess"];

function indexOf(degree: Degree): number {
    return DEGREES.indexOf(degree);
}

function clampDegree(index: number): number {
    return Math.max(0, Math.min(3, index));
}

function baseRange(total: number, index: number): IntegerRange {
    switch (index) {
        case 0: return { min: total + 10, max: null };
        case 1: return { min: total + 1, max: total + 9 };
        case 2: return { min: total - 9, max: total };
        case 3: return { min: null, max: total - 10 };
        default: throw new Error(`Invalid degree index ${index}`);
    }
}

function mergeRanges(ranges: IntegerRange[]): IntegerRange[] {
    const sorted = ranges.toSorted((a, b) => (a.min ?? -Infinity) - (b.min ?? -Infinity));
    const merged: IntegerRange[] = [];
    for (const range of sorted) {
        const previous = merged.at(-1);
        if (!previous || (previous.max ?? Infinity) + 1 < (range.min ?? -Infinity)) {
            merged.push({ ...range });
            continue;
        }
        previous.max = previous.max === null || range.max === null
            ? null
            : Math.max(previous.max, range.max);
    }
    return merged;
}

export function defenseCandidates(input: DefenseInput): CandidateSet {
    const naturalShift = input.natural === 20 ? 1 : input.natural === 1 ? -1 : 0;
    const adjustments = input.degreeAdjustment === null
        ? [-3, -2, -1, 0, 1, 2, 3]
        : [input.degreeAdjustment];
    const finalIndex = indexOf(input.outcome);
    const possibleBase = DEGREES
        .map((_degree, baseIndex) => baseIndex)
        .filter((baseIndex) => adjustments.some((adjustment) =>
            clampDegree(baseIndex + naturalShift + adjustment) === finalIndex,
        ),
        );
    const ranges = mergeRanges(possibleBase.map((baseIndex) => baseRange(input.total, baseIndex)));
    return {
        ranges,
        certainty: input.degreeAdjustment === null ? "possible" : "inferred",
    };
}

function overlap(left: IntegerRange, right: IntegerRange): IntegerRange | null {
    const min = Math.max(left.min ?? -Infinity, right.min ?? -Infinity);
    const max = Math.min(left.max ?? Infinity, right.max ?? Infinity);
    if (min > max) return null;
    return {
        min: Number.isFinite(min) ? min : null,
        max: Number.isFinite(max) ? max : null,
    };
}

export function intersectCandidates(left: CandidateSet, right: CandidateSet): CandidateSet | null {
    const ranges = mergeRanges(left.ranges.flatMap((a) =>
        right.ranges.map((b) => overlap(a, b)).filter((value): value is IntegerRange => value !== null),
    ));
    if (ranges.length === 0) return null;
    return {
        ranges,
        certainty: left.certainty === "possible" || right.certainty === "possible"
            ? "possible"
            : "inferred",
    };
}

export function formatCandidates(set: CandidateSet): string {
    return set.ranges.map((range) => {
        if (range.min === null && range.max === null) return "any defense";
        if (range.min === range.max) return String(range.min);
        if (range.min === null) return `≤${range.max}`;
        if (range.max === null) return `≥${range.min}`;
        return `${range.min}–${range.max}`;
    }).join(" or ");
}
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
npx vitest run --config extension/vitest.config.ts extension/tests/core/defense.test.ts
npm run extension:typecheck
```

Expected: all defense tests pass.

- [ ] **Step 5: Commit**

```bash
git add extension/src/core/defense.ts extension/tests/core/defense.test.ts
git commit -m "feat: infer PF2e defense ranges"
```

## Task 4: Reduce observations into evidence-backed encounter state

**Files:**
- Create: `extension/src/core/types.ts`
- Create: `extension/src/core/reducer.ts`
- Create: `extension/tests/core/reducer.test.ts`

**Interfaces:**
- Consumes: Validated `Observation` values and defense candidate functions.
- Produces: `NotebookState`, `emptyNotebook()`, `applyObservation(state, observation)`, `currentOverlay(state)`.

- [ ] **Step 1: Write failing reducer tests**

Create `extension/tests/core/reducer.test.ts` with helpers that generate valid envelopes, then assert:

```ts
import { describe, expect, it } from "vitest";
import { applyObservation, currentOverlay, emptyNotebook } from "../../src/core/reducer.js";
import type { Observation } from "../../src/shared/protocol.js";

const event = (overrides: Partial<Observation>): Observation => ({
    protocol: 1,
    eventId: crypto.randomUUID(),
    timestamp: 1,
    type: "target",
    payload: { tokenUuid: null },
    ...overrides,
} as Observation);

describe("notebook reducer", () => {
    it("prefers an exact snapshot and retains its evidence", () => {
        let state = emptyNotebook();
        state = applyObservation(state, event({
            type: "token-snapshot",
            payload: {
                tokenUuid: "Scene.s.Token.t",
                actorUuid: "Actor.a",
                name: "Graveknight",
                defenses: { ac: 28 },
            },
        }));
        expect(state.creatures["Scene.s.Token.t"].defenses.ac).toMatchObject({
            display: "28",
            provenance: "exact-client",
        });
        expect(state.creatures["Scene.s.Token.t"].evidence).toHaveLength(1);
    });

    it("intersects attack evidence for the target and ignores duplicates", () => {
        let state = applyObservation(emptyNotebook(), event({
            eventId: "snapshot",
            type: "token-snapshot",
            payload: {
                tokenUuid: "Scene.s.Token.t",
                actorUuid: null,
                name: "Unknown creature",
                defenses: {},
            },
        }));
        const attack = event({
            eventId: "attack",
            type: "check-roll",
            payload: {
                checkType: "attack",
                statistic: "ac",
                total: 27,
                natural: 12,
                outcome: "success",
                degreeAdjustment: 0,
                targetTokenUuid: "Scene.s.Token.t",
                contextKey: "base",
            },
        });
        state = applyObservation(state, attack);
        state = applyObservation(state, attack);
        expect(state.creatures["Scene.s.Token.t"].defenses.ac.display).toBe("18–27");
        expect(state.creatures["Scene.s.Token.t"].evidence).toHaveLength(2);
    });

    it("records contradictions without replacing the previous estimate", () => {
        let state = emptyNotebook();
        for (const [eventId, total, outcome] of [
            ["one", 20, "success"],
            ["two", 40, "failure"],
        ] as const) {
            state = applyObservation(state, event({
                eventId,
                type: "check-roll",
                payload: {
                    checkType: "attack",
                    statistic: "ac",
                    total,
                    natural: 10,
                    outcome,
                    degreeAdjustment: 0,
                    targetTokenUuid: "Scene.s.Token.t",
                    contextKey: "base",
                },
            }));
        }
        expect(state.creatures["Scene.s.Token.t"].contradictions).toHaveLength(1);
    });

    it("builds the calm overlay only for the current target", () => {
        let state = emptyNotebook();
        state = applyObservation(state, event({
            type: "token-snapshot",
            payload: {
                tokenUuid: "Scene.s.Token.t",
                actorUuid: null,
                name: "Graveknight",
                defenses: { ac: 28 },
            },
        }));
        state = applyObservation(state, event({
            type: "target",
            payload: { tokenUuid: "Scene.s.Token.t" },
        }));
        expect(currentOverlay(state)).toEqual({
            tokenUuid: "Scene.s.Token.t",
            name: "Graveknight",
            ac: "28",
        });
    });
});
```

- [ ] **Step 2: Run the reducer tests to verify they fail**

Run:

```bash
npx vitest run --config extension/vitest.config.ts extension/tests/core/reducer.test.ts
```

Expected: FAIL because reducer files do not exist.

- [ ] **Step 3: Implement focused state types**

Create `extension/src/core/types.ts`:

```ts
import type { CandidateSet } from "./defense.js";
import type { CompatibilityStatus, DefenseKind } from "../shared/protocol.js";

export type Provenance = "exact-client" | "observed" | "inferred" | "possible";

export interface DefenseFact {
    display: string;
    provenance: Provenance;
    candidates?: CandidateSet;
    contextKey: string;
    evidenceIds: string[];
}

export interface Evidence {
    id: string;
    timestamp: number;
    summary: string;
}

export interface CreatureRecord {
    tokenUuid: string;
    actorUuid: string | null;
    name: string;
    defenses: Partial<Record<DefenseKind, DefenseFact>>;
    evidence: Evidence[];
    contradictions: Evidence[];
}

export interface NotebookState {
    compatibility: CompatibilityStatus;
    compatibilityReason: string | null;
    worldId: string | null;
    userId: string | null;
    sceneId: string | null;
    combatId: string | null;
    scopeId: string | null;
    selectedTokenUuid: string | null;
    creatures: Record<string, CreatureRecord>;
    seenEventIds: string[];
    diagnostics: string[];
}
```

Create `extension/src/core/reducer.ts`. Implement immutable updates with these exports:

```ts
export function emptyNotebook(): NotebookState;
export function applyObservation(state: NotebookState, observation: Observation): NotebookState;
export function parseNotebookState(value: unknown): NotebookState | null;
export function currentOverlay(
    state: NotebookState,
): { tokenUuid: string; name: string; ac: string; health?: string } | null;
```

Required reducer behavior:

```ts
// handshake: update compatibility and reason
//            plus worldId/userId
// scope: update sceneId/combatId, replace scopeId with
//        `${sceneId}:${combatId ?? "exploration"}`, and clear
//        creatures/selection only when that ID changes
// target: update selectedTokenUuid
// token-snapshot: create/update identity; exact defenses replace weaker facts
// check-roll attack: require targetTokenUuid; record exactDc as exact-client for
//        that context when present, otherwise require outcome and derive/intersect AC
// check-roll save/perception: attach `total - natural` as an observed contextual
//        modifier to rollerTokenUuid; do not call it a baseline
// unassigned-check: append a bounded diagnostic only
```

Keep at most 2,000 `seenEventIds` and 100 diagnostics. Create an `"Unknown creature"` record only when a target UUID is reliable. When intersection returns `null`, retain the existing fact and append a contradiction. End the observation-type switch with a `never` assertion.

`parseNotebookState` must reject unknown keys with invalid primitive/container types, records with mismatched token keys, facts with unknown provenance, or arrays beyond the reducer's limits. Add one test that passes `emptyNotebook()` through the parser and one that rejects `{ creatures: "<script>" }`. Restoration treats rejection as a corrupt scope and starts empty while retaining the local diagnostic `"Stored encounter data was invalid and was reset."`.

- [ ] **Step 4: Run reducer tests and typecheck**

Run:

```bash
npx vitest run --config extension/vitest.config.ts extension/tests/core/reducer.test.ts
npm run extension:typecheck
```

Expected: reducer tests pass with no type errors.

- [ ] **Step 5: Commit**

```bash
git add extension/src/core extension/tests/core
git commit -m "feat: reduce notebook evidence into encounter state"
```

## Task 5: Extract supported PF2e 8.5 runtime observations

**Files:**
- Create: `extension/src/main/extract.ts`
- Create: `extension/src/main/runtime.ts`
- Create: `extension/tests/main/extract.test.ts`
- Create: `extension/tests/main/runtime.test.ts`

**Interfaces:**
- Consumes: Narrow unknown Foundry objects; never imports module runtime code.
- Produces: `compatibilityOf(runtime)`, `extractCheck(message)`, `snapshotToken(token)`, and `startRuntime(emit, dependencies)`.

- [ ] **Step 1: Write failing extraction fixtures**

Create `extension/tests/main/extract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compatibilityOf, extractCheck, snapshotToken } from "../../src/main/extract.js";

describe("PF2e runtime extraction", () => {
    it("supports only Foundry 14 and PF2e 8.5", () => {
        expect(compatibilityOf({
            foundryGeneration: 14,
            systemId: "pf2e",
            systemVersion: "8.5.3",
        }).status).toBe("active");
        expect(compatibilityOf({
            foundryGeneration: 14,
            systemId: "pf2e",
            systemVersion: "8.6.0",
        }).status).toBe("unsupported");
    });

    it("extracts a targeted attack from PF2e flags", () => {
        expect(extractCheck({
            id: "message-1",
            timestamp: 10,
            flags: {
                pf2e: {
                    context: {
                        type: "attack-roll",
                        outcome: "success",
                        dc: { value: 28 },
                        target: { token: "Scene.s.Token.t" },
                        options: [],
                    },
                },
            },
            rolls: [{
                total: 27,
                dice: [{ faces: 20, results: [{ result: 12 }] }],
            }],
        })).toMatchObject({
            type: "check-roll",
            payload: {
                checkType: "attack",
                statistic: "ac",
                total: 27,
                natural: 12,
                outcome: "success",
                targetTokenUuid: "Scene.s.Token.t",
                exactDc: 28,
            },
        });
    });

    it("rejects targetless attacks and malformed dice", () => {
        expect(extractCheck({ flags: { pf2e: { context: { type: "attack-roll" } } } }))
            .toBeNull();
    });

    it("takes exact defenses only from an already-instantiated token actor", () => {
        expect(snapshotToken({
            document: { uuid: "Scene.s.Token.t", name: "Graveknight" },
            actor: {
                uuid: "Actor.a",
                armorClass: { value: 28 },
                getStatistic: (slug: string) =>
                    ({ fortitude: 18, reflex: 15, will: 16, perception: 17 })[slug] === undefined
                        ? undefined
                        : { check: { mod: ({ fortitude: 18, reflex: 15, will: 16, perception: 17 })[slug] } },
            },
        })?.payload.defenses).toEqual({
            ac: 28,
            fortitude: 18,
            reflex: 15,
            will: 16,
            perception: 17,
        });
    });
});
```

Create `extension/tests/main/runtime.test.ts` using a fake hook bus. Verify `startRuntime` emits one handshake, one scope, one snapshot per existing target, subscribes to `createChatMessage`, `targetToken`, `canvasReady`, and `deleteToken`, and returns a teardown function that unregisters every hook.

- [ ] **Step 2: Run extraction tests to verify they fail**

Run:

```bash
npx vitest run --config extension/vitest.config.ts extension/tests/main/extract.test.ts extension/tests/main/runtime.test.ts
```

Expected: FAIL because the main-world extraction files do not exist.

- [ ] **Step 3: Implement defensive extraction**

In `extension/src/main/extract.ts`, use local `Record<string, unknown>` guards rather than importing Foundry types. Export:

```ts
export interface RuntimeIdentity {
    foundryGeneration: number;
    systemId: string;
    systemVersion: string;
}

export function compatibilityOf(identity: RuntimeIdentity): {
    status: "active" | "unsupported";
    reason?: string;
};

export function extractCheck(message: unknown): Observation | null;
export function snapshotToken(token: unknown): Observation | null;
```

Extraction rules:

- Read only `flags.pf2e.context`.
- Accept `attack-roll`, `saving-throw`, and `perception-check`.
- Read `context.outcome` only when it is a known degree.
- Read the natural result only from a 20-sided die result.
- Require `context.target.token` for attacks.
- Derive save/perception statistic from exact known context type/options; otherwise reject.
- Use `context.dc.value` as `exactDc` only when finite.
- Set `degreeAdjustment` from a finite structured adjustment when present; otherwise `null`.
- Build `contextKey` from sorted, bounded strings for recognized target-state options only; default to `"base"`.
- Never call `fromUuid`, fetch, socket methods, or document update methods.

In `extension/src/main/runtime.ts`, define injected dependencies so tests do not need globals:

```ts
export interface RuntimeDependencies {
    hooks: {
        on(name: string, callback: (...args: unknown[]) => void): number;
        off(name: string, id: number): void;
    };
    identity(): RuntimeIdentity & { worldId: string; userId: string };
    scope(): { sceneId: string; combatId: string | null };
    currentTargets(): unknown[];
}

export function startRuntime(
    emit: (observation: Observation) => void,
    dependencies: RuntimeDependencies,
): () => void;

export function runtimeDependenciesFromWindow(window: Window): RuntimeDependencies;
```

Wrap each callback in its own `try/catch`, log only a bounded error message with `console.warn`, bootstrap current targets immediately, and return idempotent teardown.

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
npx vitest run --config extension/vitest.config.ts extension/tests/main/extract.test.ts extension/tests/main/runtime.test.ts
npm run extension:typecheck
```

Expected: extraction and lifecycle tests pass.

- [ ] **Step 5: Commit**

```bash
git add extension/src/main/extract.ts extension/src/main/runtime.ts extension/tests/main
git commit -m "feat: observe supported PF2e runtime events"
```

## Task 6: Add the validated page bridge and session checkpoint controller

**Files:**
- Create: `extension/src/content/bridge.ts`
- Create: `extension/src/content/controller.ts`
- Create: `extension/src/shared/extension-messages.ts`
- Create: `extension/tests/content/controller.test.ts`
- Modify: `extension/src/main/index.ts`

**Interfaces:**
- Consumes: Page observations, reducer functions, Chrome runtime messages.
- Produces: `listenForObservations`, `sendPageCommand`, `createNotebookController`, and serializable checkpoint messages.

- [ ] **Step 1: Write the failing controller test**

Create `extension/tests/content/controller.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createNotebookController } from "../../src/content/controller.js";

describe("content controller", () => {
    it("restores, reduces, checkpoints, and renders an overlay", async () => {
        const save = vi.fn().mockResolvedValue(undefined);
        const renderSidebar = vi.fn();
        const sendCommand = vi.fn();
        const controller = await createNotebookController({
            origin: "https://foundry.example.test",
            load: async () => null,
            save,
            renderSidebar,
            sendCommand,
        });
        await controller.accept({
            protocol: 1,
            eventId: "handshake",
            timestamp: 0,
            type: "handshake",
            payload: {
                status: "active",
                foundry: "14",
                system: "pf2e",
                systemVersion: "8.5.3",
                worldId: "world",
                userId: "user",
            },
        });
        await controller.accept({
            protocol: 1,
            eventId: "scope",
            timestamp: 0,
            type: "scope",
            payload: { sceneId: "scene", combatId: "combat" },
        });
        await controller.accept({
            protocol: 1,
            eventId: "snapshot",
            timestamp: 1,
            type: "token-snapshot",
            payload: {
                tokenUuid: "Scene.s.Token.t",
                actorUuid: null,
                name: "Graveknight",
                defenses: { ac: 28 },
            },
        });
        await controller.accept({
            protocol: 1,
            eventId: "target",
            timestamp: 2,
            type: "target",
            payload: { tokenUuid: "Scene.s.Token.t" },
        });
        await controller.flush();
        expect(save).toHaveBeenCalledWith(
            "notebook:https://foundry.example.test:world:user:scene:combat",
            expect.anything(),
        );
        expect(renderSidebar).toHaveBeenLastCalledWith(
            expect.objectContaining({ selectedTokenUuid: "Scene.s.Token.t" }),
        );
        expect(sendCommand).toHaveBeenLastCalledWith({
            protocol: 1,
            type: "render-overlay",
            payload: {
                tokenUuid: "Scene.s.Token.t",
                name: "Graveknight",
                ac: "28",
            },
        });
    });
});
```

- [ ] **Step 2: Run the controller test to verify it fails**

Run:

```bash
npx vitest run --config extension/vitest.config.ts extension/tests/content/controller.test.ts
```

Expected: FAIL because controller and bridge files do not exist.

- [ ] **Step 3: Define extension-internal messages and bridge adapters**

Create `extension/src/shared/extension-messages.ts`:

```ts
import type { NotebookState } from "../core/types.js";

export const ENABLED_ORIGINS_KEY = "enabledFoundryOrigins";

export type ExtensionRequest =
    | { type: "origin-status"; origin: string }
    | { type: "enable-origin"; origin: string }
    | { type: "disable-origin"; origin: string }
    | { type: "load-notebook"; key: string }
    | { type: "save-notebook"; key: string; state: NotebookState }
    | { type: "clear-notebook"; key: string }
    | { type: "toggle-sidebar" }
    | { type: "teardown" };

export type ExtensionResponse =
    | { ok: true; enabled?: boolean; state?: NotebookState | null }
    | { ok: false; error: string };
```

Create `extension/src/content/bridge.ts`:

```ts
import {
    COMMAND_EVENT,
    OBSERVATION_EVENT,
    parseObservation,
    type Observation,
    type PageCommand,
} from "../shared/protocol.js";

export function listenForObservations(
    callback: (observation: Observation) => void,
): () => void {
    const listener = (event: Event): void => {
        const parsed = parseObservation((event as CustomEvent<unknown>).detail);
        if (parsed) callback(parsed);
    };
    window.addEventListener(OBSERVATION_EVENT, listener);
    return () => window.removeEventListener(OBSERVATION_EVENT, listener);
}

export function sendPageCommand(command: PageCommand): void {
    window.dispatchEvent(new CustomEvent(COMMAND_EVENT, { detail: command }));
}
```

Update `extension/src/main/index.ts` to:

```ts
import { startRuntime } from "./runtime.js";
import {
    COMMAND_EVENT,
    OBSERVATION_EVENT,
    parsePageCommand,
    type Observation,
} from "../shared/protocol.js";

const emit = (observation: Observation): void => {
    window.dispatchEvent(new CustomEvent(OBSERVATION_EVENT, { detail: observation }));
};

let stopRuntime: (() => void) | null = null;

window.addEventListener(COMMAND_EVENT, (event) => {
    const command = parsePageCommand((event as CustomEvent<unknown>).detail);
    if (!command) return;
    switch (command.type) {
        case "activate":
            stopRuntime ??= startRuntime(emit, runtimeDependenciesFromWindow(window));
            break;
        case "render-overlay":
        case "clear-overlay":
            break;
        case "teardown":
            stopRuntime?.();
            stopRuntime = null;
            break;
        default: {
            const exhaustive: never = command;
            return exhaustive;
        }
    }
});
```

Export `runtimeDependenciesFromWindow` from `runtime.ts`; it may read globals but must adapt them into the tested `RuntimeDependencies` interface and perform no document writes.

- [ ] **Step 4: Implement the controller with checkpoint coalescing**

Create `extension/src/content/controller.ts` with:

```ts
import {
    applyObservation,
    currentOverlay,
    emptyNotebook,
    parseNotebookState,
} from "../core/reducer.js";
import type { NotebookState } from "../core/types.js";
import { PROTOCOL_VERSION, type Observation, type PageCommand } from "../shared/protocol.js";

export interface ControllerDependencies {
    origin: string;
    load(key: string): Promise<unknown>;
    save(key: string, state: NotebookState): Promise<void>;
    renderSidebar(state: NotebookState): void;
    sendCommand(command: PageCommand): void;
}

export interface NotebookController {
    accept(observation: Observation): Promise<void>;
    clear(): Promise<void>;
    flush(): Promise<void>;
    state(): NotebookState;
}

export async function createNotebookController(
    dependencies: ControllerDependencies,
): Promise<NotebookController> {
    let state = emptyNotebook();
    let activeKey: string | null = null;
    let pending: Promise<void> = Promise.resolve();

    const storageKey = (candidate: NotebookState): string | null => {
        if (!candidate.worldId || !candidate.userId || !candidate.scopeId) return null;
        return `notebook:${dependencies.origin}:${candidate.worldId}:${candidate.userId}:${candidate.scopeId}`;
    };

    const publish = async (): Promise<void> => {
        dependencies.renderSidebar(state);
        const overlay = currentOverlay(state);
        dependencies.sendCommand(overlay
            ? { protocol: PROTOCOL_VERSION, type: "render-overlay", payload: overlay }
            : { protocol: PROTOCOL_VERSION, type: "clear-overlay", payload: {} });
        if (activeKey) await dependencies.save(activeKey, state);
    };

    dependencies.renderSidebar(state);

    return {
        async accept(observation) {
            pending = pending.then(async () => {
                const reduced = applyObservation(state, observation);
                const nextKey = storageKey(reduced);
                if (nextKey && nextKey !== activeKey) {
                    const stored = await dependencies.load(nextKey);
                    const restored = stored === null ? null : parseNotebookState(stored);
                    if (stored !== null && restored === null) {
                        state = {
                            ...reduced,
                            diagnostics: [
                                ...reduced.diagnostics,
                                "Stored encounter data was invalid and was reset.",
                            ],
                        };
                    } else if (restored) {
                        state = {
                            ...applyObservation(restored, observation),
                            compatibility: reduced.compatibility,
                            compatibilityReason: reduced.compatibilityReason,
                            worldId: reduced.worldId,
                            userId: reduced.userId,
                        };
                    } else {
                        state = reduced;
                    }
                    activeKey = nextKey;
                } else {
                    state = reduced;
                }
                await publish();
            });
            await pending;
        },
        async clear() {
            pending = pending.then(async () => {
                state = {
                    ...emptyNotebook(),
                    compatibility: state.compatibility,
                    compatibilityReason: state.compatibilityReason,
                    worldId: state.worldId,
                    userId: state.userId,
                    sceneId: state.sceneId,
                    combatId: state.combatId,
                    scopeId: state.scopeId,
                };
                await publish();
            });
            await pending;
        },
        async flush() {
            await pending;
        },
        state: () => state,
    };
}
```

In the eventual content entry, derive the storage key only after handshake as:

```ts
const key = `notebook:${origin}:${worldId}:${userId}:${scopeId}`;
```

The runtime emits handshake and scope before bootstrap observations, and `accept` serializes them so a stored scope is restored before later snapshots/checks are reduced. Validate loaded values with `parseNotebookState`; a rejected value becomes an empty current scope with the corruption diagnostic. Send save/load/clear requests to the worker; never expose `chrome.storage.session` to the page-main-world adapter.

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
npx vitest run --config extension/vitest.config.ts extension/tests/content/controller.test.ts extension/tests/shared/protocol.test.ts
npm run extension:typecheck
```

Expected: controller and protocol tests pass.

- [ ] **Step 6: Commit**

```bash
git add extension/src/content extension/src/main/index.ts extension/src/main/runtime.ts extension/src/shared extension/tests/content
git commit -m "feat: bridge and checkpoint notebook observations"
```

## Task 7: Implement origin authorization, persistence, and popup controls

**Files:**
- Create: `extension/src/background/origin.ts`
- Replace: `extension/src/background/service-worker.ts`
- Replace: `extension/src/popup/index.ts`
- Create: `extension/tests/background/origin.test.ts`

**Interfaces:**
- Consumes: `ExtensionRequest` messages.
- Produces: exact-origin match patterns, two dynamic script registrations, and session-state CRUD.

- [ ] **Step 1: Write failing origin tests**

Create `extension/tests/background/origin.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
    exactOrigin,
    originPattern,
    scriptRegistrations,
} from "../../src/background/origin.js";

describe("origin registration", () => {
    it("retains an exact HTTP(S) origin for the extension allowlist", () => {
        expect(exactOrigin("https://foundry.example.test/game")).toBe(
            "https://foundry.example.test",
        );
        expect(exactOrigin("http://localhost:30000/game")).toBe("http://localhost:30000");
        expect(() => exactOrigin("file:///tmp/game")).toThrow("HTTP(S)");
    });

    it("uses valid Chrome host patterns and omits unsupported ports", () => {
        expect(originPattern("https://foundry.example.test/game")).toBe(
            "https://foundry.example.test/*",
        );
        expect(originPattern("http://localhost:30000")).toBe("http://localhost/*");
        expect(() => originPattern("file:///tmp/game")).toThrow("HTTP(S)");
    });

    it("registers isolated and MAIN scripts at document start", () => {
        expect(scriptRegistrations(["https://foundry.example.test/*"])).toEqual([
            {
                id: "pf2e-notebook-content",
                matches: ["https://foundry.example.test/*"],
                js: ["content.js"],
                runAt: "document_start",
                world: "ISOLATED",
                persistAcrossSessions: true,
            },
            {
                id: "pf2e-notebook-main",
                matches: ["https://foundry.example.test/*"],
                js: ["main-world.js"],
                runAt: "document_start",
                world: "MAIN",
                persistAcrossSessions: true,
            },
        ]);
    });
});
```

- [ ] **Step 2: Run origin tests to verify they fail**

Run:

```bash
npx vitest run --config extension/vitest.config.ts extension/tests/background/origin.test.ts
```

Expected: FAIL because `origin.ts` does not exist.

- [ ] **Step 3: Implement origin patterns and registrations**

Create `extension/src/background/origin.ts`:

```ts
export function exactOrigin(input: string): string {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Foundry origin must use HTTP(S)");
    }
    return url.origin;
}

export function originPattern(input: string): string {
    const url = new URL(exactOrigin(input));
    return `${url.protocol}//${url.hostname}/*`;
}

export function scriptRegistrations(
    matches: string[],
): chrome.scripting.RegisteredContentScript[] {
    const shared = {
        matches,
        runAt: "document_start" as const,
        persistAcrossSessions: true,
    };
    return [
        {
            ...shared,
            id: "pf2e-notebook-content",
            js: ["content.js"],
            world: "ISOLATED",
        },
        {
            ...shared,
            id: "pf2e-notebook-main",
            js: ["main-world.js"],
            world: "MAIN",
        },
    ];
}
```

- [ ] **Step 4: Implement the service worker**

In `extension/src/background/service-worker.ts`:

```ts
import { exactOrigin, originPattern, scriptRegistrations } from "./origin.js";
import {
    ENABLED_ORIGINS_KEY,
    type ExtensionRequest,
    type ExtensionResponse,
} from "../shared/extension-messages.js";

const SCRIPT_IDS = ["pf2e-notebook-content", "pf2e-notebook-main"];

async function enabledOrigins(): Promise<string[]> {
    const stored = await chrome.storage.local.get(ENABLED_ORIGINS_KEY);
    const value = stored[ENABLED_ORIGINS_KEY];
    return Array.isArray(value)
        ? value.filter((origin): origin is string => typeof origin === "string").toSorted()
        : [];
}

async function setEnabledOrigins(origins: string[]): Promise<void> {
    await chrome.storage.local.set({
        [ENABLED_ORIGINS_KEY]: [...new Set(origins)].toSorted(),
    });
}

async function refreshScripts(): Promise<void> {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: SCRIPT_IDS });
    if (existing.length > 0) {
        await chrome.scripting.unregisterContentScripts({
            ids: existing.map((script) => script.id),
        });
    }
    const matches = [...new Set((await enabledOrigins()).map(originPattern))];
    if (matches.length > 0) {
        await chrome.scripting.registerContentScripts(scriptRegistrations(matches));
    }
}

async function clearOriginSessions(origin: string): Promise<void> {
    const prefix = `notebook:${origin}:`;
    const stored = await chrome.storage.session.get(null);
    const keys = Object.keys(stored).filter((key) => key.startsWith(prefix));
    if (keys.length > 0) await chrome.storage.session.remove(keys);
}

async function handle(request: ExtensionRequest): Promise<ExtensionResponse> {
    try {
        switch (request.type) {
            case "origin-status":
                return {
                    ok: true,
                    enabled: (await enabledOrigins()).includes(exactOrigin(request.origin)),
                };
            case "enable-origin": {
                const origin = exactOrigin(request.origin);
                const granted = await chrome.permissions.contains({
                    origins: [originPattern(origin)],
                });
                if (!granted) return { ok: false, error: "Site access was not granted." };
                await setEnabledOrigins([...await enabledOrigins(), origin]);
                await refreshScripts();
                return { ok: true, enabled: true };
            }
            case "disable-origin": {
                const origin = exactOrigin(request.origin);
                const pattern = originPattern(origin);
                const remaining = (await enabledOrigins()).filter((value) => value !== origin);
                await setEnabledOrigins(remaining);
                await clearOriginSessions(origin);
                if (!remaining.some((value) => originPattern(value) === pattern)) {
                    await chrome.permissions.remove({ origins: [pattern] });
                }
                await refreshScripts();
                return { ok: true, enabled: false };
            }
            case "load-notebook": {
                const stored = await chrome.storage.session.get(request.key);
                return { ok: true, state: (stored[request.key] as never) ?? null };
            }
            case "save-notebook":
                await chrome.storage.session.set({ [request.key]: request.state });
                return { ok: true };
            case "clear-notebook":
                await chrome.storage.session.remove(request.key);
                return { ok: true };
            case "toggle-sidebar":
            case "teardown":
                return { ok: false, error: "Tab-local message sent to service worker." };
            default: {
                const exhaustive: never = request;
                return exhaustive;
            }
        }
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

chrome.runtime.onInstalled.addListener(() => void refreshScripts());
chrome.runtime.onStartup.addListener(() => void refreshScripts());
chrome.runtime.onMessage.addListener(
    (request: ExtensionRequest, _sender, sendResponse: (response: ExtensionResponse) => void) => {
        void handle(request).then(sendResponse);
        return true;
    },
);
```

Do not add the broad `"tabs"` permission. The popup already has temporary access to its active tab through `"activeTab"` and performs teardown there before asking the worker to remove origin permission.

- [ ] **Step 5: Implement popup behavior**

In `extension/src/popup/index.ts`, query the active tab, reject missing/non-HTTP URLs, display enabled state, and wire:

```ts
import { originPattern } from "../background/origin.js";
import type {
    ExtensionRequest,
    ExtensionResponse,
} from "../shared/extension-messages.js";

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const origin = tab.url ? new URL(tab.url).origin : null;

async function send(request: ExtensionRequest): Promise<ExtensionResponse> {
    return chrome.runtime.sendMessage(request) as Promise<ExtensionResponse>;
}

enableButton.addEventListener("click", async () => {
    if (!origin) return;
    const granted = await chrome.permissions.request({
        origins: [originPattern(origin)],
    });
    if (!granted) {
        statusElement.textContent = "Site access was not granted.";
        return;
    }
    await send({ type: "enable-origin", origin });
    await chrome.tabs.reload(tab.id!);
    window.close();
});

disableButton.addEventListener("click", async () => {
    if (!origin) return;
    if (tab.id !== undefined) {
        await chrome.tabs.sendMessage(tab.id, { type: "teardown" }).catch(() => undefined);
    }
    await send({ type: "disable-origin", origin });
    window.close();
});

openButton.addEventListener("click", async () => {
    if (tab.id === undefined) return;
    await chrome.tabs.sendMessage(tab.id, { type: "toggle-sidebar" });
    window.close();
});
```

Use typed `querySelector` guards for all buttons/status elements, set `textContent` only, hide controls that do not apply, and show worker errors in the status paragraph.

- [ ] **Step 6: Run tests, typecheck, and build**

Run:

```bash
npx vitest run --config extension/vitest.config.ts extension/tests/background/origin.test.ts
npm run extension:typecheck
npm run extension:build
```

Expected: origin tests pass and the extension builds.

- [ ] **Step 7: Commit**

```bash
git add extension/manifest.json extension/src/background extension/src/popup extension/tests/background
git commit -m "feat: authorize Foundry origins and persist sessions"
```

## Task 8: Render the isolated notebook sidebar

**Files:**
- Create: `extension/src/content/styles.ts`
- Create: `extension/src/content/sidebar.ts`
- Create: `extension/tests/content/sidebar.test.ts`

**Interfaces:**
- Consumes: `NotebookState`, clear callback, and toggle messages.
- Produces: `mountSidebar(document, onClear)` returning `{ render, toggle, destroy }`.

- [ ] **Step 1: Write failing DOM-isolation tests**

Create `extension/tests/content/sidebar.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { mountSidebar } from "../../src/content/sidebar.js";
import { emptyNotebook } from "../../src/core/reducer.js";

describe("notebook sidebar", () => {
    it("mounts in Shadow DOM and renders facts with textContent", () => {
        const clear = vi.fn();
        const sidebar = mountSidebar(document, clear);
        const state = emptyNotebook();
        state.compatibility = "active";
        state.creatures["Scene.s.Token.t"] = {
            tokenUuid: "Scene.s.Token.t",
            actorUuid: null,
            name: "<img src=x onerror=alert(1)>",
            defenses: {
                ac: {
                    display: "27–28",
                    provenance: "inferred",
                    contextKey: "base",
                    evidenceIds: ["e1"],
                },
            },
            evidence: [{ id: "e1", timestamp: 1, summary: "Strike 27: success" }],
            contradictions: [],
        };
        sidebar.render(state);
        const host = document.querySelector("#pf2e-combat-notebook-host") as HTMLElement;
        expect(host.shadowRoot).not.toBeNull();
        expect(host.shadowRoot!.textContent).toContain("<img src=x onerror=alert(1)>");
        expect(host.shadowRoot!.querySelector("img")).toBeNull();
        (host.shadowRoot!.querySelector("[data-action=clear]") as HTMLButtonElement).click();
        expect(clear).toHaveBeenCalledOnce();
    });

    it("tears down without leaving a host node", () => {
        const sidebar = mountSidebar(document, vi.fn());
        sidebar.destroy();
        expect(document.querySelector("#pf2e-combat-notebook-host")).toBeNull();
    });
});
```

- [ ] **Step 2: Run sidebar tests to verify they fail**

Run:

```bash
npx vitest run --config extension/vitest.config.ts extension/tests/content/sidebar.test.ts
```

Expected: FAIL because sidebar files do not exist.

- [ ] **Step 3: Implement the sidebar**

Create `styles.ts` as a CSS string for a fixed right drawer with:

- Width `min(380px, 92vw)`.
- Foundry-compatible dark neutral palette.
- A collapsed state translated beyond the viewport.
- Status colors for active/fallback/unsupported.
- Provenance badges for exact-client/observed/inferred/possible.
- Keyboard-visible focus outlines.
- Reduced-motion handling.

Create `sidebar.ts` with:

```ts
import type { NotebookState } from "../core/types.js";
import { SIDEBAR_CSS } from "./styles.js";

export interface Sidebar {
    render(state: NotebookState): void;
    toggle(): void;
    destroy(): void;
}

export function mountSidebar(document: Document, onClear: () => void): Sidebar;
```

Construct all dynamic content with `createElement` and `textContent`. The static shell may use a template element created from the extension-owned constant. Render:

- Compatibility state and reason.
- Current-scope creature buttons.
- Selected or first creature details.
- Defenses with value/range and provenance.
- Expandable evidence and contradiction lists.
- Empty-state guidance.
- Clear encounter button requiring one confirmation click in the drawer.

Do not target a Foundry token when a creature button is selected. Keep sidebar selection local to the view.

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
npx vitest run --config extension/vitest.config.ts extension/tests/content/sidebar.test.ts
npm run extension:typecheck
```

Expected: sidebar tests pass.

- [ ] **Step 5: Commit**

```bash
git add extension/src/content/sidebar.ts extension/src/content/styles.ts extension/tests/content/sidebar.test.ts
git commit -m "feat: render isolated combat notebook sidebar"
```

## Task 9: Add the calm Pixi targeted-token overlay

**Files:**
- Create: `extension/src/main/overlay.ts`
- Create: `extension/tests/main/overlay.test.ts`
- Modify: `extension/src/main/index.ts`

**Interfaces:**
- Consumes: Validated `render-overlay` and `clear-overlay` commands.
- Produces: `createOverlay(dependencies)` returning `{ render, clear, refresh, destroy }`.

- [ ] **Step 1: Write failing overlay lifecycle tests**

Create `extension/tests/main/overlay.test.ts` with minimal fake container/text/graphics classes. Assert:

```ts
it("renders one non-interactive label over the requested token", () => {
    const overlay = createOverlay(fakeDependencies());
    overlay.render({
        tokenUuid: "Scene.s.Token.t",
        name: "Graveknight",
        ac: "27–28",
    });
    expect(interfaceLayer.children).toHaveLength(1);
    expect(interfaceLayer.children[0].eventMode).toBe("none");
    expect(textNode.text).toBe("Graveknight · AC 27–28");
});

it("counter-scales, follows token movement, and tears down idempotently", () => {
    const overlay = createOverlay(fakeDependencies({ zoom: 2 }));
    overlay.render(view);
    expect(label.scale.set).toHaveBeenCalledWith(0.5);
    token.center.x = 500;
    overlay.refresh();
    expect(label.position.set).toHaveBeenLastCalledWith(500, token.y - 12);
    overlay.destroy();
    overlay.destroy();
    expect(label.destroy).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run overlay tests to verify they fail**

Run:

```bash
npx vitest run --config extension/vitest.config.ts extension/tests/main/overlay.test.ts
```

Expected: FAIL because `overlay.ts` does not exist.

- [ ] **Step 3: Implement the narrow Pixi adapter**

Create `extension/src/main/overlay.ts` with local interfaces for only:

```ts
interface OverlayToken {
    document: { uuid: string };
    center: { x: number; y: number };
    y: number;
}

interface OverlayDependencies {
    createContainer(): OverlayContainer;
    createText(text: string): OverlayText;
    interfaceLayer(): OverlayContainer | null;
    tokens(): OverlayToken[];
    zoom(): number;
}

export interface Overlay {
    render(view: { tokenUuid: string; name: string; ac: string; health?: string }): void;
    clear(): void;
    refresh(): void;
    destroy(): void;
}
```

Use one root container with `eventMode = "none"`. Render one text child with the calm format:

```ts
`${name} · AC ${ac}${health ? ` · ${health}` : ""}`
```

Position at `(token.center.x, token.y - 12)`, anchor the text bottom-center, apply a dark translucent background or text stroke, and set scale to `1 / zoom`. `clear` destroys current children but retains a usable root; `destroy` destroys and nulls the root. Missing tokens clear the overlay.

In `main/index.ts`, instantiate the overlay from `window.PIXI` and `window.canvas`, route render/clear commands to it, call `refresh` from supported `canvasPan` and `updateToken` hooks, and call `destroy` during teardown. Catch overlay errors locally and clear rather than throw.

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
npx vitest run --config extension/vitest.config.ts extension/tests/main/overlay.test.ts
npm run extension:typecheck
```

Expected: overlay lifecycle tests pass.

- [ ] **Step 5: Commit**

```bash
git add extension/src/main/overlay.ts extension/src/main/index.ts extension/tests/main/overlay.test.ts
git commit -m "feat: show calm targeted-token overlay"
```

## Task 10: Add PF2e 8.5 DOM fallback and wire the extension

**Files:**
- Create: `extension/src/content/dom-fallback.ts`
- Create: `extension/tests/content/dom-fallback.test.ts`
- Replace: `extension/src/content/index.ts`
- Modify: `extension/src/content/controller.ts`
- Modify: `extension/src/main/index.ts`

**Interfaces:**
- Consumes: Rendered visible PF2e chat cards and Chrome tab messages.
- Produces: `observeRenderedChecks(root, emit)` and the complete content-script lifecycle.

- [ ] **Step 1: Write failing fallback tests**

Create `extension/tests/content/dom-fallback.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { parseRenderedCheck } from "../../src/content/dom-fallback.js";

describe("PF2e 8.5 DOM fallback", () => {
    it("captures a visible total and degree as unassigned evidence", () => {
        const element = document.createElement("li");
        element.dataset.messageId = "message-1";
        element.innerHTML = `
            <div class="message-content">
                <span class="dice-total">27</span>
                <span class="degree-of-success success">Success</span>
            </div>
        `;
        expect(parseRenderedCheck(element)).toMatchObject({
            type: "unassigned-check",
            payload: { messageId: "message-1", total: 27, outcome: "success" },
        });
    });

    it.each([
        `<span class="dice-total">NaN</span>`,
        `<span class="dice-total">27</span><span class="degree-of-success">Unknown</span>`,
    ])("rejects unsupported card %#", (html) => {
        const element = document.createElement("li");
        element.dataset.messageId = "message-1";
        element.innerHTML = html;
        expect(parseRenderedCheck(element)).toBeNull();
    });

    it("reads text without executing card markup", () => {
        const element = document.createElement("li");
        element.dataset.messageId = "message-1";
        element.innerHTML = `
            <span class="dice-total">27</span>
            <span class="degree-of-success success">Success</span>
            <img src="invalid" onerror="window.bad = true">
        `;
        expect(parseRenderedCheck(element)).toMatchObject({
            type: "unassigned-check",
            payload: { total: 27, outcome: "success" },
        });
        expect((window as Window & { bad?: boolean }).bad).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run fallback tests to verify they fail**

Run:

```bash
npx vitest run --config extension/vitest.config.ts extension/tests/content/dom-fallback.test.ts
```

Expected: FAIL because `dom-fallback.ts` does not exist.

- [ ] **Step 3: Implement fallback parsing and observation**

Create `extension/src/content/dom-fallback.ts`:

```ts
import {
    PROTOCOL_VERSION,
    type Degree,
    type Observation,
} from "../shared/protocol.js";

const DEGREE_CLASSES: ReadonlyArray<[string, Degree]> = [
    ["critical-success", "criticalSuccess"],
    ["critical-failure", "criticalFailure"],
    ["success", "success"],
    ["failure", "failure"],
];

export function parseRenderedCheck(element: Element): Observation | null {
    if (!(element instanceof HTMLElement)) return null;
    const messageId = element.dataset.messageId;
    const totalText = element.querySelector(".dice-total")?.textContent?.trim();
    const degreeElement = element.querySelector(".degree-of-success");
    const total = totalText === undefined ? Number.NaN : Number(totalText);
    const outcome = DEGREE_CLASSES.find(([className]) =>
        degreeElement?.classList.contains(className),
    )?.[1] ?? null;
    if (!messageId || !Number.isFinite(total) || outcome === null) return null;
    return {
        protocol: PROTOCOL_VERSION,
        eventId: `dom:${messageId}`,
        timestamp: Date.now(),
        type: "unassigned-check",
        payload: { messageId, total, outcome },
    };
}

export function observeRenderedChecks(
    root: Element,
    emit: (observation: Observation) => void,
): () => void {
    const seen = new Set<string>();
    const scan = (element: Element): void => {
        const observation = parseRenderedCheck(element);
        if (!observation || seen.has(observation.eventId)) return;
        seen.add(observation.eventId);
        emit(observation);
    };
    root.querySelectorAll(".chat-message[data-message-id]").forEach(scan);
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (!(node instanceof Element)) continue;
                if (node.matches(".chat-message[data-message-id]")) scan(node);
                node.querySelectorAll(".chat-message[data-message-id]").forEach(scan);
            }
        }
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
}
```

- [ ] **Step 4: Wire the content lifecycle**

Replace `extension/src/content/index.ts` with orchestration that:

1. Asks the worker whether `window.location.origin` is in the exact-origin allowlist and returns without touching the page when disabled.
2. Mounts one sidebar.
3. Creates the controller using worker-backed load/save functions.
4. Starts the validated bridge listener, then sends the page adapter an `activate` command.
5. Starts DOM fallback only after a handshake reports `fallback`.
6. Handles `{type: "toggle-sidebar"}` and `{type: "teardown"}` tab messages.
7. Listens for `chrome.storage.local` changes to `ENABLED_ORIGINS_KEY` and tears down when the exact current origin is removed, covering every already-open tab without broad tab permission.
8. On teardown: stop bridge/fallback, send page teardown, destroy sidebar, and flush the controller.
9. Never writes to Foundry documents or calls Foundry globals.

Use this lifecycle shape:

```ts
async function boot(): Promise<void> {
    const status = await chrome.runtime.sendMessage({
        type: "origin-status",
        origin: window.location.origin,
    }) as ExtensionResponse;
    if (!status.ok || !status.enabled) return;

    let clearEncounter = (): void => undefined;
    const sidebar = mountSidebar(document, () => clearEncounter());
    const controller = await createNotebookController({
        origin: window.location.origin,
        load: loadCurrentNotebook,
        save: saveCurrentNotebook,
        renderSidebar: sidebar.render,
        sendCommand: sendPageCommand,
    });
    clearEncounter = () => void controller.clear();

    let stopFallback: (() => void) | null = null;
    const stopBridge = listenForObservations((observation) => {
        void controller.accept(observation);
        if (observation.type === "handshake" && observation.payload.status === "fallback") {
            stopFallback ??= observeRenderedChecks(
                document.body,
                (fallbackObservation) => void controller.accept(fallbackObservation),
            );
        }
    });
    sendPageCommand({ protocol: PROTOCOL_VERSION, type: "activate", payload: {} });

    registerTabLifecycle({
        controller,
        sidebar,
        stopBridge,
        stopFallback: () => stopFallback,
    });
}

void boot();
```

Implement `registerTabLifecycle` in the same file with an idempotent `teardown()` that reads the latest fallback disposer rather than capturing its initial `null` value, and register it once.

In `main/index.ts`, remain inert until the validated `activate` command arrives. Ensure unsupported runtime identity emits an unsupported handshake and registers no gameplay hooks. If runtime shape is temporarily unavailable at `document_start`, retry with bounded backoff for at most 30 seconds; initialize once and cancel retries on teardown.

- [ ] **Step 5: Run focused and full extension checks**

Run:

```bash
npx vitest run --config extension/vitest.config.ts extension/tests/content/dom-fallback.test.ts extension/tests/content/controller.test.ts
npm run extension:test
npm run extension:typecheck
npm run extension:build
```

Expected: all extension tests pass, typecheck passes, and build succeeds.

- [ ] **Step 6: Commit**

```bash
git add extension/src/content extension/src/main/index.ts extension/tests/content
git commit -m "feat: wire combat notebook extension lifecycle"
```

## Task 11: Integrate verification and document installation

**Files:**
- Create: `extension/README.md`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `extension/vitest.smoke.config.ts`
- Create: `extension/tests/build-artifacts.smoke.ts`

**Interfaces:**
- Consumes: Completed extension build.
- Produces: One-command repository verification and reproducible unpacked installation.

- [ ] **Step 1: Write the failing build-artifact smoke test**

Create `extension/vitest.smoke.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["extension/tests/**/*.smoke.ts"],
    },
});
```

Create `extension/tests/build-artifacts.smoke.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dist = resolve(import.meta.dirname, "../dist");

describe("built extension", () => {
    it("contains every manifest-referenced entry", () => {
        const manifest = JSON.parse(
            readFileSync(resolve(dist, "manifest.json"), "utf8"),
        ) as {
            background: { service_worker: string };
            action: { default_popup: string };
        };
        expect(() => readFileSync(resolve(dist, manifest.background.service_worker))).not.toThrow();
        expect(() => readFileSync(resolve(dist, manifest.action.default_popup))).not.toThrow();
        for (const file of ["content.js", "main-world.js", "popup.js"]) {
            expect(() => readFileSync(resolve(dist, file))).not.toThrow();
        }
    });
});
```

- [ ] **Step 2: Verify the smoke test fails without a build and passes after one**

Run:

```bash
npm run clean
npx vitest run --config extension/vitest.smoke.config.ts
```

Expected: FAIL because `extension/dist/manifest.json` is absent.

Run:

```bash
npm run extension:build
npx vitest run --config extension/vitest.smoke.config.ts
```

Expected: PASS.

- [ ] **Step 3: Add installation and compatibility documentation**

Create `extension/README.md` with:

```markdown
# PF2e Combat Notebook extension

## Compatibility

- Chromium
- Foundry VTT 14
- Pathfinder 2e system 8.5.x

This is a player-installed browser extension. It does not install a Foundry module,
change world documents, or request data that the authenticated browser has not received.

## Build and load

1. Run `npm install`.
2. Run `npm run extension:build`.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Choose **Load unpacked** and select `extension/dist`.
6. Open the Foundry game, select the extension toolbar action, and choose
   **Enable this Foundry site**.
7. Reload the Foundry tab once after granting access.

Chrome host match patterns cannot restrict permission to one port. For a local
Foundry URL, Chrome therefore grants the extension access to that hostname on
all ports; the extension's own allowlist activates capture only on the exact
origin (including its configured port).

## Session behavior

Notebook records survive a page reload but clear when the browser session ends.
Use **Clear encounter** to reset the current scope manually.

## Compatibility status

- **Active** means structured Foundry/PF2e capture is running.
- **Fallback** means only supported visible chat cards are recorded.
- **Unsupported** means capture is disabled for this Foundry/PF2e version.
```

Add a short **Chrome extension** subsection to the root `README.md` that links to `extension/README.md` and explicitly distinguishes it from the installable Foundry module.

- [ ] **Step 4: Integrate root verification**

Update `package.json` so:

```json
{
    "clean": "rm -rf dist extension/dist",
    "lint": "eslint src/ plugin/src/ extension/src/",
    "verify": "npm run typecheck && npm run extension:typecheck && npm run lint && npm test && npm run extension:test && npm run build && npm run plugin:build && npm run extension:build && npm run extension:smoke",
    "extension:smoke": "vitest run --config extension/vitest.smoke.config.ts"
}
```

Do not add `extension/dist` to git; it is already ignored through the ESLint ignore and must also be added to `.gitignore`.

- [ ] **Step 5: Run complete verification**

Run:

```bash
npm run verify
git diff --check
```

Expected: all typechecks, lint, tests, three builds, extension artifact smoke test, and whitespace validation pass.

- [ ] **Step 6: Perform the manual acceptance pass**

Load `extension/dist` unpacked in Chromium against Foundry 14/PF2e 8.5 and record evidence in `docs/testing/pf2e-combat-notebook.md` for:

```text
1. Grant only the current Foundry origin and reload.
2. Confirm status is Active and no GM module is enabled.
3. Target one NPC and make attacks producing at least success and failure.
4. Confirm AC candidates narrow and every fact links to evidence/provenance.
5. Pan and zoom; confirm the calm overlay follows and remains readable.
6. Reload; confirm current encounter state restores.
7. Use Clear encounter; confirm sidebar and overlay clear.
8. Disable the origin; confirm sidebar, hooks, and Pixi objects disappear.
9. Open an unsupported PF2e version fixture; confirm Unsupported and no estimates.
10. Confirm Foundry rolls, chat, targeting, and canvas interaction still work after an injected malformed observation.
```

If a real Foundry 14/PF2e 8.5 instance is unavailable, document that manual acceptance remains unverified rather than claiming completion.

- [ ] **Step 7: Commit**

```bash
git add .gitignore package.json README.md extension/README.md extension/vitest.smoke.config.ts extension/tests/build-artifacts.smoke.ts docs/testing/pf2e-combat-notebook.md
git commit -m "docs: verify combat notebook installation"
```

## Final review gate

- [ ] Compare every increment-1 requirement in `docs/superpowers/specs/2026-10-11-pf2e-combat-notebook-extension-design.md` against Tasks 1–11.
- [ ] Search for placeholders with:

```bash
rg -n "TBD|TODO|FIXME|implement later|similar to Task|appropriate error handling" extension docs/testing/pf2e-combat-notebook.md
```

Expected: no matches in newly added extension or testing files.

- [ ] Confirm the branch contains small, ordered commits and no generated extension output:

```bash
git status --short
git log --oneline --reverse main..HEAD
git ls-files extension/dist
```

Expected: clean status, one logical commit per task, and no tracked `extension/dist` files.

- [ ] Push without rewriting history:

```bash
git push -u origin cursor/pf2e-combat-notebook-extension-3bee
```
