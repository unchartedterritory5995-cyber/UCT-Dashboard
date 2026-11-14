// app/src/components/chart/engine/__truth__/p0.inv.truth.test.js
//
// P0 TRUTH CORPUS — slice "inv" (investigation / characterization).
//
// ⛔ THESE TESTS PIN THE *CURRENT* BEHAVIOUR AND DOCUMENT HOW IT DIFFERS FROM
// TRADINGVIEW. They change no evaluator. A failure here means the engine's output
// moved: decide deliberately whether that was the owner-approved correction
// (then update the pin and the disclosure together) or a regression.
//
// Every case states ASKED / CLAIMED / DID and classifies the outcome as one of
// VALUE, UNKNOWN, REFUSAL, EXACT, DISCLOSED DIFFERENCE, PARTIAL, UNSUPPORTED,
// CONTROLLED ERROR. Report: scratchpad/P0-inv-report.md.
//
// ── 0N  HIGHER-TIMEFRAME `request.security(…, lookahead_off)` ON A DAILY CHART ──
// ⭐⭐ ENGINE 55 — FLIPPED DELIBERATELY. UCT used to translate it to `tf(expr, 'W'|'M')`,
// which reads bucket b-1 on EVERY bar, and disclosed the one-bar lag on each period's
// last bar (`htfLookaheadOffStepBacks`). It now translates to `tf_merge`, TradingView's
// historical rule: the bar that COMPLETES a period reads that period's value, every
// other bar the previous completed period's, and the NEWEST finished bar — whose
// period end is the next session's date — is withheld by name
// (`request:htf-newest-unconfirmed`). MEASURED on W/M on D since: 0 mismatches over
// the `support-and-resistance-multi-time-frame-{rddt,spy}-1d-2026-10-02` captures
// (598 + 1,799 bars, 8 weekly/monthly plots). Formula `tf` is unchanged (b-1), and it
// is still exactly TradingView's NON-repainting idiom
// `request.security(sym, tf, expr[1], lookahead=barmerge.lookahead_on)`.
//
// ── 0O  GAPPY (mid-series NaN) INPUTS ────────────────────────────────────────
// Three different gap contracts live side by side today:
//   * formula `ema`/`rma` (smoothStep): HOLD state across `na` — vendor-pinned
//     2026-09-08 (`na-in-a-source-window-vs-recurrence-spy-1d-2026-09-08`).
//   * formula bound functions (`rsi`, `atr`, `adx`, `stoch`, `cci`, `mfi`, `macd`,
//     `donchian*`…) via `bindShipped` → `finiteTailStart` (interpret.js:2010,
//     ast_interpret.py:2023): the column starts after the LAST hole in any input.
//   * native `emaOfSeries`/`smaOfSeries` (movingAverages.js): RESET at a hole;
//     native `rsiOfSeries` (technicalStudies.js:122): HOLD (skips the bar).
// Pine defines `ta.rsi` over `ta.rma`, and `ta.rma` HOLDS across `na` (witnessed),
// so the TV-consistent RSI on a gappy source is the native `rsiOfSeries` one.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { interpret } from '../ast/interpret.js'
import { parseFormula } from '../ast/parse.js'
import { translatePine } from '../ast/pine.js'
import { emaOfSeries, pointsToNumbers } from '../../movingAverages.js'
import { rsiOfSeries } from '../../technicalStudies.js'

const REPO = path.resolve(process.cwd(), '..')
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8'))
// 600 real AMEX:SPY daily bars, 2024-04-22 .. 2026-09-11 (a Friday; complete week).
const BARS = readJson('tests/fixtures/vendor/spy-1d-bars-3000-2026-09-13.json').bars.slice(-600)
const N = BARS.length
const fin = Number.isFinite
const H = '//@version=5\nindicator("p")\n'

const formula = (f, bars = BARS) => Array.from(interpret(parseFormula(f).ast, bars, {}))
const pineCol = (body, bars = BARS) => {
  const t = translatePine(H + body, { strict: true })
  expect(t.ok, body).toBe(true)
  const o = t.outputs[0]
  return { t, o, col: Array.from(interpret(o.ast, bars, undefined, undefined, undefined, { tf: 'D' })) }
}
/** Compare two columns: finite counts, one-sided finiteness, and value differences. */
const cmp = (a, b) => {
  const r = { finA: 0, finB: 0, onlyA: 0, onlyB: 0, valueDiffs: 0, max: 0 }
  for (let i = 0; i < a.length; i++) {
    const x = a[i]; const y = b[i]
    if (fin(x)) r.finA++
    if (fin(y)) r.finB++
    if (fin(x) && !fin(y)) r.onlyA++
    if (!fin(x) && fin(y)) r.onlyB++
    if (fin(x) && fin(y)) { const d = Math.abs(x - y); if (d > 1e-9) r.valueDiffs++; r.max = Math.max(r.max, d) }
  }
  return r
}

