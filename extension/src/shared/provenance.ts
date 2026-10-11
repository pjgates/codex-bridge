export type Provenance = "exact-client" | "observed" | "inferred" | "possible";

export const PROVENANCES: readonly Provenance[] = ["exact-client", "observed", "inferred", "possible"];

export function provenanceLabel(provenance: Provenance): string {
    switch (provenance) {
        case "exact-client":
            return "exact client data";
        case "observed":
            return "observed";
        case "inferred":
            return "inferred";
        case "possible":
            return "possible";
        default: {
            const unreachable: never = provenance;
            return unreachable;
        }
    }
}
