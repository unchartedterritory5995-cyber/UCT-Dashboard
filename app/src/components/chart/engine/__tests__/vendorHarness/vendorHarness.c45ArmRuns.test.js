// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c45ArmRuns.test.js
//
// ─── C45 — A `ta.*` CALL WRITTEN IN A `?:` ARM (OR ON THE RIGHT OF A v6 `and` /
//     `or`), ON THE PLOT LANE MEMBERS USE TODAY ────────────────────────────────
//
// ⭐ THE WITNESS — `vw-arm-history-rddt-1d-2026-10-02` (NYSE:RDDT 1D, 636 bars from
// the listing) and `vw-arm-history-spy-1d-2026-10-02` (AMEX:SPY 1D, the newest
// 1,800 bars); probe `tools/visual_conformance/probes/vw-arm-history.pine`:
//
//   T*  `up ? ta.sma(close, 5) : close` and its siblings — test irregular
//   K*  `even ? ta.sma(close, 3) : na` — test periodic
//   I*  the same value written in an `if` block (C48 already withholds those)
//   E*  the every-bar answers
//
// TradingView runs a call written in an arm only on the bars its arm is taken, so
// its history is the history of THOSE bars: re-derived below from the capture's own
// bars, T03 / T04 / T05 / K02 / K03 equal that per-run reading on every one of
// RDDT's 636 bars. The plot lane evaluated the arm on EVERY bar and served it with
// no note — a number that is not TradingView's on 291 (T03), 306 (T04), 163 (T05)
// and 317 (K02) of RDDT's bars.
//
// ⭐ WHAT IS PINNED:
//   1. the capture says what the header above says, derived from its own bars;
//   2. through the member door (`enterMemberDoor` → `computeFor`, the bind a chart
//      makes), every such plot is WITHHELD BY NAME on these charts (`pine:block`),
//      the C48 machinery: the translation stamps the arm's own test as the guard
//      (`meta.blockRuns`) and the bind refuses only where that guard varies;
//   3. every drawn-and-wrong shape the measurement found, one by one;
//   4. ⛔ what must STAY drawn, each equal to TradingView's number where a capture
//      has one: a test fixed before bar 0 (input, literal, the chart's timeframe), a
//      test true on every bar of the chart, a test true then false for good, a call
//      bound above the ternary, a call in the test, the smoothed-MA / alligator
//      `na(x[1]) ? ta.sma(…) : …` seed, Pine v5 `and` / `or` (strict), v4 `?:` and
//      `iff` (not witnessed: see `docs/pine/capture-queue-2026-10-31-prod-ternary.md`);
//   5. nothing is refused at TRANSLATION, so the parameters a plot mints do not move,
//      and the screener lane (which binds no chart) reads as it always has.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { toProductBars, enterMemberDoor, HARNESS_DEF_ID } from './ourSide'
import * as registry from '../../nativeRegistry'
import { BLOCK_RUNS_GUARD } from '../../blockRuns'
import { translatePine } from '../../ast/pine'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const RDDT = 'vw-arm-history-rddt-1d-2026-10-02.json'
const SPY = 'vw-arm-history-spy-1d-2026-10-02.json'

afterEach(() => { vi.unstubAllEnvs() })

const CAPS = new Map()
const capture = (file) => {
  if (!CAPS.has(file)) CAPS.set(file, loadCapture(path.join(DIR, file)).capture)
  return CAPS.get(file)
}
const rowsOf = (cap) => cap.bars.rows.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }))
/** One plot of the capture, aligned to its BARS by time (`undefined` where the
 *  study holds no row for a bar). */
const columnOf = (cap, title) => {
  const i = cap.study.plots.findIndex((p) => p.title === title)
  expect(i, title).toBeGreaterThanOrEqual(0)
  const byTime = new Map(cap.plotValues.rows.map((r) => [r[0], r[1 + i]]))
  return cap.bars.rows.map((b) => (byTime.has(b[0]) ? byTime.get(b[0]) : undefined))
}
const same = (a, b) => (a === null && b === null)
  || (a !== null && b !== null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)))
