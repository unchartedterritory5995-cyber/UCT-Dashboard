// app/src/components/chart/engine/ast/pine.paints.test.js
//
// ─── B1 — `bgcolor` / `barcolor` carried by the host lane (`presentation.paints`)
//
// What the translator says about each paint call: its colour through the one
// colour reader (`outputPresentation`), or WITHHELD by name — never a guessed
// colour. The colours themselves are graded against TradingView in
// `vendorHarness.b1Paints.test.js`; this file pins the vocabulary, the witnessed /
// unwitnessed split, and the host-lane accept for a script whose only output is
// its paint.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine'

const host = (src) => translatePine(src, { strict: true })
const v5 = (body, overlay = true) => `//@version=5\nindicator("t", overlay = ${overlay})\n${body}\n`
const paintsOf = (t) => (t.presentation && t.presentation.paints) || null

describe('the host lane carries a paint\'s colour', () => {
  it('a static colour (with `color.new` alpha) — and the screener lane carries nothing', () => {
    const src = v5('plot(close)\nbgcolor(color.new(color.red, 80))')
    const [p] = paintsOf(host(src))
    expect(p).toMatchObject({ kind: 'bgcolor', line: 4, color: '#FF5252' })
    expect(p.opacity).toBeCloseTo(0.2, 6)
    expect(paintsOf(translatePine(src))).toBeNull()
  })

  it('`cond ? colour : na` is a palette with the transparent `na` entry, read by an index column', () => {
    const [p] = paintsOf(host(v5('plot(close)\nbarcolor(close > open ? color.green : na)')))
    expect(p.kind).toBe('barcolor')
    expect(p.colorPalette).toEqual(['#4CAF50', 'rgba(0, 0, 0, 0)'])
    expect(p.colorIndex.formula).toBe('close > open ? 0 : 1')
  })

  it('a two-colour test rides as `colorUp` / `colorDown` + its condition', () => {
    const [p] = paintsOf(host(v5('plot(close)\nbgcolor(close > open ? color.green : color.red, title = "t2")')))
    expect(p).toMatchObject({ colorUp: '#4CAF50', colorDown: '#FF5252', title: 't2' })
    expect(p.colorCondition.formula).toBe('close > open')
  })

  it('`na` is NO paint, and a rule pinned to its `na` entry by a constant folds to `na` too', () => {
    const t = host(v5('plot(close)\nbgcolor(na)\nshow = false\nbarcolor(show ? color.red : na)'))
    expect(paintsOf(t).map((p) => p.na)).toEqual([true, true])
  })

  it('a rule pinned to a COLOUR entry by a constant folds to that colour', () => {
    const [p] = paintsOf(host(v5('plot(close)\nshow = true\nbarcolor(show ? color.red : na)')))
    expect(p).toMatchObject({ color: '#FF5252' })
    expect(p.colorIndex).toBeUndefined()
  })

  it('`display = display.none` is a paint the author hid (witnessed: atr-support-and-resistance)', () => {
    const [p] = paintsOf(host(v5('plot(close)\nbarcolor(color.red, display = display.none)')))
    expect(p.hidden).toBe(true)
  })

  it('`transp =` by name on v5 (witnessed: btc-charlie) and by position on v4 (witnessed: fvg-trend)', () => {
    const [a] = paintsOf(host(v5('plot(close)\nbgcolor(color.red, title = "x", transp = 70)')))
    expect(a.opacity).toBeCloseTo(0.3, 6)
    const [b] = paintsOf(host('//@version=4\nstudy("t", overlay = true)\nplot(close)\nbgcolor(color.red, 90)\n'))
    expect(b.opacity).toBeCloseTo(0.1, 6)
  })
})

