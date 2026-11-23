// app/src/components/chart/engine/ast/engine55OtherSymbolDoors.test.js
//
// ─── ⭐⭐ ENGINE 55 — AN OTHER-SYMBOL SPELLING NO BINDING CAN SERVE IS REFUSED BY NAME ───
//
// ⚰️ Before engine 55 a bare index / pair / foreign spelling (`"ADVN"`, `"XAUUSD"`) or a
// punctuated one (`"ADVDEC.NY"`) became a `sym` node the bind then starved: an all-`na`
// plot with nothing said (McClellan, smt-divergence, two A/D lines, LazyBear's McClellan).
//   L1 — ONE helper (`otherSymbols.js::staticallyUnservable`) decides it from the spelling.
//        ⭐⭐ REVIEW M1 (coordinator ruling, PR #1264): ONLY THE PLOTS THAT READ IT ARE
//        REFUSED. The translator keeps the `sym` node, every door attaches the script, and
//        the bind refuses those plots `{guard: 'pine:request', code, message}` with ONE
//        sentence (`staticOtherSymbolMessage`), while every other plot is drawn exactly.
//        ⚰️ The first engine-55 cut refused at translate, and the member door's
//        all-or-nothing gate then refused the WHOLE script — a saved copy with two correct
//        plots went `refused` on the 54 -> 55 upgrade. The runtime lane (which runs the
//        whole program) refuses the program with the same sentence; the member door draws
//        the script from the host lane (the C41 pattern).
//   L2 — a plot (or object tree) reading a ticker the BIND refuses (settled, not pending) is
//        refused by name in `columnErrors` (the object lane's `refusals`) — never an all-`na`
//        column — and `externalReadNotices` publishes it for a Pine translation too.
//   L5 — a spelling the host cannot turn into a listing at all (a foreign exchange,
//        `BRK/B`) is refused by name, in one sentence, by the host AND the runtime lane
//        (which took any string before); a throw while asking refuses, never reads.
// Controls: bare `SPY` and `AMEX:SPY` are still served (C29).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { translatePine, Resolver } from './pine'
import { buildRuntimeIr } from './pineRuntimeFrontend'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { retranslateRow, upgradeKindOf } from '../../builder/memberPane/savedScriptUpgrade'
import { computeFor, columnErrors, externalReadNotices } from '../nativeRegistry'
import { objectReaderFor } from '../objectColumns'
import {
  staticallyUnservable, spellingUnservable, staticOtherSymbolMessage, staticOtherSymbolRefusalOf,
  colourReaderMessage, staticPlotRefusalsOf, plotValueIsNaLiteral, OTHER_SYMBOL_REFUSAL as R,
} from '../otherSymbols'
import { inspectSource } from '../../builder/PineBox'

const LF = String.fromCharCode(10)
const pine = (lines) => ['//@version=5', 'indicator("e55")', ...lines].join(LF)
const BARS = Array.from({ length: 40 }, (_, i) => ({ t: 1767225600 + i * 86400, o: 10 + i, h: 11 + i + (i % 3), l: 9 + i, c: 10 + i + (i % 4) * 0.25, v: 1000 }))
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
const CTX = { tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: false, secondary: new Map(), exchangeOf: () => null }
const sma = (n) => BARS.map((_, i) => (i + 1 < n ? NaN : BARS.slice(i + 1 - n, i + 1).reduce((x, b) => x + b.c, 0) / n))
const sameSeries = (got, want) => want.every((w, i) => (Number.isNaN(w) ? !Number.isFinite(got[i]) : Math.abs(got[i] - w) < 1e-9))

afterEach(() => { vi.restoreAllMocks() })

// [label, spelled, code, ticker the sentence names]
const HOPELESS = [
  ['bare XAUUSD (not a US listing shape)', '"XAUUSD"', R.BARE, 'XAUUSD'],
  ['bare EURUSD (a pair)', '"EURUSD"', R.BARE, 'EURUSD'],
  ['bare ADVN (also an index: BARE_AMBIGUOUS, breadth)', '"ADVN"', R.BARE, 'ADVN'],
  ['bare SPX (also an index)', '"SPX"', R.BARE, 'SPX'],
  ['bare VIX (also an index)', '"VIX"', R.BARE, 'VIX'],
  ['bare DXY (also an index)', '"DXY"', R.BARE, 'DXY'],
  ['bare ADVDEC.NY (punctuation)', '"ADVDEC.NY"', R.CLASS_SHARE, 'ADVDEC.NY'],
  ['NYSE:BRK-B (a hyphen names no listing)', '"NYSE:BRK-B"', R.CLASS_SHARE, 'BRK-B'],
]
const venueOf = (spelled) => (spelled.includes(':') ? spelled.slice(1, spelled.indexOf(':')) : '')

