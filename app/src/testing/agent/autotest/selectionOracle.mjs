// UCT Agent AUTOTEST: the SELECTION-STATE oracle. Pure. Target resolution is the Agent's most fragile area, and a request's
// own checks only say "the state I asked for exists". This records the charts that matter and fails when they disagree:
//
//   clicked   the chart a real pointer went down on last, as the PAGE saw it (rig listener), never as the test intended
//   intended  what the member's words and click mean, stated by the case, independent of any plan
//   landed    the charts whose real state changed: every other reading (receipt, plan, envelope) is under test, not evidence
//   told      the chart the panel told the planner was selected (body.context), when a model was asked at all
//
// Shape of `o.target`: { intended: 'clicked' | ['TR', ...] | 'ask', click: 'BL' | null, guarded: bool, ring: bool }
//   intended 'clicked'  the click decides: clicked and landed must be the same one chart
//   intended [roles]    the words decide, whatever was clicked: landed must be exactly those charts
//   intended 'ask'      nothing is identified: nothing may land, and the Agent must ask
//   click               the chart the case meant to click: the rig's own click is checked against it, so a click that missed
//                       (or never happened) fails rather than grading a board nobody selected
//   guarded             the plan is deliberately wrong (a model's bad guess). Landing where intended, or landing nowhere and
//                       asking, both pass; landing anywhere else is the defect
//   ring                a walkthrough: `landed` is the chart its ring sits on
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join()

/** Which role sits behind a ref the Agent uses: `w-chart-a`, `w-chart-a~tab2`, `g1`, or a kind-prefixed `ixe:w-chart-a`. */
export function roleOfRef(ref, roles = {}) {
  const r = String(ref ?? '').replace(/^[a-z]+:/i, '').split('~')[0]
  return Object.entries(roles).find(([, v]) => v.id === r)?.[0] ?? null
}

/** The charts whose real state moved between two snapshots. A drawing or alert belongs to a symbol, so it lands on the charts showing it. */
export function landedRoles(before, after, print) {
  const un = after.unreadable || []
  const out = new Set()
  for (const [role, c] of Object.entries(after.charts || {})) if (print(c, un) !== print(before.charts?.[role], un)) out.add(role)
  const showing = (sym) => Object.entries(before.charts || {}).filter(([, c]) => c?.sym === sym).map(([r]) => r)
  const count = (s) => Object.fromEntries(Object.entries(s.drawings || {}).map(([k, d]) => [k, d.length]))
  const b = count(before), a = count(after)
  for (const sym of new Set([...Object.keys(b), ...Object.keys(a)])) if ((b[sym] || 0) !== (a[sym] || 0)) for (const r of showing(sym)) out.add(r)
  for (const key of ['alerts', 'ialerts']) {
    const had = new Set((before[key] || []).map(x => x.id))
    for (const x of after[key] || []) if (!had.has(x.id)) for (const r of showing(x.sym)) out.add(r)
  }
  return [...out].sort()
}

/** The chart the panel marked selected in the context it sent, as a role. The refs there are per-request handles (c1, c2), so a chart is
 *  matched as a planner sees it, by symbol, then by position. undefined = no model was asked, so nothing to compare. */
export function toldRole(context, roles, before = null) {
  if (!context) return undefined
  const hit = (context.charts || []).find(c => c.selected)
  if (!hit) return null
  const entries = Object.entries(roles)
  const bySym = entries.filter(([r, v]) => (before?.charts?.[r]?.sym ?? v.sym) === hit.symbol).map(([r]) => r)
  if (bySym.length === 1) return bySym[0]
  const byPos = entries.filter(([r, v]) => (!bySym.length || bySym.includes(r)) && hit.position && v.position === hit.position).map(([r]) => r)
  return byPos.length === 1 ? byPos[0] : `unknown:${hit.position || hit.symbol}`
}

/** How a sentence would name a role's chart. */
const namesOf = (role, roles, before) => [roles[role]?.position && `${roles[role].position} chart`, before?.charts?.[role]?.sym && `(${before.charts[role].sym})`].filter(Boolean)

/**
 * The record for one request. `ev`: { before, beforeLast, after, turns, clicks: [widget ids, oldest first], ring } and
 * `roles`: the board's. → { clicked, intended, landed, told, receipt, modelCalls }. Each chart is a role, so a record reads the same on any board.
 */
export function targetRecord(spec, ev, roles, print) {
  const clickedId = ev.clicks?.at(-1) ?? null
  const clicked = clickedId == null ? null : (roleOfRef(clickedId, roles) ?? `unknown:${clickedId}`)
  const base = ev.beforeLast || ev.before
  const landed = spec.ring ? (ev.ring ? [ev.ring] : []) : landedRoles(base, ev.after, print)
  const last = ev.turns?.at(-1) || {}
  const told = last.modelCalls ? toldRole(last.context, roles, base) : undefined
  const intended = spec.intended === 'clicked' ? (clicked && !clicked.startsWith('unknown:') ? [clicked] : []) : spec.intended
  return { clicked, intended, landed, told, receipt: last.receiptText ?? null, modelCalls: ev.turns?.reduce((n, t) => n + (t.modelCalls || 0), 0) ?? 0 }
}

/** The disagreements. → checks with tag 'target'. */
export function gradeTarget(spec, rec, { roles = {}, before = null, asked = false } = {}) {
  const C = []
  const push = (name, pass, detail) => C.push({ name, pass: !!pass, detail: pass ? undefined : detail, tag: 'target' })
  const show = `clicked=${rec.clicked} intended=${rec.intended} landed=${rec.landed}${rec.told === undefined ? '' : ` told=${rec.told}`}`
  if (spec.click !== undefined) push(`the real click was on ${spec.click ?? 'no chart'}`, rec.clicked === spec.click, show)
  if (rec.told !== undefined) push('the panel told the planner the clicked chart', rec.told === rec.clicked, show)
  if (spec.intended === 'ask') {
    push('nothing landed: no chart was identified', rec.landed.length === 0, show)
    return C
  }
  if (spec.intended === 'clicked' && !rec.intended.length) { push('the click decides, and no chart was clicked', false, show); return C }
  const stopped = spec.guarded && rec.landed.length === 0 && asked
  push(`landed where intended (${[].concat(rec.intended).join(',')})`, stopped || sameSet(rec.landed, rec.intended), show)
  // a receipt is under test too: it must not name a chart nothing happened to
  const text = String(rec.receipt || '').toLowerCase()
  for (const role of Object.keys(roles)) {
    if (rec.landed.includes(role)) continue
    // a symbol a chart that did change also shows names that chart, not this one
    const shared = (n) => rec.landed.some(r => namesOf(r, roles, before).includes(n))
    const named = namesOf(role, roles, before).find(n => text.includes(n.toLowerCase()) && !shared(n))
    if (named) push(`the receipt does not name ${role}, which did not change`, false, `${show}; receipt names "${named}"`)
  }
  return C
}
