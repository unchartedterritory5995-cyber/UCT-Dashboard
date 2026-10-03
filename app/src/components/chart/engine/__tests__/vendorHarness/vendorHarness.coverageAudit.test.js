// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.coverageAudit.test.js
//
// ─── CAP2 (2026-10-02) — every attached corpus script that had no TradingView capture ─
//
// The member-door census (`memberDoorCensus.measure.test.js`, objects pane on, and the
// runtime fallback state) attached 80 corpus scripts on the wave-16 tree (86 with the
// runtime pane). 61 + 2 of them already had a capture; the rest are listed in
// `docs/pine/vendor-harness/cap2-coverage-list-2026-10-02.json`. Each was added to the
// owner's TradingView rig as an unsaved draft and read off the chart model with
// `tools/vendor_harness/tv_capture.js`, moved by the hash-verified clipboard and
// assembled by `verify_capture.mjs` (VERDICT: PASS); every capture's `source.sha256` is
// the corpus file's own.
//
// This rail pins the harness's OWN verdict (`gradeCapture`) for each one, measured on
// `pine/cap2-coverage-audit` after merging `integrate/wave16-2026-10-02` (666ea1c854),
// in the door state the script attaches in (objects pane on; runtime pane too for the
// runtime-only attaches). A MATCH is an `expect`. A DIVERGE is an `it.fails` asserting
// MATCH, so the fix that closes it flips the test — and a control beside it pins the
// divergence BY NAME (item, first bar, kind), so the `it.fails` cannot pass because
// something else broke. Nothing here was adjusted to fit our output.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'
import { loadPineLibraryStore } from '../../ast/__tests__/pineLibraryStoreLoader.js'
import { clearPineLibraries } from '../../ast/pineLibraryStore'
import fs from 'node:fs'
import { cap3Signature } from './cap3Signature'

afterEach(() => { vi.unstubAllEnvs() })

const verdicts = new Map()
/** One grade per capture, memoized: the door state is part of the key. */
function grade(id, state = 'on') {
  const key = `${id}|${state}`
  if (!verdicts.has(key)) {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    if (state === 'runtime') vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const cap = loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
    expect(cap, `${id} is a v1 capture`).toBeTruthy()
    verdicts.set(key, { cap, v: gradeCapture(cap).verdict })
    vi.unstubAllEnvs()
  }
  return verdicts.get(key)
}
const items = (v, title) => v.plots.filter((p) => p.title === title)
const item = (v, title) => {
  const hits = items(v, title)
  expect(hits.length, `exactly one graded item titled ${title}`).toBe(1)
  return hits[0]
}
const first = (p) => p.stats.steady.first
const T = 600000

