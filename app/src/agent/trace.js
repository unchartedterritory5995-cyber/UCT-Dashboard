// ── UCT Agent APPLY TRACE: where an Apply's time goes ───────────────────────
//
// A few timestamps per Apply (phase name + ms since the Apply began), kept in
// memory only — the last ten Applies, readable from the console as
// `window.__uctAgentTrace()` on an admin's /charts. Nothing is sent anywhere and
// nothing here changes behavior; a mark costs one performance.now().

const KEEP = 10
const traces = []
let cur = null

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())

/** Start a new trace (an Apply / a model-free execution). */
export function traceStart(label) {
  cur = { label, t0: now(), marks: [] }
  traces.push(cur)
  if (traces.length > KEEP) traces.shift()
}

/** Mark a phase of the current trace (no-op when none is open). Also marks the open TURN. */
export function mark(phase, detail = null) {
  turnMark(phase, detail)
  if (!cur) return
  cur.marks.push(detail == null ? [phase, Math.round(now() - cur.t0)] : [phase, Math.round(now() - cur.t0), detail])
}

export function traceEnd(outcome) {
  if (!cur) return
  mark(`end:${outcome}`)
  cur = null
}

export const lastTraces = () => traces.map(t => ({ label: t.label, marks: t.marks.slice() }))

if (typeof window !== 'undefined') window.__uctAgentTrace = lastTraces

// ── TURN TRACE: one member action (a message, an Apply / Undo / choice click), end to end ─────────
//
//   visible  first visible feedback (the member's line + "UCT Agent is typing…" rendered)
//   output   first USEFUL output (an answer, receipt, proposal, question or refusal pushed)
//   done     the panel is idle again
//
// Phase names, timings and the path only — never the member's words, a reply or a value. Memory
// only (`window.__uctAgentTurns()`); `turnOutputMs()` feeds the content-free telemetry row the
// browser already records (agent_telemetry.latency_ms on a local / fast turn).
const TURNS_KEEP = 20
const turns = []
let turn = null
const since = (t) => Math.round(now() - t.t0)

/** Start a turn (no-op while one is open: an Apply typed as "do it" stays inside its message's turn). */
export function turnStart(kind) {
  if (turn) return false
  turn = { kind, path: null, t0: now(), visible: null, output: null, outputRole: null, done: null, marks: [] }
  turns.push(turn)
  if (turns.length > TURNS_KEEP) turns.shift()
  return true
}
export function turnPath(path) { if (turn && !turn.path) turn.path = path }
export function turnMark(phase, detail = null) {
  if (!turn) return
  turn.marks.push(detail == null ? [phase, since(turn)] : [phase, since(turn), detail])
}
export function turnVisible() { if (turn && turn.visible == null) turn.visible = since(turn) }
export function turnOutput(role) {
  if (!turn || turn.output != null) return
  turn.output = since(turn)
  turn.outputRole = role
}
/** ms from the start of the open turn to its first useful output (null when none yet / no turn). */
export const turnOutputMs = () => (turn && turn.output != null ? turn.output : null)
export function turnEnd() {
  if (!turn) return
  turn.done = since(turn)
  turn = null
}
export const lastTurns = () => turns.map(t => ({ ...t, marks: t.marks.slice() }))
export const _resetTurns = () => { turns.length = 0; turn = null }

if (typeof window !== 'undefined') window.__uctAgentTurns = lastTurns
