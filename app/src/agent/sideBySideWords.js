// ── ⛔ SIDE BY SIDE PRESERVES (OWNER RULING 2026-11-23) — the words, read in ONE place ─────────────────────────────────────────
// "For 'side by side,' preserve the existing chart and add the comparison chart beside it by default. Never silently replace an
// existing chart. If the request or layout makes the intended behavior ambiguous, clarify."
// Words that ask for a chart side by side with / next to / beside / alongside another — never "the one next to SPY" (that NAMES a
// chart), nor "next to them" (the ADD rail's own words). Read by the instant readers (multiChart), the fast path (which leaves such
// a re-symbol to the plan screen), the model-plan screen and the chart rail. No imports: every reader may use it.
const SIDE_ANY = /\b(?:side[\s-]by[\s-]side|next to|beside|alongside)\b/gi
const ADDRESSING = /\b(?:one|ones|chart|charts|widget|widgets|panel|panels|cell|cells|tile|tiles)\s+$/i
const AT_THEM = /^\s*(?:them|those|these|my (?:charts?|other))\b/i
export function sideBySideWords(text) {
  const t = String(text || '')
  for (const m of t.matchAll(SIDE_ANY)) {
    if (/side/i.test(m[0])) return true
    if (ADDRESSING.test(t.slice(0, m.index))) continue                         // "the one next to SPY": a chart named, not asked for
    if (AT_THEM.test(t.slice(m.index + m[0].length))) continue                  // "next to them": the ADD rail's
    return true
  }
  return false
}
// replace / swap said with it: which one is meant is asked
export const SIDE_REPLACE = /\b(?:replace|replaces|replacing|replaced|instead|swap|swaps|swapping|swapped|switch out|get rid of|in place of|rather than)\b/i
