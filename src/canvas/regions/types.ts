export function isFloorType(type: string): boolean {
    return type === "codex-foundry.setElevation" || type === "map-workshop-importer.setElevation";
}
export function isWaterType(type: string): boolean {
    return type === "codex-foundry.water" || type === "map-workshop-importer.water";
}

export function isGeometryType(type: string): boolean {
    return type === "codex-foundry.surfaceGeometry" || type === "map-workshop-importer.surfaceGeometry";
}
