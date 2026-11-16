// ── D31 RESOLVER · THE WORLD and the PLAN TARGETS, read from the host and the plan (pure reads, never writes) ───────────────
// world = { charts: [chart snapshot], indicators: [{ id, chart, instanceId, defId, inputs, label }],
//           drawings: [{ id, symbol, drawingId, dtype, hidden, label }], lists: [{ ref, name, symbols }], alerts: [],
//           selection, subject, previous, offers: { refs, stale } | null, picked: Set<'chart:<ref>'> | null }
// Typed ids are the rails' own: chart:<ref> · ind:<chart>:<instanceId> · draw:<symbol>:<id> · list:<ref> · item:<ref>:<SYM>.
import { chartEffects } from '../chartRail'
import { stateEffects } from '../stateRail'
import { getTargetKind } from '../capabilities'

const up = (s) => String(s || '').trim().toUpperCase()
const safe = (f, d) => { try { return f() } catch { return d } }

/** The world the resolver reads, from the live host. Each source is read on its own: one that throws is empty. */
export function worldFromHost(host, { selection = undefined, subject = null, previous = null, offers = null, picked = null } = {}) {
  const charts = safe(() => host?.charts?.list?.() || [], [])
  const indicators = charts.flatMap(c => safe(() => (c.cs?.indicatorInstances || []).filter(i => i && !i.deleted).map(i => ({
    id: `ind:${c.ref}:${i.instanceId}`, chart: c.ref, instanceId: i.instanceId, defId: i.defId, inputs: i.inputs || {}, label: i.name || i.defId,
  })), []))
  const drawings = safe(() => (host?.drawings?.list?.() || []).flatMap(s => (s.drawings || []).map(d => ({
    id: `draw:${s.ref}:${d.id}`, symbol: up(s.symbol || s.ref), drawingId: d.id, dtype: d.type, hidden: !!d.hidden, label: d.text || null,
  }))), [])
  const lists = safe(() => (getTargetKind('watchlist')?.list?.(host) || []).map(l => ({ ref: l.ref, name: l.name, symbols: (l.symbols || []).map(up) })), [])
  const sel = selection !== undefined ? selection : safe(() => host?.charts?.selected?.() ?? null, null)
  return { charts, indicators, drawings, lists, alerts: [], selection: sel, subject, previous, offers, picked: picked && picked.size ? picked : null }
}

/** The typed objects a plan would DESTROY (remove / delete / clear): chart closes (chart rail) and state destroys (state rail). */
export function targetsOfPlan(plan, host) {
  const out = []
  for (const e of safe(() => chartEffects(plan, host), [])) if (e.type === 'remove' && e.ref != null) out.push({ type: 'chart', id: `chart:${e.ref}` })
  for (const e of safe(() => stateEffects(plan), [])) {
    if (!['remove', 'delete', 'clear'].includes(e.type)) continue
    if (e.state === 'indicator' && e.id) out.push({ type: 'indicator', id: e.id })
    else if (e.state === 'drawing' && e.id) out.push({ type: 'drawing', id: e.id })
    else if (e.state === 'watchlist' && e.id) {
      const ref = String(e.id).slice('list:'.length)
      // (a delete — or a CLEAR, which empties the list itself — targets the list; a remove targets its rows)
      if (e.type === 'delete' || e.type === 'clear') out.push({ type: 'list', id: e.id })
      else for (const s of e.syms || []) out.push({ type: 'list', id: `item:${ref}:${up(s)}` })
    }
  }
  const seen = new Set()
  return out.filter(t => !seen.has(t.id) && seen.add(t.id))
}
