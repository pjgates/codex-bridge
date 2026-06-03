// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { reserveTargetRowsWrapper } from "../../src/target-helper/render.js";

describe("reserveTargetRowsWrapper", () => {
    it("reserves the target rows container synchronously", () => {
        const parent = document.createElement("div");

        const firstWrapper = reserveTargetRowsWrapper(parent);
        const secondWrapper = reserveTargetRowsWrapper(parent);

        expect(firstWrapper).not.toBeNull();
        expect(secondWrapper).toBeNull();
        expect(parent.querySelectorAll(".th-target-rows")).toHaveLength(1);
    });
});
