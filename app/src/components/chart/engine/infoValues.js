// app/src/components/chart/engine/infoValues.js
//
// ─── ⭐⭐ P1 — AN INFO VALUE IS A REFERENCE, NEVER A FORMULA ──────────────────
//
// The member asks "show me the latest value of THIS output in the header". The
// answer is a POINTER to an output that is already installed and already
// computed on the chart — `{instanceId, plotKey, format}` — and nothing else.
//
//   · ⛔ NO AST, NO SOURCE, NO BINDINGS, NO LABEL. The old branch stored formula
//     text in `header.infoFormulas` (a fourth formula home); that key is NOT
//     revived. Every entry is rebuilt from an allow-list of three fields (plus the
//     `severed` gravestone flag), so anything else a writer smuggles in — an
//     `ast`, a `source`, a `type`, a cached value — is DESTROYED on every read.
//   · ⛔ NO TYPE. The type of the referenced output is `outputType.outputTypeOf`'s
//     and is re-derived on every read. A VALUE on a SERIES stays a SERIES.
//   · ⛔ NO NAME. A reference is resolved by its stable `instanceId` + `plotKey`
//     ONLY. A label is never stored, so nothing can ever "reconnect" an info value
//     to another instance that happens to share a display name.
//
// ─── STORAGE: `cs.header.infoValues` — ONE additive chart-settings key ───────
//
// `mergeChartSettings` spreads `parsed.header`, so a `header.*` key survives the
// hard allow-list. It is DELIBERATELY NOT DECLARED in `CHART_DEFAULTS.header`:
// absent means "none", and declaring an empty default would spread `[]` into every
// merged blob — every chart's next save would grow a key nobody chose, and both
// pinned merged-blob digests (`alertSets.test.js`, `perInstanceDoor.test.js`)
// would move. The merge SANITISES the key when (and only when) it is present
// (`sanitizeInfoValues`), so a legacy blob merges byte-for-byte as before.
//
// ─── DELETE → A VISIBLE GRAVESTONE, NEVER A SILENT RECONNECT ─────────────────
//
// Instance ids are DETERMINISTIC (`legacy:rsi`, `inst:rsi:1`) and the toggle door
// REVIVES a tombstoned `legacy:<id>` under the SAME id. A reference that merely
// pointed at the id would therefore silently reconnect to a brand-new RSI after
// delete + re-add. So deleting an instance SEVERS every info value pointing at it
// (`severInfoValuesTo`, called by `instanceControls.removeInstance` /
// `setIndicatorEnabled(…, false)` and by `sourceRef.severReferencesTo`): the
// entry keeps its old ids (a member can see WHAT went away) and gains
// `severed: true`, and a severed entry never resolves again — it stays visible as
// broken until it is explicitly removed or repaired (`removeInfoValue` /
// `repairInfoValue`). Nothing is deleted or retargeted behind the member's back.
//
// PURE. No React, no registry import: this module is imported by
// `instanceControls`, `sourceRef` and `chartDefaults`, so it imports only the
// dependency-free `instanceShape` tombstone predicate. The RESOLVER (which needs
// the gate and the readout) lives in `infoValueResolve.js`.

import { isInstanceTombstone } from '../instanceShape'

/** The header field, in one place. */
export const INFO_VALUES_KEY = 'infoValues'

/** Presentation only — never part of any compute memo. `auto` prints the value
 *  the way the legend does (the plot's declared decimals / compact); `yesno`
 *  prints a CONDITION/EVENTS 1/0 as Yes/No (on a number it falls back to auto —
 *  a format is not a type change). */
export const INFO_VALUE_FORMATS = Object.freeze(['auto', 'yesno'])
export const DEFAULT_INFO_VALUE_FORMAT = 'auto'

/** A header strip, not a dashboard. */
export const MAX_INFO_VALUES = 12

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const isStr = (v) => typeof v === 'string' && v.length > 0

