// app/src/components/chart/builder/inspectAsync.js
//
// ─── ⭐⭐ THE PASTE WORKER (2026-11-21) — PASTEBOX'S REPORT, COMPUTED OFF THE MAIN THREAD, ONCE PER TEXT ────────────
//
// docs/pine/evidence/2026-11-20-paste-worker/EVIDENCE.md. PasteBox's report of a paste (`inspectSource`, one
// member-input translation of the text and every output measured against the downstream doors) ran on the page's
// main thread, 250 ms after the member stopped typing: on the AFTER trace of #2254 one script held the tab for 25-29 s
// there while the member door's worker translated the same script for the chart. So it runs in the member door's
// worker too (`memberPane/memberDoorWorkerCore.js::answerInspectJob`), on its OWN worker (a second instance, so the
// report and the chart door's build compute at once), keyed and shared exactly as the chart door's build is
// (`memberPane/memberDoorAsync.js::createKeyedWorkerService`): one computation per (text, dialect, settings, page state),
// read by PasteBox and, through it, the editor's status panel.
//
// ⛔ THE SAME REPORT. The worker runs the same function on the text, over the page's state imaged into it, and the
// report crosses FAITHFULLY (`memberPane/memberDoorProtocol.js`): every non-enumerable property the translator wrote
// (a parameter's id on a tree literal, a row's handoffs) is put back on the page before PasteBox reads it.
// ⛔ NEVER A SILENT HANG: a worker that died or did not answer by the member door's watchdog answers the report a
// throw would have (`controlledErrorReport`: the engine failed, nothing to save), as PasteBox's own catch did.
// ⛔ WITHOUT `Worker` (tests, a non-browser host) the report is computed here, synchronously, as it always was.
import { createKeyedWorkerService } from './memberPane/memberDoorAsync'
import { INSPECT_JOB, INSPECT_LIBRARY_JOB, STATUS_JOB, restoreFaithful, hiddenTableOf } from './memberPane/memberDoorProtocol'
import { inspectSource, inspectPine } from './inspectSource'
import { inspectLibrary } from './libraryIntake'
import { controlledErrorReport } from '../engine/ast/importOutcome'
import { editorStatus } from './editorStatus'

/** The arguments a report is asked with, and the key they are one report under. `dialect` absent = `inspectPine`
 *  (PasteBox's Pine-only door), else `inspectSource(source, dialect, opts)`. */
export function inspectKeyOf(args) {
  const a = args && typeof args === 'object' ? args : {}
  for (const k of Object.keys(a)) {
    if (k !== 'source' && k !== 'dialect' && k !== 'opts') throw new TypeError(`inspectService: \`${k}\` is not a report argument`)
  }
  return JSON.stringify([typeof a.source === 'string' ? a.source : null, a.dialect ?? null, a.opts ?? null])
}

/** What the report says when it could not be computed: what PasteBox's own catch said of a throw. */
const stopped = (source, why) => controlledErrorReport(source, new Error(`the background check of this text stopped before it answered (${why})`))

/** PasteBox's report of one text, the job (`createKeyedWorkerService`). `landed`: `{report, offThread, ms}`. */
export const INSPECT_WORKER_JOB = Object.freeze({
  kind: INSPECT_JOB,
  keyOf: inspectKeyOf,
  argsOf: (a) => ({ source: typeof a.source === 'string' ? a.source : '', ...(a.dialect != null ? { dialect: a.dialect } : {}),
    ...(a.opts != null ? { opts: a.opts } : {}) }),
  runHere(args) {
    let report
    try {
      report = args.dialect === undefined ? inspectPine(args.source, args.opts) : inspectSource(args.source, args.dialect, args.opts)
    } catch (e) {
      report = controlledErrorReport(args.source, e)
    }
    return { report, offThread: false }
  },
  fromReply(reply, entry) {
    if (reply.ok === true) return { report: restoreFaithful({ value: reply.answer, hidden: reply.hidden }), offThread: true, ms: reply.ms }
    const err = new Error((reply.error && reply.error.message) || 'no message')
    if (reply.error && reply.error.name) err.name = reply.error.name
    return { report: controlledErrorReport(entry.args.source, err), offThread: true }
  },
  failed: (why, entry) => ({ report: stopped(entry.args.source, why), offThread: true }),
  timedOut: (entry) => ({ report: stopped(entry.args.source, 'it ran past the time allowed'), offThread: true }),
})

/** The key of a several-scripts report: the scripts, in order. */
export function inspectLibraryKeyOf(args) {
  return JSON.stringify((args && Array.isArray(args.scripts)) ? args.scripts : [])
}

/** The report of a paste holding several scripts (`libraryIntake.inspectLibrary`), the job. `landed`: `{report}`
 *  (null, with `error`, when it could not be computed: PasteBox then shows no library summary). */
