const isNum = v => typeof v === 'number' && Number.isFinite(v)

/**
 * Where `value` sits in `values`, as the percentage of observations at or below
 * it. Null when there are fewer than two comparable points — a percentile drawn
 * from one observation would read as an extreme when it only means there is
 * nothing to compare against.
 */
export function percentileOf(values, value) {
  if (!isNum(value)) return null
  const nums = (values ?? []).filter(isNum)
  if (nums.length < 2) return null
  return Math.round((nums.filter(v => v <= value).length / nums.length) * 100)
}

/** Last non-null value of `key`, so a metric that lags a day still reports. */
export function latestValue(rows, key) {
  for (let i = (rows?.length ?? 0) - 1; i >= 0; i -= 1) {
    if (isNum(rows[i]?.[key])) return rows[i][key]
  }
  return null
}