describe('⭐⭐ L1 / review M1 — a spelling no binding serves refuses ONLY the plots that read it, in ONE sentence at every door', () => {
  it.each(HOPELESS)('%s: the doors attach; the bind and the runtime lane say one sentence', (_, spelled, code, ticker) => {
    const why = staticallyUnservable(ticker, venueOf(spelled))
    expect(why && why.code).toBe(code)
    const sentence = staticOtherSymbolMessage(ticker, why)
    const src = pine(['plot(close, "own")', `plot(request.security(${spelled}, timeframe.period, close), "x")`])
    // screen and pane (strict): no refusal at translate; the reading output names the refusal it will get
    for (const opts of [undefined, { strict: true }]) {
      const t = translatePine(src, opts)
      expect(hostRefusal(src, opts), JSON.stringify(opts)).toBe(null)
      const x = t.outputs.find((o) => o.title === 'x')
      expect(staticOtherSymbolRefusalOf(x.ast, t.otherSymbols)).toEqual({ guard: 'pine:request', code, message: sentence })
      expect(staticOtherSymbolRefusalOf(t.outputs.find((o) => o.title === 'own').ast, t.otherSymbols)).toBe(null)
    }
    // the member door attaches, and the bind refuses exactly that plot with that sentence
    const d = door(src)
    expect(d.ok, d.reason).toBe(true)
    const cols = computeFor(d.definition, BARS, undefined, CTX)
    const errs = columnErrors(cols)
    expect(Object.values(errs)).toEqual([{ guard: 'pine:request', code, message: sentence }])
    expect(externalReadNotices(d.definition, cols)).toEqual([{ code, reason: sentence }])
    // the runtime lane runs the whole program: it refuses it, with the same sentence
    const r = runtimeRefusal(src)
    expect(r && r.guard).toBe('pine:request')
    expect(r.message).toBe(sentence)
  })

  it('a tuple request reading such a spelling refuses the plots that read it, by the same sentence', () => {
    const src = pine(['[a, b] = request.security("XAUUSD", timeframe.period, [open, close])', 'plot(a, "a")', 'plot(close, "own")'])
    expect(hostRefusal(src, { strict: true })).toBe(null)
    const d = door(src)
    expect(d.ok, d.reason).toBe(true)
    const errs = columnErrors(computeFor(d.definition, BARS, undefined, CTX))
    expect(Object.values(errs).map((e) => e.message)).toEqual([staticOtherSymbolMessage('XAUUSD', staticallyUnservable('XAUUSD', ''))])
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
      expect(runtimeRefusal(src), spelled).toBe(null)
      const d = door(src)
      expect(d.ok, spelled).toBe(true)
    }
    expect(staticallyUnservable('SPY', '')).toBe(null)
    expect(staticallyUnservable('SPY', 'AMEX')).toBe(null)
    expect(staticallyUnservable('BRK.B', '')).toBe(null)
    expect(staticallyUnservable('ADVQ', '')).toBe(null)      // US-shaped: the bind decides
  })
})