// ─── MATCH — every compared item agrees with TradingView ───────────────────────
describe('CAP2 coverage audit — MATCH', () => {
  it.each([
    ['atr-bands-rddt-1d-2026-10-02', 'on'],
    ['cdc-btc-rainbow-road-spy-1d-2026-10-02', 'on'],
    ['macd-shortlong-strategy-for-tradingview-input-optimizer-rddt-1d-2026-10-02', 'on'],
    ['rsi-horizontal-resistance-levels-rddt-1d-2026-10-02', 'on'],
    ['rsi-horizontal-resistance-levels-spy-1d-2026-10-02', 'on'],
    ['support-and-resistance-rddt-1d-2026-10-02', 'on'],
    ['tradingview-alerts-to-mt4-mt5-forex-indices-commodities-stocks-crypto-rddt-1d-2026-10-02', 'on'],
    ['tradingview-alerts-to-mt4-mt5-strategy-example-rddt-1d-2026-10-02', 'on'],
    ['twin-range-filter-spy-1d-2026-10-02', 'on'],
    // ⭐ F2 (step 78) — `col = if …` arms opened by the colour readers (`pine.js::openBoundArm`).
    ['implied-volatility-suite-rddt-1d-2026-10-02', 'on'],
    ['implied-volatility-suite-spy-1d-2026-10-02', 'on'],
    // ⭐ F3 (step 79) — the two swing labels now draw: `str.tostring(y, "Swing H  (#,###.####)")`
    // reads literal words around a pattern (`pineTextFormat.js::formatPatternedNumber`).
    ['swing-highlow-zigzag-chartprime-rddt-1d-2026-10-02', 'on'],
  ])('%s (%s): MATCH', (id, state) => {
    const { cap, v } = grade(id, state)
    expect(cap.source.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(v.verdict, v.reason).toBe('MATCH')
  }, T)

  it('rsi-horizontal-resistance-levels draws its 5 lines with TradingView\'s colours (objects-only)', () => {
    const { v } = grade('rsi-horizontal-resistance-levels-rddt-1d-2026-10-02')
    expect(v.objects.verdict).toBe('MATCH')
    expect(v.objects.counts.find((c) => c.family === 'lines')).toMatchObject({ vendor: 5, ours: 5 })
  }, T)
})

// ─── DIVERGE — each is a fix to make; the control names what diverges ──────────
describe('CAP2 coverage audit — DIVERGE (known; the fix flips each it.fails)', () => {
  // atr-trailing-stop-by-ceyhun ------------------------------------------------
  it.fails('atr-trailing-stop-by-ceyhun RDDT: MATCH', () => {
    expect(grade('atr-trailing-stop-by-ceyhun-rddt-1d-2026-10-02').v.verdict).toBe('MATCH')
  }, T)
  it('control: RDDT plots and the barcolor agree; TradingView holds 1 drawing and ours is WITHHELD BY NAME (its text reads an unbounded ta.barssince)', () => {
    const { v } = grade('atr-trailing-stop-by-ceyhun-rddt-1d-2026-10-02')
    expect(v.plots.every((p) => p.verdict === 'MATCH')).toBe(true)
    expect(v.paints.verdict).toBe('MATCH')
    // ⭐ F3 — was "our script has no drawing program": the script DRAWS (one info
    // label), and the door refused both of its creates by name (`create:label`,
    // `pine:function` — `ta.barssince` is unbounded; its `x` is `timenow`).
    expect(v.objects.withheld).toBe('pine:object-ops-refused')
    expect(v.objects.reason).toMatch(/holds 1 drawing object.*withheld by name \(pine:object-ops-refused\).*create:label ×2; pine:function/)
  }, T)
  it.fails('atr-trailing-stop-by-ceyhun SPY: MATCH', () => {
    expect(grade('atr-trailing-stop-by-ceyhun-spy-1d-2026-10-02').v.verdict).toBe('MATCH')
  }, T)
  it('control: SPY Slow Trail / BUY / SELL are na on ours where TradingView has a value, from bar 522 (scattered); barcolor differs from bar 0', () => {
    const { v } = grade('atr-trailing-stop-by-ceyhun-spy-1d-2026-10-02')
    expect(first(item(v, 'Slow Trail'))).toMatchObject({ bar: 522, kind: 'na' })
    expect(item(v, 'Slow Trail').stats.steady.divergent).toBe(949)
    expect(first(item(v, 'BUY'))).toMatchObject({ bar: 554, kind: 'na' })
    expect(first(item(v, 'SELL'))).toMatchObject({ bar: 531, kind: 'na' })
    expect(v.paints.verdict).toBe('DIVERGE')
  }, T)

  // cpr-with-mas-super-trend-vwap (wave-16 H2/H3 attach) ------------------------
  // ⭐ F1 (step 73) — FLIPPED: on a daily chart every daily bar is its own `ta.vwap`
  // session (CAP2 Q-H3a, `h3-vwap-source-spy-1d`), so the VWAP row is the bar's own
  // source and the RDDT capture MATCHes on all 30 items.
  it('cpr-with-mas-super-trend-vwap RDDT: MATCH (F1)', () => {
    expect(grade('cpr-with-mas-super-trend-vwap-by-guruprasadmeduri-rddt-1d-2026-10-02').v.verdict).toBe('MATCH')
  }, T)
  it.fails('cpr-with-mas-super-trend-vwap SPY: MATCH', () => {
    expect(grade('cpr-with-mas-super-trend-vwap-by-guruprasadmeduri-spy-1d-2026-10-02').v.verdict).toBe('MATCH')
  }, T)
  it('control: SPY VWAP agrees on every bar now (F1); EMA a converging prefix; CP/BC/TC/D-S1/D-R1 agree (F2: bar 1 colour sits inside the colour rule warm-up)', () => {
    const { v } = grade('cpr-with-mas-super-trend-vwap-by-guruprasadmeduri-spy-1d-2026-10-02')
    expect(item(v, 'VWAP').verdict).toBe('MATCH')
    for (const t of ['CP', 'BC', 'TC', 'D-S1', 'D-R1']) {
      const p = item(v, t)
      expect(p.verdict, t).toBe('MATCH')
      // the colour rule reads `DayPivot[1]`: its reach (2) exceeds the value's (1)
      expect(p.colorWarmupBars, t).toBe(2)
      expect(p.warmupBars, t).toBe(1)
    }
    expect(item(v, 'EMA').stats.steady.pattern.kind).toBe('converging-prefix')
  }, T)

  // implied-volatility-suite: MATCH since F2 (above) ---------------------------
  it('F2 control: the Volatility Data colour is carried as a palette (TradingView red / green), compared on every valued bar', () => {
    for (const id of ['implied-volatility-suite-rddt-1d-2026-10-02', 'implied-volatility-suite-spy-1d-2026-10-02']) {
      const p = item(grade(id).v, 'Volatility Data')
      expect(p.verdict, id).toBe('MATCH')
      expect(p.color, id).toBe('compared')
      expect(p.stats.colorCompared, id).toBeGreaterThan(200)
    }
  }, T)

  // multicator-table ------------------------------------------------------------
  it.fails('multicator-table RDDT / SPY: MATCH', () => {
    expect(grade('multicator-table-rddt-1d-2026-10-02').v.verdict).toBe('MATCH')
  }, T)
  it('control: every compared plot agrees on both symbols; TradingView holds 72 drawings (2 tables, 60 cells, 5 HUD boxes, 5 HUD labels) and ours are WITHHELD BY NAME — the program lost a removal', () => {
    for (const id of ['multicator-table-rddt-1d-2026-10-02', 'multicator-table-spy-1d-2026-10-02']) {
      const { v } = grade(id)
      expect(v.plots.filter((p) => p.verdict === 'DIVERGE'), id).toEqual([])
      // ⭐ F3 — was "our script has no drawing program". The door withholds the
      // whole program (`pine:object-removal-lost`): its HUD lists lose pushes
      // (`coll:push`, `coll:diverged` — `visibleRange` is a tuple function the
      // lane cannot read) that a later `box.delete` / `label.delete` reads, and
      // 43 of its 60 cell texts read `math.round_to_mintick`, `format.volume` or
      // a `ThemePalette` UDT field. Drawing the rest would leave objects
      // TradingView deleted; the member reads the door's "its drawings are not
      // shown" sentence.
      expect(v.objects.withheld, id).toBe('pine:object-removal-lost')
      expect(v.objects.reason, id).toMatch(/holds 72 drawing object.*withheld by name \(pine:object-removal-lost\).*coll:diverged, coll:push/)
    }
  }, T)

  // optimized-keltner-channels-sltp-strategy-for-btc -----------------------------
  it.fails('optimized-keltner-channels-sltp-strategy RDDT: MATCH', () => {
    expect(grade('optimized-keltner-channels-sltp-strategy-for-btc-rddt-1d-2026-10-02').v.verdict).toBe('MATCH')
  }, T)
  it('control: RDDT the two untitled plots are na on bar 0 only (TradingView 0); SPY Upper/Basis/Lower are converging prefixes (a window not from the listing)', () => {
    const r = grade('optimized-keltner-channels-sltp-strategy-for-btc-rddt-1d-2026-10-02').v
    const plots = items(r, 'Plot')
    expect(plots.length).toBe(2)
    for (const p of plots) {
      expect(first(p)).toMatchObject({ bar: 0, kind: 'na' })
      expect(p.stats.steady.divergent).toBe(1)
    }
    const s = grade('optimized-keltner-channels-sltp-strategy-for-btc-spy-1d-2026-10-02').v
    for (const t of ['Upper', 'Basis', 'Lower']) expect(item(s, t).stats.steady.pattern.kind, t).toBe('converging-prefix')
  }, T)

  // pmax-explorer ---------------------------------------------------------------
  it.fails('pmax-explorer SPY: MATCH', () => {
    expect(grade('pmax-explorer-spy-1d-2026-10-02').v.verdict).toBe('MATCH')
  }, T)
  it('control: SPY PMax is na on ours from bar 512 to the last (1139 bars, TradingView a value); the screener label is not drawn; RDDT PMax / MA agree', () => {
    const s = grade('pmax-explorer-spy-1d-2026-10-02').v
    expect(first(item(s, 'PMax'))).toMatchObject({ bar: 512, kind: 'na' })
    expect(item(s, 'PMax').stats.steady.divergent).toBe(1139)
    // ⭐ F3 — the screener label lists 38 other symbols' PMax states
    // (`request.security` per symbol): withheld by name, never drawn.
    expect(s.objects.withheld).toBe('pine:object-ops-refused')
    expect(s.objects.reason).toMatch(/holds 1 drawing object.*withheld by name \(pine:object-ops-refused\).*pine:request/)
    const r = grade('pmax-explorer-rddt-1d-2026-10-02').v
    expect(item(r, 'PMax').verdict).toBe('MATCH')
    expect(item(r, 'Moving Avg Line').verdict).toBe('MATCH')
    // Buy / Sell are not unique titles on TradingView's side: UNMAPPED, never graded.
    expect(items(r, 'Buy').every((p) => p.verdict === 'INCONCLUSIVE')).toBe(true)
  }, T)

  // supertrend-strategy (KivancOzbilgic) -----------------------------------------
  it.fails('supertrend-strategy RDDT: MATCH', () => {
    expect(grade('supertrend-strategy-rddt-1d-2026-10-02').v.verdict).toBe('MATCH')
  }, T)
  it('control: every plot value agrees on both symbols; the barcolor is WITHHELD (expression colour)', () => {
    for (const id of ['supertrend-strategy-rddt-1d-2026-10-02', 'supertrend-strategy-spy-1d-2026-10-02']) {
      const { v } = grade(id)
      expect(v.plots.filter((p) => p.verdict === 'DIVERGE'), id).toEqual([])
      expect(v.paints.verdict, id).toBe('DIVERGE')
      expect(v.paints.reason, id).toMatch(/withheld/)
    }
  }, T)

  // support-and-resistance-multi-time-frame --------------------------------------
  it.fails('support-and-resistance-multi-time-frame RDDT: MATCH', () => {
    expect(grade('support-and-resistance-multi-time-frame-rddt-1d-2026-10-02').v.verdict).toBe('MATCH')
  }, T)
  it('control: RDDT (from the listing) Resistance Weekly na on 15 bars from 161, Support Weekly on 3 from 476; SPY Support Monthly na from bar 735 to the last', () => {
    const r = grade('support-and-resistance-multi-time-frame-rddt-1d-2026-10-02').v
    expect(first(item(r, 'Resistance Weekly'))).toMatchObject({ bar: 161, kind: 'na' })
    expect(item(r, 'Resistance Weekly').stats.steady.divergent).toBe(15)
    expect(first(item(r, 'Support Weekly'))).toMatchObject({ bar: 476, kind: 'na' })
    expect(item(r, 'Resistance Daily').verdict).toBe('MATCH')
    const s = grade('support-and-resistance-multi-time-frame-spy-1d-2026-10-02').v
    expect(first(item(s, 'Support Monthly'))).toMatchObject({ bar: 735, kind: 'na' })
    expect(item(s, 'Support Monthly').stats.steady.pattern.kind).toBe('persistent')
  }, T)

  // support-and-resistance (SPY only — RDDT is a MATCH above) ---------------------
  it.fails('support-and-resistance SPY: MATCH', () => {
    expect(grade('support-and-resistance-spy-1d-2026-10-02').v.verdict).toBe('MATCH')
  }, T)
  it('control: SPY both untitled plots na on ours on bars 20..51 only (a window not from the listing: the first fixnan pivots)', () => {
    const plots = items(grade('support-and-resistance-spy-1d-2026-10-02').v, 'Plot').filter((p) => p.verdict === 'DIVERGE')
    expect(plots.length).toBe(2)
    for (const p of plots) {
      expect(first(p)).toMatchObject({ bar: 20, kind: 'na' })
      expect(p.stats.steady.last.bar).toBeLessThanOrEqual(51)
    }
  }, T)

  // swing-highlow-zigzag-chartprime ---------------------------------------------
  it.fails('swing-highlow-zigzag-chartprime SPY: MATCH', () => {
    expect(grade('swing-highlow-zigzag-chartprime-spy-1d-2026-10-02').v.verdict).toBe('MATCH')
  }, T)
  it('control: the two swing labels now draw with TradingView\'s text on both symbols; on SPY we hold 12 of TradingView\'s 52 zigzag lines — a WINDOW, not the engine', () => {
    const r = grade('swing-highlow-zigzag-chartprime-rddt-1d-2026-10-02').v.objects
    expect(r.counts.find((c) => c.family === 'lines')).toMatchObject({ vendor: 10, ours: 10 })
    expect(r.counts.find((c) => c.family === 'labels')).toMatchObject({ vendor: 2, ours: 2 })
    const { cap, v } = grade('swing-highlow-zigzag-chartprime-spy-1d-2026-10-02')
    const s = v.objects
    expect(s.counts.find((c) => c.family === 'labels')).toMatchObject({ vendor: 2, ours: 2 })
    expect(s.texts.find((t) => t.family === 'labels text').agree).toBe(true)
    expect(s.counts.find((c) => c.family === 'lines')).toMatchObject({ vendor: 52, ours: 12 })
    // ⭐ F3 — the 40 lines we do not hold were drawn on bars BEFORE the loaded
    // window: TradingView ran the script over SPY's whole history (the capture is
    // 1800 bars from 2019-08, not from the listing), and the zigzag segments it
    // never deletes still carry 1993-2019 prices. 35 of them lie wholly below the
    // window's lowest low — no bar we were given could have made them.
    const lowAt = cap.bars.fields.indexOf('low')
    const minLow = Math.min(...cap.bars.rows.map((row) => row[lowAt]))
    expect(cap.history.startsAtBar0).toBe(false)
    const before = cap.objects.records.lines.filter((l) => Math.max(l.y1 ?? -Infinity, l.y2 ?? -Infinity) < minLow)
    expect(before.length).toBe(35)
  }, T)

  // twin-range-filter (RDDT only — SPY is a MATCH above) --------------------------
  it.fails('twin-range-filter RDDT: MATCH', () => {
    expect(grade('twin-range-filter-rddt-1d-2026-10-02').v.verdict).toBe('MATCH')
  }, T)
  it('control: RDDT (from the listing) Long na on 5 bars from 177, Short on 6 from 171 (TradingView 1); the filter line agrees', () => {
    const v = grade('twin-range-filter-rddt-1d-2026-10-02').v
    expect(first(item(v, 'Long'))).toMatchObject({ bar: 177, kind: 'na' })
    expect(item(v, 'Long').stats.steady.divergent).toBe(5)
    expect(first(item(v, 'Short'))).toMatchObject({ bar: 171, kind: 'na' })
    expect(item(v, 'Short').stats.steady.divergent).toBe(6)
  }, T)

  // runtime-only attaches ----------------------------------------------------------
  it.fails('trend-targets-algoalpha RDDT (runtime pane): MATCH', () => {
    expect(grade('trend-targets-algoalpha-rddt-1d-2026-10-02', 'runtime').v.verdict).toBe('MATCH')
  }, T)
  it('control: RDDT objects now MATCH (label texts rounded to the tick, "TP1 ▸ 177.53"); the barcolor is drawn and agrees (RT6); plots agree', () => {
    const v = grade('trend-targets-algoalpha-rddt-1d-2026-10-02', 'runtime').v
    // ⭐ F3 — `str.tostring(x, format.mintick)` was read as "no format" and drew
    // "177.5276604489"; it now rounds to the witnessed NYSE tick (0.01) and keeps
    // the tick's decimals (`pineTextFormat.js::tickNumberText`).
    expect(v.objects.verdict, v.objects.reason).toBe('MATCH')
    expect(v.objects.texts.find((x) => x.family === 'labels text').agree).toBe(true)
    // ⭐ RT6 — the runtime document now carries the barcolor as a colour column of
    // the run, and it agrees with the one TradingView draws (it was `notDrawn`).
    expect(v.paints.reason).toMatch(/agree/)
    expect(v.paints.rows.map((r) => r.state)).toEqual(['agree'])
    // ⭐ RT6 — `Baseline` (`plot(tL, color = trend == 1 ? … : …)`) was withheld for its
    // per-bar colour and is now drawn: its COLOUR agrees on every compared bar, and what
    // diverges is its VALUE's seed — na on bar 140 where TradingView has the first value,
    // then a prefix converging to 1e-9 by bar 221 (a run value defect RT6 exposed, not
    // a colour one). Pinned so a fix to the seed flips this line.
    const base = item(v, 'Baseline')
    expect(base.stats.colorMismatches).toBe(0)
    expect(base.stats.colorCompared).toBeGreaterThan(400)
    expect(base.stats.naMismatches).toBe(1)
    expect(base.stats.firstDivergence).toMatchObject({ bar: 140, kind: 'na' })
    expect(base.stats.steady.last.bar).toBeLessThanOrEqual(221)
    expect(base.stats.maxRel).toBeLessThan(1e-3)
    expect(v.plots.filter((p) => p.verdict === 'DIVERGE').map((p) => p.title)).toEqual(['Baseline'])
    expect(item(v, 'Bullish Rejection').verdict).toBe('MATCH')
  }, T)
  it('trend-targets-algoalpha SPY (runtime pane): the run declines a window not from the listing (runtime:history-start) — draws nothing', () => {
    const v = grade('trend-targets-algoalpha-spy-1d-2026-10-02', 'runtime').v
    expect(v.objects.reason).toMatch(/runtime:history-start/)
  }, T)
  it.fails('wyckoff-accumulation-distribution RDDT (runtime pane): MATCH', () => {
    expect(grade('wyckoff-accumulation-distribution-rddt-1d-2026-10-02', 'runtime').v.verdict).toBe('MATCH')
  }, T)
  it('control: wyckoff — TradingView holds 12 (RDDT) / 22 (SPY) boxes; the run that owns them (RT5) draws none, by name; the offset barcolor is withheld', () => {
    // RT5 (step 72): the run now OWNS its drawings, so the objects verdict reads the
    // run's own answer: RDDT stops on an engine error (the same one that leaves the
    // 8 plots without a column), SPY on `calc_bars_count = 1000` against 1,800 bars.
    // ⭐ WAVE 16: with H4 withholding wyckoff's offset markers, RDDT's run computes no
    // column at all, so RT4's gate (`runtime:objects-without-run`: no drawings without a
    // run that computed) answers first, as "the run drew nothing". Either named reason
    // is a refusal; what this control pins is that nothing is DRAWN.
    for (const [id, why] of [['wyckoff-accumulation-distribution-rddt-1d-2026-10-02', /engine-error: array\.max of an empty array|the run drew nothing/],
      ['wyckoff-accumulation-distribution-spy-1d-2026-10-02', /runtime:calc-bars-count|the run drew nothing/]]) {
      const v = grade(id, 'runtime').v
      expect(v.objects.verdict, id).toBe('INCONCLUSIVE')
      expect(v.objects.reason, id).toMatch(why)
      // ⭐ F1 — the `offset` is served now (render-time placement); a runtime-lane
      // document draws no paint, and says so ("Not drawn by this pane")
      expect(v.paints.reason, id).toMatch(/notDrawn/)
    }
  }, T)
  it('fibonacci-dolphintradebot RDDT (runtime pane): MATCH — RT5 draws the 7 lines + 7 labels from the run', () => {
    const v = grade('fibonacci-dolphintradebot-rddt-1d-2026-10-02', 'runtime').v
    expect(v.verdict).toBe('MATCH')
    expect(v.objects.verdict).toBe('MATCH')
    expect(v.objects.counts.filter((c) => c.vendor > 0).map((c) => [c.family, c.ours])).toEqual([['lines', 7], ['labels', 7]])
    expect(items(v, 'Chars').every((p) => p.verdict === 'MATCH')).toBe(true)
  }, T)
  it('control: fibonacci-dolphintradebot SPY — the run declines a window not from the listing (runtime:history-start) and draws nothing', () => {
    const v = grade('fibonacci-dolphintradebot-spy-1d-2026-10-02', 'runtime').v
    expect(v.objects.verdict).toBe('INCONCLUSIVE')
    expect(v.objects.reason).toMatch(/runtime:history-start/)
  }, T)
})

// ─── F2 (step 78) — RT3 Q-NL: `and` / `or` / `not` over an `na` operand ───────────
// TradingView (v5 and v4, RDDT 1D from the listing): an `na` operand reads as FALSE and
// the answer is never `na`. Before F2 the door drew `na` on B02 / B03 / B07 and a wrong 1
// on B04 / B05 (`na(w or false)`, `na(not w)`). The capture stays INCONCLUSIVE only for
// the four rows our pane folds to a hidden constant (B01 / B06 / B07 / B09), whose values agree.
describe('F2 — RT3 Q-NL: an `na` operand of `and` / `or` / `not` is false (v4 and v5)', () => {
  it.each([
    ['rt3-na-logic-rddt-1d-2026-10-02'],
    ['rt3-na-logic-v4-rddt-1d-2026-10-02'],
  ])('%s: every graded row agrees; nothing diverges', (id) => {
    const { v } = grade(id)
    expect(v.plots.filter((p) => p.verdict === 'DIVERGE').map((p) => p.title)).toEqual([])
    for (const t of ['B02_not_naBool', 'B03_naBool_and_true_CONTROL', 'B04_na_of_naBool_or_false',
      'B05_na_of_not_naBool', 'B08_naFloat_or_false', 'B10_not_naFloat']) {
      expect(item(v, t).verdict, `${id} ${t}`).toBe('MATCH')
    }
    // B07 `not <na literal>` now folds to a constant 1 on every bar (TradingView's 1): its
    // VALUES agree on all 636 bars; only its colour is unresolvable (a hidden constant row)
    const b07 = item(v, 'B07_not_naLiteral')
    expect(b07.verdict).toBe('INCONCLUSIVE')
    expect(b07.stats.steady.divergent).toBe(0)
    expect(b07.reason).toMatch(/values agree/)
    // non-vacuity: the rows are graded from bar 0 (a capture from the listing), so the
    // `na` warm-up bars 0..18 are compared, not excused
    expect(item(v, 'B04_na_of_naBool_or_false').stats.steady.compared).toBe(636)
  }, T)
})

// ─── INCONCLUSIVE — measured, but nothing comparable on our side ───────────────
describe('CAP2 coverage audit — INCONCLUSIVE', () => {
  it('delta-rsi-oscillator-strategy (runtime pane): the run attaches and computes no column for Buy / Sell / Exit Long / Exit Short', () => {
    for (const id of ['delta-rsi-oscillator-strategy-rddt-1d-2026-10-02', 'delta-rsi-oscillator-strategy-spy-1d-2026-10-02']) {
      const v = grade(id, 'runtime').v
      expect(v.verdict, id).toBe('INCONCLUSIVE')
      for (const t of ['Buy', 'Sell', 'Exit Long', 'Exit Short']) expect(item(v, t).reason, `${id} ${t}`).toMatch(/no column/)
    }
  }, T)
  it('opening-range-initial-balance-opening-price: TradingView repeats titles (Shapes, OR Low, IB Low), so 11 of 15 items are UNMAPPED', () => {
    const v = grade('opening-range-initial-balance-opening-price-rddt-1d-2026-10-02').v
    expect(v.verdict).toBe('INCONCLUSIVE')
    expect(v.plots.filter((p) => /UNMAPPED/.test(p.reason || '')).length).toBe(11)
  }, T)
  it('the object-pane door still refuses the runtime-only four by name (the census `on` state)', () => {
    expect(grade('trend-targets-algoalpha-rddt-1d-2026-10-02').v.reason).toMatch(/pine:state/)
    expect(grade('wyckoff-accumulation-distribution-rddt-1d-2026-10-02').v.reason).toMatch(/pine:state/)
    expect(grade('delta-rsi-oscillator-strategy-rddt-1d-2026-10-02').v.reason).toMatch(/pine:tuple/)
    expect(grade('fibonacci-dolphintradebot-rddt-1d-2026-10-02').v.reason).toMatch(/pine:collection/)
  }, T)
})

// ─── CAP3 (2026-10-03, step 81) — the standing capture lane's queue ─────────────
// Captured on the same rig and route as CAP2 (unsaved Create-new drafts, the editor's
// sha256 read back equal to the committed file, `tv_capture.js`, a hash-receipted
// clipboard, `verify_capture.mjs` VERDICT: PASS). `rolling-vwap` imports
// PineCoders/ConditionalAverages/2: production's library store holds it, every committed
// rail's registry is empty, so its door grade is opt-in (`PINE_LIBRARY_STORE=<scratch
// store>`, L1's loader) and the empty-registry refusal is pinned.
const col3 = (cap, title) => {
  const plot = cap.study.plots.find((p) => p.title === title)
  const at = cap.plotValues.fields.indexOf(plot.id)
  return cap.plotValues.rows.map((r) => r[at])
}
const STORE_DIR = process.env.PINE_LIBRARY_STORE || ''
describe('CAP3 — Q-L2a rolling-vwap (runtime lane, library linked)', () => {
  it('vendor: RDDT from the listing (636 bars, startsAtBar0) and SPY 1800 bars; the source is the corpus file', () => {
    const r = grade('rolling-vwap-rddt-1d-2026-10-03', 'runtime').cap
    expect(r.history.startsAtBar0).toBe(true)
    expect(r.bars.count).toBe(636)
    expect(r.source.sha256).toBe('232f76befd87476a05ced1cf39efc7c5b4cd4600ffb30e2baf0f67079a3bb73a')
    expect(grade('rolling-vwap-spy-1d-2026-10-03', 'runtime').cap.bars.count).toBe(1800)
  }, T)
  it('empty registry (every rail; production before its store loads): the door refuses on the import, by name', () => {
    expect(grade('rolling-vwap-rddt-1d-2026-10-03', 'runtime').v.reason).toMatch(/ConditionalAverages/)
  }, T)
  describe.skipIf(!STORE_DIR)('with the library store (opt-in PINE_LIBRARY_STORE)', () => {
    const graded = new Map()
    const gradeStore = (id) => {
      if (!graded.has(id)) {
        loadPineLibraryStore(STORE_DIR)
        vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
        vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
        const cap = loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
        graded.set(id, gradeCapture(cap).verdict)
        vi.unstubAllEnvs()
        clearPineLibraries()
      }
      return graded.get(id)
    }
    it('⭐ RDDT: all 7 plots MATCH TradingView on all 636 bars', () => {
      const v = gradeStore('rolling-vwap-rddt-1d-2026-10-03')
      expect(v.plots.length).toBe(7)
      for (const p of v.plots) {
        expect(p.verdict, `${p.title}: ${p.reason}`).toBe('MATCH')
        expect(p.stats.compared, p.title).toBe(636)
      }
    }, T)
    it.fails('RDDT: MATCH overall', () => {
      expect(gradeStore('rolling-vwap-rddt-1d-2026-10-03').verdict).toBe('MATCH')
    }, T)
    it('control: the one divergence is the info table cell — TradingView writes "1M", our run draws the table with no cell', () => {
      const o = gradeStore('rolling-vwap-rddt-1d-2026-10-03').objects
      expect(o.counts.find((c) => c.family === 'tables')).toMatchObject({ vendor: 1, ours: 1 })
      expect(o.counts.find((c) => c.family === 'tableCells')).toMatchObject({ vendor: 1, ours: 0 })
      expect(o.texts.find((t) => t.family === 'tableCells text').onlyVendor).toEqual(['1M'])
    }, T)
    it('SPY (a window not from the listing): the run declines by name (runtime:history-start) — no column, nothing drawn', () => {
      const v = gradeStore('rolling-vwap-spy-1d-2026-10-03')
      expect(v.verdict).toBe('INCONCLUSIVE')
      expect(v.plots.every((p) => /no column/.test(p.reason || ''))).toBe(true)
      expect(v.objects.reason).toMatch(/runtime:history-start/)
    }, T)
  })
})

describe('CAP3 — Q-RT5a vw-rt5-arm-draw-block-history, NYSE:RDDT 1D from the listing (vendor witness)', () => {
  const cap = () => grade('vw-rt5-arm-draw-block-history-rddt-1d-2026-10-03').cap
  it('T01/T02: a label.new in the THEN arm of ?: is made only on the bars that arm runs — 308 labels, one per UP bar; the handle is present exactly on UP bars', () => {
    const c = cap()
    expect(c.history.startsAtBar0).toBe(true)
    const up = c.bars.rows.map((b) => b[4] > b[1])
    expect(up.filter(Boolean).length).toBe(308)
    expect(c.objects.counts.labels).toBe(308)
    const t02 = col3(c, 'T02_arm_handle_present')
    expect(t02.every((x, i) => (x === 1) === up[i])).toBe(true)
  }, T)
  it('B01: a block local [1] inside a global if is the PREVIOUS EXECUTION value (the previous UP bar bar_index), na on the first UP bar and on every non-UP bar; B00 is bar_index', () => {
    const c = cap()
    const up = c.bars.rows.map((b) => b[4] > b[1])
    let prev = null
    const want = up.map((u, i) => { const e = u ? prev : null; if (u) prev = i; return e })
    expect(col3(c, 'B01_block_local_prev_exec')).toEqual(want)
    expect(col3(c, 'B00_bar_index_CONTROL')).toEqual(c.bars.rows.map((_, i) => i))
  }, T)
  it('door (RT5 merged): still refused by name (pine:drawing) — the ternary-arm label is a named refusal this capture is the evidence for', () => {
    expect(grade('vw-rt5-arm-draw-block-history-rddt-1d-2026-10-03', 'runtime').v.reason).toMatch(/pine:drawing/)
  }, T)
})

describe('CAP3 — Q-H4a vw-h4-loops (vendor witness)', () => {
  // A hand replay of the probe's Pine semantics, independent of the engine.
  function replay(bars) {
    const C = bars.map((b) => b[4]); const O = bars.map((b) => b[1])
    let st = null
    return C.map((_, t) => {
      let norm = 0; let s = 0; let ok = true
      for (let i = 0; i < 13; i++) {
        const w = (13 - i) * 13; norm += w
        if (t - i < 0) { ok = false; break }
        s += C[t - i] * w * (C[t - i] < O[t - i] ? -1 : 1)
      }
      if (st === null) st = [C[t], C[t], C[t]]
      st = st.map((x) => x + 0.5 * (C[t] - x))
      return { L1: ok ? s / norm : null, L2: st[0], L3: t >= 2 ? C[t] + C[t - 1] + C[t - 2] : null }
    })
  }
  const same = (a, b) => (a === null || b === null ? a === b : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)))
  it('RDDT from the listing: L1 / L2 / L3 equal the hand replay on all 636 bars (L1 from bar 12, L3 from bar 2; n = 3 on every bar)', () => {
    const c = grade('vw-h4-loops-rddt-1d-2026-10-03').cap
    expect(c.history.startsAtBar0).toBe(true)
    const r = replay(c.bars.rows)
    const l1 = col3(c, 'L1 wsum(close, a+b)'); const l2 = col3(c, 'L2 seeded filter'); const l3 = col3(c, 'L3 sum of last n closes')
    expect(l1.findIndex((x) => x !== null)).toBe(12)
    expect(l3.findIndex((x) => x !== null)).toBe(2)
    expect(r.every((x, i) => same(l1[i], x.L1) && same(l2[i], x.L2) && same(l3[i], x.L3))).toBe(true)
    expect(new Set(col3(c, 'L3 n'))).toEqual(new Set([3]))
  }, T)
  it('SPY (1800 bars, not from the listing): the replay agrees once the warm-up the earlier history supplies is past (L1 from bar 12, L2 within 22 bars, L3 from bar 2)', () => {
    const c = grade('vw-h4-loops-spy-1d-2026-10-03').cap
    const r = replay(c.bars.rows)
    const l1 = col3(c, 'L1 wsum(close, a+b)'); const l2 = col3(c, 'L2 seeded filter'); const l3 = col3(c, 'L3 sum of last n closes')
    const bad = (col, k) => col.map((x, i) => (same(x, r[i][k]) ? -1 : i)).filter((i) => i >= 0)
    expect(bad(l1, 'L1')).toEqual([...Array(12).keys()])
    expect(Math.max(...bad(l2, 'L2'))).toBeLessThan(22)
    expect(bad(l3, 'L3')).toEqual([0, 1])
  }, T)
  it('⭐ door (runtime pane, H4 merged): RDDT MATCH — all four rows on all 636 bars', () => {
    const v = grade('vw-h4-loops-rddt-1d-2026-10-03', 'runtime').v
    expect(v.verdict, v.reason).toBe('MATCH')
    expect(v.plots.length).toBe(4)
    for (const p of v.plots) expect(p.stats.compared, p.title).toBe(636)
  }, T)
  it('door: SPY (a window not from the listing) — the run computes no column; the objects pane alone still refuses the `for` (pine:block)', () => {
    const s = grade('vw-h4-loops-spy-1d-2026-10-03', 'runtime').v
    expect(s.verdict).toBe('INCONCLUSIVE')
    expect(s.plots.every((p) => /no column/.test(p.reason || ''))).toBe(true)
    expect(grade('vw-h4-loops-rddt-1d-2026-10-03').v.reason).toMatch(/pine:block/)
  }, T)
})

