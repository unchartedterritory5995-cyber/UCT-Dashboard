// app/src/components/chart/engine/lineIdentity.js
//
// ─── ⭐⭐ LINE IDENTITY — WHICH LINE A REFERENCE WAS MADE TO (2026-11-02) ──────
//
// OWNER DECISION (2026-11-02): "Do not allow newly created lines to silently
// inherit deleted lines' references or alerts. Preserve existing saved
// definitions and compatibility."
//
// A plot's `key` is a NAME, and a name can be taken again: remove "fast", later add
// a different "fast", and everything that read `@<instance>::fast` used to read the
// new maths without anybody choosing it. The server now gives every saved line a
// stable `uid` (`api/services/user_definitions.py::decide_line_ids`) and THIS module
// is the browser's half of the same vocabulary:
//
//   * `lineIdentity(plot)` — the plot's `uid`, or `k:<key>` for a plot stored before
//     identities existed (the server's `line_identity`, byte for byte);
//   * `NEW_LINE_FLAG` — the draft marker a row ADDED during an edit carries to the
//     PUT body, so a key removed and typed again in ONE draft still becomes a new
//     line (the server cannot see a same-draft re-add; it only sees two versions);
//   * `lineMatches(recorded, def, key)` — does a reference that recorded a line still
//     point at THAT line? A reference with nothing recorded (every one written before
//     this module) behaves exactly as before.
//
// ⛔ THE PATTERN, THE PREFIX AND THE FLAG ARE THE SERVER'S. `lineIdentity.parity.test.js`
// reads `user_definitions.py` as text and fails if either side moves alone.
//
// ⭐ A LOCAL COPY OF A DOCUMENT THE SERVER HAS NOT YET ANSWERED FOR IS "PENDING".
// After a save, the chart installs its own copy at once and the store's copy arrives
// with the next list read. A line the server is about to mint a uid for has no uid in
// the local copy, so that copy keeps `newLine: true` on it (`withLocalLineIdentities`):
// a pending line matches NO recorded reference (it is new by definition) and nothing is
// recorded against it until the store's copy, carrying the real uid, replaces it.

export const PLOT_UID_PATTERN = '^p_[0-9a-f]{12}$'
export const PLOT_UID_RE = new RegExp(PLOT_UID_PATTERN)
export const LEGACY_LINE_PREFIX = 'k:'
export const NEW_LINE_FLAG = 'newLine'
/** What a reference records when it was resolved against a LOADED definition that no
 *  longer declares its key: any line later added under that key is a different line. */
export const RETIRED_LINE = 'retired'

/** Compute lanes a member authors and edits; their keys can be removed and re-added.
 *  Shipped natives and the server lane never re-issue a key, so nothing is recorded
 *  for them (a recorded `k:rsi` would only be noise in every member's settings). */
const EDITABLE_KINDS = Object.freeze(['ast', 'script', 'runtime'])

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/** The identity of one plot: its `uid`, or `k:<key>`; null for a non-plot. */
export function lineIdentity(plot) {
  if (!isObj(plot) || typeof plot.key !== 'string' || !plot.key) return null
  const uid = plot.uid
  if (typeof uid === 'string' && PLOT_UID_RE.test(uid)) return uid
  return LEGACY_LINE_PREFIX + plot.key
}

/** The plot (or native `events[]` entry) a definition declares under `key`, or null. */
export function plotOf(definition, key) {
  if (!isObj(definition) || typeof key !== 'string') return null
  for (const list of [definition.plots, definition.events]) {
    if (!Array.isArray(list)) continue
    const hit = list.find((p) => isObj(p) && p.key === key)
    if (hit) return hit
  }
  return null
}

/** The identity of `definition`'s plot under `key`, or null when it declares none. */
export function plotLineOf(definition, key) {
  return lineIdentity(plotOf(definition, key))
}

/** Is this a line whose identity the server has not decided yet (`NEW_LINE_FLAG`)? */
export function isPendingLine(plot) {
  return isObj(plot) && plot[NEW_LINE_FLAG] === true
}

/** Can lines of this definition be removed and re-added (a member-authored lane)? */
export function isEditableDefinition(definition) {
  return isObj(definition) && isObj(definition.compute)
    && EDITABLE_KINDS.includes(definition.compute.kind)
}

/**
 * The identity a reference made NOW to `definition`'s `key` should record, or null
 * to record nothing (the reference then behaves as every reference did before line
 * identity: bound by key).
 *
 *   * a native / server definition → null (its keys are never re-issued);
 *   * a pending line → null (its identity is decided by the store; recording a
 *     guess would break the reference the moment the store's copy arrives);
 *   * a declared line → its identity;
 *   * no such key → `RETIRED_LINE` when `retiredWhenMissing` (the definition is
 *     loaded and does not declare it), else null.
 */
export function recordableLine(definition, key, { retiredWhenMissing = false } = {}) {
  if (!isEditableDefinition(definition) || typeof key !== 'string' || !key) return null
  const plot = plotOf(definition, key)
  if (!plot) return retiredWhenMissing ? RETIRED_LINE : null
  if (isPendingLine(plot)) return null
  return lineIdentity(plot)
}

