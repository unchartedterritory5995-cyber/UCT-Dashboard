// app/src/components/chart/builder/memberPane/savedScriptUpgrade.js
//
// ─── ⭐⭐ SAVED PINE SCRIPTS PICK UP ENGINE FIXES AUTOMATICALLY ───────────────
//
// A member's script is stored as the document the translator produced the day
// they saved it. Every accuracy fix after that day (C45/C48's `blockRuns`
// withholding, and whatever comes next) reached only NEW saves: the saved
// document kept drawing the old values, silently, on the chart and in every
// server lane that evaluates it (alerts, scans, backtests).
//
// Since this module, the script door stores the SOURCE beside the document
// (`pine_source`, a server column) and stamps the document with the engine that
// translated it (`scriptEngineVersion.js`). On load:
//
//   stamp current                → NOTHING happens. No translation, no request,
//                                   no extra byte (the list only carries a
//                                   script for a stale row). First paint is
//                                   exactly what it was.
//   stale + source               → re-translated ONCE here, through the same door
//                                   that built it (`memberPaneDefinition`), drawn
//                                   from the new translation, and written back
//                                   through the ordinary revision-guarded save
//                                   (PUT with `base_version`: a newer server
//                                   revision is never overwritten; nothing is
//                                   ever deleted). The next load is current.
//   stale + source + REFUSED     → the new translation's refusal WINS, by name:
//                                   the old document is not drawn (that is the
//                                   point — the engine now knows it was wrong).
//                                   Nothing is written; the stored row is intact.
//   stale, no source (legacy)    → drawn as stored, and its legend menu carries
//                                   ONE quiet row: "Updated accuracy available —
//                                   open in Builder and save to apply".
//
// ⛔ "INCONCLUSIVE" IS NOT "REFUSED". A refusal wins only when the browser can
// state it for certain. Three answers depend on THIS TAB rather than on the
// engine, and for them the stored document is kept, unchanged:
//   • the per-bar runtime lane is built in (`runtimePaneBuilt`) — whether a
//     script the host lane refuses is drawn there depends on a per-member latch
//     and a server allowlist that may not have arrived yet;
//   • the script `import`s a library — the library may not be in this tab yet;
//   • the translator THREW — that is our defect, not a stricter engine.
// And a re-translation that lands on the runtime lane is never adopted here
// (the stored document's lane decides; runtime documents re-run their own
// source on every draw already).
//
// ⛔ WHAT THE MEMBER OWNS ON THE DOCUMENT IS CARRIED, everything else is the
// new translation's: the id, the presentation version and `compute.rev` (the
// store's numbers), `meta.name`, `meta.semantics` (the store's decision),
// and the provenance of a copy
// (`origin`, `meta.forkedFrom`). The member's per-chart input values live on the
// INSTANCE, never on the document, and are untouched.
//
// ⛔⛔ THE TRANSLATOR IS LOADED ON DEMAND, NEVER ON THE CHART'S PATH. This module
// is imported by `useUserDefinitions` (every chart); `memberPaneDefinition` pulls
// the whole Pine translator and the Builder with it, which `ChartToolbar` lazy-
// loads on purpose. So the translator arrives by dynamic `import()` the first time
// a STALE row is seen — a member whose documents are all current never downloads
// it — and the stale row is HELD (not drawn) until its new translation lands:
// the old values are known to be possibly wrong, so they are not shown meanwhile.
import { PINE_RECURRENCE_ORIGIN } from '../../engine/nativeRegistry'
import { runtimePaneBuilt } from '../../engine/runtimePaneGate'
import {
  SCRIPT_ENGINE_VERSION, isStaleStamp, withEngineStamp,
} from '../../engine/scriptEngineVersion'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Is this a document a Pine SCRIPT door wrote (the member pane, or a hand edit
 *  of one, which carries its stamps)? Only these can be translated again. */
