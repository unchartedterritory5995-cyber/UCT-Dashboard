/**
 * When one series on an axis is far smaller than another, it draws as a line on
 * the floor. The legacy chart says so (audit A-04, D-029); V2 splits it into its
 * own panel. Computed from the rows on screen, so it describes what the member is
 * looking at — including selections no preset covers, which the retired MAX_ABS
 * test table never saw.
 */
export const MAGNITUDE_LIMIT = 6

const isNum = v => typeof v === 'number' && Number.isFinite(v)

export function magnitudeGaps(selected, rows, axisByKey) {
  const byAxis = new Map()
  for (const key of selected ?? []) {
    const peak = (rows ?? []).reduce((m, r) => (isNum(r[key]) ? Math.max(m, Math.abs(r[key])) : m), 0)
    if (peak <= 0) continue
    const axis = axisByKey[key] ?? 0
    if (!byAxis.has(axis)) byAxis.set(axis, [])
    byAxis.get(axis).push({ key, peak })
  }
  const gaps = []
  for (const [axis, series] of byAxis) {
    if (series.length < 2) continue
    const large = series.reduce((a, b) => (b.peak > a.peak ? b : a))
    for (const s of series) {
      const ratio = large.peak / s.peak
      if (s !== large && ratio > MAGNITUDE_LIMIT) gaps.push({ axis, small: s.key, large: large.key, ratio })
    }
  }
  return gaps
}

export function describeGap(gap, labelOf) {
  const times = gap.ratio >= 10 ? String(Math.round(gap.ratio)) : gap.ratio.toFixed(1)
  return `${labelOf(gap.small)} is ${times}× smaller than ${labelOf(gap.large)} on this axis.`
}