const fin = (x) => (Number.isFinite(x) ? x : null)

/** The probe's own source WITHOUT its three `G0x_gauge_*` plots: `color.r(g)` of a
 *  colour ternary does not round-trip (`pine:roundtrip`), and the member door is
 *  strict, so with them in it refuses the whole script. Removing a `plot()` changes
 *  no other plot's values. Everything else is the probe as TradingView ran it. */
function probeSource(cap) {
  const lines = cap.source.text.split('\n')
  const kept = lines.filter((l) => !/^plot\(color\.[rgb]\(g\), "G0[123]_gauge_[rgb]"\)/.test(l))
  expect(lines.length - kept.length).toBe(3)
  return kept.join('\n')
}

/** The member door + the bind, over a capture's own bars (`c48CallSite`'s `bind`). */
function bind(cap, source) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const door = enterMemberDoor(source)
  try {
    if (!door.def) return { door, cols: null, errors: {}, keyOf: () => null }
    const bars = toProductBars(cap)
    const cols = registry.computeFor(door.def, bars, undefined, {
      tf: 'D', symbol: { ticker: cap.symbol.name, exchange: cap.symbol.exchange },
      newestBarIsForming: cap.newestBarIsForming ?? null,
      historyFromListing: !!(cap.history && cap.history.startsAtBar0 === true),
    })
    // title → the plot key the member pane gave it (rows are matched by tree)
    const rowByAst = new Map((door.built.rows || []).map((r) => [r.ast, r]))
    const keyOf = (title) => {
      const o = (door.built.translation.outputs || []).find((x) => x.title === title)
      const row = o && o.ast ? rowByAst.get(o.ast) : null
      return row ? row.key : null
    }
    return { door, cols, errors: registry.columnErrors(cols) || {}, keyOf }
  } finally {
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
  }
}
const stampedTitles = (door) => ((door.built.translation.blockRuns && door.built.translation.blockRuns.outputs) || [])
  .map((x) => door.built.translation.outputs[x.index].title)

const v6 = (...body) => ['//@version=6', 'indicator("c45 arm runs")', 'up = close > open', ...body].join('\n')

// ── what TradingView reads ──────────────────────────────────────────────────

describe.each([[RDDT], [SPY]])('C45 — the capture %s: an arm\'s call counts the bars its ARM ran', (file) => {
  const cap = capture(file)
  const B = rowsOf(cap)
  const listing = !!(cap.history && cap.history.startsAtBar0)
  const up = B.map((b) => b.c > b.o)
  const exec = B.map((b, i) => (up[i] ? i : -1)).filter((i) => i >= 0)
  const posOf = new Map(exec.map((i, k) => [i, k]))
  // the vendor's own bar index of the first bar, read off the A00 control row
  const a00 = columnOf(cap, 'A00_bar_index_CONTROL')
  const firstIndex = a00.find((v) => v !== undefined && v !== null) - a00.findIndex((v) => v !== undefined && v !== null)
  const even = B.map((_, i) => (i + firstIndex) % 2 === 0)
  const evens = B.map((_, i) => (even[i] ? i : -1)).filter((i) => i >= 0)
  const evenPos = new Map(evens.map((i, k) => [i, k]))
  const early = listing ? null : undefined   // before the loaded window: not derivable off the listing
  function grade(title, want) {
    const col = columnOf(cap, title)
    let ok = 0
    let n = 0
    B.forEach((_, i) => {
      const w = want(i)
      if (w === undefined || col[i] === undefined) return
      n += 1
      if (same(col[i], w)) ok += 1
    })
    return { ok, n }
  }

  it('⭐ T03 / K02 — a `ta.sma` in an arm is the mean of its last n ARM RUNS', () => {
    const t03 = grade('T03_sma_in_true_arm', (i) => {
      if (!up[i]) return B[i].c
      const k = posOf.get(i)
      return k < 4 ? early : [0, 1, 2, 3, 4].reduce((s, j) => s + B[exec[k - j]].c, 0) / 5
    })
    expect(t03.ok).toBe(t03.n)
    expect(t03.n).toBeGreaterThan(listing ? 630 : 1790)
    const k02 = grade('K02_sma3_on_even_bars', (i) => {
      if (!even[i]) return null
      const k = evenPos.get(i)
      return k < 2 ? early : (B[evens[k]].c + B[evens[k - 1]].c + B[evens[k - 2]].c) / 3
    })
    expect(k02.ok).toBe(k02.n)
    expect(k02.n).toBeGreaterThan(listing ? 630 : 1790)
  })

  it('⭐ T05 / K03 — a `ta.change` in an arm is against the PREVIOUS RUN', () => {
    const t05 = grade('T05_change_in_true_arm', (i) => {
      if (!up[i]) return 0
      const k = posOf.get(i)
      return k < 1 ? early : B[i].c - B[exec[k - 1]].c
    })
    expect(t05.ok).toBe(t05.n)
    const k03 = grade('K03_change_on_even_bars', (i) => {
      if (!even[i]) return null
      const k = evenPos.get(i)
      return k < 1 ? early : B[i].c - B[evens[k - 1]].c
    })
    expect(k03.ok).toBe(k03.n)
  })

  it('⭐ T04 — a `ta.ema` in an arm runs over the arm\'s runs, seeded by the mean of its first five (from the listing)', () => {
    if (!listing) return
    let e = null
    const ema = new Map()
    exec.forEach((i, k) => {
      if (k === 4) e = [0, 1, 2, 3, 4].reduce((s, j) => s + B[exec[j]].c, 0) / 5
      else if (k > 4) e = (2 / 6) * B[i].c + (1 - 2 / 6) * e
      ema.set(i, k < 4 ? null : e)
    })
    const t04 = grade('T04_ema_in_true_arm', (i) => (up[i] ? ema.get(i) : B[i].c))
    expect(t04.ok).toBe(t04.n)
    expect(t04.n).toBe(B.length)
  })
})

