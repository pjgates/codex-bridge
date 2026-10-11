import { describe, expect, it } from "vitest";
import { PROVENANCES, provenanceLabel } from "../../src/shared/provenance.js";

describe("provenance labels", () => {
    it("labels every provenance kind once", () => {
        expect(PROVENANCES.map(provenanceLabel)).toEqual(["exact client data", "observed", "inferred", "possible"]);
    });
});
