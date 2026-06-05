import { describe, expect, it } from "vitest";
import { isAreaContextType } from "../../src/shared/detect-logic.js";

describe("isAreaContextType", () => {
    it.each(["area-save", "area-damage", "area-fire", "auto-fire", "autofire", "area-effect"])(
        "recognizes %s contexts",
        (contextType) => expect(isAreaContextType(contextType)).toBe(true),
    );

    it("does not broaden the exact area-fire spelling", () => {
        expect(isAreaContextType("area-fireball")).toBe(false);
    });
});
