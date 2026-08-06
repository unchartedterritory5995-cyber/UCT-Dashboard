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
  computeATR,
  computeADX,
  computeOBV,
  computeDonchian,
  computeIchimoku,
  computeParabolicSAR,
  computeParabolicSAREvents,
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

  // ─── B5: the seven that used to be JS-ONLY ────────────────────────────────
  //
  // `vwap`, `atr`, `sar`, `ichimoku`, `adx`, `obv` and `donchian` had no Python
  // lane, which is why an alert naming one could be STORED and could never FIRE.
  // They are ported now, and these are the port proof: each fixture's `expected`
  // came from the Python core, and this lane — the SHIPPED implementation the
  // chart draws from, untouched by that port — has to reproduce it at 1e-9.
  //
  // ⚠️ THAT DIRECTION IS WHY THE CASES MEAN ANYTHING. A fixture generated from
  // the new code and asserted only by the new code is a snapshot. Asserted HERE
  // it is a cross-language agreement, and every quirk the port had to preserve
  // (OBV's zero seed, Ichimoku's back-shift, SAR's second output) is a number
  // both lanes now have to keep producing.

  it('atr_14', () => {
    const c = loadCase('atr_14')
    const got = col(computeATR(c.bars, c.params.period))
    expectSomeValues(c.expected.atr, 'atr_14.atr')
    alignedClose(got, c.expected.atr, c.relTol, 'atr_14.atr')
  })

  it('adx_14 — and its three columns are the SAME length', () => {
    const c = loadCase('adx_14')
    const got = computeADX(c.bars, c.params.period)
    expectSomeValues(c.expected.adx, 'adx_14.adx')
    alignedClose(col(got.adx), c.expected.adx, c.relTol, 'adx_14.adx')
    alignedClose(col(got.plusDI), c.expected.plusDI, c.relTol, 'adx_14.plusDI')
    alignedClose(col(got.minusDI), c.expected.minusDI, c.relTol, 'adx_14.minusDI')
    // `adx` used to come back SHORTER than its DIs, so nothing could read them
    // together at a given bar. It can't now.
    expect(got.adx.length).toBe(got.plusDI.length)
    expect(got.adx.length).toBe(got.minusDI.length)
  })

  it('obv_basic — including the ZERO SEED at bar 0', () => {
    const c = loadCase('obv_basic')
    const got = col(computeOBV(c.bars))
    expectSomeValues(c.expected.obv, 'obv_basic.obv')
    alignedClose(got, c.expected.obv, c.relTol, 'obv_basic.obv')
    // ⚠️ PRESERVED QUIRK. Every other indicator pads bar 0; OBV seeds it with 0
    // so the line starts at zero on the first bar. `alignedClose` above would be
    // just as happy with a pad on BOTH sides, so the seed gets its own claim.
    expect(c.expected.obv[0]).toBe(0)
    expect(got[0]).toBe(0)
    expect(got.every(Number.isFinite), 'OBV grew a pad it must not have').toBe(true)
  })

  it('donchian_20', () => {
    const c = loadCase('donchian_20')
    const got = computeDonchian(c.bars, c.params.period)
    expectSomeValues(c.expected.middle, 'donchian_20.middle')
    alignedClose(col(got.upper), c.expected.upper, c.relTol, 'donchian_20.upper')
    alignedClose(col(got.middle), c.expected.middle, c.relTol, 'donchian_20.middle')
    alignedClose(col(got.lower), c.expected.lower, c.relTol, 'donchian_20.lower')
  })

  it('ichimoku_9_26_52 — including the chikou BACK-SHIFT and the un-displaced cloud', () => {
    const c = loadCase('ichimoku_9_26_52')
    const got = computeIchimoku(
      c.bars, c.params.tenkan_period, c.params.kijun_period, c.params.senkou_b_period,
    )
    for (const k of ['tenkan', 'kijun', 'spanA', 'spanB', 'chikou']) {
      expectSomeValues(c.expected[k], `ichimoku_9_26_52.${k}`)
      alignedClose(col(got[k]), c.expected[k], c.relTol, `ichimoku_9_26_52.${k}`)
    }
    // ⚠️ PRESERVED QUIRK 1 — chikou is plotted `kijunPeriod` bars BACK, so it is
    // the one column padded at BOTH ends. Asserted as a NUMBER in both
    // directions: the last 26 slots are pad AND the slot before them is not, so
    // a back-shift that grew or shrank goes red rather than looking like a hole.
    const shift = c.params.kijun_period
    const chikou = col(got.chikou)
    expect(chikou.slice(-shift).every(Number.isNaN), 'chikou lost its trailing pad').toBe(true)
    expect(Number.isFinite(chikou[chikou.length - shift - 1]),
      `chikou's trailing pad is longer than ${shift} — the back-shift moved`).toBe(true)
    // ⚠️ PRESERVED QUIRK 2 — spanA/spanB are NOT forward-displaced. Standard
    // Ichimoku pushes the cloud 26 bars into the future, leaving a trailing pad
    // like chikou's mirror image; this one sits over the price that made it, so
    // its LAST bar carries a value.
    expect(Number.isFinite(col(got.spanA).at(-1)), 'spanA became forward-displaced').toBe(true)
    expect(Number.isFinite(col(got.spanB).at(-1)), 'spanB became forward-displaced').toBe(true)
  })

  it('sar_default — including the isUptrend flag that rides alongside', () => {
    const c = loadCase('sar_default')
    const got = computeParabolicSAR(c.bars, c.params.step, c.params.max_step)
    expectSomeValues(c.expected.sar, 'sar_default.sar')
    alignedClose(col(got), c.expected.sar, c.relTol, 'sar_default.sar')
    // ⚠️ PRESERVED QUIRK — the THIRD field. `isUptrend` rides along on each
    // point and the chart consumer strips it before handing data to LWC. The
    // fixture carries it as a numeric ±1 column so it has an oracle at all.
    const trend = got.map(p => (p.isUptrend === undefined ? NaN : (p.isUptrend ? 1 : -1)))
    alignedClose(trend, c.expected.trend, c.relTol, 'sar_default.trend')
    // …and it is a real signal on these bars, not a constant.
    const seen = new Set(c.expected.trend.filter(v => v !== null))
    expect(seen, 'the trend never flips — the column pins nothing').toEqual(new Set([1, -1]))
  })

  // ─── Phase C: SAR's two EVENT columns ─────────────────────────────────────
  //
  // ⭐ THEY COST NO RESEED, AND THAT IS THE POINT. `compute_sar_raw` already
  // returned a ±1 `trend` column and `sar_default.json` has pinned it in BOTH
  // lanes since B5 — so `trendFlipped` is `trend[i] != trend[i-1]` over numbers
  // two lanes already agree on, and `priceCrossedSar` is `(close > sar)` changing
  // over the `sar` column beside it. `sar_events_default` therefore OWNS NO BARS:
  // it points at `sar_default.json` with `barsFrom`, so the two cases cannot
  // drift apart and a reseed of one turns the other red.
  //
  // ⚠️ THE DOMAIN IS `{0, 1, NaN}` AND `NaN` IS NOT "NO EVENT" — it is the warmup
  // pad, exactly as in every plot column. `alignedClose` alone would be satisfied
  // by a column of the right numbers in the wrong TYPE, so the domain gets its
  // own assertion.

  /** Both event columns for a case, as plain number arrays. */
  const sarEventCols = (c, bars) => {
    const got = computeParabolicSAREvents(bars, c.params.step, c.params.max_step)
    return { priceCrossedSar: col(got.priceCrossedSar), trendFlipped: col(got.trendFlipped) }
  }

  const assertEventCase = (name) => {
    const c = loadCase(name)
    const bars = caseBars(c)
    const got = sarEventCols(c, bars)
    for (const key of ['priceCrossedSar', 'trendFlipped']) {
      expectSomeValues(c.expected[key], `${name}.${key}`)
      alignedClose(got[key], c.expected[key], c.relTol, `${name}.${key}`)
      // The domain, in the fixture AND in this lane's output.
      for (let i = 0; i < bars.length; i++) {
        expect(c.expected[key][i] === null || c.expected[key][i] === 0 || c.expected[key][i] === 1,
          `${name}.${key}[${i}] fixture = ${c.expected[key][i]}`).toBe(true)
        expect(got[key][i] === 0 || got[key][i] === 1 || Number.isNaN(got[key][i]),
          `${name}.${key}[${i}] = ${got[key][i]}`).toBe(true)
      }
      // NaN ONLY at bar 0 — the trend seed consumes it. Bar 1 is 0: computable,
      // with no prior side or trend to have moved away from.
      expect(Number.isNaN(got[key][0]), `${name}.${key}[0] must be the pad`).toBe(true)
      expect(got[key].slice(1).every(v => !Number.isNaN(v)),
        `${name}.${key} has a hole after bar 0`).toBe(true)
      // …and it FIRES. A column of all zeros is legal and pins nothing.
      expect(new Set(got[key].slice(1)), `${name}.${key} is constant`).toEqual(new Set([0, 1]))
    }
    return { c, bars, got }
  }

  it('sar_events_default — DERIVED from sar_default\'s already-pinned columns', () => {
    const { c, bars, got } = assertEventCase('sar_events_default')

    // ⭐ THE ORACLE THAT IS NEITHER LANE'S NEW CODE. Recompute both columns from
    // `sar_default.json`'s `sar` and `trend` — numbers this repo has asserted at
    // 1e-9 in two languages since B5 — and require the fixture to equal them. A
    // fixture generated from `compute_sar_events` and asserted only against
    // `computeParabolicSAREvents` would be a snapshot of two things I wrote on
    // the same afternoon; this makes it a derivation from something older.
    const src = loadCase('sar_default')
    expect(c.barsFrom, 'the case grew its own bars').toBe('tests/fixtures/indicators/sar_default.json')
    expect(src.params).toEqual(c.params)
    const pinSar = src.expected.sar
    const pinTrend = src.expected.trend
    const dCrossed = [], dFlipped = []
    for (let i = 0; i < bars.length; i++) {
      const above = (j) => (pinSar[j] === null ? null : bars[j].c > pinSar[j])
      if (i === 0) { dCrossed.push(null); dFlipped.push(null); continue }
      dFlipped.push(pinTrend[i] === null ? null
        : (pinTrend[i - 1] !== null && pinTrend[i - 1] !== pinTrend[i] ? 1 : 0))
      dCrossed.push(above(i) === null ? null
        : (above(i - 1) !== null && above(i - 1) !== above(i) ? 1 : 0))
    }
    expect(c.expected.trendFlipped).toEqual(dFlipped)
    expect(c.expected.priceCrossedSar).toEqual(dCrossed)

    // ⚠️ THE MEASURED LIMIT OF THIS CASE, DECLARED RATHER THAN WISHED AWAY. On
    // these 140 real bars the two columns are element-for-element EQUAL: a side
    // change without a trend change is only reachable around an OUTSIDE reversal
    // bar and this series has none. So this case alone CANNOT tell the two apart,
    // and `sar_events_outside_bar` below is the case that can.
    expect(got.priceCrossedSar).toEqual(got.trendFlipped)
  })

  it('sar_events_outside_bar — the case that proves the two events are TWO columns', () => {
    const { got } = assertEventCase('sar_events_outside_bar')

    // Hand-computed, and every number is on paper in the fixture's `note`.
    // Bar 5 is an outside reversal: its LOW takes out the projected SAR so the
    // trend flips down and the SAR jumps to the prior extreme (108) — but its
    // CLOSE (112) is above that, so the price did not change sides.
    expect(got.trendFlipped[5]).toBe(1)
    expect(got.priceCrossedSar[5]).toBe(0)
    // Bar 6 is the mirror: the downtrend clamps the SAR up to the prior high
    // (113), the close (107) is now below it, and the side changes with no trend
    // change.
    expect(got.trendFlipped[6]).toBe(0)
    expect(got.priceCrossedSar[6]).toBe(1)
    // Which is the whole claim: without this case, returning the SAME column
    // twice — or returning the two the wrong way round — would be invisible.
    expect(got.priceCrossedSar).not.toEqual(got.trendFlipped)
  })

  it('vwap_session_expected — VWAP asserted by BOTH lanes, on the PIXEL gate\'s bars', () => {
    // ⭐ The case that closes the "Python has no VWAP" gap. Its bars are the
    // parity fixture's (via `barsFrom`), so the compute oracle, the rendered
    // picture and the alert lane are provably one series. Its `expected` column
    // is the ET-anchored VWAP — `VWAP_SESSION_ANCHOR`, accepted 2026-08-03 —
    // which the non-vacuity block further down measures against the retired
    // UTC-day bucketing in dollars.
    const c = loadCase('vwap_session_expected')
    const bars = caseBars(c)
    const got = col(computeVWAP(bars))
    expectSomeValues(c.expected.vwap, 'vwap_session_expected.vwap')
    alignedClose(got, c.expected.vwap, c.relTol, 'vwap_session_expected.vwap')
    // Non-vacuous: had either lane ported the retired bucketing, this column
    // could not have been satisfied by both at 1e-9.
    const old = vwapByUtcDay(bars)
    const worst = Math.max(...got.map((v, i) => Math.abs(v - old[i])))
    expect(worst, 'the two bucketings agree on these bars — the case pins nothing').toBeGreaterThan(5)
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
// `computeVWAP` buckets sessions by the ET CALENDAR DAY — `VWAP_SESSION_ANCHOR`,
// accepted 2026-08-03 at a measured 2,590 changed pixels
// (`docs/decisions/2026-08-02-vwap-utc-day-bucketing.md`).
//
// It used to bucket by the UTC calendar day. Regular trading hours never notice
// (09:30–16:00 ET is always inside one UTC day), which is exactly why no unit
// test caught it for the life of the chart. These three cases were written to
// pin that bug class while it shipped; they now pin the CORRECTION, against the
// same `session` block, which already carried the correct series as
// `session.etSessionVwap` and the old boundaries as `session.utcResetIndices`.
//
// ⚠️ THE FIXTURES ARE UNCHANGED — not one byte. Every column these assertions
// read was already in them, which is why the correction needed no reseed and
// therefore could not silently re-baseline the Python lane (`relTol` 1e-9,
// `tests/test_indicator_golden.py`) underneath itself.
//
// Each case keeps a NON-VACUITY half: `vwapByUtcDay` recomputes the OLD series
// here so "the shipped function is ET-anchored" is asserted against something
// that can disagree with it. Without that, a fixture whose two bucketings
// happened to agree would make all three green and guarding nothing.

const typicalPrice = (b) => (b.h + b.l + b.c) / 3

/** The bucketing that shipped until 2026-08-03, verbatim, as the control the
 *  assertions below are measured against. It is deliberately a re-implementation
 *  and not an import: the point is to have a series `computeVWAP` no longer
 *  produces. */
const vwapByUtcDay = (bars) => {
  const out = []
  let cumPV = 0, cumVol = 0, day = null
  for (const b of bars) {
    const d = new Date(b.t * 1000)
    const k = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`
    if (k !== day) { cumPV = 0; cumVol = 0; day = k }
    cumPV += typicalPrice(b) * b.v
    cumVol += b.v
    out.push(cumPV / cumVol)
  }
  return out
}

describe('computeVWAP session boundaries (VWAP_SESSION_ANCHOR, accepted)', () => {
  it('vwap_extended_hours_utc_midnight: the 20:00 ET bar no longer restarts the session', () => {
    const c = loadCase('vwap_extended_hours_utc_midnight')
    const s = c.session
    const got = col(computeVWAP(c.bars))
    expect(got.length).toBe(c.bars.length)

    // One continuous ET session…
    expect(new Set(s.etDate).size).toBe(1)
    // …which UTC-day bucketing used to split in two, at the 20:00 ET bar.
    expect(s.utcResetIndices.length).toBe(2)
    const splitAt = s.utcResetIndices[1]
    expect(s.etHour[splitAt]).toBe(20)

    // ONE reset, on bar 0, because there is one session. The accumulator
    // collapses to a single bar's typical price only where a session opens.
    expect(s.etResetIndices).toEqual([0])
    expect(got[0]).toBeCloseTo(typicalPrice(c.bars[0]), 9)
    // The bar that used to be wiped now carries the whole session's volume.
    expect(got[splitAt]).not.toBeCloseTo(typicalPrice(c.bars[splitAt]), 6)

    // It IS the fixture's ET-anchored series, to the fixture's own tolerance.
    alignedClose(got, s.etSessionVwap, c.relTol, 'vwap_extended_hours.etSessionVwap')

    // Non-vacuous: the retired bucketing gives a materially different number on
    // that bar, so this case can still tell the two apart.
    expect(Math.abs(vwapByUtcDay(c.bars)[splitAt] - got[splitAt])).toBeGreaterThan(1)
  })

  it('vwap_dst_transition: the split that MOVED with the UTC offset is gone', () => {
    const c = loadCase('vwap_dst_transition')
    const s = c.session
    const got = col(computeVWAP(c.bars))
    expect(got.length).toBe(c.bars.length)

    // Two ET sessions, identical wall-clock shape.
    const etDates = [...new Set(s.etDate)]
    expect(etDates.length).toBe(2)
    const hoursOf = (d) => s.etHour.filter((_, i) => s.etDate[i] === d)
    expect(hoursOf(etDates[0])).toEqual(hoursOf(etDates[1]))

    // The ET hour at which the UTC day flips, per session. EDT (UTC-4) tripped
    // at 20:00 ET; EST (UTC-5) an hour earlier, at 19:00 ET. Same session, same
    // hours, different split — the old boundary tracked the timezone offset, not
    // the trading day. THAT is the shape of the defect, and it is still what the
    // fixture records.
    const splitHourIn = (d) => {
      const idx = s.utcResetIndices.find(i => s.etDate[i] === d && s.etHour[i] !== hoursOf(d)[0])
      return idx === undefined ? null : s.etHour[idx]
    }
    expect(splitHourIn(etDates[0])).toBe(20)
    expect(splitHourIn(etDates[1])).toBe(19)

    // Two sessions ⇒ TWO resets, and they are the session opens — not four.
    expect(s.utcResetIndices.length).toBe(4)
    expect(s.etResetIndices.length).toBe(2)
    s.etResetIndices.forEach(i => {
      expect(got[i]).toBeCloseTo(typicalPrice(c.bars[i]), 9)
    })
    // The two MID-SESSION wipes no longer happen…
    const midSession = s.utcResetIndices.filter(i => !s.etResetIndices.includes(i))
    expect(midSession.length, 'the DST half of the case has gone vacuous').toBe(2)
    midSession.forEach(i => {
      expect(got[i]).not.toBeCloseTo(typicalPrice(c.bars[i]), 6)
    })

    alignedClose(got, s.etSessionVwap, c.relTol, 'vwap_dst_transition.etSessionVwap')

    // Non-vacuous, on BOTH sides of the DST change: the retired bucketing still
    // disagrees materially at each of the two hours it used to trip.
    const old = vwapByUtcDay(c.bars)
    midSession.forEach(i => {
      expect(Math.abs(old[i] - got[i]), `bar ${i} — the two bucketings agree here`).toBeGreaterThan(1)
    })
  })

  it('intraday5m_sessions: the CARRIED-OVER session is anchored at its own open', () => {
    // The trap the two hourly cases above are too short to contain, and the
    // reason the pixel gate needs 3 sessions rather than 2. On EST the
    // 19:00-20:00 ET post-market bars had already opened the NEXT UTC day, so
    // the following session's 04:00 ET open was not a UTC-day boundary at all:
    // it never reset, and its entire session accumulated on top of the previous
    // evening's post-market volume. `computeVWAP` — the shipped function, not a
    // re-implementation — is what is asserted here.
    const c = loadCase('intraday5m_sessions')
    const bars = caseBars(c)
    const s = c.session
    const got = col(computeVWAP(bars))
    expect(got.length).toBe(bars.length)

    // It resets at exactly the ET session opens the fixture names, and at
    // nothing else — not at the UTC-day boundaries it used to.
    const resets = got
      .map((_, i) => (i === 0 || s.etDate[i] !== s.etDate[i - 1] ? i : -1))
      .filter(i => i >= 0)
    expect(resets).toEqual(s.etResetIndices)
    resets.forEach(i => {
      expect(got[i]).toBeCloseTo(typicalPrice(bars[i]), 9)
    })

    // The session that opens INSIDE a UTC day is the carry-over, and it is the
    // one the whole decision was priced on.
    const carried = s.etResetIndices.filter(i => !s.utcResetIndices.includes(i))
    expect(carried.length, 'no session is carried over — the case pins nothing new').toBeGreaterThan(0)
    const open = carried[0]
    expect(s.etHour[open]).toBe(4)
    // It now DOES collapse to that bar's typical price — the tell that it reset.
    expect(got[open]).toBeCloseTo(typicalPrice(bars[open]), 9)

    alignedClose(got, s.etSessionVwap, c.relTol, 'intraday5m_sessions.etSessionVwap')

    // Non-vacuous, and this is the $14.45: the retired bucketing opened that
    // session more than $5 away and stayed >$0.50 away for most of it.
    const old = vwapByUtcDay(bars)
    expect(Math.abs(old[open] - got[open])).toBeGreaterThan(5)
    const day = s.etDate[open]
    const wrong = got.filter((v, i) => s.etDate[i] === day && Math.abs(v - old[i]) > 0.5)
    expect(wrong.length, 'the carried-over session was only wrong for a moment').toBeGreaterThan(100)
  })
})
