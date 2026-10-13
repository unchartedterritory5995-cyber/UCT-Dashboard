// ── UCT Agent SESSION MEMORY (Gate C, owner 2026-10-13) ─────────────────────────────────────────────
//
// What the conversation has shown and done, so a follow-up can point at it: "open the third one",
// "compare it to the others", "put a 20 EMA on it", "make it a 9", "do the same on the right one".
//
// WRITTEN ONLY BY UCT, never by the model: a result set is recorded from the rows UCT itself showed
// (in the order the member saw them — never a re-run, which could reorder), a change from what the
// runtime actually committed, an indicator from the instance the mutation module reported.
//
// VALIDATED BEFORE USE, every time (agent/references.js): a chart ref must still be on the board in
// the same layout (board epoch), an indicator must still be on that chart, a result set must be
// fresh. Stale → a question or a plain refusal, never a silent target.
//
// RETENTION
//   result sets   the newest MAX_SETS, MAX_ITEMS tickers each, for MEMORY_TTL_MS (30 min)
//   subjects      the chart / indicator a change last touched; dropped when the board's layout
//                 changes (its refs belong to that board) or after MEMORY_TTL_MS
//   last change   the ops of the last successful plan (for "do the same …"), same rules as subjects
//   corrections   the member's last MAX_CORRECTIONS "no, I meant …" lines (context for the model)
//   cleared       on a new chat, a chat switch and a reload (session-only by design: nothing persists)
// Content-free toward the server: the model may receive tickers and labels from here, never values.

export const MEMORY_TTL_MS = 30 * 60 * 1000
export const MAX_SETS = 3
export const MAX_ITEMS = 50
export const MAX_CORRECTIONS = 5
/** How many of a set's tickers the model is shown (the rest stay local, by index). */
export const MODEL_ITEMS = 20

const upper = (s) => String(s || '').trim().toUpperCase()

export function createMemory({ now = () => Date.now() } = {}) {
  let sets = []                 // newest first: { id, source, label, symbols, at }
  let subjects = { chart: null, indicator: null }
  let last = null               // { ops: [{ action, args, target }], at, epoch }
  let corrections = []          // [{ said, at }]
  let seq = 0

  const fresh = (x) => !!x && now() - x.at <= MEMORY_TTL_MS
  const sameBoard = (x, epoch) => !!x && (x.epoch == null || epoch == null || x.epoch === epoch)

  return {
    /** Rows UCT showed, in display order. `symbols` must come from UCT (a table's ticker column). */
    noteResults({ source, label = null, symbols }) {
      const list = [...new Set((symbols || []).map(upper).filter(Boolean))].slice(0, MAX_ITEMS)
      if (!list.length) return null
      const set = { id: `s${++seq}`, source: String(source || ''), label: label ? String(label) : null, symbols: list, at: now() }
      sets = [set, ...sets.filter(s => fresh(s))].slice(0, MAX_SETS)
      return set
    },

    /** A committed change. `ops` carry their resolved target refs; `epoch` = the board it ran on. */
    noteChange({ ops, epoch = null, chartSymbol = null }) {
      const clean = (ops || []).filter(o => o?.action).map(o => ({ action: o.action, args: o.args || {}, target: o.target || null }))
      if (!clean.length) return
      last = { ops: clean, at: now(), epoch }
      const charts = [...new Set(clean.map(o => o.target).filter(t => typeof t === 'string'))]
      if (charts.length === 1) subjects.chart = { ref: charts[0], symbol: chartSymbol ? upper(chartSymbol) : null, at: now(), epoch }
    },

    /** The indicator a change added or edited (from the mutation module's own report). */
    noteIndicator({ chart, instanceId, defId = null, label = null, epoch = null }) {
      if (!chart || !instanceId) return
      subjects.indicator = { chart, instanceId: String(instanceId), defId, label, at: now(), epoch }
    },

    noteCorrection(said) {
      const s = String(said || '').trim()
      if (!s) return
      corrections = [{ said: s.slice(0, 200), at: now() }, ...corrections].slice(0, MAX_CORRECTIONS)
    },

    /** The newest fresh result set, or null. */
    latestResults() { return sets.find(s => fresh(s)) || null },
    resultSets() { return sets.filter(s => fresh(s)) },

    /** A subject, only while fresh AND on the same board (layout) it was recorded on. */
    subject(kind, epoch = null) {
      const s = subjects[kind]
      return fresh(s) && sameBoard(s, epoch) ? s : null
    },
    lastChange(epoch = null) { return fresh(last) && sameBoard(last, epoch) ? last : null },
    recentCorrections() { return corrections.filter(c => fresh(c)) },

    /** The board's layout changed: refs on the old board mean nothing now. Results (tickers) stay. */
    boardChanged() { subjects = { chart: null, indicator: null }; last = null },
    forgetIndicator() { subjects.indicator = null },
    clear() { sets = []; subjects = { chart: null, indicator: null }; last = null; corrections = [] },

    /** What the MODEL may see: result sets (first MODEL_ITEMS tickers, in order), the last change's
     *  action names, and corrections. No values, no chart settings. */
    forModel() {
      const rs = sets.filter(s => fresh(s)).map((s, i) => ({
        set: i === 0 ? 'latest' : `previous_${i}`, source: s.source, label: s.label,
        count: s.symbols.length, symbols_in_order: s.symbols.slice(0, MODEL_ITEMS),
      }))
      const out = {}
      if (rs.length) out.recent_results = rs
      if (fresh(last)) out.last_change = last.ops.map(o => o.action)
      if (fresh(subjects.chart)) out.subject_chart = subjects.chart.ref
      const cs = corrections.filter(c => fresh(c)).map(c => c.said)
      if (cs.length) out.recent_corrections = cs
      return Object.keys(out).length ? out : null
    },
  }
}

/** The tickers of a query answer's table, in display order, or null (a table with no ticker column). */
export function tickersOfAnswer(a) {
  const t = a?.table
  if (!t || !Array.isArray(t.rows) || !t.rows.length) return null
  const col = (t.columns || []).find(c => c?.key === 'ticker' || c?.key === 'symbol' || c?.key === 'sym')
  if (!col) return null
  const syms = t.rows.map(r => r?.[col.key]).filter(v => typeof v === 'string' && /^[A-Za-z0-9.^$:_\-/]{1,24}$/.test(v))
  return syms.length ? syms : null
}
