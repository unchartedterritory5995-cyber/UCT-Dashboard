// app/src/components/chart/builder/pineEditor/authoringDiagnostics.js
//
// ─── WHAT THE MEMBER DOOR SAID ABOUT A SCRIPT, AS A PROBLEMS LIST ───────────
//
// The Pine Editor compiles a member's script through `memberPaneDefinition` —
// the SAME build `MemberPane` draws and the attach button saves — and this
// module turns that one result into the list the editor renders: every refusal
// with its line, column and token, then the disclosures the document carries.
//
// ⛔⛔ IT IS THE PANE DOOR'S VERDICT, NOT THE SCREENER'S. `PineBox`'s paste box
// shows `inspectSource`, which translates for a SCREEN (one column, non-strict).
// A script can pass that and still be refused by the pane door, or the other
// way round — and the pane door is the one "Apply to chart" goes through. An
// editor whose problems list came from a different door than its Apply button
// would be a second authority over "does my script work".
//
// ⛔ EVERY SENTENCE IS THE DOOR'S, VERBATIM. Nothing here writes a reason; it
// only collects, de-duplicates, orders and STAMPS. The stamp (`source`) is the
// contract `CodeEditor` gates its gutter mark on: a refusal is marked only on
// the exact text it was measured against, so a stale one can never underline
// the wrong token under the right sentence.
//
// ⚠️ THE FIELDS ARE `pine.js`'s, measured on this branch (2026-10-04) through
// `memberPaneDefinition`: `translation.refusal` / `translation.refusals[]` and
// each `translation.outputs[i].refusal` carry `{guard, message, line, column,
// token, excerpt}`; the gate's own `reason`/`guard` may carry no position at
// all ("this script declares nothing a chart can draw").

/** Severity order: what stops the script first, then what it draws without. */
const RANK = Object.freeze({ error: 0, warning: 1, info: 2 })

const isPos = (n) => Number.isInteger(n) && n > 0

/** One refusal-shaped object → one list item, or null when it says nothing. */
function itemOf(r, severity, source) {
  if (!r || typeof r !== 'object') return null
  const message = typeof r.message === 'string' && r.message.trim() ? r.message
    : (typeof r.reason === 'string' && r.reason.trim() ? r.reason : null)
  if (!message) return null
  return {
    severity,
    guard: typeof r.guard === 'string' && r.guard ? r.guard : null,
    message,
    line: isPos(r.line) ? r.line : null,
    column: isPos(r.line) && isPos(r.column) ? r.column : null,
    token: typeof r.token === 'string' && r.token ? r.token : null,
    excerpt: typeof r.excerpt === 'string' && r.excerpt ? r.excerpt : null,
    // ⛔ THE STAMP — see the header. Every item, no exceptions.
    source,
  }
}

const keyOf = (it) => `${it.guard || ''}|${it.line || ''}|${it.column || ''}|${it.message}`

/**
 * @param {object|null} built  `memberPaneDefinition(...)`'s result
 * @param {string} source      the exact text that build was run on
 * @returns {{state: 'empty'|'ok'|'refused', items: object[], primary: object|null,
 *            drawn: number, saveable: boolean}}
 *   `primary` is the first item with a line — the one the editor gutter marks.
 */
