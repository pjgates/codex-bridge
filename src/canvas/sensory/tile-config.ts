import { MODULE_ID } from "../../constants.js";
import { resolveHtmlRoot } from "../../shared/html.js";
import { sensoryFlag } from "./definition.js";
import { sensoryReferenceSelect } from "./reference-select.js";

interface TileSheet {
    document: { flags: unknown };
    _processFormData(...args: unknown[]): { flags?: Record<string, Record<string, unknown>> };
}
const wrapped = new WeakSet<TileSheet>();
let registered: typeof Hooks | null = null;
export function registerSensoryTileConfig(): void {
    if (registered === Hooks) return;
    registered = Hooks;
    Hooks.on("renderTileConfig", (application, html) => {
        const app = application as unknown as TileSheet;
        const root = resolveHtmlRoot(html);
        if (!root || root.querySelector('[data-codex-sensory="tile"]')) return;
        const section = document.createElement("fieldset"); section.dataset.codexSensory = "tile";
        const legend = document.createElement("legend");
        legend.textContent = game.i18n!.localize(`${MODULE_ID}.sensory.tileTitle`);
        const rows = document.createElement("div");
        const renumber = () => rows.querySelectorAll<HTMLElement>("[data-codex-sensory-row]").forEach((row, index) => {
            row.querySelector("select")!.name = `flags.${MODULE_ID}.sensoryEffects.${index}.effectUuid`;
            row.querySelector("input")!.name = `flags.${MODULE_ID}.sensoryEffects.${index}.rank`;
        });
        const addRow = (uuid: string, value: number) => {
            const row = document.createElement("div"); row.dataset.codexSensoryRow = ""; row.className = "form-group";
            const select = sensoryReferenceSelect(uuid);
            select.setAttribute("aria-label", game.i18n!.localize(`${MODULE_ID}.sensory.definition`));
            const rank = document.createElement("input"); rank.type = "number"; rank.min = "0"; rank.step = "1";
            rank.required = true; rank.value = String(value);
            rank.setAttribute("aria-label", game.i18n!.localize(`${MODULE_ID}.sensory.rankLabel`));
            const remove = document.createElement("button"); remove.type = "button"; remove.dataset.action = "remove-sensory";
            remove.textContent = game.i18n!.localize(`${MODULE_ID}.sensory.remove`);
            remove.addEventListener("click", () => { row.remove(); renumber(); });
            row.append(select, rank, remove); rows.append(row); renumber();
        };
        const stored = sensoryFlag(app.document.flags, "sensoryEffects");
        if (Array.isArray(stored)) for (const row of stored) {
            const binding = row && typeof row === "object" ? row : {};
            addRow(typeof binding.effectUuid === "string" ? binding.effectUuid : "", typeof binding.rank === "number" ? binding.rank : 0);
        }
        const add = document.createElement("button"); add.type = "button";
        add.textContent = game.i18n!.localize(`${MODULE_ID}.sensory.add`);
        add.addEventListener("click", () => addRow("", 1));
        section.append(legend, rows, add);
        (root.querySelector('.tab[data-tab="appearance"]') ?? root.querySelector("form") ?? root).append(section);
        if (!wrapped.has(app)) {
            const original = app._processFormData;
            app._processFormData = function (...args) {
                const data = original.apply(this, args);
                const flags = data.flags ??= {};
                const module = flags[MODULE_ID] ??= {};
                module.sensoryEffects = Object.values(module.sensoryEffects ?? {});
                return data;
            };
            wrapped.add(app);
        }
    });
}
