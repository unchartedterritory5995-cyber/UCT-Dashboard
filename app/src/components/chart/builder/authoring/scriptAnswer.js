// app/src/components/chart/builder/authoring/scriptAnswer.js
//
// ─── ⭐ AN ANSWER THAT IS A SCRIPT: THE ENGINE JUDGES IT, NEVER THE ASSISTANT (2026-11-18) ───
//
// For a request a formula cannot hold (a table, a label, a drawn line), Create Indicator's
// assistant writes Pine. What it writes is put through EXACTLY the path a pasted script takes
// (`inspectSource` + `memberPaneDefinition` + `editorStatus`, with the runtime lane's lists and this
// script's own admission read first), and what the member is shown is THAT path's verdict.
//
// THE RULES, each held by `scriptAnswer.test.js`:
//   1. The verdict's headline and lines are the status panel's own, word for word.
//   2. A script that does not run fully is sent back to the assistant with the engine's words
//      (`refusalOf`), a bounded number of times (`MAX_REPAIR_ROUNDS`), and never again once a
//      repair comes back with the SAME refusals (the verdict has stopped improving).
//   3. Whatever the last verdict is, it is shown as it is. A script that still does not run is
//      shown as not running, with the engine's reasons.
//
// The engine modules are loaded only when a script arrives (dynamic imports), so the dock's
// first-open bytes do not grow by the Pine translator.
//
// ⭐⭐ (2026-11-23, unit (c)) — WHERE THERE ARE WORKERS, THIS CHECK RUNS IN THEM, AND HOLDS NO PART OF THE PAGE.
// The report, the door's build and the status are the member door's workers' (`scriptCheckOffThread.js`): the page's
// ONE shared build of the text, PasteBox's shared report of it, and the status the report's worker makes of the two.
// No translation, no door call and no status is computed on this thread, so the check needs no wall cap there: the
// door is bounded by its own deadline and watchdog, and only the hub's last step by a bound of this check's
// (`HUB_STATUS_WAIT_MS`). A fault of the window (a worker that died, a status that did not come, a door that threw) is
// REFUSED BY NAME: "This script could not be checked here", nothing of the check kept, nothing sent back to the
// assistant (it is a fact about this window, never about the script).
//
// ⭐⭐ (engine 94, coordinator ruling 2026-11-22) — WITHOUT WORKERS IT RUNS ON THIS THREAD, UNDER ITS OWN WALL CAP.
// A host with no `Worker` (a test, the dev server) checks as it always did, and the deterministic budgets took the
// translator's 10 s window away, so that path passes the door API a short cap of its own
// (`engine/ast/doorDeadline.js::withMainThreadCap`, `SCRIPT_CHECK_CAP_MS`, the old window's 10 s) over the whole
// main-thread part of the check (the report, the door, the status). Past it the check is refused by the same name,
// with the cap said in a line. Rails: `scriptCheckCap.test.js`. (The cap's module is loaded with the engine, never at
// first open.)

/** The authoring check's main-thread cap, in ms: the translator's old 10 s window (see the note above). */
export const SCRIPT_CHECK_CAP_MS = 10000
/** The headline of a check this window could not make (the engine did not load, a check threw, the cap ran out). */
export const UNCHECKED_HEADLINE = 'This script could not be checked here'
/** What the member reads under that headline when the cap ran out. */
export const SCRIPT_CHECK_CAPPED_LINE = `Checking it here took longer than ${SCRIPT_CHECK_CAP_MS / 1000} seconds, and this `
  + 'window stops a check that long rather than hold the page. That is a limit of this window, not a mistake in the '
  + 'script: open it in the editor to check it there.'
/** What the member reads under that headline when the workers' check did not finish (the status of the script's
 *  report and build did not come within the hub's bound, `scriptCheckOffThread.js::HUB_STATUS_WAIT_MS`). */
export const SCRIPT_CHECK_UNFINISHED_LINE = 'The check of this script did not finish in this window. That is a limit of '
  + 'this window, not a mistake in the script: open it in the editor to check it there.'
const wallNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())

/** The most times one request's script is sent back for repair (the server holds the same bound). */
export const MAX_REPAIR_ROUNDS = 2
/** The bounds the server reads a refusal under (`script_conversation.REFUSAL_MAX_*`). */
export const SCRIPT_REFUSAL_LIMITS = Object.freeze({ maxErrors: 6, maxChars: 300 })
/** The verdict states that mean "runs for a member with nothing withheld". */
export const RUNS_STATES = Object.freeze(['runs', 'runs-with-notes'])
const WITHHELD = 'withheld'

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim()