export function isScriptDocument(def) {
  return !!(isObj(def) && isObj(def.compute) && def.compute.kind === 'ast'
    && isObj(def.meta) && def.meta.recurrenceOrigin === PINE_RECURRENCE_ORIGIN)
}

/** ⭐ The kill switch. ON unless the build says `VITE_SAVED_SCRIPT_UPGRADE=0`
 *  (the repo's default-ON convention, read inside a function so a test can flip
 *  it). Off: every saved document is drawn exactly as stored, as before. */
export function savedScriptUpgradeEnabled(env) {
  try {
    const source = env === undefined ? import.meta.env : env
    return ((source && source.VITE_SAVED_SCRIPT_UPGRADE) ?? '1') !== '0'
  } catch {
    return true
  }
}

/** What load-time work a store row needs.
 *  @returns {'current'|'retranslate'|'legacy'|'none'} */
export function upgradeKindOf(row, current = SCRIPT_ENGINE_VERSION) {
  const def = row && row.definition
  if (!isScriptDocument(def)) return 'none'
  if (!isStaleStamp(def, current)) return 'current'
  if (typeof row.pine_source === 'string' && row.pine_source.trim()) return 'retranslate'
  // ⛔ A stale row whose script IS stored but was not sent (the list carries it
  // only to a browser that asked with a newer engine) is not legacy — it is a
  // browser older than the document. Nothing to offer it.
  if (row.has_pine_source === true) return 'none'
  return 'legacy'
}

// A script that names a library cannot be judged until that library arrives.
const IMPORTS_LIBRARY = /^\s*import\s+[\w.-]+\/[\w.-]+\/\d+/m

/** The fields the member (or the store) owns, carried from the stored document. */
const CARRIED_META = Object.freeze(['name', 'semantics', 'forkedFrom'])
function carryOwned(next, stored, row) {
  const sm = isObj(stored.meta) ? stored.meta : {}
  const meta = { ...(isObj(next.meta) ? next.meta : {}) }
  for (const k of CARRIED_META) if (sm[k] !== undefined) meta[k] = sm[k]
  const rev = isObj(stored.compute) && Number.isInteger(stored.compute.rev) ? stored.compute.rev
    : (Number.isInteger(row.rev) ? row.rev : undefined)
  return withEngineStamp({
    ...next,
    id: row.def_id,
    version: Number.isInteger(stored.version) ? stored.version
      : (Number.isInteger(row.version) ? row.version : 1),
    ...(stored.origin !== undefined ? { origin: stored.origin } : {}),
    compute: { ...next.compute, ...(rev !== undefined ? { rev } : {}) },
    meta,
  })
}

/**
 * Translate a stale row's stored script again, as the script door would today.
 *
 * @param {object} row a store row carrying `definition`, `def_id`, `version` and `pine_source`
 * @returns {{status: 'upgraded', definition: object}
 *         | {status: 'refused', reason: string, guard: string|null}
 *         | {status: 'inconclusive', reason: string}}
 */
export function retranslateRow(row, memberPaneDefinition) {
  const stored = row.definition
  const source = row.pine_source
  let built
  try {
    built = memberPaneDefinition({ source, id: row.def_id })
  } catch (err) {
    return { status: 'inconclusive', reason: `the translator threw: ${String((err && err.message) || err)}` }
  }
  if (!built || !built.ok) {
    const reason = (built && built.reason) || 'the translator returned nothing'
    if (/^the translator threw/.test(reason)) return { status: 'inconclusive', reason }
    if (runtimePaneBuilt()) return { status: 'inconclusive', reason: `runtime lane may draw it: ${reason}` }
    if (IMPORTS_LIBRARY.test(source)) return { status: 'inconclusive', reason: `imports a library: ${reason}` }
    return { status: 'refused', reason, guard: (built && built.guard) || null }
  }
  const next = built.definition
  if (!isObj(next) || !isObj(next.compute) || next.compute.kind !== 'ast') {
    return { status: 'inconclusive', reason: 'the script now translates to a different lane' }
  }
  return { status: 'upgraded', definition: carryOwned(next, stored, row) }
}

