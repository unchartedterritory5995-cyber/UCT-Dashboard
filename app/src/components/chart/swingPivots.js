// Swing high/low pivot detection for chart price labels (MarketSurge-style).
//
// Hybrid N-bar fractal + ZigZag % filter:
//   1. Raw fractal pivots — a bar is a swing high if no bar within `leftRight`
//      bars on either side has a strictly greater high (low symmetric). Right-edge
//      bars (within R of the end) are never evaluated, so forming bars never
//      produce flickering labels.
//   2. ZigZag filter — enforce alternation high→low→high and keep a pivot only if
//      its move from the last kept pivot exceeds `pctFloor` percent. Consecutive
//      same-type pivots collapse to the more extreme one.
//
// Pure + deterministic. `ohlc` = [{ time, high, low, ... }] ascending by time.

// Map the user-facing sensitivity (low|medium|high) to detection params, scaled
// by timeframe — intraday swings are smaller %, weekly/monthly larger.
export function sensitivityToParams(level, tf) {
  const lvl = level === 'low' || level === 'high' ? level : 'medium'
  const intraday = ['1', '5', '15', '30', '60'].includes(String(tf))
  const weekly = tf === 'W' || tf === 'M'

  let table
  if (intraday) {
    table = { low: [8, 4], medium: [6, 2.5], high: [4, 1.2] }
  } else if (weekly) {
    table = { low: [6, 18], medium: [5, 12], high: [3, 7] }
  } else {
    // daily (default)
    table = { low: [8, 10], medium: [6, 6], high: [4, 3.5] }
  }
  const [leftRight, pctFloor] = table[lvl]
  return { leftRight, pctFloor }
}

// includeDeveloping: also surface the most extreme price since the last confirmed
// pivot as a "developing" swing (opposite type), so the current leg is always
// labeled even though it can't be fractal-confirmed yet (needs R bars to its
// right). This is the live last-leg every charting platform shows; only this one
// label updates as new bars arrive — all confirmed labels stay put.
export function detectSwingPivots(ohlc, { leftRight = 6, pctFloor = 6, includeDeveloping = true } = {}) {
  const n = Array.isArray(ohlc) ? ohlc.length : 0
  const L = Math.max(1, leftRight | 0)
  const R = L
  if (n < L + R + 1) return []

  // 1. Raw fractal pivots (chronological). A bar may qualify as both high and
  //    low only in degenerate all-equal windows; the ZigZag pass dedups.
  const raw = []
  for (let i = L; i < n - R; i++) {
    const hi = ohlc[i].high
    const lo = ohlc[i].low
    let isHigh = true
    let isLow = true
    for (let j = i - L; j <= i + R; j++) {
      if (j === i) continue
      if (ohlc[j].high > hi) isHigh = false
      if (ohlc[j].low < lo) isLow = false
      if (!isHigh && !isLow) break
    }
    if (isHigh) raw.push({ idx: i, time: ohlc[i].time, price: hi, type: 'high' })
    if (isLow) raw.push({ idx: i, time: ohlc[i].time, price: lo, type: 'low' })
  }

  // 2. ZigZag alternation + % floor.
  const kept = []
  for (const p of raw) {
    if (kept.length === 0) {
      kept.push(p)
      continue
    }
    const last = kept[kept.length - 1]
    if (p.type === last.type) {
      const moreExtreme = p.type === 'high' ? p.price > last.price : p.price < last.price
      if (moreExtreme) kept[kept.length - 1] = p
    } else {
      const move = last.price ? Math.abs(p.price - last.price) / Math.abs(last.price) * 100 : 0
      if (move >= pctFloor) kept.push(p)
    }
  }

  const out = kept.map(p => ({ time: p.time, price: p.price, type: p.type }))

  // 3. Developing last leg — the current swing the user expects to see at the
  //    live edge. Bidirectional: if price extends past the last confirmed pivot
  //    in the SAME direction (a new higher high after a high, or lower low after
  //    a low), that new extreme is the current swing; otherwise look for an
  //    opposite-direction reversal that clears the % floor. Either way only one
  //    developing label is added, and it's flagged so callers can style it.
  if (includeDeveloping && kept.length) {
    const last = kept[kept.length - 1]
    let hiIdx = -1
    let loIdx = -1
    for (let i = last.idx + 1; i < n; i++) {
      if (hiIdx < 0 || ohlc[i].high > ohlc[hiIdx].high) hiIdx = i
      if (loIdx < 0 || ohlc[i].low < ohlc[loIdx].low) loIdx = i
    }
    if (hiIdx >= 0) {
      const tailHigh = ohlc[hiIdx].high
      const tailLow = ohlc[loIdx].low
      let devType = null
      let devIdx = -1
      let devPrice = null
      if (last.type === 'high') {
        if (tailHigh > last.price) { devType = 'high'; devIdx = hiIdx; devPrice = tailHigh }
        else { devType = 'low'; devIdx = loIdx; devPrice = tailLow }
      } else {
        if (tailLow < last.price) { devType = 'low'; devIdx = loIdx; devPrice = tailLow }
        else { devType = 'high'; devIdx = hiIdx; devPrice = tailHigh }
      }
      const move = last.price ? Math.abs(devPrice - last.price) / Math.abs(last.price) * 100 : 0
      if (move >= pctFloor) {
        out.push({ time: ohlc[devIdx].time, price: devPrice, type: devType, developing: true })
      }
    }
  }

  return out
}
