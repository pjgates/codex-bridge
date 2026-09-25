import { afterEach, expect, it, vi } from "vitest";
import { registerSensoryRuleElements, testSensoryRule } from "../../../src/canvas/sensory/rule-elements.js";
import type { SensoryRule } from "../../../src/canvas/sensory/types.js";
import { effect } from "./fixtures.js";

afterEach(() => vi.unstubAllGlobals());

function setup() {
    const constructed = vi.fn();
    const nativeTest = vi.fn(() => true);
    class NativeRule {
        static defineSchema() { return { predicate: "native-predicate" }; }
        constructor(source: unknown, options: unknown) { constructed(source, options); }
        test() { return nativeTest(); }
    }
    class Field { constructor(public options: object) {} }
    const custom: Record<string, typeof NativeRule & { autogenForms: boolean }> = {};
    vi.stubGlobal("game", { pf2e: { RuleElement: NativeRule, RuleElements: { custom } } });
    vi.stubGlobal("foundry", { data: { fields: { StringField: Field, NumberField: Field,
        BooleanField: Field, ColorField: Field } }, utils: { deepClone: structuredClone } });
    return { custom, constructed, nativeTest };
}

it("registers native schema forms for independent emission, perception and hearing entries", () => {
    const { custom } = setup();
    registerSensoryRuleElements();
    for (const [key, field] of [["CodexEmitSignal", "strength"], ["CodexPerceiveSignal", "range"],
        ["CodexHearSignal", "minRank"]]) {
        expect(custom[key], `${key} must be available to the native Rules selector`).toBeDefined();
        expect(custom[key].autogenForms).toBe(true);
        expect(custom[key].defineSchema()).toHaveProperty(field);
        expect(custom[key].defineSchema()).toHaveProperty("predicate", "native-predicate");
    }
});

it("evaluates a fresh canonical rule with the applied Effect and honors the native predicate result", () => {
    const { constructed, nativeTest } = setup();
    registerSensoryRuleElements();
    const item = effect(3);
    const rule: SensoryRule = { key: "CodexHearSignal", channel: "alpha", minRank: 1,
        predicate: ["self:condition:observing"] };
    expect(testSensoryRule(rule, item)).toBe(true);
    expect(constructed).toHaveBeenLastCalledWith(rule, { parent: item, strict: false, suppressWarnings: true });
    expect(constructed.mock.lastCall![0]).not.toBe(rule);
    expect(constructed.mock.lastCall![0].predicate).not.toBe(rule.predicate);
    rule.predicate = ["self:condition:invisible"];
    nativeTest.mockReturnValue(false);
    expect(testSensoryRule(rule, item)).toBe(false);
    expect(constructed.mock.lastCall![0].predicate).toEqual(["self:condition:invisible"]);
});
