// ─── ⭐⭐ HTF-NEWEST-NARROW (coordinator ruling 2026-11-19) — THE RUN WITHHOLDS ON ITS NEWEST BAR ONLY WHAT THE REQUEST ───
//     REACHES THERE
//
// A request site that cannot know the chart's newest bar (`requestSupply.js`, `request:htf-newest-unconfirmed`) used to
// blank that bar on EVERY output and every drawing (RS RATING L5), plots that never read it included. Now each site
// carries `newestReach` (`strategyTaint.js::requestNewestReachOf`: the host lane's same-bar taint from its call, a
// scalar's `x[k]` with k >= 1 cut) and the run blanks the union of the withheld sites' reach. Pinned per shape on a
// chart whose newest bar is a finished THURSDAY (the week still forming), with `w = request.security(.., "W", close)`:
// withheld: w, nz(w), na(w) ? w[1] : w, a `var` total of w, y set inside `if w > close`, an array fed w;
// drawn: w[1], close, the total's [1].
// ⛔ The whole-bar rule stays where the taint cannot place what it reaches: a drawing fed w (likewise a `fill`, `hline`, `alert`).
// CONTROL: the Friday chart (the week closed) withholds nothing.
import { describe, it, expect, beforeEach } from 'vitest'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, RUNTIME_REQUEST_WITHHELD_KEY,
  requestNewestHeldOf } from '../runtimeColumns.js'
import { requestNewestReachOf, strategyTaintSinks } from '../../ast/strategyTaint.js'
import { lexPine, blockStatements } from '../../ast/pine.js'

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })

