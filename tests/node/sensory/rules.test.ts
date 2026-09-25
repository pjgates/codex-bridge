import { expect, it } from "vitest";
import { readSensoryRules } from "../../../src/canvas/sensory/rules.js";

it("reads independent channels and native rules with omitted default fields", () => {
    const rules = readSensoryRules([
        { key: "CodexEmitSignal", channel: "mineral", colour: "#ffd700" },
        { key: "CodexPerceiveSignal", channel: "mineral", minRank: 2, range: 30 },
        { key: "CodexHearSignal", channel: "voices" },
        { key: "FlatModifier", selector: "perception", value: 1 },
        { key: "CodexPerceiveSignal", channel: "mineral", minRank: 4, range: 90, walls: true },
    ]);
    expect(rules).toEqual([
        { key: "CodexEmitSignal", channel: "mineral", strength: "rank", fixed: 1, colour: "#ffd700" },
        { key: "CodexPerceiveSignal", channel: "mineral", minRank: 2, range: 30, walls: false },
        { key: "CodexHearSignal", channel: "voices", minRank: 1 },
        { key: "CodexPerceiveSignal", channel: "mineral", minRank: 4, range: 90, walls: true },
    ]);
});

it("disables malformed, unfinished and ignored rules without losing a valid sibling", () => {
    const sources = [
        { key: "CodexEmitSignal" },
        { key: "CodexEmitSignal", channel: "x", strength: "fixed", fixed: 0 },
        { key: "CodexEmitSignal", channel: "x", colour: "not-a-colour" },
        { key: "CodexPerceiveSignal", channel: "x" },
        { key: "CodexHearSignal", channel: "x", minRank: 1.5 },
        { key: "CodexHearSignal", channel: "x", minRank: null },
        { key: "CodexHearSignal", channel: "x", ignored: true },
        { key: "CodexHearSignal", channel: "x", predicate: {} },
        { key: "CodexHearSignal", channel: "x", spinoff: "other-effect" },
        { key: "CodexHearSignal", channel: "kept", predicate: ["stance:open"] },
    ];
    expect(readSensoryRules(sources)).toEqual([
        { key: "CodexHearSignal", channel: "kept", minRank: 1, predicate: ["stance:open"] },
    ]);
    expect(readSensoryRules(null)).toEqual([]);
});

it("retains light appearance settings and rejects invalid appearance selectors", () => {
    const light = { dim: 10, bright: 3, alpha: 0.6, animation: { type: "torch", speed: 2 } };
    const rules = readSensoryRules([
        { key: "CodexEmitSignal", channel: "gold", appearance: "light", light },
        { key: "CodexEmitSignal", channel: "gold", appearance: "unknown" },
        { key: "CodexEmitSignal", channel: "gold", appearance: "light", light: [] },
    ]);
    expect(rules).toEqual([{ key: "CodexEmitSignal", channel: "gold", strength: "rank", fixed: 1,
        colour: "#ffffff", appearance: "light", light }]);
});
