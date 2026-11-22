// app/src/components/chart/builder/authoring/restoreVersion.js
//
// GOING BACK TO AN EARLIER SAVED VERSION, FROM THE DOCK (Indicators backlog 30).
//
// The dock's History covered the steps of the current draft. The store keeps every saved version
// too (`GET /{id}/history`), and until now those were only listed, read-only, on the builder's
// Share tab. This is the page side of bringing one back. Rules agreed with the engine's owner,
// 2026-11-17:
//
//   1. Restoring version K makes K's document the working copy as ONE undoable step. Nothing is
//      saved until the member saves, and that save is an ordinary edit on top of the stored
//      version this dock opened (compare-and-set, as for any edit).
//   2. LINE IDENTITY (owner decision 2026-11-02: a new line never silently inherits a deleted
//      line's references or alerts). A line of K keeps its place only when K's identity for its
//      key EQUALS the current version's identity for the same key. Otherwise the plot carries the
//      new-line mark, so the store mints a fresh identity. That covers both cases: the key holds
//      a different line today, and the key is absent today (the line was deleted since K) — an
//      alert archived when that line was deleted does NOT re-attach.
//   3. Lines the current version has and K lacks are removed, as in any edit.
//   4. K is checked under TODAY's engine and grammar before it is offered: the same install door
//      a saved definition goes through, on the document as the store serves it now (the store
//      stamps a version whose script is on a refusal list at read time). A version that cannot
//      come back says why, by name; it is never silently missing.
//   5. Nothing the store decides is copied from K: the stamps the store owns follow the current
//      version (`CARRIED_COMPUTE`, `meta.semantics`), exactly as an edit carries them, and the
//      store re-decides them on save. K's row-level status and verdicts are never read here.
//
// ⛔ Identity is the ENGINE's vocabulary (`engine/lineIdentity`); nothing here invents a rule.

import { lineIdentity, plotLineOf, NEW_LINE_FLAG } from '../../engine/lineIdentity'
import { validateUserDefinitions } from '../../engine/nativeRegistry'
import { conversationEditability, memberError } from './memberWords'
import { CARRIED_COMPUTE, stableJson } from './model'
import { replaceWorking } from './authoringState'

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/** The store-owned stamp on a document's meta (`user_definitions.decide_semantics`). */
const CARRIED_META = Object.freeze(['semantics'])

/** Copy `keys` of `from` onto `onto` (a fresh object): present in `from` wins, absent is removed. */
function followCurrent(onto, from, keys) {
  const out = { ...onto }
  for (const k of keys) {
    if (isObj(from) && k in from) out[k] = from[k]
    else delete out[k]
  }
  return out
}

/** The imported-parameter roster of a document, wherever it keeps it; null when it has none. */
function parameterRoster(def) {
  const c = isObj(def) && isObj(def.compute) ? def.compute : null
  if (!c) return null
  if (isObj(c.graph) && isObj(c.graph.parameters)) return c.graph.parameters
  return isObj(c.paramManifest) && Object.keys(c.paramManifest).length ? c.paramManifest : null
}

/**
 * Version K's document as the dock's WORKING COPY on top of `currentDef` (rules 2, 3 and 5).
 * Pure; neither argument is changed. Null when there is no version document.
 */
export function restoredDocument(versionDef, currentDef) {
  if (!isObj(versionDef)) return null
  const cur = isObj(currentDef) ? currentDef : {}
  const out = { ...versionDef }
  // the two stamps a save writes read as the current version's, like any working copy of an edit
  for (const k of ['id', 'version']) {
    if (k in cur) out[k] = cur[k]
    else delete out[k]
  }
  if (isObj(versionDef.compute)) out.compute = followCurrent(versionDef.compute, cur.compute, CARRIED_COMPUTE)
  if (isObj(versionDef.meta)) out.meta = followCurrent(versionDef.meta, cur.meta, CARRIED_META)
  if (Array.isArray(versionDef.plots)) {
    out.plots = versionDef.plots.map((p) => {
      if (!isObj(p) || typeof p.key !== 'string') return p
      const { uid: _uid, [NEW_LINE_FLAG]: _mark, ...plain } = p
      const today = plotLineOf(cur, p.key)                      // null: no such key today
      if (today !== null && today === lineIdentity(p)) {
        const kept = plotOfKey(cur, p.key)
        return kept && typeof kept.uid === 'string' ? { ...plain, uid: kept.uid } : plain
      }
      return { ...plain, [NEW_LINE_FLAG]: true }
    })
  }
  return out
}

function plotOfKey(def, key) {
  const plots = isObj(def) && Array.isArray(def.plots) ? def.plots : []
  return plots.find((p) => isObj(p) && p.key === key) || null
}

/** What happens to each line when version K comes back, for the row's own sentence. */
export function restoreLineSummary(versionDef, currentDef) {
  const kPlots = isObj(versionDef) && Array.isArray(versionDef.plots) ? versionDef.plots : []
  const curPlots = isObj(currentDef) && Array.isArray(currentDef.plots) ? currentDef.plots : []
  const keyed = (list) => list.filter((p) => isObj(p) && typeof p.key === 'string')
  let same = 0; let fresh = 0
  for (const p of keyed(kPlots)) {
    const today = plotLineOf(currentDef, p.key)
    if (today !== null && today === lineIdentity(p)) same += 1; else fresh += 1
  }
  const kKeys = new Set(keyed(kPlots).map((p) => p.key))
  const removed = keyed(curPlots).filter((p) => !kKeys.has(p.key)).length
  return { same, fresh, removed }
}

