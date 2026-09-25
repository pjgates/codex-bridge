import type { SensoryItem, SensoryRule } from "./types.js";

interface NativeRuleElement {
    test(): boolean;
}
interface NativeRuleElementClass {
    new(source: SensoryRule, options: { parent: SensoryItem; strict: boolean; suppressWarnings: boolean }): NativeRuleElement;
    defineSchema(): Record<string, unknown>;
}
interface SensoryRuleElementClass extends NativeRuleElementClass {
    new(source: SensoryRule, options: { parent: SensoryItem; strict: boolean; suppressWarnings: boolean }): NativeRuleElement & {
        isActive(): boolean;
    };
}
interface RuleElementApi {
    RuleElement: NativeRuleElementClass;
    RuleElements: { custom: Record<string, SensoryRuleElementClass> };
}
function ruleElementApi(): RuleElementApi | undefined {
    return (game as unknown as { pf2e?: RuleElementApi }).pf2e;
}

/** Use the native Rules selector, repeatable entries, and schema-generated forms. */
export function registerSensoryRuleElements(): void {
    const api = ruleElementApi();
    if (!api?.RuleElement || !api.RuleElements) return;
    const { StringField, NumberField, BooleanField, ColorField } = foundry.data.fields;
    class SignalRuleElement extends api.RuleElement {
        static autogenForms = true;
        static defineSchema(): Record<string, unknown> {
            return { ...super.defineSchema(),
                channel: new StringField({ required: true, nullable: false, initial: "", label: "Channel" }),
            };
        }
        isActive(): boolean { return this.test(); }
    }
    class EmitSignal extends SignalRuleElement {
        static defineSchema(): Record<string, unknown> {
            return { ...super.defineSchema(),
                strength: new StringField({ required: true, nullable: false, initial: "rank",
                    choices: { rank: "Effect rank", fixed: "Fixed strength" }, label: "Strength" }),
                fixed: new NumberField({ required: true, nullable: false, initial: 1, min: 0, label: "Fixed strength" }),
                colour: new ColorField({ required: true, nullable: false, initial: "#ffffff", label: "Colour" }),
            };
        }
    }
    class PerceiveSignal extends SignalRuleElement {
        static defineSchema(): Record<string, unknown> {
            return { ...super.defineSchema(),
                minRank: new NumberField({ required: true, nullable: false, initial: 1, min: 1, integer: true, label: "Minimum rank" }),
                range: new NumberField({ required: true, nullable: false, initial: 0, min: 0, label: "Range (scene units)" }),
                walls: new BooleanField({ initial: false, label: "Blocked by walls" }),
            };
        }
    }
    class HearSignal extends SignalRuleElement {
        static defineSchema(): Record<string, unknown> {
            return { ...super.defineSchema(),
                minRank: new NumberField({ required: true, nullable: false, initial: 1, min: 1, integer: true, label: "Minimum rank" }),
            };
        }
    }
    Object.assign(api.RuleElements.custom, {
        CodexEmitSignal: EmitSignal, CodexPerceiveSignal: PerceiveSignal, CodexHearSignal: HearSignal,
    });
}

/** Evaluate current world rules in the applied Effect's native actor context. */
export function testSensoryRule(rule: SensoryRule, item: SensoryItem): boolean {
    const RuleClass = ruleElementApi()?.RuleElements.custom[rule.key];
    if (!RuleClass) return false;
    const instance = new RuleClass(foundry.utils.deepClone(rule), {
        parent: item, strict: false, suppressWarnings: true,
    });
    return instance.isActive();
}
