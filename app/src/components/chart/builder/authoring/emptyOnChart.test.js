// WHAT A BUILT LINE DOES NOT SHOW ON THIS CHART (`emptyOnChart.js`): read from what the chart drew, stated, never refused.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { emptyOnThisChart, emptyOnChartWords, watchEmptyOnChart, dayWords, EMPTY_ON_CHART, EMPTY_READ_DELAYS_MS } from './emptyOnChart'
import { whyEmpty, EMPTY } from '../inspect/barInspection'
import { newAuthoringState, applyTurn } from './index'
import { previewDefinitionOf } from './authoringSession'
import { STUDIO_PREVIEW_DEF_ID } from '../studio/chartPreview'
import { parseFormula } from '../../engine/ast/parse'

const C = 'uct.authoring.patch/1'
const P = (s) => parseFormula(s).ast
const S = (name) => ({ type: 'series', name })
const NUM = (value) => ({ type: 'num', value })
const OP = (name, ...args) => ({ type: 'op', name, args })
const CALL = (name, ...args) => ({ type: 'call', name, args })

/** `n` weekdays ending 2026-11-20, as the chart's own point times for a daily chart. */
function days(n) {
  const out = []
  const d = new Date(Date.UTC(2026, 10, 20))
  while (out.length < n) { if (d.getUTCDay() % 6 !== 0) out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1) }
  return out.reverse()
}
/** The chart's points for a column: a value, or whitespace (a time alone) where the column has none. */
const pointsOf = (times, valueAt) => times.map((time, i) => { const v = valueAt(i, time); return Number.isFinite(v) ? { time, value: v } : { time } })
const lastOf = (points) => { const p = points[points.length - 1]; return p && Number.isFinite(p.value) ? p.value : undefined }
const drawn = (plotKey, points, more = {}) => ({ instanceId: 'i1', defId: STUDIO_PREVIEW_DEF_ID, plotKey, lastValue: lastOf(points),
  series: { data: () => points.slice() }, runSeries: [], ...more })

function definitionOf(outputs) {
  const out = applyTurn(newAuthoringState(), { contract: C, baseRevision: 0, ops: [{ op: 'create', name: 'x', outputs }], assumptions: [] })
  expect(out.result.status).toBe('applied')
  return previewDefinitionOf(out.state)
}
const LINE = definitionOf([{ key: 'v', tree: P('sma(close, 50)') }])
// a running value that needs 960 bars before it has one: the month's volume, restarting each month
const DEEP = definitionOf([{ key: 'v', tree: CALL('accum', NUM(0), OP('?:', S('monthfirst'), S('volume'), OP('+', S('self'), S('volume'))), NUM(960)) }])

afterEach(() => { vi.useRealTimers() })