function weekdays(n, from = '2026-01-05') {
  const out = []
  const d = new Date(`${from}T00:00:00Z`)
  while (out.length < n) {
    const w = d.getUTCDay()
    if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
const DAYS = weekdays(30)                                   // Mon 2026-01-05 .. Fri 2026-02-13
const FRIDAY = DAYS.map((t, i) => { const c = 100 + i + (i % 3) * 0.5; return { t, o: c - 0.25, h: c + 1, l: c - 1, c, v: 1000 + i } })
const THURSDAY = FRIDAY.slice(0, -1)
const ctx = { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: { ticker: 'RDDT', exchange: 'NYSE' },
  secondary: new Map(), exchangeOf: () => null }
const doc = (body, outputs) => ({
  id: 'narrow', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:narrow', outputs, source: `//@version=5\nindicator("narrow")\n${body}` },
})
const newestOf = (out, k, rows) => out[k][rows.length - 1]

const SHAPES = `w = request.security(syminfo.tickerid, "W", close)
plot(w)
plot(w[1])
plot(nz(w))
plot(na(w) ? w[1] : w)
plot(close)
var float acc = 0.0
acc += nz(w)
plot(acc)
plot(acc[1])
float y = 0.0
if w > close
    y := 1.0
plot(y)
var float[] a = array.new_float(0)
array.push(a, nz(w))
plot(array.size(a) > 0 ? array.get(a, array.size(a) - 1) : na)
`
const OUT = { w: 0, w1: 1, nzw: 2, naor: 3, close: 4, acc: 5, acc1: 6, y: 7, arr: 8 }
const WITHHELD = ['w', 'nzw', 'naor', 'acc', 'y', 'arr']
const DRAWN = ['w1', 'close', 'acc1']

describe('a finished Thursday: only the outputs the weekly request reaches on that bar are withheld', () => {
  it('each shape, by name', () => {
    const out = computeRuntimeColumns(doc(SHAPES, OUT), THURSDAY, ctx)
    for (const k of WITHHELD) expect(Number.isNaN(newestOf(out, k, THURSDAY)), k).toBe(true)
    for (const k of DRAWN) expect(Number.isFinite(newestOf(out, k, THURSDAY)), k).toBe(true)
    // the bar before is drawn on every output
    for (const k of Object.keys(OUT)) expect(Number.isFinite(out[k][THURSDAY.length - 2]), k).toBe(true)
    const held = out[RUNTIME_REQUEST_WITHHELD_KEY]
    expect(held.codes).toContain('request:htf-newest-unconfirmed')
    expect([...held.keys].sort()).toEqual([...WITHHELD].sort())
  })
  it('w[1] on the newest bar is the value w had on the bar before (settled, read from the history ring)', () => {
    const out = computeRuntimeColumns(doc(SHAPES, OUT), THURSDAY, ctx)
    expect(newestOf(out, 'w1', THURSDAY)).toBe(out.w[THURSDAY.length - 2])
    expect(newestOf(out, 'acc1', THURSDAY)).toBe(out.acc[THURSDAY.length - 2])
  })
  it('CONTROL: on the Friday (the week closed) nothing is withheld', () => {
    const out = computeRuntimeColumns(doc(SHAPES, OUT), FRIDAY, ctx)
    for (const k of Object.keys(OUT)) expect(Number.isFinite(newestOf(out, k, FRIDAY)), k).toBe(true)
    expect(out[RUNTIME_REQUEST_WITHHELD_KEY]).toBeUndefined()
  })
})

describe('⛔ the whole-bar rule stays where the taint cannot place what the request reaches', () => {
  it('a drawing fed by w: every column withheld, keys null', () => {
    const body = 'w = request.security(syminfo.tickerid, "W", close)\nplot(w)\nplot(close)\nlabel.new(bar_index, nz(w), "w")\n'
    const out = computeRuntimeColumns(doc(body, { p1: 0, p2: 1 }), THURSDAY, ctx)
    expect(Number.isNaN(newestOf(out, 'p2', THURSDAY))).toBe(true)
    expect(out[RUNTIME_REQUEST_WITHHELD_KEY].keys).toBe(null)
  })
  it('requestNewestReachOf refuses a site it cannot seed, and one with no line', () => {
    expect(requestNewestReachOf([], 7, [], []).refused.why).toBe('unseeded')
    expect(requestNewestReachOf([], null, [], []).refused.why).toBe('unplaced-site')
  })
  it('requestNewestHeldOf: a site with no reach, or a refused one, is every column', () => {
    const outputs = { a: 0, b: 1 }
    expect(requestNewestHeldOf([{}], [0], outputs).keys).toBe(null)
    expect(requestNewestHeldOf([{ newestReach: { refused: { why: 'x' }, withheld: [] } }], [0], outputs).keys).toBe(null)
    expect(requestNewestHeldOf([{ newestReach: { refused: null, withheld: [{ index: 1 }] } }], [0], outputs).keys).toEqual(['b'])
  })
})

describe('the taint itself (`strategyTaintSinks` with `cutHistory`): which reads a newest-bar-only source reaches', () => {
  const sinksOf = (body, cutHistory) => {
    const { tokens, indents } = lexPine(`//@version=5
indicator("t")
${body}`)
    const stmts = blockStatements(tokens, indents, 0)
    const isSource = (t) => t.kind === 'ident' && t.value === 'request.security' && t.line === 3
    return [...strategyTaintSinks(stmts, { isSource, cutHistory }).values()].map((v) => v.tok.line).sort()
  }
  const BODY = ['r = request.security(syminfo.tickerid, "W", close)',   // line 3
    'plot(r)',                                                          // 4: reads r on the bar
    'plot(r[1])',                                                       // 5: a scalar's past: cut
    'var a = array.new_float(0)',                                       // 6
    'array.push(a, r)',                                                 // 7
    'b = a[1]',                                                         // 8: a REFERENCE's past: the same array
    'plot(array.size(b) > 0 ? array.get(b, 0) : na)',                   // 9: never cut
    'plot(close)'].join('
')                                          // 10: reads no request
  it('cut: r reaches lines 4 and 9, not 5 (r[1]) or 10', () => {
    expect(sinksOf(BODY, true)).toEqual([4, 9])
  })
  it('CONTROL: without the cut (the strategy taint, unchanged) r[1] is reached too', () => {
    expect(sinksOf(BODY, false)).toEqual([4, 5, 9])
  })
})