/** One verdict item as a line a member (and the assistant) can read. */
function lineOf(item) {
  const where = Number.isInteger(item.line) ? `line ${item.line}: ` : (item.name ? `${clean(item.name)}: ` : '')
  return clean(`${where}${item.reason || item.why || item.label || ''}`)
}

/**
 * The verdict of the paste path, as the dock shows it.
 * @param {object} status  `editorStatus(...)`
 * @param {object} pane    `memberPaneDefinition(...)`
 */
export function verdictFrom(status, pane) {
  const items = Array.isArray(status && status.items) ? status.items : []
  // ⭐ 2026-11-19 -- LOST DRAWINGS ARE NOT "RUNS". The lane that takes a script can carry its plots
  // and lose its drawing program ("6 of 6 drawing elements aren't supported yet"); the status says
  // that as a NOTE beside "Runs on the chart". A script written to draw levels that draws none has
  // not run, so the loss leads the reasons and goes back to the assistant like any refusal.
  const lost = drawingLossOf(pane)
  const withheld = [...(lost ? [lost] : []), ...items.filter((i) => i && i.severity === WITHHELD).map(lineOf).filter(Boolean)]
  const notes = items.filter((i) => i && i.severity !== WITHHELD).map(lineOf).filter((n) => n && !(lost && n.includes(lost)))
  const state = (status && status.state) || 'unknown'
  const attaches = !!(pane && pane.ok === true)
  const runs = attaches && RUNS_STATES.includes(state) && !lost
  const why = withheld.length ? withheld
    : [clean((pane && pane.runtimeDeclined && pane.runtimeDeclined.why) || (pane && pane.reason) || (status && status.headline) || 'the chart does not run this script')]
  return {
    runs, attaches, state, lane: (pane && pane.lane) || 'host',
    headline: lost && attaches && RUNS_STATES.includes(state) ? LOST_DRAWINGS_HEADLINE
      : (clean(status && status.headline) || (runs ? 'Runs' : 'Not yet')),
    lostDrawings: !!lost,
    withheld, notes,
    // what the assistant is told when it does not run fully: the engine's own sentences
    errors: runs ? [] : [...new Set(why)].slice(0, SCRIPT_REFUSAL_LIMITS.maxErrors).map((e) => e.slice(0, SCRIPT_REFUSAL_LIMITS.maxChars)),
  }
}

/** The name the engine gives a disclosure about a script's drawings (`engine/ast/objectLoss.js`,
 *  `DRAWING_NOTE_NAME`). A copy, because this module loads the engine only when a script arrives;
 *  `scriptAnswer.test.js` holds it equal to the engine's. */
export const DRAWINGS_NOTE = 'Drawings'
/** What the dock leads with when the plots run and the drawings were lost. */
export const LOST_DRAWINGS_HEADLINE = 'Its plots run on the chart, but its drawings are not all drawn'

/**
 * What the lane that took this script says it could NOT carry of its drawings, in the engine's own
 * words, or null. A document whose RUN owns its drawings carries a disclosure of the same name that
 * is not a loss ("made by the same bar-by-bar run"), so that one is never read as one.
 */
export function drawingLossOf(pane) {
  const def = pane && pane.definition
  if (!def || !def.meta || !Array.isArray(def.meta.disclosures)) return null
  if (def.compute && def.compute.objects === true) return null
  const d = def.meta.disclosures.find((x) => x && x.name === DRAWINGS_NOTE && typeof x.note === 'string' && x.note.trim())
  return d ? clean(d.note) : null
}

/** `{pine, errors, round}` as it goes back to the door, or null when there is nothing to send. */
export function refusalOf(pine, verdict, round) {
  if (typeof pine !== 'string' || !pine || !verdict || verdict.runs || !verdict.errors.length) return null
  return { pine, errors: verdict.errors, round }
}

/** Has a repair stopped improving? The same refusals twice running is the end. */
export function sameRefusals(a, b) {
  return !!a && !!b && a.errors.length === b.errors.length && a.errors.every((e, i) => e === b.errors[i])
}

/**
 * Run one script through the member's own paste path. Never throws: a failure to check is a
 * verdict that says so (and is never read as "runs").
 * @param {string} pine
 * @param {object} [deps]  injectable for tests: `{ load }` returns the engine modules; `capClock` the wall clock the
 *                         main-thread cap is read on
 */
