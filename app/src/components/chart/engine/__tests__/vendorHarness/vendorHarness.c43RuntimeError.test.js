// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c43RuntimeError.test.js
//
// ─── C43 — A REACHED `runtime.error` DRAWS NOTHING, ON THE HOST LANE ────────────
//
// Captured on a live TradingView chart 2026-09-30 (AMEX:SPY 1D, 4,800 bars), probe
// `tools/visual_conformance/probes/vw-runtime-error.pine` (Q-E1):
//
//     int stopAt = input.int(0, "Stop at bar", minval = 0)
//     plot(bar_index, "E00…")   plot(close, "E01…")
//     if bar_index % 50 == 0 → label.new(…)
//     if stopAt > 0 and bar_index == stopAt
//         runtime.error("UCTPROBE stop at bar " + str.tostring(stopAt))
//
//   * CONTROL, defaults (`vw-runtime-error-spy-1d-2026-09-30`): the call is never
//     reached — 4,800 plot rows, 50 labels, an ordinary study.
//   * "Stop at bar" = 100 (`tests/fixtures/vendor/runtime/vw-runtime-error-
//     reached-spy-1d-2026-09-30.json`, hand-sealed — the capture tool refuses a
//     failed study): the study holds NOTHING. 0 data rows, 0 labels, 0 lines,
//     `isFailed`, an empty pane; bars 0–99 are not kept although the error is on
//     bar 100. Status title "User-defined error", message
//     "Error on bar {bar_index}: UCTPROBE stop at bar 100".
//
// ⚰️ Until C43 the HOST lane (the live member pane) had no reading of
// `runtime.error`: a script whose validation fires at a member's own settings was
// DRAWN here while TradingView shows an error and an empty pane (C35 flagged it).
//
// ⭐ WHAT IS PINNED: the unreached document computes BYTE-IDENTICALLY to the same
// document with the stamp removed (plots and drawings); the reached one draws
// nothing and says TradingView's own sentence; and wherever the conditions cannot
// be said exactly — this chart does not hold the bars TradingView ran, a setting
// folded at a value since changed, a call this lane cannot place — NOTHING is
// guessed: the indicator is drawn as before and the call is named.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { loadCapture, gradeCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { applyParamEdit } from '../../../builder/paramEdit'
import * as registry from '../../nativeRegistry'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { runtimeErrorStopFor, RUNTIME_ERROR_TITLE } from '../../runtimeErrorStop'

const REPO = path.resolve(process.cwd(), '..')
const CONTROL = path.join(REPO, 'tests/fixtures/vendor/harness/vw-runtime-error-spy-1d-2026-09-30.json')
const REACHED = path.join(REPO, 'tests/fixtures/vendor/runtime/vw-runtime-error-reached-spy-1d-2026-09-30.json')
const EMA_RIBBON = path.join(REPO, 'tests/fixtures/vendor/harness/ema-ribbon-trend-filter-strixedge-rddt-1d-2026-09-28.json')

const control = () => {
  const loaded = loadCapture(CONTROL)
  if (!loaded.capture) throw new Error(`not a capture — ${loaded.reason}`)
  return loaded.capture
}
const reached = () => JSON.parse(fs.readFileSync(REACHED, 'utf8'))
const LF = String.fromCharCode(10)

const SPY = { ticker: 'SPY', exchange: 'AMEX' }
const ctxOf = (over = {}) => ({ tf: 'D', symbol: SPY, newestBarIsForming: false, ...over })

/** The member door, installed (the door a member's paste passes through). */
const DEF_ID = 'u_c43_rte'
const install = (source) => {
  const built = memberPaneDefinition({ source, id: DEF_ID, name: 'c43' })
  expect(built.ok, built.reason).toBe(true)
  const { installed, errors } = registry.installUserDefinitions([built.definition])
  expect(installed.length, errors.join(' | ')).toBe(1)
  return { built, def: installed[0] }
}
const drawingsOf = (def, bars, inputs, ctx) => {
  const reader = objectReaderFor(def, bars, { ...ctx, inputs })
  if (!reader) return null
  return evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  }).live
}

