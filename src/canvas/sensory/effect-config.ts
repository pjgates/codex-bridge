import { MODULE_ID } from "../../constants.js";
import { resolveHtmlRoot } from "../../shared/html.js";
import { lookupWorldDefinition, sensoryFlag } from "./definition.js";
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
    Hooks.on("renderItemSheet", (app: { item?: EffectSheetItem; document?: EffectSheetItem }, html: HTMLElement | JQuery) => {
        const item = app.item ?? app.document;
        if (!item || item.type !== "effect" || !item.isEmbedded || item.pack) return;
        const root = resolveHtmlRoot(html);
        const rulesTab = root?.querySelector('.tab[data-tab="rules"]');
        if (!rulesTab || rulesTab.querySelector('[data-codex-sensory="effect"]')) return;
        const section = document.createElement("fieldset");
        section.dataset.codexSensory = "effect";
        const legend = document.createElement("legend");
        legend.textContent = game.i18n!.localize(`${MODULE_ID}.sensory.title`);
        const explicit = sensoryFlag(item.flags, "sensoryDefinition");
        const uuid = explicit === undefined ? item.sourceId : explicit;
        const source = typeof uuid === "string" && lookupWorldDefinition(uuid) ? game.items?.get(uuid.slice(5)) : null;
        const link = document.createElement("a");
        link.dataset.uuid = typeof uuid === "string" ? uuid : "";
        link.textContent = source?.name ?? game.i18n!.localize(`${MODULE_ID}.sensory.missing`);
        if (source) link.addEventListener("click", event => {
            event.preventDefault(); source.sheet?.render(true);
        });
        const hint = document.createElement("p"); hint.className = "hint";
        hint.textContent = game.i18n!.localize(`${MODULE_ID}.sensory.sharedRuleHint`);
        section.append(legend, link, hint);
        rulesTab.prepend(section);
    });
}