export async function checkScript(pine, { load = loadEngine, chart = null, admission = null, capClock = wallNow, cancelled = () => false } = {}) {
  try {
    const { inspectSource, memberPaneDefinition, editorStatus, prepare, runHereWhenLanded, verdictOnChart, consultPending, pendingReason,
      judgeOffThread } = await load()
    // (why the server is still checking, when it said: kept on a verdict that is only CHECKING, nowhere else)
    const withReason = (v) => {
      if (!isChecking(v)) return v
      const reason = pendingReason(pine)
      return PENDING_REASON_LINES[reason] ? { ...v, pendingReason: reason } : v
    }
    await prepare(pine, admission)
    // ⭐⭐ IN THE WORKERS, where there are workers (`scriptCheckOffThread.js`): the page's shared build, the shared
    // report and the status the report's worker made of them. Null: no workers here, the check runs on this thread.
    const off = typeof judgeOffThread === 'function' ? await judgeOffThread(pine, { cancelled }) : null
    if (off && off.unchecked) return off.because === 'status' ? unfinishedVerdict() : uncheckedVerdict()
    let judged = off
    if (!judged) {
      // ⭐⭐ ONE CAP over the main-thread part of the check (see the note at the top): past it, refused by name, nothing kept
      const { withMainThreadCap } = await import('../../engine/ast/doorDeadline.js')
      const checked = withMainThreadCap(SCRIPT_CHECK_CAP_MS, () => {
        const report = inspectSource(pine, 'pine')
        const pane = memberPaneDefinition({ source: pine, id: SCRIPT_CHECK_ID, name: 'script' })
        return { pane, status: editorStatus({ report, pane, savedRow: null, inspectedSource: pine }) }
      }, capClock)
      if (checked.capped) return cappedVerdict()
      judged = { ...checked.value, consultPending: typeof consultPending === 'function' && consultPending(pine) }
    }
    const { pane } = judged
    const pasted = verdictFrom(judged.status, pane)
    // ⛔ A VERDICT MADE WHILE THE CHART DOES NOT KNOW WHETHER IT MAY DRAW THE SCRIPT IS NOT A REFUSAL (review
    // 2026-11-19). The bar-by-bar lane declines a script whose admission has not answered (the server said
    // "still being checked", or the question failed); the paste check then reads "does not run", with the
    // lane's own "still being checked" sentence as its reason, and that went to the assistant for a repair of
    // a script that was fine. Nothing is known yet: it is CHECKING, and is asked again.
    // (whether a consult the BUILD made left the script unanswered: read where the build ran, right after it)
    if (!pasted.runs && judged.consultPending === true) {
      return withReason({ ...pasted, checking: true, headline: STILL_CHECKING_HEADLINE, errors: [] })
    }
    // ⭐⭐ 2026-11-19 -- "RUNS" MEANS IT RAN. The status above is decided before any bar is computed, and
    // says "runs" for scripts the engine refuses when it runs them (a value kept since the first bar on
    // a chart that does not reach the listing, a clock read, a loop past its limit). So a script the
    // paste check passes is RUN on the chart's own bars and context (`builder/runsHere.js`, the one
    // authority both doors use), and the run can only take "runs" away. A run that stopped goes back
    // to the assistant with the engine's own sentence, like any refusal. With no chart to run on
    // (an older caller, a chart still loading) the verdict is the paste check's, marked as such.
    if (!pasted.runs || typeof runHereWhenLanded !== 'function' || typeof verdictOnChart !== 'function') return pasted
    // (no chart to run on: an older caller, a chart still loading. The paste check passed and nothing was run;
    // `verdictOnChart` says exactly that, never "runs on the chart")
    if (!chart) return verdictOnChart(pasted, { state: 'not-run', stops: [], unchecked: [], waiting: [], notes: [], why: 'there was no chart to run it on' }, SCRIPT_REFUSAL_LIMITS)
    const run = await runHereWhenLanded(pane, chart, { timeoutMs: RUN_WAIT_MS })
    return withReason(verdictOnChart(pasted, run, SCRIPT_REFUSAL_LIMITS))
  } catch {
    return uncheckedVerdict()
  }
}

/** The verdict of a check this window could not make: refused by name, nothing of the check kept, and nothing for the
 *  assistant to repair (`errors` empty: `refusalOf` sends nothing). */
function uncheckedVerdict() {
  return { runs: false, attaches: false, state: UNCHECKED_STATE, lane: 'host', headline: UNCHECKED_HEADLINE,
    withheld: [], notes: [], errors: [] }
}

