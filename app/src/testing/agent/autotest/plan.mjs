// UCT Agent AUTOTEST: a scripted plan, written against the request the panel really sent.
//
// Tokens are resolved from `body.context` (never from a value the test already knows), exactly as a planner has to:
//   target  $chart:A | $ie:A | $dr:A | $list:board | $wl:Momentum | $view
//           a role may be `sel` (the chart the context marks selected, as a planner reads it) or `notSel` (any other: a bad guess)
//   args    $sym:sel (a chart's symbol) | $inst:A:RSI (an indicator id, by its name on that chart) | $drawing:A:0 | $widget:news | $layout:Name
// A token the request cannot satisfy becomes `missing:<token>`, so the plan fails where a planner would.
import { BOARDS } from './boards.mjs'

const byRole = (body, boardName, role, list) => {
  const r = BOARDS[boardName].roles[role]
  const rows = body?.context?.[list] || []
  if (role === 'sel' || role === 'notSel') {
    const all = body?.context?.charts || []
    const c = role === 'sel' ? all.find(x => x.selected) : (all.find(x => !x.selected) || all[0])
    if (!c) return null
    return rows.find(x => x.ref === c.ref) || rows.find(x => c.position && x.position === c.position) || rows.find(x => x.symbol === c.symbol) || null
  }
  if (!r) return null
  if (r.position) { const hit = rows.find(x => x.position === r.position); if (hit) return hit }
  const charts = body?.context?.charts || []
  const c = r.position ? charts.find(x => x.position === r.position) : (charts.find(x => x.symbol === r.sym) || null)
  const sym = c?.symbol || r.sym
  return rows.find(x => x.symbol === sym) || (Object.keys(BOARDS[boardName].roles).length === 1 ? rows[0] : null)
}

export function resolveToken(v, body, boardName) {
  if (typeof v !== 'string' || !v.startsWith('$')) return v
  const [kind, a, b] = v.slice(1).split(':')
  const ctx = body?.context || {}
  const miss = `missing:${v}`
  switch (kind) {
    case 'chart': return byRole(body, boardName, a, 'charts')?.ref ?? miss
    case 'sym': return byRole(body, boardName, a, 'charts')?.symbol ?? miss
    case 'ie': return byRole(body, boardName, a, 'indicatorEdits')?.ref ?? miss
    case 'dr': return byRole(body, boardName, a, 'drawings')?.ref ?? miss
    case 'list': return (ctx[a] || [])[0]?.ref ?? miss
    // $view = the first list view; $view:<list name> = the list view showing that list
    case 'view': return (a ? (ctx.listViews || []).find(x => x.name === a) : (ctx.listViews || [])[0])?.ref ?? miss
    // the Multi Chart grid (its context section is one object, not a list)
    case 'grid': return ctx.multiChart?.ref ?? miss
    case 'wl': return (ctx.watchlists || []).find(w => w.name === a)?.ref ?? miss
    case 'inst': {
      const re = new RegExp(b, 'i')
      return byRole(body, boardName, a, 'indicators')?.indicators?.find(x => re.test(x.name) && x.id)?.id ?? miss
    }
    case 'drawing': return byRole(body, boardName, a, 'drawings')?.drawings?.[Number(b || 0)]?.id ?? miss
    case 'widget': return (ctx.board?.[0]?.widgets || []).find(w => w.type === a)?.id ?? miss
    case 'layout': return (ctx.layouts?.[0]?.layouts || []).find(l => l.name === a)?.id ?? miss
    default: return v
  }
}
const deep = (v, f) => (Array.isArray(v) ? v.map(x => deep(x, f)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x, f)])) : f(v))

/** The envelope fields the scripted model answers with, for this request body. */
export function scripted(turn, body, boardName) {
  const p = turn.plan || {}
  const ops = (p.ops || []).map(o => ({ action: o.action, target: resolveToken(o.target, body, boardName), args: deep(o.args || {}, x => resolveToken(x, body, boardName)) }))
  return { disposition: p.disposition || (ops.length ? 'apply' : 'answer'), ops, reply: p.reply || '', question: p.question || null, unsupported_category: p.unsupported_category || null }
}
