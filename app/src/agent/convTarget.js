// ── CONVERSATIONAL TARGETING (pl-exec, owner product decision 2026-11-07) ──────────────────────────────────────────────
// "Change NVDA to daily." → "Add RSI." → "Make it green." all act on NVDA: the chart the last committed change acted on stays
// the conversation's target until the member redirects. THE RULE, precisely:
//   1. After a change commits on exactly ONE chart — or a request (a question too) names exactly one chart and changes none —
//      that chart is the conversational target, stamped with the member's click as it stood when the request was sent (the
//      host's click token: every pointer-down on a chart is a new token, a re-click included). A change on SEVERAL charts makes
//      the conversation about several: a bare follow-up then asks (rule 4). A created widget, a new layout / new chat / 30 min
//      end it.
//   2. On the next request, while NO NEW CLICK has happened since that stamp, the conversational target stands in for the click
//      for the whole turn: whatever reads "the clicked chart" (the fast path, the model's context `selected`, deixis, the
//      relative / negation / per-clause rules, "the other one", "it", "that one") reads the target instead. A request that names
//      another chart (a ticker, a position, an ordinal, a description, a relation) is a redirect, and what it says after the name
//      belongs to that chart: no override — unless it ALSO points at the conversation ("add rsi to it and to the TSLA chart").
//   3. A click AFTER the stamp is a redirect: the click is the target again (rule 2 does not apply), so "this one" or a bare
//      follow-up right after a click acts on the click.
//   4. "this" / "this one" / "here" points at the clicked chart, an old click too: explicit words win, so no override.
//      Ask only on a genuine conflict: after a change on several charts, a bare follow-up with no click since is read with NO
//      click, so the panel asks which chart (never a silent pick of one of them, nor of an old click).
// The override is turn-scoped (`begin` → restore in finally) and never persists; the click itself is never changed.
import { getCapability } from './capabilities'
import { chartsNamedBy } from './deixis'

const THIS_WORD = /\b(?:this|here)\b/i
// words that point at the conversation's chart itself
const CONV_POINTER = /\b(?:it|that one|that chart|the same chart|same one)\b/i

/** The member's click as a token: the host's own click token when it has one, else the clicked chart's ref. */
export function clickToken(host) {
  try {
    const c = host?.charts
    if (typeof c?.clickToken === 'function') return c.clickToken() ?? null
    return (c?.realSelected || c?.selected)?.call(c) ?? null
  } catch { return null }
}

const chartRefs = (host) => { try { return (host?.charts?.list?.() || []).map(c => c.ref) } catch { return [] } }

/** The chart this turn reads as "the click" instead of the member's own click, or undefined (no override). null = no click. */
export function turnSelection(host, memory, epoch, text) {
  const conv = memory?.convTarget?.(epoch)
  if (!conv) return undefined
  const refs = chartRefs(host)
  if (refs.length < 2 || (!conv.multi && !refs.includes(conv.ref))) return undefined
  if (conv.click !== clickToken(host)) return undefined                       // rule 3: clicked since
  let sel = null
  try { sel = (host.charts.realSelected || host.charts.selected)?.call(host.charts) ?? null } catch { sel = null }
  if (!conv.multi && sel === conv.ref) return undefined                       // the click is the target already
  const words = String(text || '')
  if (THIS_WORD.test(words)) return undefined                                 // rule 4: "this" is the click, explicit words win
  // an explicit reference to another chart redirects the request, and what it says after the name ("same on the left but
  // weekly") belongs to that chart: no override — unless it also points at the conversation's own chart ("it")
  let charts = []
  try { charts = host.charts.list() || [] } catch { charts = [] }
  const named = [...chartsNamedBy(words, charts, sel)]
  if (named.length) {
    if (conv.multi) return undefined
    if (named.every(r => r === conv.ref) || CONV_POINTER.test(words)) return conv.ref
    return undefined
  }
  return conv.multi ? null : conv.ref
}