/** The verdict of a workers' check whose status did not come in time: the same refusal, with why said in a line. */
function unfinishedVerdict() {
  return { ...uncheckedVerdict(), notes: [SCRIPT_CHECK_UNFINISHED_LINE], unfinished: true }
}

/** The verdict of a check whose main-thread cap ran out: refused by name, the cap said, nothing of the check kept, and
 *  nothing for the assistant to repair (`errors` empty: `refusalOf` sends nothing). */
function cappedVerdict() {
  return { runs: false, attaches: false, state: UNCHECKED_STATE, lane: 'host', headline: UNCHECKED_HEADLINE,
    withheld: [], notes: [SCRIPT_CHECK_CAPPED_LINE], errors: [], capped: true }
}

/** How long the dock waits for a run handed to a worker before saying "still being checked". */
export const RUN_WAIT_MS = 8000

/**
 * ⭐ LATCH THE VERDICT THE ANSWER CARRIED, exactly as the door's own answer is latched
 * (`engine/runtimeKill.js::requestRuntimeAdmission`), and under the same refusals:
 *   - only while capability admission is ON (the lists were just read);
 *   - only when its `sha256` IS this script's own hash (a verdict for another script is never latched under this one);
 *   - never a "still being checked" (`missing` holds `pending`): that is not a verdict, and the door is asked;
 *   - `historyOnly` fails closed: anything present that is not an empty list reads as finished-bars-only;
 *     its string ids ride along (`historyOnlyIds`) so the forming refusal names the server's reason.
 * @returns {boolean} whether a verdict was latched
 */
export function latchAnswerAdmission(kill, pine, admission) {
  if (!kill || !admission || typeof admission !== 'object' || typeof pine !== 'string' || !pine) return false
  if (!kill.runtimeCapabilityAdmissionOn()) return false
  if (typeof admission.sha256 !== 'string' || typeof admission.admitted !== 'boolean') return false
  const h = kill.runtimeSourceHash(pine)
  if (!h || admission.sha256.toLowerCase() !== h) return false
  if (Array.isArray(admission.missing) && admission.missing.includes('pending')) return false
  const historyOnly = admission.historyOnly !== undefined
    && !(Array.isArray(admission.historyOnly) && admission.historyOnly.length === 0)
  const historyOnlyIds = Array.isArray(admission.historyOnly) ? admission.historyOnly.filter((id) => typeof id === 'string') : []
  kill.latchRuntimeAdmission(h, { admitted: admission.admitted === true, historyOnly, historyOnlyIds })
  return true
}

/** The definition id a script is checked under (never stored, never installed). */
export const SCRIPT_CHECK_ID = 'u_script_check'

/** The engine modules, loaded on first use, and what must be read before a script is judged. */
async function loadEngine() {
  const [pineBox, paneDef, status, kill, gate, here, offThread] = await Promise.all([
    import('../PineBox'), import('../memberPane/memberPaneDefinition'), import('../editorStatus'),
    import('../../engine/runtimeKill'), import('../../engine/runtimePaneGate'), import('../runsHere'),
    import('./scriptCheckOffThread'),
  ])
  return {
    // the check in the member door's workers (null where there are none: the three below run it on this thread)
    judgeOffThread: offThread.judgeOffThread,
    runHereWhenLanded: here.runHereWhenLanded,
    verdictOnChart: here.verdictOnChart,
    // whether the lane decided THIS script with no admission verdict in hand (`engine/runtimeKill.js`)
    consultPending: (pine) => kill.runtimeConsultPendingOf({ source: pine }),
    // why the server said "still being checked" the last time it was asked about this script, when it gave a
    // reason. ⛔ READ DIRECTLY, no "is it there" guard (coordinator ruling 2026-11-20): a guard is a silent-off
    // switch, and a renamed engine function would leave the dock saying nothing. Renamed, this throws, and the
    // rail that walks both windows on the real engine (`builder/pendingReason.rail.test.jsx`) goes red.
    pendingReason: (pine) => kill.runtimePendingReasonOf({ source: pine }),
    inspectSource: pineBox.inspectSource,
    memberPaneDefinition: paneDef.memberPaneDefinition,
    editorStatus: status.editorStatus,
    // the runtime lane's lists and THIS script's admission, as the script pane reads them: without
    // them the lane declines every script ("still being checked"), which would read as a refusal
    prepare: async (pine, admission = null) => {
      if (!gate.runtimePaneEnabled()) return
      try {
        const r = await fetch(kill.RUNTIME_KILL_PATH, { credentials: 'include', cache: 'no-store' })
        if (r && r.ok) kill.latchRuntimeLists(await r.json())
      } catch { /* the lists stay as they were: the lane fails closed */ }
      // ⭐ the verdict that came WITH the script is latched first, so the door is not asked at all
      latchAnswerAdmission(kill, pine, admission)
      if (kill.runtimeCapabilityAdmissionOn() && !kill.runtimeAdmissionOf({ source: pine })) {
        await kill.requestRuntimeAdmission(pine)
      }
    },
  }
}

