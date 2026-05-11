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
    const std = Math.sqrt(sqSum / period)
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

export function computeIchimoku(bars, tenkanPeriod = 9, kijunPeriod = 26, senkouBPeriod = 52) {
  if (!bars || bars.length < senkouBPeriod) return { tenkan: [], kijun: [], spanA: [], spanB: [], chikou: [] }

  function periodMid(bars, end, period) {
    let hi = -Infinity, lo = Infinity
    for (let j = end - period + 1; j <= end; j++) {
      if (bars[j].h > hi) hi = bars[j].h
      if (bars[j].l < lo) lo = bars[j].l
    }
    return (hi + lo) / 2
  }

  const tenkan = [], kijun = [], spanA = [], spanB = [], chikou = []
  const displacement = kijunPeriod  // 26

  for (let i = senkouBPeriod - 1; i < bars.length; i++) {
    const t = bars[i].t
    const tk = parseFloat(periodMid(bars, i, tenkanPeriod).toFixed(4))
    const kj = parseFloat(periodMid(bars, i, kijunPeriod).toFixed(4))
    const sb = parseFloat(periodMid(bars, i, senkouBPeriod).toFixed(4))
    tenkan.push({ time: t, value: tk })
    kijun.push({ time: t, value: kj })
    spanA.push({ time: t, value: parseFloat(((tk + kj) / 2).toFixed(4)) })
    spanB.push({ time: t, value: sb })
    // Chikou: close plotted 26 bars BACK
    if (i >= displacement) {
      chikou.push({ time: bars[i - displacement].t, value: parseFloat(bars[i].c.toFixed(4)) })
    }
  }

  return { tenkan, kijun, spanA, spanB, chikou }
}

// ─── Money Flow Index (MFI) ──────────────────────────────────────────────────
// Typical price = (h + l + c) / 3
// Money flow = typical * volume
// Positive money flow accumulates when typical[i] > typical[i-1]; negative when <.
// MFI = 100 - (100 / (1 + PMF_sum / NMF_sum)) over the rolling `period`.

export function computeMFI(bars, period = 14) {
  if (!bars || bars.length < period + 1) return []
  // Pre-compute typical price and raw money flow for every bar
  const tp = new Array(bars.length)
  const flow = new Array(bars.length)
  for (let i = 0; i < bars.length; i++) {
    tp[i] = (bars[i].h + bars[i].l + bars[i].c) / 3
    flow[i] = tp[i] * (bars[i].v || 0)
  }
  const result = []
  // First MFI value lands at bars[period] (needs `period` directional flows starting at i=1)
  for (let i = period; i < bars.length; i++) {
    let pmf = 0, nmf = 0
    for (let j = i - period + 1; j <= i; j++) {
      if (tp[j] > tp[j - 1])      pmf += flow[j]
      else if (tp[j] < tp[j - 1]) nmf += flow[j]
    }
    let mfi
    if (nmf === 0) mfi = 100
    else mfi = 100 - 100 / (1 + pmf / nmf)
    result.push({ time: bars[i].t, value: parseFloat(mfi.toFixed(2)) })
  }
  return result
}

// ─── Commodity Channel Index (CCI) ───────────────────────────────────────────
// Typical = (h + l + c) / 3
// SMA over `period` of typical
// MAD = mean(|typical - SMA|) over period
// CCI = (typical - SMA) / (0.015 * MAD)

export function computeCCI(bars, period = 20) {
  if (!bars || bars.length < period) return []
  const tp = new Array(bars.length)
  for (let i = 0; i < bars.length; i++) tp[i] = (bars[i].h + bars[i].l + bars[i].c) / 3
  const result = []
  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += tp[j]
    const sma = sum / period
    let mad = 0
    for (let j = i - period + 1; j <= i; j++) mad += Math.abs(tp[j] - sma)
    mad /= period
    const cci = mad === 0 ? 0 : (tp[i] - sma) / (0.015 * mad)
    result.push({ time: bars[i].t, value: parseFloat(cci.toFixed(2)) })
  }
  return result
}

// ─── Williams %R ─────────────────────────────────────────────────────────────
// HH = max(high) over period, LL = min(low) over period
// %R = -100 * (HH - close) / (HH - LL)
// Range is [-100, 0]; -20 is overbought, -80 oversold.

export function computeWilliamsR(bars, period = 14) {
  if (!bars || bars.length < period) return []
  const result = []
  for (let i = period - 1; i < bars.length; i++) {
    let hh = -Infinity, ll = Infinity
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j].h > hh) hh = bars[j].h
      if (bars[j].l < ll) ll = bars[j].l
    }
    const range = hh - ll
    const r = range === 0 ? 0 : -100 * (hh - bars[i].c) / range
    result.push({ time: bars[i].t, value: parseFloat(r.toFixed(2)) })
  }
  return result
}

