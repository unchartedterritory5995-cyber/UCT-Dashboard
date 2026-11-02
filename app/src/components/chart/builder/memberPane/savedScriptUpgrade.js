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

/** ⭐ What an engine at least as new as `current` already RECORDED about this exact
 *  stored version (`definition_engine_status`, served as `row.engine_status`), or
 *  null. Remembered server-side, so it holds across tabs and devices. */
export function recordedEngineStatus(row, current = SCRIPT_ENGINE_VERSION) {
  const st = row && row.engine_status
  if (!isObj(st) || !Number.isInteger(st.engine) || st.engine < current) return null
  return (st.status === 'refused' || st.status === 'write-failed') ? st : null
}

/** What load-time work a store row needs.
 *  @returns {'current'|'retranslate'|'refused'|'retry'|'legacy'|'none'}
 *   `refused` — today's engine already refused it (recorded): not drawn, no work;
 *   `retry`   — its upgrade could not be written back (recorded): drawn as stored,
 *               the Builder row offered, no translation, no PUT. */
export function upgradeKindOf(row, current = SCRIPT_ENGINE_VERSION) {
  const def = row && row.definition
  const recorded = isObj(def) ? recordedEngineStatus(row, current) : null
  // ⛔⛔ A LIVE REFUSAL HOLDS ANY DOCUMENT, whatever its shape or stamp — the server's
  // `engine_withheld_reason` never reads either to hold, and the two must agree (no
  // "chart draws it but alerts withhold it" split). A refusal carried onto a studio
  // edit (no longer script-shaped) or a share install is held here as there. It
  // binds only while its engine is today's (`recordedEngineStatus`): past it, a
  // version holding its script re-translates below, and one without expires.
  if (recorded && recorded.status === 'refused') return 'refused'
  if (!isScriptDocument(def)) return 'none'
  if (!isStaleStamp(def, current)) return 'current'
  if (recorded) return 'retry'
  if (typeof row.pine_source === 'string' && row.pine_source.trim()) return 'retranslate'
  // ⛔ A stale row whose script IS stored but was not sent (the list carries it
  // only to a browser that asked with a newer engine) is not legacy — it is a
  // browser older than the document. Nothing to offer it.
  if (row.has_pine_source === true) return 'none'
  // ⛔ A COPY INSTALLED FROM SOMEBODY ELSE'S SHARE (`origin`, written by the store's
  // `install_share`) never carries the author's script, and its holder has none to
  // paste — so it is NOT offered the "open in Builder and save" row.
  if (isObj(def.origin)) return 'none'
  // ⛔ L2 — A HAND-EDITED script document (the Formula tab, the studio, an Undo:
  // any save that sent no script — `saveUserDefinition` marks it `scriptEdited`)
  // is the member's own maths now; re-pasting the script would undo their edit, so
  // it is not offered the row either.
  if (def.meta.scriptEdited === true) return 'none'
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
const _retryLocal = new Set()    // keys whose write-back the store refused (this tab)
const _recorded = new Set()      // `key:status` already sent to the store

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

/** ⛔ L4 — A held row is hidden until its translation lands, so the wait is BOUNDED
 *  IN TOTAL — the chunk download AND the translation. Past this the row is RELEASED:
 *  drawn as stored, while the upgrade keeps going in the background and swaps in
 *  (or its refusal wins) the moment it lands. */
export const TRANSLATOR_LOAD_TIMEOUT_MS = 10000
const _released = new Set()      // keys drawn as stored while their upgrade continues

function releaseLater(k) {
  setTimeout(() => {
    if (_memo.has(k)) return
    _released.add(k)
    notify()
  }, TRANSLATOR_LOAD_TIMEOUT_MS)
}

const notify = () => { for (const fn of [..._listeners]) { try { fn() } catch { /* a listener's own problem */ } } }

/** ⭐ ONE ROW PER IDLE SLOT, AFTER PAINT. Measured on the 266-script corpus: a
 *  translation is p50 ≈ 35 ms but p95 ≈ 0.4–0.5 s and up to ≈ 2.8 s — too long to
 *  run inside a render or to chain several into one task. So each held row gets
 *  its own idle callback (a timer where `requestIdleCallback` is absent), the
 *  chart's first paint and every current indicator go first, and each row is
 *  drawn the moment its own translation lands. */
function idle(fn) {
  const ric = typeof globalThis.requestIdleCallback === 'function' ? globalThis.requestIdleCallback : null
  if (ric) ric(fn, { timeout: 1000 }); else setTimeout(fn, 0)
}

function translateEach(entries, mod) {
  if (!entries.length) return
  const [[k, row], ...rest] = entries
  idle(() => {
    if (!_memo.has(k)) {
      _memo.set(k, retranslateRow(row, mod.memberPaneDefinition))
      _pending.delete(k)
      notify()
    }
    translateEach(rest, mod)
  })
}

function flush(rowsByKey) {
  _scheduled = false
  loadTranslator().then((mod) => {
    translateEach([...rowsByKey], mod)
  }, (err) => {
    // ⛔ The translator could not even be loaded (a chunk 404 after a deploy, a
    // network blip): inconclusive, so every held row draws as stored.
    // The next stored version (or the next tab) tries the load again.
    _translator = null
    for (const [k] of rowsByKey) {
      _memo.set(k, { status: 'inconclusive', reason: `translator unavailable: ${String((err && err.message) || err)}` })
      _pending.delete(k)
    }
    notify()
  })
}

const _queue = new Map()
/** Queue a stale row for translation; resolved answers arrive via `onUpgradeSettled`. */
function queueUpgrade(row) {
  const k = keyOf(row)
  if (_memo.has(k) || _pending.has(k)) return
  _pending.add(k)
  _queue.set(k, row)
  releaseLater(k)
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
 * @returns {{definition: object|null, refusal: string|null, writeBack: object|null,
 *            record: object|null, pending: boolean}}
 *   `definition: null` + `refusal` = the new translation refused it (do not draw);
 *   `definition: null` + `pending` = its new translation has not landed yet (hold it);
 *   `record` = a refusal this tab just learned, to be remembered server-side once.
 */
export function resolveRow(row) {
  const stored = row && row.definition
  const kind = savedScriptUpgradeEnabled() ? upgradeKindOf(row) : 'none'
  const offer = kind === 'legacy' || kind === 'retry' || (row && _retryLocal.has(keyOf(row)))
  if (offer) _legacy.add(row.def_id); else if (row && row.def_id) _legacy.delete(row.def_id)
  const nameOf = () => (isObj(stored.meta) && stored.meta.name) || row.def_id
  const out = (definition, extra = {}) => ({ definition, refusal: null, writeBack: null, record: null, pending: false, ...extra })
  if (kind === 'refused') {
    // ⭐ REMEMBERED: no chunk download, no translation, no request — the refusal wins.
    return out(null, { refusal: `${nameOf()}: ${row.engine_status.reason}` })
  }
  if (kind !== 'retranslate') return out(stored)
  const r = upgradedRow(row)
  if (!r) {
    // ⛔ L4 — held, unless its total wait ran out: then drawn as stored meanwhile.
    return _released.has(keyOf(row)) ? out(stored) : out(null, { pending: true })
  }
  if (r.status === 'upgraded') {
    // ⛔ L5 — a stored row without an integer version cannot be revision-guarded, so it
    // is never written back (fail closed — never last-write-wins). It still draws.
    const guarded = Number.isInteger(row.version) && !_retryLocal.has(keyOf(row))
    return out(r.definition, guarded ? { writeBack: { row, definition: r.definition } } : {})
  }
  if (r.status === 'refused') {
    return out(null, {
      refusal: `${nameOf()}: ${r.reason}`,
      record: Number.isInteger(row.version)
        ? { row, status: 'refused', reason: r.reason } : null,
    })
  }
  return out(stored)
}

/** ⭐ Is this script document HELD by a recorded engine verdict (refused, or its
 *  upgrade could not be saved)? Then its only edit door is the script itself
 *  (`ChartToolbar.openUpgradeDoor`), never the Formula tab on its stored maths. */
export function scriptUpgradeHeld(row) {
  const k = savedScriptUpgradeEnabled() ? upgradeKindOf(row) : 'none'
  return k === 'refused' || k === 'retry'
}

/** Does this saved definition offer the "Updated accuracy available" row? */
export function needsScriptForUpgrade(defId) {
  return typeof defId === 'string' && _legacy.has(defId)
}

/** The plain-words row the legend menu shows for a legacy script document. */
export const UPGRADE_NOTICE_LABEL = 'Updated accuracy available — open in Builder and save to apply'

/** What the Builder says when it opens a script whose upgrade could not be saved
 *  automatically (its script is in the box). */
export const SCRIPT_UPGRADE_RESAVE_NOTE = 'This indicator’s accuracy update could not be saved '
  + 'automatically — usually because it needs your confirmation. Its script is below: review it '
  + 'and choose "Save changes" to apply today’s engine.'

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
export async function writeBackOnce(plan, save, record = null) {
  const { row, definition } = plan
  const k = keyOf(row)
  if (_writeBacks.has(k)) return _writeBacks.get(k)
  // ⛔ L5 — fail closed: no revision guard, no write.
  if (!Number.isInteger(row.version)) { _writeBacks.set(k, 'skipped'); return 'skipped' }
  _writeBacks.set(k, 'pending')
  const storedMode = isObj(row.definition.meta) ? row.definition.meta.repaint : null
  const nextMode = isObj(definition.meta) ? definition.meta.repaint : null
  const options = {
    baseVersion: row.version,
    pineSource: row.pine_source,
    // ⭐ MEDIUM-1 — tells the store this is the engine-upgrade write-back, so its
    // migrated alerts get ONE accuracy-fix notice instead of one per alert.
    reason: 'engine-upgrade',
    ...(storedMode === 'preview-repaints' && nextMode === 'preview-repaints' ? { previewAcked: true } : {}),
  }
  let res
  try { res = await save(definition, row.def_id, null, options) } catch { res = { ok: false } }
  const status = res && res.ok ? 'saved' : (res && res.conflict ? 'conflict' : 'failed')
  _writeBacks.set(k, status)
  // ⭐ MEDIUM-2(b) — A STORE THAT ANSWERED NO (a 4xx other than the 409 race, e.g. a
  // 422 repaint-ack) will answer no again: remember it for every device, stop
  // translating and PUTting this version, and offer the member the Builder. A
  // transport failure or a 5xx is transient and is not remembered.
  const st = res && Number.isInteger(res.status) ? res.status : null
  if (status === 'failed' && st !== null && st >= 400 && st < 500) {
    _retryLocal.add(k)
    _legacy.add(row.def_id)
    notify()
    if (typeof record === 'function') {
      await recordOnce({ row, status: 'write-failed', reason: res.error || `refused (${st})` }, record)
    }
  }
  return status
}

/**
 * ⭐ MEDIUM-2(a)/(b) — remember, server-side, what this engine learned about one
 * stored version (`POST /{def_id}/engine-status`), ONCE per stored version per tab.
 * A failure to record is not retried here: the next load learns it again.
 */
export async function recordOnce(plan, record) {
  const { row, status, reason } = plan
  const k = `${keyOf(row)}:${status}`
  if (_recorded.has(k) || !Number.isInteger(row.version)) return false
  _recorded.add(k)
  try {
    const res = await record(row.def_id, { version: row.version, engine: SCRIPT_ENGINE_VERSION, status, reason })
    return !!(res && res.ok)
  } catch { return false }
}

/** Diagnostics: the write-back state of one stored version (tests, support). */
export function writeBackStatus(row) { return _writeBacks.get(keyOf(row)) || null }

/** Tests only. */
export function __resetSavedScriptUpgrade() {
  _memo.clear(); _writeBacks.clear(); _legacy.clear(); _pending.clear(); _queue.clear()
  _released.clear(); _retryLocal.clear(); _recorded.clear()
  _scheduled = false; _translator = null; _listeners.clear()
}