describe('⭐⭐ review M1 — two correct plots and one unservable read: the two are drawn, exact; the third is refused by name', () => {
  const THIRD = ['XAUUSD', 'SPX', 'VIX', 'DXY']
  const srcOf = (t) => pine(['plot(close, "own")', 'plot(ta.sma(close, 5), "sma")', `plot(request.security("${t}", timeframe.period, close), "third")`])

  const check = (def, t) => {
    const cols = computeFor(def, BARS, undefined, CTX)
    const keys = def.plots.map((p) => p.key)
    expect(keys.length).toBe(3)
    expect(sameSeries(Array.from(cols[keys[0]]), BARS.map((b) => b.c)), `${t} own`).toBe(true)
    expect(sameSeries(Array.from(cols[keys[1]]), sma(5)), `${t} sma`).toBe(true)
    const errs = columnErrors(cols)
    expect(Object.keys(errs)).toEqual([keys[2]])
    expect(errs[keys[2]]).toEqual({ guard: 'pine:request', code: R.BARE, message: staticOtherSymbolMessage(t, staticallyUnservable(t, '')) })
    expect(cols[keys[2]]).toBeUndefined()
  }

  it.each(THIRD)('%s — a fresh translate: the door attaches the script', (t) => {
    const d = door(srcOf(t))
    expect(d.ok, d.reason).toBe(true)
    check(d.definition, t)
  })

  it.each(THIRD)('%s — a copy saved at engine 54 and upgraded to 55 is UPGRADED, never refused', (t) => {
    const d = door(srcOf(t))
    expect(d.ok, d.reason).toBe(true)
    const saved = JSON.parse(JSON.stringify(d.definition))
    saved.meta = { ...saved.meta, engineVersion: 54 }
    const row = { def_id: 'u_e55sym', version: 1, rev: 1, definition: saved, pine_source: srcOf(t) }
    expect(upgradeKindOf(row)).toBe('retranslate')
    // the saved-at-54 copy, bound before it is upgraded, already refuses only the third plot
    check(saved, t)
    const up = retranslateRow(row, memberPaneDefinition)
    expect(up.status, up.reason).toBe('upgraded')
    check(up.definition, t)
  })

  it('a script whose ONLY plots read unservable tickers is withheld BY NAME, never drawn blank', () => {
    const d = door(pine(['plot(request.security("XAUUSD", timeframe.period, close), "a")', 'plot(request.security("SPX", timeframe.period, close), "b")']))
    expect(d.ok, d.reason).toBe(true)
    const cols = computeFor(d.definition, BARS, undefined, CTX)
    const errs = columnErrors(cols)
    for (const p of d.definition.plots) {
      expect(errs[p.key] && errs[p.key].guard, p.key).toBe('pine:request')
      expect(cols[p.key], p.key).toBeUndefined()
    }
    expect(externalReadNotices(d.definition, cols).length).toBe(2)
  })
})

describe('⭐⭐ review L5 — a spelling the host cannot turn into a listing: ONE helper, refused by name in BOTH lanes', () => {
  const CASES = [['"BRK/B"', R.CLASS_SHARE, 'BRK/B'], ['"TSX:RY"', R.VENUE_FOREIGN, 'TSX:RY'], ['"XETR:SAP"', R.VENUE_FOREIGN, 'XETR:SAP']]
  it.each(CASES)('%s: the screen, the pane (strict), the runtime lane and the member door say one sentence', (spelled, code, ticker) => {
    const why = spellingUnservable(spelled.slice(1, -1))
    expect(why && why.code).toBe(code)
    const sentence = staticOtherSymbolMessage(ticker, why)
    const src = pine([`plot(request.security(${spelled}, timeframe.period, close))`])
    for (const r of [hostRefusal(src), hostRefusal(src, { strict: true }), runtimeRefusal(src)]) {
      expect(r && r.guard).toBe('pine:request')
      expect(r.message).toBe(sentence)
    }
    const d = door(src)
    expect(d.ok).toBe(false)
    expect(d.guard).toBe('pine:request')
    expect(String(d.reason)).toBe(sentence)
  })

  it('a throw while the runtime lane asks is a refusal by name, never a read (fails closed)', () => {
    vi.spyOn(Resolver.prototype, 'otherSymbolStaticDeclineOf').mockImplementation(() => { throw new Error('probe') })
    const r = runtimeRefusal(pine(['plot(request.security("AMEX:SPY", timeframe.period, close))']))
    expect(r && r.guard).toBe('pine:request')
    expect(r.message).toMatch(/could not be read \(probe\), so the request is refused rather than read$/)
  })
})

describe('⭐ review L6 — only a real breadth spelling gets the breadth sentence', () => {
  it('ADVN, TICK.NY and USI:ADDQ are breadth; DECKXX, ADDYYX and TSX:ADDYY are not', () => {
    expect(staticallyUnservable('ADVN', '').reason).toMatch(/breadth/)
    expect(staticallyUnservable('TICK.NY', '').reason).toMatch(/breadth/)
    // (B2 W-B1, 2026-11-22: USI:ADD is witnessed and served, so it is refused by no sentence; USI:ADDQ, not in the
    // probe, still refuses with the breadth sentence)
    expect(spellingUnservable('USI:ADDQ').reason).toMatch(/breadth/)
    expect(spellingUnservable('USI:ADD')).toBeFalsy()
    for (const [t, v] of [['DECKXX', ''], ['ADDYYX', '']]) {
      const why = staticallyUnservable(t, v)
      expect(why && why.code, t).toBe(R.BARE)
      expect(why.reason, t).not.toMatch(/breadth/)
    }
    expect(spellingUnservable('TSX:ADDYY').reason).not.toMatch(/breadth/)
  })
})

