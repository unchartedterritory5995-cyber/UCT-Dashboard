// app/src/components/chart/builder/inspectAsync.js
//
// ─── ⭐⭐ THE PASTE WORKER (2026-11-21): PASTEBOX'S REPORT, COMPUTED OFF THE MAIN THREAD, ONCE PER TEXT ────────────
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
import { createKeyedWorkerService, memberDoorService } from './memberPane/memberDoorAsync'
import { memberDoorImage } from './memberPane/memberDoorImage'
import { INSPECT_JOB, INSPECT_LIBRARY_JOB, restoreFaithful, faithfulAnswerOf } from './memberPane/memberDoorProtocol'
import { inspectSource, inspectPine } from './inspectSource'
import { stampsFromCrossing } from './inspectView'
import { inspectLibrary } from './libraryIntake'
import { controlledErrorReport } from '../engine/ast/importOutcome'

/** The arguments a report is asked with, and the key they are one report under. `dialect` absent = `inspectPine`
 *  (PasteBox's Pine-only door), else `inspectSource(source, dialect, opts)`. */
export function inspectKeyOf(args) {
  const a = args && typeof args === 'object' ? args : {}
  for (const k of Object.keys(a)) {
    if (k !== 'source' && k !== 'dialect' && k !== 'opts' && k !== 'savedRow') throw new TypeError(`inspectService: \`${k}\` is not a report argument`)
  }
  // ⭐ `savedRow` (the saved script being edited, when there is one) is the status's, made with the report (the hub):
  // a report is asked again when it is another saved version
  const saved = a.savedRow && typeof a.savedRow === 'object' ? [a.savedRow.def_id ?? null, a.savedRow.version ?? null] : null
  return JSON.stringify([typeof a.source === 'string' ? a.source : null, a.dialect ?? null, a.opts ?? null, saved])
}

/** What the report says when it could not be computed: what PasteBox's own catch said of a throw. */
const stopped = (source, why) => controlledErrorReport(source, new Error(`the background check of this text stopped before it answered (${why})`))