export const INSPECT_LIBRARY_WORKER_JOB = Object.freeze({
  kind: INSPECT_LIBRARY_JOB,
  keyOf: inspectLibraryKeyOf,
  argsOf: (a) => ({ scripts: Array.isArray(a.scripts) ? a.scripts : [] }),
  runHere(args) {
    try { return { report: inspectLibrary(args.scripts), offThread: false } } catch (e) { return { report: null, error: { message: String((e && e.message) || e) }, offThread: false } }
  },
  fromReply(reply) {
    if (reply.ok === true) return { report: restoreFaithful({ value: reply.answer, hidden: reply.hidden }), offThread: true, ms: reply.ms }
    return { report: null, error: { message: (reply.error && reply.error.message) || 'no message' }, offThread: true }
  },
  failed: (why) => ({ report: null, error: { message: why }, offThread: true }),
  timedOut: () => ({ report: null, error: { message: 'it ran past the time allowed' }, offThread: true }),
})

// ─── ⭐⭐ THE EDITOR STATUS PANEL'S STATUS, OFF THE MAIN THREAD ─────────────────────────────────────────────────
// `editorStatus(report, pane)` walks every output the report and the chart door's document carry through the lanes'
// gates (`evaluability`): on the AFTER trace of #2254 one script spent 1.1 s on it inside a React render. It is
// computed in the member door's worker too, on its own worker, keyed by what it reads (the report, the door's answer,
// the saved row and the text, by identity: a status is made again when one of them is another object). The report and
// the answer are handed on as faithfully as they came (`hiddenTableOf`: the tables they crossed with, cloned with them,
// no walk on this thread). ⛔ A worker that cannot answer: the status is computed here (the answer is never missing).
const ids = new WeakMap()
let nextObjectId = 1
const idOf = (o) => {
  if (!o || typeof o !== 'object') return o === undefined ? 'u' : JSON.stringify(o)
  if (!ids.has(o)) ids.set(o, nextObjectId++)
  return `#${ids.get(o)}`
}
/** The arguments a status is asked with (`{report, pane, savedRow, inspectedSource}`), and their key. */
export function statusArgsOf({ report, pane = null, savedRow = null, inspectedSource = null }) {
  return {
    key: JSON.stringify([idOf(report), idOf(pane), idOf(savedRow), inspectedSource]),
    report, reportHidden: hiddenTableOf(report), pane, paneHidden: hiddenTableOf(pane), savedRow, inspectedSource,
  }
}
const statusHere = (a) => editorStatus({ report: a.report, pane: a.pane, savedRow: a.savedRow, inspectedSource: a.inspectedSource })
/** The status job (`createKeyedWorkerService`). `landed`: `{status, offThread, ms}`. */
export const STATUS_WORKER_JOB = Object.freeze({
  kind: STATUS_JOB,
  keyOf: (a) => (a && typeof a.key === 'string' ? a.key : JSON.stringify(null)),
  argsOf: (a) => ({ report: a.report, reportHidden: a.reportHidden || null, pane: a.pane || null, paneHidden: a.paneHidden || null,
    savedRow: a.savedRow ?? null, inspectedSource: a.inspectedSource ?? null }),
  runHere: (args) => ({ status: statusHere(args), offThread: false }),
  fromReply(reply, entry) {
    if (reply.ok === true) return { status: restoreFaithful({ value: reply.answer, hidden: reply.hidden }), offThread: true, ms: reply.ms }
    return { status: statusHere(entry.args), offThread: false, error: { message: (reply.error && reply.error.message) || 'no message' } }
  },
  failed: (why, entry) => ({ status: statusHere(entry.args), offThread: false, error: { message: why } }),
  timedOut: (entry) => ({ status: statusHere(entry.args), offThread: false, error: { message: 'it ran past the time allowed' } }),
})

let _inspect = null
let _library = null
let _status = null
/** The page's PasteBox report service (one per page; nothing is spawned until a report is asked for). */
export function inspectService() {
  if (!_inspect) _inspect = createKeyedWorkerService({ job: INSPECT_WORKER_JOB })
  return _inspect
}
/** The page's several-scripts report service. */
export function inspectLibraryService() {
  if (!_library) _library = createKeyedWorkerService({ job: INSPECT_LIBRARY_WORKER_JOB })
  return _library
}

/** The page's editor status service. */
export function statusService() {
  if (!_status) _status = createKeyedWorkerService({ job: STATUS_WORKER_JOB })
  return _status
}

/** ⛔ Rails only: put services with stand-in workers in the page's place (`null` restores the default). */
export function __setInspectServicesForTests({ inspect = null, library = null, status = null } = {}) {
  if (_inspect && _inspect !== inspect) _inspect.dispose()
  if (_library && _library !== library) _library.dispose()
  if (_status && _status !== status) _status.dispose()
  _inspect = inspect
  _library = library
  _status = status
}
