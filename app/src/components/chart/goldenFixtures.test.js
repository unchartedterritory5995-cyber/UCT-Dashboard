/**
 * Golden-fixture tests — the JS half of the shared indicator oracle.
 *
 * These read the EXACT SAME JSON files as `tests/test_indicator_golden.py`, in
 * `tests/fixtures/indicators/`. The contract, the alignment rule, the tolerance
 * rule and the ban on regenerating fixtures live in that directory's
 * `_schema.md` — read it before changing anything here.
 *
 * The point: RSI (and six friends) have two independent implementations, one
 * here and one in `api/services/indicator_compute.py`. Before these fixtures
 * they could disagree silently and forever. Now they can't.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  computeRSI,
  computeMACD,
  computeBB,
  computeStochastic,
  computeMFI,
  computeCCI,
  computeWilliamsR,
  computeVWAP,
} from './indicators'

// vitest is normally run from `app/`, but the same suite has to resolve when it
// is driven from the repo root. Probe both rather than assuming a cwd, and fail
// LOUDLY if neither hits — a suite that silently found no fixtures would pass by
// running zero assertions.
const FIX = [
  join(process.cwd(), '..', 'tests', 'fixtures', 'indicators'),
  join(process.cwd(), 'tests', 'fixtures', 'indicators'),
].find(p => existsSync(join(p, 'rsi_ramp_14.json')))
if (!FIX) {
  throw new Error(
    `indicator fixtures not found from cwd ${process.cwd()} — expected `
    + `tests/fixtures/indicators/ at the repo root`,
  )
}
const loadCase = (n) => JSON.parse(readFileSync(join(FIX, `${n}.json`), 'utf8'))

/**
 * A case's bars, whether it OWNS them or NAMES the file that does.
 *
 * `barsFrom` is a repo-root-relative path (POSIX separators). `intraday5m_sessions`
 * uses it to point at `app/src/pages/parityBars/intraday5m.json` — the bar fixture
 * `tools/chart_parity.py` renders through `?fixedbars=`. Resolving it, rather than
 * copying the series into the fixture, is what makes the compute oracle and the
 * pixel gate provably the same 579 bars: regenerate that file and these `expected`
 * columns go red in both lanes, which is exactly what should happen — every parity
 * number measured against those bars has just expired.
 */
const caseBars = (c) => {
  if (c.bars) return c.bars
  const path = join(FIX, '..', '..', '..', ...c.barsFrom.split('/'))
  if (!existsSync(path)) throw new Error(`${c.case}: barsFrom ${c.barsFrom} does not exist`)
  return JSON.parse(readFileSync(path, 'utf8')).bars
}

/** Pull the plain numeric column out of a [{time, value}] series. */
const col = (series) => series.map(p => p.value)

/**
 * The fixture comparison. `got` is a plain number array (NaN where the
 * indicator is not computable), `exp` is the fixture column (null where it is
 * not computable).
 *
 * Tolerance is relative with an absolute floor — `relTol * max(1, |exp|)` — so
 * a column that legitimately crosses zero (MACD histogram, CCI) is not held to
 * an impossible relative bar.
 */
const alignedClose = (got, exp, relTol, label) => {
  expect(got.length, `${label}: not aligned to bars`).toBe(exp.length)
  got.forEach((g, i) => {
    if (exp[i] === null) {
      expect(Number.isNaN(g), `${label}[${i}]: expected the NaN pad, got ${g}`).toBe(true)
      return
    }
    const ok = Math.abs(g - exp[i]) <= relTol * Math.max(1, Math.abs(exp[i]))
    expect(ok, `${label}[${i}]: ${g} != ${exp[i]}`).toBe(true)
  })
}

/** Guard against a fixture that asserts nothing because it is all padding. */
const expectSomeValues = (exp, label) => {
  expect(exp.some(v => v !== null), `${label}: fixture column is entirely null`).toBe(true)
}

