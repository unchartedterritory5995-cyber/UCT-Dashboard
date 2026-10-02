// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c48CallSite.test.js
//
// ─── C48 — A CALL SITE'S HISTORY, PAST THE ONE-EXECUTION CASE, AGAINST TRADINGVIEW ──
//
// C42 served code that runs exactly ONCE for the two `ta.*` forms its capture
// showed, and queued a probe for the rest. It was taken on two charts:
//
// ⭐ THE WITNESS — `vw-call-site-history-rddt-1d-2026-10-01` (NYSE:RDDT 1D, 635
// bars from the listing) and `vw-call-site-history-spy-1d-2026-10-01` (AMEX:SPY
// 1D, the newest 1,800 of 8,476 bars); probe
// `tools/visual_conformance/probes/vw-call-site-history.pine`.
//
//   A*  a BLOCK under `if barstate.islast`            (one execution, labels)
//   B*  a HELPER called once from that block          (one execution, labels)
//   C*  a block under `if close > open`               (many executions, plots)
//   H*  a helper called from that block               (many executions, plots)
//   D*  a block under `if bar_index % 2 == 0`         (many executions, plots)
//   E*  the same expressions on every bar             (plots)
//
// ⭐ WHAT IS PINNED:
//   1. the capture says what the header of `objectFnInline.js` (C42 / C48) and
//      `Resolver.blockLocalHistory` say — every row re-derived here from the
//      capture's own bars, on every bar the row has a value;
//   2. ONE execution: OUR object lane, given the probe's own A / B source and
//      the capture's bars, draws TradingView's 24 labels text for text;
//   3. ⚰️ what was WRONG before this lane, each beside the number it printed:
//      a block local's `bx[1]` (284.88 for TradingView's NaN), and the plot lane's
//      every-bar reading of a conditional `ta.*`, of a block local's history and
//      of a helper's own history (163–307 of 634 bars per row);
//   4. MANY executions are never the every-bar number: the object lane refuses
//      them at the read, and a chart's PLOT carries its block's guard so the
//      bind refuses it, by name, on a chart where the block runs after a bar it
//      skipped (`engine/blockRuns.js`) — while a block that runs on every bar
//      (uncharted-volume-v2's `if not skipAll and isDaily`) keeps its plot, and
//      what the capture shows to be the chart's own (`bar_index[1]` in a block,
//      C06) is served and equals it on every bar;
//   5. ⛔ nothing is refused at translation for it, so the parameters such a
//      plot mints are the ones it always minted: a parameter id is an address
//      into a saved document.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { loadCapture } from './harness'
import { toProductBars, runOurSide, enterMemberDoor, HARNESS_DEF_ID } from './ourSide'
import * as registry from '../../nativeRegistry'
import { firstRunAfterSkip, blockRunsRefusal, BLOCK_RUNS_GUARD } from '../../blockRuns'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { toRenderState } from '../../objectRenderState'
import { translatePine } from '../../ast/pine'
import { ONE_EXECUTION_TA, CHART_SERIES_WITNESSED } from '../../ast/objectFnInline'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const RDDT = 'vw-call-site-history-rddt-1d-2026-10-01.json'
const SPY = 'vw-call-site-history-spy-1d-2026-10-01.json'

afterEach(() => { vi.unstubAllEnvs() })

const capture = (file) => loadCapture(path.join(DIR, file)).capture

/** The member door, objects pane on, over the capture's own bars. */
function run(cap, source) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const bars = toProductBars(cap)
  const d = memberPaneDefinition({ source, id: 'u_c48', name: 'c48' })
  const diag = (d.translation && d.translation.objectDiagnostics) || {}
  if (!d.ok || !d.definition.objects) return { d, diag, bars, labels: [] }
  const reader = objectReaderFor(d.definition, bars, {
    tf: 'D', symbol: { ticker: cap.symbol.name, exchange: cap.symbol.exchange },
    newestBarIsForming: cap.newestBarIsForming ?? null,
    historyFromListing: !!(cap.history && cap.history.startsAtBar0 === true),
  })
  const r = evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
  return { d, diag, bars, labels: toRenderState(r.live, { bars, tf: 'D' }).labels }
}

const rowsOf = (cap) => cap.bars.rows.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }))
/** One plot of the capture, aligned to its BARS by time (`undefined` where the
 *  study holds no row for a bar — RDDT's first bar). */
const columnOf = (cap, title) => {
  const i = cap.study.plots.findIndex((p) => p.title === title)
  expect(i, title).toBeGreaterThanOrEqual(0)
  const byTime = new Map(cap.plotValues.rows.map((r) => [r[0], r[1 + i]]))
  return cap.bars.rows.map((b) => (byTime.has(b[0]) ? byTime.get(b[0]) : undefined))
}
const same = (a, b) => (a === null && b === null)
  || (a !== null && b !== null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)))
/** Grade `want(k, bar)` over the bars in `at` against a vendor column; a
 *  `want` of `undefined` is "not derivable from the loaded bars" and skipped. */
