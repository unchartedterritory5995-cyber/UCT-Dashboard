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

// ── WORKING SIGNAL: is a website write in flight right now? ───────────────────────────────────
// Read from the same marks as the trace, so the panel header shows real execution, never a guess. It
// lives outside the trace: mark() always reaches it, with or without an open trace or turn. A commit
// runs through its 'persist' mark (the write AND the save that follows it; Undo's save runs in useAgent.js,
// after 'undo:end'). A throw skips that mark, so traceEnd() and turnEnd() (both in a finally) clear it too.
const WORK_STARTS = new Set(['commit:start', 'undo:start'])
const WORK_ENDS = new Set(['persist', 'undo:end'])
let working = false
const workingSubs = new Set()
function setWorking(next) {
  if (working === next) return
  working = next
  for (const fn of workingSubs) { try { fn() } catch { /* a status reader never breaks a write */ } }
}
export const isWorking = () => working
export function subscribeWorking(fn) {
  workingSubs.add(fn)
  return () => { workingSubs.delete(fn) }
}

/** Mark a phase of the current trace (no-op when none is open). Also marks the open TURN. */
export function mark(phase, detail = null) {
  if (WORK_STARTS.has(phase)) setWorking(true)
  else if (WORK_ENDS.has(phase)) setWorking(false)
  turnMark(phase, detail)
  if (!cur) return
  cur.marks.push(detail == null ? [phase, Math.round(now() - cur.t0)] : [phase, Math.round(now() - cur.t0), detail])
}

export function traceEnd(outcome) {
  setWorking(false)
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
  turn = { kind, id: newTurnId(), path: null, t0: now(), visible: null, output: null, outputRole: null, done: null, marks: [] }
  turns.push(turn)
  if (turns.length > TURNS_KEEP) turns.shift()
  return true
}
// PROGRAM MD-1: an opaque id for the open turn — the market-data gateway's per-turn budget key
// (readData(kind, params, { turnId: currentTurnId() })). Random and content-free; null when no turn is open.
let turnSeq = 0
function newTurnId() {
  try { if (globalThis.crypto?.randomUUID) return `t-${globalThis.crypto.randomUUID()}` } catch { /* fall through */ }
  turnSeq += 1
  return `t-${Date.now().toString(36)}-${turnSeq}`
}
export const currentTurnId = () => (turn ? turn.id : null)
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
  // a User Timing measure of the Agent's OWN time to its first useful output (path + role, never content): readable in a
  // profiler and by a test that must not count render, polling or the queue around the turn
  try { performance.measure(`uct-agent:output:${turn.path || 'none'}:${role}`, { start: turn.t0, end: now() }) } catch { /* no User Timing */ }
}
/** ms from the start of the open turn to the first mark of `phase` (null when none yet / no turn). */
export function turnMarkMs(phase) {
  const m = turn?.marks.find(x => x[0] === phase)
  return m ? m[1] : null
}
/** ms from the start of the open turn to its first useful output (null when none yet / no turn). */
export const turnOutputMs = () => (turn && turn.output != null ? turn.output : null)
export function turnEnd() {
  setWorking(false)
  if (!turn) return
  turn.done = since(turn)
  turn = null
}
export const lastTurns = () => turns.map(t => ({ ...t, marks: t.marks.slice() }))
export const _resetTurns = () => { turns.length = 0; turn = null }

if (typeof window !== 'undefined') window.__uctAgentTurns = lastTurns
