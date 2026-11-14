// app/src/components/chart/engine/ast/engine55OtherSymbolDoors.test.js
//
// ─── ⭐⭐ ENGINE 55 — AN OTHER-SYMBOL SPELLING NO BINDING CAN SERVE IS REFUSED BY NAME ───
//
// ⚰️ Before engine 55 a bare index / pair / foreign spelling (`"ADVN"`, `"XAUUSD"`) or a
// punctuated one (`"ADVDEC.NY"`) became a `sym` node the bind then starved: an all-`na`
// plot with nothing said (McClellan, smt-divergence, two A/D lines, LazyBear's McClellan).
//   L1 — ONE helper (`otherSymbols.js::staticallyUnservable`) decides it from the spelling,
//        and every door refuses the read as `pine:request` carrying the code, in ONE
//        sentence: the screen, the pane (strict), the runtime lane and the member door.
//   L2 — a plot (or object tree) reading a ticker the BIND refuses (settled, not pending) is
//        refused by name in `columnErrors` (the object lane's `refusals`) — never an all-`na`
//        column — and `externalReadNotices` publishes it for a Pine translation too.
// Controls: bare `SPY` and `AMEX:SPY` are still served (C29).
import { describe, it, expect } from 'vitest'
import { translatePine, REFUSALS } from './pine'
import { buildRuntimeIr } from './pineRuntimeFrontend'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { computeFor, columnErrors, externalReadNotices } from '../nativeRegistry'
import { objectReaderFor } from '../objectColumns'
import { staticallyUnservable, OTHER_SYMBOL_REFUSAL as R } from '../otherSymbols'

const LF = String.fromCharCode(10)
const pine = (lines) => ['//@version=5', 'indicator("e55")', ...lines].join(LF)
const BARS = Array.from({ length: 40 }, (_, i) => ({ t: 1767225600 + i * 86400, o: 10 + i, h: 11 + i, l: 9 + i, c: 10 + i, v: 1000 }))
const hostRefusal = (src, opts) => {
  const t = translatePine(src, opts)
  if (t.ok) return null
  return t.refusal || ((t.outputs || []).find((o) => o && o.refusal) || {}).refusal || { guard: '?' }
}
const runtimeRefusal = (src) => {
  const built = buildRuntimeIr(src, { bars: BARS, inputs: {}, pane: true, historyFromListing: true })
  return built.ok ? null : built.refusal
}
const door = (src) => memberPaneDefinition({ source: src, id: 'u_e55sym', name: 'e55' })

const HOPELESS = [
  ['bare XAUUSD (not a US listing shape)', '"XAUUSD"', R.BARE, 'XAUUSD'],
  ['bare EURUSD (a pair)', '"EURUSD"', R.BARE, 'EURUSD'],
  ['bare ADVN (also an index: BARE_AMBIGUOUS, breadth)', '"ADVN"', R.BARE, 'ADVN'],
  ['bare SPX (also an index)', '"SPX"', R.BARE, 'SPX'],
  ['bare ADVDEC.NY (punctuation)', '"ADVDEC.NY"', R.CLASS_SHARE, 'ADVDEC.NY'],
  ['NYSE:BRK-B (a hyphen names no listing)', '"NYSE:BRK-B"', R.CLASS_SHARE, 'BRK-B'],
]

describe('⭐⭐ L1 — the four doors refuse a hopeless spelling with ONE guard and ONE sentence', () => {
  it.each(HOPELESS)('%s: screen, pane (strict), runtime lane and member door', (_, spelled, code, ticker) => {
    const src = pine([`plot(request.security(${spelled}, timeframe.period, close))`])
    const why = staticallyUnservable(ticker, spelled.includes(':') ? spelled.slice(1, spelled.indexOf(':')) : '')
    expect(why && why.code).toBe(code)
    const sentence = `${REFUSALS['pine:request']} — \`request.security\`: ${code} — ${why.reason}`
    for (const r of [hostRefusal(src), hostRefusal(src, { strict: true }), runtimeRefusal(src)]) {
      expect(r && r.guard).toBe('pine:request')
      expect(r.message).toBe(sentence)
    }
    const d = door(src)
    expect(d.ok).toBe(false)
    expect(d.guard).toBe('pine:request')
    expect(String(d.reason)).toContain(`${code} — `)
  })

  it('per plot: a script with one hopeless read and one plain plot keeps the plain plot', () => {
    const src = pine(['plot(close, "own")', 'plot(request.security("XAUUSD", timeframe.period, close), "gold")'])
    const t = translatePine(src, { strict: true })
    const own = t.outputs.find((o) => o.title === 'own')
    const gold = t.outputs.find((o) => o.refusal)        // a refused row carries no title
    expect(own && own.ast).toBeTruthy()
    expect(gold.refusal && gold.refusal.message).toContain(`${R.BARE} — `)
  })

  it('a tuple request reading a hopeless spelling names the code too', () => {
    const src = pine(['[a, b] = request.security("XAUUSD", timeframe.period, [open, close])', 'plot(a)'])
    const r = hostRefusal(src, { strict: true })
    expect(r && r.guard).toBe('pine:request')
    expect(r.message).toContain(`${R.BARE} — `)
  })

  it('the breadth sentence says "not available yet", never "never"', () => {
    const why = staticallyUnservable('ADVN', '')
    expect(why.reason).toMatch(/this breadth symbol is not available yet/)
    expect(why.reason).not.toMatch(/\bnever\b/)
    expect(staticallyUnservable('XAUUSD', '').reason).not.toMatch(/breadth/)
  })

  it('CONTROLS (C29): bare SPY and AMEX:SPY still translate at every door', () => {
    for (const spelled of ['"SPY"', '"AMEX:SPY"', '"NYSE:BRK.B"']) {
      const src = pine([`plot(request.security(${spelled}, timeframe.period, close))`])
      expect(hostRefusal(src), spelled).toBe(null)
      expect(hostRefusal(src, { strict: true }), spelled).toBe(null)
      const d = door(src)
      expect(d.ok, spelled).toBe(true)
    }
    expect(staticallyUnservable('SPY', '')).toBe(null)
    expect(staticallyUnservable('SPY', 'AMEX')).toBe(null)
    expect(staticallyUnservable('BRK.B', '')).toBe(null)
    expect(staticallyUnservable('ADVQ', '')).toBe(null)      // US-shaped: the bind decides
  })
})

