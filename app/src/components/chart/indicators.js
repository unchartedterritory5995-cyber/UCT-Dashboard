export function toHeikinAshi(bars) {
  if (!bars?.length) return bars
  const result = []
  let prevHaOpen  = (bars[0].o + bars[0].c) / 2
  let prevHaClose = (bars[0].o + bars[0].h + bars[0].l + bars[0].c) / 4
  for (const bar of bars) {
    const haClose = (bar.o + bar.h + bar.l + bar.c) / 4
    const haOpen  = (prevHaOpen + prevHaClose) / 2
    const haHigh  = Math.max(bar.h, haOpen, haClose)
    const haLow   = Math.min(bar.l, haOpen, haClose)
    result.push({ ...bar, o: haOpen, h: haHigh, l: haLow, c: haClose })
    prevHaOpen  = haOpen
    prevHaClose = haClose
  }
  return result
}

export function computeRSI(bars, period = 14) {
  if (!bars || bars.length < period + 1) return []
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const diff = bars[i].c - bars[i - 1].c
    if (diff > 0) avgGain += diff; else avgLoss -= diff
  }
  avgGain /= period
  avgLoss /= period
  const result = []
  for (let i = period; i < bars.length; i++) {
    if (i > period) {
      const diff = bars[i].c - bars[i - 1].c
      const gain = diff > 0 ? diff : 0
      const loss = diff < 0 ? -diff : 0
      avgGain = (avgGain * (period - 1) + gain) / period
      avgLoss = (avgLoss * (period - 1) + loss) / period
    }
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
    result.push({ time: bars[i].t, value: parseFloat(rsi.toFixed(2)) })
  }
  return result
}

function _ema(values, period) {
  if (values.length < period) return []
  const k = 2 / (period + 1)
  const out = [values.slice(0, period).reduce((s, v) => s + v, 0) / period]
  for (let i = period; i < values.length; i++) {
    out.push(out[out.length - 1] * (1 - k) + values[i] * k)
  }
  return out  // out[i] corresponds to values[period - 1 + i]
}

export function computeMACD(bars, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (!bars || bars.length < slowPeriod + signalPeriod) return { macd: [], signal: [], histogram: [] }
  const closes  = bars.map(b => b.c)
  const fastEMA = _ema(closes, fastPeriod)  // fastEMA[i] → bars[fastPeriod-1+i]
  const slowEMA = _ema(closes, slowPeriod)  // slowEMA[i] → bars[slowPeriod-1+i]
  const offset  = slowPeriod - fastPeriod   // = 14 for default 12/26
  // MACD line: aligned to bars[slowPeriod-1+i]
  const macdValues = slowEMA.map((s, i) => fastEMA[i + offset] - s)
  const signalEMA  = _ema(macdValues, signalPeriod)
  const sigOffset  = signalPeriod - 1
  const macd = [], signal = [], histogram = []
  for (let i = 0; i < signalEMA.length; i++) {
    const barIdx = slowPeriod - 1 + sigOffset + i
    const t = bars[barIdx].t
    const m = macdValues[sigOffset + i]
    const s = signalEMA[i]
    macd.push({ time: t, value: parseFloat(m.toFixed(5)) })
    signal.push({ time: t, value: parseFloat(s.toFixed(5)) })
    histogram.push({
      time: t,
      value: parseFloat((m - s).toFixed(5)),
      color: m >= s ? 'rgba(76,175,80,0.75)' : 'rgba(244,67,54,0.75)',
    })
  }
  return { macd, signal, histogram }
}

export function computeBB(bars, period = 20, stdDev = 2) {
  if (!bars || bars.length < period) return { upper: [], middle: [], lower: [] }
  const upper = [], middle = [], lower = []
  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += bars[j].c
    const avg = sum / period
    let sqSum = 0
    for (let j = i - period + 1; j <= i; j++) sqSum += (bars[j].c - avg) ** 2
    const std = Math.sqrt(sqSum / (period - 1))
    const t = bars[i].t
    upper.push({ time: t, value: parseFloat((avg + stdDev * std).toFixed(4)) })
    middle.push({ time: t, value: parseFloat(avg.toFixed(4)) })
    lower.push({ time: t, value: parseFloat((avg - stdDev * std).toFixed(4)) })
  }
  return { upper, middle, lower }
}

