// app/src/components/chart/engine/scriptEngineVersion.js
//
// ─── ⭐⭐ THE SCRIPT ENGINE'S VERSION — ONE NUMBER, ONE PLACE ─────────────────
//
// A member's saved Pine script is stored as the TRANSLATED document the engine
// produced on the day they saved it (`compute.*`, `objects`, `meta.blockRuns`, …)
// plus — since this module — the script itself, in its own server column
// (`api/services/user_definitions.py::MAX_PINE_SOURCE_BYTES`). This number is
// stamped on every document a SCRIPT door writes (`meta.engineVersion`), so a
// later browser can tell "translated by an older engine" from "current" without
// translating anything.
//
// ⛔⛔ WHEN TO BUMP IT — and this is the whole contract:
//   Bump `SCRIPT_ENGINE_VERSION` by one in the SAME commit as any engine change
//   that alters what the translator WRITES for an unchanged script: a value it
//   now computes differently, a plot it now withholds or refuses (C45/C48's
//   `blockRuns` are the model), a new stamp a reader depends on. A change that
//   only alters how an EXISTING document is drawn needs no bump — every chart
//   already draws it with today's code.
//   What a bump does: on each member's next chart load, every saved script
//   document stamped below it that holds its source is re-translated ONCE in the
//   browser, drawn from the new translation, and written back through the
//   ordinary revision-guarded save (`savedScriptUpgrade.js`). The next load sees
//   the new stamp and does no work. Documents saved without their source get the
//   one quiet "Updated accuracy available" row in their legend menu instead.
//   ⛔ Never bump it for a change that does not move translator output: every
//   bump costs one translation + one write per saved script per member.
//
// ⛔ IT IS NOT `memberDocumentMigration.DOOR_VERSION`. That number versions the
// band-opacity RULE a door applied (its rule table must carry an entry per
// version, railed), and a document's bytes can be repaired from it without the
// script. This one versions the TRANSLATOR as a whole and can only be acted on
// with the script in hand. Two questions, two numbers.

/** 1 = the first stamped engine (C45/C48 `blockRuns` withholding is in it). */
export const SCRIPT_ENGINE_VERSION = 1

/** The meta key the stamp lives under. `defSchema` keeps unknown `meta` keys
 *  (ignore-and-preserve), and it sits outside every tree, so no hash moves. */
export const ENGINE_STAMP_KEY = 'engineVersion'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** The engine version a document was translated by, or null when unstamped. */
export function engineStampOf(def) {
  const m = def && isObj(def.meta) ? def.meta : null
  const v = m ? m[ENGINE_STAMP_KEY] : undefined
  return Number.isInteger(v) && v >= 1 ? v : null
}

/** Was this document translated by an engine older than `current`?
 *  An unstamped document counts as older than every engine. */
export function isStaleStamp(def, current = SCRIPT_ENGINE_VERSION) {
  const s = engineStampOf(def)
  return s === null || s < current
}

/** The document stamped with `version` (today's engine by default). */
export function withEngineStamp(def, version = SCRIPT_ENGINE_VERSION) {
  if (!isObj(def)) return def
  return { ...def, meta: { ...(isObj(def.meta) ? def.meta : {}), [ENGINE_STAMP_KEY]: version } }
}

/** The document WITHOUT the stamp — for every door that is not a script door.
 *  ⛔ A hand-edited document must never claim to be the translator's output: the
 *  Formula tab carries the stored row's `meta` through an edit
 *  (`objectProgramCarry.carryProgramMeta`), and a carried stamp would tell the
 *  next engine "current" about maths the member changed. The same object back
 *  when there is nothing to strip. */
export function withoutEngineStamp(def) {
  if (!isObj(def) || !isObj(def.meta) || !(ENGINE_STAMP_KEY in def.meta)) return def
  const meta = { ...def.meta }
  delete meta[ENGINE_STAMP_KEY]
  return { ...def, meta }
}
