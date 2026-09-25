import { MODULE_ID } from "../../constants.js";
import { resolveHtmlRoot } from "../../shared/html.js";
import { lookupWorldDefinition, readDefinition, sensoryFlag } from "./definition.js";
import type { SensoryItem } from "./types.js";

interface EffectSheetItem extends SensoryItem {
    actor?: unknown; isEmbedded: boolean; pack?: string | null;
    updateSource(changes: Record<string, unknown>): unknown;
}
let registered: typeof Hooks | null = null;
interface WorldCopyItem {
    uuid: string; isEmbedded: boolean; pack: string | null;
    toObject(...args: unknown[]): { flags: Record<string, Record<string, unknown>> };
}
const copyBoundaries = new WeakSet<object>();
export function registerSensoryEffectConfig(): void {
    if (registered === Hooks) return;
    registered = Hooks;
    const itemClass = CONFIG.Item.documentClass.prototype as unknown as WorldCopyItem;
    if (!copyBoundaries.has(itemClass)) {
        const serialize = itemClass.toObject;
        itemClass.toObject = function (...args) {
            const data = serialize.apply(this, args);
            // PF2e world drops clone serialized data without addSource; capture identity before that clone.
            if (!this.isEmbedded && !this.pack && lookupWorldDefinition(this.uuid)) {
                (data.flags[MODULE_ID] ??= {}).sensoryDefinition = this.uuid;
            }
            return data;
        };
        copyBoundaries.add(itemClass);
    }
    Hooks.on("preCreateItem", (item: EffectSheetItem) => {
        if (!item.actor || item.type !== "effect") return;
        const explicit = sensoryFlag(item.flags, "sensoryDefinition");
        const uuid = explicit === undefined ? item.sourceId : explicit;
        if (typeof uuid === "string" && lookupWorldDefinition(uuid)) {
            item.updateSource({ [`flags.${MODULE_ID}.sensoryDefinition`]: uuid });
        }
    });
    Hooks.on("renderItemSheet", (app: { item?: EffectSheetItem; document?: EffectSheetItem; isEditable: boolean }, html: HTMLElement | JQuery) => {
        const item = app.item ?? app.document;
        if (!item || item.type !== "effect" || item.pack) return;
        const root = resolveHtmlRoot(html);
        if (!root || root.querySelector('[data-codex-sensory="effect"]')) return;
        const section = document.createElement("fieldset");
        section.dataset.codexSensory = "effect";
        const legend = document.createElement("legend");
        legend.textContent = game.i18n!.localize(`${MODULE_ID}.sensory.title`);
        section.append(legend);
        if (item.isEmbedded) {
            const explicit = sensoryFlag(item.flags, "sensoryDefinition");
            const uuid = explicit === undefined ? item.sourceId : explicit;
            const source = typeof uuid === "string" && lookupWorldDefinition(uuid) ? game.items?.get(uuid.slice(5)) : null;
            const link = document.createElement("a");
            link.dataset.uuid = typeof uuid === "string" ? uuid : "";
            link.textContent = source?.name ?? game.i18n!.localize(`${MODULE_ID}.sensory.missing`);
            if (source && lookupWorldDefinition(source.uuid)) link.addEventListener("click", event => {
                event.preventDefault(); source.sheet?.render(true);
            });
            section.append(link);
        } else {
            const definition = readDefinition(sensoryFlag(item.flags, "sensory"));
            if (!app.isEditable) section.append(definition?.channel ?? "");
            else {
                const fields: [string, string, string | number | boolean][] = [
                    ["channel", "text", definition?.channel ?? ""],
                    ["emission.enabled", "checkbox", definition?.emission.enabled ?? false],
                    ["emission.strength", "select", definition?.emission.strength ?? "rank"],
                    ["emission.fixed", "number", definition?.emission.fixed ?? 1],
                    ["emission.colour", "color", definition?.emission.colour ?? "#ffffff"],
                    ["glow.enabled", "checkbox", definition?.glow.enabled ?? false],
                    ["glow.minRank", "number", definition?.glow.minRank ?? 1],
                    ["glow.range", "number", definition?.glow.range ?? 0],
                    ["glow.walls", "checkbox", definition?.glow.walls ?? false],
                    ["hearing.enabled", "checkbox", definition?.hearing.enabled ?? false],
                    ["hearing.minRank", "number", definition?.hearing.minRank ?? 1],
                ];
                for (const [path, type, value] of fields) {
                    const group = document.createElement("label"); group.className = "form-group";
                    const text = document.createElement("span");
                    text.textContent = game.i18n!.localize(`${MODULE_ID}.sensory.${path}`);
                    const input = type === "select" ? document.createElement("select") : document.createElement("input");
                    input.name = `flags.${MODULE_ID}.sensory.${path}`;
                    if (input instanceof HTMLSelectElement) for (const strength of ["rank", "fixed"]) {
                        const option = document.createElement("option"); option.value = strength;
                        option.textContent = game.i18n!.localize(`${MODULE_ID}.sensory.${strength}`); input.append(option);
                    }
                    else { input.type = type; if (type === "checkbox") {
                        input.checked = Boolean(value); input.dataset.dtype = "Boolean";
                    } }
                    input.value = String(value);
                    group.append(text, input); section.append(group);
                }
                const field = (path: string) => section.querySelector<HTMLInputElement>(`[name="flags.${MODULE_ID}.sensory.${path}"]`)!;
                const validate = () => {
                    field("channel").required = ["emission", "glow", "hearing"].some(key => field(`${key}.enabled`).checked);
                    for (const key of ["glow", "hearing"]) {
                        const input = field(`${key}.minRank`); input.step = "1";
                        input.min = field(`${key}.enabled`).checked ? "1" : "0";
                    }
                    field("glow.range").min = field("glow.enabled").checked ? "0.01" : "0";
                    field("glow.range").step = "any";
                    field("emission.fixed").min = "0.01"; field("emission.fixed").step = "any";
                };
                section.addEventListener("change", validate); validate();
            }
        }
        (root.querySelector('.tab[data-tab="details"]') ?? root.querySelector("form") ?? root).append(section);
    });
}