// ⭐⭐ REVIEW F1 (coordinator, PR #1264 re-review) — SERVE, NEVER DEFAULT. A plot whose COLOUR
// (or band colour) reads a refused symbol was drawn in the series' DEFAULT colour on every bar:
// the hidden colour helper was refused and its reader was not. Now the reader is refused too, by
// name, with a sentence naming the visible plot and the symbol (never the helper row `out2`); a
// paint reading one is named on the strip by its kind and line. The import screen, the member
// door (`staticRefusals`) and the bind say the same per plot.
describe('⭐⭐ review F1 — a plot whose colour reads a refused symbol is refused by name, never drawn in a default colour', () => {
  const SPX = 'request.security("SPX", timeframe.period, close)'
  const spx = staticOtherSymbolMessage('SPX', staticallyUnservable('SPX', ''))
  const doorOf = (lines) => memberPaneDefinition({ source: ['//@version=5', 'indicator("f1", overlay=true)', ...lines].join(LF), id: 'u_e55f1', name: 'f1' })
  const screenOf = (lines) => inspectSource(['//@version=5', 'indicator("f1", overlay=true)', ...lines].join(LF), 'pine').outcome
  const keyOf = (def, label) => def.plots.find((p) => p.label === label).key

  it('the reviewer\'s probe: plot(close, "own", color = SPX > 100 ? green : red) — `own` is refused by name at every door', () => {
    const lines = [`plot(close, "own", color = ${SPX} > 100 ? color.green : color.red)`]
    const d = doorOf(lines)
    expect(d.ok, d.reason).toBe(true)
    const own = keyOf(d.definition, 'own')
    const want = { guard: 'pine:request', code: R.BARE, message: colourReaderMessage('`own`', spx) }
    expect(want.message).toMatch(/^`own` is not drawn: its colour reads `SPX`: other-symbol:bare — /)
    expect(want.message).not.toMatch(/out2/)
    // the bind: refused, NOT drawn in the default colour
    const cols = computeFor(d.definition, BARS, undefined, CTX)
    expect(columnErrors(cols)[own]).toEqual(want)
    expect(cols[own]).toBeUndefined()
    // the member door says it up front, the same sentence
    expect(d.staticRefusals[own]).toEqual(want)
    // the import screen says it up front, the same sentence
    const outcome = screenOf(lines)
    expect(outcome.missing).toEqual([{ name: 'own', guard: 'pine:request', message: want.message }])
  })

  it('a band whose COLOUR reads the refused symbol: its owner is refused by name; the other plot is drawn', () => {
    const lines = ['a = plot(close, "own")', 'b = plot(open, "o")', `fill(a, b, color = ${SPX} > 100 ? color.new(color.blue, 80) : color.new(color.red, 80))`]
    const d = doorOf(lines)
    expect(d.ok, d.reason).toBe(true)
    const cols = computeFor(d.definition, BARS, undefined, CTX)
    const errs = columnErrors(cols)
    const want = { guard: 'pine:request', code: R.BARE, message: colourReaderMessage('`own`', spx) }
    expect(errs[keyOf(d.definition, 'own')]).toEqual(want)
    expect(Array.from(cols[keyOf(d.definition, 'o')]).some(Number.isFinite)).toBe(true)
    expect(d.staticRefusals[keyOf(d.definition, 'own')]).toEqual(want)
    expect(screenOf(lines).missing).toEqual([{ name: 'own', guard: 'pine:request', message: want.message }])
  })

  it('a band whose PARTNER reads the refused symbol: the partner is refused by name and the owner\'s own line is drawn', () => {
    const d = doorOf(['a = plot(close, "own")', `b = plot(${SPX}, "spx")`, 'fill(a, b, color=color.new(color.blue, 80))'])
    expect(d.ok, d.reason).toBe(true)
    const cols = computeFor(d.definition, BARS, undefined, CTX)
    const errs = columnErrors(cols)
    expect(errs[keyOf(d.definition, 'spx')]).toEqual({ guard: 'pine:request', code: R.BARE, message: spx })
    expect(cols[keyOf(d.definition, 'spx')]).toBeUndefined()            // the band has no edge to draw
    expect(Array.from(cols[keyOf(d.definition, 'own')]).some(Number.isFinite)).toBe(true)
  })

  it.each(['bgcolor', 'barcolor'])('a %s whose colour reads the refused symbol is named on the strip by its kind and line, never by the helper row', (kind) => {
    const colour = kind === 'bgcolor' ? 'color.new(color.green, 80)' : 'color.green'
    const d = doorOf(['plot(close, "own")', `${kind}(${SPX} > 100 ? ${colour} : na)`])
    expect(d.ok, d.reason).toBe(true)
    const cols = computeFor(d.definition, BARS, undefined, CTX)
    const notes = externalReadNotices(d.definition, cols)
    expect(notes).toContainEqual({ code: R.BARE, reason: colourReaderMessage(`\`${kind}\` (line 4)`, spx) })
    expect(notes.some((n) => /out2/.test(n.reason))).toBe(false)
    expect(Array.from(cols[keyOf(d.definition, 'own')]).some(Number.isFinite)).toBe(true)
  })

  // ⭐ review F1, narrowed (McClellan MSI RSI / MACD Histogram, CAP3): a plot whose VALUE is `na`
  // on every bar draws nothing, and neither does TradingView, so a colour reading the refused
  // symbol is never seen. It is NOT refused. CONTROL: the same plot with a value IS.
  // ⛔ STATICALLY na only (the value tree IS the `na` literal, as McClellan's input-folded branches
  // are). A value that is na only at RUN time (`mode == "B" ? close : na` with mode a live input)
  // is still refused: the member can choose the branch without a retranslation.
  const HIDDEN_BY_SCRIPT = 'hidden by the script itself, so not offered'
  const QUIET = (value) => [`plot(${value}, "quiet", color = ${SPX} > 100 ? color.green : color.red)`, 'plot(open, "o")']

  it('a plot whose value is na on every bar and whose colour reads SPX is NOT refused by the bind or the member door, and draws nothing', () => {
    const lines = QUIET('na')
    const d = doorOf(lines)
    expect(d.ok, d.reason).toBe(true)
    const quiet = keyOf(d.definition, 'quiet')
    expect(plotValueIsNaLiteral(d.definition.compute.trees[quiet])).toBe(true)     // non-vacuity: the input folded to na
    const cols = computeFor(d.definition, BARS, undefined, CTX)
    expect(columnErrors(cols)[quiet]).toBeUndefined()
    expect(Array.from(cols[quiet])).toHaveLength(BARS.length)
    expect(Array.from(cols[quiet]).some(Number.isFinite)).toBe(false)               // draws nothing, as TradingView
    expect((d.staticRefusals || {})[quiet]).toBeUndefined()
    expect(Array.from(cols[keyOf(d.definition, 'o')]).some(Number.isFinite)).toBe(true)
    // the import screen (pre-existing, unchanged here) offers an all-na output as hidden by the script
    const screen = screenOf(lines)
    expect((screen.missing || []).map((m) => m.name)).not.toContain('quiet')
    expect(screen.info).toContainEqual(expect.objectContaining({ name: 'quiet', note: HIDDEN_BY_SCRIPT }))
  })

  it.each(['close', 'mode == "B" ? close : na'])('CONTROL: the same plot with value `%s` (drawable) is refused by name at every door', (value) => {
    const lines = value === 'close' ? QUIET(value) : ['mode = input.string("A", "Mode", options = ["A", "B"])', ...QUIET(value)]
    const d = doorOf(lines)
    expect(d.ok, d.reason).toBe(true)
    const quiet = keyOf(d.definition, 'quiet')
    expect(plotValueIsNaLiteral(d.definition.compute.trees[quiet])).toBe(false)
    const want = { guard: 'pine:request', code: R.BARE, message: colourReaderMessage('`quiet`', spx) }
    const cols = computeFor(d.definition, BARS, undefined, CTX)
    expect(columnErrors(cols)[quiet]).toEqual(want)
    expect(cols[quiet]).toBeUndefined()
    expect(d.staticRefusals[quiet]).toEqual(want)
    const screen = screenOf(lines)
    if (value === 'close') expect(screen.missing).toEqual([{ name: 'quiet', guard: 'pine:request', message: want.message }])
    // ⚠️ KNOWN, PRE-EXISTING (not this change): the import screen folds the live input to its
    // default, reads the value as na and offers the plot as hidden, while the bind refuses it by name
    else expect(screen.info).toContainEqual(expect.objectContaining({ name: 'quiet', note: HIDDEN_BY_SCRIPT }))
  })

  it('the member door\'s `staticRefusals` equals what the bind refuses by spelling, for every shape here', () => {
    for (const lines of [
      QUIET('na'),
      QUIET('close'),
      [`plot(close, "own", color = ${SPX} > 100 ? color.green : color.red)`],
      ['plot(close, "own")', `plot(${SPX}, "spx")`],
      ['x = ' + SPX, 'plot(close - x, "diff")', 'plot(close, "own")'],
    ]) {
      const d = doorOf(lines)
      expect(d.ok, d.reason).toBe(true)
      const errs = columnErrors(computeFor(d.definition, BARS, undefined, CTX))
      expect(d.staticRefusals, lines.join(' / ')).toEqual(errs)
      expect(staticPlotRefusalsOf(d.definition)).toEqual(errs)
    }
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