/** PasteBox's report of one text, the job (`createKeyedWorkerService`). `landed`: `{report, offThread, ms}`. */
export const INSPECT_WORKER_JOB = Object.freeze({
  kind: INSPECT_JOB,
  keyOf: inspectKeyOf,
  argsOf: (a) => ({ source: typeof a.source === 'string' ? a.source : '', ...(a.dialect != null ? { dialect: a.dialect } : {}),
    ...(a.opts != null ? { opts: a.opts } : {}), ...(a.savedRow != null ? { savedRow: a.savedRow } : {}) }),
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
    if (reply.ok === true) {
      // (each refusal's stamp crossed as a mark: it is the job's own text, `inspectView.stampsForCrossing`)
      const report = stampsFromCrossing(restoreFaithful({ value: reply.answer, hidden: reply.hidden }), entry.args.source)
      // ⭐ THE HUB: this report's name, and the statuses its worker made of it (alone, and with the door's answer)
      if (report && typeof report === 'object') REPORT_KEYS.set(report, entry.key)
      for (const st of Array.isArray(reply.statuses) ? reply.statuses : []) putStatus(entry.key, st.doorKey, st.doorVersion, st)
      return { report, offThread: true, ms: reply.ms }
    }
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

// ─── ⭐⭐ THE HUB: THE EDITOR STATUS PANEL'S STATUS IS MADE WHERE THE FULL REPORT AND DOOR ANSWER ARE ──────────────
// `editorStatus(report, pane)` reads the report's trees and the door answer's `translation`: tens of MB on a heavy script
// (measured, #2254: 62.5 MB and 47.8 MB of structured clone, up to 1.2 s to receive on this thread). Neither crosses to
// the page for it: the report's worker keeps the full report, the door's worker sends it the full door answer over a
// MessageChannel this module sets up between the two (`linkHub`), and the report's worker makes the status and sends
// only it (a few KB), as each report or door answer for a text arrives (`memberDoorWorkerCore.js`). The page names a
// status by the report's key and the door answer's key and page state (`reportKeyOf`, `doorRefOf`); a door answer the
// page made itself (a worker that died, the watchdog, a door that threw) is handed to the report's worker as a
// message (`pageDoorRefOf`). Without workers the status is computed here, as it always was (`useHubStatus.js`).
const REPORT_KEYS = new WeakMap()
/** The key of a report that crossed from the report's worker, or null (one computed on this page). */
export function reportKeyOf(report) {
  return report && typeof report === 'object' ? (REPORT_KEYS.get(report) || null) : null
}

const STATUSES = new Map()        // `${reportKey}|${doorKey}|${doorVersion}` -> status
const STATUS_KEEP = 40
const statusListeners = new Set()
const statusKey = (reportKey, doorKey, doorVersion) => JSON.stringify([reportKey, doorKey ?? null, doorVersion ?? null])
function putStatus(reportKey, doorKey, doorVersion, crossing) {
  if (typeof reportKey !== 'string' || !crossing || crossing.error) return
  const k = statusKey(reportKey, doorKey, doorVersion)
  STATUSES.delete(k)
  STATUSES.set(k, restoreFaithful({ value: crossing.answer, hidden: crossing.hidden }))
  while (STATUSES.size > STATUS_KEEP) STATUSES.delete(STATUSES.keys().next().value)
  for (const fn of [...statusListeners]) { try { fn() } catch { /* a listener's fault */ } }
}
/** The status the report's worker made of that report with that door answer (`doorKey` null: the report alone), or null. */
export function hubStatusOf(reportKey, doorKey, doorVersion) {
  return STATUSES.get(statusKey(reportKey, doorKey, doorVersion)) || null
}
/** `fn()` whenever a status lands; returns the unsubscribe. */
export function subscribeHubStatuses(fn) {
  statusListeners.add(fn)
  return () => statusListeners.delete(fn)
}

/** A status message from the report's worker (`{type: 'status', reportKey, doorKey, doorVersion, answer, hidden}`). */
function onReportWorkerMessage(m) {
  if (m && m.type === 'status') putStatus(m.reportKey, m.doorKey, m.doorVersion, m)
}

const PAGE_REFS = new WeakMap()
let pageDoorSeq = 0
/** The hub's name for a door answer this page made (a refusal: small), handed to the report's worker once, so its status
 *  is made there with the report it goes with. Null when there is no report worker to hand it to. */
export function pageDoorRefOf(pane, source) {
  if (!pane || typeof pane !== 'object') return null
  const had = PAGE_REFS.get(pane)
  if (had) return had
  const svc = inspectService()
  if (!svc.offThread) return null
  const ref = { key: `page:${++pageDoorSeq}`, version: 0 }
  const crossing = faithfulAnswerOf(pane)
  if (!svc.notify({ type: 'door-answer', key: ref.key, version: ref.version, source, answer: crossing.value, hidden: crossing.hidden })) return null
  PAGE_REFS.set(pane, ref)
  return ref
}

let linked = null
let makeChannel = () => new MessageChannel()
/** ⛔ Rails only: the channel the hub pairs the two workers with (a stand-in's), `null` restores the real one. */
export function __setHubChannelForTests(fn = null) { makeChannel = typeof fn === 'function' ? fn : () => new MessageChannel() }
/** ⭐ The MessageChannel between the door's worker and the report's: set up again whenever either starts a worker, so
 *  the two always talk on one channel (the door's side sends its last full answer to a new port). Idempotent. */
export function linkHub() {
  const door = memberDoorService()
  const report = inspectService()
  if (!door.offThread || !report.offThread) return
  if (linked && linked.door === door && linked.report === report) return
  if (linked) linked.off()
  let dw = null
  let rw = null
  let paired = null
  const pair = () => {
    if (!dw || !rw) return
    if (paired && paired.dw === dw && paired.rw === rw) return
    let ch
    try { ch = makeChannel() } catch { return }
    try {
      rw.postMessage({ kind: 'peer', role: 'inspect' }, [ch.port2])
      dw.postMessage({ kind: 'peer', role: 'door' }, [ch.port1])
      paired = { dw, rw }
    } catch { paired = null }
  }
  const offDoor = door.onWorker((w) => { dw = w; if (!w) paired = null; else pair() })
  const offReport = report.onWorker((w) => { rw = w; if (!w) paired = null; else pair() })
  linked = { door, report, off: () => { offDoor(); offReport() } }
}

/**
 * ⭐ THE OBJECT PROGRAM OF A REPORT THAT CROSSED LIGHT (`inspectView.reportForPage`), asked of the report's worker when
 * the member presses Use. `args`: the arguments the report was asked with (the worker makes the report again from
 * them if it no longer holds it, never this page). Resolves with the program, as the report held it; where the
 * worker cannot answer (it cannot be started), the report is made here and its program read, so a Use never loses it.
 */
export async function askHeldObjects(report, args) {
  if (!report || typeof report !== 'object') return null
  if (!report.pageView || !report.pageView.objectsHeld) return report.objects || null
  const key = reportKeyOf(report)
  let image = null
  try { image = memberDoorImage() } catch { image = null }
  const reply = key ? await inspectService().ask({ type: 'objects-ask', reportKey: key, args: INSPECT_WORKER_JOB.argsOf(args || {}), image }) : null
  if (reply && reply.ok === true) return restoreFaithful({ value: reply.answer, hidden: reply.hidden })
  const here = INSPECT_WORKER_JOB.runHere(INSPECT_WORKER_JOB.argsOf(args || {}))
  return (here.report && here.report.objects) || null
}

let _inspect = null
let _library = null
/** The page's PasteBox report service (one per page; nothing is spawned until a report is asked for). */
export function inspectService() {
  if (!_inspect) _inspect = createKeyedWorkerService({ job: INSPECT_WORKER_JOB, onMessage: onReportWorkerMessage })
  return _inspect
}
/** The page's several-scripts report service. */
export function inspectLibraryService() {
  if (!_library) _library = createKeyedWorkerService({ job: INSPECT_LIBRARY_WORKER_JOB })
  return _library
}

/** ⛔ Rails only: put services with stand-in workers in the page's place (`null` restores the default). A stand-in report
 *  service should be made with `onMessage: hubMessageForTests` so its worker's statuses reach the hub. */
export function __setInspectServicesForTests({ inspect = null, library = null } = {}) {
  if (_inspect && _inspect !== inspect) _inspect.dispose()
  if (_library && _library !== library) _library.dispose()
  _inspect = inspect
  _library = library
  if (linked) { linked.off(); linked = null }
}
/** ⛔ Rails only: the report service's message handler, for a stand-in made by a rail. */
export const hubMessageForTests = onReportWorkerMessage
