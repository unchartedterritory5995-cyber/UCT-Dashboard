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

/** Mark a phase of the current trace (no-op when none is open). */
export function mark(phase, detail = null) {
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
