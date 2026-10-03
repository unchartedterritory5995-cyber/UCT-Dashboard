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
  it('control: RDDT plots and the barcolor agree; TradingView holds 1 drawing and our script has no drawing program', () => {
    const { v } = grade('atr-trailing-stop-by-ceyhun-rddt-1d-2026-10-02')
    expect(v.plots.every((p) => p.verdict === 'MATCH')).toBe(true)
    expect(v.paints.verdict).toBe('MATCH')
    expect(v.objects.reason).toMatch(/holds 1 drawing object.*no drawing program/)
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
  it.fails('cpr-with-mas-super-trend-vwap RDDT: MATCH', () => {
    expect(grade('cpr-with-mas-super-trend-vwap-by-guruprasadmeduri-rddt-1d-2026-10-02').v.verdict).toBe('MATCH')
  }, T)
  it('control: RDDT VWAP is na on every one of 636 bars (TradingView: a value); the other 28 compared items agree', () => {
    const { v } = grade('cpr-with-mas-super-trend-vwap-by-guruprasadmeduri-rddt-1d-2026-10-02')
    const p = item(v, 'VWAP')
    expect(first(p)).toMatchObject({ bar: 0, kind: 'na' })
    expect(p.stats.steady.divergent).toBe(636)
    expect(v.plots.filter((x) => x.verdict === 'DIVERGE').map((x) => x.title)).toEqual(['VWAP'])
  }, T)
  it.fails('cpr-with-mas-super-trend-vwap SPY: MATCH', () => {
    expect(grade('cpr-with-mas-super-trend-vwap-by-guruprasadmeduri-spy-1d-2026-10-02').v.verdict).toBe('MATCH')
  }, T)
  it('control: SPY VWAP na from bar 960 to the last; CP/BC/TC/D-S1/D-R1 colour on bar 1 only (TradingView transparent); EMA a converging prefix', () => {
    const { v } = grade('cpr-with-mas-super-trend-vwap-by-guruprasadmeduri-spy-1d-2026-10-02')
    expect(first(item(v, 'VWAP'))).toMatchObject({ bar: 960, kind: 'na' })
    expect(item(v, 'VWAP').stats.steady.pattern.kind).toBe('persistent')
    for (const t of ['CP', 'BC', 'TC', 'D-S1', 'D-R1']) {
      expect(first(item(v, t)), t).toMatchObject({ bar: 1, kind: 'color' })
      expect(item(v, t).stats.steady.divergent, t).toBe(1)
    }
    expect(item(v, 'EMA').stats.steady.pattern.kind).toBe('converging-prefix')
  }, T)

  // implied-volatility-suite ----------------------------------------------------
  it.fails('implied-volatility-suite RDDT: MATCH', () => {
    expect(grade('implied-volatility-suite-rddt-1d-2026-10-02').v.verdict).toBe('MATCH')
  }, T)
  it.fails('implied-volatility-suite SPY: MATCH', () => {
    expect(grade('implied-volatility-suite-spy-1d-2026-10-02').v.verdict).toBe('MATCH')
  }, T)
  it('control: values agree; the per-bar colour of Volatility Data differs from bar 364 (RDDT) / 412 (SPY), persistent', () => {
    for (const [id, bar] of [['implied-volatility-suite-rddt-1d-2026-10-02', 364], ['implied-volatility-suite-spy-1d-2026-10-02', 412]]) {
      const p = item(grade(id).v, 'Volatility Data')
      expect(first(p), id).toMatchObject({ bar, kind: 'color' })
      expect(p.stats.steady.pattern.kind).toBe('persistent')
    }
  }, T)

  // multicator-table ------------------------------------------------------------
  it.fails('multicator-table RDDT / SPY: MATCH', () => {
    expect(grade('multicator-table-rddt-1d-2026-10-02').v.verdict).toBe('MATCH')
  }, T)
  it('control: every compared plot agrees on both symbols; TradingView holds 72 drawings (the tables) and our script has no drawing program', () => {
    for (const id of ['multicator-table-rddt-1d-2026-10-02', 'multicator-table-spy-1d-2026-10-02']) {
      const { v } = grade(id)
      expect(v.plots.filter((p) => p.verdict === 'DIVERGE'), id).toEqual([])
      expect(v.objects.reason, id).toMatch(/holds 72 drawing object.*no drawing program/)
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
    expect(s.objects.reason).toMatch(/holds 1 drawing object.*no drawing program/)
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
  it.fails('swing-highlow-zigzag-chartprime RDDT: MATCH', () => {
    expect(grade('swing-highlow-zigzag-chartprime-rddt-1d-2026-10-02').v.verdict).toBe('MATCH')
  }, T)
  it('control: the two "Swing H / Swing L" labels are not drawn (RDDT and SPY); on SPY we hold 12 of TradingView\'s 52 zigzag lines', () => {
    const r = grade('swing-highlow-zigzag-chartprime-rddt-1d-2026-10-02').v.objects
    expect(r.counts.find((c) => c.family === 'lines')).toMatchObject({ vendor: 10, ours: 10 })
    expect(r.counts.find((c) => c.family === 'labels')).toMatchObject({ vendor: 2, ours: 0 })
    const s = grade('swing-highlow-zigzag-chartprime-spy-1d-2026-10-02').v.objects
    expect(s.counts.find((c) => c.family === 'lines')).toMatchObject({ vendor: 52, ours: 12 })
    expect(s.counts.find((c) => c.family === 'labels')).toMatchObject({ vendor: 2, ours: 0 })
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
  it('control: RDDT label texts print full precision where TradingView rounds to the tick ("TP1 ▸ 177.53"); the barcolor is not drawn; plots agree', () => {
    const v = grade('trend-targets-algoalpha-rddt-1d-2026-10-02', 'runtime').v
    const t = v.objects.texts.find((x) => x.family === 'labels text')
    expect(t.agree).toBe(false)
    expect(t.onlyVendor).toContain(' ✔ TP1 ▸ 177.53')
    expect(t.onlyOurs).toContain(' ✔ TP1 ▸ 177.5276604489')
    expect(v.paints.reason).toMatch(/notDrawn/)
    expect(item(v, 'Bullish Rejection').verdict).toBe('MATCH')
  }, T)
  it('trend-targets-algoalpha SPY (runtime pane): the run declines a window not from the listing (runtime:history-start) — draws nothing', () => {
    const v = grade('trend-targets-algoalpha-spy-1d-2026-10-02', 'runtime').v
    expect(v.objects.reason).toMatch(/runtime:history-start/)
  }, T)
  it.fails('wyckoff-accumulation-distribution RDDT (runtime pane): MATCH', () => {
    expect(grade('wyckoff-accumulation-distribution-rddt-1d-2026-10-02', 'runtime').v.verdict).toBe('MATCH')
  }, T)
  it('control: wyckoff — TradingView holds 12 (RDDT) / 22 (SPY) boxes and our run has no drawing program; the offset barcolor is withheld', () => {
    for (const [id, n] of [['wyckoff-accumulation-distribution-rddt-1d-2026-10-02', 12], ['wyckoff-accumulation-distribution-spy-1d-2026-10-02', 22]]) {
      const v = grade(id, 'runtime').v
      expect(v.objects.reason, id).toMatch(new RegExp(`holds ${n} drawing object.*no drawing program`))
      expect(v.paints.reason, id).toMatch(/offset/)
    }
  }, T)
  it.fails('fibonacci-dolphintradebot RDDT (runtime pane): MATCH', () => {
    expect(grade('fibonacci-dolphintradebot-rddt-1d-2026-10-02', 'runtime').v.verdict).toBe('MATCH')
  }, T)
  it('control: fibonacci-dolphintradebot — the two char plots agree on RDDT; TradingView holds 14 drawings (the fib levels) and our run has none', () => {
    const v = grade('fibonacci-dolphintradebot-rddt-1d-2026-10-02', 'runtime').v
    expect(items(v, 'Chars').every((p) => p.verdict === 'MATCH')).toBe(true)
    expect(v.objects.reason).toMatch(/holds 14 drawing object.*no drawing program/)
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
  it('door on this tree: refused by name (pine:drawing) — the RT5 branch is what this capture grades', () => {
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
  it('door on this tree: refused by name (pine:block, the `for` in wsum) — the H4 branch is what this capture grades', () => {
    expect(grade('vw-h4-loops-rddt-1d-2026-10-03', 'runtime').v.reason).toMatch(/pine:block/)
  }, T)
})