function grade(col, at, want) {
  let ok = 0
  let n = 0
  at.forEach((bar, k) => {
    const w = want(k, bar)
    if (w === undefined || col[bar] === undefined) return
    n += 1
    if (same(col[bar], w)) ok += 1
  })
  return { ok, n }
}
/** Pine's default number text: up to ten decimals, trailing zeros trimmed. */
const txt = (n) => String(Number(n.toFixed(10)))

/** The probe's own source, cut to its ONE-execution half: `f_once`, the
 *  every-bar plots and the `if barstate.islast` block — the member door is
 *  strict, and the many-execution rows refuse it (below). */
function onceSource(cap) {
  const s = cap.source.text
  const a = s.indexOf('// ---------------------------------------------------------------- H: helper, many')
  const b = s.indexOf('plot(ta.highest(high, 10), "E01_highest10_every_bar")')
  expect(a).toBeGreaterThan(0)
  expect(b).toBeGreaterThan(a)
  return s.slice(0, a) + s.slice(b)
}

describe.each([[RDDT], [SPY]])('C48 — the capture %s: what TradingView reads', (file) => {
  const cap = capture(file)
  const B = rowsOf(cap)
  const last = B[B.length - 1]
  const listing = !!(cap.history && cap.history.startsAtBar0)
  const exec = B.map((b, i) => (b.c > b.o ? i : -1)).filter((i) => i >= 0)
  const texts = cap.objects.texts.labels
  // the vendor's own bar index of the capture's first bar, read off row C06
  const c06 = columnOf(cap, 'C06_bar_index1_cond')
  const firstIndex = c06[exec[1]] - (exec[1] - 1)
  const even = B.map((b, i) => ((i + firstIndex) % 2 === 0 ? i : -1)).filter((i) => i >= 0)
  const early = listing ? null : undefined   // before the loaded window: unknown off the listing

  it('⭐ ONE execution — A01–A11 / B04–B10: each `ta.*` on its first run', () => {
    for (const row of ['A01 ta.highest(high,10) CONTROL', 'A08 ta.highest(10)', 'B08 ta.highest(10)', 'B10 ta.highest(high,10) CONTROL']) {
      expect(texts, row).toContain(`${row}|${txt(last.h)}`)
    }
    for (const row of ['A02 ta.lowest(low,10)', 'B04 ta.lowest(low,10)']) expect(texts, row).toContain(`${row}|${txt(last.l)}`)
    for (const row of ['A09 ta.sma(close,1)', 'B09 ta.sma(close,1)']) expect(texts, row).toContain(`${row}|${txt(last.c)}`)
    for (const row of ['A03 ta.sma(close,3)', 'A04 ta.ema(close,3)', 'B05 ta.ema(close,3)', 'A05 ta.rsi(close,14)',
      'A06 ta.atr(14)', 'A07 ta.change(close)', 'A10 ta.stdev(close,5)']) expect(texts, row).toContain(`${row}|NaN`)
    expect(texts).toContain(`A11 ta.cum(volume)|${txt(last.v)}`)
    // 🔴 none of them is the every-bar number, which the capture plots beside them
    expect(columnOf(cap, 'E01_highest10_every_bar')[B.length - 1]).toBeGreaterThan(last.h)
    expect(columnOf(cap, 'E02_lowest10_every_bar')[B.length - 1]).toBeLessThan(last.l)
    expect(columnOf(cap, 'E03_sma3_every_bar')[B.length - 1]).toBeGreaterThan(0)
  })

  it('⭐ ONE execution — A12–A14, B01–B03, B06 / B07: whose history each read is', () => {
    const k5 = B[B.length - 1 - 5]
    const lastIndex = firstIndex + B.length - 1
    expect(texts).toContain('A12 block local bx[1]|NaN')
    // `bar_index[5]` is the CHART's in a block, and NaN in a helper — beside `bar_index - 5`
    expect(texts).toContain(`A13 block bar_index[5]|${lastIndex - 5}|bar_index-5|${lastIndex - 5}`)
    expect(texts).toContain(`B01 bar_index[k]|NaN|bar_index-k|${lastIndex - 5}`)
    expect(texts).toContain(`A14 block volume[5]|${txt(k5.v)}`)
    expect(texts).toContain(`B03 hlcc4[k]|${txt((k5.h + k5.l + k5.c + k5.c) / 4)}`)
    expect(texts).toContain(`B06 local x[0]|${txt(last.c * 2)}`)
    expect(texts).toContain(`B07 param src[0]|${txt(last.c)}`)
    // `time_close[5]`: a daily bar's close is the next session's 00:00 UTC — after bar −5's open, before bar −4's
    const tc = Number(texts.find((t) => t.startsWith('B02 time_close[k]|')).split('|')[1])
    expect(tc).toBeGreaterThan(k5.t * 1000)
    expect(tc).toBeLessThanOrEqual(B[B.length - 1 - 4].t * 1000)
  })

  it('⭐ MANY executions — a `ta.sma` / `ta.ema` window counts EXECUTIONS (C03, H03, C04, D02)', () => {
    const mean3 = (k) => (k < 2 ? early : (B[exec[k]].c + B[exec[k - 1]].c + B[exec[k - 2]].c) / 3)
    for (const title of ['C03_sma3_cond', 'H03_sma3_cond']) {
      const g = grade(columnOf(cap, title), exec, mean3)
      expect(g.ok, title).toBe(g.n)
      expect(g.n, title).toBeGreaterThan(300)
    }
    const d02 = grade(columnOf(cap, 'D02_sma3_even'), even, (k, i) => (i < 4 ? early : (B[i].c + B[i - 2].c + B[i - 4].c) / 3))
    expect(d02.ok).toBe(d02.n)
    expect(d02.n).toBeGreaterThan(300)
    // the EMA over executions, seeded with the mean of its first three (derivable from the listing only)
    if (listing) {
      const col = columnOf(cap, 'C04_ema3_cond')
      let e = null
      let ok = 0
      exec.forEach((i, k) => {
        if (k === 2) e = (B[exec[0]].c + B[exec[1]].c + B[exec[2]].c) / 3
        else if (k > 2) e = 0.5 * B[i].c + 0.5 * e
        if (col[i] === undefined || same(col[i], k < 2 ? null : e)) ok += 1
      })
      expect(ok).toBe(exec.length)
    }
  })

  it('⭐ MANY executions — a local\'s and a parameter\'s `[1]` is the previous EXECUTION (C05, H01, H02, D03)', () => {
    const prev = (mult) => (k) => (k < 1 ? early : mult * B[exec[k - 1]].c)
    for (const [title, mult] of [['C05_local_x1_cond', 2], ['H02_local_x1_cond', 2], ['H01_param_src1_cond', 1]]) {
      const g = grade(columnOf(cap, title), exec, prev(mult))
      expect(g.ok, title).toBe(g.n)
      expect(g.n, title).toBeGreaterThan(300)
    }
    const d03 = grade(columnOf(cap, 'D03_local_y1_even'), even, (k, i) => (i < 2 ? early : 2 * B[i - 2].c))
    expect(d03.ok).toBe(d03.n)
  })

  it('⭐ MANY executions — `bar_index[1]` is the chart\'s in a block and the call\'s in a helper; `volume[1]` the chart\'s in both (C06, H05, H06)', () => {
    const c = grade(c06, exec, (k, i) => (i + firstIndex - 1 < 0 ? null : i + firstIndex - 1))
    expect(c.ok).toBe(c.n)
    const h5 = grade(columnOf(cap, 'H05_bar_index1_cond'), exec, (k) => (k < 1 ? early : exec[k - 1] + firstIndex))
    expect(h5.ok).toBe(h5.n)
    const h6 = grade(columnOf(cap, 'H06_volume1_cond'), exec, (k, i) => (i < 1 ? early : B[i - 1].v))
    expect(h6.ok).toBe(h6.n)
    expect(h6.n).toBeGreaterThan(300)
  })

  it('⛔ MANY executions — `ta.highest` / `ta.lowest` fit NEITHER reading (C01, C02, H04)', () => {
    for (const [title, pick, f] of [['C01_highest10_cond', 'h', Math.max], ['C02_lowest10_cond', 'l', Math.min], ['H04_highest10_cond', 'c', Math.max]]) {
      const col = columnOf(cap, title)
      const overExec = grade(col, exec, (k) => (k < 9 ? undefined : f(...exec.slice(k - 9, k + 1).map((i) => B[i][pick]))))
      const overBars = grade(col, exec, (k, i) => (i < 9 ? undefined : f(...B.slice(i - 9, i + 1).map((b) => b[pick]))))
      expect(overExec.ok, title).toBeLessThan(overExec.n * 0.8)
      expect(overBars.ok, title).toBeLessThan(overBars.n * 0.8)
    }
  })

  it('🔴 every many-execution row differs from the every-bar value on a hundred bars or more', () => {
    for (const [c, e] of [['C01_highest10_cond', 'E01_highest10_every_bar'], ['C02_lowest10_cond', 'E02_lowest10_every_bar'],
      ['C03_sma3_cond', 'E03_sma3_every_bar'], ['C04_ema3_cond', 'E04_ema3_every_bar'], ['C05_local_x1_cond', 'E05_local_every_bar']]) {
      const a = columnOf(cap, c)
      const b = columnOf(cap, e)
      const differ = exec.filter((i) => a[i] !== undefined && !same(a[i] ?? null, b[i] ?? null)).length
      expect(differ, c).toBeGreaterThan(100)
    }
  })
})