describe('C45 — ⚰️ what the plot lane drew for those rows: the every-bar number', () => {
  it('RDDT: T03 291, T04 306, T05 163, K02 317 bars that are not TradingView\'s', () => {
    const cap = capture(RDDT)
    const B = rowsOf(cap)
    const up = B.map((b) => b.c > b.o)
    const e03 = columnOf(cap, 'E03_sma_every_bar')
    const e04 = columnOf(cap, 'E04_ema_every_bar')
    const e05 = columnOf(cap, 'E05_change_every_bar')
    const wrong = (title, every) => {
      const col = columnOf(cap, title)
      return B.filter((_, i) => col[i] !== undefined && !same(col[i] ?? null, every(i) ?? null)).length
    }
    // the every-bar reading of `up ? ta.x(…) : other` — the E row where the arm is taken
    expect(wrong('T03_sma_in_true_arm', (i) => (up[i] ? e03[i] : B[i].c))).toBe(291)
    expect(wrong('T04_ema_in_true_arm', (i) => (up[i] ? e04[i] : B[i].c))).toBe(306)
    expect(wrong('T05_change_in_true_arm', (i) => (up[i] ? e05[i] : 0))).toBe(163)
    // K02 on its even bars: the 3-BAR mean, never the mean of the last three even bars
    const k02 = columnOf(cap, 'K02_sma3_on_even_bars')
    const sma3 = (i) => (i < 2 ? null : (B[i].c + B[i - 1].c + B[i - 2].c) / 3)
    expect(B.filter((_, i) => i % 2 === 0 && k02[i] !== undefined && !same(k02[i] ?? null, sma3(i))).length).toBe(317)
  })
})

// ── the member door, on the capture's bars ──────────────────────────────────

const ARM_ROWS = ['T01_highest_in_true_arm', 'T02_lowest_in_false_arm', 'T03_sma_in_true_arm', 'T04_ema_in_true_arm',
  'T05_change_in_true_arm', 'T06_highest_or_lowest', 'K01_highest3_on_even_bars', 'K02_sma3_on_even_bars',
  'K03_change_on_even_bars', 'N01_highest_of_a_series_with_na', 'N02_sma_of_a_series_with_na']