// ── memo + write-back bookkeeping (per tab) ──────────────────────────────────
//
// ⛔ KEYED BY `def_id@version#engine`. A stored version is immutable (the store is
// append-only and a version's script never changes), so a key names one answer
// for the life of the tab: a re-render, a second chart, a StrictMode double
// invoke all reuse it, and the translation runs once.
const _memo = new Map()
const _writeBacks = new Map()   // key → 'pending' | 'saved' | 'conflict' | 'failed'
const _legacy = new Set()        // def ids offered the "open and save" row

const keyOf = (row, engine = SCRIPT_ENGINE_VERSION) => `${row.def_id}@${row.version}#${engine}`

/** The translator module, loaded once, on demand. */
let _translator = null
const _listeners = new Set()
const _pending = new Set()       // keys queued for translation
let _scheduled = false

/** Tests and the measurement harness may hand the translator in directly. */
export function __setTranslatorForTests(mod) {
  if (mod && typeof mod.then === 'function') { mod.catch(() => {}); _translator = mod; return }
  _translator = mod ? Promise.resolve(mod) : null
}

function loadTranslator() {
  if (!_translator) _translator = import('./memberPaneDefinition')
  return _translator
}

/** Subscribe to "an upgrade finished" (the hook re-installs). Returns unsubscribe. */
export function onUpgradeSettled(fn) {
  _listeners.add(fn)
  return () => { _listeners.delete(fn) }
}

/** ⛔ A held row is hidden until its translation lands, so the wait is BOUNDED: a
 *  translator chunk that never arrives (a stalled network) must not hide a
 *  member's indicator forever. Past this, the row draws as stored (inconclusive). */
export const TRANSLATOR_LOAD_TIMEOUT_MS = 10000

function loadWithin(ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`not loaded within ${ms} ms`)), ms)
  })
  return Promise.race([loadTranslator(), timeout]).finally(() => clearTimeout(timer))
}

function flush(rowsByKey) {
  _scheduled = false
  loadWithin(TRANSLATOR_LOAD_TIMEOUT_MS).then((mod) => {
    for (const [k, row] of rowsByKey) {
      if (_memo.has(k)) continue
      _memo.set(k, retranslateRow(row, mod.memberPaneDefinition))
      _pending.delete(k)
    }
  }, (err) => {
    // ⛔ The translator could not even be loaded (a chunk 404 after a deploy, a
    // network blip, the timeout): inconclusive, so every held row draws as stored.
    // The next stored version (or the next tab) tries the load again.
    _translator = null
    for (const [k] of rowsByKey) {
      _memo.set(k, { status: 'inconclusive', reason: `translator unavailable: ${String((err && err.message) || err)}` })
      _pending.delete(k)
    }
  }).then(() => { for (const fn of [..._listeners]) { try { fn() } catch { /* a listener's own problem */ } } })
}

const _queue = new Map()
/** Queue a stale row for translation; resolved answers arrive via `onUpgradeSettled`. */
function queueUpgrade(row) {
  const k = keyOf(row)
  if (_memo.has(k) || _pending.has(k)) return
  _pending.add(k)
  _queue.set(k, row)
  if (_scheduled) return
  _scheduled = true
  // A microtask, not render: the install runs during render and must stay pure.
  Promise.resolve().then(() => { const batch = new Map(_queue); _queue.clear(); flush(batch) })
}

/** `retranslateRow`'s memoised answer for this stored version, or null while pending. */
export function upgradedRow(row) {
  const k = keyOf(row)
  if (_memo.has(k)) return _memo.get(k)
  queueUpgrade(row)
  return null
}