describe('golden fixtures — shared with the Python lane', () => {
  it('rsi_ramp_14', () => {
    const c = loadCase('rsi_ramp_14')
    const got = col(computeRSI(c.bars, c.params.period))
    expectSomeValues(c.expected.rsi, 'rsi_ramp_14.rsi')
    alignedClose(got, c.expected.rsi, c.relTol, 'rsi_ramp_14.rsi')
  })

  it('macd_default', () => {
    const c = loadCase('macd_default')
    const got = computeMACD(c.bars, c.params.fast, c.params.slow, c.params.signal)
    expectSomeValues(c.expected.macd, 'macd_default.macd')
    alignedClose(col(got.macd), c.expected.macd, c.relTol, 'macd_default.macd')
    alignedClose(col(got.signal), c.expected.signal, c.relTol, 'macd_default.signal')
    alignedClose(col(got.histogram), c.expected.histogram, c.relTol, 'macd_default.histogram')
  })

  it('bb_20_2', () => {
    const c = loadCase('bb_20_2')
    const got = computeBB(c.bars, c.params.period, c.params.stddev)
    expectSomeValues(c.expected.middle, 'bb_20_2.middle')
    alignedClose(col(got.upper), c.expected.upper, c.relTol, 'bb_20_2.upper')
    alignedClose(col(got.middle), c.expected.middle, c.relTol, 'bb_20_2.middle')
    alignedClose(col(got.lower), c.expected.lower, c.relTol, 'bb_20_2.lower')
  })

  it('stoch_14_3', () => {
    const c = loadCase('stoch_14_3')
    const got = computeStochastic(c.bars, c.params.k_period, c.params.d_period)
    expectSomeValues(c.expected.k, 'stoch_14_3.k')
    alignedClose(col(got.k), c.expected.k, c.relTol, 'stoch_14_3.k')
    alignedClose(col(got.d), c.expected.d, c.relTol, 'stoch_14_3.d')
    // %K and %D used to come back at DIFFERENT lengths here. They can't now.
    expect(got.k.length).toBe(got.d.length)
  })

  it('williams_r_14', () => {
    const c = loadCase('williams_r_14')
    const got = col(computeWilliamsR(c.bars, c.params.period))
    expectSomeValues(c.expected.williams_r, 'williams_r_14.williams_r')
    alignedClose(got, c.expected.williams_r, c.relTol, 'williams_r_14.williams_r')
  })

  it('cci_20', () => {
    const c = loadCase('cci_20')
    const got = col(computeCCI(c.bars, c.params.period))
    expectSomeValues(c.expected.cci, 'cci_20.cci')
    alignedClose(got, c.expected.cci, c.relTol, 'cci_20.cci')
  })

  it('mfi_14', () => {
    const c = loadCase('mfi_14')
    const got = col(computeMFI(c.bars, c.params.period))
    expectSomeValues(c.expected.mfi, 'mfi_14.mfi')
    alignedClose(got, c.expected.mfi, c.relTol, 'mfi_14.mfi')
  })

  it('intraday5m_sessions — the same 5-minute bars the PIXEL gate renders', () => {
    // MFI on purpose: it is the only indicator both lanes implement that is
    // built from typical price TIMES VOLUME, which is the arithmetic VWAP is
    // made of. Agreement at 1e-9 here is agreement about the sums B3 Task 8's
    // VWAP numbers will be measured on — on the exact series, not a lookalike.
    const c = loadCase('intraday5m_sessions')
    const bars = caseBars(c)
    const got = col(computeMFI(bars, c.params.period))
    expectSomeValues(c.expected.mfi, 'intraday5m_sessions.mfi')
    alignedClose(got, c.expected.mfi, c.relTol, 'intraday5m_sessions.mfi')
  })
})

// ─── the two session traps ───────────────────────────────────────────────────
// computeVWAP buckets sessions by UTC calendar day. Regular trading hours never
// notice (09:30–16:00 ET is always one UTC day), which is exactly why no unit
// test ever caught it. These two cases pin TODAY'S behaviour — they are green
// now, on purpose — alongside proof that today's answer is materially wrong,
// so the case can never quietly become vacuous. Fixing the bucketing (B3's
// session-aware adapter) turns the first assertion in each red: that red is the
// fix's acceptance test, and the correct series is already in the fixture as
// `session.etSessionVwap`.

const typicalPrice = (b) => (b.h + b.l + b.c) / 3