const BLOCK_ROWS = ['I01_highest_in_if_block', 'I02_sma_in_if_block']
const SERVED_ROWS = ['A00_bar_index_CONTROL', 'E01_highest_every_bar', 'E02_lowest_every_bar', 'E03_sma_every_bar',
  'E04_ema_every_bar', 'E05_change_every_bar', 'T07_test_CONTROL', 'G04_level_CONTROL']

describe('C45 — the probe through the member door: every arm row is withheld by name, every other row is TradingView\'s', () => {
  it('⛔⛔ RDDT: nothing refused at translation; each T / K / N row stamped and refused at the bind', () => {
    const cap = capture(RDDT)
    const { door, cols, errors, keyOf } = bind(cap, probeSource(cap))
    expect(door.def, door.refusal || '').toBeTruthy()
    expect(door.built.translation.outputs.filter((o) => o.refusal)).toEqual([])
    expect(stampedTitles(door).sort()).toEqual([...ARM_ROWS, ...BLOCK_ROWS].sort())
    for (const title of ARM_ROWS) {
      const key = keyOf(title)
      expect(key, title).toBeTruthy()
      expect(cols[key], title).toBeUndefined()
      expect(errors[key].guard, title).toBe(BLOCK_RUNS_GUARD)
      expect(errors[key].message, title).toMatch(/is called in one arm of a `\?:` whose test can change from bar to bar/)
      expect(errors[key].message, title).toMatch(/on this chart that arm skips bar \d+ and runs again on bar \d+, so its calls have not run on every bar/)
    }
    expect(errors[keyOf('T03_sma_in_true_arm')].message).toMatch(/^`ta\.sma` is called in one arm of a `\?:`/)
    // RDDT's bar 0 closes up and bar 1 down: the true arm skips bar 1 and runs on bar 2
    expect(errors[keyOf('T03_sma_in_true_arm')].message).toContain('skips bar 1 and runs again on bar 2')
    // the false arm's own guard is the test NEGATED: it runs on bar 1 after skipping bar 0
    expect(errors[keyOf('T02_lowest_in_false_arm')].message).toContain('skips bar 0 and runs again on bar 1')
    // C48's `if` rows keep their own sentence (never a second, `?:` stamp)
    for (const title of BLOCK_ROWS) {
      expect(errors[keyOf(title)].message, title).toMatch(/inside a block that does not run on every bar/)
    }
  })

  it('⭐ RDDT: the every-bar rows and the controls are drawn, equal to TradingView on every bar', () => {
    const cap = capture(RDDT)
    const { cols, errors, keyOf } = bind(cap, probeSource(cap))
    for (const title of SERVED_ROWS) {
      const key = keyOf(title)
      expect(errors[key], title).toBeUndefined()
      const vendor = columnOf(cap, title)
      const got = Array.from(cols[key])
      const off = vendor.map((v, i) => (v === undefined || same(v ?? null, fin(got[i])) ? null : i)).filter((i) => i !== null)
      expect(off, title).toEqual([])
      expect(vendor.filter((v) => v !== undefined).length, title).toBe(636)
    }
  })

  it('⛔ SPY (a window of a longer chart): every arm row is withheld by name too', () => {
    const cap = capture(SPY)
    const { door, cols, errors, keyOf } = bind(cap, probeSource(cap))
    expect(door.def, door.refusal || '').toBeTruthy()
    for (const title of [...ARM_ROWS, ...BLOCK_ROWS]) {
      const key = keyOf(title)
      expect(cols[key], title).toBeUndefined()
      expect(errors[key], title).toBeTruthy()
    }
    for (const title of ARM_ROWS.filter((t) => t.startsWith('T') || t.startsWith('N'))) {
      expect(errors[keyOf(title)].guard, title).toBe(BLOCK_RUNS_GUARD)
    }
    // the every-bar SMA is still drawn and TradingView's past its 4-bar warm-up
    const vendor = columnOf(cap, 'E03_sma_every_bar')
    const got = Array.from(cols[keyOf('E03_sma_every_bar')])
    expect(vendor.filter((v, i) => i >= 4 && v !== undefined && !same(v, fin(got[i]))).length).toBe(0)
  })
})

