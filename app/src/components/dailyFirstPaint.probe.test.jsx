/**
 * DAILY FIRST-PAINT PROBE (investigation harness — not a product test).
 *
 * Drives the REAL StockChart through a SYMBOL SWITCH on the daily timeframe with
 * the same props the member-facing ChartPane passes, and records:
 *   - every setVisibleLogicalRange attempt + the EFFECTIVE range after each commit
 *   - every candle-series setData/update payload (what was actually RENDERED)
 * then classifies the first-target-frame vs final-frame diff.
 *
 * ⚠️ THIS IS THE ARITHMETIC RAIL, NOT THE PRODUCT RAIL. It force-feeds bar arrays
 * through `barsOverride`, which BYPASSES the daily paint-authority gate entirely — so
 * a scenario here showing a shift means "if such a dataset ever reached the screen,
 * the frame would move by N", not "the product does this". Whether such a dataset can
 * reach the screen is what `dailyFirstPaintAcceptance.test.jsx` measures, through the
 * real IDB -> pack -> history -> /api/bars selector. Read the two together: the cases
 * beyond DAILY_RESERVE_MAX still shift here and are REFUSED paint authority there.
 *
 * SILENCE IS INVALID: a scenario that cannot show its stimulus (a target-symbol
 * candle paint) and its observation (an effective visible range) returns INVALID,
 * never PASS.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'

const spy = vi.hoisted(() => ({ setVisibleLogicalRange: null, last: null }))
const seriesLog = vi.hoisted(() => ({ calls: [] }))

vi.mock('./chart/ChartVLineOverlay', () => ({ default: () => null }))

vi.mock('lightweight-charts', () => {
  let _sid = 0
  const mkSeries = () => {
    const id = ++_sid
    return {
    setData: (d) => { seriesLog.calls.push({ id, op: 'setData', data: d }) },
    update: (d) => { seriesLog.calls.push({ id, op: 'update', data: d }) },
    applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
    attachPrimitive: () => {}, detachPrimitive: () => {},
    priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
    dataByIndex: () => null, getPane: () => ({ getHeight: () => 300, paneIndex: () => 0 }),
    barsInLogicalRange: () => null, data: () => [], seriesType: () => 'Candlestick',
    }
  }
  const timeScale = {
    applyOptions: () => {}, fitContent: () => {},
    setVisibleLogicalRange: (r) => { spy.setVisibleLogicalRange?.(r); spy.last = r },
    getVisibleLogicalRange: () => spy.last,
    setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
    unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
    resetTimeScale: () => {}, options: () => ({}), width: () => 900,
    subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    getVisibleRange: () => null, coordinateToLogical: () => 0, logicalToCoordinate: () => 0,
    timeToIndex: () => 0, height: () => 40, scrollPosition: () => 0,
  }
  const chart = {
    addSeries: () => mkSeries(), addCandlestickSeries: () => mkSeries(), addHistogramSeries: () => mkSeries(),
    addLineSeries: () => mkSeries(), addAreaSeries: () => mkSeries(), addBarSeries: () => mkSeries(),
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale,
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {},
    subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {}, AreaSeries: {}, BarSeries: {},
    createSeriesMarkers: () => ({ setMarkers: () => {} }),
    BaselineSeries: {}, LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
  }
})

vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))
vi.mock('../utils/barsIDB', () => ({
  idbGet: async () => null, idbPut: async () => {}, mergeDelta: (_a, b) => b,
}))

beforeEach(() => {
  cleanup()
  spy.setVisibleLogicalRange = vi.fn()
  spy.last = null
  seriesLog.calls = []
  try { localStorage.clear() } catch { /* jsdom always has it */ }
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})

const StockChartMod = await import('./StockChart')
const StockChart = StockChartMod.default
const { _intradayLoadReserve, _developingBarISO } = StockChartMod

const TODAY = (() => {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const p = (n) => String(n).padStart(2, '0')
  return `${et.getFullYear()}-${p(et.getMonth() + 1)}-${p(et.getDate())}`
})()