describe('emptyOnThisChart: what the drawn preview does not show', () => {
  it('a line with a value on the newest bar gets nothing', () => {
    const t = days(700)
    const got = emptyOnThisChart({ bindings: [drawn('v', pointsOf(t, (i) => (i < 49 ? NaN : 100 + i)))], definition: LINE, barCount: 700 })
    expect(got).toEqual({ drawn: true, items: [] })
  })

  it('BLANK SINCE A DAY: the newest bars have no value, and it says how many and when the last one was', () => {
    const t = days(700)
    const lastIn2025 = t.filter((d) => d < '2026-01-01').length - 1
    const points = pointsOf(t, (i) => (i <= lastIn2025 ? 0 : NaN))                 // the round's shape: 0 before this year, blank in it
    const { items } = emptyOnThisChart({ bindings: [drawn('v', points)], definition: LINE, barCount: 700 })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ key: 'v', code: EMPTY_ON_CHART.NEWEST, blankBars: 700 - 1 - lastIn2025, lastDay: '31 Dec 2025' })
    expect(items[0].blankBars).toBeGreaterThan(200)
    expect(emptyOnChartWords(items[0])).toBe(`On this chart it has no value on the newest ${items[0].blankBars} bars; its last value is on 31 Dec 2025.`)
  })

  it('NO VALUE AT ALL, AND WHY IN NUMBERS: the formula reaches further back than the chart has bars', () => {
    const points = pointsOf(days(700), () => NaN)
    const { items } = emptyOnThisChart({ bindings: [drawn('v', points)], definition: DEEP, barCount: 700 })
    expect(items).toHaveLength(1)
    expect(items[0].code).toBe(EMPTY_ON_CHART.NEVER)
    expect(items[0].reach).toBeGreaterThanOrEqual(960)
    expect(emptyOnChartWords(items[0])).toBe(`On this chart it has no value on any bar. It needs ${items[0].reach.toLocaleString('en-US')} bars of history and this chart has 700.`)
    // with history to spare there is no such reason to give (an event that has not happened on this chart)
    const long = emptyOnThisChart({ bindings: [drawn('v', pointsOf(days(1500), () => NaN))], definition: DEEP, barCount: 1500 }).items[0]
    expect(long.code).toBe(EMPTY_ON_CHART.NEVER)
    expect(long.reach).toBeUndefined()
    expect(emptyOnChartWords(long)).toBe('On this chart it has no value on any bar.')
  })

  it('A RIGHT ANSWER THAT IS BLANK AT THE END gets the true sentence, never a refusal: a pivot, and a single blank bar', () => {
    const t = days(700)
    const pivot = pointsOf(t, (i) => (i % 31 === 7 && i < 670 ? 200 + i : NaN))    // a value on a few bars in a hundred, none on the newest
    const lastPivot = Math.max(...t.map((_, i) => (i % 31 === 7 && i < 670 ? i : -1)))
    const { items } = emptyOnThisChart({ bindings: [drawn('v', pivot)], definition: LINE, barCount: 700 })
    expect(items[0]).toMatchObject({ code: EMPTY_ON_CHART.NEWEST, blankBars: 699 - lastPivot })
    expect(emptyOnChartWords(items[0])).toMatch(/^On this chart it has no value on the newest \d+ bars; its last value is on \d{1,2} [A-Z][a-z]{2} 20\d\d\.$/)
    const one = emptyOnThisChart({ bindings: [drawn('v', pointsOf(t, (i) => (i === 699 ? NaN : 1)))], definition: LINE, barCount: 700 }).items[0]
    expect(one.blankBars).toBe(1)
    expect(emptyOnChartWords(one)).toBe('On this chart it has no value on the newest bar; its last value is on 19 Nov 2026.')
  })

  it('NOT DRAWN (yet): no binding of the preview is "not drawn", never "nothing is empty"', () => {
    expect(emptyOnThisChart({ bindings: [], definition: LINE, barCount: 700 })).toEqual({ drawn: false, items: [] })
    expect(emptyOnThisChart({ bindings: null, definition: LINE, barCount: 700 })).toEqual({ drawn: false, items: [] })
    // another indicator's blank line is not this build's to speak for
    const other = { ...drawn('v', pointsOf(days(50), () => NaN)), defId: 'u_some_saved_one' }
    expect(emptyOnThisChart({ bindings: [other], definition: LINE, barCount: 50 })).toEqual({ drawn: false, items: [] })
    // and a binding with no series is not a drawn line
    expect(emptyOnThisChart({ bindings: [{ ...drawn('v', []), series: null }], definition: LINE, barCount: 50 }).drawn).toBe(false)
  })

  it('STATED LIMITS: only what the read proves is said', () => {
    const t = days(3000)
    // a long chart draws its recent rows: all 2,000 drawn rows blank is "none of the newest 2,000", not "any bar"
    const windowed = emptyOnThisChart({ bindings: [drawn('v', pointsOf(t.slice(-2000), () => NaN))], definition: LINE, barCount: 3000 }).items[0]
    expect(windowed).toMatchObject({ code: EMPTY_ON_CHART.NONE_DRAWN, rows: 2000 })
    expect(emptyOnChartWords(windowed)).toBe('On this chart it has no value on any of the newest 2,000 bars.')
    // a line the chart splits at its gaps: the newest-bar sentence alone
    const split = emptyOnThisChart({ bindings: [drawn('v', pointsOf(t, (i) => (i < 100 ? 5 : NaN)), { runSeries: [{ data: () => [] }] })], definition: LINE, barCount: 3000 }).items[0]
    expect(split.code).toBe(EMPTY_ON_CHART.NEWEST_BAR)
    expect(emptyOnChartWords(split)).toBe('On this chart it has no value on the newest bar.')
    // the points end on a value although the binding's newest value is blank: they disagree, so only the binding is believed
    const odd = emptyOnThisChart({ bindings: [drawn('v', pointsOf(t, () => 5), { lastValue: undefined })], definition: LINE, barCount: 3000 }).items[0]
    expect(odd.code).toBe(EMPTY_ON_CHART.NEWEST_BAR)
    // a series that cannot be read
    const unread = emptyOnThisChart({ bindings: [{ ...drawn('v', []), lastValue: undefined, series: { data: () => { throw new Error('gone') } } }], definition: LINE, barCount: 3000 }).items[0]
    expect(unread.code).toBe(EMPTY_ON_CHART.NEWEST_BAR)
    // an intraday chart's times are not worded as a day
    const secs = pointsOf(t.slice(0, 400).map((_, i) => 1_760_000_000 + i * 300), (i) => (i < 300 ? 1 : NaN))
    const intraday = emptyOnThisChart({ bindings: [drawn('v', secs)], definition: LINE, barCount: 400 }).items[0]
    expect(intraday).toMatchObject({ code: EMPTY_ON_CHART.NEWEST, blankBars: 100 })
    expect(intraday.lastDay).toBeUndefined()
    expect(emptyOnChartWords(intraday)).toBe('On this chart it has no value on the newest 100 bars.')
  })

  it('a candle payload is read by its close, and each output is spoken for once', () => {
    const t = days(100)
    const candles = t.map((time, i) => (i < 90 ? { time, open: 1, high: 2, low: 0.5, close: 1.5 } : { time }))
    const two = [{ ...drawn('v', candles), lastValue: undefined }, { ...drawn('v', candles), lastValue: undefined }]
    const { items } = emptyOnThisChart({ bindings: two, definition: LINE, barCount: 100 })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ code: EMPTY_ON_CHART.NEWEST, blankBars: 10 })
  })

  it('the output is named only when the indicator has more than one', () => {
    const item = { key: 'v', code: EMPTY_ON_CHART.NEWEST, blankBars: 3, bars: 700 }
    expect(emptyOnChartWords(item)).toBe('On this chart it has no value on the newest 3 bars.')
    expect(emptyOnChartWords(item, { name: 'Year to date' })).toBe('Year to date: on this chart it has no value on the newest 3 bars.')
    expect(emptyOnChartWords(null)).toBe('')
    expect(emptyOnChartWords({ code: 'something-else' })).toBe('')
  })

  it('dayWords: a day, or nothing', () => {
    expect(dayWords('2025-12-31')).toBe('31 Dec 2025')
    expect(dayWords({ year: 2026, month: 1, day: 2 })).toBe('2 Jan 2026')
    for (const not of [1_760_000_000, '2025-13-01', 'yesterday', null, undefined, {}]) expect(dayWords(not)).toBeNull()
  })

  it('⛔ ONE CLASSIFIER: the answer for a column is `barInspection.whyEmpty`\'s, and this file writes no other', () => {
    const t = days(60)
    for (const [valueAt, code] of [[() => NaN, EMPTY.NEVER], [(i) => (i < 40 ? 1 : NaN), EMPTY.GAP]]) {
      const points = pointsOf(t, valueAt)
      expect(whyEmpty(points.map((p) => (Number.isFinite(p.value) ? p.value : NaN)), 59).code).toBe(code)
      const item = emptyOnThisChart({ bindings: [drawn('v', points)], definition: LINE, barCount: 60 }).items[0]
      expect(item.code).toBe(code === EMPTY.NEVER ? EMPTY_ON_CHART.NEVER : EMPTY_ON_CHART.NEWEST)
    }
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/components/chart/builder/authoring/emptyOnChart.js'), 'utf8')
    const code = src.split('\n').map((l) => l.split('//')[0]).join('\n')
    expect(code).toContain("import { whyEmpty, EMPTY } from '../inspect/barInspection'")
    expect(code.split('whyEmpty(').length - 1).toBe(1)                      // called in one place
    // ⛔ and it computes nothing: no engine compute is imported or called
    for (const never of ['computeFor', 'nativeRegistry', 'interpret', 'runHere']) expect(code.includes(never), never).toBe(false)
  })
})