/**
 * The document to INSTALL for one store row, and what to do about it.
 * @returns {{definition: object|null, refusal: string|null, writeBack: object|null, pending: boolean}}
 *   `definition: null` + `refusal` = the new translation refused it (do not draw);
 *   `definition: null` + `pending` = its new translation has not landed yet (hold it).
 */
export function resolveRow(row) {
  const stored = row && row.definition
  const kind = savedScriptUpgradeEnabled() ? upgradeKindOf(row) : 'none'
  if (kind === 'legacy') _legacy.add(row.def_id); else if (row && row.def_id) _legacy.delete(row.def_id)
  if (kind !== 'retranslate') return { definition: stored, refusal: null, writeBack: null, pending: false }
  const r = upgradedRow(row)
  if (!r) return { definition: null, refusal: null, writeBack: null, pending: true }
  if (r.status === 'upgraded') {
    return { definition: r.definition, refusal: null, writeBack: { row, definition: r.definition }, pending: false }
  }
  if (r.status === 'refused') {
    const name = (isObj(stored.meta) && stored.meta.name) || row.def_id
    return { definition: null, refusal: `${name}: ${r.reason}`, writeBack: null, pending: false }
  }
  return { definition: stored, refusal: null, writeBack: null, pending: false }
}

/** Does this saved definition offer the "Updated accuracy available" row? */
export function needsScriptForUpgrade(defId) {
  return typeof defId === 'string' && _legacy.has(defId)
}

/** The plain-words row the legend menu shows for a legacy script document. */
export const UPGRADE_NOTICE_LABEL = 'Updated accuracy available — open in Builder and save to apply'

/** What the Builder says when that row opens it: the one thing to do. */
export const SCRIPT_UPGRADE_PASTE_NOTE = 'This indicator was saved before its script was kept. '
  + 'Paste its Pine script below and choose "Save changes": it is translated with '
  + 'today’s engine, and from then on future accuracy fixes apply to it automatically.'

/**
 * Write one upgraded document back, ONCE per stored version per tab.
 *
 * ⛔ THROUGH THE ORDINARY SAVE (`saveUserDefinition`, a PUT with `baseVersion`):
 * the store refuses a stale write with 409 and writes nothing, so a member who
 * saved a newer revision in another tab (or another device) is never clobbered;
 * the next list read brings their revision, which is judged on its own stamp.
 * ⛔ A preview-repaints acknowledgement is sent only when the STORED document
 * was already preview-repaints (the member acknowledged that badge when they
 * saved); a translation that newly repaints is NOT acknowledged on their behalf —
 * the store refuses that write, and the chart still draws the new translation.
 *
 * @param {{row: object, definition: object}} plan
 * @param {Function} save `saveUserDefinition` (injected to break an import cycle)
 */
export async function writeBackOnce(plan, save) {
  const { row, definition } = plan
  const k = keyOf(row)
  if (_writeBacks.has(k)) return _writeBacks.get(k)
  _writeBacks.set(k, 'pending')
  const storedMode = isObj(row.definition.meta) ? row.definition.meta.repaint : null
  const nextMode = isObj(definition.meta) ? definition.meta.repaint : null
  const options = {
    baseVersion: Number(row.version),
    pineSource: row.pine_source,
    ...(storedMode === 'preview-repaints' && nextMode === 'preview-repaints' ? { previewAcked: true } : {}),
  }
  let res
  try { res = await save(definition, row.def_id, null, options) } catch { res = { ok: false } }
  const status = res && res.ok ? 'saved' : (res && res.conflict ? 'conflict' : 'failed')
  _writeBacks.set(k, status)
  return status
}

/** Diagnostics: the write-back state of one stored version (tests, support). */
export function writeBackStatus(row) { return _writeBacks.get(keyOf(row)) || null }

/** Tests only. */
export function __resetSavedScriptUpgrade() {
  _memo.clear(); _writeBacks.clear(); _legacy.clear(); _pending.clear(); _queue.clear()
  _scheduled = false; _translator = null; _listeners.clear()
}
