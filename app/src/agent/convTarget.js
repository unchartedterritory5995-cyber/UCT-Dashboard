// ── CONVERSATIONAL TARGETING (pl-exec, owner product decision 2026-11-07) ──────────────────────────────────────────────
// "Change NVDA to daily." → "Add RSI." → "Make it green." all act on NVDA: the chart the last committed change acted on stays
// the conversation's target until the member redirects. THE RULE, precisely:
//   1. After a change commits on exactly ONE chart, that chart is the conversational target, stamped with the member's click
//      as it stood then (the host's click token: every pointer-down on a chart is a new token, a re-click included). A change
//      on several charts ends it (a later bare request means no one chart). A new layout / new chat / 30 min ends it.
//   2. On the next request, while NO NEW CLICK has happened since that stamp, the conversational target stands in for the click
//      for the whole turn: whatever reads "the clicked chart" (the fast path, the model's context `selected`, deixis, the
//      relative / negation / per-clause rules, "the other one") reads the target instead. A request that names another chart
//      (a ticker, a position, an ordinal, a description, a relation) is a redirect: no override for that request at all.
//   3. A click AFTER the stamp is a redirect: the click is the target again (rule 2 does not apply), so "this one" or a bare
//      follow-up right after a click acts on the click.
//   4. Ambiguous → ask: a request that says "this" while the only click is an OLD one on a different chart than the
//      conversational target is read with NO click, so the panel asks which chart (never a silent pick of either).
// The override is turn-scoped (`begin` → restore in finally) and never persists; the click itself is never changed.
import { getCapability } from './capabilities'
import { chartsNamedBy } from './deixis'

const THIS_WORD = /\bthis\b/i

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
  if (refs.length < 2 || !refs.includes(conv.ref)) return undefined
  if (conv.click !== clickToken(host)) return undefined                       // rule 3: clicked since
  let sel = null
  try { sel = (host.charts.realSelected || host.charts.selected)?.call(host.charts) ?? null } catch { sel = null }
  if (sel === conv.ref) return undefined                                      // the click is the target already
  // an explicit reference to another chart anywhere in the request redirects it, and what the request says after it ("same on
  // the left but weekly") belongs to that chart: no override, the words and the click are read as always
  let charts = []
  try { charts = host.charts.list() || [] } catch { charts = [] }
  if ([...chartsNamedBy(text, charts, sel)].some(r => r !== conv.ref)) return undefined
  if (sel && THIS_WORD.test(String(text || ''))) return null                  // rule 4: "this" vs an old click elsewhere
  return conv.ref
}

// the member's click as it stood when they SENT the request: a change is stamped with it (a commit settles later, and a click
// made while it settles is a new click, never part of that request)
const TURN_CLICK = new WeakMap()
const CREATED_IN = new WeakMap()          // memory → the request (turn id) that created a widget

/** Applies `turnSelection` to the host's chart source for one turn → a restore function (a no-op when nothing applies). */
export function beginTurnTarget(host, memory, epoch, text) {
  if (memory && typeof memory === 'object') TURN_CLICK.set(memory, clickToken(host))
  const ref = turnSelection(host, memory, epoch, text)
  const c = host?.charts
  if (ref === undefined || !c) return () => {}
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
  return () => { c.selected = orig.selected; c.list = orig.list; c.read = orig.read; delete c.turnTarget; delete c.realSelected }
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
    memory?.noteTarget?.(charts.length === 1 ? { ref: charts[0], click, epoch } : null)
  } catch { /* memory is best-effort */ }
}