// ── every drawn-and-wrong shape, one by one ─────────────────────────────────

describe('C45 — each measured shape is withheld by name, never drawn', () => {
  const cap = capture(RDDT)
  const refusedWith = (source, sentence) => {
    const { door, cols, errors } = bind(cap, source)
    expect(door.def, door.refusal || '').toBeTruthy()
    expect(door.built.translation.outputs.filter((o) => o.refusal)).toEqual([])
    expect(Object.keys(errors), source).toEqual(['value'])
    expect(errors.value.guard).toBe(BLOCK_RUNS_GUARD)
    expect(errors.value.message).toMatch(sentence)
    expect(cols.value).toBeUndefined()
  }

  it.each([
    ['ta.sma(close, 5)', 'ta.sma'], ['ta.ema(close, 5)', 'ta.ema'], ['ta.rma(close, 5)', 'ta.rma'],
    ['ta.stdev(close, 5)', 'ta.stdev'], ['ta.highest(high, 10)', 'ta.highest'], ['ta.lowest(low, 10)', 'ta.lowest'],
    ['ta.change(close)', 'ta.change'], ['ta.rsi(close, 14)', 'ta.rsi'], ['ta.atr(14)', 'ta.atr'],
  ])('`up ? %s : close`', (call, name) => {
    const esc = name.replace('.', '\\.')
    refusedWith(v6(`y = up ? ${call} : close`, 'plot(y, "Y")'), new RegExp(`^\`${esc}\` is called in one arm of a \`\\?:\``))
  })

  it('`up ? ta.crossover(…) : false` — a bool arm', () => {
    refusedWith(v6('x = up ? ta.crossover(close, ta.sma(close, 5)) : false', 'plot(x ? 1 : 0, "X")'), /^`ta\.crossover` is called in one arm of a `\?:`/)
  })

  it('the FALSE arm: `up ? close : ta.sma(close, 5)`', () => {
    refusedWith(v6('y = up ? close : ta.sma(close, 5)', 'plot(y, "Y")'), /^`ta\.sma` is called in one arm of a `\?:`/)
  })

  it('`up ? f(close) : close` — `f` a function holding `ta.*` history', () => {
    refusedWith(v6('f(s) => ta.sma(s, 5)', 'y = up ? f(close) : close', 'plot(y, "Y")'),
      /^`f`, a function that reads its own history, is called in one arm of a `\?:`/)
  })

  it('a `?:` inside a function body: `g(s) => up ? ta.sma(s, 5) : s`', () => {
    refusedWith(v6('g(s) => s > open ? ta.sma(s, 5) : s', 'plot(g(close), "Y")'), /^`ta\.sma` is called in one arm of a `\?:`/)
  })

  it('v6 `up and ta.crossover(a, b)`', () => {
    refusedWith(v6('x = up and ta.crossover(close, ta.sma(close, 5))', 'plot(x ? 1 : 0, "X")'),
      /^`ta\.crossover` is called on the right of a Pine v6 `and` .*which runs only on the bars where its left side is true/)
  })

  it('v6 `up and close > ta.sma(close, 5)`', () => {
    refusedWith(v6('x = up and close > ta.sma(close, 5)', 'plot(x ? 1 : 0, "X")'), /^`ta\.sma` is called on the right of a Pine v6 `and`/)
  })

  it('v6 `up or ta.change(close) > 0`', () => {
    refusedWith(v6('x = up or ta.change(close) > 0', 'plot(x ? 1 : 0, "X")'),
      /^`ta\.change` is called on the right of a Pine v6 `or` .*which runs only on the bars where its left side is false/)
  })

  it('Pine v5 `?:` too — TradingView\'s v5 guide: "the ternary operator is evaluated lazily"', () => {
    refusedWith(['//@version=5', 'indicator("v5")', 'y = close > open ? ta.sma(close, 5) : close', 'plot(y, "Y")'].join('\n'),
      /^`ta\.sma` is called in one arm of a `\?:`/)
    // …and a v5 helper that reads its own history (`src[1]`), which v4 spells the same way
    refusedWith(['//@version=5', 'indicator("v5 f")', 'f(s) => s - s[1]', 'y = close > open ? f(close) : close', 'plot(y, "Y")'].join('\n'),
      /^`f`, a function that reads its own history, is called in one arm of a `\?:`/)
  })

  it('a read of a `var` between two of its reassignments keeps the arm\'s stamp (the copy `previousBarOf` makes)', () => {
    refusedWith(v6('var float s = na', 's := up ? ta.sma(close, 5) : s', 'y = s', 's := close', 'plot(y, "Y")'),
      /^`ta\.sma` is called in one arm of a `\?:`/)
  })

  it('a test that reads its own previous value through `nz(x[1], seed)` (read one bar back, standalone)', () => {
    refusedWith(v6('x = 0.0', 'x := nz(x[1], close) > close ? ta.sma(close, 5) : 0.5 * nz(x[1], close) + 0.5 * close', 'plot(x, "X")'),
      /^`ta\.sma` is called in one arm of a `\?:`/)
  })
})