export function authoringDiagnostics(built, source) {
  const text = typeof source === 'string' ? source : ''
  if (!text.trim() || !built) {
    return { state: 'empty', items: [], primary: null, drawn: 0, saveable: false }
  }
  const t = built.translation || null
  const ok = built.ok === true
  // ⭐ A ROW REFUSAL ON A SCRIPT THE DOOR ACCEPTED IS A WARNING: the rest draws,
  // that output does not. On a refused script it is part of the reason.
  const rowSeverity = ok ? 'warning' : 'error'

  const seen = new Set()
  const items = []
  const push = (it) => {
    if (!it) return
    const k = keyOf(it)
    if (seen.has(k)) return
    seen.add(k)
    items.push(it)
  }

  if (t && !ok) {
    push(itemOf(t.refusal, 'error', text))
    for (const r of (Array.isArray(t.refusals) ? t.refusals : [])) push(itemOf(r, 'error', text))
  }
  for (const o of ((t && Array.isArray(t.outputs)) ? t.outputs : [])) {
    if (o && o.refusal) push(itemOf(o.refusal, rowSeverity, text))
  }
  // ⛔ THE GATE'S OWN SENTENCE, WHEN NO TRANSLATOR REFUSAL ALREADY SAYS IT. A
  // refused build ALWAYS shows at least one item — a red state with an empty
  // list is the one outcome this module exists to prevent.
  if (!ok) {
    const reason = typeof built.reason === 'string' ? built.reason : ''
    const said = items.some((it) => it.message === reason)
    if (reason && !said) push(itemOf({ message: reason, guard: built.guard }, 'error', text))
    if (!items.some((it) => it.severity === 'error')) {
      push(itemOf({ message: 'the member door refused this script', guard: built.guard }, 'error', text))
    }
  }
  // ⭐ THE DISCLOSURES THE DOCUMENT CARRIES (`{name, note}`), worded where they
  // are minted (`memberPaneDefinition`). Information, not problems.
  for (const n of ((ok && Array.isArray(built.notes)) ? built.notes : [])) {
    if (n && typeof n.note === 'string') push(itemOf({ message: n.note }, 'info', text))
  }

  // Stable sort: severity, then line (positionless last within a severity).
  const order = items.map((it, i) => [it, i])
  order.sort(([a, i], [b, j]) => (RANK[a.severity] - RANK[b.severity])
    || ((a.line ?? Infinity) - (b.line ?? Infinity))
    || ((a.column ?? 0) - (b.column ?? 0))
    || (i - j))
  const sorted = order.map(([it]) => it)
  const primary = sorted.find((it) => it.severity !== 'info' && it.line != null) || null
  const drawn = ok && built.definition && Array.isArray(built.definition.plots)
    ? built.definition.plots.filter((p) => p && !p.hidden).length : 0
  return {
    state: ok ? 'ok' : 'refused',
    items: sorted,
    primary,
    drawn,
    saveable: ok && built.saveable !== false,
  }
}

/** A 1-based line and column → a character offset into `text`, clamped. The
 *  convention `pine.js`'s lexer reports in (`i - lineStart + 1`). */
export function offsetOf(text, line, column) {
  const s = typeof text === 'string' ? text : ''
  if (!isPos(line)) return 0
  let at = 0
  for (let l = 1; l < line; l += 1) {
    const nl = s.indexOf('\n', at)
    if (nl < 0) return s.length
    at = nl + 1
  }
  const eol = s.indexOf('\n', at)
  const end = eol < 0 ? s.length : eol
  const col = isPos(column) ? column : 1
  return Math.min(at + col - 1, end)
}

/**
 * ⭐⭐ A7 — WHICH LANE WILL DRAW IT, OR WHY NONE WILL: the status line.
 *
 * Read off the member door's OWN answer (`memberPaneDefinition`), never
 * re-derived: `lane: 'runtime'` is the per-bar lane's document; an accepted
 * document without it is the host lane's (and `objectsRun` says whether its
 * drawings come from a per-bar run); a refusal is the door's `reason`,
 * verbatim, with the per-bar lane's own `runtimeDeclined.why` when that lane
 * was asked and declined.
 *
 * @param {object|null} built the `memberPaneDefinition` result for the settled text
 * @returns {{lane: 'runtime'|'host'|'none', text: string}|null}
 */
export function laneStatus(built) {
  if (!built) return null
  const declined = built.runtimeDeclined && typeof built.runtimeDeclined.why === 'string'
    ? built.runtimeDeclined.why : null
  if (built.ok && built.lane === 'runtime') {
    const withheld = Array.isArray(built.withheld) && built.withheld.length
      ? ` Not drawn from it: ${built.withheld.join(', ')}.` : ''
    return {
      lane: 'runtime',
      text: `Drawn by the per-bar lane — the script runs bar by bar, as TradingView runs it.${withheld}`,
    }
  }
  if (built.ok) {
    let objects = ''
    if (built.objectsRun === 'served') objects = ' Its drawings come from a per-bar run of the script.'
    else if (typeof built.objectsRun === 'string') objects = ` Its drawings are not drawn (the per-bar run declined: ${built.objectsRun}).`
    const also = declined ? ` The per-bar lane declined this script: ${declined}` : ''
    return {
      lane: 'host',
      text: `Drawn by the host lane — translated into the engine's own columns.${objects}${also}`,
    }
  }
  const reason = typeof built.reason === 'string' && built.reason.trim() ? built.reason : 'the member door refused it'
  const tail = declined && !reason.includes(declined) ? ` The per-bar lane declined it too: ${declined}` : ''
  return { lane: 'none', text: `Not drawn: ${reason}.${tail}` }
}
