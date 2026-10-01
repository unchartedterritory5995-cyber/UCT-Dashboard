// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c42OneExecution.test.js
//
// ─── C42 — CODE THAT DOES NOT RUN ON EVERY BAR, AGAINST TRADINGVIEW ──────────
//
// Pine keeps one history per CALL SITE for what a function owns — its locals,
// its parameters, the state inside a `ta.*` it calls — advanced only on the bars
// the call runs. C34 refused every read of that history from a conditional call
// and C31 refused a `ta.*` local in a block that does not run on every bar; both
// named the capture that would settle the rule. It was taken:
//
// ⭐ THE WITNESS — `vw-fn-series-history-rddt-1d-2026-09-30` (NYSE:RDDT 1D, 634
// bars from the listing; probe `tools/visual_conformance/probes/
// vw-fn-series-history.pine`). Two helpers are called ONLY under
// `if barstate.islast` — one execution each — and print what they read:
//
//   S01 S03–S06  volume / time / hl2 / hlc3 / ohlc4 `[k]`, k = 5, 40, 200
//                → the CHART's value k bars back (15 / 15), S07 `close[k]` control
//   S02          `bar_index[k]`                    → NaN at all three offsets
//   C01          a body local `x[1]`               → NaN  (every bar: 290.72)
//   C02          a parameter `src[1]`              → NaN  (every bar: 145.36)
//   C03          `ta.sma(close, 3)`                → NaN  (every bar: 143.6267)
//   C04          `ta.highest(high, 10)`            → 151.8899, the last bar's OWN
//                high: a window of the one run     (every bar: 161.67)
//
// and `ema-ribbon-trend-filter-strixedge-rddt-1d-2026-09-28` shows C04 again in a
// BLOCK: `maxSpread = ta.highest(spread, 50)` under `if showTable and
// barstate.islast` draws ten full glyphs.
//
// ⭐ WHAT IS PINNED:
//   1. the capture says what the list above says (read off its own bars / plots);
//   2. OUR object lane, given the probe's own source and the capture's bars,
//      draws the same 25 labels — text for text, price for price;
//   3. ema-ribbon's strength bar is TradingView's `██████████`;
//   4. the one-execution rule holds in a block too (a local, a reassignment, a
//      value inside an argument, an `if` condition), each beside the every-bar
//      number it must NOT be;
//   5. ⛔ REFUSED BY NAME: every `ta.*` the capture does not show, every guard
//      that is not provably `barstate.islast`, a loop, a non-literal offset or
//      length, `time_close[k]` / `hlcc4[k]`, `bar_index[k]` under any other guard;
//   6. the runtime lane never answers a value that reads such a call (it runs the
//      script as written, the `ta.*` over every bar).
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { toRenderState } from '../../objectRenderState'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const PROBE = 'vw-fn-series-history-rddt-1d-2026-09-30.json'
const EMA = 'ema-ribbon-trend-filter-strixedge-rddt-1d-2026-09-28.json'

afterEach(() => { vi.unstubAllEnvs() })

const capture = (file = PROBE) => loadCapture(path.join(DIR, file)).capture

/** The member door, objects pane on, over the capture's own bars. */
function run(cap, source = cap.source.text) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const bars = toProductBars(cap)
  const d = memberPaneDefinition({ source, id: 'u_c42', name: 'c42' })
  const diag = (d.translation && d.translation.objectDiagnostics) || {}
  if (!d.ok || !d.definition.objects) return { d, diag, bars, labels: [], cells: new Map() }
  const reader = objectReaderFor(d.definition, bars, {
    tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null,
    historyFromListing: true,
  })
  const r = evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
  const state = toRenderState(r.live, { bars, tf: 'D' })
  const cells = new Map(state.tables.flatMap((t) => t.cells.map((c) => [`${t.position}|${c.col}|${c.row}`, c.text])))
  return { d, diag, bars, labels: state.labels, cells }
}

const rowsOf = (cap) => {
  const ix = Object.fromEntries(cap.bars.fields.map((f, i) => [f, i]))
  return cap.bars.rows.map((r) => ({
    t: r[ix.time], o: r[ix.open], h: r[ix.high], l: r[ix.low], c: r[ix.close], v: r[ix.volume],
  }))
}
/** Pine's default number text: up to ten decimals, trailing zeros trimmed. */
const txt = (n) => String(Number(n.toFixed(10)))
const vendorLabels = (cap) => cap.objects.records.labels.map((l) => `${l.t} @ ${l.y}`)