describe('CAP3 — Q-RT5b renko-candles-overlay (the runtime lane draws its own objects, RT5 merged)', () => {
  it('vendor: RDDT from the listing (636 bars) and SPY 1800 bars; the source is the corpus file', () => {
    const r = grade('renko-candles-overlay-rddt-1d-2026-10-03', 'runtime').cap
    expect(r.history.startsAtBar0).toBe(true)
    expect(r.bars.count).toBe(636)
    expect(r.source.sha256).toBe('b41903eaef3cdd27e29411a6d1a102ab8927e22b474e459b3086b4dab3b1da40')
    expect(grade('renko-candles-overlay-spy-1d-2026-10-03', 'runtime').cap.bars.count).toBe(1800)
  }, T)
  it('⭐ RDDT (runtime pane): MATCH — 142 boxes, 2 lines, 2 labels, texts and colours (290 paired slots) and the paint agree', () => {
    const v = grade('renko-candles-overlay-rddt-1d-2026-10-03', 'runtime').v
    expect(v.verdict, v.reason).toBe('MATCH')
    expect(v.objects.verdict).toBe('MATCH')
    expect(v.objects.counts.find((c) => c.family === 'boxes')).toMatchObject({ vendor: 142, ours: 142 })
    expect(v.objects.counts.find((c) => c.family === 'lines')).toMatchObject({ vendor: 2, ours: 2 })
    expect(v.objects.counts.find((c) => c.family === 'labels')).toMatchObject({ vendor: 2, ours: 2 })
    expect(v.paints.verdict).toBe('MATCH')
  }, T)
  it('SPY (a window not from the listing): the paint agrees; the run draws nothing (TradingView 141 boxes) — INCONCLUSIVE, not a match', () => {
    const v = grade('renko-candles-overlay-spy-1d-2026-10-03', 'runtime').v
    expect(v.verdict).toBe('INCONCLUSIVE')
    expect(v.paints.verdict).toBe('MATCH')
    expect(v.objects.reason).toMatch(/the run drew nothing/)
  }, T)
  it('the objects pane alone still refuses it by name (pine:collection)', () => {
    expect(grade('renko-candles-overlay-rddt-1d-2026-10-03').v.reason).toMatch(/pine:collection/)
  }, T)
})

