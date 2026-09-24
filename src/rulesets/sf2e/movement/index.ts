export { registerMovementSettings, movementFeatureEnabled, movementOutcomeMode } from "./settings.js";
export { activateMovementTransitions, requestFall, previewElevations } from "./transitions.js";
export { activateMovementDecisions, openDecision } from "./decisions.js";
export { resolveMovementChoice } from "./resolution.js";
export { movementControls } from "./controls.js";
export { registerForcedMovement, activateForcedPreview, forcedIntent, forcedMovementHeld } from "./forced.js";
export { activateFlightUpkeep } from "./upkeep.js";
export { registerTerrainPolicy, clearTerrainOverride, terrainChecksRequired } from "./policy.js";

export { activateTerrainStatuses, ensureTerrainMacros } from "./status-lifecycle.js";
export { setTerrainStatus, hasTerrainStatus } from "./status.js";

export {previewSummary, routeBudget, type MovementPlan, type PreviewSummary, type BudgetLeg} from "./preview.js";
export {activatePauseMarker} from "./pause-marker.js";
export {activateExplorationNotices} from "./exploration-notices.js";
export {activateSwimUpkeep} from "./swim-upkeep.js";
export {movementBudgetCost} from "./budget-cost.js";