// ── the TradingView historical rule, built from the bars alone (no engine) ──
const isoWeek = (t) => {
  const d = new Date(`${t}T00:00:00Z`)
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10)
}
const isoMonth = (t) => t.slice(0, 7)
/** TV lookahead_off, HISTORICAL bars: the bar that completes a period reads that
 *  period's value; every other bar reads the previous completed period's. */
function tvLookaheadOff(bars, keyOf) {
  const k = bars.map((b) => keyOf(b.t))
  const isLast = bars.map((_, i) => i === bars.length - 1 || k[i + 1] !== k[i])
  const out = new Array(bars.length).fill(NaN)
  let prevFinal = NaN
  for (let i = 0; i < bars.length; i++) {
    if (i > 0 && k[i] !== k[i - 1]) prevFinal = bars[i - 1].c
    out[i] = isLast[i] ? bars[i].c : prevFinal
  }
  return { out, isLast, periods: new Set(k).size }
}

describe('P0 inv · 0N — HTF request.security(lookahead_off) on a daily chart (ENGINE 55: `tf_merge`)', () => {
  it('ASKED request.security(tickerid,"W",close) · CLAIMED a lookahead-off weekly read · DID `tf_merge(close,\'W\')` behind the daily gate, and no fold disclosure (nothing differs to disclose)', () => {
    const { o } = pineCol('plot(request.security(syminfo.tickerid, "W", close))')
    expect(o.formula).toBe("86400 != periodseconds ? 0 / 0 : tf_merge(close, 'W')")
    expect(o.baseTimeframeFolds).toEqual([])
    // ⚰️ the step-back channel is deleted with the difference it disclosed
    expect('htfLookaheadOffStepBacks' in o).toBe(false)
  })

  it('EXACT: W and M equal the TradingView historical rule on EVERY bar but the newest, which is WITHHELD (finished bar, period end unknown)', () => {
    for (const [code, keyOf] of [['W', isoWeek], ['M', isoMonth]]) {
      const uct = pineCol(`plot(request.security(syminfo.tickerid, "${code}", close))`).col
      const tv = tvLookaheadOff(BARS, keyOf)
      let diffs = 0
      let compared = 0
      for (let i = 0; i < N - 1; i++) {
        if (!fin(tv.out[i])) continue
        compared++
        if (uct[i] !== tv.out[i]) diffs++
      }
      expect(compared, code).toBeGreaterThan(500)
      expect(diffs, code).toBe(0)
      expect(fin(uct[N - 1]), `${code}: the newest finished bar is withheld`).toBe(false)
    }
  })

  it('…and on a FORMING newest bar it reads the forming period, as TradingView\'s realtime bar does', () => {
    const t = translatePine(H + 'plot(request.security(syminfo.tickerid, "W", close))', { strict: true })
    const col = Array.from(interpret(t.outputs[0].ast, BARS, undefined, undefined, undefined, { tf: 'D', newestBarIsForming: true }))
    expect(col[N - 1]).toBe(BARS[N - 1].c)
  })

  it('the native formula `tf(close,"W")` is UNCHANGED — the last closed week on every bar, TradingView\'s non-repainting idiom', () => {
    for (const code of ['W', 'M']) {
      const idiom = pineCol(`plot(request.security(syminfo.tickerid, "${code}", close[1], lookahead=barmerge.lookahead_on))`)
      expect(idiom.o.formula).toBe(`86400 != periodseconds ? 0 / 0 : tf_live(close[1], '${code}')`)
      expect(cmp(formula(`tf(close, "${code}")`), idiom.col)).toMatchObject({ onlyA: 0, onlyB: 0, valueDiffs: 0 })
    }
  })

  it('the Pine read and the formula `tf` now differ EXACTLY on the bars that complete a period (W: 124 of 600 on this series)', () => {
    const pine = pineCol('plot(request.security(syminfo.tickerid, "W", close))').col
    const f = formula('tf(close, "W")')
    const tv = tvLookaheadOff(BARS, isoWeek)
    const diffs = []
    for (let i = 0; i < N - 1; i++) if (fin(pine[i]) && fin(f[i]) && pine[i] !== f[i]) diffs.push(i)
    expect(diffs.length).toBe(123)                                // 124 week ends, the newest withheld
    expect(diffs.every((i) => tv.isLast[i])).toBe(true)
  })

  it('EVIDENCE: the TV rule is WITNESSED one timeframe down (packet #3, "D" on 5m): the completing bar reads its own period', () => {
    const cap = readJson('tests/fixtures/vendor/harness/request-realtime-alignment-spy-5-b-2026-10-01.json')
    const col = (title) => {
      const id = cap.study.plots.find((p) => p.title === title).id
      const c = cap.plotValues.fields.indexOf(id)
      return cap.plotValues.rows.map((r) => r[c])
    }
    const on = col('R1_close_D_lookahead_ON'); const off = col('R2_close_D_lookahead_OFF')
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    const day = cap.bars.rows.map((r) => fmt.format(new Date(r[0] * 1000)))
    for (const [d, prev] of [['2026-09-29', '2026-09-28'], ['2026-09-30', '2026-09-29']]) {
      const idx = day.map((x, i) => (x === d ? i : -1)).filter((i) => i >= 0)
      const own = on[idx[0]]
      const before = on[day.indexOf(prev)]
      expect(idx.slice(0, -1).every((i) => off[i] === before)).toBe(true)
      expect(off[idx[idx.length - 1]]).toBe(own)                 // ← the completing bar: `tf_merge` reads it here
    }
  })
})