describe('C42 — the capture: what a call that has run ONCE reads', () => {
  it('⭐ S01, S03–S06 (and the S07 control) are the chart\'s own values k bars back — 18 / 18', () => {
    const cap = capture()
    const bars = rowsOf(cap)
    const last = bars.length - 1
    const want = []
    for (const k of [5, 40, 200]) {
      const b = bars[last - k]
      want.push(`S01 volume|${txt(b.v)}`, `S03 time|${b.t * 1000}`, `S04 hl2|${txt((b.h + b.l) / 2)}`,
        `S05 hlc3|${txt((b.h + b.l + b.c) / 3)}`, `S06 ohlc4|${txt((b.o + b.h + b.l + b.c) / 4)}`,
        `S07 close CONTROL|${txt(b.c)}`)
    }
    const texts = cap.objects.texts.labels
    for (const w of want) expect(texts, w).toContain(w)
    expect(want).toHaveLength(18)
  })

  it('⛔ S02: `bar_index[k]` is NaN at all three offsets — NOT the chart\'s 628 / 593 / 433', () => {
    const cap = capture()
    const texts = cap.objects.texts.labels.filter((t) => t.startsWith('S02 '))
    expect(texts).toEqual(['S02 bar_index|NaN', 'S02 bar_index|NaN', 'S02 bar_index|NaN'])
    expect([5, 40, 200].map((k) => cap.bars.rows.length - 1 - k)).toEqual([628, 593, 433])
  })

  it('⭐ C01–C04: a local, a parameter and `ta.sma` are NaN; `ta.highest` is the last bar\'s own high — none is the every-bar value', () => {
    const cap = capture()
    const bars = rowsOf(cap)
    const texts = cap.objects.texts.labels
    expect(texts).toContain('C01 local x[1]|NaN')
    expect(texts).toContain('C02 param src[1]|NaN')
    expect(texts).toContain('C03 ta.sma(close,3)|NaN')
    expect(texts).toContain(`C04 ta.highest(high,10)|${txt(bars[bars.length - 1].h)}`)
    // the same four expressions run on EVERY bar are plotted beside them
    const every = cap.plotValues.rows[cap.plotValues.rows.length - 1].slice(1)
    expect(every[0]).toBeCloseTo(290.72, 6)
    expect(every[1]).toBeCloseTo(145.36, 6)
    expect(every[2]).toBeCloseTo(143.6266667, 6)
    expect(every[3]).toBeCloseTo(161.67, 6)
    expect(every[3]).not.toBeCloseTo(bars[bars.length - 1].h, 2)
  })
})

describe('C42 — our object lane, on the probe\'s own source and the capture\'s bars', () => {
  it('⭐⭐ draws TradingView\'s 25 labels, text for text and price for price', () => {
    const cap = capture()
    const { d, diag, labels } = run(cap)
    expect(d.ok, d.reason || '').toBe(true)
    expect(diag.dropReasons || {}).toEqual({})
    expect(labels).toHaveLength(25)
    expect(labels.map((l) => `${l.text} @ ${l.y}`).sort()).toEqual(vendorLabels(cap).sort())
  })

  it('⛔ `bar_index[k]` in that call is `na` — and the chart\'s value is never drawn', () => {
    const cap = capture()
    const { labels } = run(cap)
    const s02 = labels.filter((l) => l.text.startsWith('S02 ')).map((l) => l.text)
    expect(s02).toEqual(['S02 bar_index|NaN', 'S02 bar_index|NaN', 'S02 bar_index|NaN'])
    for (const l of labels) for (const chart of ['|628', '|593', '|433']) expect(l.text.endsWith(chart), l.text).toBe(false)
  })

  it('🔴 CONTROL: the same helpers called on EVERY bar read the every-bar values (so rail 2 is not "always NaN")', () => {
    const cap = capture()
    const src = [
      '//@version=5',
      'indicator("c42 every bar", overlay = true, max_labels_count = 500)',
      'f_call(float src) =>',
      '    x = close * 2',
      '    if barstate.islast',
      '        label.new(bar_index, high, "C01|" + str.tostring(x[1]))',
      '        label.new(bar_index, high, "C02|" + str.tostring(src[1]))',
      'f_call(close)',
      'float top = ta.highest(high, 10)',
      'if barstate.islast',
      '    label.new(bar_index, high, "TOP|" + str.tostring(top))',
    ].join('\n')
    const { labels } = run(cap, src)
    const texts = labels.map((l) => l.text)
    expect(texts).toContain('C01|290.72')
    expect(texts).toContain('C02|145.36')
    expect(texts).toContain('TOP|161.67')
  })
})

