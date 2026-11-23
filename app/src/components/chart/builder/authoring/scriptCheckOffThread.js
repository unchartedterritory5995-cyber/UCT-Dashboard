// app/src/components/chart/builder/authoring/scriptCheckOffThread.js
//
// ─── ⭐⭐ THE AUTHORING SCRIPT CHECK, OFF THE PAGE'S MAIN THREAD (2026-11-23, unit (c)) ─────────────────────────────
//
// Create Indicator's check of a script the assistant wrote (`scriptAnswer.js::checkScript`) is the paste path: the
// report of the text, the member door's build of it, and the editor status of the two. Until this unit it ran all
// three on the page's main thread, under engine 94's interim 10 s cap. A paste has run them in the member door's
// workers since #2254 (`memberPane/memberDoorAsync.js`, `inspectAsync.js`), and this is the same path, read by name:
//
//   · the BUILD is the page's shared door build of this text, `{source}` and nothing else: the key the member pane and
//     the editor's status panel use, so a script is built ONCE whoever asks (coordinator ruling 2026-11-21: no id and
//     no name of this check's own, which would be a second build of the same text and stop the first);
//   · the REPORT is PasteBox's shared report of it (`{source, dialect: 'pine'}`), on the report's own worker;
//   · the STATUS is the one the report's worker makes of the full report and the full door answer (the hub), read by
//     the report's key and the door answer's key and page state. ⛔ NEVER computed on this page from the light copies:
//     the page's door answer has no `translation` and its report no trees, and a status made of those is another status.
//
// ⛔ WHAT IS WAITED FOR, AND HOW LONG (coordinator ruling 2026-11-23). The door and the report are waited for
// themselves: each is bounded by its own worker (the door's deadline and watchdog, `memberDoorAsync.js`), never by a
// timer here, and a paste-to-status time is no basis for one (its p99 is the translation's, tens of seconds). Only the
// hub's own step is bounded: once BOTH have landed on this page, the status of the pair is given `HUB_STATUS_WAIT_MS`.
// Past it the check says so (`unchecked`), and `checkScript` answers "This script could not be checked here".
//
// ⛔ A FAULT OF THIS WINDOW IS NEVER A FACT ABOUT THE SCRIPT. A door that threw, a door worker that died, a report
// that could not be made, a status that did not come: each is `unchecked`, nothing of the check kept and nothing sent
// to the assistant for repair. (The door's own deadline refusing a script BY NAME is the door's answer, and is read.)
//
// ⛔ WITHOUT WORKERS (tests, a dev server, a host with no `Worker`) this module answers null and `checkScript` runs
// the check as it always did, on this thread, under its cap.
//
// Rails: `scriptCheckOffThread.test.js`. Mutants: `ci/mutants/u-script-check-worker.json`.
import { memberDoorService, doorRefOf, MEMBER_DOOR_WORKER_GUARD, MEMBER_DOOR_FAILED_GUARD, MEMBER_DOOR_SILENT_GUARD } from '../memberPane/memberDoorAsync'
import { inspectService, linkHub, reportKeyOf, hubStatusOf, subscribeHubStatuses, pageDoorRefOf } from '../inspectAsync'

/**
 * How long the hub's status of a (report, door answer) pair is waited for once BOTH have landed on the page, in ms.
 * ⭐ DERIVED: 3 x the p99 of the hub's own latency (door answer landed -> hub status), 560 ms, census v3 real-clock
 * rows `r3-head-rt0`, lane 0 (the larger lane), 852 scripts, a status landed on all 852; rounded up to 1,700.
 * (p50 1 ms, p95 97 ms, max 6,147 ms: a status slower than this bound is rare, and is said, never guessed.)
 * ⛔ THE ONE PLACE this number is written (`scriptCheckOffThread.test.js` holds that).
 */
export const HUB_STATUS_WAIT_MS = 1700

/** Why a check ended `unchecked` (for a rail and a trace; a member reads `scriptAnswer.js`'s line, never these). */
export const UNCHECKED_BECAUSE = Object.freeze({
  STOPPED: 'stopped',            // the member pressed Stop, or the window closed
  DOOR_THREW: 'door-threw',      // the door threw: a defect of this engine
  DOOR_WORKER: 'door-worker',    // the door's worker died or would not start
  REPORT: 'report',              // the report could not be made in its worker
  STATUS: 'status',              // the hub's status did not come within `HUB_STATUS_WAIT_MS`
})

/** The first answer a shared job lands, and the release of the subscription that waits for it. */
function firstAnswer(service, args) {
  let release = null
  const landed = new Promise((resolve) => {
    let had = false
    // (an answer already held for this page state lands before `subscribe` returns its release)
    release = service.subscribe(args, (answer) => { if (!had) { had = true; resolve(answer) } })
  })
  return { landed, release: () => { try { if (release) release() } catch { /* a service already disposed */ } } }
}