function sessionDates(n) {
  const out = []
  const d = new Date(`${TODAY}T12:00:00Z`)
  while (out.length < n) {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) out.unshift(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}
const DATES = sessionDates(320)
const mkBars = (dates, seed = 0) => dates.map((t, i) => ({
  t, o: 100 + i + seed, h: 101 + i + seed, l: 99 + i + seed, c: 100.5 + i + seed, v: 1000000 + i,
}))
const FULL = mkBars(DATES)
const endingAt = (backSessions) => FULL.slice(0, FULL.length - backSessions)

const PANE_PROPS = {
  tf: 'D', keepPresentOnSymbolChange: true, carryDragPlacement: true,
  rightPadBars: 6, dailyDefaultBars: 126, viewLockKey: 'uct.probe.viewLock',
}

// ── RENDERED-STATE REDUCER ─────────────────────────────────────────────────
// The candle series is mutated by BOTH setData (full repaint) and update (the
// incremental developing-bar path). An observer that reads only setData payloads
// is BLIND to every incremental correction — which is exactly how a stale-wick
// control can silently pass. Replay the ops in order instead.
function candleSeriesId() {
  let id = null
  for (const c of seriesLog.calls) {
    if (c.op === 'setData' && Array.isArray(c.data) && c.data.some((x) => x && x.open !== undefined)) id = c.id
  }
  return id
}
function lastCandleData() {
  const id = candleSeriesId()
  if (id == null) return null
  let arr = null
  for (const c of seriesLog.calls) {
    if (c.id !== id) continue
    if (c.op === 'setData') { arr = Array.isArray(c.data) ? c.data.slice() : null; continue }
    if (c.op === 'update' && arr && c.data) {
      const pt = c.data
      if (arr.length && arr[arr.length - 1] && arr[arr.length - 1].time === pt.time) arr[arr.length - 1] = pt
      else arr.push(pt)
    }
  }
  return arr
}
const opsSince = (n) => seriesLog.calls.slice(n).filter((c) => c.id === candleSeriesId()).map((c) => c.op)
const frame = () => (spy.last ? { from: +Number(spy.last.from).toFixed(3), to: +Number(spy.last.to).toFixed(3) } : null)

async function settle() {
  await new Promise((r) => setTimeout(r, 40))
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  await new Promise((r) => setTimeout(r, 40))
}

async function runSwitch({ name, cacheBars, fetchBars, killObservation = false, cameraKick = 0, disableSeed = false }) {
  if (disableSeed) { try { localStorage.setItem('uct.intradayLoadAnchor.enabled', '0') } catch { /* jsdom */ } }
  const PRIOR = mkBars(DATES.slice(0, 300), 5)
  const { rerender, unmount } = render(<StockChart sym="AAA" barsOverride={PRIOR} {...PANE_PROPS} />)
  await waitFor(() => expect(spy.setVisibleLogicalRange).toHaveBeenCalled(), { timeout: 5000 })
  await settle()

  seriesLog.calls = []
  spy.setVisibleLogicalRange.mockClear()
  rerender(<StockChart sym="BBB" barsOverride={killObservation ? [] : cacheBars} {...PANE_PROPS} />)
  await settle()
  const firstPaint = lastCandleData()
  const firstFrame = frame()
  const firstAttempts = spy.setVisibleLogicalRange.mock.calls.length
  const opsMark = seriesLog.calls.length

  spy.setVisibleLogicalRange.mockClear()
  if (cameraKick) {
    spy.last = { from: spy.last.from + cameraKick, to: spy.last.to + cameraKick }
    rerender(<StockChart sym="BBB" barsOverride={killObservation ? [] : cacheBars} {...PANE_PROPS} />)
  } else {
    rerender(<StockChart sym="BBB" barsOverride={killObservation ? [] : fetchBars} {...PANE_PROPS} />)
  }
  await settle()
  const finalPaint = lastCandleData()
  const finalFrame = frame()
  const finalOps = opsSince(opsMark)
  unmount()

  if (!firstPaint || !firstPaint.length) {
    return { name, verdict: 'INVALID', why: 'no target-symbol candle data rendered' }
  }
  if (!firstFrame || !finalFrame) {
    return { name, verdict: 'INVALID', why: 'no effective visible range observed' }
  }
  if (!firstAttempts) {
    return { name, verdict: 'INVALID', why: 'no framing call on the target commit' }
  }

  const lastT = (arr) => (arr && arr.length ? arr[arr.length - 1].time : null)
  const firstLastT = lastT(firstPaint)
  const finalLastT = lastT(finalPaint)
  const shift = +(finalFrame.to - firstFrame.to).toFixed(3)
  const widthDelta = +(((finalFrame.to - finalFrame.from) - (firstFrame.to - firstFrame.from))).toFixed(3)

  const flags = []
  const fLast = firstPaint[firstPaint.length - 1]
  const firstTodayIsHole = firstLastT === TODAY && (!fLast || fLast.open === undefined)
  if (firstLastT !== TODAY) flags.push('TODAY_MISSING_AT_FIRST_PAINT')
  else if (firstTodayIsHole) flags.push('TODAY_IS_WHITESPACE_AT_FIRST_PAINT')
  if (firstPaint.length !== finalPaint.length || firstLastT !== finalLastT) {
    flags.push('TIME_DOMAIN_CHANGED_AFTER_FIRST_PAINT')
  }
  if (Math.abs(shift) > 0.01) flags.push('VISIBLE_RANGE_CHANGED')
  const fT = firstPaint[firstPaint.length - 1]
  const lT2 = finalPaint[finalPaint.length - 1]
  if (fT && lT2 && fT.time === lT2.time
      && (fT.high !== lT2.high || fT.low !== lT2.low || fT.close !== lT2.close)) {
    flags.push('TODAY_OHLC_NOT_CURRENT')
  }

  return {
    name,
    verdict: flags.length ? 'FAIL' : 'PASS',
    flags,
    firstN: firstPaint.length,
    finalN: finalPaint.length,
    firstLastT,
    finalLastT,
    firstFrame,
    finalFrame,
    shiftBars: shift,
    widthDelta,
    finalOps: finalOps.join(','),
    reserveAtFirstPaint: _intradayLoadReserve(cacheBars, 'D'),
    firstTodayHL: fT ? [fT.high, fT.low, fT.close] : null,
    finalTodayHL: lT2 ? [lT2.high, lT2.low, lT2.close] : null,
  }
}

/**
 * MULTI-PHASE runner: production delivers a daily chart in up to four commits
 * (mem/IDB provisional -> edge sealed history -> /api/bars tail -> deep backfill).
 * Record the effective frame + rendered series after EVERY phase, so a shift that
 * only appears between phases 3 and 4 is not averaged away by a two-point diff.
 */
async function runPhases({ name, phases }) {
  const PRIOR = mkBars(DATES.slice(0, 300), 5)
  const { rerender, unmount } = render(<StockChart sym="AAA" barsOverride={PRIOR} {...PANE_PROPS} />)
  await waitFor(() => expect(spy.setVisibleLogicalRange).toHaveBeenCalled(), { timeout: 5000 })
  await settle()
  seriesLog.calls = []
  spy.setVisibleLogicalRange.mockClear()

  const snaps = []
  for (const ph of phases) {
    rerender(<StockChart sym="BBB" barsOverride={ph.bars} {...PANE_PROPS} />)
    await settle()
    const data = lastCandleData()
    snaps.push({
      phase: ph.label,
      realN: ph.bars.length,
      seriesN: data ? data.length : 0,
      lastT: data && data.length ? data[data.length - 1].time : null,
      hole: !!(data && data.length && data[data.length - 1].open === undefined),
      frame: frame(),
      rsv: _intradayLoadReserve(ph.bars, 'D'),
    })
  }
  unmount()
  if (snaps.some((x) => !x.seriesN || !x.frame)) {
    return { name, verdict: 'INVALID', why: 'a phase rendered nothing or produced no frame', snaps }
  }
  const shifts = snaps.slice(1).map((x, i) => +(x.frame.to - snaps[i].frame.to).toFixed(3))
  return {
    name,
    verdict: shifts.some((d) => Math.abs(d) > 0.01) ? 'FAIL' : 'PASS',
    shifts,
    snaps: snaps.map((x) => `${x.phase}: real=${x.realN} series=${x.seriesN} lastT=${x.lastT}${x.hole ? '(HOLE)' : ''} rsv=${x.rsv} to=${x.frame.to}`),
  }
}

const RESULTS = []
const report = (r) => { RESULTS.push(r); console.log('[PROBE] ' + JSON.stringify(r)) }

describe('DAILY first-paint probe', () => {
  it('session guard - only meaningful on a trading day', () => {
    expect(_developingBarISO('D')).toBe(TODAY)
  })

  it('S1 WARM: cache already carries today', async () => {
    report(await runSwitch({ name: 'S1 warm', cacheBars: FULL, fetchBars: FULL }))
  }, 30000)

  it('S2 STALE-1: cache ends at the previous session', async () => {
    report(await runSwitch({ name: 'S2 stale-1', cacheBars: endingAt(1), fetchBars: FULL }))
  }, 30000)

  it('S3 STALE-2: cache ends two sessions back', async () => {
    report(await runSwitch({ name: 'S3 stale-2', cacheBars: endingAt(2), fetchBars: FULL }))
  }, 30000)

  it('S4 STALE-3: cache ends three sessions back', async () => {
    report(await runSwitch({ name: 'S4 stale-3', cacheBars: endingAt(3), fetchBars: FULL }))
  }, 30000)

  it('S5 STALE-5: cache ends five sessions back', async () => {
    report(await runSwitch({ name: 'S5 stale-5', cacheBars: endingAt(5), fetchBars: FULL }))
  }, 30000)

  it('NC-C stale wick at first paint', async () => {
    const t = FULL[FULL.length - 1]
    const staleToday = FULL.slice(0, -1).concat([{ ...t, h: t.h - 3, l: t.l + 2 }])
    report(await runSwitch({ name: 'NC-C stale wick', cacheBars: staleToday, fetchBars: FULL }))
  }, 30000)

  it('NC-A missing today at first paint (seed off)', async () => {
    report(await runSwitch({ name: 'NC-A missing today', cacheBars: endingAt(1), fetchBars: FULL, disableSeed: true }))
  }, 30000)

  it('NC-B late today insertion (seed off)', async () => {
    report(await runSwitch({ name: 'NC-B late insertion', cacheBars: endingAt(1), fetchBars: FULL, disableSeed: true }))
  }, 30000)

  // Production-faithful: /api/bars is MERGED into the deep set (mergeDelta), it does
  // not replace it - so the only real change at the right edge is the bars added.
  it('S6 cold sequence, sealed source current (ends yesterday)', async () => {
    report(await runPhases({ name: 'S6 sealed=yday', phases: [
      { label: 'edge-sealed', bars: endingAt(1) },
      { label: 'tail-merged', bars: FULL },
    ] }))
  }, 40000)

  it('S7 cold sequence, sealed source two sessions behind', async () => {
    report(await runPhases({ name: 'S7 sealed=-2', phases: [
      { label: 'edge-sealed', bars: endingAt(2) },
      { label: 'tail-merged', bars: FULL },
    ] }))
  }, 40000)

  it('S8 cold sequence, sealed source far behind (PLL class)', async () => {
    report(await runPhases({ name: 'S8 sealed=-250', phases: [
      { label: 'edge-sealed', bars: endingAt(250) },
      { label: 'tail-merged', bars: FULL },
    ] }))
  }, 40000)

  it('NC-D camera move after first paint', async () => {
    report(await runSwitch({ name: 'NC-D camera move', cacheBars: FULL, fetchBars: FULL, cameraKick: 4 }))
  }, 30000)

  it('NC-E dead observation returns INVALID', async () => {
    report(await runSwitch({ name: 'NC-E dead observation', cacheBars: FULL, fetchBars: FULL, killObservation: true }))
  }, 30000)

  it('SUMMARY', () => {
    const NL = String.fromCharCode(10) + '      '
    const lines = RESULTS.map((r) => (r.snaps ? [
      String(r.verdict).padEnd(7), r.name.padEnd(22),
      'shifts ' + JSON.stringify(r.shifts || null), (r.why || ''), NL + r.snaps.join(NL),
    ].join(' | ') : [
      String(r.verdict).padEnd(7),
      r.name.padEnd(22),
      ((r.flags || []).join(',') || r.why || '-').padEnd(52),
      'n ' + r.firstN + '->' + r.finalN,
      'lastT ' + r.firstLastT + '->' + r.finalLastT,
      'to ' + (r.firstFrame && r.firstFrame.to) + '->' + (r.finalFrame && r.finalFrame.to),
      'shift ' + r.shiftBars,
      'rsv ' + r.reserveAtFirstPaint,
    ].join(' | ')))
    console.log('[PROBE-SUMMARY]\n' + lines.join('\n'))
    expect(RESULTS.length).toBe(13)
  })
})