describe('watchEmptyOnChart: a few reads, the first hit, nothing left running', () => {
  const notDrawn = { drawn: false, items: [] }
  const hit = { drawn: true, items: [{ key: 'v', code: EMPTY_ON_CHART.NEWEST_BAR, bars: 10 }] }

  it('the delays are the ruled ones', () => {
    expect([...EMPTY_READ_DELAYS_MS]).toEqual([0, 150, 400, 1000, 2500])
  })

  it('reports ONCE, at the first read that finds the preview drawn, and no later read runs', () => {
    vi.useFakeTimers()
    const answers = [notDrawn, notDrawn, hit, hit, hit]
    const read = vi.fn(() => answers[read.mock.calls.length - 1])
    const onResult = vi.fn()
    watchEmptyOnChart({ read, onResult })
    expect(vi.getTimerCount()).toBe(5)
    vi.advanceTimersByTime(0); expect(read).toHaveBeenCalledTimes(1); expect(onResult).not.toHaveBeenCalled()
    vi.advanceTimersByTime(150); expect(read).toHaveBeenCalledTimes(2); expect(onResult).not.toHaveBeenCalled()
    vi.advanceTimersByTime(250)
    expect(read).toHaveBeenCalledTimes(3)
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith(hit.items)
    expect(vi.getTimerCount()).toBe(0)                                     // the two later reads were cancelled
    vi.advanceTimersByTime(10_000)
    expect(read).toHaveBeenCalledTimes(3)
    expect(onResult).toHaveBeenCalledTimes(1)
  })

  it('a drawn preview with nothing empty is still a hit (it reports an empty list and stops)', () => {
    vi.useFakeTimers()
    const onResult = vi.fn()
    watchEmptyOnChart({ read: () => ({ drawn: true, items: [] }), onResult })
    vi.advanceTimersByTime(0)
    expect(onResult).toHaveBeenCalledWith([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('SILENCE when the chart never draws it: every read runs, nothing is reported, nothing is left', () => {
    vi.useFakeTimers()
    const read = vi.fn(() => notDrawn)
    const onResult = vi.fn()
    watchEmptyOnChart({ read, onResult })
    vi.advanceTimersByTime(60_000)
    expect(read).toHaveBeenCalledTimes(5)
    expect(onResult).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('CANCEL leaves no timer and reports nothing, whenever it is called', () => {
    vi.useFakeTimers()
    const read = vi.fn(() => hit)
    const onResult = vi.fn()
    const cancel = watchEmptyOnChart({ read, onResult })
    cancel()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(60_000)
    expect(read).not.toHaveBeenCalled()
    expect(onResult).not.toHaveBeenCalled()
    // and part-way through
    const read2 = vi.fn(() => notDrawn)
    const cancel2 = watchEmptyOnChart({ read: read2, onResult })
    vi.advanceTimersByTime(200)
    expect(read2).toHaveBeenCalledTimes(2)
    cancel2()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(60_000)
    expect(read2).toHaveBeenCalledTimes(2)
    expect(onResult).not.toHaveBeenCalled()
  })

  it('a read whose timer fires AFTER cancel (already queued when it was cleared) reads nothing and reports nothing', () => {
    // a host whose clear cannot recall a callback that is already on its way: the callbacks are kept and run by hand
    const queued = []
    const read = vi.fn(() => hit)
    const onResult = vi.fn()
    const cancel = watchEmptyOnChart({ read, onResult, setTimer: (fn) => { queued.push(fn); return queued.length }, clearTimer: () => {} })
    expect(queued).toHaveLength(5)
    cancel()
    for (const fn of queued) fn()
    expect(read).not.toHaveBeenCalled()
    expect(onResult).not.toHaveBeenCalled()
    // and after a hit, a later queued read does not report a second time
    const queued2 = []
    const onResult2 = vi.fn()
    watchEmptyOnChart({ read: () => hit, onResult: onResult2, setTimer: (fn) => { queued2.push(fn); return queued2.length }, clearTimer: () => {} })
    for (const fn of queued2) fn()
    expect(onResult2).toHaveBeenCalledTimes(1)
  })

  it('a read that throws is a miss, not a crash', () => {
    vi.useFakeTimers()
    let n = 0
    const onResult = vi.fn()
    watchEmptyOnChart({ read: () => { n += 1; if (n === 1) throw new Error('the chart went away'); return hit }, onResult })
    vi.advanceTimersByTime(150)
    expect(onResult).toHaveBeenCalledTimes(1)
  })
})