// ─── CAP3 — AMEX:SPY 1D for every census runtime-state attach that had none ──────
// Each row's signature (`cap3-spy-gap-verdicts.json`) was written by
// `cap3SpyGaps.measure.test.js` from the harness's own verdict, never by hand. MATCH
// rows are an `expect`; a DIVERGE row is an `it.fails` asserting MATCH beside the
// signature control that names what diverges (item, first bar, kind, count; object
// families vendor vs ours). Most SPY value divergences are converging prefixes: the
// 1800-bar window does not start at SPY's listing, so a recursive series (EMA, RMA)
// seeds differently (CAP2 records the same); the signature says which.
/** ⛔ Scripts whose DRAWN COUNTS read the wall clock (`timenow`): black-scholes computes
 *  days-to-expiry from now, so its table cells change with the hour the rail runs
 *  (measured: 8 cells at capture, 6 the next morning). A test that reads the clock is a
 *  function of the hour; for these the control pins everything except those counts. */
const WALL_CLOCK = new Set(['black-scholes-option-pricing-model-w-greeks-loxx-spy-1d-2026-10-03'])
const CAP3_SPY = JSON.parse(fs.readFileSync(path.join(__dirname, 'cap3-spy-gap-verdicts.json'), 'utf8')).captures
const gradeRow = (row) => {
  if (row.library) loadPineLibraryStore(STORE_DIR)
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  if (row.state === 'runtime') vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  const v = gradeCapture(loadCapture(path.join(HARNESS_DIR, `${row.id}.json`)).capture).verdict
  vi.unstubAllEnvs()
  clearPineLibraries()
  return v
}
describe('CAP3 — SPY 1D captures of the census gap list', () => {
  it('every row is a v1 capture on AMEX:SPY 1D past 1,000 bars, its source the corpus file, and carries a measured signature', () => {
    expect(CAP3_SPY.length).toBeGreaterThan(0)
    for (const row of CAP3_SPY) {
      const cap = loadCapture(path.join(HARNESS_DIR, `${row.id}.json`)).capture
      expect(cap.symbol.full_name, row.id).toBe('AMEX:SPY')
      expect(cap.bars.count, row.id).toBeGreaterThan(1000)
      expect(row.signature, row.id).toBeTruthy()
    }
  }, T)
  for (const row of CAP3_SPY) {
    const run = row.library && !STORE_DIR ? it.skip : it
    if (row.signature && row.signature.verdict === 'MATCH') {
      run(`${row.id} (${row.state}): MATCH`, () => {
        expect(gradeRow(row).verdict).toBe('MATCH')
      }, T)
      continue
    }
    if (row.signature && row.signature.verdict === 'DIVERGE') {
      ;(row.library && !STORE_DIR ? it.skip : it.fails)(`${row.id} (${row.state}): MATCH`, () => {
        expect(gradeRow(row).verdict).toBe('MATCH')
      }, T)
    }
    run(`control: ${row.id} (${row.state}) — the grade is the measured signature (${row.signature && row.signature.verdict})`, () => {
      const got = cap3Signature(gradeRow(row))
      if (WALL_CLOCK.has(row.id)) {
        // ⛔ the drawing COUNTS depend on the hour the test runs (see WALL_CLOCK);
        // everything that does not is still pinned
        const strip = (s) => ({ ...s, objects: s.objects ? [s.objects[0]] : null })
        expect(strip(got)).toEqual(strip(row.signature))
      } else {
        expect(got).toEqual(row.signature)
      }
    }, T)
  }
})
