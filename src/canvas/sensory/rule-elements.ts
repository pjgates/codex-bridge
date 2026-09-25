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
    const { StringField, NumberField, BooleanField, ColorField, SchemaField } = foundry.data.fields;
    class AppearanceFields extends SchemaField<Record<string, foundry.data.fields.DataField.Any>, { label?: string; hint?: string }> {
        protected override _toInput(config: foundry.data.fields.DataField.ToInputConfig<Record<string, unknown>> & { rootId?: string }): HTMLElement {
            const group = document.createElement("fieldset");
            for (const [key, field] of Object.entries(this.fields)) {
                group.append(field.toFormGroup({ rootId: config.rootId, label: field.label || key[0].toUpperCase() + key.slice(1) },
                    { ...config, localize: true, name: `${config.name}.${key}`, value: config.value?.[key] }));
            }
            return group;
        }
    }
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
            const native = foundry.data.LightData.defineSchema();
            const { alpha, angle, bright, dim, attenuation, saturation } = native;
            const animation = new AppearanceFields({
                ...native.animation.fields,
                type: new StringField({ nullable: true, blank: false, initial: null, label: "Animation",
                    choices: () => Object.fromEntries(Object.entries(CONFIG.Canvas.lightAnimations).map(([key, value]) => [key, value.label])) }),
            });
            return { ...super.defineSchema(),
                appearance: new StringField({ required: true, nullable: false, initial: "glow", label: "Appearance",
                    choices: { glow: "Soft glow", light: "Light appearance (visual only)" } }),
                light: new AppearanceFields({ alpha, angle, bright, dim, attenuation, saturation, animation,
                    coloration: new NumberField({ required: true, nullable: false, integer: true, initial: 1, label: "Colour technique",
                        choices: () => Object.fromEntries(Object.values(foundry.canvas.rendering.shaders.AdaptiveLightingShader.SHADER_TECHNIQUES)
                            .map(technique => [technique.id, technique.label])) }),
                },
                    { label: "Light appearance", hint: "Visual only. Set a bright or dim radius in scene units. Uses the rule colour; strength scales opacity. Tile artwork bounds and clipping still apply." }),
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
