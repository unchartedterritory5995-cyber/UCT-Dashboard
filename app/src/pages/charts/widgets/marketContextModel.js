// Market Context widget — the pure model. The `/api/breadth` payload in, the
// reading set the widget renders AND freezes out. Kept beside the component so
// the live board and a frozen note embed resolve through ONE derivation.

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const round1 = (v) => (num(v) == null ? null : Math.round(v * 10) / 10)

/** The wire payload → the frozen reading set. The field names mirror
 *  `engine._normalize_breadth` + `_normalize_exposure`. */
export function readingsFrom(breadth) {
  const b = breadth && typeof breadth === 'object' ? breadth : {}
  const exp = b.exposure && typeof b.exposure === 'object' ? b.exposure : {}
  return {
    marketPhase: typeof b.market_phase === 'string' && b.market_phase ? b.market_phase : null,
    exposureScore: round1(exp.score),
    exposureDelta: round1(exp.score_delta),
    breadthScore: round1(b.breadth_score),
    distributionDays: num(b.distribution_days),
    pctAbove50: round1(b.pct_above_50ma),
    pctAbove200: round1(b.pct_above_200ma),
    // ⛔ NULL BY OWNER DIRECTION (2026-04-17): "rule not yet defined". It is
    // written here unconditionally and reads NOTHING off the payload, so a
    // future wire that starts publishing a power-trend-shaped field cannot
    // start populating it by accident. Turning this on is a decision, not a
    // data change. Renders as an em dash; do not derive one, do not hide the
    // row — the row is the record that the reading is UNDEFINED, not missing.
    powerTrend: null,
  }
}

// Row order + copy. `fmt` turns a reading into its displayed string; a null
// reading never reaches it (the renderer emits the em dash instead).
export const CONTEXT_ROWS = [
  { key: 'marketPhase', label: 'Market phase', fmt: (v) => String(v) },
  { key: 'exposureScore', label: 'UCT Exposure', fmt: (v) => String(v), delta: 'exposureDelta' },
  { key: 'breadthScore', label: 'Breadth score', fmt: (v) => String(v) },
  { key: 'distributionDays', label: 'Distribution days', fmt: (v) => String(v) },
  { key: 'pctAbove50', label: '% above 50-day', fmt: (v) => `${v}%` },
  { key: 'pctAbove200', label: '% above 200-day', fmt: (v) => `${v}%` },
  { key: 'powerTrend', label: 'Power trend', fmt: (v) => String(v) },
]

/** A finite number, else null — shared by the renderer's delta tint. */
export const finite = num