describe('C42 — ema-ribbon: the strength bar is TradingView\'s', () => {
  it('⭐ cell (2,3) reads `maxSpread = ta.highest(spread, 50)` as its one run does: ten full glyphs', () => {
    const cap = capture(EMA)
    const { cells } = run(cap)
    const pos = new Map(cap.objects.records.tables.map((t) => [t.id, t.pos]))
    const vendor = new Map(cap.objects.records.tableCells.map((c) => [`${pos.get(c.tid)}|${c.col}|${c.row}`, c.t]))
    expect(vendor.get('top_right|2|3')).toBe('██████████')
    expect(cells.get('top_right|2|3')).toBe('██████████')
    // …and nothing is drawn that the vendor lacks or holds differently
    for (const [key, text] of cells) expect(text, key).toBe(vendor.get(key))
  })
})

describe('C42 — a `ta.*` call in a BLOCK that runs once', () => {
  const block = (...body) => [
    '//@version=6',
    'indicator("c42 block", overlay=true)',
    'var table d = table.new(position.top_right, 6, 1)',
    'float top = ta.highest(high, 10)',
    'if barstate.islast',
    ...body.map((l) => `    ${l}`),
  ].join('\n')

  it('⭐ a local, a reassignment, a value inside an argument and an `if` condition all read the one run', () => {
    const cap = capture()
    const bars = rowsOf(cap)
    const own = txt(bars[bars.length - 1].h)
    const { cells, labels } = run(cap, block(
      'float a = ta.highest(high, 10)',
      'float m = 0.0',
      'm := ta.highest(high, 10)',
      'float q = ta.sma(close, 3)',
      'string s = str.tostring(ta.highest(high, 10))',
      'table.cell(d, 0, 0, str.tostring(a))',
      'table.cell(d, 1, 0, str.tostring(m))',
      'table.cell(d, 2, 0, str.tostring(q))',
      'table.cell(d, 3, 0, s)',
      'table.cell(d, 4, 0, str.tostring(ta.highest(high, 10)))',
      'table.cell(d, 5, 0, str.tostring(top))',
      'if ta.highest(high, 10) > 160',
      '    label.new(bar_index, high, "every-bar maximum")',
      'else',
      '    label.new(bar_index, high, "own high")',
    ))
    expect(own).toBe('151.8899')
    expect(cells.get('top_right|0|0')).toBe(own)
    expect(cells.get('top_right|1|0')).toBe(own)
    expect(cells.get('top_right|2|0')).toBe('NaN')
    expect(cells.get('top_right|3|0')).toBe(own)
    expect(cells.get('top_right|4|0')).toBe(own)
    // 🔴 CONTROL — the same call at the TOP LEVEL runs on every bar: its ten-bar maximum
    expect(cells.get('top_right|5|0')).toBe('161.67')
    expect(labels.map((l) => l.text)).toEqual(['own high'])
  })

  it('⛔ a `ta.*` the capture does not show is refused by name, in every position — never the every-bar number', () => {
    const cap = capture()
    const { cells, diag } = run(cap, [
      '//@version=6',
      'indicator("c42 refused", overlay=true)',
      'var table d = table.new(position.top_right, 6, 1)',
      'int len = input.int(10, "len")',
      'if barstate.islast',
      '    float a = ta.lowest(low, 10)',
      '    float b = ta.sma(close, len)',
      '    float c = ta.ema(close, 3)',
      '    float e = ta.highest(10)',
      '    table.cell(d, 0, 0, str.tostring(a))',
      '    table.cell(d, 1, 0, str.tostring(b))',
      '    table.cell(d, 2, 0, str.tostring(c))',
      '    table.cell(d, 3, 0, str.tostring(e))',
      '    table.cell(d, 4, 0, str.tostring(ta.rsi(close, 14)))',
      '    table.cell(d, 5, 0, "ctl")',
    ].join('\n'))
    for (const col of [0, 1, 2, 3, 4]) expect(cells.has(`top_right|${col}|0`), `col ${col}`).toBe(false)
    expect(cells.get('top_right|5|0')).toBe('ctl')
    expect(diag.dropReasons['cell:text']).toBe(5)
  })

  it('⛔ a guard that is not provably `barstate.islast` keeps C31\'s refusal', () => {
    const cap = capture()
    for (const guard of ['close > open', 'not barstate.islast', 'barstate.islast or close > open', '(barstate.islast)']) {
      const { labels } = run(cap, [
        '//@version=6',
        'indicator("c42 guard", overlay=true, max_labels_count = 500)',
        `if ${guard}`,
        '    float v = ta.highest(high, 10)',
        '    label.new(bar_index, high, str.tostring(v))',
        'if barstate.islast',
        '    label.new(bar_index, low, "ctl")',
      ].join('\n'))
      expect(labels.map((l) => l.text), guard).toEqual(['ctl'])
    }
  })

  it('⛔ the runtime lane never answers a value that reads such a call', () => {
    const cap = capture()
    const bars = rowsOf(cap)
    const sum = bars.slice(-3).reduce((s, b) => s + b.c, 0)
    const { cells } = run(cap, block(
      'float a = ta.highest(high, 10)',
      'float acc = 0.0',
      'for i = 0 to 2',
      '    acc += close[i]',
      'table.cell(d, 0, 0, str.tostring(acc))',
      'table.cell(d, 1, 0, str.tostring(acc + a))',
      'table.cell(d, 2, 0, str.tostring(acc + ta.highest(high, 10)))',
      'table.cell(d, 3, 0, str.tostring(a))',
    ))
    // 🔴 CONTROL — the loop's total IS read from the runtime lane (C18), so the
    // two cells beside it are withheld for the call, not for the loop.
    if (cells.has('top_right|0|0')) expect(Number(cells.get('top_right|0|0'))).toBeCloseTo(sum, 6)
    expect(cells.has('top_right|0|0')).toBe(true)
    expect(cells.has('top_right|1|0')).toBe(false)
    expect(cells.has('top_right|2|0')).toBe(false)
    expect(cells.get('top_right|3|0')).toBe('151.8899')
  })
})