describe('P0 inv · 0O — gappy series: formula bound functions vs native studies', () => {
  const HOLE = 300
  const planted = BARS.map((b, i) => (i === HOLE ? { ...b, c: NaN } : b))
  const plantedClose = planted.map((b) => b.c)

  it('ASKED rsi(close,14) on a series with ONE mid-series hole · CLAIMED RSI · DID erase every value before the hole (UNKNOWN, 315 bars) and restart after it', () => {
    const f = formula('rsi(close, 14)', planted)
    const native = rsiOfSeries(plantedClose, 14)
    expect(f.findIndex(fin)).toBe(HOLE + 15)                    // finiteTailStart: start = hole + 1, + 14 warm-up
    expect(cmp(f, native)).toMatchObject({ finA: 285, finB: 584, onlyA: 0, onlyB: 299 })
  })

  it('SILENT DIFFERENCE (needs owner ruling): the restarted formula RSI differs from the TV-consistent hold rule for ~80 bars after the hole, max 3.57 points', () => {
    const f = formula('rsi(close, 14)', planted)
    const native = rsiOfSeries(plantedClose, 14)
    const r = cmp(f, native)
    expect(r.valueDiffs).toBe(285)
    expect(r.max).toBeCloseTo(3.5713, 3)
    let lastBig = -1
    for (let i = HOLE + 1; i < N; i++) if (fin(f[i]) && fin(native[i]) && Math.abs(f[i] - native[i]) > 0.01) lastBig = i
    expect(lastBig).toBe(396)
  })

  it('UNKNOWN: a hole on the NEWEST bar (e.g. a secondary symbol whose last bar is missing) leaves formula `rsi` with ZERO values; native has 584', () => {
    const lastHole = BARS.map((b, i) => (i === N - 1 ? { ...b, c: NaN } : b))
    expect(formula('rsi(close, 14)', lastHole).filter(fin).length).toBe(0)
    expect(formula('atr(high, low, close, 14)', lastHole).filter(fin).length).toBe(0)
    expect(rsiOfSeries(lastHole.map((b) => b.c), 14).filter(fin).length).toBe(585)
  })

  it('formula `ema` HOLDS (TV, vendor-pinned) while native `emaOfSeries` RESETS: 9 bars only the formula answers, 103 value differences, max 0.833', () => {
    const f = formula('ema(close, 10)', planted)
    const n = pointsToNumbers(emaOfSeries(plantedClose, 10, N), N)
    const r = cmp(f, n)
    expect(r).toMatchObject({ onlyA: 9, onlyB: 0, valueDiffs: 103 })
    expect(r.max).toBeCloseTo(0.83298, 4)
  })

  it('reproduces the audit shape with recurring holes: `sqrt(close - 600)` (252 holes, last at bar 291)', () => {
    const src = formula('sqrt(close - 600)')
    expect(src.filter((x) => !fin(x)).length).toBe(252)
    const ema = cmp(formula('ema(sqrt(close - 600), 10)'), pointsToNumbers(emaOfSeries(src, 10, N), N))
    expect(ema).toMatchObject({ onlyA: 33, onlyB: 0, valueDiffs: 105 })
    expect(ema.max).toBeCloseTo(0.30047, 4)
    const rsi = cmp(formula('rsi(sqrt(close - 600), 14)'), rsiOfSeries(src, 14))
    expect(rsi).toMatchObject({ finA: 294, finB: 326, onlyB: 32, valueDiffs: 294 })
    expect(rsi.max).toBeCloseTo(16.021, 2)
  })

  it('EXACT (blast-radius exclusion): a LEFT-EDGE-only hole — the warm-up of a composed input — is identical in every lane', () => {
    const inner = formula('sma(close, 20)')
    expect(cmp(formula('rsi(sma(close, 20), 14)'), rsiOfSeries(inner, 14))).toMatchObject({ onlyA: 0, onlyB: 0, valueDiffs: 0 })
    expect(cmp(formula('ema(sma(close, 20), 10)'), pointsToNumbers(emaOfSeries(inner, 10, N), N))).toMatchObject({ onlyA: 0, onlyB: 0, valueDiffs: 0 })
  })
})