beforeEach(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterEach(() => { registry.uninstallUserDefinition(DEF_ID); vi.unstubAllEnvs() })

describe('C43 — the captures: what TradingView holds, reached and not', () => {
  it('⭐ the control: defaults, nothing fires — 4,800 rows and 50 labels', () => {
    const cap = control()
    expect(cap.plotValues.rows).toHaveLength(4800)
    expect(cap.objects.counts.labels).toBe(50)
    expect(cap.study.status.type).toBe(2)
    expect(cap.study.inputs.find((i) => i.name === 'Stop at bar').value).toBe(0)
  })

  it('⭐ "Stop at bar" = 100: the study holds NOTHING, and says the script\'s own message', () => {
    const r = reached()
    expect(r.schema).toBe('uct.vendor-reading/runtime-error-reached/v1')
    // the same script as the control
    expect(r.source.sha256).toBe(control().source.sha256)
    expect(r.study.inputs).toEqual([{ id: 'in_0', value: 100 }])
    expect([r.study.dataLength, r.study.dataRowsRead]).toEqual([0, 0])
    expect(r.study.graphics).toEqual({ lines: 0, labels: 0, boxes: 0 })
    expect(r.study.isFailed).toBe(true)
    expect(r.memberVisible.paneDrawsAnything).toBe(false)
    const e = r.study.status.errorDescription
    expect(e.title).toBe('User-defined error')
    expect(e.is_user_defined).toBe(true)
    expect(e.error).toBe('Error on bar {bar_index}: UCTPROBE stop at bar 100')
    expect(e.ctx.bar_index).toBe(100)
    // ⛔ the bars BEFORE the error are not kept: the control held all 4,800
    expect(r.control.dataRows).toBe(4800)
  })
})

describe('C43 — the probe through the member door, on the control capture\'s bars', () => {
  it('⭐ unreached at defaults: the call is placed, and the document computes BYTE-IDENTICALLY to one without the stamp', () => {
    const cap = control()
    const bars = toProductBars(cap)
    const { built, def } = install(cap.source.text)
    // the call is placed (one stop, nothing unread), with its setting declared
    const stamp = def.meta.runtimeErrors
    expect(stamp.unread).toEqual([])
    expect(stamp.stops).toHaveLength(1)
    expect(stamp.stops[0].live).toEqual(['stopAt'])
    expect(def.inputs.find((i) => i.key === 'stopAt')).toMatchObject({ type: 'int', label: 'Stop at bar', default: 0, min: 0 })
    // no parameter id was minted for it, and no note or refusal was added
    expect(built.translation.inputParams).toEqual([])
    expect(built.translation.refusals).toEqual([])

    const bare = { ...def, meta: { ...def.meta, runtimeErrors: undefined } }
    for (const ctx of [ctxOf(), ctxOf({ historyFromListing: true })]) {
      const cols = registry.computeFor(def, bars, undefined, ctx)
      const plain = registry.computeFor(bare, bars, undefined, ctx)
      expect(Object.keys(cols)).toEqual(Object.keys(plain))
      for (const k of Object.keys(plain)) expect(cols[k], k).toEqual(plain[k])
      expect(registry.columnErrors(cols)).toEqual({})
      // not reached, EXACTLY (`stopAt > 0` reads no bar and is false), nothing unknown
      expect(registry.runtimeErrorStopOf(cols)).toEqual({ reached: false, unknown: [], unread: [] })
      // the control never carried a stop record at all
      expect(registry.runtimeErrorStopOf(plain)).toBeNull()
      // …and the drawings are the same objects
      expect(drawingsOf(def, bars, undefined, ctx)).toEqual(drawingsOf(bare, bars, undefined, ctx))
    }
    // ⭐ and it is TradingView's: E01 equals the vendor's close on all 4,800 rows
    const v = gradeCapture(cap).verdict
    const e01 = v.plots.find((p) => p.title === 'E01_close_CONTROL')
    expect(e01.verdict, e01.reason).toBe('MATCH')
    expect(e01.stats.steady.compared).toBe(4800)
  }, 120000)

  it('⭐ reached ("Stop at bar" = 100, a series from the listing bar): no column, no drawing, TradingView\'s sentence', () => {
    const cap = control()
    const want = reached().study.status.errorDescription
    const bars = toProductBars(cap)
    const { def } = install(cap.source.text)
    // ⛔ `bar_index` is TradingView's only on a series that starts at the listing
    // bar; the capture's own window starts 3,575 bars after the error, so the
    // statement is supplied here, as the product supplies it from the listing date
    const ctx = ctxOf({ historyFromListing: true })
    const inputs = { stopAt: reached().study.inputs[0].value }
    const cols = registry.computeFor(def, bars, inputs, ctx)
    // NOTHING: no plot column at all (TradingView: 0 data rows)…
    expect(Object.keys(cols)).toEqual([])
    const errs = registry.columnErrors(cols)
    expect(Object.keys(errs).sort()).toEqual(['out2', 'value'])
    for (const e of Object.values(errs)) expect(e.guard).toBe(registry.RUNTIME_ERROR_GUARD)
    // …and no drawing (TradingView: 0 labels) — where the unreached run holds labels
    expect(drawingsOf(def, bars, inputs, ctx)).toBeNull()
    expect(drawingsOf(def, bars, undefined, ctx).length).toBeGreaterThan(40)
    // the member reads TradingView's own title and sentence
    const stop = registry.runtimeErrorStopOf(cols)
    expect(stop.reached).toBe(true)
    expect(stop.bar).toBe(want.ctx.bar_index)
    expect(stop.title).toBe(want.title)
    expect(RUNTIME_ERROR_TITLE).toBe(want.title)
    expect(stop.tradingViewText).toBe(want.error.replace('{bar_index}', String(want.ctx.bar_index)))
    expect(stop.sentence).toContain(stop.tradingViewText)
    expect(errs.value.message).toBe(stop.sentence)
  }, 120000)

  it('⛔ off the listing, `bar_index == 100` is this chart\'s bar and not TradingView\'s: NOT guessed — drawn as before, and named', () => {
    const cap = control()
    const bars = toProductBars(cap)
    const { def } = install(cap.source.text)
    const ctx = ctxOf()
    const cols = registry.computeFor(def, bars, { stopAt: 100 }, ctx)
    const plain = registry.computeFor(def, bars, undefined, ctx)
    expect(Object.keys(cols)).toEqual(['value', 'out2'])
    for (const k of Object.keys(plain)) expect(cols[k], k).toEqual(plain[k])
    const stop = registry.runtimeErrorStopOf(cols)
    expect(stop.reached).toBe(false)
    expect(stop.unknown).toHaveLength(1)
    expect(stop.unknown[0].line).toBe(33)
    expect(stop.unknown[0].why).toMatch(/does not hold the history before them/)
    expect(drawingsOf(def, bars, { stopAt: 100 }, ctx)).toEqual(drawingsOf(def, bars, undefined, ctx))
  }, 120000)

  it('⛔ a bar past the chart\'s end is not reached even from the listing (the series ends before it)', () => {
    const cap = control()
    const bars = toProductBars(cap)
    const { def } = install(cap.source.text)
    const cols = registry.computeFor(def, bars, { stopAt: bars.length + 10 }, ctxOf({ historyFromListing: true }))
    expect(Object.keys(cols)).toEqual(['value', 'out2'])
    expect(registry.runtimeErrorStopOf(cols)).toEqual({ reached: false, unknown: [], unread: [] })
  }, 120000)
})

describe('C43 — the validation idiom: `if barstate.isfirst and <the settings are invalid>`', () => {
  // ema-ribbon-trend-filter-strixedge's own validation, verbatim off its capture.
  const idiom = (fastDefault = null) => {
    const cap = loadCapture(EMA_RIBBON).capture
    const lines = cap.source.text.split(/\r?\n/)
    const pick = (re) => {
      const hit = lines.filter((l) => re.test(l))
      expect(hit.length, String(re)).toBe(1)
      return hit[0]
    }
    let fast = pick(/^int\s+fastLen\s*=/)
    if (fastDefault !== null) fast = fast.replace(/input\.int\(8,/, `input.int(${fastDefault},`)
    const at = lines.findIndex((l) => l.startsWith('if barstate.isfirst and not (fastLen < midLen'))
    expect(lines[at + 1]).toMatch(/^\s+runtime\.error\("Periods must be ascending/)
    return {
      cap,
      source: ['//@version=6', 'indicator("c43 validation")', fast, pick(/^int\s+midLen\s*=/), pick(/^int\s+slowLen\s*=/),
        lines[at], lines[at + 1], 'plot(ta.ema(close, fastLen), "fast")', 'plot(ta.ema(close, midLen), "mid")',
        'plot(ta.ema(close, slowLen), "slow")', ''].join(LF),
    }
  }

  it('⭐ at the captured settings (8 / 21 / 55) it is not reached, exactly — and TradingView drew the script', () => {
    const { cap, source } = idiom()
    const bars = toProductBars(cap)
    const { def } = install(source)
    for (const ctx of [ctxOf(), ctxOf({ historyFromListing: true })]) {
      const cols = registry.computeFor(def, bars, undefined, ctx)
      expect(Object.keys(cols)).toEqual(['value', 'out2', 'out3'])
      expect(registry.runtimeErrorStopOf(cols)).toEqual({ reached: false, unknown: [], unread: [] })
    }
    // the capture itself: the study ran (its dashboard is there)
    expect(cap.objects.counts.tableCells).toBeGreaterThan(0)
  }, 120000)

  it('⭐ with a Fast period above Mid it is reached on the FIRST bar — on any chart, listing or not', () => {
    const { cap, source } = idiom(60)
    const bars = toProductBars(cap)
    const { def } = install(source)
    for (const ctx of [ctxOf(), ctxOf({ historyFromListing: true })]) {
      const cols = registry.computeFor(def, bars, undefined, ctx)
      expect(Object.keys(cols)).toEqual([])
      const stop = registry.runtimeErrorStopOf(cols)
      expect(stop.reached).toBe(true)
      expect([stop.bar, stop.barKnown]).toEqual([0, true])
      expect(stop.tradingViewText).toBe('Error on bar 0: Periods must be ascending: Fast < Mid < Slow')
    }
  }, 120000)

  it('⛔ a setting folded into the conditions and since CHANGED on the document is not guessed: named, drawn as before', () => {
    const { cap, source } = idiom()
    const bars = toProductBars(cap)
    const { def } = install(source)
    // the lengths are window lengths: folded, and editable only as parameters
    const stamp = def.meta.runtimeErrors.stops[0]
    expect(stamp.live).toEqual([])
    expect(stamp.folded).toEqual([{ name: 'fastLen', value: 8 }, { name: 'midLen', value: 21 }, { name: 'slowLen', value: 55 }])
    const pid = Object.keys(def.compute.paramManifest).find((k) => def.compute.paramManifest[k].sourceName === 'fastLen')
    expect(pid, 'fastLen is an adjustable parameter').toBeTruthy()
    const edited = applyParamEdit(def, pid, 60)
    expect(edited.ok, edited.error).toBe(true)
    const stop = runtimeErrorStopFor(edited.definition, bars, undefined, ctxOf())
    expect(stop.reached).toBe(false)
    expect(stop.unknown).toHaveLength(1)
    expect(stop.unknown[0].why).toMatch(/`fastLen` at 8, and the document now holds 60/)
    // ⛔ CONTROL: unedited, the same question is answered (not reached, nothing unknown)
    expect(runtimeErrorStopFor(def, bars, undefined, ctxOf())).toEqual({ reached: false, unknown: [], unread: [] })
  }, 120000)
})

describe('C43 — anchored on the newest bar, and the calls this lane cannot place', () => {
  const N = 120
  const BARS = Array.from({ length: N }, (_, i) => {
    const d = new Date(Date.UTC(2023, 0, 2) + i * 86400000).toISOString().slice(0, 10)
    const c = 100 + 6 * Math.sin(i / 7)
    return { t: d, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + i }
  })
  const script = (lines) => ['//@version=6', 'indicator("c43")', ...lines, 'plot(close, "c")', ''].join(LF)

  it('⭐ `if not timeframe.isintraday and barstate.islast` — reached on a daily chart (the newest bar), not on an intraday one', () => {
    // session-highs-and-lows-indicator-smc-sessions-dst-safe's own guard
    const { def } = install(script([
      'if not timeframe.isintraday and barstate.islast',
      '    runtime.error("This indicator requires an intraday timeframe (< 1D).")',
    ]))
    const daily = registry.computeFor(def, BARS, undefined, ctxOf())
    expect(Object.keys(daily)).toEqual([])
    const stop = registry.runtimeErrorStopOf(daily)
    expect([stop.reached, stop.bar, stop.barKnown]).toEqual([true, N - 1, false])
    // the bar number is not TradingView's off the listing, so it is not said
    expect(stop.tradingViewText).toBeNull()
    expect(stop.sentence).toContain('This indicator requires an intraday timeframe (< 1D).')
    expect(stop.sentence).not.toMatch(/Error on bar/)
    const intraday = registry.computeFor(def, BARS, undefined, ctxOf({ tf: '60' }))
    expect(registry.runtimeErrorStopOf(intraday)).toEqual({ reached: false, unknown: [], unread: [] })
    expect(Object.keys(intraday)).toEqual(['value'])
  })

  it('⭐ an `else` arm runs under the negation of the arm above it', () => {
    const { def } = install(script([
      'lim = input.float(50.0, "Limit")',
      'if close > lim',
      '    x = 1',
      'else if barstate.islast',
      '    runtime.error("below the limit on the last bar")',
    ]))
    // close is ~100 > 50 on every bar: the first arm runs, the error never does
    expect(registry.runtimeErrorStopOf(registry.computeFor(def, BARS, undefined, ctxOf())).reached).toBe(false)
    // raise the limit above every close: the `else` arm is reached on the newest bar
    const high = registry.computeFor(def, BARS, { lim: 500 }, ctxOf())
    expect(Object.keys(high)).toEqual([])
    expect(registry.runtimeErrorStopOf(high).message).toBe('below the limit on the last bar')
  })

  it('⛔ a call inside a function body, a `switch` arm, a loop, or under a block-set name is UNREAD: named, and the script is drawn', () => {
    const { def } = install(script([
      'f(x) =>',
      '    if x < 0',
      '        runtime.error("negative")',
      '    x',
      'k = switch',
      '    close > open => 1',
      '    => runtime.error("no arm")',
      'for i = 0 to 1',
      '    if close < 0',
      '        runtime.error("in a loop")',
      'if close > 0',
      '    y = close * 2',
      '    if y < 0',
      '        runtime.error("reads a block local")',
    ]))
    const stamp = def.meta.runtimeErrors
    expect(stamp.stops).toEqual([])
    expect(stamp.unread.map((u) => u.why)).toEqual([
      expect.stringMatching(/inside a function body/),
      expect.stringMatching(/an arm of a `switch`/),
      expect.stringMatching(/inside a `for` loop/),
      expect.stringMatching(/reads a name the block above it sets/),
    ])
    const cols = registry.computeFor(def, BARS, undefined, ctxOf())
    expect(Object.keys(cols)).toEqual(['value'])
    // nothing to evaluate: no stop record rides the columns
    expect(registry.runtimeErrorStopOf(cols)).toBeNull()
  })

  it('⛔ a script that writes no `runtime.error` carries no stamp at all', () => {
    const { built, def } = install(script(['x = ta.sma(close, 5)']))
    expect(def.meta.runtimeErrors).toBeUndefined()
    expect(built.translation.runtimeErrors).toBeUndefined()
  })
})

describe('C43 — reading the conditions moves NOTHING else in the translation', () => {
  const N = 90
  const BARS = Array.from({ length: N }, (_, i) => {
    const d = new Date(Date.UTC(2023, 0, 2) + i * 86400000).toISOString().slice(0, 10)
    const c = 100 + 6 * Math.sin(i / 7)
    return { t: d, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + i }
  })
  const script = (lines) => ['//@version=6', 'indicator("c43")', ...lines, ''].join(LF)
  /** the translation with the `runtime.error` block, and the same script without it */
  const pair = (head, guard, tail) => {
    const withIt = memberPaneDefinition({ source: script([...head, ...guard, ...tail]), id: DEF_ID, name: 'a' })
    const without = memberPaneDefinition({ source: script([...head, ...tail]), id: DEF_ID, name: 'a' })
    expect(withIt.ok, withIt.reason).toBe(true)
    expect(without.ok, without.reason).toBe(true)
    return { withIt, without }
  }

  it('⛔ no parameter id is minted for a setting only the validation reads (a name that cannot be a knob stays folded)', () => {
    // `Limit` is upper-case: it can never be a member-input key, so it is folded —
    // and folding it for the validation must not mint it a `__uct_param_N`
    const { withIt, without } = pair(
      ['len = input.int(14, "Length")', 'Limit = input.int(5, "Limit")'],
      ['if barstate.isfirst and Limit > 100', '    runtime.error("limit too high")'],
      ['plot(ta.sma(close, len), "ma")'],
    )
    expect(withIt.translation.inputParams).toEqual(without.translation.inputParams)
    expect(withIt.translation.inputParams.map((p) => p.sourceName)).toEqual(['len'])
    expect(withIt.definition.inputs).toEqual(without.definition.inputs)
    expect(withIt.definition.compute).toEqual(without.definition.compute)
    expect(withIt.definition.plots).toEqual(without.definition.plots)
    expect(withIt.notes).toEqual(without.notes)
    // the setting is recorded as folded at the value the translation saw
    expect(withIt.definition.meta.runtimeErrors.stops[0].folded).toEqual([{ name: 'Limit', value: 5 }])
  })

  it('⛔ a period read by the validation is the validation\'s own: the plots and drawings refuse nothing on another timeframe', () => {
    const { withIt, without } = pair(
      [],
      ['if timeframe.in_seconds() < 3600', '    runtime.error("needs at least an hour")'],
      ['plot(close, "c")'],
    )
    // the translation's own period record is the plots' and the drawings': untouched
    expect(withIt.translation.periodReads).toEqual(without.translation.periodReads)
    expect(withIt.definition.meta.periodReads).toBeUndefined()
    const stop0 = withIt.definition.meta.runtimeErrors.stops[0]
    expect(stop0.period.reads.map((r) => r.name)).toEqual(['timeframe.in_seconds'])
    const { installed } = registry.installUserDefinitions([withIt.definition])
    const def = installed[0]
    // on the period it was translated at: decided (a day is not under an hour)
    const daily = registry.computeFor(def, BARS, undefined, ctxOf())
    expect(Object.keys(daily)).toEqual(['value'])
    expect(registry.runtimeErrorStopOf(daily)).toEqual({ reached: false, unknown: [], unread: [] })
    // on another period the folded value is the wrong chart's: NOT guessed — the
    // plot still draws (it read no period) and the call is named
    const weekly = registry.computeFor(def, BARS, undefined, ctxOf({ tf: 'W' }))
    expect(Object.keys(weekly)).toEqual(['value'])
    const stop = registry.runtimeErrorStopOf(weekly)
    expect(stop.reached).toBe(false)
    expect(stop.unknown[0].why).toMatch(/reads the chart's period, translated at `D`, and this chart is `W`/)
  })

  it('⭐ a setting the validation AND a plot read is one knob: the member\'s value reaches both', () => {
    const built = memberPaneDefinition({
      source: script(['k = input.float(2.0, "K")', 'plot(close * k, "scaled")',
        'if barstate.islast and k > 10', '    runtime.error("K is too large")']),
      id: DEF_ID, name: 'a',
    })
    expect(built.ok, built.reason).toBe(true)
    expect(built.definition.inputs.filter((i) => i.key === 'k')).toHaveLength(1)
    expect(built.definition.meta.runtimeErrors.stops[0].live).toEqual(['k'])
    const { installed } = registry.installUserDefinitions([built.definition])
    expect(registry.runtimeErrorStopOf(registry.computeFor(installed[0], BARS, undefined, ctxOf())).reached).toBe(false)
    const stop = registry.runtimeErrorStopOf(registry.computeFor(installed[0], BARS, { k: 11 }, ctxOf()))
    expect([stop.reached, stop.message]).toEqual([true, 'K is too large'])
  })
})