describe('C42 — a HELPER called once: what stays refused, by name', () => {
  const helper = (body, call, guard = 'barstate.islast') => [
    '//@version=5',
    'indicator("c42 helper", overlay = true)',
    ...body,
    `if ${guard}`,
    ...call.map((l) => `    ${l}`),
  ].join('\n')
  const F = [
    'f(int k, float src) =>',
    '    x = close * 2',
    '    label.new(bar_index, low, "A|" + str.tostring(x[k]) + "|" + str.tostring(src[2]) + "|" + str.tostring(bar_index[1]))',
    '    label.new(bar_index, low, "B|" + str.tostring(ta.highest(src, k)) + "|" + str.tostring(ta.sma(src, k)))',
  ]

  it('⭐ under `barstate.islast` (alone, or as an `and` conjunct) the call inlines and reads its one run', () => {
    const cap = capture()
    for (const guard of ['barstate.islast', 'close > 0 and barstate.islast']) {
      const { labels, diag } = run(cap, helper(F, ['f(3, high)'], guard))
      expect(diag.dropReasons || {}, guard).toEqual({})
      expect(labels.map((l) => l.text), guard).toEqual(['A|NaN|NaN|NaN', 'B|151.8899|NaN'])
    }
  })

  it('⛔ any other guard, and a loop, refuse the same call (`fn:conditional-history`) and draw nothing', () => {
    const cap = capture()
    for (const guard of ['close > open', 'not barstate.islast', 'barstate.islast or close > open',
      'barstate.islast and close > open or close < open']) {
      const { labels, diag } = run(cap, helper(F, ['f(3, high)'], guard))
      expect(diag.dropReasons['fn:conditional-history'], guard).toBe(1)
      expect(labels, guard).toHaveLength(0)
    }
    const { labels, diag } = run(cap, helper(F, ['for i = 0 to 1', '    f(3, high)']))
    expect(diag.dropReasons['fn:conditional-history']).toBe(1)
    expect(labels).toHaveLength(0)
  })

  it('⛔ the `else` of a `barstate.islast` chain runs on every OTHER bar — refused, and so is a `ta.*` local there', () => {
    const cap = capture()
    const src = [
      '//@version=5',
      'indicator("c42 else", overlay = true, max_labels_count = 500)',
      ...F,
      'if barstate.islast',
      '    label.new(bar_index, low, "ctl")',
      'else',
      '    f(3, high)',
      '    float v = ta.highest(high, 10)',
      '    if bar_index > 630',
      '        label.new(bar_index, high, "E|" + str.tostring(v))',
    ].join('\n')
    const { labels, diag } = run(cap, src)
    expect(diag.dropReasons['fn:conditional-history']).toBe(1)
    expect(labels.map((l) => l.text)).toEqual(['ctl'])
  })

  it('⛔ `bar_index[k]` under a guard that varies is refused by name — never read as the chart\'s', () => {
    const cap = capture()
    const { labels, diag } = run(cap, helper(
      ['g(int k) =>', '    label.new(bar_index, low, str.tostring(bar_index[k]))'], ['g(5)'], 'close > open'))
    expect(labels).toHaveLength(0)
    expect(diag.refusedCalls).toHaveLength(1)
    expect(diag.refusedCalls[0]).toMatch(/^g:conditional-history@/)
    expect(diag.refusedCalls[0]).toContain('`bar_index[…]`')
    expect(diag.refusedCalls[0]).toContain('vw-fn-series-history')
  })

  it('⛔ what the capture did not ask stays refused, each with its sentence', () => {
    const cap = capture()
    const cases = [
      [['g(int k) =>', '    label.new(bar_index, high, str.tostring(ta.lowest(low, k)))'], ['g(3)'], /`ta\.lowest`/],
      [['g(int k) =>', '    label.new(bar_index, high, str.tostring(ta.ema(close, k)))'], ['g(3)'], /`ta\.ema`/],
      [['g(int k) =>', '    label.new(bar_index, high, str.tostring(ta.highest(k)))'], ['g(3)'], /only `ta\.highest\(source, length\)` is witnessed/],
      [['g(int k) =>', '    label.new(bar_index, high, str.tostring(ta.sma(close, k)))'], ['g(1)'], /whose length is not a whole number above 1/],
      [['g(int k) =>', '    label.new(bar_index, high, str.tostring(time_close[k]))'], ['g(3)'], /`time_close\[…\]`.*vw-call-site-history/],
      [['g(int k) =>', '    label.new(bar_index, high, str.tostring(hlcc4[k]))'], ['g(3)'], /`hlcc4\[…\]`.*vw-call-site-history/],
      [['g(float src) =>', '    y = src + 1', '    label.new(bar_index, high, str.tostring(y[bar_index - 600]))'], ['g(close)'], /`y\[…\]`.*whole number above 0/],
      [['g(int k) =>', '    y = close', '    label.new(bar_index, high, str.tostring(y[k]))'], ['g(0)'], /`y\[…\]`.*whole number above 0/],
    ]
    for (const [body, call, sentence] of cases) {
      const { labels, diag } = run(cap, helper(body, call))
      expect(labels, body[1]).toHaveLength(0)
      expect(diag.refusedCalls, body[1]).toHaveLength(1)
      expect(diag.refusedCalls[0], body[1]).toMatch(/^g:conditional-history@/)
      expect(diag.refusedCalls[0], body[1]).toMatch(sentence)
    }
  })

  it('⛔ a script that binds `bar_index` or `volume` itself reads its OWN series there, and is refused', () => {
    const cap = capture()
    for (const name of ['volume', 'hl2']) {
      const { labels, diag } = run(cap, [
        '//@version=5',
        'indicator("c42 shadow", overlay = true)',
        `${name} = close * 0.9`,
        'g(int k) =>',
        `    label.new(bar_index, high, str.tostring(${name}[k]))`,
        'if close > open',
        '    g(5)',
      ].join('\n'))
      expect(labels, name).toHaveLength(0)
      expect(diag.dropReasons['fn:conditional-history'], name).toBe(1)
    }
  })
})

