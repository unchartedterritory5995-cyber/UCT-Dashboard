// app/src/components/chart/engine/memberDocumentProjection.js
//
// ⭐⭐ SETTINGS PARITY (2a / 2c) — WHAT A MEMBER DOCUMENT DECLARES ON LOAD, BESIDE WHAT IT STORES.
//
// `memberDocumentMigration.migrateMemberDocument` upgrades a stored document to today's shape (pure,
// idempotent, held equal to its server twin by parity fixtures that compare documents byte for
// byte). The settings below are NOT an upgrade of the stored shape: they are a load-time view of
// what the document already holds, never written back (`paramInputs.stripParamInputs` takes them
// off any save), so they live in their own step after the migration:
//   * `param<N>`: every folded length the translator recorded (`paramInputs.withParamInputs`);
//   * a symbol the script reads through an input (`symbolInputs.withSymbolInputs`);
//   * a run half's own settings: the inputs only its drawings read (`runHalfInputs.withRunHalfInputs`);
//   * a runtime document's timeframe inputs (`runtime/runtimeInputs.withTimeframeInputs`, engine 77, #1831).
// `nativeRegistry.validateUserDefinitions` installs `projectMemberDocument(def)`.

import { migrateMemberDocument } from './memberDocumentMigration.js'
import { withParamInputs } from './paramInputs.js'
import { withRunHalfInputs } from './runHalfInputs.js'
import { withSymbolInputs } from './symbolInputs.js'
import { withTimeframeInputs } from './runtime/runtimeInputs.js'

/** The stored document migrated to today's shape, with its load-time settings declared. */
export function projectMemberDocument(def) {
  return withTimeframeInputs(withRunHalfInputs(withSymbolInputs(withParamInputs(migrateMemberDocument(def)))))
}