export const NOT_USABLE = Object.freeze({
  current: 'current',
  deleted: 'deleted',
  unedited: 'not-editable',
  refused: 'refused',
  parameters: 'parameters',
  same: 'same',
})

const PARAMETERS_TEXT = 'Its imported settings are not the ones this indicator has today, so it cannot be brought back from here.'
const SAME_TEXT = 'The same as what is in the draft now.'
const CURRENT_TEXT = 'The saved version this draft started from.'

/**
 * The saved versions as the dock lists them, NEWEST FIRST: one row per stored version, each
 * either usable or saying why not (rule 4). `versions` is `fetchDefinitionHistory`'s list (served
 * rows, identities attached).
 * @param {object[]} versions
 * @param {{currentDef: object|null, currentVersion: number|null, workingDef?: object|null}} ctx
 * @returns {{version, name, at, current, usable, why, text, doc, lines}[]}
 */
export function savedVersionRows(versions, { currentDef = null, currentVersion = null, workingDef = null } = {}) {
  const rows = []
  for (const v of Array.isArray(versions) ? versions : []) {
    if (!isObj(v) || !Number.isInteger(v.version)) continue
    const def = isObj(v.definition) ? v.definition : null
    const row = {
      version: v.version,
      name: (def && isObj(def.meta) && typeof def.meta.name === 'string' && def.meta.name.trim()) || 'Untitled',
      at: Number.isFinite(Number(v.created_at)) ? Number(v.created_at) : null,
      current: v.version === currentVersion,
      usable: false, why: null, text: '', doc: null, lines: null,
    }
    rows.push(row)
    const no = (why, text) => { row.why = why; row.text = text }
    if (v.deleted_at != null || !def) { no(NOT_USABLE.deleted, 'Deleted at this point.'); continue }
    const ed = conversationEditability(def)
    if (!ed.editable) { no(NOT_USABLE.unedited, ed.text || 'This version cannot be edited here.'); continue }
    if (stableJson(parameterRoster(def)) !== stableJson(parameterRoster(currentDef))) {
      no(NOT_USABLE.parameters, PARAMETERS_TEXT); continue
    }
    const doc = restoredDocument(def, currentDef)
    // rule 4: today's install door, on today's serving of this version
    let errors = []
    try { errors = validateUserDefinitions([doc]).errors || [] } catch (e) { errors = [String((e && e.message) || e)] }
    if (errors.length) { no(NOT_USABLE.refused, refusalWords(errors[0])); continue }
    // nothing to go back to when the draft already IS this version (the saved one this draft
    // started from, until the draft moves away from it)
    if (!workingDef || stableJson(strip(workingDef)) === stableJson(strip(doc))) {
      if (row.current) no(NOT_USABLE.current, CURRENT_TEXT); else no(NOT_USABLE.same, SAME_TEXT)
      continue
    }
    row.usable = true; row.doc = doc
    row.lines = restoreLineSummary(def, currentDef)
  }
  return rows.sort((a, b) => b.version - a.version)
}

/** A document without the marks that are this tab's bookkeeping, for "is it the same draft". */
function strip(def) {
  if (!isObj(def)) return def
  const { id: _id, version: _version, ...rest } = def
  if (!Array.isArray(rest.plots)) return rest
  return { ...rest, plots: rest.plots.map((p) => {
    if (!isObj(p)) return p
    const { [NEW_LINE_FLAG]: _mark, uid: _uid, ...plain } = p
    return plain
  }) }
}

/** The install door's refusal as a member reads it: its own sentence, never a blank. */
function refusalWords(err) {
  if (isObj(err)) {
    try {
      const m = memberError({ code: err.code, message: err.message })
      if (m && m.text) return m.text
    } catch { /* fall through to the door's own words */ }
    if (typeof err.message === 'string' && err.message.trim()) return err.message.trim()
  }
  // the door names the document first ("u_0123456789ab: …"); a member does not need its id
  const s = typeof err === 'string' ? err.replace(/^u_[0-9a-f]{12}:\s*/, '').trim() : ''
  return s || 'Today’s engine does not accept this version.'
}

/** "2 lines come back as new lines" and its neighbours: what the member should know before pressing. */
export function restoreNote(lines) {
  if (!lines) return ''
  const parts = []
  if (lines.fresh > 0) {
    parts.push(lines.fresh === 1
      ? '1 line comes back as a new line: alerts and references made to the old one stay off.'
      : `${lines.fresh} lines come back as new lines: alerts and references made to the old ones stay off.`)
  }
  if (lines.removed > 0) {
    parts.push(lines.removed === 1 ? '1 line added since then is removed.' : `${lines.removed} lines added since then are removed.`)
  }
  return parts.join(' ')
}

/**
 * Bring a usable row back as one step of the draft.
 * @returns {{ok, state, changed, entries, message?}} — the same shape as a settings change, so the
 *   dock applies it through the one path every other change takes.
 */
export function restoreTurn(before, row) {
  if (!before || !row || !row.usable || !row.doc) {
    return { ok: false, state: null, changed: false, entries: [], message: (row && row.text) || 'That version cannot be brought back.' }
  }
  const state = replaceWorking(before, row.doc)
  if (state === before) return { ok: false, state: null, changed: false, entries: [], message: 'That version cannot be brought back.' }
  const note = restoreNote(row.lines)
  return {
    ok: true, state, changed: true,
    entries: [{ role: 'uct', kind: 'patched', revision: state.revision, updated: true, byRestore: true,
      lines: [`Went back to saved version ${row.version}. Nothing is saved until you save.`, ...(note ? [note] : [])] }],
  }
}
