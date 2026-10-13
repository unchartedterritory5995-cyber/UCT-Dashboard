// app/src/components/chart/engine/indicatorHistory.js
//
// ⭐ A1.2 — THE INDICATOR UNDO RECORD. Pure (no React, no storage); Indicators-owned.
//
// A member's indicator change (hide, show, add, remove, remove-all, the moving-average
// toggle, the region hide, a chip action) is recorded as an ELEMENT record over the
// settings exactly as the chart reads them back (`mergeChartSettings(JSON.stringify(x))`):
// one whole instance per path, every other changed top-level key whole. Undo writes the
// stored `before` back verbatim — byte-identical after the persisted read.
//
// ⛔ NEVER PARTIAL, NEVER STALE. Undo applies only if every recorded path still holds the
// value the change left there. If anything it touched has moved since — another tab, the
// Agent, an unrecorded edit to the same instance — it refuses with `changed-since` and
// writes nothing. An unrecorded edit to a DIFFERENT instance does not block it.
//
// The record shape and the exactness check are the Agent's (`settingsRecord.js`, shared
// since A1.0); only the token differs, so neither undo engine accepts the other's records.

import { mergeChartSettings } from '../chartDefaults'
import { elementRecord, invertRecord, revertRecord, ELEMENT } from './settingsRecord'

export const HISTORY_CONTRACT = 'uct.indicators.history/1'
export const HISTORY_SETTINGS_VERSION = 2

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/** The settings as the chart reads them back after a save. Records and checks compare here,
 *  so a reload is never mistaken for a conflict. */
export function readBack(cs) {
  if (!isObj(cs)) return null
  try { return mergeChartSettings(JSON.stringify(cs)) } catch { return null }
}

/** The record of `before → after`, or null when nothing changed (nothing to undo). */
export function recordOf(before, after) {
  const a = readBack(before)
  const b = readBack(after)
  if (!a || !b) return null
  const rec = elementRecord(a, b)
  return rec.paths.length ? { contract: HISTORY_CONTRACT, settingsVersion: HISTORY_SETTINGS_VERSION, ...rec } : null
}

const valid = (record) => isObj(record) && record.contract === HISTORY_CONTRACT
  && record.settingsVersion === HISTORY_SETTINGS_VERSION && record.granularity === ELEMENT && Array.isArray(record.paths)

function apply(cs, record) {
  if (!valid(record)) return { ok: false, reason: 'bad-record' }
  const view = readBack(cs)
  if (!view) return { ok: false, reason: 'bad-record' }
  const r = revertRecord(view, record)
  if (!r.ok) return { ok: false, reason: 'changed-since', detail: { path: r.path, instanceId: instanceOfPath(r.path) } }
  return { ok: true, cs: r.cs }
}

const instanceOfPath = (path) => (Array.isArray(path) && isObj(path[1]) ? path[1].instanceId : null)

/** Undo `record` on `cs`: `{ok:true, cs}` | `{ok:false, reason:'changed-since'|'bad-record', detail}`. */
export const applyUndo = (cs, record) => apply(cs, record)
/** Redo `record` on `cs` (after an Undo). Same refusals. */
export const applyRedo = (cs, record) => (valid(record) ? apply(cs, invertRecord(record)) : { ok: false, reason: 'bad-record' })
/** Would Undo / Redo apply right now? */
export const canApply = (cs, record, dir = 'undo') => (dir === 'redo' ? applyRedo(cs, record) : applyUndo(cs, record)).ok
