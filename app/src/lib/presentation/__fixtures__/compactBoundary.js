// Test-only: the ONE deliberate move the compact-formatter oracles absorb (accuracy audit
// 2026-10-06, design note 2).
//
// The frozen oracles (TERM-066 et al.) print a value that ROUNDS up to the next tier in the
// lower tier — 999,999 reads "1000K". `formatCompact` now promotes it: "1.0M". Everywhere
// else the oracles stay byte-for-byte authoritative.
//
// `withPromotion(oracle, thresholds)` wraps an oracle so that, ONLY when the oracle's own
// printed number reaches a threshold the value itself is below, the expectation becomes what
// the SAME oracle prints for that threshold (±T) — i.e. the next tier's "1.0M" in that
// grammar's own decimals, prefix and sign rules. `thresholds` are the grammar's tier
// boundaries (a ladder with no B tier passes no 1e9, so "1000.00M" stays).
//
// `boundaryMoves(oracle, thresholds, values)` lists exactly which inputs moved, so a test can
// pin that the set is small and sits on tier edges.
const UNIT = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }

/** The magnitude an oracle's string states: "-$1000.0K" -> 1e6, "999" -> 999. NaN if none. */
export function statedMagnitude(text) {
  if (typeof text !== 'string') return NaN
  const m = text.match(/(\d+(?:\.\d+)?)\s*([KMBT]?)\s*(?:%|\/d)?$/)
  if (!m) return NaN
  return Number(m[1]) * (UNIT[m[2]] || 1)
}

function promotedThreshold(v, text, thresholds) {
  const n = Number(v)
  if (typeof v !== 'number' || !Number.isFinite(n)) return null
  const stated = statedMagnitude(text)
  if (!Number.isFinite(stated)) return null
  for (const T of [...thresholds].sort((a, b) => b - a)) {
    if (Math.abs(n) < T && stated >= T) return T
  }
  return null
}

export function withPromotion(oracle, thresholds) {
  return (v) => {
    const text = oracle(v)
    const T = promotedThreshold(v, text, thresholds)
    return T == null ? text : oracle(Math.sign(Number(v)) * T)
  }
}

export function boundaryMoves(oracle, thresholds, values) {
  const out = []
  for (const v of values) {
    let text
    try { text = oracle(v) } catch { continue }
    const T = promotedThreshold(v, text, thresholds)
    if (T != null) out.push({ v, from: text, to: oracle(Math.sign(Number(v)) * T) })
  }
  return out
}