// ── what must stay drawn ────────────────────────────────────────────────────

describe('C45 — ⛔ what stays drawn, TradingView\'s number where a capture holds one', () => {
  const cap = capture(RDDT)
  const B = rowsOf(cap)
  const up = B.map((b) => b.c > b.o)
  const e03 = columnOf(cap, 'E03_sma_every_bar')
  const e04 = columnOf(cap, 'E04_ema_every_bar')
  /** Drawn, unstamped unless `stamped`, and equal to `want(i)` on every bar. */
  const drawn = (source, want, { stamped = false } = {}) => {
    const { door, cols, errors } = bind(cap, source)
    expect(door.def, door.refusal || '').toBeTruthy()
    expect(errors, source).toEqual({})
    expect(!!(door.def.meta && door.def.meta.blockRuns), source).toBe(stamped)
    const col = Array.from(cols.value)
    if (want) {
      const off = B.map((_, i) => (same(fin(col[i]), want(i) ?? null) ? null : i)).filter((i) => i !== null)
      expect(off, source).toEqual([])
    }
    return col
  }

  it('a test fixed before bar 0 — an input, a dropdown, a literal expression, the chart\'s timeframe', () => {
    drawn(v6('useE = input.bool(true, "Use EMA")', 'y = useE ? ta.ema(close, 5) : ta.sma(close, 5)', 'plot(y, "Y")'), (i) => e04[i])
    drawn(v6('ma = input.string("SMA", "MA", options = ["SMA", "EMA"])', 'y = ma == "SMA" ? ta.sma(close, 5) : ta.ema(close, 5)', 'plot(y, "Y")'), (i) => e03[i])
    drawn(v6('len = input.int(5, "Len")', 'y = len > 3 ? ta.sma(close, 5) : ta.ema(close, 5)', 'plot(y, "Y")'), (i) => e03[i])
    drawn(v6('y = 2 > 1 ? ta.sma(close, 5) : close', 'plot(y, "Y")'), (i) => e03[i])
    drawn(v6('y = timeframe.isdaily ? ta.sma(close, 5) : close', 'plot(y, "Y")'), (i) => e03[i])
    drawn(v6('show = input.bool(true, "Show")', 'x = show and ta.crossover(close, ta.sma(close, 5))', 'plot(x ? 1 : 0, "X")'), null)
  })

  it('a test that holds on EVERY bar of this chart — stamped, and the bind keeps it', () => {
    drawn(v6('y = volume >= 0 ? ta.sma(close, 5) : close', 'plot(y, "Y")'), (i) => e03[i], { stamped: true })
  })

  it('a test true, then false for good — every run came before the first skip', () => {
    const col = drawn(v6('y = bar_index < 100 ? ta.sma(close, 3) : na', 'plot(y, "Y")'), null, { stamped: true })
    expect(col[50]).toBeCloseTo((B[50].c + B[49].c + B[48].c) / 3, 9)
    expect(Number.isFinite(col[200])).toBe(false)
  })

  it('🔴 CONTROL — false, then true: the arm\'s first run comes after bars it skipped', () => {
    const { errors } = bind(cap, v6('y = bar_index >= 100 ? ta.sma(close, 3) : na', 'plot(y, "Y")'))
    expect(errors.value.guard).toBe(BLOCK_RUNS_GUARD)
    expect(errors.value.message).toContain('skips bar 0 and runs again on bar 100')
  })

  it('a call bound ABOVE the ternary runs on every bar — and a call in the TEST does too', () => {
    drawn(v6('s = ta.sma(close, 5)', 'y = up ? s : close', 'plot(y, "Y")'), (i) => (up[i] ? e03[i] : B[i].c))
    drawn(v6('y = ta.sma(close, 5) > close ? 1 : 0', 'plot(y, "Y")'), (i) => (e03[i] === null ? 0 : e03[i] > B[i].c ? 1 : 0))
    // and an arm that calls nothing (T07)
    drawn(v6('plot(up ? 1 : 0, "Y")'), (i) => (up[i] ? 1 : 0))
  })

  it('⭐⭐ the smoothed MA\'s `smma := na(smma[1]) ? ta.sma(src, len) : …` — the seed arm runs on bars 0..len-1 and never again', () => {
    const source = ['//@version=6',
      'indicator(title="Smoothed moving average", shorttitle="Smoothed MA", overlay=true, timeframe="", timeframe_gaps=true)',
      'len = input.int(7, minval=1, title="Length")', 'src = input(close, title="Source")', 'smma = 0.0',
      'smma := na(smma[1]) ? ta.sma(src, len) : (smma[1] * (len - 1) + src) / len', 'plot(smma, "SMMA", color = #673AB7)'].join('\n')
    // TradingView's own formula, from the listing
    const ref = []
    B.forEach((b, i) => {
      const prev = i > 0 ? ref[i - 1] : null
      if (prev === null) ref.push(i >= 6 ? B.slice(i - 6, i + 1).reduce((s, x) => s + x.c, 0) / 7 : null)
      else ref.push((prev * 6 + b.c) / 7)
    })
    drawn(source, (i) => ref[i], { stamped: true })
  })

  it('⭐⭐ the Williams alligator\'s `smma()` helper — the same seed, inside a function', () => {
    const source = ['//@version=6',
      'indicator(title="Williams alligator", shorttitle="Alligator", overlay=true, timeframe="", timeframe_gaps=true)',
      'smma(src, length) =>', '\tsmma =  0.0', '\tsmma := na(smma[1]) ? ta.sma(src, length) : (smma[1] * (length - 1) + src) / length', '\tsmma',
      'jawLength = input.int(13, minval=1, title="Jaw Length")', 'teethLength = input.int(8, minval=1, title="Teeth Length")',
      'lipsLength = input.int(5, minval=1, title="Lips Length")', 'jawOffset = input(8, title="Jaw Offset")',
      'teethOffset = input(5, title="Teeth Offset")', 'lipsOffset = input(3, title="Lips Offset")',
      'jaw = smma(hl2, jawLength)', 'teeth = smma(hl2, teethLength)', 'lips = smma(hl2, lipsLength)',
      'plot(jaw, "Jaw", offset = jawOffset, color=#2962FF)', 'plot(teeth, "Teeth", offset = teethOffset, color=#E91E63)',
      'plot(lips, "Lips", offset = lipsOffset, color=#66BB6A)'].join('\n')
    const { door, cols, errors } = bind(cap, source)
    expect(door.def, door.refusal || '').toBeTruthy()
    expect(errors).toEqual({})
    const hl2 = B.map((b) => (b.h + b.l) / 2)
    const smma = (n) => {
      const out = []
      hl2.forEach((x, i) => {
        const prev = i > 0 ? out[i - 1] : null
        out.push(prev === null ? (i >= n - 1 ? hl2.slice(i - n + 1, i + 1).reduce((s, v) => s + v, 0) / n : null) : (prev * (n - 1) + x) / n)
      })
      return out
    }
    for (const [key, n, off] of [['value', 13, 8], ['out2', 8, 5], ['out3', 5, 3]]) {
      const ref = smma(n)
      const col = Array.from(cols[key])
      const bad = B.map((_, i) => (same(fin(col[i]), i - off >= 0 ? ref[i - off] : null) ? null : i)).filter((i) => i !== null)
      expect(bad, key).toEqual([])
    }
  })

  it('Pine v5 `and` / `or` evaluate BOTH sides on every bar (TradingView\'s v6 guide) — drawn, unstamped', () => {
    const src = ['//@version=5', 'indicator("v5 and")', 'up = close > open', 'x = up and ta.crossover(close, ta.sma(close, 5))',
      'y = up or ta.change(close) > 0', 'plot(x ? 1 : 0, "X")', 'plot(y ? 1 : 0, "Y")'].join('\n')
    const { door, errors } = bind(cap, src)
    expect(door.def, door.refusal || '').toBeTruthy()
    expect(errors).toEqual({})
    expect(door.def.meta.blockRuns).toBeUndefined()
  })

  it('Pine v4 `?:` and `iff` are not witnessed — drawn as before (queued: capture-queue-2026-10-31-prod-ternary.md)', () => {
    drawn(['//@version=4', 'study("v4")', 'y = close > open ? sma(close, 5) : close', 'plot(y, "Y")'].join('\n'), (i) => (up[i] ? e03[i] : B[i].c))
    drawn(['//@version=4', 'study("v4 iff")', 'y = iff(close > open, sma(close, 5), close)', 'plot(y, "Y")'].join('\n'), (i) => (up[i] ? e03[i] : B[i].c))
    // ⛔ the VERSION decides, not the spelling: a v4 helper reading its own history is
    // read the same way a v5 one is (`f`), and still drawn as before in v4
    drawn(['//@version=4', 'study("v4 f")', 'f(s) => s - s[1]', 'y = close > open ? f(close) : close', 'plot(y, "Y")'].join('\n'),
      (i) => (i === 0 ? (up[0] ? null : B[0].c) : up[i] ? B[i].c - B[i - 1].c : B[i].c))
  })

  it('a `request.*` in an arm is evaluated in the requested context — not stamped (queued, not witnessed)', () => {
    drawn(v6('y = up ? request.security(syminfo.tickerid, "D", ta.sma(close, 5)) : close', 'plot(y, "Y")'),
      (i) => (up[i] ? e03[i] : B[i].c))
  })

  it('an `na` test takes the false arm on every bar — not stamped', () => {
    drawn(v6('y = na ? ta.sma(close, 5) : close', 'plot(y, "Y")'), (i) => B[i].c)
  })
})

