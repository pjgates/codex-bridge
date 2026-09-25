// @vitest-environment happy-dom
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
    class Field {
        label = "";
        constructor(public options: any) {}
        toInput(config: any) { const input = document.createElement("input"); input.name = config.name; input.value = String(config.value ?? ""); return input; }
        toFormGroup(_group: any, config: any) { const group = document.createElement("div"); group.append(this.toInput(config)); return group; }
    }
    class Schema extends Field {
        constructor(public fields: any, options = {}) { super(options); }
        toInput(config: any) { return this._toInput(config); }
        _toInput(_config: any): HTMLElement { throw Error("SchemaField has no native input renderer"); }
    }
    const custom: Record<string, typeof NativeRule & { autogenForms: boolean }> = {};
    vi.stubGlobal("game", { pf2e: { RuleElement: NativeRule, RuleElements: { custom } } });
    vi.stubGlobal("foundry", { data: { fields: { StringField: Field, NumberField: Field,
        BooleanField: Field, ColorField: Field, SchemaField: Schema }, LightData: { defineSchema: () => ({ ...Object.fromEntries(["dim", "alpha", "angle", "bright", "attenuation", "saturation"].map(key => [key, new Field({})])), animation: { fields: { speed: new Field({}), intensity: new Field({}) } }, negative: new Field({}) }) } }, utils: { deepClone: structuredClone } });
    vi.stubGlobal("CONFIG", { Canvas: { lightAnimations: { torch: { label: "Torch" } } } });
    return { custom, constructed, nativeTest };
}

it("registers native schema forms for independent emission, perception and hearing entries", () => {
    const { custom } = setup();
    registerSensoryRuleElements();
    expect(custom.CodexEmitSignal.defineSchema()).toHaveProperty("appearance");
    expect(custom.CodexEmitSignal.defineSchema()).toHaveProperty("light");
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

it("renders nested light and animation settings through the native rule form's field input boundary", () => {
    const { custom } = setup(); registerSensoryRuleElements();
    const field = custom.CodexEmitSignal.defineSchema().light as any;
    const form = document.createElement("form");
    form.append(field.toInput({ name: "system.rules.0.light", value: { dim: 10, animation: { type: "torch", speed: 3 } } }));
    expect(Object.fromEntries(new FormData(form))).toMatchObject({
        "system.rules.0.light.dim": "10", "system.rules.0.light.animation.type": "torch", "system.rules.0.light.animation.speed": "3",
    });
});