describe('C48 — ONE execution: our object lane on the probe\'s own source', () => {
  it('⭐⭐ RDDT (from the listing): TradingView\'s 24 labels, text for text and price for price', () => {
    const cap = capture(RDDT)
    const { d, diag, labels } = run(cap, onceSource(cap))
    expect(d.ok, d.reason || '').toBe(true)
    expect(diag.dropReasons || {}).toEqual({})
    expect(labels).toHaveLength(24)
    expect(labels.map((l) => `${l.text} @ ${l.y}`).sort())
      .toEqual(cap.objects.records.labels.map((l) => `${l.t} @ ${l.y}`).sort())
  })

  it('⭐ SPY (a window of a longer chart): the 22 labels that read no bar count are TradingView\'s', () => {
    const cap = capture(SPY)
    const { d, diag, labels } = run(cap, onceSource(cap))
    expect(d.ok, d.reason || '').toBe(true)
    expect(diag.dropReasons || {}).toEqual({})
    // A13 / B01 print `bar_index`, which counts the chart's 8,476 bars on TradingView and
    // only the window's here. ⚰️ They used to be DRAWN with the window's count - a number
    // that is not TradingView's. ⭐ wave 12 (C45): an absolute `bar_index` off the listing is
    // withheld by name, so those two labels are not drawn; the other 22 are TradingView's.
    const counted = (t) => t.startsWith('A13 ') || t.startsWith('B01 ')
    expect(labels).toHaveLength(22)
    expect(labels.map((l) => l.text).filter(counted)).toEqual([])
    expect(labels.map((l) => l.text).sort())
      .toEqual(cap.objects.texts.labels.filter((t) => !counted(t)).sort())
  })

  it('⚰️ A12 — a block local\'s `bx[1]` is NaN, not the previous bar\'s value it used to print', () => {
    const cap = capture(RDDT)
    const B = rowsOf(cap)
    const { labels } = run(cap, [
      '//@version=6', 'indicator("c48 a12", overlay = true)',
      'if barstate.islast',
      '    bx = close * 2',
      '    by = bx[1] + 1',
      '    bz = close * 3',
      '    bz := bz + 1',
      '    label.new(bar_index, low, "direct|" + str.tostring(bx[1]))',
      '    label.new(bar_index, low, "through|" + str.tostring(by))',
      '    label.new(bar_index, low, "rewritten|" + str.tostring(bz[2]))',
      '    label.new(bar_index, low, "itself|" + str.tostring(bx))',
      '    label.new(bar_index, low, "chart|" + str.tostring(close[1] * 2))',
    ].join('\n'))
    const texts = labels.map((l) => l.text).sort()
    expect(texts).toEqual([
      `chart|${txt(B[B.length - 2].c * 2)}`, 'direct|NaN', `itself|${txt(B[B.length - 1].c * 2)}`, 'rewritten|NaN', 'through|NaN',
    ])
    // the number the every-bar reading printed (284.88 on this capture)
    expect(txt(B[B.length - 2].c * 2)).toBe('284.88')
  })

  it('⛔ a block local\'s history under a guard that VARIES is refused by name, and draws nothing', () => {
    const cap = capture(RDDT)
    const { labels, diag } = run(cap, [
      '//@version=6', 'indicator("c48 many", overlay = true, max_labels_count = 500)',
      'if close > open',
      '    cx = close * 2',
      '    label.new(bar_index, high, str.tostring(cx[1]))',
      'if barstate.islast',
      '    label.new(bar_index, low, "ctl")',
    ].join('\n'))
    expect(labels.map((l) => l.text)).toEqual(['ctl'])
    expect(diag.dropReasons['create:label']).toBe(1)
  })

  it('⛔ the rows asked only in a block stay refused inside a helper — and the table says which', () => {
    expect(Object.entries(ONE_EXECUTION_TA).filter(([, s]) => !s.helper).map(([n]) => n).sort())
      .toEqual(['ta.atr', 'ta.change', 'ta.cum', 'ta.rsi', 'ta.stdev'])
    expect(Object.keys(ONE_EXECUTION_TA).sort()).toEqual(['ta.atr', 'ta.change', 'ta.cum', 'ta.ema', 'ta.highest',
      'ta.lowest', 'ta.rsi', 'ta.sma', 'ta.stdev'])
    expect(CHART_SERIES_WITNESSED.has('time_close') && CHART_SERIES_WITNESSED.has('hlcc4')).toBe(true)
    const cap = capture(RDDT)
    const { labels, diag } = run(cap, [
      '//@version=6', 'indicator("c48 helper", overlay = true)',
      'g() =>',
      '    label.new(bar_index, high, str.tostring(ta.atr(14)))',
      'if barstate.islast',
      '    g()',
      '    label.new(bar_index, low, "block|" + str.tostring(ta.atr(14)))',
    ].join('\n'))
    expect(labels.map((l) => l.text)).toEqual(['block|NaN'])
    expect(diag.refusedCalls).toHaveLength(1)
    expect(diag.refusedCalls[0]).toMatch(/witnessed in a block that runs once, not inside a function called once/)
  })
})