// ── translation ─────────────────────────────────────────────────────────────

describe('C45 — ⛔ nothing moves at translation', () => {
  it('no refusal, the same parameters in order, the same formula — and the screener lane is not stamped', () => {
    const source = ['//@version=6', 'indicator("c45 mint")',
      'len = input.int(5, "Arm length")', 'mult = input.float(2.0, "Mult")', 'other = input.int(9, "Other length")',
      'y = close > open ? ta.sma(close, len) : close',
      'z = close > open and ta.crossover(close, ta.ema(close, len))',
      'plot(y * mult, "arm")', 'plot(z ? 1 : 0, "and")', 'plot(ta.sma(close, other), "every bar")'].join('\n')
    const t = translatePine(source, { strict: true, paramManifest: true })
    expect(t.outputs.map((o) => (o.refusal ? o.refusal.guard : 'ok'))).toEqual(['ok', 'ok', 'ok'])
    expect(t.blockRuns.outputs.map((x) => x.index)).toEqual([0, 1])
    expect(t.inputParams.map((p) => [p.id, p.label || p.title])).toEqual([
      ['__uct_param_1001', 'Arm length'], ['__uct_param_1002', 'Mult'], ['__uct_param_1003', 'Other length']])
    expect(t.outputs[0].formula).toBe('(close > open ? sma(close, 5) : close) * 2')
    const screen = translatePine(source, { paramManifest: true })
    expect(screen.mode).toBe('screener')
    expect(screen.blockRuns).toBeUndefined()
    expect(screen.outputs.map((o) => o.formula)).toEqual(t.outputs.map((o) => o.formula))
  })
})
