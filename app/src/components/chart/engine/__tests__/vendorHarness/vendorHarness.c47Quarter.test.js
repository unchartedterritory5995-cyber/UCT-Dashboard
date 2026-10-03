// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c47Quarter.test.js
//
// ─── C47 — THE QUARTER, `request.security(sym, '3M', …, lookahead_on)` on 1D ──
//
// high-low-open-mid-ranges prints a table of this period's and last period's
// open / high / low / mid for the day, week, month and QUARTER:
//
//     ts(v, w, x, y) =>
//         z = request.security(syminfo.tickerid, v, w, lookahead = barmerge.lookahead_on)
//         table.cell(pan, x, y, str.tostring(z), …)
//     ts('3M', open, 1, 7), … ts('3M', hl2[1], 4, 8)
//
// The `D` / `W` / `M` rows have agreed since C10 (`tf_live`). The quarter rows —
// eight cells — were refused: the engine resampled weeks and months only. Why
// it could not be served was a LIST, not a mechanism: `resampleTo` buckets any
// period it has a key for.
//
// ⭐ BOTH HALVES ARE WITNESSED, and this file holds both:
//   boundaries  `vw-time-tf-spy-1d-2026-09-28` (C30): `T09_newQuarter` is 1 on
//               exactly the bars where this engine's quarter bucket changes;
//   values      `high-low-open-mid-ranges-rddt-1d-2026-09-28`: the eight cells.
// ⛔ AND WHAT IS NOT: the CLOSED quarter (`lookahead_off`), a chart that is not
// daily, and a plot. Each refuses by name below.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture, gradeCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import {
  interpret, maxLookback, tfBucket, isoDay,
  TF_RESAMPLABLE, TF_LADDER, TF_BASE_BARS, TF_LIVE_RESAMPLABLE, TF_LIVE_BASE_BARS, BASE_TF,
} from '../../ast/interpret'
import * as lint from '../../ast/lint'
import { sentenceFor, SentenceRefusal } from '../../ast/sentence'
import { translatePine } from '../../ast/pine'

const HARNESS = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const capture = (name) => {
  const loaded = loadCapture(path.join(HARNESS, name))
  if (!loaded.capture) throw new Error(`not a capture — ${loaded.reason}`)
  return loaded.capture
}
const OHLM = 'high-low-open-mid-ranges-rddt-1d-2026-09-28.json'
const SPY = 'vw-time-tf-spy-1d-2026-09-28.json'

afterEach(() => { vi.unstubAllEnvs() })

const S = (name) => ({ type: 'series', name })
const prev = (n) => ({ type: 'offset', value: 1, args: [n] })
const hl2 = { type: 'op', name: '/', args: [{ type: 'op', name: '+', args: [S('high'), S('low')] }, { type: 'num', value: 2 }] }
const live = (code, child) => ({ type: 'tf_live', value: code, args: [child] })
const last = (col) => Array.from(col)[col.length - 1]

