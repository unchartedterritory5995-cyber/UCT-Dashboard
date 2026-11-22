// ── UCT Agent COACH: `coach.next` — the quick replies after a coach answer (W3-4) ─────────────────────────────────
//
// Not a capability: deterministic suggestions (at most three short sentences) the panel shows as chips under a
// coach answer. A tap sends the text as the member's OWN message (AgentPanel → agent.send), so every suggestion
// runs through the ordinary fast path / model turn, the same guard, the same consent rule. The suggestions are
// worded from the concept titles the server served and the consent state; they never carry a figure and never
// suggest an order. The single-turn workflow is explain → what to check → one question back (coach/prompt.py);
// these chips are the member's shortest way to the next step. (W2-A1 threading replaces them at integration.)

const RELATED = {
  'price-action-basics': ['support-resistance', 'moving-averages-context'],
  'support-resistance': ['breakouts-and-failure', 'stop-placement'],
  'consolidation-tightness': ['breakouts-and-failure', 'volume-relative-volume'],
  'breakouts-and-failure': ['consolidation-tightness', 'volume-relative-volume'],
  'relative-strength': ['market-conditions-breadth', 'moving-averages-context'],
  'volume-relative-volume': ['breakouts-and-failure', 'earnings-gaps'],
  'moving-averages-context': ['support-resistance', 'relative-strength'],
  'risk-per-trade-position-sizing': ['stop-placement', 'expectancy'],
  'stop-placement': ['risk-per-trade-position-sizing', 'support-resistance'],
  'market-conditions-breadth': ['relative-strength', 'drawdown'],
  'earnings-gaps': ['volume-relative-volume', 'risk-per-trade-position-sizing'],
  'drawdown': ['expectancy', 'risk-per-trade-position-sizing'],
  'expectancy': ['drawdown', 'risk-per-trade-position-sizing'],
}
export const MAX_NEXT = 3
const lower = (t) => String(t || '').trim().replace(/^./, c => c.toLowerCase())

/**
 * The quick replies after a coach answer → [string] (≤ 3, possibly empty).
 *   after: 'explain' (conceptId) | 'review' | 'consent'
 *   consent: 'granted' | 'revoked' | 'unknown'   hasChart: a chart is open   concepts: the served rows (id, title)
 */
export function nextFor({ after, conceptId = null, consent = 'unknown', hasChart = false, concepts = [] } = {}) {
  const title = (id) => concepts.find(c => c.id === id)?.title || null
  const out = []
  if (after === 'explain' && conceptId) {
    const t = title(conceptId)
    if (t && hasChart) out.push(`What should I check on this chart for ${lower(t)}?`)
    for (const id of RELATED[conceptId] || []) { const rt = title(id); if (rt) out.push(`Coach me on ${lower(rt)}`) }
    if (consent === 'granted') out.push('Review my trades')
  } else if (after === 'review') {
    if (consent === 'granted') out.push('Write that up as a note for my journal')
    for (const id of ['expectancy', 'stop-placement']) { const rt = title(id); if (rt) out.push(`Coach me on ${lower(rt)}`) }
  } else if (after === 'consent') {
    if (consent === 'granted') out.push('Review my trades', 'Review my last 20 trades')
    else { const rt = title('expectancy'); if (rt) out.push(`Coach me on ${lower(rt)}`) }
  }
  return [...new Set(out)].slice(0, MAX_NEXT)
}