/**
 * ONE stored entry, rebuilt from the allow-list, or `null` when it is not a
 * reference at all. ⛔ The rebuild is the mechanism that keeps an AST out: the
 * output object is constructed field by field, never spread from the input.
 */
export function sanitizeInfoValue(entry) {
  if (!isObj(entry)) return null
  let instanceId, plotKey, format, severed
  try {
    instanceId = entry.instanceId
    plotKey = entry.plotKey
    format = entry.format
    severed = entry.severed
  } catch { return null }   // booby-trapped getter: not a reference
  if (!isStr(instanceId) || !isStr(plotKey)) return null
  const out = {
    instanceId,
    plotKey,
    format: INFO_VALUE_FORMATS.includes(format) ? format : DEFAULT_INFO_VALUE_FORMAT,
  }
  if (severed === true) out.severed = true
  return out
}

const sameRef = (a, b) => !!a && !!b && a.instanceId === b.instanceId && a.plotKey === b.plotKey

/**
 * The sanitised list for a stored value of `header.infoValues`. A non-array is
 * "none". Duplicates (same instanceId + plotKey + severed state) collapse to the
 * first. Used by `mergeChartSettings` — only when the key is PRESENT.
 */
export function sanitizeInfoValues(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const e of value) {
    const s = sanitizeInfoValue(e)
    if (!s) continue
    if (out.some((o) => sameRef(o, s) && !!o.severed === !!s.severed)) continue
    out.push(s)
    if (out.length >= MAX_INFO_VALUES) break
  }
  return out
}

/** The info values a settings object carries (sanitised; `[]` when none). */
export function infoValuesOf(cs) {
  const h = cs && isObj(cs.header) ? cs.header : null
  return h ? sanitizeInfoValues(h[INFO_VALUES_KEY]) : []
}

/** `cs` with `header.infoValues` replaced by `list`; an empty list REMOVES the
 *  key, so adding then removing returns the blob to its legacy shape. */
function withInfoValues(cs, list) {
  const header = { ...(isObj(cs.header) ? cs.header : {}) }
  if (list.length) header[INFO_VALUES_KEY] = list
  else delete header[INFO_VALUES_KEY]
  return { ...cs, header }
}

/** The LIVE (non-tombstone) instance under `instanceId`, or null. Local on
 *  purpose — `instanceControls.findInstance` imports this module. */
export function liveInstanceOf(cs, instanceId) {
  const list = cs && Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : []
  for (const i of list) {
    if (!i || typeof i !== 'object' || i.instanceId !== instanceId) continue
    let dead = false
    try { dead = isInstanceTombstone(i) } catch { dead = true }
    if (!dead) return i
  }
  return null
}

/**
 * Why `ref` cannot be ADDED to `cs`, or `null` when it can.
 *
 * ⛔ AN INFO VALUE REFERENCES AN EXISTING INSTALLED OUTPUT. A dead / tombstoned /
 * unknown instance is refused, and — when `defOf` is given — so is a key the
 * definition does not declare as an output. Whether the output can be EVALUATED
 * on this chart is NOT decided here: that is the gate's answer at read time
 * (`infoValueResolve.resolveInfoValue`), because it depends on the chart (a sym
 * read, a timeframe) and can change without the reference changing.
 *
 * @param {object} cs
 * @param {{instanceId:string, plotKey:string, format?:string}} ref
 * @param {Function} [defOf] `(defId) => definition`
 * @param {Function} [outputExists] `(def, plotKey) => boolean` — the declared-output
 *        test (the resolver passes `outputTypeOf`-backed one; tests may omit).
 */