describe('C42 — the same call, reached another way, is never the every-bar number', () => {
  const script = (...lines) => ['//@version=6', 'indicator("c42 reach", overlay=true, max_labels_count=500)', ...lines].join('\n')

  it('⛔ a value function that reads its OWN history, called from a block that runs once, is refused by name', () => {
    const cap = capture()
    const { labels, diag } = run(cap, script(
      'fv() => ta.highest(high, 10)',
      'fs() => "T" + str.tostring(ta.highest(high, 10))',
      'fp(float src) => src[1]',
      'fok(float src) => src * 2',
      'float top = fv()',
      'if barstate.islast',
      '    label.new(bar_index, low, "F|" + str.tostring(fv()))',
      '    float fl = fv()',
      '    label.new(bar_index, low, "FL|" + str.tostring(fl))',
      '    label.new(bar_index, low, "FS|" + fs())',
      '    label.new(bar_index, low, "FP|" + str.tostring(fp(close)))',
      '    label.new(bar_index, low, "OK|" + str.tostring(fok(close)))',
      '    label.new(bar_index, low, "TOP|" + str.tostring(top))',
    ))
    // 🔴 CONTROLS — a function that reads only the current bar, and the same
    // history function called at the TOP LEVEL (every bar), are both read
    expect(labels.map((l) => l.text).sort()).toEqual(['OK|284.88', 'TOP|161.67'])
    expect(diag.dropReasons['create:label']).toBe(4)
  })

  it('⛔ a `var` written from a `ta.*` call in a block that runs once is refused where a drawing reads it', () => {
    const cap = capture()
    const { labels, diag } = run(cap, script(
      'float eh = 0.0',
      'var float top = na',
      'var float sv2 = na',
      'top := ta.highest(high, 10)',
      'if close > open',
      '    eh := ta.highest(high, 10)',
      'if barstate.islast',
      '    sv2 := ta.highest(high, 10)',
      'if barstate.islast',
      '    var float sv = na',
      '    sv := ta.highest(high, 10)',
      '    label.new(bar_index, low, "E|" + str.tostring(eh))',
      '    label.new(bar_index, low, "SV|" + str.tostring(sv))',
      '    label.new(bar_index, low, "SV2|" + str.tostring(sv2))',
      '    label.new(bar_index, low, "TOP|" + str.tostring(top))',
    ))
    // `eh` — a plain reassignment under a guard that varies (C31's refusal);
    // `sv` — a `var` written in the once block; `sv2` — written in ANOTHER
    // once block and read through the chain's fold.
    // 🔴 CONTROL — the same `var` written on every bar is read
    expect(labels.map((l) => l.text)).toEqual(['TOP|161.67'])
    expect(diag.dropReasons['create:label']).toBe(3)
  })

  it('⭐ a guard built only from inputs runs on every bar: its `ta.*` local is the every-bar value, read', () => {
    // ⚰️ C31's fold asked `barInvariantNames(stmts)` above `let stmts` — a
    // temporal-dead-zone throw its `catch` turned into "every guard varies" —
    // so this label was refused (`create:label`).
    const cap = capture()
    const bars = rowsOf(cap)
    const { labels, diag } = run(cap, script(
      'show = input.bool(true, "show")',
      'if show',
      '    float v = ta.highest(high, 10)',
      '    if bar_index > 628',
      '        label.new(bar_index, high, str.tostring(v))',
    ))
    expect(diag.dropReasons || {}).toEqual({})
    const want = [629, 630, 631, 632, 633].map((i) => txt(Math.max(...bars.slice(i - 9, i + 1).map((b) => b.h))))
    expect(labels.map((l) => l.text)).toEqual(want)
    expect(want[4]).toBe('161.67')
  })

  it('⭐ the same for a `var` written from `ta.*` under a bare `input(true, …)` guard (welotrades\' EQH / EQL shape)', () => {
    const cap = capture()
    const { labels, diag } = run(cap, script(
      'show = input(true, "show")',
      'var float top = na',
      'if show',
      '    top := ta.highest(high, 10)',
      'if barstate.islast',
      '    label.new(bar_index, high, "TOP|" + str.tostring(top))',
    ))
    expect(diag.dropReasons || {}).toEqual({})
    expect(labels.map((l) => l.text)).toEqual(['TOP|161.67'])
  })
})