describe('⭐⭐ L2 — a plot reading a ticker the bind refused is refused BY NAME, never an all-na column', () => {
  // `ADVQ` is shaped like a US listing (so the translator lets it through) and our store holds no
  // such listing: the bind refuses it (`other-symbol:bare`), settled — not a fetch still pending.
  const d = door(pine(['plot(close, "own")', 'plot(request.security("ADVQ", timeframe.period, close), "q")']))
  const ctx = { tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: false,
    secondary: new Map([['ADVQ', { bars: [], status: 'no_data' }]]), exchangeOf: () => null }

  it('the door attaches; the bind refuses the reading plot in columnErrors and draws the other', () => {
    expect(d.ok).toBe(true)
    const cols = computeFor(d.definition, BARS, undefined, ctx)
    const keys = (d.rows || []).map((r) => r.key)
    const errs = columnErrors(cols)
    const refusedKeys = Object.keys(errs)
    expect(refusedKeys.length).toBe(1)
    expect(errs[refusedKeys[0]].guard).toBe(R.BARE)
    expect(errs[refusedKeys[0]].message).toContain('ADVQ')
    expect(cols[refusedKeys[0]]).toBeUndefined()
    const other = keys.find((k) => k !== refusedKeys[0])
    expect(Array.from(cols[other]).some(Number.isFinite)).toBe(true)
  })

  it('externalReadNotices names it for a Pine translation (it said nothing before)', () => {
    const cols = computeFor(d.definition, BARS, undefined, ctx)
    const notes = externalReadNotices(d.definition, cols)
    expect(notes.map((n) => n.code)).toContain(R.BARE)
    expect(notes.find((n) => n.code === R.BARE).reason.startsWith('This indicator reads `ADVQ`')).toBe(true)
  })

  it('a read still WAITING for its bars is not refused yet (pending is not a settled no); once answered "no data", it is', () => {
    const spy = door(pine(['plot(close, "own")', 'plot(request.security("AMEX:SPY", timeframe.period, close), "spy")']))
    expect(spy.ok).toBe(true)
    const held = { ...ctx, exchangeOf: (t) => (t === 'SPY' ? 'NYSE Arca' : null) }
    const waiting = computeFor(spy.definition, BARS, undefined, { ...held, secondary: new Map() })
    expect(Object.keys(columnErrors(waiting))).toEqual([])
    const loading = computeFor(spy.definition, BARS, undefined, { ...held, secondary: new Map([['SPY', { bars: [], status: 'loading' }]]) })
    expect(Object.keys(columnErrors(loading))).toEqual([])
    const settled = computeFor(spy.definition, BARS, undefined, { ...held, secondary: new Map([['SPY', { bars: [], status: 'no_data' }]]) })
    const errs = Object.values(columnErrors(settled))
    expect(errs.map((e) => e.guard)).toEqual([R.NO_BARS])
  })

  it('a SINGLE-tree Pine document reading a refused ticker is refused by name too', () => {
    const single = { id: 'u_e55one', version: 1, plots: [{ key: 'v', style: 'line' }],
      compute: { kind: 'ast', fn: 'u_e55one', source: 'x', ast: { type: 'sym', value: 'ADVQ', args: [{ type: 'series', name: 'close' }] } },
      meta: { recurrenceOrigin: 'pine', otherSymbols: [{ ticker: 'ADVQ', spellings: [''] }] } }
    const cols = computeFor(single, BARS, undefined, ctx)
    const errs = columnErrors(cols)
    expect(Object.keys(errs)).toEqual(['v'])
    expect(errs.v.guard).toBe(R.BARE)
    expect(errs.v.message.startsWith('This indicator reads `ADVQ`')).toBe(true)
  })

  it('an OBJECT tree reading the refused ticker is refused by name in the object lane', () => {
    const od = door(pine([
      'x = request.security("ADVQ", timeframe.period, close)',
      'if barstate.islast',
      '    label.new(bar_index, high, str.tostring(x))',
      'plot(close)',
    ]))
    expect(od.ok).toBe(true)
    const reader = objectReaderFor(od.definition, BARS, { ...ctx, inputs: undefined })
    expect(reader).toBeTruthy()
    const named = (reader.refusals || []).filter((r) => r.guard === R.BARE)
    expect(named.length).toBeGreaterThan(0)
    expect(named[0].message).toContain('ADVQ')
  })
})
