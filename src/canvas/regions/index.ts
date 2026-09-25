/** Canonical, independently registered region data. No token movement handlers. */
export function registerRegionBehaviors(): void {
    const { RegionBehaviorType } = foundry.data.regionBehaviors;
    class SetElevation extends RegionBehaviorType<{elevation:foundry.data.fields.NumberField;climbPreset:foundry.data.fields.StringField;climbDC:foundry.data.fields.NumberField;grabEdgeDC:foundry.data.fields.NumberField}> {
        static LOCALIZATION_PREFIXES = ["codex-foundry.regions.setElevation"];
        static defineSchema() {
            return {
                elevation: new foundry.data.fields.NumberField({ required: true, nullable: false, initial: 0 }),
                climbPreset: new foundry.data.fields.StringField({initial:"legacy",choices:{legacy:"Unspecified (existing region DC or ask GM)",manual:"Ask GM",untrained:"Ladder / steep slope (DC 10)",trained:"Rope / typical tree (DC 15)",expert:"Small handholds (DC 20)",master:"Rock wall / ceiling handholds (DC 30)",legendary:"Smooth surface (DC 40)"}}),
                climbDC: new foundry.data.fields.NumberField({nullable:true,initial:null,min:0,integer:true}),
                grabEdgeDC: new foundry.data.fields.NumberField({nullable:true,initial:null,min:0,integer:true}),
            };
        }
        static events = {};
    }
    class Water extends RegionBehaviorType<{swimPreset:foundry.data.fields.StringField;swimDC:foundry.data.fields.NumberField}> {
        static LOCALIZATION_PREFIXES = ["codex-foundry.regions.water"];
        static defineSchema() { return {
            swimPreset:new foundry.data.fields.StringField({initial:"unspecified",choices:{unspecified:"Unspecified — ask GM",calm:"Calm / still water (normally automatic critical success)",flowing:"Flowing river (DC 15)",swift:"Swift river (DC 20)",stormy:"Stormy sea (DC 30)",maelstrom:"Maelstrom / waterfall (DC 40)"}}),
            swimDC:new foundry.data.fields.NumberField({nullable:true,initial:null,min:0,integer:true}),
        }; }
        static events = {};
    }
    class SurfaceGeometry extends RegionBehaviorType<{
        extent:foundry.data.fields.StringField;underside:foundry.data.fields.NumberField;
        blocksSight:foundry.data.fields.BooleanField;blocksLight:foundry.data.fields.BooleanField;
    }> {
        static LOCALIZATION_PREFIXES = ["codex-foundry.regions.surfaceGeometry"];
        static defineSchema() {
            const {StringField, NumberField, BooleanField} = foundry.data.fields;
            return {
                extent:new StringField({initial:"unknown",choices:{unknown:"Unknown",solid:"Solid terrain",finite:"Finite slab / deck"}}),
                underside:new NumberField({nullable:true,initial:null}),
                blocksSight:new BooleanField({initial:true}),
                blocksLight:new BooleanField({initial:true}),
            };
        }
        static events = {};
    }
    Object.assign(CONFIG.RegionBehavior.dataModels, { "codex-foundry.setElevation": SetElevation, "codex-foundry.water": Water, "codex-foundry.surfaceGeometry": SurfaceGeometry });
    Object.assign(CONFIG.RegionBehavior.typeIcons, { "codex-foundry.setElevation": "fa-solid fa-arrows-up-down", "codex-foundry.water": "fa-solid fa-water", "codex-foundry.surfaceGeometry": "fa-solid fa-layer-group" });
}

export { migrateLegacy } from "./migration.js";
export { isFloorType, isWaterType } from "./types.js";
export { supportsAt, selectSupport } from "./support.js";
export type { Support, SupportSelection, SurfaceScene, SurfaceRegion, PolygonNode, Point } from "./support.js";
export { traceContacts, segmentParameters } from "./contacts.js";
export type { Contact, ContactWaypoint, OriginToken } from "./contacts.js";
export { regionDC, terrainDC } from "./config.js";
export { waterLanding } from "./water.js";

export { readSurfaceGeometry, geometryPreset } from "./geometry.js";
export { activateGeometryConfig } from "./geometry-config.js";
export { faceBetween } from "./faces.js";
export type { FaceResult } from "./faces.js";
export {configureSurfaceVisibility,activateSurfaceVisibility} from "./visibility.js";
