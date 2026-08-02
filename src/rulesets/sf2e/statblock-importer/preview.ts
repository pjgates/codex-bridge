/**
 * Import-preview renderer: a compact statblock where every benchmarkable
 * number carries a colored chip rating it against the GM Core
 * creature-building tables for the creature's level.
 */
import type { CreatureStatblock, StrikeData } from "../statblock/index.js";
import { parseActionFromName, parseIWRString } from "../statblock/index.js";
import { averageDamage, benchmark, type BenchmarkResult } from "./benchmarks.js";

function esc(value: unknown): string {
    return String(value ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
}

/** A value chip like "26 MODERATE" with the level's reference bands as tooltip. */
function chip(value: string | number, result: BenchmarkResult): string {
    const bands = result.bands
        .map((b) => `${b.label} ${b.range ? `${b.range[0]}\u2013${b.range[1]}` : b.at ?? "\u2014"}`)
        .join(" \u00b7 ");
    const approx = result.exact ? "" : "\u2248";
    return (
        `<span class="ssi-chip ssi-${result.label}" data-tooltip="${esc(bands)}">` +
        `${esc(value)} <em>${approx}${esc(result.label)}</em></span>`
    );
}

function signed(n: number): string {
    return n >= 0 ? `+${n}` : `${n}`;
}

function capitalize(s: string): string {
    return s.replace(/(^|[-\s])\w/g, (m) => m.toUpperCase());
}

function strikeRow(strike: StrikeData, level: number): string {
    const damage = strike.damage
        .map((d) => {
            const avg = averageDamage(d.formula);
            const label = d.category === "persistent" ? `persistent ${d.type}` : d.type;
            return `${esc(d.formula)} ${esc(label)} ${chip(`avg ${avg}`, benchmark.strikeDamage(avg, level))}`;
        })
        .join(" plus ");
    const effects = strike.effects?.length ? ` plus ${esc(strike.effects.join(", "))}` : "";
    const traits = strike.traits.length ? ` <span class="ssi-subtle">(${esc(strike.traits.join(", "))})</span>` : "";
    const heading = strike.type === "ranged" ? "Ranged" : "Melee";
    // Area attacks (area-fire/auto-fire) are DC-based; rate the DC on the spell-DC table.
    const accuracy =
        strike.action === "area-fire" || strike.action === "auto-fire"
            ? `DC ${chip(strike.dc ?? 0, benchmark.spellDC(strike.dc ?? 0, level))}`
            : chip(signed(strike.bonus ?? 0), benchmark.strikeAttack(strike.bonus ?? 0, level));
    return `<div class="ssi-row"><strong>${heading}</strong> ${esc(strike.name)} ${accuracy}${traits}, <strong>Damage</strong> ${damage}${effects}</div>`;
}

/** Extract "DC 24" mentions (with optional save name) from ability text. */
function extractDCs(text: string): { dc: number; save?: string }[] {
    const results: { dc: number; save?: string }[] = [];
    for (const match of text.matchAll(/DC\s+(\d+)(?:\s+(?:basic\s+)?(Fortitude|Reflex|Will))?/gi)) {
        results.push({ dc: Number(match[1]), save: match[2]?.toLowerCase() });
    }
    // Also match reversed order: "Reflex save ... DC 24" is rare; keep simple.
    return results;
}

export function renderPreview(sb: CreatureStatblock): string {
    const level = sb.level;
    const rows: string[] = [];

    rows.push(
        `<header class="ssi-head"><h2>${esc(sb.name)}</h2><span class="ssi-level">Creature ${level}</span></header>`,
        `<div class="ssi-traits">` +
            `<span class="ssi-trait ssi-rarity-${esc(sb.rarity)}">${esc(sb.rarity)}</span>` +
            `<span class="ssi-trait">${esc(sb.size)}</span>` +
            sb.traits.map((t) => `<span class="ssi-trait">${esc(t)}</span>`).join("") +
            `</div>`,
    );

    const senseText = [
        ...sb.perception.senses.map((s) =>
            [s.type, s.acuity ? `(${s.acuity})` : "", s.range != null ? `${s.range} feet` : ""].filter(Boolean).join(" "),
        ),
        ...(sb.perception.details ? [sb.perception.details] : []),
    ].join(", ");
    rows.push(
        `<div class="ssi-row"><strong>Perception</strong> ${chip(signed(sb.perception.mod), benchmark.perception(sb.perception.mod, level))}` +
            (senseText ? `; ${esc(senseText)}` : "") +
            `</div>`,
    );

    if (sb.languages.length) {
        rows.push(`<div class="ssi-row"><strong>Languages</strong> ${esc(sb.languages.join(", "))}</div>`);
    }

    const skillParts = Object.entries(sb.skills).map(
        ([slug, mod]) => `${esc(capitalize(slug))} ${chip(signed(mod), benchmark.skill(mod, level))}`,
    );
    for (const lore of sb.lore ?? []) {
        skillParts.push(`${esc(lore.name)} ${chip(signed(lore.mod), benchmark.skill(lore.mod, level))}`);
    }
    if (skillParts.length) rows.push(`<div class="ssi-row"><strong>Skills</strong> ${skillParts.join(", ")}</div>`);

    const attributeParts = (["str", "dex", "con", "int", "wis", "cha"] as const).map(
        (key) => `<strong>${capitalize(key)}</strong> ${chip(signed(sb.abilities[key]), benchmark.attribute(sb.abilities[key], level))}`,
    );
    rows.push(`<div class="ssi-row">${attributeParts.join(", ")}</div>`, `<hr>`);

    const saves = [
        `<strong>Fort</strong> ${chip(signed(sb.saves.fort), benchmark.save(sb.saves.fort, level))}`,
        `<strong>Ref</strong> ${chip(signed(sb.saves.ref), benchmark.save(sb.saves.ref, level))}`,
        `<strong>Will</strong> ${chip(signed(sb.saves.will), benchmark.save(sb.saves.will, level))}`,
    ].join(", ");
    rows.push(`<div class="ssi-row"><strong>AC</strong> ${chip(sb.ac, benchmark.ac(sb.ac, level))}${sb.acNote ? ` <span class="ssi-subtle">(${esc(sb.acNote)})</span>` : ""}; ${saves}</div>`);
    rows.push(`<div class="ssi-row"><strong>HP</strong> ${chip(sb.hp, benchmark.hp(sb.hp, level))}${sb.hpNote ? ` <span class="ssi-subtle">(${esc(sb.hpNote)})</span>` : ""}</div>`);

    const iwrRow = (label: string, raw: string, rateValues: boolean): void => {
        if (!raw) return;
        const parts = parseIWRString(raw).map((entry) => {
            const suffix = entry.exceptions?.length ? ` <span class="ssi-subtle">(except ${esc(entry.exceptions.join(", "))})</span>` : "";
            if (!rateValues || entry.value == null) return `${esc(entry.type)}${suffix}`;
            return `${esc(entry.type)} ${chip(entry.value, benchmark.resistWeak(entry.value, level))}${suffix}`;
        });
        if (parts.length) rows.push(`<div class="ssi-row"><strong>${label}</strong> ${parts.join(", ")}</div>`);
    };
    iwrRow("Immunities", sb.immunities, false);
    iwrRow("Resistances", sb.resistances, true);
    iwrRow("Weaknesses", sb.weaknesses, true);

    const speeds = [
        sb.speed.land ? `${sb.speed.land} feet` : "",
        ...(["fly", "swim", "climb", "burrow"] as const).flatMap((type) =>
            sb.speed[type] != null ? [`${type} ${sb.speed[type]} feet`] : [],
        ),
    ].filter(Boolean);
    rows.push(`<div class="ssi-row"><strong>Speed</strong> ${speeds.join(", ")}</div>`, `<hr>`);

    for (const strike of sb.strikes) rows.push(strikeRow(strike, level));

    for (const entry of sb.spellcasting ?? []) {
        const dcChip = entry.dc != null ? ` DC ${chip(entry.dc, benchmark.spellDC(entry.dc, level))}` : "";
        const bonusChip = entry.bonus != null ? ` ${chip(signed(entry.bonus), benchmark.strikeAttack(entry.bonus, level))}` : "";
        rows.push(`<div class="ssi-row"><strong>${esc(entry.name)}</strong>${dcChip}${bonusChip}</div>`);
    }

    const abilities = [...sb.abilities_top, ...sb.abilities_mid, ...sb.abilities_bot];
    if (abilities.length) {
        rows.push(`<hr>`);
        for (const ability of abilities) {
            const { cleanName, actionType, actions } = parseActionFromName(ability.name);
            const cost = actionType === "action" ? `${actions}a` : actionType === "passive" ? "" : actionType;
            const dcs = extractDCs(ability.desc)
                .map((d) => chip(`DC ${d.dc}${d.save ? ` ${d.save}` : ""}`, benchmark.spellDC(d.dc, level)))
                .join(" ");
            rows.push(
                `<div class="ssi-row"><strong>${esc(cleanName)}</strong>` +
                    (cost ? ` <span class="ssi-cost">[${esc(cost)}]</span>` : "") +
                    (ability.category ? ` <span class="ssi-subtle">(${esc(ability.category)})</span>` : "") +
                    (dcs ? ` ${dcs}` : "") +
                    `</div>`,
            );
        }
    }

    rows.push(
        `<p class="ssi-footnote">Chips rate values against the GM Core creature-building benchmarks for level ${level}.` +
            ` \u2248 marks a value between bands (nearest shown). Ability and area-attack DCs are rated on the spell-DC table.</p>`,
    );

    return `<div class="ssi-preview">${rows.join("\n")}</div>`;
}