/**
 * The transcript entry for a script answer: the ENGINE's verdict first, then its reasons, then
 * what the assistant said it wrote, labelled as the assistant's.
 */
export function scriptEntry({ script, reply, verdict, rounds = 0 }) {
  const lines = [verdict.headline, ...verdict.withheld, ...verdict.notes]
  const checking = isChecking(verdict)
  if (checking && PENDING_REASON_LINES[verdict.pendingReason]) lines.push(PENDING_REASON_LINES[verdict.pendingReason])
  // ⭐ "DRAWN WHEN THE BAR CLOSES" IS SAID HERE, WHERE THE LANE IS KNOWN. The server's detector says the script
  // reads where the chart ends; that only delays it on the bar-by-bar lane (`lane === 'runtime'`). A script
  // already WAITING on this chart says so in its headline, and one the engine refused has other news.
  if (script.waitsForTheBar === true && verdict.runs === true && verdict.lane === 'runtime' && verdict.waits !== true) {
    lines.push(WAITS_ON_A_LIVE_CHART_LINE)
  }
  if (checking) lines.push(STILL_CHECKING_LINE)
  else if (!verdict.runs && rounds > 0) {
    lines.push(`The assistant rewrote it ${rounds === 1 ? 'once' : `${rounds} times`} and the chart still does not run it fully.`)
  }
  return {
    role: 'uct', kind: 'script', lines, said: typeof reply === 'string' ? reply : '',
    script: {
      name: script.name || '', pine: script.pine, runs: verdict.runs, attaches: verdict.attaches, state: verdict.state,
      // (only when true: an entry that is not being checked is the shape it always was)
      ...(checking ? { checking: true } : {}),
    },
  }
}

/**
 * ⭐ A CHECK THAT HAS NOT FINISHED IS NOT A REFUSAL (found live 2026-11-19). The chart asks the server whether it
 * may draw a script bar by bar; under load the server answers "still being checked" for a few seconds, and the
 * run cannot start until it has an answer. The dock used to settle on that: "Still being checked on this chart"
 * was its last word on a script that was fine, beside a button that said "to fix it".
 * So a verdict that is only CHECKING is asked for again, a bounded number of times, before the answer settles;
 * and if it is still checking then, the entry says so and the button offers the editor without "to fix it".
 */
/** `api/services/pine_authoring.py::FINISHED_BARS_LINE`, word for word (`tests/test_script_conversation.py`). */
export const WAITS_ON_A_LIVE_CHART_LINE = "While the market is open this is not drawn: it appears once the chart's newest bar has finished, after the close."
export const PENDING_RECHECKS = 2
export const PENDING_RECHECK_MS = 3000
/**
 * ⭐ WHY IT IS STILL BEING CHECKED, in a member's words. The server's verdict door says why it cannot answer yet
 * (`pending_reason`; the engine keeps the last one per script, `runtimeKill.js::runtimePendingReasonOf`). A reason
 * with no line here is not said.
 *   busy      shared checking capacity is in use by other work: seconds
 *   starting  the checker is starting up: a few seconds
 *   paused    this script, or this account, is set aside after repeated checker failures: minutes. Asking again
 *             within the same answer cannot help, so the window does not (`settledVerdict`).
 */
export const PENDING_REASON_LINES = Object.freeze({
  busy: "UCT's script checker is busy with other work right now. This usually clears in a few seconds.",
  starting: "UCT's script checker is starting up. It should be ready in a few seconds.",
  paused: "UCT has set this script aside after its checker failed on it several times. Try again in a few minutes.",
})
/** Reasons after which re-checking within the same answer cannot help. */
export const PENDING_REASONS_THAT_END_THE_WAIT = Object.freeze(['paused'])

/** The verdict state of a script the window could not check at all (the engine did not load, a check threw). */
export const UNCHECKED_STATE = 'unchecked'
/** `runsHere.CHECKING_HEADLINE`, word for word (a copy: this module loads the engine only when a script arrives;
 *  `scriptAnswer.test.js` holds the two equal). */