export function computeVWAP(bars) {
  if (!bars?.length) return []
  const result = []
  let cumPV = 0, cumVol = 0, currentDay = null
  for (const bar of bars) {
    // Use UTC date to determine session boundaries (9:30 ET is always same UTC day)
    const d = new Date(bar.t * 1000)
    const dayKey = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`
    if (dayKey !== currentDay) { cumPV = 0; cumVol = 0; currentDay = dayKey }
    const tp = (bar.h + bar.l + bar.c) / 3
    cumPV += tp * bar.v
    cumVol += bar.v
    if (cumVol > 0) result.push({ time: bar.t, value: parseFloat((cumPV / cumVol).toFixed(4)) })
  }
  return result
}

export function computeStochastic(bars, kPeriod = 14, dPeriod = 3) {
  if (!bars || bars.length < kPeriod) return { k: [], d: [] }
  // Fast %K
  const kValues = []
  for (let i = kPeriod - 1; i < bars.length; i++) {
    let lowestLow = Infinity, highestHigh = -Infinity
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (bars[j].l < lowestLow) lowestLow = bars[j].l
      if (bars[j].h > highestHigh) highestHigh = bars[j].h
    }
    const range = highestHigh - lowestLow
    const k = range === 0 ? 50 : ((bars[i].c - lowestLow) / range) * 100
    kValues.push({ time: bars[i].t, value: parseFloat(k.toFixed(2)) })
  }
  // %D = SMA(dPeriod) of %K
  const dValues = []
  for (let i = dPeriod - 1; i < kValues.length; i++) {
    let sum = 0
    for (let j = i - dPeriod + 1; j <= i; j++) sum += kValues[j].value
    dValues.push({ time: kValues[i].time, value: parseFloat((sum / dPeriod).toFixed(2)) })
  }
  return { k: kValues, d: dValues }
}

export function computeATR(bars, period = 14) {
  if (!bars || bars.length < period + 1) return []
  // True Range for each bar starting at index 1 (needs previous close)
  const trs = []
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i - 1].c),
      Math.abs(bars[i].l - bars[i - 1].c)
    )
    trs.push({ t: bars[i].t, tr })
  }
  // Seed with simple average of first `period` TRs, then Wilder's smoothing
  let atr = trs.slice(0, period).reduce((s, x) => s + x.tr, 0) / period
  const result = [{ time: trs[period - 1].t, value: parseFloat(atr.toFixed(4)) }]
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i].tr) / period
    result.push({ time: trs[i].t, value: parseFloat(atr.toFixed(4)) })
  }
  return result
}

export function computeParabolicSAR(bars, step = 0.02, maxStep = 0.2) {
  if (!bars || bars.length < 2) return []
  const result = []
  let isUptrend = bars[1].c > bars[0].c
  let sar = isUptrend ? bars[0].l : bars[0].h
  let ep  = isUptrend ? bars[0].h : bars[0].l
  let af  = step

  for (let i = 1; i < bars.length; i++) {
    const bar = bars[i]
    // Project SAR for this bar
    let nextSar = sar + af * (ep - sar)
    if (isUptrend) {
      // SAR must be at or below the two prior lows
      if (i >= 2) nextSar = Math.min(nextSar, bars[i - 1].l, bars[i - 2].l)
      else        nextSar = Math.min(nextSar, bars[i - 1].l)
      if (bar.l < nextSar) {
        // Reversal to downtrend
        isUptrend = false
        nextSar = ep
        ep = bar.l
        af = step
      } else {
        if (bar.h > ep) { ep = bar.h; af = Math.min(af + step, maxStep) }
      }
    } else {
      // SAR must be at or above the two prior highs
      if (i >= 2) nextSar = Math.max(nextSar, bars[i - 1].h, bars[i - 2].h)
      else        nextSar = Math.max(nextSar, bars[i - 1].h)
      if (bar.h > nextSar) {
        // Reversal to uptrend
        isUptrend = true
        nextSar = ep
        ep = bar.h
        af = step
      } else {
        if (bar.l < ep) { ep = bar.l; af = Math.min(af + step, maxStep) }
      }
    }
    sar = nextSar
    result.push({ time: bar.t, value: parseFloat(sar.toFixed(4)), isUptrend })
  }
  return result
}
