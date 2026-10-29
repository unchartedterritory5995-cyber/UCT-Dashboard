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
//   last change   the ops of the last successful plan (for "do the same …"), same rules as subjects,
//                 with the id of ITS Undo entry (null when it had none); undoing that entry forgets it
//   corrections   the member's last MAX_CORRECTIONS "no, I meant …" lines (context for the model)
//   last turn     ⭐ PHASE 2: every step ONE member message committed (a request runs its indicator changes as
//                 separate steps), in order — what "do the same on the other charts" repeats
//                 (agent/conversation.js). Same rules as subjects; undoing a step drops exactly that step.
//   indicators    ⭐ PHASE 2: the indicators the latest turn that ADDED or EDITED any added / edited, in order —
//                 what "the first one", "those", "the fast one" point at. A later turn that only restyles them
//                 keeps the set ("make the first one green" → "make the second one red"). Every use re-checks
//                 that each one is still on its chart (agent/conversation.js).
//   cleared       on a new chat, a chat switch and a reload (session-only by design: nothing persists)
// Content-free toward the server: the model may receive tickers and labels from here, never values.

export const MEMORY_TTL_MS = 30 * 60 * 1000
export const MAX_SETS = 3
export const MAX_ITEMS = 50
export const MAX_CORRECTIONS = 5
/** At most this many steps / indicators are kept for one turn (a compound request is bounded far below). */
export const MAX_TURN_STEPS = 24
/** How many of the last turn's indicators the model is shown (conversation_memory.recent_indicators). */
export const MODEL_INDICATORS = 8
/** How many of a set's tickers the model is shown (the rest stay local, by index). */
export const MODEL_ITEMS = 20

const upper = (s) => String(s || '').trim().toUpperCase()