describe('C48 — MANY executions: a chart\'s plot is refused where its block skips a bar, and only there', () => {
  /** The member door + the bind, over a capture's own bars. */
  function bind(cap, source) {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const door = enterMemberDoor(source)
    try {
      if (!door.def) return { door, cols: null, errors: {} }
      const bars = toProductBars(cap)
      const cols = registry.computeFor(door.def, bars, undefined, {
        tf: 'D', symbol: { ticker: cap.symbol.name, exchange: cap.symbol.exchange },
        newestBarIsForming: cap.newestBarIsForming ?? null,
        historyFromListing: !!(cap.history && cap.history.startsAtBar0 === true),
      })
      return { door, cols, errors: registry.columnErrors(cols) || {}, bars }
    } finally {
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
    }
  }
  const titlesOf = (door) => (door.built.translation.outputs || []).map((o) => o.title)

  it('⛔⛔ the probe: every C / H row the pane carries that reads a conditional call is refused by name at the bind; C06 and H06 are served', () => {
    const cap = capture(RDDT)
    const { door, cols, errors } = bind(cap, cap.source.text)
    expect(door.def, door.refusal || '').toBeTruthy()
    // nothing is refused at TRANSLATION: the door attaches, labels and all
    expect(door.built.translation.outputs.filter((o) => o.refusal)).toEqual([])
    const stamped = door.built.translation.blockRuns.outputs.map((x) => titlesOf(door)[x.index])
    expect(stamped).toEqual(['C01_highest10_cond', 'C02_lowest10_cond', 'C03_sma3_cond', 'C04_ema3_cond', 'C05_local_x1_cond',
      'H01_param_src1_cond', 'H02_local_x1_cond', 'H03_sma3_cond', 'H04_highest10_cond', 'H05_bar_index1_cond',
      'D01_highest3_even', 'D02_sma3_even', 'D03_local_y1_even'])
    // the pane carries the first twelve plots: ten are refused, C06 and H06 computed
    const keys = door.def.meta.blockRuns.keys.map((k) => k.key)
    expect(keys).toEqual(['value', 'out2', 'out3', 'out4', 'out5', 'out7', 'out8', 'out9', 'out10', 'out11'])
    for (const key of keys) {
      expect(cols[key], key).toBeUndefined()
      expect(errors[key].guard, key).toBe(BLOCK_RUNS_GUARD)
      expect(errors[key].message, key).toMatch(/on this chart the block skips bar \d+ and runs again on bar \d+, so its calls have not run on every bar/)
    }
    expect(errors.value.message).toMatch(/`c_hi` calls `ta\.highest` inside a block that does not run on every bar/)
    expect(errors.out7.message).toMatch(/calls `f_many`, a function that reads its own history/)
    expect(errors.out6).toBeUndefined()
    expect(Array.from(cols.out6).filter(Number.isFinite).length).toBeGreaterThan(300)
    // ⭐ H06 — the sixth part of `f_many`'s tuple is `volume[1]`, the CHART's: it
    // reads none of the call's history, so it is not marked with its neighbours
    // and is TradingView's number on every bar.
    expect(titlesOf(door)[11]).toBe('H06_volume1_cond')
    expect(errors.out12).toBeUndefined()
    const h06 = columnOf(cap, 'H06_volume1_cond')
    const got = Array.from(cols.out12)
    const off = h06.map((v, i) => (v === undefined || same(v ?? null, Number.isFinite(got[i]) ? got[i] : null) ? null : i)).filter((i) => i !== null)
    expect(off).toEqual([])
    expect(h06.filter((v) => v !== undefined && v !== null).length).toBeGreaterThan(300)
    // RDDT's first bar closes up and its second down: bar 1 is the first skip, bar 2 the next run
    const B = rowsOf(cap)
    expect([B[0].c > B[0].o, B[1].c > B[1].o, B[2].c > B[2].o]).toEqual([true, false, true])
    expect(errors.value.message).toContain('skips bar 1 and runs again on bar 2')
  })

  it('⚰️ what those columns held before: the every-bar number, wrong on 163–307 of 634 bars per row', () => {
    const cap = capture(RDDT)
    const B = rowsOf(cap)
    const runs = new Set(B.map((b, i) => (b.c > b.o ? i : -1)).filter((i) => i >= 0))
    const wrong = (cond, every) => {
      const a = columnOf(cap, cond)
      const b = columnOf(cap, every)
      // the old column: the every-bar value on the bars the block runs, `na` elsewhere
      return B.filter((_, i) => a[i] !== undefined && !same(a[i] ?? null, runs.has(i) ? (b[i] ?? null) : null)).length
    }
    expect(wrong('C03_sma3_cond', 'E03_sma3_every_bar')).toBe(242)
    expect(wrong('C04_ema3_cond', 'E04_ema3_every_bar')).toBe(307)
    expect(wrong('C05_local_x1_cond', 'E05_local_every_bar')).toBe(163)
    expect(wrong('C01_highest10_cond', 'E01_highest10_every_bar')).toBe(205)
    expect(wrong('C02_lowest10_cond', 'E02_lowest10_every_bar')).toBe(239)
  })

  it('⭐ `bar_index[1]` in a block is the chart\'s — served, and TradingView\'s on every bar (C06, both charts)', () => {
    for (const file of [RDDT, SPY]) {
      const cap = capture(file)
      const source = ['//@version=6', 'indicator("c48 c06", overlay = true)', 'float c_bi1 = na', 'if close > open',
        '    c_bi1 := bar_index[1]', 'plot(c_bi1, "C06_bar_index1_cond")'].join('\n')
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      const ours = runOurSide({ ...cap, source: { ...cap.source, text: source } })
      expect(ours.ok, ours.refusal || '').toBe(true)
      // ⭐ wave 12 (C45): an ABSOLUTE `bar_index` is TradingView's only where the loaded
      // bars start at the listing. RDDT's capture does; SPY's is a 300-bar window of a
      // longer history, where our count is lower by a number of bars we cannot know - so
      // the plot is withheld BY NAME (`bar-index:window`), never drawn as the window's own
      // count. This test adds the offset itself (`firstIndex`); the product cannot.
      if (file === SPY) {
        expect(ours.plots[0].column).toBeNull()
        expect(ours.notes.some((n) => n.includes('(bar-index:window)'))).toBe(true)
        continue
      }
      const col = ours.plots[0].column
      const vendor = columnOf(cap, 'C06_bar_index1_cond')
      const at = vendor.findIndex((v) => v !== undefined && v !== null)
      const firstIndex = vendor[at] - (at - 1)
      let ok = 0
      let n = 0
      vendor.forEach((v, i) => {
        if (v === undefined) return
        n += 1
        const u = Number.isFinite(col[i]) ? col[i] + firstIndex : null
        if (same(v, u)) ok += 1
      })
      expect(ok, file).toBe(n)
      expect(n, file).toBeGreaterThan(600)
    }
  })

  it('⭐ the every-bar rows are still TradingView\'s on every bar from the listing (E01–E06)', () => {
    const cap = capture(RDDT)
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const ours = runOurSide({ ...cap, source: { ...cap.source, text: onceSource(cap) } })
    expect(ours.ok, ours.refusal || '').toBe(true)
    expect(ours.plots.map((p) => p.title)).toEqual(['E01_highest10_every_bar', 'E02_lowest10_every_bar', 'E03_sma3_every_bar',
      'E04_ema3_every_bar', 'E05_local_every_bar', 'E06_highest3_every_bar'])
    for (const p of ours.plots) {
      const vendor = columnOf(cap, p.title)
      let ok = 0
      let n = 0
      vendor.forEach((v, i) => {
        if (v === undefined) return
        n += 1
        if (same(v, Number.isFinite(p.column[i]) ? p.column[i] : null)) ok += 1
      })
      expect(ok, p.title).toBe(n)
      expect(n, p.title).toBe(634)
    }
  })

  it('⭐⭐ a block that runs on EVERY bar keeps its plot — and one that never runs, and one that stops for good', () => {
    const cap = capture(RDDT)
    const B = rowsOf(cap)
    const script = (guardDecl) => ['//@version=6', 'indicator("c48 gate")', guardDecl, 'float v = na', 'float w = na',
      'if g', '    v := ta.sma(close, 3)', '    x = close * 2', '    w := x[1]', 'plot(v, "v")', 'plot(w, "w")',
      'plot(ta.sma(close, 3), "every")'].join('\n')
    const sma3 = (i) => (B[i].c + B[i - 1].c + B[i - 2].c) / 3
    // always true — uncharted-volume-v2's shape: a guard that is data, and holds on every bar
    const all = bind(cap, script('g = volume >= 0'))
    expect(all.door.def, all.door.refusal || '').toBeTruthy()
    expect(all.door.def.meta.blockRuns.keys.map((k) => k.key)).toEqual(['value', 'out2'])
    expect(all.errors).toEqual({})
    for (const i of [10, 300, 633]) {
      expect(all.cols.value[i], `bar ${i}`).toBeCloseTo(sma3(i), 9)
      expect(all.cols.out2[i], `bar ${i}`).toBeCloseTo(B[i - 1].c * 2, 9)
    }
    // never true: the block never runs, and nothing reads the call
    const none = bind(cap, script('g = close < 0'))
    expect(none.errors).toEqual({})
    expect(Array.from(none.cols.value).some(Number.isFinite)).toBe(false)
    // true, then false for good: every run came before the first skip
    const stops = bind(cap, script('g = bar_index < 100'))
    expect(stops.errors).toEqual({})
    expect(stops.cols.value[50]).toBeCloseTo(sma3(50), 9)
    expect(Number.isFinite(stops.cols.value[200])).toBe(false)
    // 🔴 CONTROL — false, then true: the block's first run comes after bars it skipped
    const starts = bind(cap, script('g = bar_index >= 100'))
    expect(Object.keys(starts.errors).sort()).toEqual(['out2', 'value'])
    expect(starts.errors.value.message).toContain('skips bar 0 and runs again on bar 100')
    expect(starts.cols.value).toBeUndefined()
    // …and the plot that reads no conditional call is untouched by any of it
    expect(starts.cols.out3[300]).toBeCloseTo(sma3(300), 9)
  })

  it('⭐ a script with ONE plot is gated the same way (the single-tree document)', () => {
    const cap = capture(RDDT)
    const B = rowsOf(cap)
    const one = (guardDecl) => ['//@version=6', 'indicator("c48 one")', guardDecl, 'float v = na',
      'if g', '    v := ta.sma(close, 3)', 'plot(v, "v")'].join('\n')
    const starts = bind(cap, one('g = bar_index >= 100'))
    expect(starts.door.def, starts.door.refusal || '').toBeTruthy()
    expect(Object.keys(starts.door.def.compute.trees || { value: 1 })).toEqual(['value'])
    expect(Object.keys(starts.errors)).toEqual(['value'])
    expect(starts.errors.value.guard).toBe(BLOCK_RUNS_GUARD)
    expect(starts.errors.value.message).toContain('skips bar 0 and runs again on bar 100')
    expect(starts.cols.value).toBeUndefined()
    // CONTROL — the same script under a guard that holds on every bar is computed
    const all = bind(cap, one('g = volume >= 0'))
    expect(all.errors).toEqual({})
    expect(all.cols.value[300]).toBeCloseTo((B[300].c + B[299].c + B[298].c) / 3, 9)
  })

  it('⭐⭐ uncharted-volume-v2 keeps every plot: its `if not skipAll and isDaily` block runs on every bar', () => {
    const cap = capture(RDDT)
    const source = fs.readFileSync(path.resolve(process.cwd(), '..', 'tests/fixtures/member/uncharted-volume-v2.pine'), 'utf8')
    const { door, cols, errors } = bind(cap, source)
    expect(door.def, door.refusal || '').toBeTruthy()
    // the gate is THERE (non-vacuity) …
    const stamped = (door.built.translation.blockRuns && door.built.translation.blockRuns.outputs) || []
    expect(stamped.length).toBeGreaterThan(0)
    expect(stamped.flatMap((x) => x.gates.map((g) => g.why)).join(' ')).toMatch(/priorMax(AllTime|1Y)Daily/)
    // … and it passes on a daily chart: nothing is refused for a block run
    expect(Object.values(errors).filter((e) => e.guard === BLOCK_RUNS_GUARD)).toEqual([])
    for (const k of (door.def.meta.blockRuns && door.def.meta.blockRuns.keys) || []) expect(cols[k.key], k.key).toBeDefined()
  })

  it('⭐ a block that runs ONCE is read on its one run by a chart\'s plot too — never the every-bar window', () => {
    const cap = capture(RDDT)
    const B = rowsOf(cap)
    const source = ['//@version=6', 'indicator("c48 once plot", overlay = true)', 'float v = na', 'float w = na',
      'if barstate.islast', '    v := ta.highest(high, 10)', '    bx = close * 2', '    w := bx[1]',
      'plot(v, "once_highest")', 'plot(w, "once_local_hist")'].join('\n')
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const ours = runOurSide({ ...cap, source: { ...cap.source, text: source } })
    expect(ours.ok, ours.refusal || '').toBe(true)
    const [v, w] = ours.plots.map((p) => p.column)
    // A01: the last bar's own high (150.225), where the ten-bar maximum is higher
    expect(v[B.length - 1]).toBe(B[B.length - 1].h)
    expect(Math.max(...B.slice(-10).map((b) => b.h))).toBeGreaterThan(B[B.length - 1].h)
    // A12: `na`
    expect(Number.isFinite(w[B.length - 1])).toBe(false)
  })

  it('⛔ nothing moves at translation: the same parameters, in order — and no note for an unread conditional call', () => {
    const source = ['//@version=6', 'indicator("c48 mint")',
      'len = input.int(3, "Cond length")', 'mult = input.float(2.0, "Mult")', 'other = input.int(5, "Other length")',
      'float v = na', 'float unread = na',
      'if close > open', '    v := ta.sma(close, len)', '    unread := ta.ema(close, len)',
      'plot(v * mult, "cond")', 'plot(ta.sma(close, other), "every bar")'].join('\n')
    const t = translatePine(source, { strict: true, paramManifest: true })
    expect(t.outputs.map((o) => (o.refusal ? o.refusal.guard : 'ok'))).toEqual(['ok', 'ok'])
    expect(t.blockRuns.outputs.map((x) => x.index)).toEqual([0])
    expect(t.blockRuns.outputs[0].gates).toHaveLength(1)
    expect(t.blockRuns.outputs[0].gates[0].why).toMatch(/`v` calls `ta\.sma` inside a block that does not run on every bar/)
    expect(t.inputParams.map((p) => [p.id, p.label || p.title])).toEqual([
      // wave 12 (C46): a script outside the corpus takes SOURCE ids (1000 + its n-th input),
      // so nothing the translator folds can renumber them - the property this pin guards.
      ['__uct_param_1001', 'Cond length'], ['__uct_param_1002', 'Mult'], ['__uct_param_1003', 'Other length']])
    expect((t.notes || []).filter((n) => n.code === 'pine:block')).toEqual([])
    // ⛔ the screener lane binds no chart: no stamp, and the tree it always had
    const screen = translatePine(source, { paramManifest: true })
    expect(screen.mode).toBe('screener')
    expect(screen.blockRuns).toBeUndefined()
    expect(screen.outputs[0].formula).toBe(t.outputs[0].formula)
  })

  it('⭐ a tuple part is gated only when ITS OWN expression reads the call\'s history (H06)', () => {
    const names = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5']
    const source = ['//@version=6', 'indicator("c48 parts")',
      'h() => close[1]',
      'f() =>',
      '    q = close * 2',
      '    s = ta.sma(close, 3)',
      '    [q[1], volume[1] * 2, nz(high[2], 0) - low, ta.ema(close, 3), h(), -s]',
      ...names.map((n) => `float ${n} = na`),
      'if close > open',
      '    [a0, a1, a2, a3, a4, a5] = f()',
      ...names.map((n, k) => `    ${n} := a${k}`),
      ...names.map((n) => `plot(${n}, "${n.toUpperCase()}")`)].join('\n')
    const t = translatePine(source, { strict: true })
    expect(t.outputs.map((o) => (o.refusal ? o.refusal.guard : 'ok'))).toEqual(Array(6).fill('ok'))
    // P1 / P2 read only the chart's own series, at offsets: TradingView's on every run.
    // P0 a body local at an offset, P3 a `ta.*` call, P4 a call to a script function
    // (not followed — fail closed), P5 a local bound to a `ta.*` call: gated.
    // (The tuple opens with `q[1]` on purpose: `scriptBoundNames` takes every name up
    // to a statement's first `]` as bound, so a tuple that OPENS with `volume[1]`
    // would make `volume` the script's own name — and gate it, the safe way.)
    expect(t.blockRuns.outputs.map((x) => t.outputs[x.index].title)).toEqual(['P0', 'P3', 'P4', 'P5'])
  })

  it('⛔ a ONE-RUN binding mints what its every-bar reading minted: the ids after it do not move', () => {
    // `v` on its one run is `na`, a tree that reads no input — but the every-bar
    // reading it replaces read `mult`, and minted it FIRST. The id of every
    // input after it is an address a saved document holds.
    const source = ['//@version=6', 'indicator("c48 mint once")',
      'mult = input.float(2.0, "Mult")', 'other = input.int(5, "Other length")',
      'float v = na',
      'if barstate.islast', '    v := ta.sma(close * mult, 3)',
      'plot(v, "once")', 'plot(ta.sma(close, other), "every bar")'].join('\n')
    const t = translatePine(source, { strict: true, paramManifest: true })
    expect(t.outputs.map((o) => (o.refusal ? o.refusal.guard : 'ok'))).toEqual(['ok', 'ok'])
    expect(t.inputParams.map((p) => [p.id, p.label || p.title])).toEqual([
      // wave 12 (C46): source ids - fixed before the walk, so a one-run binding cannot move them
      ['__uct_param_1001', 'Mult'], ['__uct_param_1002', 'Other length']])
    // the one-run tree itself reads no input
    expect(t.outputs[0].formula).not.toMatch(/__uct_param_1001/)
  })
})

