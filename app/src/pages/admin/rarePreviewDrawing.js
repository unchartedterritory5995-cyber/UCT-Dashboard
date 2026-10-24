// The rare-pattern preview's drawing as chart annotations (the drawing-overlay layer the gold-set review
// already uses). The server stores each instance's drawing exactly as the admin chart row carries it
// (auto_structures.rare_preview_drawings: draw_shape + buy_point); this turns it into read-only annotations:
// the buy-point line from the ceiling bar to the as-of bar, its label, the base / flag low (dashed) and, for
// the shapes that draw one, a dotted path through the marks. Pure — exported for tests.

export function ymd(t) {
  const s = String(t ?? '')
  if (!/^\d{8}$/.test(s)) return null
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

export function drawingToAnnotations(drawing) {
  const d = drawing && typeof drawing === 'object' ? drawing : null
  if (!d) return []
  const bp = Number(d.buy_point)
  const low = Number(d.low)
  const start = ymd(d.start_t)
  const end = ymd(d.end_t)
  const from = ymd(d.pivot_from_t) || start
  if (!finite(bp) || !finite(low) || !start || !end || !from) return []
  const out = [
    { id: 'rp-buy', type: 'trendline', lineWidth: 2,
      points: [{ time: from, price: bp }, { time: end, price: bp }] },
    { id: 'rp-buy-label', type: 'text',
      text: `Buy point ${bp.toFixed(2)}`, points: [{ time: from, price: bp }] },
    { id: 'rp-low', type: 'trendline', lineStyle: 'dashed',
      points: [{ time: start, price: low }, { time: end, price: low }] },
  ]
  const marks = Array.isArray(d.marks) ? d.marks.filter((m) => m && ymd(m.t) && finite(Number(m.price))) : []
  if (d.path === true && marks.length >= 2) {
    for (let i = 1; i < marks.length; i += 1) {
      out.push({ id: `rp-path-${i}`, type: 'trendline', lineStyle: 'dotted',
        points: [{ time: ymd(marks[i - 1].t), price: Number(marks[i - 1].price) },
          { time: ymd(marks[i].t), price: Number(marks[i].price) }] })
    }
  }
  return out
}

// The release rule's progress line for one pattern (the rule itself lives on the server:
// api/services/rare_preview.py RELEASE_MIN_APPROVALS / RELEASE_MIN_APPROVE_RATE).
export function releaseLine(st) {
  if (!st) return ''
  const rule = st.rule || {}
  const rate = st.approve_rate == null ? '—' : `${Math.round(st.approve_rate * 100)}%`
  const need = `${rule.min_approvals ?? 12} approvals at ${Math.round((rule.min_approve_rate ?? 0.8) * 100)}%`
  const state = st.released ? 'released' : st.rule_met ? 'rule met — release is a separate commit' : 'not met'
  return `${st.approved}/${rule.min_approvals ?? 12} approved · ${st.rejected} rejected · ${rate} (needs ${need}) · ${state}`
}