/** A promise that resolves once `cancelled()` is true (asked every quarter second), and its end. */
function watch(cancelled) {
  let timer = null
  let done = null
  const asked = () => { try { return cancelled() === true } catch { return false } }
  const stopped = new Promise((resolve) => {
    done = resolve
    if (asked()) { resolve(true); return }
    timer = setInterval(() => { if (asked()) { clearInterval(timer); timer = null; resolve(true) } }, 250)
  })
  return { stopped, asked, end: () => { if (timer !== null) { clearInterval(timer); timer = null } done(false) } }
}

/** The hub's status of that pair: now if it has landed, else when it lands, else null after `ms` (or once stopped). */
function statusWithin(reportKey, ref, ms, stopped) {
  const read = () => hubStatusOf(reportKey, ref.key, ref.version)
  const have = read()
  if (have) return Promise.resolve(have)
  return new Promise((resolve) => {
    let off = null
    let timer = null
    const end = (status) => {
      if (off) { off(); off = null }
      if (timer !== null) { clearTimeout(timer); timer = null }
      resolve(status)
    }
    off = subscribeHubStatuses(() => { const status = read(); if (status) end(status) })
    timer = setTimeout(() => end(null), ms)
    stopped.then((yes) => { if (yes) end(null) })
  })
}

/**
 * One script through the paste path in the member door's workers.
 * @param {string} pine
 * @param {object} [opts]
 * @param {() => boolean} [opts.cancelled]  true once the member pressed Stop or the window closed: the wait ends, and
 *        both subscriptions are released (a build nobody else reads is stopped)
 * @param {number} [opts.statusWaitMs]      the hub status bound (a rail's; a member path never passes one)
 * @returns {Promise<null | {unchecked: true, because: string, waitedMs?: number}
 *                        | {pane: object, status: object, consultPending: boolean, offThread: true}>}
 *   null: there are no workers here (the caller checks on this thread, as before). `pane` is the page's LIGHT copy of
 *   the door's answer (no `translation`); `status` is the report worker's, made of the full report and door answer.
 */
export async function judgeOffThread(pine, { cancelled = () => false, statusWaitMs = HUB_STATUS_WAIT_MS } = {}) {
  const door = memberDoorService()
  const reports = inspectService()
  if (!door.offThread || !reports.offThread) return null
  const unchecked = (because, more = {}) => ({ unchecked: true, because, ...more })
  const stop = watch(cancelled)
  // the channel between the two workers, so the report's worker has the door's FULL answer to make the status of
  linkHub()
  const build = firstAnswer(door, { source: pine })
  const report = firstAnswer(reports, { source: pine, dialect: 'pine' })
  try {
    // ⛔ no timer here: each is bounded by its own worker
    const both = await Promise.race([Promise.all([build.landed, report.landed]), stop.stopped.then((yes) => (yes ? null : new Promise(() => {})))])
    if (!both || stop.asked()) return unchecked(UNCHECKED_BECAUSE.STOPPED)
    const [built, reported] = both
    const pane = built && built.built
    if (!pane || typeof pane !== 'object') return unchecked(UNCHECKED_BECAUSE.DOOR_THREW)
    // ⭐⭐ (train e96 x #2568) and a door worker that went SILENT (`pine:door-silent`: its first word, then nothing for
    // the silence bound) is the window's fault too, like one that never loaded (`pine:door-worker`, the load bound):
    // never a refusal of the script handed to the hub, never sent to the assistant
    if (pane.guard === MEMBER_DOOR_WORKER_GUARD || pane.guard === MEMBER_DOOR_FAILED_GUARD
      || pane.guard === MEMBER_DOOR_SILENT_GUARD) return unchecked(UNCHECKED_BECAUSE.DOOR_WORKER)
    // a report that crossed from its worker has a key; one this page had to make in its place (the worker stopped, the
    // report threw there) has none, and is no report of the script
    const reportKey = reportKeyOf(reported && reported.report)
    if (!reportKey) return unchecked(UNCHECKED_BECAUSE.REPORT)
    // the door answer's name in the hub: the worker's build, or (the watchdog's refusal, made on this page) handed over
    const ref = doorRefOf(pane) || pageDoorRefOf(pane, pine)
    const status = ref ? await statusWithin(reportKey, ref, statusWaitMs, stop.stopped) : null
    if (stop.asked()) return unchecked(UNCHECKED_BECAUSE.STOPPED)
    if (!status) return unchecked(UNCHECKED_BECAUSE.STATUS, { waitedMs: statusWaitMs })
    return { pane, status, consultPending: built.consultPending === true, offThread: true }
  } finally {
    stop.end()
    build.release()
    report.release()
  }
}
