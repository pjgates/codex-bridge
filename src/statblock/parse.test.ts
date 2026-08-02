import { describe, expect, it } from "vitest";
import { normaliseStatblock } from "./parse.js";

const MINIMAL_STATBLOCK = {
    name: "Sense Test",
    level: 1,
    ac: 10,
    hp: 10,
    modifier: 0,
    attributes: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    saves: { fort: 0, ref: 0, will: 0 },
    speed: 0,
    attacks: [],
    abilities_top: [],
    abilities_mid: [],
    abilities_bot: [],
};

function strictPerception(senses: string) {
    return normaliseStatblock({ ...MINIMAL_STATBLOCK, senses }, "test.md").perception;
}

describe("normalisePerception (strict mode)", () => {
    it("routes reviewed sandsense segments to perception.details while keeping known senses structured", () => {
        expect(strictPerception("darkvision, sandsense (imprecise) 120 feet")).toEqual({
            mod: 0,
            senses: [{ type: "darkvision" }],
            details: "sandsense (imprecise) 120 feet",
        });
    });

    it("routes sandsense-only strings to details with no structured senses", () => {
        expect(strictPerception("sandsense")).toEqual({
            mod: 0,
            senses: [],
            details: "sandsense",
        });
    });

    it("still rejects unreviewed unknown sense types", () => {
        expect(() => strictPerception("voidsight 60 feet")).toThrow(
            'test.md: senses[0].type: unknown sense type "voidsight"',
        );
    });

    it("rejects empty comma-separated sense segments in strict mode", () => {
        expect(() => strictPerception("darkvision,, scent (imprecise) 30 feet")).toThrow(
            'test.md: senses[1]: expected a sense like "scent (imprecise) 30 feet"',
        );
    });
});