// the member's click as it stood when they SENT the request: a change is stamped with it (a commit settles later, and a click
// made while it settles is a new click, never part of that request)
const TURN_CLICK = new WeakMap()
const CREATED_IN = new WeakMap()          // memory → the request (turn id) that created a widget
const COMMITTED_IN = new WeakMap()        // memory → the last request (turn id) that committed a chart change
const NAMED_IN = new WeakMap()            // memory → { turn, ref, click }: the one chart a request named

/** Applies `turnSelection` to the host's chart source for one turn → a restore function (a no-op when nothing applies). */
export function beginTurnTarget(host, memory, epoch, text) {
  const turn = memory?.currentTurn?.() ?? null
  if (memory && typeof memory === 'object') {
    TURN_CLICK.set(memory, clickToken(host))
    // rule 1: a request that names exactly ONE chart makes it the target even when nothing changes ("what timeframe is the
    // NVDA chart on?" → "make it weekly"); a change it commits decides instead (noteTurnTarget)
    let one = null
    try { const n = [...chartsNamedBy(text, host?.charts?.list?.() || [], host?.charts?.selected?.() ?? null)]; one = n.length === 1 ? n[0] : null } catch { one = null }
    if (one) NAMED_IN.set(memory, { turn, ref: one, click: clickToken(host), epoch }); else NAMED_IN.delete(memory)
  }
  const ref = turnSelection(host, memory, epoch, text)
  const c = host?.charts
  const settle = () => {
    const n = memory ? NAMED_IN.get(memory) : null
    if (n && n.turn === turn && COMMITTED_IN.get(memory) !== turn && CREATED_IN.get(memory) !== turn) memory?.noteTarget?.({ ref: n.ref, click: n.click, epoch: n.epoch })
  }
  if (ref === undefined || !c) return settle
  const orig = { selected: c.selected, list: c.list, read: c.read }
  const mark = (s) => {
    if (!s || typeof s !== 'object') return s
    const { selected, ...rest } = s
    return s.ref === ref ? { ...rest, selected: true } : rest
  }
  c.realSelected = orig.selected
  c.selected = () => ref
  if (typeof orig.list === 'function') c.list = (...a) => (orig.list.apply(c, a) || []).map(mark)
  if (typeof orig.read === 'function') c.read = (...a) => mark(orig.read.apply(c, a))
  c.turnTarget = ref
  return () => { c.selected = orig.selected; c.list = orig.list; c.read = orig.read; delete c.turnTarget; delete c.realSelected; settle() }
}

/** A committed change → the conversational target (rule 1). `ops` carry chart refs (rememberChange's `clean`). Ops on no
 *  chart (an alert's list, the board) leave it as it was; a change that created a widget ends it. */
export function noteTurnTarget(host, memory, epoch, ops, created = null) {
  try {
    // a change that CREATED a widget: what follows is about the new one (the created-chart readers), never a stamped old chart
    // (a request whose steps commit one by one: a create in ANY step of it ends the target for the whole request)
    const turn = memory?.currentTurn?.() ?? null
    if (created && Object.keys(created).length) { CREATED_IN.set(memory, turn); memory?.noteTarget?.(null); return }
    if (memory && CREATED_IN.get(memory) === turn && turn != null) return
    const live = new Set(chartRefs(host))
    const charts = [...new Set((ops || []).map(o => o?.target).filter(t => typeof t === 'string' && live.has(t)))]
    // an alert names its chart by symbol: the chart showing it, when exactly one does
    if (!charts.length) {
      const syms = [...new Set((ops || []).filter(o => getCapability(o?.action)?.target !== 'chart').map(o => String(o?.args?.symbol || '').toUpperCase()).filter(Boolean))]
      if (syms.length === 1) {
        const on = (host?.charts?.list?.() || []).filter(c => String(c.symbol || '').toUpperCase() === syms[0])
        if (on.length === 1) charts.push(on[0].ref)
      }
    }
    if (!charts.length) return
    const click = memory && TURN_CLICK.has(memory) ? TURN_CLICK.get(memory) : clickToken(host)
    memory?.noteTarget?.(charts.length === 1 ? { ref: charts[0], click, epoch } : { multi: true, click, epoch })
    if (memory) COMMITTED_IN.set(memory, turn)
  } catch { /* memory is best-effort */ }
}
