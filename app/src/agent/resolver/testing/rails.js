// ── D31 RESOLVER · the RAILS' outcome for a case (test-only; the composition useAgent.railOf runs: chart rail, then state rail) ──
// The same harness policy.test.js runs the oracle rows through (planOps on the real kinds, chartRailRefusal → stateRailDecision),
// for the offline shadow replay of the generated suites. → { verdict: 'allow' | 'ask' | 'refuse', text }
import { planOps, collectTargets, prepareOps } from '../../executor'
import { buildContext, getTargetKind } from '../../capabilities'
import { chartRailRefusal } from '../../chartRail'
import { stateRailDecision } from '../../stateRail'

const ASK_TEXT = /^Which do you mean|Nothing is selected, so I can’t tell|I can’t tell which chart|fits \d+ charts|\d+ charts show|^Which chart should change/

/** The op that destroys one typed id on `host` (chart close · indicator remove · drawing remove · list delete / row remove). */
export function opOf(id, w) {
  const [type, a, ...rest] = String(id).split(':')
  if (type === 'chart') return { action: 'widget.remove', target: 'board', args: { widget: a } }
  if (type === 'ind') { const inst = w.indicators.find(i => i.id === id)?.instanceId || rest.join(':'); return { action: 'indicator.remove', target: `ixe:${a}`, args: { instance: inst } } }
  if (type === 'draw') return { action: 'drawing.remove', target: a, args: { drawing: rest.join(':') } }
  if (type === 'list') return { action: 'watchlist.delete', target: a, args: {} }
  if (type === 'item') return { action: 'watchlist.remove', target: a, args: { symbols: [rest[0]] } }
  throw new Error(`no op for ${id}`)
}
const kindOf = (o) => (o.target === 'board' ? 'board' : String(o.target).startsWith('ixe:') ? 'indicatorEdits' : /^wl\d$/.test(o.target) ? 'watchlist' : /^[A-Z]+$/.test(o.target) ? 'drawing' : 'chart')
export async function planOf(host, ops) {
  buildContext(host, { surface: 'charts' })
  return planOps(collectTargets(host, [...new Set(ops.map(kindOf))]), ops, { ...(await prepareOps(ops)), boundDrawingIds: new Set(), boundAlerts: [] }, { surface: 'charts' })
}
/** The rails' verdict on destroying `ids` with these words / context. */
export async function railOutcome(host, w, ids, { words, carried = null, subject = null, previous = null, picked = null }) {
  const plan = await planOf(host, ids.map(id => opOf(id, w)))
  if (!plan.ok) return { verdict: 'refuse', text: 'PLAN NOT BUILT', plan }
  const rw = carried ? `${carried} . ${words}` : words
  const c = chartRailRefusal(plan, { words: rw, host, mode: 'apply', subject, picked, previous, previousLabel: null })
  if (c) return { verdict: ASK_TEXT.test(c) ? 'ask' : 'refuse', text: c, plan, rail: 'chart' }
  let scope = null
  try { const ls = getTargetKind('watchlist')?.list?.(host) || null; scope = { watchlists: ls ? ls.length : null, lists: ls ? ls.map(l => ({ ref: l.ref, name: l.name, symbols: (l.symbols || []).map(x => String(x).toUpperCase()) })) : null } } catch { scope = null }
  const d = stateRailDecision(plan, { words: rw, mode: 'apply', subjects: previous ? new Set([previous]) : null, picked, previous, previousSet: previous ? [{ id: previous }] : null, scope })
  if (d?.text) return { verdict: d.ask ? 'ask' : 'refuse', text: d.text, plan, rail: 'state' }
  if (d?.card) return { verdict: 'refuse', text: 'CARD', plan, rail: 'state' }
  return { verdict: 'allow', text: null, plan, rail: null }
}