export function createMemory({ now = () => Date.now() } = {}) {
  let sets = []                 // newest first: { id, source, label, symbols, at }
  let subjects = { chart: null, indicator: null }
  let last = null               // { ops: [{ action, args, target }], at, epoch, undoId }
  let corrections = []          // [{ said, at }]
  let turn = null               // ⭐ PHASE 2: { id, steps: [{ ops, undoId }], at, epoch }
  let turnId = 0                // the member message now being answered (`beginTurn`)
  let indSet = null             // ⭐ PHASE 2: { turn, list: [{ chart, instanceId, defId, label }], at, epoch }
  let pick = null               // ⭐ PHASE 2: the referents the last follow-up acted on ("the other one")
  let ment = null               // ⭐ PHASE 2: { turn, list, at, epoch } — every indicator the latest turn acted on
  let seq = 0
  let visit = null              // the host's layout-visit count when memory last looked (`seeBoard`)

  const fresh = (x) => !!x && now() - x.at <= MEMORY_TTL_MS
  const sameBoard = (x, epoch) => !!x && (x.epoch == null || epoch == null || x.epoch === epoch)
  const dropBoard = () => { subjects = { chart: null, indicator: null }; last = null; turn = null; indSet = null; pick = null; ment = null }

  return {
    /** Rows UCT showed, in display order. `symbols` must come from UCT (a table's ticker column). */
    noteResults({ source, label = null, symbols }) {
      const list = [...new Set((symbols || []).map(upper).filter(Boolean))].slice(0, MAX_ITEMS)
      if (!list.length) return null
      const set = { id: `s${++seq}`, source: String(source || ''), label: label ? String(label) : null, symbols: list, at: now() }
      sets = [set, ...sets.filter(s => fresh(s))].slice(0, MAX_SETS)
      return set
    },

    /** A committed change. `ops` carry their resolved target refs; `epoch` = the board it ran on;
     *  `undoId` = the id of the Undo entry that reverses exactly this change (null: it has none). */
    noteChange({ ops, epoch = null, chartSymbol = null, undoId = null }) {
      const clean = (ops || []).filter(o => o?.action).map(o => ({ action: o.action, args: o.args || {}, target: o.target || null }))
      if (!clean.length) return
      last = { ops: clean, at: now(), epoch, undoId: undoId || null }
      // ⭐ PHASE 2: the steps of ONE member message are one turn ("add the 9 and 20" commits two steps)
      if (!turn || turn.id !== turnId || !sameBoard(turn, epoch)) turn = { id: turnId, steps: [], at: now(), epoch }
      if (turn.steps.length < MAX_TURN_STEPS) turn.steps.push({ ops: clean, undoId: undoId || null })
      turn.at = now()
      const charts = [...new Set(clean.map(o => o.target).filter(t => typeof t === 'string'))]
      // ⛔ P2-B F10: a change on SEVERAL charts leaves no single subject — "it" afterwards is a question,
      // never the chart an EARLIER change happened to leave behind
      if (charts.length === 1) subjects.chart = { ref: charts[0], symbol: chartSymbol ? upper(chartSymbol) : null, at: now(), epoch }
      else if (charts.length > 1) subjects.chart = null
    },

    /** An Undo entry was reversed. If it was the last change's, that change is no longer "the last
     *  change": "do the same …" and a correction must not repeat or reverse it again. */
    noteUndone(undoId) {
      if (undoId && last && last.undoId === undoId) last = null
      if (undoId && turn) {
        turn.steps = turn.steps.filter(s => s.undoId !== undoId)
        if (!turn.steps.length) turn = null
      }
    },

    /** ⭐ PHASE 2: a new member message is being answered — its committed steps form one turn. */
    beginTurn() { turnId += 1; return turnId },

    /** The indicator a change added or edited (from the mutation module's own report). */
    noteIndicator({ chart, instanceId, defId = null, label = null, epoch = null }) {
      if (!chart || !instanceId) return
      subjects.indicator = { chart, instanceId: String(instanceId), defId, label, at: now(), epoch }
      // …and, in order, as one of the indicators THIS turn added or edited (a new turn starts a new set)
      if (!indSet || indSet.turn !== turnId) { indSet = { turn: turnId, list: [], at: now(), epoch }; pick = null }
      if (indSet.list.length < MAX_TURN_STEPS && !indSet.list.some(i => i.chart === chart && i.instanceId === String(instanceId))) {
        indSet.list.push({ chart, instanceId: String(instanceId), defId, label })
      }
      indSet.at = now()
    },
    /** ⭐ PHASE 2: the indicators the latest adding / editing turn touched, in order (fresh, same board) | null. */
    indicatorSet(epoch = null) { return fresh(indSet) && sameBoard(indSet, epoch) && indSet.list.length ? indSet.list : null },
    /** ⭐ PHASE 2: an indicator the CURRENT turn acted on in any way (a colour, a pane, an add) — "those" in a copy. */
    noteMention({ chart, instanceId, epoch = null }) {
      if (!chart || !instanceId) return
      if (!ment || ment.turn !== turnId) ment = { turn: turnId, list: [], at: now(), epoch }
      if (ment.list.length < MAX_TURN_STEPS && !ment.list.some(i => i.chart === chart && i.instanceId === String(instanceId))) ment.list.push({ chart, instanceId: String(instanceId) })
      ment.at = now()
    },
    mentioned(epoch = null) { return fresh(ment) && sameBoard(ment, epoch) && ment.list.length ? ment.list : null },
    /** ⭐ PHASE 2: which of them the last follow-up acted on (instance ids) — "the other one" is then the rest. */
    notePick(ids) { pick = Array.isArray(ids) && ids.length ? { ids: ids.map(String), at: now() } : null },
    lastPick() { return fresh(pick) ? pick.ids : null },

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
    /** ⭐ PHASE 2: the last turn's committed steps, flattened → { ops, indicators, charts, undoIds } | null. */
    lastTurn(epoch = null) {
      if (!fresh(turn) || !sameBoard(turn, epoch) || !turn.steps.length) return null
      const ops = turn.steps.flatMap(s => s.ops)
      const charts = [...new Set(ops.map(o => o.target).filter(t => typeof t === 'string'))]
      return { ops, charts, undoIds: turn.steps.map(s => s.undoId).filter(Boolean) }
    },
    recentCorrections() { return corrections.filter(c => fresh(c)) },

    /** The board's layout changed: refs on the old board mean nothing now. Results (tickers) stay. */
    boardChanged() { dropBoard() },
    /** The host's layout-visit count (host `boardVisit`). If it moved since memory last looked, a layout
     *  was opened in between (A → B → A included): the board's refs are dropped, as `boardChanged`. */
    seeBoard(n) {
      if (n == null) return
      if (visit != null && n !== visit) dropBoard()
      visit = n
    },
    forgetIndicator() { subjects.indicator = null },
    clear() { sets = []; subjects = { chart: null, indicator: null }; last = null; corrections = []; turn = null; indSet = null; pick = null; ment = null },

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
      // ⭐ PHASE 2: the indicators the last turn added or edited, in order ("the first one", "those", "the fast
      // one"): their chart ref (mapped to the model's ref by the caller), instance id and legend name. No values.
      const inds = fresh(indSet) ? indSet.list.slice(0, MODEL_INDICATORS) : []
      if (inds.length) out.recent_indicators = inds.map(i => ({ chart: i.chart, id: i.instanceId, name: i.label || null }))
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