describe('computeVWAP session boundaries (pinned bug class)', () => {
  it('vwap_extended_hours_utc_midnight: the 20:00 ET bar restarts the session', () => {
    const c = loadCase('vwap_extended_hours_utc_midnight')
    const s = c.session
    const got = col(computeVWAP(c.bars))
    expect(got.length).toBe(c.bars.length)

    // One continuous ET session…
    expect(new Set(s.etDate).size).toBe(1)
    // …split into two by UTC-day bucketing, at the 20:00 ET bar.
    expect(s.utcResetIndices.length).toBe(2)
    const splitAt = s.utcResetIndices[1]
    expect(s.etHour[splitAt]).toBe(20)

    // At a reset the cumulative VWAP collapses to that single bar's typical
    // price — the tell that the accumulator was wiped mid-session.
    s.utcResetIndices.forEach(i => {
      expect(got[i]).toBeCloseTo(typicalPrice(c.bars[i]), 9)
    })
    // Every other bar keeps accumulating (strictly more than one bar's worth).
    expect(got[splitAt - 1]).not.toBeCloseTo(typicalPrice(c.bars[splitAt - 1]), 6)

    // And the trap is real, not cosmetic: correct ET-session bucketing gives a
    // materially different number on that bar.
    expect(Math.abs(got[splitAt] - s.etSessionVwap[splitAt])).toBeGreaterThan(1)
  })

  it('vwap_dst_transition: the split moves an hour when the UTC offset does', () => {
    const c = loadCase('vwap_dst_transition')
    const s = c.session
    const got = col(computeVWAP(c.bars))
    expect(got.length).toBe(c.bars.length)

    // Two ET sessions, identical wall-clock shape.
    const etDates = [...new Set(s.etDate)]
    expect(etDates.length).toBe(2)
    const hoursOf = (d) => s.etHour.filter((_, i) => s.etDate[i] === d)
    expect(hoursOf(etDates[0])).toEqual(hoursOf(etDates[1]))

    // The ET hour at which the UTC day flips, per session. EDT (UTC-4) trips at
    // 20:00 ET; EST (UTC-5) trips an hour earlier, at 19:00 ET. Same session,
    // same hours, different split — the boundary tracks the timezone offset,
    // not the trading day.
    const splitHourIn = (d) => {
      const idx = s.utcResetIndices.find(i => s.etDate[i] === d && s.etHour[i] !== hoursOf(d)[0])
      return idx === undefined ? null : s.etHour[idx]
    }
    expect(splitHourIn(etDates[0])).toBe(20)
    expect(splitHourIn(etDates[1])).toBe(19)

    // Both mid-session splits collapse the VWAP to a single bar…
    s.utcResetIndices.forEach(i => {
      expect(got[i]).toBeCloseTo(typicalPrice(c.bars[i]), 9)
    })
    // …and ET bucketing (2 sessions) would have split it half as often.
    expect(s.utcResetIndices.length).toBe(4)
    expect(s.etResetIndices.length).toBe(2)

    // Non-vacuous: the last bar of each session is materially wrong today.
    s.utcResetIndices.slice(1).forEach(i => {
      if (s.etResetIndices.includes(i)) return
      expect(Math.abs(got[i] - s.etSessionVwap[i])).toBeGreaterThan(1)
    })
  })

  it('intraday5m_sessions: a whole ET session is CARRIED OVER, not just split', () => {
    // The trap the two hourly cases above are too short to contain, and the
    // reason the pixel gate needs 3 sessions rather than 2. On EST the
    // 19:00-20:00 ET post-market bars have already opened the NEXT UTC day, so
    // the following session's 04:00 ET open is not a UTC-day boundary at all:
    // it never resets, and its entire session accumulates on top of the
    // previous evening's post-market volume. `computeVWAP` — the shipped
    // function, not a re-implementation — is what is asserted here.
    const c = loadCase('intraday5m_sessions')
    const bars = caseBars(c)
    const s = c.session
    const got = col(computeVWAP(bars))
    expect(got.length).toBe(bars.length)

    // Today's code resets at exactly the UTC-day boundaries the fixture names.
    const resets = got
      .map((_, i) => (i === 0 || s.utcDate[i] !== s.utcDate[i - 1] ? i : -1))
      .filter(i => i >= 0)
    expect(resets).toEqual(s.utcResetIndices)

    // An ET session that opens INSIDE a UTC day is the carry-over.
    const carried = s.etResetIndices.filter(i => !s.utcResetIndices.includes(i))
    expect(carried.length, 'no session is carried over — the case pins nothing new').toBeGreaterThan(0)
    const open = carried[0]
    expect(s.etHour[open]).toBe(4)
    // It does NOT collapse to that bar's typical price — the tell that no reset happened.
    const tp = (bars[open].h + bars[open].l + bars[open].c) / 3
    expect(Math.abs(got[open] - tp)).toBeGreaterThan(1)
    // …and it is materially wrong, in dollars, for most of the session.
    expect(Math.abs(got[open] - s.etSessionVwap[open])).toBeGreaterThan(5)
    const day = s.etDate[open]
    const wrong = got.filter((v, i) => s.etDate[i] === day && Math.abs(v - s.etSessionVwap[i]) > 0.5)
    expect(wrong.length, 'the carried-over session is only wrong for a moment').toBeGreaterThan(100)
  })
})