describe('⭐ C47 — the quarter\'s VALUES: high-low-open-mid-ranges\' eight cells', () => {
  const runTable = () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const cap = capture(OHLM)
    const bars = toProductBars(cap)
    const d = memberPaneDefinition({ source: cap.source.text, id: 'u_c47_q', name: 'c47' })
    expect(d.ok, d.reason).toBe(true)
    const reader = objectReaderFor(d.definition, bars, {
      tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null,
      historyFromListing: !!(cap.history && cap.history.startsAtBar0 === true),
    })
    const out = evaluateObjects(reader.program, {
      barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
    })
    return { cap, d, table: out.live.find((o) => o.family === 'table') }
  }

  it('⭐ all 45 cells are TradingView\'s — the eight quarter cells by address and text', () => {
    const { cap, table, d } = runTable()
    const vendor = cap.objects.records.tableCells
    expect(vendor).toHaveLength(45)
    const byAddr = new Map(vendor.map((c) => [`${c.col},${c.row}`, c.t]))
    const ours = (table.cells || []).filter((c) => c.props && c.props.text !== null && c.props.text !== undefined)
    expect(ours).toHaveLength(45)
    for (const c of ours) expect(c.props.text, `cell ${c.col},${c.row}`).toBe(byAddr.get(`${c.col},${c.row}`))
    // the eight, named: row 7 is `Q`, row 8 is `LQ`; columns Open / High / Low / Mid
    const text = (col, row) => ours.find((c) => c.col === col && c.row === row).props.text
    expect([1, 2, 3, 4].map((c) => text(c, 7))).toEqual(['175.01', '208.05', '135.2223', '171.63615'])
    expect([1, 2, 3, 4].map((c) => text(c, 8))).toEqual(['136.375', '187.34', '128.63', '157.985'])
    expect([text(0, 7), text(0, 8)]).toEqual(['Q', 'LQ'])
    // and nothing about the table is dropped
    expect(d.translation.objectDiagnostics.dropReasons).toEqual({})
    // the trees really are the forming quarter
    expect(JSON.stringify(d.definition.objects.trees)).toContain('"type":"tf_live","value":"3M"')
  }, 60000)

  it('the harness: table cells 45 / 45 (was 45 / 37) and their texts agree', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const { verdict, integrity } = gradeCapture(capture(OHLM))
    expect(integrity.ok).toBe(true)
    const counts = Object.fromEntries(verdict.objects.counts.map((c) => [c.family, [c.vendor, c.ours]]))
    expect(counts.tableCells).toEqual([45, 45])
    const cells = verdict.objects.texts.find((t) => t.family === 'tableCells text')
    expect(cells.agree).toBe(true)
  }, 60000)

  it('⭐ the evaluator alone: `tf_live(\'3M\', …)` on the capture\'s daily bars is each cell\'s number', () => {
    const cap = capture(OHLM)
    const bars = toProductBars(cap)
    const cell = new Map(cap.objects.records.tableCells.map((c) => [`${c.col},${c.row}`, Number(c.t)]))
    const opts = { tf: 'D', newestBarIsForming: false }
    const at = (tree) => last(interpret(tree, bars, {}, undefined, undefined, opts))
    const row = (r, wrap) => [S('open'), S('high'), S('low'), hl2].map((n, i) => [at(live('3M', wrap(n))), cell.get(`${i + 1},${r}`)])
    for (const [ours, theirs] of [...row(7, (n) => n), ...row(8, prev)]) {
      expect(Number.isFinite(theirs)).toBe(true)
      expect(Math.abs(ours - theirs)).toBeLessThan(1e-9)
    }
    // the first quarter of the series has no quarter before it
    const first = Array.from(interpret(live('3M', prev(S('open'))), bars, {}, undefined, undefined, opts))
    expect(Number.isNaN(first[0])).toBe(true)
  }, 60000)
})

describe('⭐ C47 — the quarter\'s BOUNDARIES: TradingView\'s `time("3M")` on AMEX:SPY 1D', () => {
  it('the quarter bucket changes on exactly the bars TradingView calls a new quarter (T09)', () => {
    const cap = capture(SPY)
    const bars = toProductBars(cap)
    expect(bars.length).toBe(900)
    const col = cap.plotValues.fields.indexOf(cap.study.plots.find((p) => p.title === 'T09_newQuarter').id)
    expect(col).toBeGreaterThan(0)
    const vendorNew = cap.plotValues.rows.map((r) => r[col])
    const keys = bars.map((b) => tfBucket(isoDay(b.t), '3M'))
    const oursNew = keys.map((k, i) => (i > 0 && k !== keys[i - 1] ? 1 : 0))
    // bar 0 has no previous bar on either side; compare from bar 1
    expect(oursNew.slice(1)).toEqual(vendorNew.slice(1).map((v) => (v ? 1 : 0)))
    // non-vacuity: the capture spans several quarters
    expect(oursNew.reduce((a, b) => a + b, 0)).toBeGreaterThan(10)
    // and a quarter opens in January, April, July or October only
    const opens = bars.filter((_, i) => oursNew[i] === 1).map((b) => Number(isoDay(b.t).slice(5, 7)))
    expect([...new Set(opens)].sort((a, b) => a - b)).toEqual([1, 4, 7, 10])
  })
})