/**
 * Does a reference that recorded `recorded` still point at that line of
 * `definition`'s `key`?
 *
 * ⭐ NOTHING RECORDED → TRUE: a reference written before line identity keeps
 * today's key binding. ⭐ NO DEFINITION → TRUE: an unloaded target is decided by
 * whatever already handles an unloaded target, never by a guess here.
 */
export function lineMatches(recorded, definition, key) {
  if (typeof recorded !== 'string' || !recorded) return true
  if (!definition) return true
  const plot = plotOf(definition, key)
  if (!plot) return false
  if (isPendingLine(plot)) return false
  return lineIdentity(plot) === recorded
}

/**
 * Is this Builder / authoring ROW a new line for the save it is about to go into?
 * A row added during the edit carries `newLine: true`; a Builder row restored from a
 * saved plot carries `savedKey`, and a row whose key the member changed is a new line
 * too (it can only ever DETACH a line — never attach one — so marking is always safe).
 */
export function rowIsNewLine(row) {
  if (!isObj(row)) return false
  if (row[NEW_LINE_FLAG] === true) return true
  return typeof row.savedKey === 'string' && row.savedKey !== row.key
}

/** `definition` with every `newLine` marker removed (a NEW object only when one was
 *  present). For a document that is about to become an edit's starting point: a
 *  marker there would make the NEXT save mint a new identity for a line already saved. */
export function withoutNewLineMarkers(definition) {
  if (!isObj(definition) || !Array.isArray(definition.plots)) return definition
  if (!definition.plots.some((p) => isObj(p) && NEW_LINE_FLAG in p)) return definition
  return {
    ...definition,
    plots: definition.plots.map((p) => {
      if (!isObj(p) || !(NEW_LINE_FLAG in p)) return p
      const { [NEW_LINE_FLAG]: _gone, ...rest } = p
      return rest
    }),
  }
}

/**
 * The copy of a just-saved document this TAB installs, with each line's identity
 * as the store decided it — or marked pending where only the store knows it.
 *
 * Mirrors `decide_line_ids`: a line the store's answer names keeps that identity; a
 * line the prior copy also declared (and that is not new) keeps the prior's uid; any
 * other line is pending (`newLine: true`) until the store's copy is installed.
 *
 * @param {object} doc         the document as sent (may carry `newLine` / stale `uid`)
 * @param {object|null} prior  the copy this tab held before the save (null on a create)
 * @param {object|null} served `{key: identity}` from the save's answer, when it has one
 */
export function withLocalLineIdentities(doc, prior, served = null) {
  if (!isObj(doc) || !Array.isArray(doc.plots)) return doc
  const priorPlots = isObj(prior) && Array.isArray(prior.plots) ? prior.plots : []
  const priorByKey = new Map(priorPlots.filter((p) => isObj(p) && typeof p.key === 'string').map((p) => [p.key, p]))
  const answer = isObj(served) ? served : null
  return {
    ...doc,
    plots: doc.plots.map((p) => {
      if (!isObj(p) || typeof p.key !== 'string') return p
      const { uid: _uid, [NEW_LINE_FLAG]: wasNew, ...q } = p
      const said = answer ? answer[p.key] : undefined
      if (typeof said === 'string' && PLOT_UID_RE.test(said)) return { ...q, uid: said }
      if (typeof said === 'string' && said === LEGACY_LINE_PREFIX + p.key) return q
      const old = priorByKey.get(p.key)
      if (!old || wasNew === true || isPendingLine(old)) return { ...q, [NEW_LINE_FLAG]: true }
      const oldUid = old.uid
      return typeof oldUid === 'string' && PLOT_UID_RE.test(oldUid) ? { ...q, uid: oldUid } : q
    }),
  }
}

/** `{key: identity}` from a save's answer, when the store sent one (`plot_identities`). */
export function servedLineIdentities(row) {
  if (!isObj(row)) return null
  const v = row.plot_identities !== undefined ? row.plot_identities : row.plotIdentities
  return isObj(v) ? v : null
}

/**
 * `definition` with each plot's `uid` set from a served `plot_identities` map (the
 * store serves a definition byte for byte as stored and puts identities BESIDE it).
 * Only uid values are attached: a `k:<key>` identity needs no field, `lineIdentity`
 * derives it. Returns `definition` BY IDENTITY when there is nothing to attach.
 */
export function withServedIdentities(definition, identities) {
  if (!isObj(definition) || !Array.isArray(definition.plots) || !isObj(identities)) return definition
  let changed = false
  const plots = definition.plots.map((p) => {
    if (!isObj(p) || typeof p.key !== 'string') return p
    const id = identities[p.key]
    if (typeof id !== 'string' || !PLOT_UID_RE.test(id) || p.uid === id) return p
    changed = true
    return { ...p, uid: id }
  })
  return changed ? { ...definition, plots } : definition
}

/** A served definition ROW (`{definition, plot_identities, …}`) with the identities
 *  attached to the copy the browser holds. Identity for anything else. */
export function withServedRowIdentities(row) {
  if (!isObj(row) || !isObj(row.definition)) return row
  const definition = withServedIdentities(row.definition, servedLineIdentities(row))
  return definition === row.definition ? row : { ...row, definition }
}