export const STILL_CHECKING_HEADLINE = 'Still being checked on this chart'
export const STILL_CHECKING_LINE = 'The chart had not finished checking this script. Open it in the editor to see its status; nothing needs fixing.'
/** The editor panel's own line under "Still being checked on this chart" (`PineEditorStatus.jsx`). */
export const CHECKING_IN_THE_EDITOR_LINE = 'UCT has not finished checking whether it can draw this script bar by bar. Nothing needs fixing: this updates by itself when the check finishes.'
export const isChecking = (verdict) => !!verdict && verdict.runs !== true && verdict.checking === true
/** A pause that ends early once `cancelled()` is true (asked every quarter second). */
async function pause(ms, cancelled) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (typeof cancelled === 'function' && cancelled()) return
    await new Promise((resolve) => { setTimeout(resolve, Math.min(250, Math.max(0, end - Date.now()))) })
  }
}

/**
 * A script's verdict, asked again while the chart is still checking it.
 * ⛔ ONE BUDGET FOR THE WHOLE REQUEST (`budget.left`, review 2026-11-19): the first script and every repair draw
 * on the same `PENDING_RECHECKS`, so a slow server cannot multiply the wait by the number of repair rounds; and
 * a member who pressed Stop (or closed the window) is not kept waiting: `cancelled()` is asked before each
 * re-check and ends the pause.
 */
async function settledVerdict(check, script, { wait, budget, cancelled }) {
  // (the script itself rides along: its admission verdict came in the same answer, and is THIS script's only; and
  // `cancelled`, so a check waiting on a worker ends when the member presses Stop: a build nobody reads is stopped)
  let verdict = await check(script.pine, script, { cancelled })
  while (budget.left > 0 && isChecking(verdict) && !cancelled()) {
    if (PENDING_REASONS_THAT_END_THE_WAIT.includes(verdict.pendingReason)) break
    budget.left -= 1
    await wait(PENDING_RECHECK_MS, cancelled)
    if (cancelled()) break
    verdict = await check(script.pine, script, { cancelled })
  }
  return verdict
}

/** Is the button beside a script entry an invitation to FIX it? Only when the engine REFUSED it: not while it
 *  is being checked, and not when the window could not check it at all. */
export function scriptNeedsFixing(script) {
  return !!script && script.runs !== true && script.checking !== true && script.state !== UNCHECKED_STATE
}

/**
 * ONE SCRIPT ANSWER, CHECKED AND REPAIRED. Given the door's first script answer, runs the paste
 * path on it; while it does not run fully, sends the engine's refusal back and checks the repair,
 * up to `MAX_REPAIR_ROUNDS` and never past a repair that changes nothing.
 * @param {object} first              the door's answer: `{script: {name, pine}, reply}`
 * @param {(refusal) => Promise<object>} repair   asks the door again with `script_refusal`
 * @param {object} [deps]  `{ check, wait, cancelled }`: `wait(ms, cancelled)` is the pause before a re-check;
 *                         `cancelled()` true (Stop pressed, the window closed) ends the waiting and sends no more repairs
 * @returns {Promise<{entry: object, rounds: number, verdict: object}>}
 */
/** The default check: this window's engine, with the admission verdict the script's own answer carried. */
const checkWithItsAdmission = (pine, script, { cancelled } = {}) => checkScript(pine, { admission: script && script.admission, cancelled })

export async function settleScript(first, repair, { check = checkWithItsAdmission, wait = pause, cancelled = () => false } = {}) {
  const stopped = () => { try { return cancelled() === true } catch { return false } }
  const waiting = { wait, budget: { left: PENDING_RECHECKS }, cancelled: stopped }
  let answer = first
  let verdict = await settledVerdict(check, answer.script, waiting)
  let rounds = 0
  while (!verdict.runs && rounds < MAX_REPAIR_ROUNDS && !stopped()) {
    const refusal = refusalOf(answer.script.pine, verdict, rounds + 1)
    if (!refusal) break
    const next = await repair(refusal)
    if (!next || !next.ok || !next.script || typeof next.script.pine !== 'string') break
    rounds += 1
    const again = await settledVerdict(check, next.script, waiting)
    const stuck = sameRefusals(again, verdict) || next.script.pine === answer.script.pine
    answer = next
    verdict = again
    if (stuck) break
  }
  return { entry: scriptEntry({ script: answer.script, reply: answer.reply, verdict, rounds }), rounds, verdict }
}
