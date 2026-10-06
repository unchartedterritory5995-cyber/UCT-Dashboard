// app/src/components/chart/builder/authoring/index.js — P2 conversational
// authoring, the deterministic half. Contract: scratchpad P2-DESIGN.md and
// `patchSchema.json` beside this file.
export { applyPatch, gateTree, PATCH_NODE_TYPES, EMPTY_REQUESTS } from './applyPatch'
export { validatePatchShape, PATCH_SCHEMA, PATCH_CONTRACT, PATCH_LIMITS, OP_NAMES } from './patchValidate'
export { parameterSlots, clausesOf, slotsOfTree, clausesOfTree, parseSlotId } from './slots'
export { modelOf, buildFromModel, fidelityResidual, AuthoringError } from './model'
export { compactView, VIEW_CONTRACT, VIEW_MAX_CHARS } from './compactView'
export { readback, presentationLines, SEMANTICS_LINE } from './readback'
export { nameOfTree, derivedDefName, derivedRowName, namingSnapshot, applyDerivedNaming } from './derivedName'
export {
  newAuthoringState, openAuthoringState, applyTurn, undo, prepareSave, STATE_CONTRACT, HISTORY_MAX,
} from './authoringState'