export function infoValueAddRefusal(cs, ref, defOf, outputExists) {
  if (!isObj(cs)) return 'there are no chart settings to add it to'
  const s = sanitizeInfoValue(ref)
  if (!s || s.severed) return 'that is not a reference to an installed output'
  const inst = liveInstanceOf(cs, s.instanceId)
  if (!inst) return 'that indicator is not on this chart'
  if (typeof defOf === 'function') {
    const def = defOf(inst.defId)
    if (!def) return 'that indicator’s definition is not installed'
    const declared = typeof outputExists === 'function'
      ? outputExists(def, s.plotKey)
      : [...(def.plots || []), ...(def.events || [])].some((p) => p && p.key === s.plotKey)
    if (!declared) return 'that indicator declares no such output'
  }
  const list = infoValuesOf(cs)
  if (list.some((o) => !o.severed && sameRef(o, s))) return 'that value is already in the header'
  if (list.length >= MAX_INFO_VALUES) return `the header holds at most ${MAX_INFO_VALUES} values`
  return null
}

/**
 * Add a reference. Returns `cs` BY IDENTITY when refused (the chart's writers
 * skip persisting on identity), else a new settings object.
 *
 * ⛔ NOTHING BUT THE REFERENCE IS WRITTEN: not the definition, not the instance,
 * not a type, not intent. VALUE intent does not touch the output it reads.
 */
export function addInfoValue(cs, ref, defOf, outputExists) {
  if (infoValueAddRefusal(cs, ref, defOf, outputExists)) return cs
  const s = sanitizeInfoValue(ref)
  return withInfoValues(cs, [...infoValuesOf(cs), s])
}

/**
 * Remove a reference — live or severed — by its stored ids. This is the explicit
 * "remove" a broken entry waits for. Identity when nothing matched.
 */
export function removeInfoValue(cs, ref) {
  if (!isObj(cs) || !isObj(ref)) return cs
  const list = infoValuesOf(cs)
  const next = list.filter((o) => !(sameRef(o, ref)
    && (ref.severed === undefined || !!o.severed === !!ref.severed)))
  if (next.length === list.length) return cs
  return withInfoValues(cs, next)
}

/** Is this output in the header (as a live, unsevered reference)? */
export function hasInfoValue(cs, instanceId, plotKey) {
  return infoValuesOf(cs).some((o) => !o.severed && o.instanceId === instanceId && o.plotKey === plotKey)
}

/**
 * The explicit repair: replace `oldRef` (typically a severed one) by `newRef`,
 * in place. ⛔ The member names the new target; nothing here guesses one.
 * Identity when `oldRef` is not stored or `newRef` cannot be added.
 */
export function repairInfoValue(cs, oldRef, newRef, defOf, outputExists) {
  const list = infoValuesOf(cs)
  const at = list.findIndex((o) => sameRef(o, oldRef)
    && (oldRef.severed === undefined || !!o.severed === !!oldRef.severed))
  if (at < 0) return cs
  const without = withInfoValues(cs, list.filter((_, i) => i !== at))
  if (infoValueAddRefusal(without, newRef, defOf, outputExists)) return cs
  const next = list.slice()
  next[at] = sanitizeInfoValue(newRef)
  return withInfoValues(cs, next)
}

/**
 * ⭐ SEVER every info value that points at one of `instanceIds` — the delete half.
 * Returns `cs` BY IDENTITY when no entry pointed at them, so a delete on a chart
 * with no info values writes exactly what it wrote before this existed.
 *
 * @param {object} cs
 * @param {Iterable<string>|string} instanceIds
 */
export function severInfoValuesTo(cs, instanceIds) {
  if (!isObj(cs) || !isObj(cs.header) || !Array.isArray(cs.header[INFO_VALUES_KEY])) return cs
  const ids = new Set(typeof instanceIds === 'string' ? [instanceIds] : [...(instanceIds || [])])
  if (!ids.size) return cs
  const list = infoValuesOf(cs)
  let touched = false
  const next = list.map((o) => {
    if (o.severed || !ids.has(o.instanceId)) return o
    touched = true
    return { ...o, severed: true }
  })
  return touched ? withInfoValues(cs, sanitizeInfoValues(next)) : cs
}