describe('⛔ C47 — the quarter is a FORMING read from daily bars, and nothing wider', () => {
  const bars = () => toProductBars(capture(OHLM))

  it('the lists: `tf` resamples what it did; only `tf_live` gains the quarter', () => {
    expect([...TF_RESAMPLABLE]).toEqual(['W', 'M'])
    expect([...TF_LIVE_RESAMPLABLE]).toEqual(['W', 'M', '3M'])
    expect({ ...TF_BASE_BARS }).toEqual({ W: 5, M: 21 })
    expect({ ...TF_LIVE_BASE_BARS }).toEqual({ W: 5, M: 21, '3M': 63 })
    expect([...TF_LADDER]).toEqual(['1', '5', '15', '30', '60', 'D', 'W', 'M'])
    expect(BASE_TF).toBe('D')
    // the linter's copy is the evaluator's
    expect({ ...lint.TF_LIVE_BASE_BARS }).toEqual({ ...TF_LIVE_BASE_BARS })
    expect({ ...lint.TF_BASE_BARS }).toEqual({ ...TF_BASE_BARS })
  })

  it('⛔ the CLOSED quarter — `tf(…, \'3M\')` — refuses, in the evaluator and in the lookback sum', () => {
    const closed = { type: 'tf', value: '3M', args: [S('close')] }
    expect(() => interpret(closed, bars(), {}, undefined, undefined, { tf: 'D' })).toThrow(/resamples W, M/)
    expect(() => maxLookback(closed)).toThrow(/resamples W, M/)
  })

  it('⛔ a base that is not daily, or is not stated, refuses the quarter — and W / M are untouched by that rule', () => {
    const q = live('3M', S('open'))
    for (const tf of ['60', 'W', 'M']) {
      expect(() => interpret(q, bars(), {}, undefined, undefined, { tf }), tf).toThrow(/DAILY bars only/)
    }
    expect(() => interpret(q, bars(), {})).toThrow(/DAILY bars only/)
    expect(() => interpret(live('W', S('open')), bars(), {})).not.toThrow()
    expect(() => interpret(live('M', S('open')), bars(), {})).not.toThrow()
  })

  it('⛔ a code nothing resamples still refuses for a forming read (`6M`, `12M`, `2M`)', () => {
    for (const code of ['6M', '12M', '2M', 'D']) {
      expect(() => interpret(live(code, S('open')), bars(), {}, undefined, undefined, { tf: 'D' }), code)
        .toThrow(/forming higher-timeframe read resamples W, M, 3M/)
    }
  })

  it('the lookback of a forming quarter is 63 base bars per quarter bar the child reaches back', () => {
    expect(maxLookback(live('3M', S('open')))).toBe(1)             // the forming quarter itself
    expect(maxLookback(live('3M', prev(S('open'))))).toBe(63)      // one quarter back
    expect(maxLookback(live('M', prev(S('open'))))).toBe(21)       // unchanged
  })

  it('the linter reads it as a forming period: forward reach, never `unknown`', () => {
    const r = lint.astReach(live('3M', S('open')))
    expect(r.forward).toBe(62)
    expect(r.back).toBe(0)
    // and the CLOSED quarter is not a timeframe the linter knows
    const closed = lint.astReach({ type: 'tf', value: '3M', args: [S('close')] })
    expect(typeof closed.forward).not.toBe('number')
  })

  const req = (tfArg, extra = '') => ['//@version=5', 'indicator("c47 q", overlay = true)',
    `z = request.security(syminfo.tickerid, ${tfArg}, open${extra})`].join('\n')

  it('the read-back says "so far this quarter" for the forming read, and has no words for the closed one', () => {
    expect(sentenceFor(live('3M', S('open')))).toMatch(/ so far this quarter$/)
    expect(sentenceFor(live('M', S('open')))).toMatch(/ so far this month$/)
    expect(sentenceFor(live('W', S('open')))).toMatch(/ so far this week$/)
    let refusal = null
    try { sentenceFor({ type: 'tf', value: '3M', args: [S('close')] }) } catch (err) { refusal = err }
    expect(refusal).toBeInstanceOf(SentenceRefusal)
    expect(refusal.guard).toBe('sentence:window')
    // a forming code with no noun refuses too — it does not borrow the month's
    let other = null
    try { sentenceFor(live('6M', S('open'))) } catch (err) { other = err }
    expect(other).toBeInstanceOf(SentenceRefusal)
  })

  it('⛔ the translator: `lookahead_off` (or none) at `\'3M\'` stays `pine:request`, in a drawing', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    for (const extra of ['', ', lookahead = barmerge.lookahead_off']) {
      const d = memberPaneDefinition({
        source: [req("'3M'", extra), 'var t = table.new(position.top_left, 1, 1)', 'if barstate.islast',
          '    table.cell(t, 0, 0, str.tostring(z))'].join('\n'),
        id: 'u_c47_q_off', name: 'c47',
      })
      const json = JSON.stringify((d.definition && d.definition.objects) || {})
      expect(json, extra).not.toContain('"value":"3M"')
      expect(d.translation.objectDiagnostics.dropReasons, extra).toEqual({ 'cell:text': 1 })
    }
  })

  it('⭐ …and `lookahead_on` at `\'3M\'` in a drawing is the forming quarter', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const d = memberPaneDefinition({
      source: [req("'3M'", ', lookahead = barmerge.lookahead_on'), 'var t = table.new(position.top_left, 1, 1)',
        'if barstate.islast', '    table.cell(t, 0, 0, str.tostring(z))'].join('\n'),
      id: 'u_c47_q_on', name: 'c47',
    })
    expect(JSON.stringify(d.definition.objects.trees)).toContain('{"type":"tf_live","value":"3M","args":[{"type":"series","name":"open"}]}')
  })

  it('⛔ the translator on a chart that is not daily: the same drawing is not the quarter (control: daily is)', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const source = [req("'3M'", ', lookahead = barmerge.lookahead_on'), 'var t = table.new(position.top_left, 1, 1)',
      'if barstate.islast', '    table.cell(t, 0, 0, str.tostring(z))'].join('\n')
    const objectsAt = (basePeriod) => JSON.stringify(translatePine(source, { strict: true, basePeriod }).objects || {})
    expect(objectsAt('D')).toContain('"type":"tf_live","value":"3M"')
    for (const base of ['60', '15', 'W', 'M']) expect(objectsAt(base), base).not.toContain('"value":"3M"')
  })

  it('⛔ a PLOT of the same request is still refused (`pine:request`) — no parameter is minted for it', () => {
    const t = translatePine([req("'3M'", ', lookahead = barmerge.lookahead_on'), 'plot(z)'].join('\n'),
      { strict: true, basePeriod: 'D' })
    const o = t.outputs.find((x) => x && x.kind !== 'alertcondition')
    expect(o.ast).toBeFalsy()
    expect(o.refusal.guard).toBe('pine:request')
  })

  it('⛔ other multi-month spellings (`\'2M\'`, `\'6M\'`, `\'12M\'`) are not the quarter', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    for (const tf of ["'2M'", "'6M'", "'12M'"]) {
      const d = memberPaneDefinition({
        source: [req(tf, ', lookahead = barmerge.lookahead_on'), 'var t = table.new(position.top_left, 1, 1)',
          'if barstate.islast', '    table.cell(t, 0, 0, str.tostring(z))'].join('\n'),
        id: 'u_c47_q_other', name: 'c47',
      })
      expect(JSON.stringify((d.definition && d.definition.objects) || {}), tf).not.toContain('tf_live')
    }
  })
})
