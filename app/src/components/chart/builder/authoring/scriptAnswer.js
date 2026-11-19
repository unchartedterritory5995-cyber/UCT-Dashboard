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
 * @param {object} [deps]  injectable for tests: `{ load }` returns the engine modules
 */
export async function checkScript(pine, { load = loadEngine, chart = null } = {}) {
  try {
    const { inspectSource, memberPaneDefinition, editorStatus, prepare, runHereWhenLanded, verdictOnChart } = await load()
    await prepare(pine)
    const report = inspectSource(pine, 'pine')
    const pane = memberPaneDefinition({ source: pine, id: SCRIPT_CHECK_ID, name: 'script' })
    const pasted = verdictFrom(editorStatus({ report, pane, savedRow: null, inspectedSource: pine }), pane)
    // ⭐⭐ 2026-11-19 -- "RUNS" MEANS IT RAN. The status above is decided before any bar is computed, and
    // says "runs" for scripts the engine refuses when it runs them (a value kept since the first bar on
    // a chart that does not reach the listing, a clock read, a loop past its limit). So a script the
    // paste check passes is RUN on the chart's own bars and context (`builder/runsHere.js`, the one
    // authority both doors use), and the run can only take "runs" away. A run that stopped goes back
    // to the assistant with the engine's own sentence, like any refusal. With no chart to run on
    // (an older caller, a chart still loading) the verdict is the paste check's, marked as such.
    if (!pasted.runs || !chart || typeof runHereWhenLanded !== 'function') return pasted
    const run = await runHereWhenLanded(pane, chart, { timeoutMs: RUN_WAIT_MS })
    return verdictOnChart(pasted, run, SCRIPT_REFUSAL_LIMITS)
  } catch {
    return { runs: false, attaches: false, state: 'unchecked', lane: 'host', headline: 'This script could not be checked here',
      withheld: [], notes: [], errors: [] }
  }
}

/** How long the dock waits for a run handed to a worker before saying "still being checked". */
export const RUN_WAIT_MS = 8000

/** The definition id a script is checked under (never stored, never installed). */
export const SCRIPT_CHECK_ID = 'u_script_check'

/** The engine modules, loaded on first use, and what must be read before a script is judged. */
async function loadEngine() {
  const [pineBox, paneDef, status, kill, gate, here] = await Promise.all([
    import('../PineBox'), import('../memberPane/memberPaneDefinition'), import('../editorStatus'),
    import('../../engine/runtimeKill'), import('../../engine/runtimePaneGate'), import('../runsHere'),
  ])
  return {
    runHereWhenLanded: here.runHereWhenLanded,
    verdictOnChart: here.verdictOnChart,
    inspectSource: pineBox.inspectSource,
    memberPaneDefinition: paneDef.memberPaneDefinition,
    editorStatus: status.editorStatus,
    // the runtime lane's lists and THIS script's admission, as the script pane reads them: without
    // them the lane declines every script ("still being checked"), which would read as a refusal
    prepare: async (pine) => {
      if (!gate.runtimePaneEnabled()) return
      try {
        const r = await fetch(kill.RUNTIME_KILL_PATH, { credentials: 'include', cache: 'no-store' })
        if (r && r.ok) kill.latchRuntimeLists(await r.json())
      } catch { /* the lists stay as they were: the lane fails closed */ }
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
  if (!verdict.runs && rounds > 0) {
    lines.push(`The assistant rewrote it ${rounds === 1 ? 'once' : `${rounds} times`} and the chart still does not run it fully.`)
  }
  return {
    role: 'uct', kind: 'script', lines, said: typeof reply === 'string' ? reply : '',
    script: { name: script.name || '', pine: script.pine, runs: verdict.runs, attaches: verdict.attaches, state: verdict.state },
  }
}

/**
 * ONE SCRIPT ANSWER, CHECKED AND REPAIRED. Given the door's first script answer, runs the paste
 * path on it; while it does not run fully, sends the engine's refusal back and checks the repair,
 * up to `MAX_REPAIR_ROUNDS` and never past a repair that changes nothing.
 * @param {object} first              the door's answer: `{script: {name, pine}, reply}`
 * @param {(refusal) => Promise<object>} repair   asks the door again with `script_refusal`
 * @param {object} [deps]  `{ check }` for tests
 * @returns {Promise<{entry: object, rounds: number, verdict: object}>}
 */
export async function settleScript(first, repair, { check = checkScript } = {}) {
  let answer = first
  let verdict = await check(answer.script.pine)
  let rounds = 0
  while (!verdict.runs && rounds < MAX_REPAIR_ROUNDS) {
    const refusal = refusalOf(answer.script.pine, verdict, rounds + 1)
    if (!refusal) break
    const next = await repair(refusal)
    if (!next || !next.ok || !next.script || typeof next.script.pine !== 'string') break
    rounds += 1
    const again = await check(next.script.pine)
    const stuck = sameRefusals(again, verdict) || next.script.pine === answer.script.pine
    answer = next
    verdict = again
    if (stuck) break
  }
  return { entry: scriptEntry({ script: answer.script, reply: answer.reply, verdict, rounds }), rounds, verdict }
}