// ─── Average Directional Index (ADX / DMI) ───────────────────────────────────
// +DM = h[i] - h[i-1]  (if positive AND greater than l[i-1] - l[i], else 0)
// -DM = l[i-1] - l[i]  (if positive AND greater than h[i] - h[i-1], else 0)
// TR  = max(h-l, |h - c[i-1]|, |l - c[i-1]|)
// Wilder smoothing of +DM, -DM, TR over `period`
// +DI = 100 * smoothed_+DM / smoothed_TR
// -DI = 100 * smoothed_-DM / smoothed_TR
// DX  = 100 * |+DI - -DI| / (+DI + -DI)
// ADX = Wilder-smoothed DX over `period`
// First ADX value lands at bars[2*period - 1].

export function computeADX(bars, period = 14) {
  const empty = { adx: [], plusDI: [], minusDI: [] }
  if (!bars || bars.length < 2 * period) return empty
  // Step 1: per-bar +DM, -DM, TR (starting at i=1)
  const plusDM  = new Array(bars.length).fill(0)
  const minusDM = new Array(bars.length).fill(0)
  const tr      = new Array(bars.length).fill(0)
  for (let i = 1; i < bars.length; i++) {
    const up   = bars[i].h - bars[i - 1].h
    const down = bars[i - 1].l - bars[i].l
    plusDM[i]  = (up > down && up > 0)   ? up   : 0
    minusDM[i] = (down > up && down > 0) ? down : 0
    tr[i] = Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i - 1].c),
      Math.abs(bars[i].l - bars[i - 1].c),
    )
  }
  // Step 2: Wilder-smooth +DM, -DM, TR. Seed = sum of first `period` values (indices 1..period).
  let sPlus = 0, sMinus = 0, sTR = 0
  for (let i = 1; i <= period; i++) { sPlus += plusDM[i]; sMinus += minusDM[i]; sTR += tr[i] }
  // After seeding, first +DI/-DI/DX value corresponds to bars[period]
  const plusDI = [], minusDI = [], dxValues = []
  const pushDI = (idx) => {
    const pdi = sTR === 0 ? 0 : 100 * sPlus / sTR
    const mdi = sTR === 0 ? 0 : 100 * sMinus / sTR
    const sum = pdi + mdi
    const dx = sum === 0 ? 0 : 100 * Math.abs(pdi - mdi) / sum
    plusDI.push({ time: bars[idx].t, value: parseFloat(pdi.toFixed(2)) })
    minusDI.push({ time: bars[idx].t, value: parseFloat(mdi.toFixed(2)) })
    dxValues.push({ time: bars[idx].t, value: dx })
  }
  pushDI(period)
  for (let i = period + 1; i < bars.length; i++) {
    sPlus  = sPlus  - sPlus  / period + plusDM[i]
    sMinus = sMinus - sMinus / period + minusDM[i]
    sTR    = sTR    - sTR    / period + tr[i]
    pushDI(i)
  }
  // Step 3: Wilder-smooth DX over `period` to get ADX.
  // First ADX value seeds at sum of first `period` DX values → corresponds to bars[2*period - 1].
  if (dxValues.length < period) return { adx: [], plusDI, minusDI }
  let adx = 0
  for (let i = 0; i < period; i++) adx += dxValues[i].value
  adx /= period
  const adxOut = [{ time: dxValues[period - 1].time, value: parseFloat(adx.toFixed(2)) }]
  for (let i = period; i < dxValues.length; i++) {
    adx = (adx * (period - 1) + dxValues[i].value) / period
    adxOut.push({ time: dxValues[i].time, value: parseFloat(adx.toFixed(2)) })
  }
  return { adx: adxOut, plusDI, minusDI }
}

// ─── On-Balance Volume (OBV) ────────────────────────────────────────────────
// OBV[0] = 0
// OBV[i] = OBV[i-1] + v[i] if c[i] > c[i-1]
//        = OBV[i-1] - v[i] if c[i] < c[i-1]
//        = OBV[i-1]        otherwise

export function computeOBV(bars) {
  if (!bars?.length) return []
  const result = [{ time: bars[0].t, value: 0 }]
  let obv = 0
  for (let i = 1; i < bars.length; i++) {
    const v = bars[i].v || 0
    if (bars[i].c > bars[i - 1].c)      obv += v
    else if (bars[i].c < bars[i - 1].c) obv -= v
    result.push({ time: bars[i].t, value: obv })
  }
  return result
}

// ─── Donchian Channels ───────────────────────────────────────────────────────
// upper  = highest high over `period`
// lower  = lowest  low  over `period`
// middle = (upper + lower) / 2

export function computeDonchian(bars, period = 20) {
  const empty = { upper: [], middle: [], lower: [] }
  if (!bars || bars.length < period) return empty
  const upper = [], middle = [], lower = []
  for (let i = period - 1; i < bars.length; i++) {
    let hi = -Infinity, lo = Infinity
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j].h > hi) hi = bars[j].h
      if (bars[j].l < lo) lo = bars[j].l
    }
    const mid = (hi + lo) / 2
    const t = bars[i].t
    upper.push({  time: t, value: parseFloat(hi.toFixed(4)) })
    middle.push({ time: t, value: parseFloat(mid.toFixed(4)) })
    lower.push({  time: t, value: parseFloat(lo.toFixed(4)) })
  }
  return { upper, middle, lower }
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