describe('what no capture witnesses is withheld BY NAME', () => {
  const code = (body) => paintsOf(host(v5(`plot(close)\n${body}`)))[0].withheld.code
  // ⭐ F1 — a whole-number `offset` / `show_last` is carried now (CAP round 4: both are
  // render-time only); what is not a whole-number literal stays withheld by name.
  it('⭐ F1: a whole-number `offset` / `show_last` rides beside the colour', () => {
    const [a] = paintsOf(host(v5('plot(close)\nbarcolor(color.red, offset = -2)')))
    expect(a.withheld).toBeUndefined()
    expect(a.offset).toBe(-2)
    const [b] = paintsOf(host(v5('plot(close)\nbgcolor(color.red, show_last = 5)')))
    expect(b.withheld).toBeUndefined()
    expect(b.showLast).toBe(5)
  })
  it('`offset = na`, a computed `show_last`, another `display`, `overlay`', () => {
    expect(code('barcolor(color.red, offset = na)')).toBe('paint:offset')
    expect(code('bgcolor(color.red, show_last = bar_index)')).toBe('paint:show-last')
    expect(code('bgcolor(color.red, display = display.data_window)')).toBe('paint:display')
    expect(code('bgcolor(color.red, overlay = true)')).toBe('paint:overlay')
    expect(code('bgcolor(color.red, force_overlay = true)')).toBe('paint:overlay')
  })
  it('an `offset` of 0 is no offset', () => {
    expect(paintsOf(host(v5('plot(close)\nbgcolor(color.red, offset = 0)')))[0].withheld).toBeUndefined()
  })
  it('⭐ F1: a v3/v4 `bgcolor` with no `transp` takes 90 (vw-bgcolor-v4-default T1 / T3)', () => {
    const t = host('//@version=4\nstudy("t", overlay = true)\nplot(close)\nbgcolor(color.red)\n')
    expect(paintsOf(t)[0].withheld).toBeUndefined()
    expect(paintsOf(t)[0].opacity).toBeCloseTo(0.1, 6)
  })
  it('⛔ a v3/v4 `bgcolor` with no `transp` over a colour with its OWN alpha is still withheld', () => {
    const t = host('//@version=4\nstudy("t", overlay = true)\nplot(close)\nbgcolor(color.new(color.red, 50))\n')
    expect(paintsOf(t)[0].withheld.code).toBe('paint:v4-default-transp')
  })
  it('a colour this door cannot carry', () => {
    expect(code('bgcolor(close > open ? color.rgb(close, 0, 0) : na)')).toBe('paint:colour')
  })
  it('⛔ a withheld paint never costs the script its plots', () => {
    const t = host(v5('plot(close)\nbarcolor(color.red, offset = na)'))
    expect(t.ok).toBe(true)
    expect(t.outputs).toHaveLength(1)
  })
})

describe('a script whose only output is its paint', () => {
  it('⭐ is a host-lane accept when every paint is carried — and stays a screener refusal', () => {
    const src = v5('bgcolor(close > open ? color.new(color.green, 80) : na)')
    const t = host(src)
    expect(t.ok).toBe(true)
    expect(t.selected).toBe(-1)
    expect(t.refusal).toBeNull()
    expect(translatePine(src).ok).toBe(false)
  })
  it('⛔ is refused when a paint is withheld (no partial credit)', () => {
    const t = host(v5('bgcolor(color.green)\nbarcolor(color.red, offset = na)'))
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:no-output')
    expect(paintsOf(t)).toHaveLength(2)
  })
  it('⛔ is refused when its only paint is `na` (nothing is drawn)', () => {
    expect(host(v5('bgcolor(na)')).ok).toBe(false)
  })
  it('⛔ is refused when the drawings it ALSO writes were lost (an empty program is not a clean one)', () => {
    // MEASURED on the corpus: `volume-profile-auto-line-v2` makes the candles
    // transparent with `barcolor` so its profile can be read; every one of its 20
    // drawing ops is dropped, so admitting it on the paint alone would put a chart
    // with NOTHING on it in front of a member.
    const file = path.resolve(process.cwd(), '..', 'corpus', 'committed', 'volume-profile-auto-line-v2__b0e947fd20.pine')
    const t = host(fs.readFileSync(file, 'utf8'))
    expect(t.objectDiagnostics.droppedOps).toBeGreaterThan(0)
    expect(paintsOf(t).some((p) => !p.withheld && !p.na && !p.hidden)).toBe(true)
    expect(t.ok).toBe(false)
  })
})

describe('⛔ a paint mints no parameter id', () => {
  it('the inputs a script declares keep their ids when a paint reads one of them', () => {
    const base = '//@version=5\nindicator("t", overlay = true)\nlen = input.int(14, "Len")\nshow = input.bool(true, "Show")\nplot(ta.sma(close, len))\n'
    const a = translatePine(base, { strict: true, paramManifest: true })
    const b = translatePine(`${base}bgcolor(show and close > open ? color.green : na)\n`, { strict: true, paramManifest: true })
    expect(b.inputParams.map((p) => p.id)).toEqual(a.inputParams.map((p) => p.id))
  })
})