describe('C48 — `blockRuns`: when the every-bar read is the block\'s own history', () => {
  it('⭐ a run after a skip, and only that', () => {
    expect(firstRunAfterSkip([1, 1, 1, 1])).toBeNull()
    expect(firstRunAfterSkip([0, 0, 0])).toBeNull()
    expect(firstRunAfterSkip([1, 1, 0, 0])).toBeNull()
    expect(firstRunAfterSkip([1, 0, 1])).toEqual({ skipped: 1, bar: 2 })
    expect(firstRunAfterSkip([0, 0, 1, 1])).toEqual({ skipped: 0, bar: 2 })
    expect(firstRunAfterSkip([true, false, false, true])).toEqual({ skipped: 1, bar: 3 })
    expect(firstRunAfterSkip([])).toBeNull()
    expect(firstRunAfterSkip(null)).toBeNull()
  })

  it('⛔ a bar where the guard is not computable is neither a run nor a skip', () => {
    expect(firstRunAfterSkip([NaN, NaN, 1, 1])).toBeNull()
    expect(firstRunAfterSkip([1, NaN, 1])).toBeNull()
    expect(firstRunAfterSkip([0, NaN, NaN])).toBeNull()
    expect(firstRunAfterSkip([NaN, 0, NaN, 1])).toEqual({ skipped: 1, bar: 3 })
  })

  it('⛔ a guard that cannot be evaluated refuses the plot; a plot with no gate is never asked', () => {
    const def = { meta: { blockRuns: { keys: [{ key: 'value', gates: [{ why: 'W', guard: { type: 'num', value: 1 } }] }] } } }
    const asked = []
    expect(blockRunsRefusal(def, 'out2', (t) => { asked.push(t); return [1] })).toBeNull()
    expect(asked).toEqual([])
    expect(blockRunsRefusal(def, 'value', () => [1, 1])).toBeNull()
    expect(blockRunsRefusal(def, 'value', () => [1, 0, 1])).toMatch(/^W — on this chart the block skips bar 1 and runs again on bar 2/)
    expect(blockRunsRefusal(def, 'value', () => { throw new Error('too deep') })).toMatch(/^W — and whether the block runs on every bar of this chart could not be computed \(too deep\)/)
    expect(blockRunsRefusal({ meta: {} }, 'value', () => [0, 1])).toBeNull()
    expect(blockRunsRefusal(null, 'value', () => [0, 1])).toBeNull()
  })
})
